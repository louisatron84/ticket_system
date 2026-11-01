import {
  customFieldOptions,
  customFields,
  organisations,
  ticketFieldValues,
  ticketTypes,
  type Db,
  type Executor,
} from '@forge/db';
import {
  MAX_CUSTOM_FIELDS,
  MAX_FIELD_OPTIONS,
  createCustomFieldBodySchema,
  createFieldOptionBodySchema,
  hasOptions,
  reorderIdsBodySchema,
  setFieldValueBodySchema,
  updateCustomFieldBodySchema,
  updateFieldOptionBodySchema,
  type CustomField,
  type CustomFieldKind,
  type TicketDetail,
} from '@forge/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { orgAccess } from '../auth/guards';
import { isForeignKeyViolation, isUniqueViolation } from '../db-errors';
import { AppError } from '../errors';
import { setTicketFieldValue } from '../tickets/fields';
import { parseBody } from '../validation';
import { ticketKeyParam } from './tickets';

// Custom fields of a workspace (P4): see docs/superpowers/specs/2026-10-29-p4-configuration-design.md.
// Anyone who can see tickets can read the fields (the ticket page, filters and cards need them);
// changing them needs `fields.manage`. A field or option that tickets have used is turned off,
// never removed, so history keeps reading true.

const notFound = () => new AppError('not_found', 'Not found.', 404);

function idParam(request: { params: unknown }, name: string): string {
  const parsed = z.uuid().safeParse((request.params as Record<string, string>)[name]);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

const nameTaken = (name: string) =>
  new AppError('conflict', `A field named "${name}" already exists.`, 409);
const optionTaken = (name: string) =>
  new AppError('conflict', `This field already has an option named "${name}".`, 409);

/** Every field of the workspace (or just one), in order, with its options and what uses them. */
export async function loadFields(
  executor: Executor,
  organisationId: string,
  onlyId?: string,
): Promise<CustomField[]> {
  const fields = await executor
    .select({
      id: customFields.id,
      name: customFields.name,
      description: customFields.description,
      kind: customFields.kind,
      typeIds: customFields.typeIds,
      sortOrder: customFields.sortOrder,
      active: customFields.isActive,
      valueCount: sql<number>`(select count(*)::int from ${ticketFieldValues} where ${ticketFieldValues.fieldId} = ${customFields.id})`,
    })
    .from(customFields)
    .where(
      and(
        eq(customFields.organisationId, organisationId),
        onlyId ? eq(customFields.id, onlyId) : undefined,
      ),
    )
    .orderBy(asc(customFields.sortOrder), asc(customFields.name));
  if (fields.length === 0) return [];

  const options = await executor
    .select({
      id: customFieldOptions.id,
      fieldId: customFieldOptions.fieldId,
      name: customFieldOptions.name,
      sortOrder: customFieldOptions.sortOrder,
      active: customFieldOptions.isActive,
      used: sql<boolean>`exists (select 1 from ${ticketFieldValues} where ${ticketFieldValues.fieldId} = ${customFieldOptions.fieldId} and ${customFieldOptions.id} = any(${ticketFieldValues.optionIds}))`,
    })
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
    ...field,
    kind: field.kind as CustomFieldKind,
    options: options
      .filter((option) => option.fieldId === field.id)
      .map(({ fieldId: _fieldId, ...option }) => option),
  }));
}

/** The field, locked until the transaction ends, or 404 if this workspace has no such field. */
async function lockField(executor: Executor, organisationId: string, fieldId: string) {
  const [field] = await executor
    .select()
    .from(customFields)
    .where(and(eq(customFields.organisationId, organisationId), eq(customFields.id, fieldId)))
    .for('update');
  if (!field) throw notFound();
  return field;
}

/** Ticket types must be this workspace's. */
async function checkTypes(executor: Executor, organisationId: string, typeIds: string[]) {
  if (typeIds.length === 0) return;
  const found = await executor
    .select({ id: ticketTypes.id })
    .from(ticketTypes)
    .where(and(eq(ticketTypes.organisationId, organisationId), inArray(ticketTypes.id, typeIds)));
  if (found.length !== typeIds.length) {
    throw new AppError(
      'validation_failed',
      'Some of the ticket types are not available here.',
      422,
      [{ path: 'typeIds', message: 'Unknown ticket type.' }],
    );
  }
}

/** The ids must be exactly the ones there are, each once: a reorder never adds or drops any. */
function checkSameIds(given: string[], existing: string[], what: string) {
  if (given.length !== existing.length || !existing.every((id) => given.includes(id))) {
    throw new AppError('validation_failed', `List every ${what} once, in the new order.`, 422, [
      { path: 'ids', message: `List every ${what} once.` },
    ]);
  }
}

export function registerCustomFieldRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  const audit = (
    executor: Executor,
    request: FastifyRequest,
    event: {
      action: string;
      targetType: string;
      targetId: string;
      before?: unknown;
      after?: unknown;
    },
  ) =>
    recordAudit(executor, {
      organisationId: request.org!.organisationId,
      actorUserId: request.org!.actorUserId,
      requestId: request.id,
      source: 'user',
      outcome: 'success',
      ...event,
    });

  app.get(
    '/api/v1/orgs/:orgId/custom-fields',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<CustomField[]> => loadFields(db, request.org!.organisationId),
  );

  app.post(
    '/api/v1/orgs/:orgId/custom-fields',
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request, reply): Promise<CustomField> => {
      const body = parseBody(createCustomFieldBodySchema, request.body);
      const organisationId = request.org!.organisationId;
      const typeIds = body.typeIds ?? [];

      try {
        const field = await db.transaction(async (tx) => {
          // One creation at a time per workspace, so the limit holds when two arrive together.
          await tx
            .select({ id: organisations.id })
            .from(organisations)
            .where(eq(organisations.id, organisationId))
            .for('update');
          const [counted] = await tx
            .select({
              total: sql<number>`count(*)::int`,
              last: sql<number>`coalesce(max(${customFields.sortOrder}), -1)::int`,
            })
            .from(customFields)
            .where(eq(customFields.organisationId, organisationId));
          if ((counted?.total ?? 0) >= MAX_CUSTOM_FIELDS) {
            throw new AppError(
              'conflict',
              `A workspace can have at most ${MAX_CUSTOM_FIELDS} fields. Delete or reuse one first.`,
              409,
            );
          }
          await checkTypes(tx, organisationId, typeIds);

          const [row] = await tx
            .insert(customFields)
            .values({
              organisationId,
              name: body.name,
              description: body.description ?? '',
              kind: body.kind,
              typeIds,
              sortOrder: (counted?.last ?? -1) + 1,
            })
            .returning({ id: customFields.id });
          const options = body.options ?? [];
          if (options.length > 0) {
            await tx.insert(customFieldOptions).values(
              options.map((name, index) => ({
                organisationId,
                fieldId: row!.id,
                name,
                sortOrder: index,
              })),
            );
          }
          await audit(tx, request, {
            action: 'custom_field.created',
            targetType: 'custom_field',
            targetId: row!.id,
            after: { name: body.name, kind: body.kind, typeIds, options },
          });
          const [created] = await loadFields(tx, organisationId, row!.id);
          return created!;
        });
        reply.status(201);
        return field;
      } catch (error) {
        if (isUniqueViolation(error, 'custom_fields_organisation_name_unique')) {
          throw nameTaken(body.name);
        }
        throw error;
      }
    },
  );

  app.patch(
    '/api/v1/orgs/:orgId/custom-fields/:fieldId',
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request): Promise<CustomField> => {
      const fieldId = idParam(request, 'fieldId');
      const body = parseBody(updateCustomFieldBodySchema, request.body);
      const organisationId = request.org!.organisationId;

      try {
        return await db.transaction(async (tx) => {
          const before = await lockField(tx, organisationId, fieldId);
          if (body.typeIds) await checkTypes(tx, organisationId, body.typeIds);
          const changes = {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.typeIds !== undefined ? { typeIds: body.typeIds } : {}),
            ...(body.active !== undefined ? { isActive: body.active } : {}),
          };
          await tx.update(customFields).set(changes).where(eq(customFields.id, fieldId));
          await audit(tx, request, {
            action: 'custom_field.updated',
            targetType: 'custom_field',
            targetId: fieldId,
            before: {
              name: before.name,
              description: before.description,
              typeIds: before.typeIds,
              active: before.isActive,
            },
            after: {
              name: body.name ?? before.name,
              description: body.description ?? before.description,
              typeIds: body.typeIds ?? before.typeIds,
              active: body.active ?? before.isActive,
            },
          });
          const [field] = await loadFields(tx, organisationId, fieldId);
          return field!;
        });
      } catch (error) {
        if (isUniqueViolation(error, 'custom_fields_organisation_name_unique')) {
          throw nameTaken(body.name ?? '');
        }
        throw error;
      }
    },
  );

  app.put(
    '/api/v1/orgs/:orgId/custom-fields/order',
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request): Promise<CustomField[]> => {
      const { ids } = parseBody(reorderIdsBodySchema, request.body);
      const organisationId = request.org!.organisationId;

      return db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: customFields.id })
          .from(customFields)
          .where(eq(customFields.organisationId, organisationId))
          .orderBy(asc(customFields.sortOrder))
          .for('update');
        checkSameIds(
          ids,
          existing.map((row) => row.id),
          'field',
        );
        for (const [index, id] of ids.entries()) {
          await tx.update(customFields).set({ sortOrder: index }).where(eq(customFields.id, id));
        }
        await audit(tx, request, {
          action: 'custom_field.reordered',
          targetType: 'custom_field',
          targetId: organisationId,
          before: { ids: existing.map((row) => row.id) },
          after: { ids },
        });
        return loadFields(tx, organisationId);
      });
    },
  );

  app.delete(
    '/api/v1/orgs/:orgId/custom-fields/:fieldId',
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request, reply): Promise<void> => {
      const fieldId = idParam(request, 'fieldId');
      const organisationId = request.org!.organisationId;
      const inUse = () =>
        new AppError(
          'conflict',
          'Tickets have values for this field, so it cannot be deleted. Turn it off instead.',
          409,
        );

      try {
        await db.transaction(async (tx) => {
          const field = await lockField(tx, organisationId, fieldId);
          const [used] = await tx
            .select({ ticketId: ticketFieldValues.ticketId })
            .from(ticketFieldValues)
            .where(eq(ticketFieldValues.fieldId, fieldId))
            .limit(1);
          if (used) throw inUse();
          await tx.delete(customFieldOptions).where(eq(customFieldOptions.fieldId, fieldId));
          await tx.delete(customFields).where(eq(customFields.id, fieldId));
          await audit(tx, request, {
            action: 'custom_field.deleted',
            targetType: 'custom_field',
            targetId: fieldId,
            before: { name: field.name, kind: field.kind },
          });
        });
      } catch (error) {
        // A value written a moment ago: the foreign key keeps the field.
        if (isForeignKeyViolation(error)) throw inUse();
        throw error;
      }
      reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------------------
  // Options of a select or multi-select field
  // ---------------------------------------------------------------------------

  /** The field, locked, refusing one that has no options. */
  async function lockSelectField(tx: Executor, organisationId: string, fieldId: string) {
    const field = await lockField(tx, organisationId, fieldId);
    if (!hasOptions(field.kind as CustomFieldKind)) {
      throw new AppError('conflict', 'Only select and multi-select fields have options.', 409);
    }
    return field;
  }

  async function lockOption(tx: Executor, fieldId: string, optionId: string) {
    const [option] = await tx
      .select()
      .from(customFieldOptions)
      .where(and(eq(customFieldOptions.fieldId, fieldId), eq(customFieldOptions.id, optionId)))
      .for('update');
    if (!option) throw notFound();
    return option;
  }

  app.post(
    '/api/v1/orgs/:orgId/custom-fields/:fieldId/options',
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request, reply): Promise<CustomField> => {
      const fieldId = idParam(request, 'fieldId');
      const { name } = parseBody(createFieldOptionBodySchema, request.body);
      const organisationId = request.org!.organisationId;

      try {
        const field = await db.transaction(async (tx) => {
          await lockSelectField(tx, organisationId, fieldId);
          const [counted] = await tx
            .select({
              total: sql<number>`count(*)::int`,
              last: sql<number>`coalesce(max(${customFieldOptions.sortOrder}), -1)::int`,
            })
            .from(customFieldOptions)
            .where(eq(customFieldOptions.fieldId, fieldId));
          if ((counted?.total ?? 0) >= MAX_FIELD_OPTIONS) {
            throw new AppError(
              'conflict',
              `A field can have at most ${MAX_FIELD_OPTIONS} options.`,
              409,
            );
          }
          const [row] = await tx
            .insert(customFieldOptions)
            .values({ organisationId, fieldId, name, sortOrder: (counted?.last ?? -1) + 1 })
            .returning({ id: customFieldOptions.id });
          await audit(tx, request, {
            action: 'custom_field_option.created',
            targetType: 'custom_field_option',
            targetId: row!.id,
            after: { fieldId, name },
          });
          const [updated] = await loadFields(tx, organisationId, fieldId);
          return updated!;
        });
        reply.status(201);
        return field;
      } catch (error) {
        if (isUniqueViolation(error, 'custom_field_options_field_name_unique')) {
          throw optionTaken(name);
        }
        throw error;
      }
    },
  );

  app.patch(
    '/api/v1/orgs/:orgId/custom-fields/:fieldId/options/:optionId',
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request): Promise<CustomField> => {
      const fieldId = idParam(request, 'fieldId');
      const optionId = idParam(request, 'optionId');
      const body = parseBody(updateFieldOptionBodySchema, request.body);
      const organisationId = request.org!.organisationId;

      try {
        return await db.transaction(async (tx) => {
          await lockSelectField(tx, organisationId, fieldId);
          const before = await lockOption(tx, fieldId, optionId);
          await tx
            .update(customFieldOptions)
            .set({
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.active !== undefined ? { isActive: body.active } : {}),
            })
            .where(eq(customFieldOptions.id, optionId));
          await audit(tx, request, {
            action: 'custom_field_option.updated',
            targetType: 'custom_field_option',
            targetId: optionId,
            before: { fieldId, name: before.name, active: before.isActive },
            after: {
              fieldId,
              name: body.name ?? before.name,
              active: body.active ?? before.isActive,
            },
          });
          const [field] = await loadFields(tx, organisationId, fieldId);
          return field!;
        });
      } catch (error) {
        if (isUniqueViolation(error, 'custom_field_options_field_name_unique')) {
          throw optionTaken(body.name ?? '');
        }
        throw error;
      }
    },
  );

  app.put(
    '/api/v1/orgs/:orgId/custom-fields/:fieldId/options/order',
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request): Promise<CustomField> => {
      const fieldId = idParam(request, 'fieldId');
      const { ids } = parseBody(reorderIdsBodySchema, request.body);
      const organisationId = request.org!.organisationId;

      return db.transaction(async (tx) => {
        await lockSelectField(tx, organisationId, fieldId);
        const existing = await tx
          .select({ id: customFieldOptions.id })
          .from(customFieldOptions)
          .where(eq(customFieldOptions.fieldId, fieldId))
          .orderBy(asc(customFieldOptions.sortOrder));
        checkSameIds(
          ids,
          existing.map((row) => row.id),
          'option',
        );
        for (const [index, id] of ids.entries()) {
          await tx
            .update(customFieldOptions)
            .set({ sortOrder: index })
            .where(eq(customFieldOptions.id, id));
        }
        await audit(tx, request, {
          action: 'custom_field_option.reordered',
          targetType: 'custom_field',
          targetId: fieldId,
          before: { ids: existing.map((row) => row.id) },
          after: { ids },
        });
        const [field] = await loadFields(tx, organisationId, fieldId);
        return field!;
      });
    },
  );

  app.delete(
    '/api/v1/orgs/:orgId/custom-fields/:fieldId/options/:optionId',
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request): Promise<CustomField> => {
      const fieldId = idParam(request, 'fieldId');
      const optionId = idParam(request, 'optionId');
      const organisationId = request.org!.organisationId;

      return db.transaction(async (tx) => {
        // The field lock waits for any value being set on this field to finish first.
        await lockSelectField(tx, organisationId, fieldId);
        const option = await lockOption(tx, fieldId, optionId);
        const [used] = await tx
          .select({ ticketId: ticketFieldValues.ticketId })
          .from(ticketFieldValues)
          .where(
            and(
              eq(ticketFieldValues.fieldId, fieldId),
              sql`${optionId} = any(${ticketFieldValues.optionIds})`,
            ),
          )
          .limit(1);
        if (used) {
          throw new AppError(
            'conflict',
            `Tickets have "${option.name}" chosen, so it cannot be removed. Turn it off instead.`,
            409,
          );
        }
        await tx.delete(customFieldOptions).where(eq(customFieldOptions.id, optionId));
        await audit(tx, request, {
          action: 'custom_field_option.deleted',
          targetType: 'custom_field_option',
          targetId: optionId,
          before: { fieldId, name: option.name },
        });
        const [field] = await loadFields(tx, organisationId, fieldId);
        return field!;
      });
    },
  );

  // ---------------------------------------------------------------------------
  // A ticket's value
  // ---------------------------------------------------------------------------

  app.put(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/fields/:fieldId',
    { preHandler: orgAccess(db, 'tickets.edit') },
    async (request): Promise<TicketDetail> => {
      const org = request.org!;
      return setTicketFieldValue(db, {
        context: {
          organisationId: org.organisationId,
          actorUserId: org.actorUserId,
          permissions: org.permissions,
        },
        ticketKey: ticketKeyParam(request),
        fieldId: idParam(request, 'fieldId'),
        body: parseBody(setFieldValueBodySchema, request.body),
      });
    },
  );
}
