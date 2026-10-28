import { z } from 'zod';
import { singleLineText } from './text';

// Triage: tickets that need a decision before they join the board, decided by two people.

export const TRIAGE_STATES = ['waiting', 'proposed', 'snoozed'] as const;
export type TriageState = (typeof TRIAGE_STATES)[number];

/** Decisions that need a second person's approval. Snooze is not one: it is easy to undo. */
export const TRIAGE_ACTIONS = ['accept', 'accept_warming', 'duplicate', 'decline'] as const;
export type TriageAction = (typeof TRIAGE_ACTIONS)[number];

export const TRIAGE_ACTION_LABELS: Record<TriageAction, string> = {
  accept: 'Accept',
  accept_warming: 'Accept to Warming',
  duplicate: 'Duplicate',
  decline: 'Decline',
};

/** Accepting may fill in the ticket as it joins the board. */
const acceptDetails = z.strictObject({
  assigneeId: z.uuid().nullable().optional(),
  priorityId: z.uuid().optional(),
  labelIds: z.array(z.uuid()).max(20).optional(),
});

export const proposeBodySchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('accept'), details: acceptDetails.default({}) }),
  z.strictObject({ action: z.literal('accept_warming'), details: acceptDetails.default({}) }),
  z.strictObject({
    action: z.literal('duplicate'),
    details: z.strictObject({ originalKey: z.string().max(20) }),
  }),
  z.strictObject({
    action: z.literal('decline'),
    details: z.strictObject({ reason: singleLineText(300) }),
  }),
]);
export type ProposeBody = z.infer<typeof proposeBodySchema>;

export const decideBodySchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('approve') }),
  z.strictObject({ decision: z.literal('reject'), note: singleLineText(300) }),
]);
export type DecideBody = z.infer<typeof decideBodySchema>;

export const snoozeBodySchema = z.strictObject({
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the form YYYY-MM-DD.')
    .refine(
      (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
      'That date does not exist.',
    ),
});

export const triageProposalSchema = z.object({
  id: z.uuid(),
  action: z.enum(TRIAGE_ACTIONS),
  /** In words, e.g. "Accept, assign to Dana, priority Blaze". */
  summary: z.string(),
  details: z.record(z.string(), z.unknown()),
  proposedBy: z.object({ id: z.uuid(), displayName: z.string() }),
  createdAt: z.string(),
});
export type TriageProposal = z.infer<typeof triageProposalSchema>;

export const triageInfoSchema = z.object({
  state: z.enum(TRIAGE_STATES),
  snoozedUntil: z.string().nullable(),
  proposal: triageProposalSchema.nullable(),
});
export type TriageInfo = z.infer<typeof triageInfoSchema>;

// ---------------------------------------------------------------------------
// Arrival rules and the rota
// ---------------------------------------------------------------------------

export const triageRuleConditionsSchema = z
  .strictObject({
    typeKey: z.string().max(40).optional(),
    labelId: z.uuid().optional(),
    /** Every word must appear in the title, in any case. */
    titleWords: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    reporterId: z.uuid().optional(),
  })
  .refine((c) => Object.values(c).some((v) => v !== undefined), 'A rule needs a condition.');
export type TriageRuleConditions = z.infer<typeof triageRuleConditionsSchema>;

export const triageRuleActionsSchema = z
  .strictObject({
    assigneeId: z.uuid().optional(),
    priorityId: z.uuid().optional(),
    addLabelIds: z.array(z.uuid()).max(20).optional(),
    triagerId: z.uuid().optional(),
  })
  .refine((a) => Object.values(a).some((v) => v !== undefined), 'A rule needs something to set.');
export type TriageRuleActions = z.infer<typeof triageRuleActionsSchema>;

export const triageRuleBodySchema = z.strictObject({
  name: singleLineText(80),
  conditions: triageRuleConditionsSchema,
  actions: triageRuleActionsSchema,
});
export type TriageRuleBody = z.infer<typeof triageRuleBodySchema>;

export const triageRuleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  conditions: z.record(z.string(), z.unknown()),
  actions: z.record(z.string(), z.unknown()),
});
export type TriageRule = z.infer<typeof triageRuleSchema>;

/** The whole settings for a project's triage, replaced in one go. */
export const triageSettingsBodySchema = z.strictObject({
  enabled: z.boolean(),
  /** Member ids, in rota order; empty means no rota. */
  rota: z
    .array(z.uuid())
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, 'Each person may appear once.'),
  /** In order; the first that matches applies. */
  rules: z.array(triageRuleBodySchema).max(20),
});
export type TriageSettingsBody = z.infer<typeof triageSettingsBodySchema>;

export const triageSettingsSchema = z.object({
  enabled: z.boolean(),
  rota: z.array(z.object({ id: z.uuid(), displayName: z.string() })),
  onDuty: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  rules: z.array(triageRuleSchema),
});
export type TriageSettings = z.infer<typeof triageSettingsSchema>;

const WEEK_MS = 7 * 86_400_000;
/** Mondays: 1970-01-05 was a Monday. */
const FIRST_MONDAY_MS = Date.UTC(1970, 0, 5);

/** Who is on duty at this moment: the rota turns every Monday 00:00 UTC. */
export function onDutyIndex(length: number, now: Date): number | null {
  if (length === 0) return null;
  const weeks = Math.floor((now.getTime() - FIRST_MONDAY_MS) / WEEK_MS);
  return ((weeks % length) + length) % length;
}

/** True when every condition of a rule holds for the arriving ticket. */
export function ruleMatches(
  conditions: TriageRuleConditions,
  ticket: { typeKey: string; labelIds: string[]; title: string; reporterId: string },
): boolean {
  if (conditions.typeKey !== undefined && conditions.typeKey !== ticket.typeKey) return false;
  if (conditions.labelId !== undefined && !ticket.labelIds.includes(conditions.labelId)) {
    return false;
  }
  if (conditions.reporterId !== undefined && conditions.reporterId !== ticket.reporterId) {
    return false;
  }
  if (conditions.titleWords) {
    const title = ticket.title.toLowerCase();
    if (!conditions.titleWords.every((word) => title.includes(word.toLowerCase()))) return false;
  }
  return true;
}
