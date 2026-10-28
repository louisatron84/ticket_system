import { z } from 'zod';
import { boardColumnPrefsSchema, boardColumnsSchema, boardDisplaySchema } from './board-display';
import { notificationPrefsSchema } from './notifications';
import { permissionSchema } from './permissions';

export const preferencesSchema = z.strictObject({
  sidebarCollapsed: z.boolean().optional(),
  board: boardDisplaySchema.optional(),
  boardColumns: boardColumnsSchema.optional(),
  /** The column choice for the Tickets page's board, which spans projects. Null resets it. */
  ticketsBoardColumns: boardColumnPrefsSchema.nullable().optional(),
  /** Kinds of notification switched off (or back on). Missing means on. */
  notifications: notificationPrefsSchema.optional(),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export const userSummarySchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const organisationSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
});
export type OrganisationSummary = z.infer<typeof organisationSummarySchema>;

export const roleSummarySchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
});
export type RoleSummary = z.infer<typeof roleSummarySchema>;

export const roleDetailSchema = roleSummarySchema.extend({
  description: z.string(),
  permissions: z.array(permissionSchema),
});
export type RoleDetail = z.infer<typeof roleDetailSchema>;

export const membershipSchema = z.object({
  organisation: organisationSummarySchema,
  role: roleSummarySchema,
  permissions: z.array(permissionSchema),
});
export type Membership = z.infer<typeof membershipSchema>;

/** Who is signed in, which workspaces they belong to and what they may do in each. */
export const viewerSchema = z.object({
  user: userSummarySchema,
  memberships: z.array(membershipSchema),
  preferences: preferencesSchema,
});
export type Viewer = z.infer<typeof viewerSchema>;

export const workspaceDetailSchema = z.object({
  organisation: organisationSummarySchema,
  memberCount: z.number().int().nonnegative(),
  role: roleSummarySchema,
});
export type WorkspaceDetail = z.infer<typeof workspaceDetailSchema>;

export const memberSchema = z.object({
  user: userSummarySchema,
  role: roleSummarySchema,
  joinedAt: z.string(),
});
export type Member = z.infer<typeof memberSchema>;

export const updateMemberRoleBodySchema = z.strictObject({ roleId: z.uuid() });
export type UpdateMemberRoleBody = z.infer<typeof updateMemberRoleBodySchema>;

export const renameOrganisationBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
});
export type RenameOrganisationBody = z.infer<typeof renameOrganisationBodySchema>;

/** A seeded test identity, as listed by the development-only switcher. */
export const devIdentitySchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  email: z.string(),
  displayName: z.string(),
});
export type DevIdentity = z.infer<typeof devIdentitySchema>;

export const devSessionBodySchema = z.strictObject({ key: z.string().min(1).max(64) });
export type DevSessionBody = z.infer<typeof devSessionBodySchema>;
