import { z } from 'zod';
import { hasControlCharacter, singleLineText } from './text';

// Custom fields (P4): fields a workspace adds to its tickets. The kind of a field is chosen when it
// is made and never changes; a field (or an option) that tickets have used is only ever turned off,
// so history keeps reading true.

export const CUSTOM_FIELD_KINDS = [
  'text',
  'long_text',
  'number',
  'boolean',
  'select',
  'multi_select',
  'date',
  'url',
  'person',
] as const;
export type CustomFieldKind = (typeof CUSTOM_FIELD_KINDS)[number];

/** The kinds in words, for screens. */
export const CUSTOM_FIELD_KIND_LABELS: Record<CustomFieldKind, string> = {
  text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  boolean: 'Yes/no',
  select: 'Single select',
  multi_select: 'Multi select',
  date: 'Date',
  url: 'Link',
  person: 'Person',
};

export const MAX_CUSTOM_FIELDS = 50;
export const MAX_FIELD_OPTIONS = 100;
export const MAX_FIELD_TEXT = 500;
export const MAX_FIELD_LONG_TEXT = 10_000;
export const MAX_MULTI_SELECT = 20;
export const MAX_FIELD_URL = 2000;
/** How much of a long text a ticket summary carries: enough for a card, not the whole text. */
export const FIELD_SUMMARY_TEXT = 120;

/** Kinds whose values are chosen from the field's options. */
export const hasOptions = (kind: CustomFieldKind) => kind === 'select' || kind === 'multi_select';

/** Kinds a list can be sorted by. */
export const SORTABLE_FIELD_KINDS: readonly CustomFieldKind[] = ['number', 'date', 'text'];

/** True if a field shows on a ticket of this type: it is on, and for every type or this one. */
export function fieldApplies(
  field: { active: boolean; typeIds: readonly string[] },
  typeId: string,
): boolean {
  return field.active && (field.typeIds.length === 0 || field.typeIds.includes(typeId));
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

const distinctIds = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, 'Each one may be listed only once.');

const fieldName = singleLineText(60);
const optionName = singleLineText(60);
/** One line, may be empty, trimmed. */
const fieldDescription = z
  .string()
  .trim()
  .max(300)
  .refine((value) => !hasControlCharacter(value), 'Must not contain control characters.');

export const createCustomFieldBodySchema = z
  .strictObject({
    name: fieldName,
    description: fieldDescription.optional(),
    kind: z.enum(CUSTOM_FIELD_KINDS),
    /** The ticket types it is for; empty or left out means every type. */
    typeIds: distinctIds(50).optional(),
    /** For a select or multi-select field: its first options, in order. */
    options: z.array(optionName).max(MAX_FIELD_OPTIONS).optional(),
  })
  .refine((body) => !body.options?.length || hasOptions(body.kind), {
    message: 'Only select and multi-select fields have options.',
    path: ['options'],
  })
  .refine(
    (body) =>
      !body.options ||
      new Set(body.options.map((name) => name.toLowerCase())).size === body.options.length,
    { message: 'Each option needs its own name.', path: ['options'] },
  );
export type CreateCustomFieldBody = z.infer<typeof createCustomFieldBodySchema>;

/** The kind is not here: it never changes. */
export const updateCustomFieldBodySchema = z
  .strictObject({
    name: fieldName.optional(),
    description: fieldDescription.optional(),
    typeIds: distinctIds(50).optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');
export type UpdateCustomFieldBody = z.infer<typeof updateCustomFieldBodySchema>;

/** Every field (or every option of a field), each once, in the new order. */
export const reorderIdsBodySchema = z.strictObject({ ids: distinctIds(MAX_FIELD_OPTIONS) });
export type ReorderIdsBody = z.infer<typeof reorderIdsBodySchema>;

export const createFieldOptionBodySchema = z.strictObject({ name: optionName });
export type CreateFieldOptionBody = z.infer<typeof createFieldOptionBodySchema>;

export const updateFieldOptionBodySchema = z
  .strictObject({ name: optionName.optional(), active: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to change.');
export type UpdateFieldOptionBody = z.infer<typeof updateFieldOptionBodySchema>;

/**
 * A value for one field of one ticket. `value` is checked against the field's kind on the server
 * (see `parseFieldValue`); null clears it. `version` is the ticket version the person saw.
 */
export const setFieldValueBodySchema = z.strictObject({
  version: z.number().int().min(1),
  value: z.unknown(),
});
export type SetFieldValueBody = z.infer<typeof setFieldValueBodySchema>;

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * What a value looks like on the wire: text for text, long text, date (YYYY-MM-DD) and link; a
 * number; true or false; an option id for a select, option ids for a multi-select; a user id for a
 * person.
 */
export const fieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export type FieldValue = z.infer<typeof fieldValueSchema>;

const isCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const isWebLink = (value: string) => {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const UUID = z.uuid();

/**
 * Checks a value against a field's kind. The result is the value as it is stored, or null for
 * "no value" (null, an empty text, an empty multi-select). References (options, people) are only
 * checked for form here; the server checks they exist and may be used.
 */
export function parseFieldValue(
  kind: CustomFieldKind,
  value: unknown,
): { ok: true; value: FieldValue | null } | { ok: false; message: string } {
  if (value === null) return { ok: true, value: null };
  const fail = (message: string) => ({ ok: false as const, message });

  switch (kind) {
    case 'text': {
      if (typeof value !== 'string') return fail('Give some text.');
      const text = value.trim();
      if (text.length > MAX_FIELD_TEXT) return fail(`Use at most ${MAX_FIELD_TEXT} characters.`);
      if (hasControlCharacter(text)) return fail('Must not contain control characters.');
      return { ok: true, value: text === '' ? null : text };
    }
    case 'long_text': {
      // The same rules as a description: line breaks and tabs are fine, other controls are not.
      if (typeof value !== 'string') return fail('Give some text.');
      if (value.length > MAX_FIELD_LONG_TEXT) {
        return fail(`Use at most ${MAX_FIELD_LONG_TEXT.toLocaleString('en')} characters.`);
      }
      if (hasControlCharacter(value, [TAB, LINE_FEED, CARRIAGE_RETURN])) {
        return fail('Must not contain control characters.');
      }
      return { ok: true, value: value.trim() === '' ? null : value };
    }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail('Give a number.');
      return { ok: true, value };
    case 'boolean':
      if (typeof value !== 'boolean') return fail('Give yes (true) or no (false).');
      return { ok: true, value };
    case 'date':
      if (typeof value !== 'string' || !isCalendarDate(value)) {
        return fail('Give a real date in the form YYYY-MM-DD.');
      }
      return { ok: true, value };
    case 'url': {
      if (typeof value !== 'string') return fail('Give a link.');
      const link = value.trim();
      if (link === '') return { ok: true, value: null };
      if (link.length > MAX_FIELD_URL) return fail(`Use at most ${MAX_FIELD_URL} characters.`);
      if (!isWebLink(link)) return fail('Give a link that starts with http:// or https://.');
      return { ok: true, value: link };
    }
    case 'person':
    case 'select':
      if (typeof value !== 'string' || !UUID.safeParse(value).success) {
        return fail(kind === 'person' ? 'Choose a person.' : 'Choose one of the options.');
      }
      return { ok: true, value };
    case 'multi_select': {
      if (!Array.isArray(value) || value.some((id) => !UUID.safeParse(id).success)) {
        return fail('Choose from the options.');
      }
      if (value.length > MAX_MULTI_SELECT) return fail(`Choose at most ${MAX_MULTI_SELECT}.`);
      if (new Set(value).size !== value.length) return fail('Each option may be chosen once.');
      return { ok: true, value: value.length === 0 ? null : (value as string[]) };
    }
  }
}

/** A number as a field shows it: as typed, without a trailing ".0" or an exponent for most. */
export const formatFieldNumber = (value: number) =>
  Number.isInteger(value) && Math.abs(value) < 1e21
    ? value.toString()
    : value.toLocaleString('en', { maximumFractionDigits: 10, useGrouping: false });

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const customFieldOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sortOrder: z.number().int(),
  active: z.boolean(),
  /** Some ticket has it chosen, so it can be turned off but not removed. */
  used: z.boolean(),
});
export type CustomFieldOption = z.infer<typeof customFieldOptionSchema>;

export const customFieldSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  kind: z.enum(CUSTOM_FIELD_KINDS),
  /** Empty: every type. */
  typeIds: z.array(z.uuid()),
  sortOrder: z.number().int(),
  active: z.boolean(),
  /** How many tickets have a value; a field with any cannot be deleted. */
  valueCount: z.number().int().nonnegative(),
  /** In order; inactive ones included (marked), so old values still have names. */
  options: z.array(customFieldOptionSchema),
});
export type CustomField = z.infer<typeof customFieldSchema>;

/** A ticket summary's compact copy of one field that has a value: enough to show it on a card. */
export const ticketFieldTextSchema = z.object({
  fieldId: z.uuid(),
  name: z.string(),
  kind: z.enum(CUSTOM_FIELD_KINDS),
  /** The value in words (a long text cut short). */
  text: z.string(),
});
export type TicketFieldText = z.infer<typeof ticketFieldTextSchema>;

/** One field of a ticket in full: every field that applies to it, with or without a value. */
export const ticketFieldSchema = z.object({
  fieldId: z.uuid(),
  name: z.string(),
  description: z.string(),
  kind: z.enum(CUSTOM_FIELD_KINDS),
  /** The options a person may choose now, plus any inactive ones the ticket still has. */
  options: z.array(z.object({ id: z.uuid(), name: z.string(), active: z.boolean() })),
  value: fieldValueSchema.nullable(),
  /** The value in words, or null when there is none. */
  text: z.string().nullable(),
});
export type TicketField = z.infer<typeof ticketFieldSchema>;

// ---------------------------------------------------------------------------
// Filters: `cf=<fieldId>.<test>` in a list or board address
// ---------------------------------------------------------------------------

/**
 * What a custom-field filter asks of a field: `set` (has a value), `empty`, `yes` or `no` (a
 * yes/no field), `me` (a person field), or an id: an option of a select field or a person.
 */
export const FIELD_FILTER_TESTS = ['set', 'empty', 'yes', 'no', 'me'] as const;
export type FieldFilterTest = (typeof FIELD_FILTER_TESTS)[number] | string;

const FIELD_FILTER = /^([0-9a-f-]{36})\.(set|empty|yes|no|me|[0-9a-f-]{36})$/i;

/** Reads one `cf` value, or null if it is not one. Ids come back in lower case. */
export function parseFieldFilter(value: string): { fieldId: string; test: FieldFilterTest } | null {
  const match = FIELD_FILTER.exec(value);
  if (!match) return null;
  const fieldId = match[1]!.toLowerCase();
  const test = match[2]!.toLowerCase();
  if (!UUID.safeParse(fieldId).success) return null;
  if (!(FIELD_FILTER_TESTS as readonly string[]).includes(test) && !UUID.safeParse(test).success) {
    return null;
  }
  return { fieldId, test };
}

export const fieldFilterValue = (fieldId: string, test: FieldFilterTest) => `${fieldId}.${test}`;
