import { organisationMemberships, organisations, roles, users } from '@forge/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIntegration, type Integration } from '../test-support/integration';

let ctx: Integration;

beforeAll(async () => {
  ctx = await startIntegration();
});

afterAll(async () => {
  await ctx.close();
});

describe('two owners demoting each other at the same moment', () => {
  it('always leaves exactly one owner and never fails with a server error', async () => {
    const [acme] = await ctx.db.select().from(organisations).where(eq(organisations.slug, 'acme'));
    const acmeId = acme!.id;
    const roleRows = await ctx.db.select().from(roles).where(eq(roles.organisationId, acmeId));
    const roleId = (key: string) => roleRows.find((r) => r.key === key)!.id;
    const userId = async (email: string) =>
      (await ctx.db.select().from(users).where(eq(users.email, email)))[0]!.id;
    const olivia = await userId('owner@acme.test');
    const adam = await userId('admin@acme.test');

    const olivia$ = await ctx.cookieFor('owner');
    const adam$ = await ctx.cookieFor('admin');
    const setRole = (id: string, key: string) =>
      ctx.db
        .update(organisationMemberships)
        .set({ roleId: roleId(key) })
        .where(
          and(
            eq(organisationMemberships.organisationId, acmeId),
            eq(organisationMemberships.userId, id),
          ),
        );
    const demote = (cookie: string, targetId: string) =>
      ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/orgs/${acmeId}/members/${targetId}`,
        payload: { roleId: roleId('developer') },
        headers: { cookie },
      });

    for (let round = 0; round < 20; round += 1) {
      // Both are owners, then each tries to demote the other simultaneously.
      await setRole(olivia, 'owner');
      await setRole(adam, 'owner');
      const [a, b] = await Promise.all([demote(olivia$, adam), demote(adam$, olivia)]);

      const statuses = [a.statusCode, b.statusCode].sort();
      expect(statuses, `round ${round}`).toEqual([200, 403]);

      const owners = await ctx.db
        .select()
        .from(organisationMemberships)
        .where(
          and(
            eq(organisationMemberships.organisationId, acmeId),
            eq(organisationMemberships.roleId, roleId('owner')),
          ),
        );
      expect(owners, `round ${round}`).toHaveLength(1);
    }
  });
});
