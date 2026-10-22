import { describe, expect, it } from 'vitest';
import {
  devSessionBodySchema,
  preferencesSchema,
  renameOrganisationBodySchema,
  updateMemberRoleBodySchema,
  viewerSchema,
} from './api';

const uuid = '01a1656b-1a49-7146-94ac-1c72df43ddb4';

describe('updateMemberRoleBodySchema', () => {
  it('accepts a role id', () => {
    expect(updateMemberRoleBodySchema.safeParse({ roleId: uuid }).success).toBe(true);
  });

  it.each([
    ['a non-uuid id', { roleId: 'x' }],
    ['an empty body', {}],
    ['a smuggled role field', { roleId: uuid, role: 'owner' }],
    ['a smuggled userId', { roleId: uuid, userId: uuid }],
  ])('rejects %s', (_label, body) => {
    expect(updateMemberRoleBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('renameOrganisationBodySchema', () => {
  it('trims the name', () => {
    expect(renameOrganisationBodySchema.parse({ name: '  Acme  ' })).toEqual({ name: 'Acme' });
  });

  it.each([
    ['blank', { name: '   ' }],
    ['too long', { name: 'x'.repeat(81) }],
    ['carrying extra fields', { name: 'Acme', slug: 'acme' }],
  ])('rejects a name that is %s', (_label, body) => {
    expect(renameOrganisationBodySchema.safeParse(body).success).toBe(false);
  });

  it('accepts the longest allowed name', () => {
    expect(renameOrganisationBodySchema.safeParse({ name: 'x'.repeat(80) }).success).toBe(true);
  });
});

describe('preferencesSchema', () => {
  it('accepts known keys and an empty object', () => {
    expect(preferencesSchema.safeParse({}).success).toBe(true);
    expect(preferencesSchema.safeParse({ sidebarCollapsed: true }).success).toBe(true);
  });

  it('rejects unknown keys and wrong types', () => {
    expect(preferencesSchema.safeParse({ theme: 'light' }).success).toBe(false);
    expect(preferencesSchema.safeParse({ sidebarCollapsed: 'yes' }).success).toBe(false);
  });
});

describe('devSessionBodySchema', () => {
  it('accepts only a key', () => {
    expect(devSessionBodySchema.safeParse({ key: 'admin' }).success).toBe(true);
    expect(devSessionBodySchema.safeParse({ key: 'admin', userId: uuid }).success).toBe(false);
    expect(devSessionBodySchema.safeParse({ userId: uuid }).success).toBe(false);
  });
});

describe('viewerSchema', () => {
  const viewer = {
    user: { id: uuid, email: 'owner@acme.test', displayName: 'Olivia Owner' },
    memberships: [
      {
        organisation: { id: uuid, slug: 'acme', name: 'Acme Robotics' },
        role: { id: uuid, key: 'owner', name: 'Owner' },
        permissions: ['workspace.view', 'members.manage'],
      },
    ],
    preferences: {},
  };

  it('accepts a well-formed viewer', () => {
    expect(viewerSchema.safeParse(viewer).success).toBe(true);
  });

  it('rejects a permission that is not in the registry', () => {
    const bad = structuredClone(viewer);
    bad.memberships[0]!.permissions = ['workspace.view', 'root.everything'];
    expect(viewerSchema.safeParse(bad).success).toBe(false);
  });
});
