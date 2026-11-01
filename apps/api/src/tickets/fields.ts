import {
  addTicketEvent,
  customFieldOptions,
  customFields,
  organisationMemberships,
  roles,
  ticketFieldValues,
  ticketTypes,
  tickets,
  type Db,
  type Executor,
} from '@forge/db';
import {
  fieldApplies,
  parseFieldValue,
  type CustomFieldKind,
  type FieldValue,
  type SetFieldValueBody,
  type TicketDetail,
} from '@forge/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { isForeignKeyViolation } from '../db-errors';
import { AppError } from '../errors';
import { activeDefinitions, namesOf, textOf, valueOf } from './field-read';
import { loadTicketDetail } from './read';
import {
  archivedTicketError,
  invalid,
  refuseIfProjectArchived,
  type TicketContext,
} from './service';

// Setting one custom field of one ticket. Reading values is in field-read.ts.

const notFound = () => new AppError('not_found', 'Not found.', 404);

const sameValue = (a: FieldValue | null, b: FieldValue | null) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item) => b.includes(item))
    : a === b;

/** The columns to store for a value of this kind (every other column empty). */
function columnsFor(kind: CustomFieldKind, value: FieldValue) {
  const empty = {
    textValue: null,
    numberValue: null,
    dateValue: null,
    booleanValue: null,
    userId: null,
    optionIds: null,
  };
  switch (kind) {
    case 'text':
    case 'long_text':
    case 'url':
      return { ...empty, textValue: value as string };
    case 'number':
      return { ...empty, numberValue: value as number };
    case 'boolean':
      return { ...empty, booleanValue: value as boolean };
    case 'date':
      return { ...empty, dateValue: value as string };
    case 'person':
      return { ...empty, userId: value as string };
    case 'select':
      return { ...empty, optionIds: [value as string] };
    case 'multi_select':
      return { ...empty, optionIds: value as string[] };
  }
}

/**
 * Sets (or, with null, clears) one field of one ticket. The value is part of the ticket: the
 * person must present the version they saw, the version moves on, and the history gets a line
 * with the old and new value in words.
 */
export async function setTicketFieldValue(
  db: Db,
  input: { context: TicketContext; ticketKey: string; fieldId: string; body: SetFieldValueBody },
): Promise<TicketDetail> {
  const { context, ticketKey, fieldId, body } = input;

  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(tickets)
        .where(and(eq(tickets.organisationId, context.organisationId), eq(tickets.key, ticketKey)))
        .for('update');
      if (!row) throw notFound();
      if (row.archivedAt) throw archivedTicketError();
      await refuseIfProjectArchived(tx, row.id);

      // Shared, so an option cannot be removed or turned off while this value is being checked.
      const [field] = await tx
        .select()
        .from(customFields)
        .where(
          and(
            eq(customFields.organisationId, context.organisationId),
            eq(customFields.id, fieldId),
          ),
        )
        .for('share');
      if (!field) throw notFound();

      if (body.version !== row.version) {
        throw new AppError(
          'conflict',
          'This ticket was changed by someone else. Reload it to see the latest version.',
          409,
          [{ path: 'version', message: `The ticket is now at version ${row.version}.` }],
        );
      }

      const kind = field.kind as CustomFieldKind;
      if (!field.isActive) {
        throw invalid([{ path: 'fieldId', message: `${field.name} is turned off.` }]);
      }
      if (!fieldApplies({ active: true, typeIds: field.typeIds }, row.typeId)) {
        const [type] = await tx
          .select({ name: ticketTypes.name })
          .from(ticketTypes)
          .where(eq(ticketTypes.id, row.typeId));
        throw invalid([
          {
            path: 'fieldId',
            message: `${field.name} is not used for ${type?.name ?? 'this type of'} tickets.`,
          },
        ]);
      }

      const parsed = parseFieldValue(kind, body.value);
      if (!parsed.ok) throw invalid([{ path: 'value', message: parsed.message }]);
      const next = parsed.value;

      const [stored] = await tx
        .select()
        .from(ticketFieldValues)
        .where(
          and(eq(ticketFieldValues.ticketId, row.id), eq(ticketFieldValues.fieldId, field.id)),
        );
      const previous = valueOf(kind, stored);

      if (next !== null) await checkReferences(tx, context.organisationId, field, previous, next);

      if (sameValue(previous, next)) {
        const current = await loadTicketDetail(tx, context.organisationId, ticketKey);
        if (!current) throw notFound();
        return current;
      }

      const now = new Date();
      if (next === null) {
        await tx
          .delete(ticketFieldValues)
          .where(
            and(eq(ticketFieldValues.ticketId, row.id), eq(ticketFieldValues.fieldId, field.id)),
          );
      } else {
        const columns = { ...columnsFor(kind, next), updatedAt: now };
        await tx
          .insert(ticketFieldValues)
          .values({
            organisationId: context.organisationId,
            ticketId: row.id,
            fieldId: field.id,
            ...columns,
          })
          .onConflictDoUpdate({
            target: [ticketFieldValues.ticketId, ticketFieldValues.fieldId],
            set: columns,
          });
      }
      await tx
        .update(tickets)
        .set({ version: sql`${tickets.version} + 1`, updatedAt: now })
        .where(eq(tickets.id, row.id));

      // The history, in words as they read now. A long text is only said to have changed.
      const definition = (await activeDefinitions(tx, context.organisationId)).find(
        (item) => item.id === field.id,
      )!;
      const people = await namesOf(
        tx,
        [previous, next].flatMap((value) =>
          kind === 'person' && typeof value === 'string' ? [value] : [],
        ),
      );
      const long = kind === 'long_text';
      await addTicketEvent(tx, {
        organisationId: context.organisationId,
        ticketId: row.id,
        actorUserId: context.actorUserId,
        event: {
          type: 'field.changed',
          data: {
            field: field.name,
            from: long ? null : textOf(definition, previous, people),
            to: long ? null : textOf(definition, next, people),
          },
        },
        createdAt: now,
      });

      const detail = await loadTicketDetail(tx, context.organisationId, ticketKey);
      if (!detail) throw new Error('A ticket that was just updated could not be read back');
      return detail;
    });
  } catch (error) {
    // A person whose membership ended a moment ago, refused by the database.
    if (isForeignKeyViolation(error)) {
      throw invalid([{ path: 'value', message: 'That person is no longer a member here.' }]);
    }
    throw error;
  }
}

/**
 * Options must belong to the field and be active (one the ticket already has may stay, though
 * turned off); a person must be a member who can see tickets.
 */
async function checkReferences(
  tx: Executor,
  organisationId: string,
  field: typeof customFields.$inferSelect,
  previous: FieldValue | null,
  next: FieldValue,
) {
  if (field.kind === 'select' || field.kind === 'multi_select') {
    const wanted = Array.isArray(next) ? next : [next as string];
    const kept = Array.isArray(previous)
      ? previous
      : typeof previous === 'string'
        ? [previous]
        : [];
    const found = await tx
      .select({ id: customFieldOptions.id, isActive: customFieldOptions.isActive })
      .from(customFieldOptions)
      .where(
        and(
          eq(customFieldOptions.organisationId, organisationId),
          eq(customFieldOptions.fieldId, field.id),
          inArray(customFieldOptions.id, wanted),
        ),
      );
    const usable = wanted.every((id) => {
      const option = found.find((item) => item.id === id);
      return option && (option.isActive || kept.includes(id));
    });
    if (!usable) {
      throw invalid([
        { path: 'value', message: `That is not one of the options of ${field.name}.` },
      ]);
    }
  }

  if (field.kind === 'person') {
    const [member] = await tx
      .select({ userId: organisationMemberships.userId })
      .from(organisationMemberships)
      .innerJoin(roles, eq(roles.id, organisationMemberships.roleId))
      .where(
        and(
          eq(organisationMemberships.organisationId, organisationId),
          eq(organisationMemberships.userId, next as string),
          sql`'tickets.view' = any(${roles.permissions})`,
        ),
      );
    if (!member) {
      throw invalid([
        { path: 'value', message: 'Choose a member of this workspace who can see its tickets.' },
      ]);
    }
  }
}
