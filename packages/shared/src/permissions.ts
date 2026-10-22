import { z } from 'zod';

/** Every capability a role can grant. Permissions are code; roles (sets of keys) are data. */
export const PERMISSIONS = [
  'workspace.view',
  'workspace.manage',
  'members.view',
  'members.manage',
  'roles.manage',
  'audit.view',
  'tickets.view',
  'tickets.create',
  'tickets.edit',
  'tickets.assign',
  'fields.manage',
  'workflows.configure',
  'repositories.connect',
  'branches.create',
  'reviews.submit',
  'reviews.approve',
  'pullRequests.merge',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const permissionSchema = z.enum(PERMISSIONS);

export const SYSTEM_ROLE_KEYS = ['owner', 'admin', 'developer', 'reviewer', 'readonly'] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export type RoleDefinition = {
  key: string;
  name: string;
  description: string;
  permissions: readonly Permission[];
};

/** Created for every organisation. Owner and admin differ by rules (see role-rules.ts), not keys. */
export const SYSTEM_ROLES: Record<SystemRoleKey, RoleDefinition> = {
  owner: {
    key: 'owner',
    name: 'Owner',
    description: 'Full control of the workspace, including who else is an owner.',
    permissions: PERMISSIONS,
  },
  admin: {
    key: 'admin',
    name: 'Administrator',
    description: 'Configures the workspace and manages members, except owners.',
    permissions: PERMISSIONS,
  },
  developer: {
    key: 'developer',
    name: 'Developer',
    description: 'Works tickets and branches and submits reviews.',
    permissions: [
      'workspace.view',
      'members.view',
      'tickets.view',
      'tickets.create',
      'tickets.edit',
      'tickets.assign',
      'branches.create',
      'reviews.submit',
    ],
  },
  reviewer: {
    key: 'reviewer',
    name: 'Reviewer',
    description: 'Reviews and approves changes and merges pull requests.',
    permissions: [
      'workspace.view',
      'members.view',
      'tickets.view',
      'reviews.submit',
      'reviews.approve',
      'pullRequests.merge',
    ],
  },
  readonly: {
    key: 'readonly',
    name: 'Read-only',
    description: 'Can look but not change anything.',
    permissions: ['workspace.view', 'members.view', 'tickets.view'],
  },
};

export function hasPermission(held: readonly string[], needed: Permission): boolean {
  return held.includes(needed);
}
