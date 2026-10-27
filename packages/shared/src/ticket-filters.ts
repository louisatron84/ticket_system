import { z } from 'zod';
import {
  PROJECT_KEY_PATTERN,
  STATUS_CATEGORIES,
  STATUS_KEY_PATTERN,
  hasControlCharacter,
  singleLineText,
} from './tickets';

// Keys for statuses, types and priorities are short lower-case identifiers.

const keyFilter = z.string().regex(STATUS_KEY_PATTERN, 'Not a valid key.');
const projectFilter = z
  .string()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(PROJECT_KEY_PATTERN, 'Not a valid project key.'));

export const TICKET_SORTS = ['updated', 'created', 'priority', 'due', 'key'] as const;
export const DUE_FILTERS = ['overdue', 'today', 'week', 'none'] as const;

/**
 * Everything a list or board can be narrowed or ordered by. The API validates query strings with
 * this; the web app writes it into the URL, so a filtered view can be reloaded, shared and bookmarked.
 */
export const ticketFilterSchema = z.strictObject({
  q: z
    .string()
    .trim()
    .max(100)
    .refine((value) => !hasControlCharacter(value), 'Must not contain control characters.')
    .default(''),
  project: z.array(projectFilter).max(20).default([]),
  statusKey: z.array(keyFilter).max(20).default([]),
  statusCategory: z.array(z.enum(STATUS_CATEGORIES)).max(3).default([]),
  type: z.array(keyFilter).max(20).default([]),
  priority: z.array(keyFilter).max(20).default([]),
  assignee: z
    .array(z.union([z.literal('me'), z.literal('none'), z.uuid()]))
    .max(20)
    .default([]),
  reporter: z
    .array(z.union([z.literal('me'), z.uuid()]))
    .max(20)
    .default([]),
  label: z.array(singleLineText(40)).max(20).default([]),
  due: z.enum(DUE_FILTERS).optional(),
  archived: z.boolean().default(false),
  sort: z.enum(TICKET_SORTS).default('updated'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});
export type TicketFilters = z.infer<typeof ticketFilterSchema>;

const ARRAY_FIELDS = [
  'project',
  'statusKey',
  'statusCategory',
  'type',
  'priority',
  'assignee',
  'reporter',
  'label',
] as const;
const SCALAR_FIELDS = ['q', 'due', 'archived', 'sort', 'dir', 'page', 'pageSize'] as const;

type RawInput = Record<string, string | string[] | undefined>;

/**
 * Reads filters from a query string or URL search params. Strict: anything invalid is reported,
 * not guessed at. Unknown parameters (tracking tags and so on) are ignored.
 */
export function parseTicketFilters(
  input: RawInput,
): { ok: true; filters: TicketFilters } | { ok: false; issues: string[] } {
  const raw: Record<string, unknown> = {};
  const issues: string[] = [];

  for (const field of ARRAY_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    const values = (Array.isArray(value) ? value : [value]).filter((item) => item !== '');
    if (values.length > 0) raw[field] = values;
  }

  for (const field of SCALAR_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length > 1) {
      issues.push(`${field}: give a single value.`);
      continue;
    }
    const single = Array.isArray(value) ? value[0] : value;
    if (single === undefined || (single === '' && field !== 'q')) continue;

    if (field === 'page' || field === 'pageSize') {
      raw[field] = /^[+-]?\d+(\.\d+)?$/.test(single) ? Number(single) : single;
    } else if (field === 'archived') {
      raw[field] = single === 'true' ? true : single === 'false' ? false : single;
    } else {
      raw[field] = single;
    }
  }

  const result = ticketFilterSchema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push(`${issue.path.join('.') || 'filters'}: ${issue.message}`);
    }
  }

  return issues.length > 0 || !result.success
    ? { ok: false, issues }
    : { ok: true, filters: result.data };
}

/** The inverse of `parseTicketFilters`. Defaults are left out so URLs stay short. */
export function ticketFiltersToSearchParams(filters: TicketFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  for (const field of ARRAY_FIELDS) {
    for (const value of filters[field]) params.append(field, value);
  }
  if (filters.due) params.set('due', filters.due);
  if (filters.archived) params.set('archived', 'true');
  if (filters.sort !== 'updated') params.set('sort', filters.sort);
  if (filters.dir !== 'desc') params.set('dir', filters.dir);
  if (filters.page !== 1) params.set('page', String(filters.page));
  if (filters.pageSize !== 50) params.set('pageSize', String(filters.pageSize));
  return params;
}

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

export const viewDefinitionSchema = z.strictObject({
  filters: ticketFilterSchema.omit({ page: true }),
  display: z.enum(['list', 'board']),
});
export type ViewDefinition = z.infer<typeof viewDefinitionSchema>;

export const saveViewBodySchema = z.strictObject({
  name: singleLineText(80),
  scope: z.enum(['personal', 'shared']),
  definition: viewDefinitionSchema,
});
export type SaveViewBody = z.infer<typeof saveViewBodySchema>;

/** A view's scope is fixed when it is created; only its name and what it shows can change. */
export const updateViewBodySchema = z
  .strictObject({
    name: singleLineText(80).optional(),
    definition: viewDefinitionSchema.optional(),
  })
  .refine(
    (body) => body.name !== undefined || body.definition !== undefined,
    'Give a new name or a new definition.',
  );
export type UpdateViewBody = z.infer<typeof updateViewBodySchema>;

export const savedViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  scope: z.enum(['personal', 'shared']),
  ownerUserId: z.uuid(),
  definition: viewDefinitionSchema,
  updatedAt: z.string(),
});
export type SavedView = z.infer<typeof savedViewSchema>;
