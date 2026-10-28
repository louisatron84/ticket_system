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
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * What a command-line token may ever do: ticket work. Managing the workspace, its members, roles,
 * projects or settings needs a browser session, whatever the owner's role allows.
 */
export const TOKEN_PERMISSIONS: readonly Permission[] = [
  'tickets.view',
  'tickets.create',
  'tickets.edit',
  'tickets.assign',
  'tickets.comment',
];

/** Route guard: the request must carry a valid session. */
export const requireUser: preHandlerAsyncHookHandler = async (request) => {
  if (request.token) {
    throw new AppError('forbidden', 'Command-line tokens cannot be used here.', 403);
  }
  if (!request.auth) throw new AppError('unauthenticated', 'Sign in to continue.', 401);
};

/**
 * Route guard for everything under /api/v1/orgs/:orgId. This is the only place that decides
 * whether a caller may touch an organisation:
 *   - not signed in (no session, no valid token) -> 401
 *   - a token for another workspace          -> 404
 *   - a read-only token asking to change     -> 403
 *   - a token asking for more than ticket work -> 403
 *   - not a member, unknown or malformed id -> 404 (a foreign workspace looks like a missing one)
 *   - member without the permission         -> 403
 * Handlers then take the organisation id from `request.org`, never from the URL or body.
 */
export function orgAccess(db: Db, permission: Permission): preHandlerAsyncHookHandler {
  return async (request) => {
    const { token } = request;
    const userId = request.auth?.user.id ?? token?.userId;
    if (!userId) throw new AppError('unauthenticated', 'Sign in to continue.', 401);

    const { orgId } = request.params as { orgId?: string };
    if (!orgId || !z.uuid().safeParse(orgId).success) throw notFound();

    if (token) {
      // A token belongs to one workspace; any other looks absent, as for a non-member.
      if (token.organisationId !== orgId) throw notFound();
      if (token.scope === 'read' && !SAFE_METHODS.has(request.method)) {
        throw new AppError('forbidden', 'This token is read-only.', 403);
      }
      if (!TOKEN_PERMISSIONS.includes(permission)) {
        throw new AppError(
          'forbidden',
          'Command-line tokens cannot do that. Use the web app.',
          403,
        );
      }
    }

    // Checked on every request, so a token is never worth more than its owner's role now.
    const membership = await loadMembership(db, orgId, userId);
    if (!membership) throw notFound();

    if (!hasPermission(membership.permissions, permission)) {
      throw new AppError('forbidden', "You don't have permission to do that.", 403);
    }

    request.org = {
      organisationId: orgId,
      actorUserId: userId,
      role: { id: membership.roleId, key: membership.roleKey, name: membership.roleName },
      // Checks made later in a handler see only what a token may do.
      permissions: token
        ? membership.permissions.filter((key) => (TOKEN_PERMISSIONS as string[]).includes(key))
        : membership.permissions,
    };
  };
}
