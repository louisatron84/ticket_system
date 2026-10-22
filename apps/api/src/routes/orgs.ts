import {
  organisationMemberships,
  organisations,
  roles,
  users,
  type Db,
  type Executor,
} from '@forge/db';
import {
  PERMISSIONS,
  decideRoleChange,
  renameOrganisationBodySchema,
  updateMemberRoleBodySchema,
  type Member,
  type OrganisationSummary,
  type Permission,
  type RoleChangeDenial,
  type RoleDetail,
  type WorkspaceDetail,
} from '@forge/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { loadMembership } from '../auth/membership';
import { orgAccess } from '../auth/guards';
import { AppError } from '../errors';
import { parseBody } from '../validation';

const KNOWN_PERMISSIONS = new Set<string>(PERMISSIONS);
const isPermission = (value: string): value is Permission => KNOWN_PERMISSIONS.has(value);

const DENIAL_MESSAGES: Record<RoleChangeDenial, string> = {
  missing_permission: "You don't have permission to change roles.",
  cannot_change_own_role: "You can't change your own role. Ask another administrator.",
  owner_required: 'Only an owner can grant or remove the owner role.',
  exceeds_own_permissions: "You can't assign a role with more permissions than you have.",
  last_owner: 'A workspace must keep at least one owner.',
};

/** A refused role change, remembered so the attempt can be audited after the transaction ends. */
class RoleChangeDenied extends AppError {
  constructor(public readonly reason: RoleChangeDenial) {
    super(
      reason === 'last_owner' ? 'conflict' : 'forbidden',
      DENIAL_MESSAGES[reason],
      reason === 'last_owner' ? 409 : 403,
    );
  }
}

const notFound = (message = 'Not found.') => new AppError('not_found', message, 404);

async function loadMemberView(
  executor: Executor,
  organisationId: string,
  userId: string,
): Promise<Member | null> {
  const [row] = await executor
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      joinedAt: organisationMemberships.createdAt,
    })
    .from(organisationMemberships)
    .innerJoin(users, eq(users.id, organisationMemberships.userId))
    .innerJoin(roles, eq(roles.id, organisationMemberships.roleId))
    .where(
      and(
        eq(organisationMemberships.organisationId, organisationId),
        eq(organisationMemberships.userId, userId),
      ),
    );
  if (!row) return null;
  return {
    user: { id: row.id, email: row.email, displayName: row.displayName },
    role: { id: row.roleId, key: row.roleKey, name: row.roleName },
    joinedAt: row.joinedAt.toISOString(),
  };
}

export function registerOrgRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  app.get(
    '/api/v1/orgs/:orgId',
    { preHandler: orgAccess(db, 'workspace.view') },
    async (request): Promise<WorkspaceDetail> => {
      const org = request.org!;
      const [organisation] = await db
        .select({ id: organisations.id, slug: organisations.slug, name: organisations.name })
        .from(organisations)
        .where(eq(organisations.id, org.organisationId));
      const [count] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(organisationMemberships)
        .where(eq(organisationMemberships.organisationId, org.organisationId));
      if (!organisation) throw notFound();
      return { organisation, memberCount: count?.n ?? 0, role: org.role };
    },
  );

  app.patch(
    '/api/v1/orgs/:orgId',
    { preHandler: orgAccess(db, 'workspace.manage') },
    async (request): Promise<OrganisationSummary> => {
      const { name } = parseBody(renameOrganisationBodySchema, request.body);
      const org = request.org!;

      return db.transaction(async (tx) => {
        const [before] = await tx
          .select({ name: organisations.name })
          .from(organisations)
          .where(eq(organisations.id, org.organisationId))
          .for('update');
        const [after] = await tx
          .update(organisations)
          .set({ name })
          .where(eq(organisations.id, org.organisationId))
          .returning({ id: organisations.id, slug: organisations.slug, name: organisations.name });
        if (!before || !after) throw notFound();

        await recordAudit(tx, {
          organisationId: org.organisationId,
          actorUserId: org.actorUserId,
          action: 'workspace.renamed',
          targetType: 'organisation',
          targetId: org.organisationId,
          before: { name: before.name },
          after: { name: after.name },
          requestId: request.id,
          source: 'user',
          outcome: 'success',
        });
        return after;
      });
    },
  );

  app.get(
    '/api/v1/orgs/:orgId/members',
    { preHandler: orgAccess(db, 'members.view') },
    async (request): Promise<Member[]> => {
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          roleId: roles.id,
          roleKey: roles.key,
          roleName: roles.name,
          joinedAt: organisationMemberships.createdAt,
        })
        .from(organisationMemberships)
        .innerJoin(users, eq(users.id, organisationMemberships.userId))
        .innerJoin(roles, eq(roles.id, organisationMemberships.roleId))
        .where(eq(organisationMemberships.organisationId, request.org!.organisationId))
        .orderBy(asc(users.displayName));
      return rows.map((row) => ({
        user: { id: row.id, email: row.email, displayName: row.displayName },
        role: { id: row.roleId, key: row.roleKey, name: row.roleName },
        joinedAt: row.joinedAt.toISOString(),
      }));
    },
  );

  app.get(
    '/api/v1/orgs/:orgId/roles',
    { preHandler: orgAccess(db, 'members.view') },
    async (request): Promise<RoleDetail[]> => {
      const rows = await db
        .select()
        .from(roles)
        .where(eq(roles.organisationId, request.org!.organisationId))
        .orderBy(desc(roles.isSystem), asc(roles.name));
      return rows.map((row) => ({
        id: row.id,
        key: row.key,
        name: row.name,
        description: row.description,
        permissions: row.permissions.filter(isPermission),
      }));
    },
  );

  app.patch(
    '/api/v1/orgs/:orgId/members/:userId',
    { preHandler: orgAccess(db, 'members.manage') },
    async (request): Promise<Member> => {
      const org = request.org!;
      const { userId } = request.params as { userId: string };
      if (!z.uuid().safeParse(userId).success) throw notFound();
      const { roleId } = parseBody(updateMemberRoleBodySchema, request.body);

      try {
        return await db.transaction(async (tx) => {
          // Serialise role changes per organisation. Everything below is read after the lock, so a
          // concurrent change (for example the other owner demoting this actor) is always seen.
          await tx.execute(
            sql`select 1 from organisations where id = ${org.organisationId} for update`,
          );

          const actor = await loadMembership(tx, org.organisationId, org.actorUserId);
          if (!actor) throw notFound();
          const target = await loadMembership(tx, org.organisationId, userId);
          if (!target) throw notFound('No such member.');

          // The new role must belong to THIS organisation; a role id from another one is unknown.
          const [newRole] = await tx
            .select()
            .from(roles)
            .where(and(eq(roles.id, roleId), eq(roles.organisationId, org.organisationId)));
          if (!newRole) {
            throw new AppError('validation_failed', 'Unknown role.', 422, [
              { path: 'roleId', message: 'No such role in this workspace.' },
            ]);
          }

          const [owners] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(organisationMemberships)
            .innerJoin(roles, eq(roles.id, organisationMemberships.roleId))
            .where(
              and(
                eq(organisationMemberships.organisationId, org.organisationId),
                eq(roles.key, 'owner'),
              ),
            );

          const decision = decideRoleChange({
            actor: { userId: actor.userId, roleKey: actor.roleKey, permissions: actor.permissions },
            target: { userId: target.userId, roleKey: target.roleKey },
            newRole: { key: newRole.key, permissions: newRole.permissions },
            ownerCount: owners?.n ?? 0,
          });
          if (!decision.allowed) throw new RoleChangeDenied(decision.reason);

          await tx
            .update(organisationMemberships)
            .set({ roleId: newRole.id })
            .where(
              and(
                eq(organisationMemberships.organisationId, org.organisationId),
                eq(organisationMemberships.userId, userId),
              ),
            );
          await recordAudit(tx, {
            organisationId: org.organisationId,
            actorUserId: org.actorUserId,
            action: 'member.role.changed',
            targetType: 'user',
            targetId: userId,
            before: { roleKey: target.roleKey },
            after: { roleKey: newRole.key },
            requestId: request.id,
            source: 'user',
            outcome: 'success',
          });

          const member = await loadMemberView(tx, org.organisationId, userId);
          if (!member) throw notFound('No such member.');
          return member;
        });
      } catch (error) {
        // The transaction rolled back, so record the refusal separately.
        if (error instanceof RoleChangeDenied) {
          await recordAudit(db, {
            organisationId: org.organisationId,
            actorUserId: org.actorUserId,
            action: 'member.role.changed',
            targetType: 'user',
            targetId: userId,
            after: { attemptedRoleId: roleId, reason: error.reason },
            requestId: request.id,
            source: 'user',
            outcome: 'denied',
          });
        }
        throw error;
      }
    },
  );
}
