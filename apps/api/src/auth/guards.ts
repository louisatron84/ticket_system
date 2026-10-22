import type { Db } from '@forge/db';
import { hasPermission, type Permission } from '@forge/shared';
import type { preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors';
import { loadMembership } from './membership';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `orgAccess`: the caller's standing in the organisation named by :orgId. */
    org: OrgAccess | null;
  }
}

export type OrgAccess = {
  organisationId: string;
  actorUserId: string;
  role: { id: string; key: string; name: string };
  permissions: string[];
};

const notFound = () => new AppError('not_found', 'Not found.', 404);

/** Route guard: the request must carry a valid session. */
export const requireUser: preHandlerAsyncHookHandler = async (request) => {
  if (!request.auth) throw new AppError('unauthenticated', 'Sign in to continue.', 401);
};

/**
 * Route guard for everything under /api/v1/orgs/:orgId. This is the only place that decides
 * whether a caller may touch an organisation:
 *   - not signed in                         -> 401
 *   - not a member, unknown or malformed id -> 404 (a foreign workspace looks like a missing one)
 *   - member without the permission         -> 403
 * Handlers then take the organisation id from `request.org`, never from the URL or body.
 */
export function orgAccess(db: Db, permission: Permission): preHandlerAsyncHookHandler {
  return async (request) => {
    if (!request.auth) throw new AppError('unauthenticated', 'Sign in to continue.', 401);

    const { orgId } = request.params as { orgId?: string };
    if (!orgId || !z.uuid().safeParse(orgId).success) throw notFound();

    const membership = await loadMembership(db, orgId, request.auth.user.id);
    if (!membership) throw notFound();

    if (!hasPermission(membership.permissions, permission)) {
      throw new AppError('forbidden', "You don't have permission to do that.", 403);
    }

    request.org = {
      organisationId: orgId,
      actorUserId: request.auth.user.id,
      role: { id: membership.roleId, key: membership.roleKey, name: membership.roleName },
      permissions: membership.permissions,
    };
  };
}
