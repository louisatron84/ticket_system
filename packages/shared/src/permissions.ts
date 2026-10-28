import { z } from 'zod';

/** Every capability a role can grant. Permissions are code; roles (sets of keys) are data. */
export const PERMISSIONS = [
  'workspace.view',
  'workspace.manage',
  'members.view',
  'members.manage',
  'roles.manage',
  'audit.view',
  'projects.manage',
  'tickets.view',
  'tickets.create',
  'tickets.edit',
  'tickets.assign',
  'tickets.comment',
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
      'tickets.comment',
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
      'tickets.comment',
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

/** What each permission lets a person do, in words for screens. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'workspace.view': 'See the workspace',
  'workspace.manage': 'Rename and manage the workspace',
  'members.view': 'See who the members are',
  'members.manage': 'Add, remove and change members',
  'roles.manage': 'Create and change roles',
  'audit.view': 'Read the audit log',
  'projects.manage': 'Create, change and archive projects',
  'tickets.view': 'See tickets and boards',
  'tickets.create': 'Create tickets',
  'tickets.edit': 'Change, move and archive tickets',
  'tickets.assign': 'Assign tickets to people',
  'tickets.comment': 'Comment on tickets',
  'fields.manage': 'Manage custom fields',
  'workflows.configure': 'Change workflows',
  'repositories.connect': 'Connect repositories',
  'branches.create': 'Create branches',
  'reviews.submit': 'Review changes',
  'reviews.approve': 'Approve changes',
  'pullRequests.merge': 'Merge changes',
};
