import {
  apiErrorSchema,
  memberSchema,
  roleDetailSchema,
  workspaceDetailSchema,
} from '@forge/shared';
import { auditEvents, organisationMemberships, organisations, roles, users } from '@forge/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startIntegration, type Integration } from '../test-support/integration';

let ctx: Integration;
let acmeId: string;
let northwindId: string;
const userIds: Record<string, string> = {};
const acmeRoleIds: Record<string, string> = {};
const northwindRoleIds: Record<string, string> = {};

const EMAILS: Record<string, string> = {
  owner: 'owner@acme.test',
  admin: 'admin@acme.test',
  developer: 'developer@acme.test',
  reviewer: 'reviewer@acme.test',
  readonly: 'readonly@acme.test',
  restricted: 'restricted@acme.test',
  'other-owner': 'owner@northwind.test',
};

async function loadIds() {
  const orgs = await ctx.db.select().from(organisations);
  acmeId = orgs.find((o) => o.slug === 'acme')!.id;
  northwindId = orgs.find((o) => o.slug === 'northwind')!.id;
  for (const [key, email] of Object.entries(EMAILS)) {
    userIds[key] = (await ctx.db.select().from(users).where(eq(users.email, email)))[0]!.id;
  }
  for (const role of await ctx.db.select().from(roles)) {
    (role.organisationId === acmeId ? acmeRoleIds : northwindRoleIds)[role.key] = role.id;
  }
}

beforeAll(async () => {
  ctx = await startIntegration();
});

beforeEach(async () => {
  await ctx.reseed();
  await loadIds();
});

afterAll(async () => {
  await ctx.close();
});

type Call = { method: 'GET' | 'PATCH'; url: string; payload?: object; cookie?: string };
const call = ({ cookie, ...rest }: Call) =>
  ctx.app.inject({ ...rest, headers: cookie ? { cookie } : {} });

const endpoints = (orgId: string, targetUserId: string, roleId: string) =>
  ({
    'GET workspace': { method: 'GET', url: `/api/v1/orgs/${orgId}` },
    'GET members': { method: 'GET', url: `/api/v1/orgs/${orgId}/members` },
    'GET roles': { method: 'GET', url: `/api/v1/orgs/${orgId}/roles` },
    'PATCH workspace': {
      method: 'PATCH',
      url: `/api/v1/orgs/${orgId}`,
      payload: { name: 'Acme Robotics' },
    },
    'PATCH member': {
      method: 'PATCH',
      url: `/api/v1/orgs/${orgId}/members/${targetUserId}`,
      payload: { roleId },
    },
  }) satisfies Record<string, Call>;

const ENDPOINT_NAMES = [
  'GET workspace',
  'GET members',
  'GET roles',
  'PATCH workspace',
  'PATCH member',
] as const;

describe('permission matrix on the Acme workspace', () => {
  // [identity, expected status for each of ENDPOINT_NAMES]
  const matrix: [string, number[]][] = [
    ['owner', [200, 200, 200, 200, 200]],
    ['admin', [200, 200, 200, 200, 200]],
    ['developer', [200, 200, 200, 403, 403]],
    ['reviewer', [200, 200, 200, 403, 403]],
    ['readonly', [200, 200, 200, 403, 403]],
    ['restricted', [403, 403, 403, 403, 403]],
    ['other-owner', [404, 404, 404, 404, 404]],
  ];

  it.each(matrix)('%s gets the expected status from every endpoint', async (identity, expected) => {
    const cookie = await ctx.cookieFor(identity);
    const table = endpoints(acmeId, userIds.developer!, acmeRoleIds.developer!);
    const actual: number[] = [];
    for (const name of ENDPOINT_NAMES) {
      actual.push((await call({ ...table[name], cookie })).statusCode);
    }
    expect(actual).toEqual(expected);
  });

  it('answers 401 to everyone who is not signed in', async () => {
    const table = endpoints(acmeId, userIds.developer!, acmeRoleIds.developer!);
    for (const name of ENDPOINT_NAMES) {
      const response = await call(table[name]);
      expect(response.statusCode).toBe(401);
      expect(apiErrorSchema.parse(response.json()).error.code).toBe('unauthenticated');
    }
  });

  it('applies the same rules in the other workspace (Dana is only a reader there)', async () => {
    const cookie = await ctx.cookieFor('developer');
    const table = endpoints(northwindId, userIds['other-owner']!, northwindRoleIds.owner!);
    const statuses: number[] = [];
    for (const name of ENDPOINT_NAMES) {
      statuses.push((await call({ ...table[name], cookie })).statusCode);
    }
    expect(statuses).toEqual([200, 200, 200, 403, 403]);

    const nora = await ctx.cookieFor('other-owner');
    expect((await call({ ...table['GET members'], cookie: nora })).statusCode).toBe(200);
  });
});

describe('a workspace the caller cannot see looks like one that does not exist', () => {
  it('returns the same 404 for a real foreign id, an unknown uuid and a non-uuid', async () => {
    const cookie = await ctx.cookieFor('other-owner');
    const bodies = [];
    for (const orgId of [acmeId, '01a1656b-1a49-7146-94ac-1c72df43ddb4', 'not-a-uuid']) {
      const response = await call({ method: 'GET', url: `/api/v1/orgs/${orgId}/members`, cookie });
      expect(response.statusCode).toBe(404);
      const { requestId: _requestId, ...rest } = apiErrorSchema.parse(response.json()).error;
      bodies.push(rest);
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it('does the same for writes', async () => {
    const cookie = await ctx.cookieFor('other-owner');
    const foreign = await call({
      method: 'PATCH',
      url: `/api/v1/orgs/${acmeId}/members/${userIds.developer}`,
      payload: { roleId: acmeRoleIds.owner },
      cookie,
    });
    expect(foreign.statusCode).toBe(404);
    const memberships = await ctx.db
      .select()
      .from(organisationMemberships)
      .where(eq(organisationMemberships.userId, userIds.developer!));
    expect(memberships.map((m) => m.roleId).sort()).toEqual(
      [acmeRoleIds.developer, northwindRoleIds.readonly].sort(),
    );
  });
});

describe('tenant data', () => {
  it('lists only Acme members, never Northwind ones', async () => {
    const cookie = await ctx.cookieFor('owner');
    const response = await call({ method: 'GET', url: `/api/v1/orgs/${acmeId}/members`, cookie });
    const members = memberSchema.array().parse(response.json());
    expect(members).toHaveLength(6);
    expect(members.map((m) => m.user.email)).not.toContain('owner@northwind.test');
    expect(members.map((m) => m.user.displayName)).toEqual(
      [...members.map((m) => m.user.displayName)].sort(),
    );
  });

  it('lists only Acme roles', async () => {
    const cookie = await ctx.cookieFor('owner');
    const response = await call({ method: 'GET', url: `/api/v1/orgs/${acmeId}/roles`, cookie });
    const listed = roleDetailSchema.array().parse(response.json());
    expect(listed.map((r) => r.id).sort()).toEqual(Object.values(acmeRoleIds).sort());
    expect(listed.find((r) => r.key === 'restricted')?.permissions).toEqual([]);
  });

  it('describes the workspace with its member count and the caller’s role', async () => {
    const cookie = await ctx.cookieFor('reviewer');
    const response = await call({ method: 'GET', url: `/api/v1/orgs/${acmeId}`, cookie });
    expect(workspaceDetailSchema.parse(response.json())).toMatchObject({
      organisation: { id: acmeId, slug: 'acme', name: 'Acme Robotics' },
      memberCount: 6,
      role: { key: 'reviewer' },
    });
  });
});

describe('renaming the workspace', () => {
  const rename = (cookie: string, payload: unknown) =>
    call({ method: 'PATCH', url: `/api/v1/orgs/${acmeId}`, payload: payload as object, cookie });

  it('lets an owner rename it, persists it and audits before and after', async () => {
    const response = await rename(await ctx.cookieFor('owner'), { name: '  Acme Robotics Ltd  ' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: acmeId, slug: 'acme', name: 'Acme Robotics Ltd' });

    const [row] = await ctx.db.select().from(organisations).where(eq(organisations.id, acmeId));
    expect(row?.name).toBe('Acme Robotics Ltd');
    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'workspace.renamed'));
    expect(event).toMatchObject({
      organisationId: acmeId,
      actorUserId: userIds.owner,
      before: { name: 'Acme Robotics' },
      after: { name: 'Acme Robotics Ltd' },
      source: 'user',
      outcome: 'success',
    });
  });

  it.each([
    ['blank', { name: '   ' }],
    ['too long', { name: 'x'.repeat(81) }],
    ['carrying a slug', { name: 'Acme', slug: 'hijack' }],
    ['missing', {}],
  ])('refuses a %s name with 422 and changes nothing', async (_label, payload) => {
    const response = await rename(await ctx.cookieFor('owner'), payload);
    expect(response.statusCode).toBe(422);
    const [row] = await ctx.db.select().from(organisations).where(eq(organisations.id, acmeId));
    expect(row).toMatchObject({ name: 'Acme Robotics', slug: 'acme' });
  });

  it('refuses a developer', async () => {
    const response = await rename(await ctx.cookieFor('developer'), { name: 'Mine now' });
    expect(response.statusCode).toBe(403);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('forbidden');
  });
});

describe('changing a member’s role', () => {
  const change = (cookie: string, userId: string, payload: unknown, orgId = acmeId) =>
    call({
      method: 'PATCH',
      url: `/api/v1/orgs/${orgId}/members/${userId}`,
      payload: payload as object,
      cookie,
    });
  const roleOf = async (userId: string) =>
    (
      await ctx.db
        .select({ key: roles.key })
        .from(organisationMemberships)
        .innerJoin(roles, eq(roles.id, organisationMemberships.roleId))
        .where(
          and(
            eq(organisationMemberships.userId, userId),
            eq(organisationMemberships.organisationId, acmeId),
          ),
        )
    )[0]!.key;

  it('lets an owner move a developer to reviewer and records it', async () => {
    const response = await change(await ctx.cookieFor('owner'), userIds.developer!, {
      roleId: acmeRoleIds.reviewer,
    });
    expect(response.statusCode).toBe(200);
    expect(memberSchema.parse(response.json()).role.key).toBe('reviewer');
    expect(await roleOf(userIds.developer!)).toBe('reviewer');

    const listed = await call({
      method: 'GET',
      url: `/api/v1/orgs/${acmeId}/members`,
      cookie: await ctx.cookieFor('owner'),
    });
    const dana = memberSchema
      .array()
      .parse(listed.json())
      .find((m) => m.user.id === userIds.developer);
    expect(dana?.role.key).toBe('reviewer');

    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'member.role.changed'));
    expect(event).toMatchObject({
      organisationId: acmeId,
      actorUserId: userIds.owner,
      targetType: 'user',
      targetId: userIds.developer,
      before: { roleKey: 'developer' },
      after: { roleKey: 'reviewer' },
      source: 'user',
      outcome: 'success',
    });
  });

  it('lets an administrator make the same change', async () => {
    const response = await change(await ctx.cookieFor('admin'), userIds.developer!, {
      roleId: acmeRoleIds.reviewer,
    });
    expect(response.statusCode).toBe(200);
  });

  it('stops an administrator granting the owner role, and audits the attempt', async () => {
    const response = await change(await ctx.cookieFor('admin'), userIds.developer!, {
      roleId: acmeRoleIds.owner,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toMatch(/owner/i);
    expect(await roleOf(userIds.developer!)).toBe('developer');

    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'member.role.changed'));
    expect(event).toMatchObject({ outcome: 'denied', actorUserId: userIds.admin });
  });

  it('stops an administrator demoting the owner', async () => {
    const response = await change(await ctx.cookieFor('admin'), userIds.owner!, {
      roleId: acmeRoleIds.developer,
    });
    expect(response.statusCode).toBe(403);
    expect(await roleOf(userIds.owner!)).toBe('owner');
  });

  it('stops anyone changing their own role', async () => {
    const owner = await change(await ctx.cookieFor('owner'), userIds.owner!, {
      roleId: acmeRoleIds.developer,
    });
    expect(owner.statusCode).toBe(403);
    expect(owner.json().error.message).toMatch(/own role/i);

    const developer = await change(await ctx.cookieFor('developer'), userIds.developer!, {
      roleId: acmeRoleIds.owner,
    });
    expect(developer.statusCode).toBe(403);
    expect(await roleOf(userIds.developer!)).toBe('developer');
  });

  it.each([
    [
      'a smuggled role field',
      (ids: Record<string, string>) => ({ roleId: ids.reviewer, role: 'owner' }),
    ],
    ['a smuggled userId', (ids: Record<string, string>) => ({ roleId: ids.reviewer, userId: 'x' })],
    ['a non-uuid role id', () => ({ roleId: 'owner' })],
    ['no role id', () => ({})],
  ])('refuses %s with 422 and changes nothing', async (_label, body) => {
    const response = await change(
      await ctx.cookieFor('owner'),
      userIds.developer!,
      body(acmeRoleIds),
    );
    expect(response.statusCode).toBe(422);
    expect(await roleOf(userIds.developer!)).toBe('developer');
  });

  it('refuses a role id from another workspace', async () => {
    const response = await change(await ctx.cookieFor('owner'), userIds.developer!, {
      roleId: northwindRoleIds.owner,
    });
    expect(response.statusCode).toBe(422);
    expect(await roleOf(userIds.developer!)).toBe('developer');
  });

  it('refuses a role id that does not exist', async () => {
    const response = await change(await ctx.cookieFor('owner'), userIds.developer!, {
      roleId: '01a1656b-1a49-7146-94ac-1c72df43ddb4',
    });
    expect(response.statusCode).toBe(422);
  });

  it('treats a member of another workspace, or a bad user id, as not found', async () => {
    const owner = await ctx.cookieFor('owner');
    const outsider = await change(owner, userIds['other-owner']!, { roleId: acmeRoleIds.reviewer });
    expect(outsider.statusCode).toBe(404);
    const garbage = await change(owner, 'not-a-uuid', { roleId: acmeRoleIds.reviewer });
    expect(garbage.statusCode).toBe(404);
  });

  it('lets an owner share ownership and later step the other owner down, never leaving none', async () => {
    const owner = await ctx.cookieFor('owner');
    expect((await change(owner, userIds.admin!, { roleId: acmeRoleIds.owner })).statusCode).toBe(
      200,
    );
    expect((await change(owner, userIds.admin!, { roleId: acmeRoleIds.admin })).statusCode).toBe(
      200,
    );
    const owners = await ctx.db
      .select()
      .from(organisationMemberships)
      .where(
        and(
          eq(organisationMemberships.organisationId, acmeId),
          eq(organisationMemberships.roleId, acmeRoleIds.owner!),
        ),
      );
    expect(owners).toHaveLength(1);
  });
});
