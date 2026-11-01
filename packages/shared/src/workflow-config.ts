import { z } from 'zod';
import { singleLineText } from './text';
import {
  PROJECT_KEY_PATTERN,
  STATUS_CATEGORIES,
  TRANSITION_RULES,
  type StatusCategory,
  type TransitionRule,
} from './tickets';

// Workflow editing (P4): a project's statuses and the moves between them, as an administrator
// with `workflows.configure` sees and changes them. See docs/workflows.md.

/** A status name: one line, 1 to 40 characters, unique in its project ignoring case. */
export const STATUS_NAME_MAX = 40;
const statusName = singleLineText(STATUS_NAME_MAX);

// The longest key made from a name, leaving room for a "-99" when it clashes.
const KEY_BASE_MAX = 36;

/**
 * The key a new status gets from its name: lower case, letters and digits, other runs as one
 * underscore ("Ready for QA" is `ready_for_qa`). A key already in `taken` gets `-2`, `-3` and so
 * on. A name with no letters or digits at all becomes `status`. Keys never change afterwards.
 */
export function statusKeyFromName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, KEY_BASE_MAX)
      .replace(/_+$/, '') || 'status';
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const key = `${base}-${n}`;
    if (!used.has(key)) return key;
  }
}

/**
 * The active statuses a ticket could get stuck in: not completed, and with no allowed move to
 * another active status. Allowed, but the editor warns about them.
 */
export function statusesWithoutWayOut<
  S extends { id: string; category: StatusCategory; active: boolean },
>(
  statuses: readonly S[],
  transitions: readonly { fromStatusId: string; toStatusId: string }[],
): S[] {
  const active = new Set(statuses.filter((status) => status.active).map((status) => status.id));
  const leaves = new Set(
    transitions
      .filter((t) => active.has(t.fromStatusId) && active.has(t.toStatusId))
      .map((t) => t.fromStatusId),
  );
  return statuses.filter(
    (status) => status.active && status.category !== 'completed' && !leaves.has(status.id),
  );
}

export const STATUS_CATEGORY_LABELS: Record<StatusCategory, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

export const TRANSITION_RULE_LABELS: Record<TransitionRule, string> = {
  needs_assignee: 'Needs an assignee',
  needs_estimate: 'Needs an estimate',
  needs_comment: 'Needs a comment',
  no_open_blockers: 'No open blockers',
};

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const createStatusBodySchema = z.strictObject({
  name: statusName,
  category: z.enum(STATUS_CATEGORIES),
});
export type CreateStatusBody = z.infer<typeof createStatusBodySchema>;

/** `initial: true` makes this the status new tickets start in; the flag moves from the old one. */
export const updateStatusBodySchema = z
  .strictObject({
    name: statusName.optional(),
    category: z.enum(STATUS_CATEGORIES).optional(),
    initial: z.literal(true).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');
export type UpdateStatusBody = z.infer<typeof updateStatusBodySchema>;

/** Every status of the project, active or not, each once, in the new order. */
export const reorderStatusesBodySchema = z.strictObject({
  statusIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Each status may be listed only once.'),
});
export type ReorderStatusesBody = z.infer<typeof reorderStatusesBodySchema>;

/** Where the status's tickets go. Needed only when it has tickets. */
export const deactivateStatusBodySchema = z.strictObject({
  destinationStatusId: z.uuid().optional(),
});
export type DeactivateStatusBody = z.infer<typeof deactivateStatusBodySchema>;

/**
 * The whole grid between active statuses, saved at once. `version` is the workflow version the
 * person was looking at. Moves to or from inactive statuses are kept as they are.
 */
export const saveTransitionsBodySchema = z.strictObject({
  version: z.number().int().min(0),
  transitions: z
    .array(
      z.strictObject({
        fromStatusId: z.uuid(),
        toStatusId: z.uuid(),
        rules: z
          .array(z.enum(TRANSITION_RULES))
          .refine((rules) => new Set(rules).size === rules.length, 'Each rule may be listed once.')
          .default([]),
      }),
    )
    .max(2500),
});
export type SaveTransitionsBody = z.infer<typeof saveTransitionsBodySchema>;

export const copyWorkflowBodySchema = z.strictObject({
  sourceProjectKey: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(PROJECT_KEY_PATTERN, 'That is not a project key.')),
});
export type CopyWorkflowBody = z.infer<typeof copyWorkflowBodySchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const workflowStatusSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  category: z.enum(STATUS_CATEGORIES),
  sortOrder: z.number().int(),
  initial: z.boolean(),
  active: z.boolean(),
  /** A completed status meaning "won't do" (Scrapped). */
  cancellation: z.boolean(),
  /** Tickets in it, archived ones included: deactivating it needs a destination for them. */
  ticketCount: z.number().int().nonnegative(),
});
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;

/** A project's whole workflow as its editor sees it: inactive statuses too. */
export const workflowConfigSchema = z.object({
  projectId: z.uuid(),
  projectKey: z.string(),
  archived: z.boolean(),
  /** Bumped by every change; the transitions grid is saved against it. */
  version: z.number().int().nonnegative(),
  statuses: z.array(workflowStatusSchema),
  /** Every allowed move, those touching inactive statuses included. */
  transitions: z.array(
    z.object({
      fromStatusId: z.uuid(),
      toStatusId: z.uuid(),
      rules: z.array(z.enum(TRANSITION_RULES)),
    }),
  ),
});
export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;
