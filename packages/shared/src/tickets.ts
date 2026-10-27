import { z } from 'zod';
import { ERROR_CODES } from './errors';

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

/** A status's key: a short lower-case identifier such as in_progress. */
export const STATUS_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

// Checked on the raw input, in ASCII only. Upper-casing first would let characters such as "ß"
// turn into letters that were never typed.
const RAW_TICKET_KEY = /^([A-Za-z][A-Za-z0-9]{1,9})-([1-9][0-9]{0,8})$/;

const RAW_PROJECT_KEY = /^[A-Za-z][A-Za-z0-9]{1,9}$/;

/** Reads a project key from a URL (any case). Null if it could not be a project key. */
export function normalizeProjectKey(input: string): string | null {
  return RAW_PROJECT_KEY.test(input) ? input.toUpperCase() : null;
}

export const formatTicketKey = (projectKey: string, number: number): string =>
  `${projectKey}-${number}`;

/** Minutes as people write them: `45m`, `2h`, `1h 30m`. Null stays null. */
export function formatEstimate(minutes: number | null): string | null {
  if (minutes === null) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Reads `WEB-12` (any case). Returns null for anything that is not exactly a ticket key. */
export function parseTicketKey(input: string): { projectKey: string; number: number } | null {
  const match = RAW_TICKET_KEY.exec(input);
  if (!match) return null;
  return { projectKey: match[1]!.toUpperCase(), number: Number(match[2]) };
}

// ---------------------------------------------------------------------------
// Workflow vocabulary and defaults
// ---------------------------------------------------------------------------

export const STATUS_CATEGORIES = ['not_started', 'in_progress', 'completed'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export const DEFAULT_TICKET_TYPES = [
  { key: 'task', name: 'Task', sortOrder: 1 },
  { key: 'bug', name: 'Bug', sortOrder: 2 },
  { key: 'feature', name: 'Feature', sortOrder: 3 },
  { key: 'improvement', name: 'Improvement', sortOrder: 4 },
  { key: 'epic', name: 'Epic', sortOrder: 5 },
  { key: 'documentation', name: 'Documentation', sortOrder: 6 },
  { key: 'support', name: 'Support request', sortOrder: 7 },
] as const;

/** `rank` orders priorities: higher is more urgent. */
export const DEFAULT_PRIORITIES = [
  { key: 'lowest', name: 'Lowest', rank: 1 },
  { key: 'low', name: 'Low', rank: 2 },
  { key: 'normal', name: 'Normal', rank: 3 },
  { key: 'high', name: 'High', rank: 4 },
  { key: 'critical', name: 'Critical', rank: 5 },
] as const;

type TemplateStatus = {
  key: string;
  name: string;
  category: StatusCategory;
  initial?: true;
};

/** Copied into every new project, which can then diverge from it. */
export const DEFAULT_STATUS_TEMPLATE: {
  statuses: TemplateStatus[];
  transitions: [from: string, to: string][];
} = {
  statuses: [
    { key: 'backlog', name: 'Cold Steel', category: 'not_started', initial: true },
    { key: 'open', name: 'Warming', category: 'not_started' },
    { key: 'in_progress', name: 'In the Forge', category: 'in_progress' },
    { key: 'in_review', name: 'Tempering', category: 'in_progress' },
    { key: 'blocked', name: 'Blocked', category: 'in_progress' },
    { key: 'done', name: 'Quenched', category: 'completed' },
    { key: 'cancelled', name: 'Scrapped', category: 'completed' },
  ],
  transitions: [
    ['backlog', 'open'],
    ['backlog', 'cancelled'],
    ['open', 'in_progress'],
    ['open', 'blocked'],
    ['open', 'backlog'],
    ['open', 'cancelled'],
    ['in_progress', 'in_review'],
    ['in_progress', 'blocked'],
    ['in_progress', 'open'],
    ['in_progress', 'done'],
    ['in_progress', 'cancelled'],
    ['in_review', 'in_progress'],
    ['in_review', 'done'],
    ['in_review', 'blocked'],
    ['in_review', 'cancelled'],
    ['blocked', 'open'],
    ['blocked', 'in_progress'],
    ['blocked', 'cancelled'],
    ['done', 'open'],
    ['cancelled', 'backlog'],
    ['cancelled', 'open'],
  ],
};

export const LABEL_COLORS = [
  'slate',
  'blue',
  'teal',
  'green',
  'amber',
  'orange',
  'red',
  'violet',
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

// Postgres cannot store NUL in text, and other control characters have no business in a ticket.
// Titles and names are one line; descriptions and comments may also contain tabs and line breaks.
const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const LINE_BREAKS_AND_TABS = [TAB, LINE_FEED, CARRIAGE_RETURN];

/** True if the text has an ASCII control character (including NUL and DEL) not in `allowed`. */
export function hasControlCharacter(value: string, allowed: number[] = []): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if ((code < 0x20 || code === 0x7f) && !allowed.includes(code)) return true;
  }
  return false;
}
const hasControlExceptWhitespace = (value: string) =>
  hasControlCharacter(value, LINE_BREAKS_AND_TABS);

/** A required single-line text, trimmed, 1 to `max` characters. */
export const singleLineText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !hasControlCharacter(value), 'Must not contain control characters.');

/** Free text that may span lines. Not trimmed; may be empty. */
const multiLineText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => !hasControlExceptWhitespace(value), 'Must not contain control characters.');

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the form YYYY-MM-DD.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'That date does not exist.');

export const createProjectBodySchema = z.strictObject({
  key: z
    .string()
    .regex(PROJECT_KEY_PATTERN, 'Use 2 to 10 capital letters or digits, starting with a letter.'),
  name: singleLineText(80),
  description: multiLineText(2000).optional(),
});
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

export const updateProjectBodySchema = z
  .strictObject({
    name: singleLineText(80).optional(),
    description: multiLineText(2000).optional(),
    archived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');
export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;

const ticketFields = {
  title: singleLineText(200),
  description: multiLineText(20_000),
  typeId: z.uuid(),
  priorityId: z.uuid(),
  assigneeId: z.uuid().nullable(),
  componentId: z.uuid().nullable(),
  labelIds: z.array(z.uuid()).max(20),
  dueDate: calendarDate.nullable(),
  estimateMinutes: z.number().int().min(0).max(99_999).nullable(),
};

export const createTicketBodySchema = z.strictObject({
  title: ticketFields.title,
  description: ticketFields.description.optional(),
  typeId: ticketFields.typeId,
  priorityId: ticketFields.priorityId,
  /** Any active status of the project; left out, the ticket starts in the initial status. */
  statusId: z.uuid().optional(),
  assigneeId: ticketFields.assigneeId.optional(),
  componentId: ticketFields.componentId.optional(),
  labelIds: ticketFields.labelIds.optional(),
  dueDate: ticketFields.dueDate.optional(),
  estimateMinutes: ticketFields.estimateMinutes.optional(),
});
export type CreateTicketBody = z.infer<typeof createTicketBodySchema>;

/** `version` is the version the person was looking at; the API refuses the edit if it moved on. */
export const updateTicketBodySchema = z
  .strictObject({
    version: z.number().int().min(1),
    title: ticketFields.title.optional(),
    description: ticketFields.description.optional(),
    typeId: ticketFields.typeId.optional(),
    priorityId: ticketFields.priorityId.optional(),
    statusId: z.uuid().optional(),
    assigneeId: ticketFields.assigneeId.optional(),
    componentId: ticketFields.componentId.optional(),
    labelIds: ticketFields.labelIds.optional(),
    dueDate: ticketFields.dueDate.optional(),
    estimateMinutes: ticketFields.estimateMinutes.optional(),
  })
  .refine((body) => Object.keys(body).some((key) => key !== 'version'), 'Nothing to change.');
export type UpdateTicketBody = z.infer<typeof updateTicketBodySchema>;

/**
 * One change applied to up to 100 tickets as they are now. `statusKey` is a status key, because
 * the tickets may belong to different projects; each is moved to its own project's status of that
 * key.
 */
export const bulkTicketBodySchema = z.strictObject({
  keys: z
    .array(z.string().min(1).max(40))
    .min(1)
    .max(100)
    .refine((keys) => new Set(keys).size === keys.length, 'Each ticket may be listed only once.'),
  changes: z
    .strictObject({
      statusKey: z.string().regex(STATUS_KEY_PATTERN).optional(),
      priorityId: ticketFields.priorityId.optional(),
      assigneeId: ticketFields.assigneeId.optional(),
      addLabelIds: ticketFields.labelIds.optional(),
      removeLabelIds: ticketFields.labelIds.optional(),
      dueDate: ticketFields.dueDate.optional(),
      archived: z.boolean().optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0, 'Nothing to change.')
    .refine((changes) => !changes.addLabelIds?.some((id) => changes.removeLabelIds?.includes(id)), {
      message: 'A label cannot be both added and removed.',
      path: ['removeLabelIds'],
    }),
});
export type BulkTicketBody = z.infer<typeof bulkTicketBodySchema>;

export const commentBodySchema = z.strictObject({
  body: z
    .string()
    .trim()
    .min(1)
    .max(10_000)
    .refine((value) => !hasControlExceptWhitespace(value), 'Must not contain control characters.'),
});
export type CommentBody = z.infer<typeof commentBodySchema>;

export const createLabelBodySchema = z.strictObject({
  name: singleLineText(40),
  color: z.enum(LABEL_COLORS),
});
export type CreateLabelBody = z.infer<typeof createLabelBodySchema>;

export const createComponentBodySchema = z.strictObject({ name: singleLineText(60) });
export type CreateComponentBody = z.infer<typeof createComponentBodySchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const userRef = z.object({ id: z.uuid(), email: z.string(), displayName: z.string() });

export const statusSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  category: z.enum(STATUS_CATEGORIES),
  sortOrder: z.number().int(),
  initial: z.boolean(),
});
export type Status = z.infer<typeof statusSchema>;

export const ticketTypeSchema = z.object({ id: z.uuid(), key: z.string(), name: z.string() });
export type TicketType = z.infer<typeof ticketTypeSchema>;

export const prioritySchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  rank: z.number().int(),
});
export type Priority = z.infer<typeof prioritySchema>;

export const labelSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.enum(LABEL_COLORS),
});
export type Label = z.infer<typeof labelSchema>;

export const componentSchema = z.object({ id: z.uuid(), projectId: z.uuid(), name: z.string() });
export type Component = z.infer<typeof componentSchema>;

export const projectSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  archived: z.boolean(),
  ticketCount: z.number().int().nonnegative(),
  openCount: z.number().int().nonnegative(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectDetailSchema = projectSchema.extend({
  statuses: z.array(statusSchema),
  transitions: z.array(z.object({ fromStatusId: z.uuid(), toStatusId: z.uuid() })),
  components: z.array(componentSchema),
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const ticketConfigSchema = z.object({
  types: z.array(ticketTypeSchema),
  priorities: z.array(prioritySchema),
  labels: z.array(labelSchema),
  components: z.array(componentSchema),
});
export type TicketConfig = z.infer<typeof ticketConfigSchema>;

export const ticketSummarySchema = z.object({
  id: z.uuid(),
  key: z.string(),
  title: z.string(),
  project: z.object({ id: z.uuid(), key: z.string(), name: z.string() }),
  type: ticketTypeSchema,
  status: statusSchema.pick({ id: true, key: true, name: true, category: true }),
  priority: prioritySchema,
  assignee: userRef.nullable(),
  labels: z.array(labelSchema),
  dueDate: z.string().nullable(),
  /** So a move or edit made from a row or a board card can be checked for staleness. */
  version: z.number().int().min(1),
  /** How many comments the ticket has, so a card can show it without loading the timeline. */
  commentCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TicketSummary = z.infer<typeof ticketSummarySchema>;

/** What happened to each ticket of a bulk edit, in the order the keys were sent. */
export const bulkTicketResultSchema = z.object({
  results: z.array(
    z.discriminatedUnion('ok', [
      z.object({ key: z.string(), ok: z.literal(true), ticket: ticketSummarySchema }),
      z.object({
        key: z.string(),
        ok: z.literal(false),
        error: z.object({ code: z.enum(ERROR_CODES), message: z.string() }),
      }),
    ]),
  ),
});
export type BulkTicketResult = z.infer<typeof bulkTicketResultSchema>;

export const ticketDetailSchema = ticketSummarySchema.extend({
  description: z.string(),
  reporter: userRef,
  component: componentSchema.nullable(),
  estimateMinutes: z.number().int().nullable(),
  version: z.number().int(),
  completedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  allowedTransitions: z.array(
    statusSchema.pick({ id: true, key: true, name: true, category: true }),
  ),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export const ticketListSchema = z.object({
  items: z.array(ticketSummarySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type TicketList = z.infer<typeof ticketListSchema>;

export const boardSchema = z.object({
  columns: z.array(
    z.object({
      status: statusSchema,
      total: z.number().int().nonnegative(),
      tickets: z.array(ticketSummarySchema),
    }),
  ),
});
export type Board = z.infer<typeof boardSchema>;

/** One project's statuses and the moves between them, so a move can be checked before it is sent. */
export const workflowSchema = z.object({
  projectId: z.uuid(),
  projectKey: z.string(),
  archived: z.boolean(),
  statuses: z.array(statusSchema.pick({ id: true, key: true, name: true, category: true })),
  transitions: z.array(z.object({ fromStatusId: z.uuid(), toStatusId: z.uuid() })),
});
export type Workflow = z.infer<typeof workflowSchema>;

/**
 * Every project's tickets on one board. A column is a status key, so it can hold tickets of several
 * projects; each ticket still moves under its own project's workflow.
 */
export const workspaceBoardSchema = z.object({
  columns: z.array(
    z.object({
      status: statusSchema.pick({ key: true, name: true, category: true, sortOrder: true }),
      total: z.number().int().nonnegative(),
      tickets: z.array(ticketSummarySchema),
    }),
  ),
  workflows: z.array(workflowSchema),
});
export type WorkspaceBoard = z.infer<typeof workspaceBoardSchema>;

export const commentSchema = z.object({
  id: z.uuid(),
  author: userRef,
  body: z.string(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
});
export type Comment = z.infer<typeof commentSchema>;
