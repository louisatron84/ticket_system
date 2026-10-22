import { organisationMemberships, organisations, roles, type Db } from '@forge/db';
import { PERMISSIONS, type Permission, type Viewer } from '@forge/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/guards';
import { loadPreferences } from '../preferences';

const KNOWN_PERMISSIONS = new Set<string>(PERMISSIONS);
const isPermission = (value: string): value is Permission => KNOWN_PERMISSIONS.has(value);

export function registerMeRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  app.get('/api/v1/me', { preHandler: requireUser }, async (request): Promise<Viewer> => {
    const { user } = request.auth!;

    const rows = await db
      .select({
        organisationId: organisations.id,
        slug: organisations.slug,
        organisationName: organisations.name,
        roleId: roles.id,
        roleKey: roles.key,
        roleName: roles.name,
        permissions: roles.permissions,
      })
      .from(organisationMemberships)
      .innerJoin(organisations, eq(organisations.id, organisationMemberships.organisationId))
      .innerJoin(roles, eq(roles.id, organisationMemberships.roleId))
      .where(eq(organisationMemberships.userId, user.id))
      .orderBy(asc(organisations.name));

    return {
      user,
      memberships: rows.map((row) => ({
        organisation: { id: row.organisationId, slug: row.slug, name: row.organisationName },
        role: { id: row.roleId, key: row.roleKey, name: row.roleName },
        // A permission this build does not know (from a newer role definition) grants nothing.
        permissions: row.permissions.filter(isPermission),
      })),
      preferences: await loadPreferences(db, user.id),
    };
  });
}
