import {
  customFieldOptions,
  customFields,
  ticketFieldValues,
  users,
  type Executor,
} from '@forge/db';
import {
  FIELD_SUMMARY_TEXT,
  fieldApplies,
  formatFieldNumber,
  type CustomFieldKind,
  type FieldValue,
  type TicketField,
  type TicketFieldText,
} from '@forge/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';

// Reading a ticket's custom field values, for the ticket and for its summaries. A value only shows
// while its field is active and applies to the ticket's type; otherwise it is kept but hidden, and
// comes back if the field does.

export type Definition = {
  id: string;
  name: string;
  description: string;
  kind: CustomFieldKind;
  typeIds: string[];
  active: boolean;
  options: { id: string; name: string; active: boolean }[];
};

type ValueRow = typeof ticketFieldValues.$inferSelect;

/** The workspace's active fields in order, each with every option (inactive ones too). */
export async function activeDefinitions(
  executor: Executor,
  organisationId: string,
): Promise<Definition[]> {
  const fields = await executor
    .select()
    .from(customFields)
    .where(and(eq(customFields.organisationId, organisationId), eq(customFields.isActive, true)))
    .orderBy(asc(customFields.sortOrder), asc(customFields.name));
  if (fields.length === 0) return [];
  const options = await executor
    .select()
    .from(customFieldOptions)
    .where(
      and(
        eq(customFieldOptions.organisationId, organisationId),
        inArray(
          customFieldOptions.fieldId,
          fields.map((field) => field.id),
        ),
      ),
    )
    .orderBy(asc(customFieldOptions.sortOrder), asc(customFieldOptions.name));
  return fields.map((field) => ({
    id: field.id,
    name: field.name,
    description: field.description,
    kind: field.kind as CustomFieldKind,
    typeIds: field.typeIds,
    active: field.isActive,
    options: options
      .filter((option) => option.fieldId === field.id)
      .map((option) => ({ id: option.id, name: option.name, active: option.isActive })),
  }));
}

/** The stored value as it travels, or null when the field's column is empty. */
export function valueOf(kind: CustomFieldKind, row: ValueRow | undefined): FieldValue | null {
  if (!row) return null;
  switch (kind) {
    case 'text':
    case 'long_text':
    case 'url':
      return row.textValue;
    case 'number':
      return row.numberValue;
    case 'boolean':
      return row.booleanValue;
    case 'date':
      return row.dateValue;
    case 'person':
      return row.userId;
    case 'select':
      return row.optionIds?.[0] ?? null;
    case 'multi_select':
      return row.optionIds && row.optionIds.length > 0 ? row.optionIds : null;
  }
}

/** A value in words: option and people's names, Yes or No, a number as typed. */
export function textOf(
  field: Definition,
  value: FieldValue | null,
  people: Map<string, string>,
): string | null {
  if (value === null) return null;
  switch (field.kind) {
    case 'number':
      return formatFieldNumber(value as number);
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'person':
      return people.get(value as string) ?? 'Someone';
    case 'select':
    case 'multi_select': {
      const ids = Array.isArray(value) ? value : [value as string];
      // In the field's order, not the order they were picked.
      return field.options
        .filter((option) => ids.includes(option.id))
        .map((option) => option.name)
        .join(', ');
    }
    default:
      return value as string;
  }
}

export async function namesOf(executor: Executor, userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const rows = await executor
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((row) => [row.id, row.displayName]));
}

async function valueRowsFor(executor: Executor, organisationId: string, ticketIds: string[]) {
  return executor
    .select()
    .from(ticketFieldValues)
    .where(
      and(
        eq(ticketFieldValues.organisationId, organisationId),
        inArray(ticketFieldValues.ticketId, ticketIds),
      ),
    );
}

const cut = (text: string) =>
  text.length > FIELD_SUMMARY_TEXT ? `${text.slice(0, FIELD_SUMMARY_TEXT - 1).trimEnd()}…` : text;

/** For each ticket, the fields that apply to it and have a value, in words, for its summary. */
export async function fieldTextsFor(
  executor: Executor,
  organisationId: string,
  ticketsToRead: { id: string; typeId: string }[],
): Promise<Map<string, TicketFieldText[]>> {
  const byTicket = new Map<string, TicketFieldText[]>();
  if (ticketsToRead.length === 0) return byTicket;
  const definitions = await activeDefinitions(executor, organisationId);
  if (definitions.length === 0) return byTicket;
  const rows = await valueRowsFor(
    executor,
    organisationId,
    ticketsToRead.map((ticket) => ticket.id),
  );
  if (rows.length === 0) return byTicket;
  const people = await namesOf(
    executor,
    rows.flatMap((row) => (row.userId ? [row.userId] : [])),
  );

  for (const ticket of ticketsToRead) {
    const mine = rows.filter((row) => row.ticketId === ticket.id);
    if (mine.length === 0) continue;
    const texts = definitions.flatMap((field) => {
      if (!fieldApplies(field, ticket.typeId)) return [];
      const text = textOf(
        field,
        valueOf(
          field.kind,
          mine.find((row) => row.fieldId === field.id),
        ),
        people,
      );
      return text === null || text === ''
        ? []
        : [{ fieldId: field.id, name: field.name, kind: field.kind, text: cut(text) }];
    });
    if (texts.length > 0) byTicket.set(ticket.id, texts);
  }
  return byTicket;
}

/** Every field that applies to the ticket, in order, with its value. */
export async function ticketFieldsOf(
  executor: Executor,
  organisationId: string,
  ticket: { id: string; typeId: string },
): Promise<TicketField[]> {
  const definitions = (await activeDefinitions(executor, organisationId)).filter((field) =>
    fieldApplies(field, ticket.typeId),
  );
  if (definitions.length === 0) return [];
  const rows = await valueRowsFor(executor, organisationId, [ticket.id]);
  const people = await namesOf(
    executor,
    rows.flatMap((row) => (row.userId ? [row.userId] : [])),
  );

  return definitions.map((field) => {
    const value = valueOf(
      field.kind,
      rows.find((row) => row.fieldId === field.id),
    );
    const chosen = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return {
      fieldId: field.id,
      name: field.name,
      description: field.description,
      kind: field.kind,
      // Inactive options are not offered, but one the ticket still has keeps its name.
      options: field.options.filter((option) => option.active || chosen.includes(option.id)),
      value,
      text: textOf(field, value, people),
    };
  });
}

/** The summary's compact copy of a ticket's fields: those with a value, long texts cut short. */
export const textsOf = (fields: TicketField[]): TicketFieldText[] =>
  fields.flatMap((field) =>
    field.text === null || field.text === ''
      ? []
      : [{ fieldId: field.fieldId, name: field.name, kind: field.kind, text: cut(field.text) }],
  );
