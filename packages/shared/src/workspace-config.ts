import { z } from 'zod';
import { singleLineText } from './text';
import { LABEL_COLORS, labelSchema } from './tickets';

// Workspace ticket settings: types, priorities, labels and components (P4). Types and priorities
// are never deleted (tickets and their history name them), only deactivated; labels are tags, so
// they can be merged or deleted for real.

const TYPE_NAME_LIMIT = 40;
const PRIORITY_NAME_LIMIT = 40;
const KEY_LIMIT = 40;

/**
 * The key a new type or priority gets from its name: lower case, ASCII letters and digits joined
 * by dashes (`Support request` -> `support-request`), `-2`, `-3` … on a clash with `taken`, and
 * `fallback` when nothing usable is left (a name in another script). Keys never change after,
 * because filters, saved views and the CLI use them.
 */
export function settingKeyFromName(
  name: string,
  taken: Iterable<string>,
  fallback: string,
): string {
  const base =
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, KEY_LIMIT)
      .replace(/-+$/, '') || fallback;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, KEY_LIMIT - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * What a picker offers: the active choices, plus the one the ticket has now even if it has been
 * deactivated since, so the current value still shows (and stays selected).
 */
export function offeredChoices<T extends { id: string; active: boolean }>(
  items: readonly T[],
  currentId?: string | null,
): T[] {
  return items.filter((item) => item.active || item.id === currentId);
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const createTicketTypeBodySchema = z.strictObject({ name: singleLineText(TYPE_NAME_LIMIT) });
export type CreateTicketTypeBody = z.infer<typeof createTicketTypeBodySchema>;

export const updateTicketTypeBodySchema = z
  .strictObject({
    name: singleLineText(TYPE_NAME_LIMIT).optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');
export type UpdateTicketTypeBody = z.infer<typeof updateTicketTypeBodySchema>;

export const createPriorityBodySchema = z.strictObject({
  name: singleLineText(PRIORITY_NAME_LIMIT),
});
export type CreatePriorityBody = z.infer<typeof createPriorityBodySchema>;

export const updatePriorityBodySchema = z
  .strictObject({
    name: singleLineText(PRIORITY_NAME_LIMIT).optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');
export type UpdatePriorityBody = z.infer<typeof updatePriorityBodySchema>;

/**
 * Every type (or priority) of the workspace, each once, in the new order. Priorities are listed
 * from least to most urgent: the last is the most urgent.
 */
export const reorderSettingsBodySchema = z.strictObject({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'Each one may be listed only once.'),
});
export type ReorderSettingsBody = z.infer<typeof reorderSettingsBodySchema>;

export const updateLabelBodySchema = z
  .strictObject({ name: singleLineText(40).optional(), color: z.enum(LABEL_COLORS).optional() })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');
export type UpdateLabelBody = z.infer<typeof updateLabelBodySchema>;

/** Merges the label in the address into this one: its tickets get this label, then it goes. */
export const mergeLabelBodySchema = z.strictObject({ intoId: z.uuid() });
export type MergeLabelBody = z.infer<typeof mergeLabelBodySchema>;

/** A lead and a default assignee are members who can see tickets; null clears them. */
export const updateComponentBodySchema = z
  .strictObject({
    name: singleLineText(60).optional(),
    active: z.boolean().optional(),
    leadId: z.uuid().nullable().optional(),
    defaultAssigneeId: z.uuid().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');
export type UpdateComponentBody = z.infer<typeof updateComponentBodySchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const ticketCount = z.number().int().nonnegative();

export const ticketTypeSettingSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  active: z.boolean(),
  /** Tickets of this type, archived ones included. */
  ticketCount,
});
export type TicketTypeSetting = z.infer<typeof ticketTypeSettingSchema>;

export const prioritySettingSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  /** Higher is more urgent. */
  rank: z.number().int(),
  active: z.boolean(),
  ticketCount,
});
export type PrioritySetting = z.infer<typeof prioritySettingSchema>;

export const labelSettingSchema = labelSchema.extend({
  /** Tickets carrying it, archived ones included: what a merge moves and a delete removes. */
  ticketCount,
});
export type LabelSetting = z.infer<typeof labelSettingSchema>;

/** The workspace ticket settings page: types in order, priorities least urgent first, labels. */
export const workspaceTicketSettingsSchema = z.object({
  types: z.array(ticketTypeSettingSchema),
  priorities: z.array(prioritySettingSchema),
  labels: z.array(labelSettingSchema),
});
export type WorkspaceTicketSettings = z.infer<typeof workspaceTicketSettingsSchema>;

export const labelMergeResultSchema = z.object({
  /** The label that remains. */
  label: labelSchema,
  /** Tickets that had the merged label. */
  ticketCount,
});
export type LabelMergeResult = z.infer<typeof labelMergeResultSchema>;

export const labelDeleteResultSchema = z.object({
  /** Tickets the label was removed from. */
  ticketCount,
});
export type LabelDeleteResult = z.infer<typeof labelDeleteResultSchema>;

const personRef = z.object({ id: z.uuid(), displayName: z.string() });

export const componentSettingSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  active: z.boolean(),
  lead: personRef.nullable(),
  defaultAssignee: personRef.nullable(),
  ticketCount,
});
export type ComponentSetting = z.infer<typeof componentSettingSchema>;

export const projectComponentSettingsSchema = z.object({
  components: z.array(componentSettingSchema),
  /** Who may be a lead or a default assignee: members who can see tickets. */
  people: z.array(personRef),
});
export type ProjectComponentSettings = z.infer<typeof projectComponentSettingsSchema>;
