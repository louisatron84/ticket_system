import {
  components,
  labels,
  priorities,
  projects,
  ticketLabels,
  ticketTypes,
  tickets,
  users,
  type Db,
  type Executor,
} from '@forge/db';
import {
  createPriorityBodySchema,
  createTicketTypeBodySchema,
  mergeLabelBodySchema,
  normalizeProjectKey,
  reorderSettingsBodySchema,
  settingKeyFromName,
  updateComponentBodySchema,
  updateLabelBodySchema,
  updatePriorityBodySchema,
  updateTicketTypeBodySchema,
  type ComponentSetting,
  type Label,
  type LabelDeleteResult,
  type LabelMergeResult,
  type LabelSetting,
  type PrioritySetting,
  type ProjectComponentSettings,
  type TicketTypeSetting,
  type WorkspaceTicketSettings,
} from '@forge/shared';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { orgAccess } from '../auth/guards';
import { isUniqueViolation } from '../db-errors';
import { AppError } from '../errors';
import { ticketViewers } from '../tickets/component-assignee';
import { parseBody } from '../validation';
import { together } from '../together';

// P4 workspace ticket settings (types, priorities, labels; `fields.manage`) and component
// settings (`projects.manage`). See docs/superpowers/specs/2026-10-29-p4-configuration-design.md.
// Types and priorities are never deleted, only deactivated: tickets and their history name them.

const notFound = () => new AppError('not_found', 'Not found.', 404);

/** A workspace may have at most this many types, and as many priorities. */
const MAX_SETTINGS = 50;

function uuidParam(request: FastifyRequest, name: string): string {
  const parsed = z.uuid().safeParse((request.params as Record<string, string>)[name]);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

const invalidField = (path: string, message: string) =>
  new AppError('validation_failed', message, 422, [{ path, message }]);

/** How many tickets (archived ones included) use each value of a column, by id. */
async function countsBy(
  executor: Executor,
  column: typeof tickets.typeId | typeof tickets.priorityId | typeof tickets.componentId,
  where: SQL | undefined,
): Promise<Map<string, number>> {
  const rows = await executor
    .select({ id: column, count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(where)
    .groupBy(column);
  return new Map(rows.filter((row) => row.id !== null).map((row) => [row.id!, row.count]));
}

// ---------------------------------------------------------------------------
// Types and priorities: the same rules, two tables
// ---------------------------------------------------------------------------

/** A type or a priority, with `order` standing for its sort order or its rank. */
type SettingRow = { id: string; key: string; name: string; order: number; isActive: boolean };

type SettingKind<Setting> = {
  /** In sentences: "ticket type", "priority". */
  noun: string;
  /** In the address: /ticket-types, /priorities. */
  path: string;
  /** In audit actions: ticket_type.created, priority.updated. */
  audit: string;
  /** The key of a type or priority whose name leaves nothing to make a key from. */
  fallbackKey: string;
  /** Every one in the workspace, in order (for priorities: least urgent first). */
  list(executor: Executor, organisationId: string): Promise<SettingRow[]>;
  insert(
    executor: Executor,
    values: { organisationId: string; key: string; name: string; order: number },
  ): Promise<void>;
  update(
    executor: Executor,
    id: string,
    changes: { name?: string; isActive?: boolean; order?: number },
  ): Promise<void>;
  counts(executor: Executor, organisationId: string): Promise<Map<string, number>>;
  toSetting(row: SettingRow, ticketCount: number): Setting;
};

const typeKind: SettingKind<TicketTypeSetting> = {
  noun: 'ticket type',
  path: 'ticket-types',
  audit: 'ticket_type',
  fallbackKey: 'type',
  list: (executor, organisationId) =>
    executor
      .select({
        id: ticketTypes.id,
        key: ticketTypes.key,
        name: ticketTypes.name,
        order: ticketTypes.sortOrder,
        isActive: ticketTypes.isActive,
      })
      .from(ticketTypes)
      .where(eq(ticketTypes.organisationId, organisationId))
      .orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.name)),
  async insert(executor, values) {
    await executor.insert(ticketTypes).values({
      organisationId: values.organisationId,
      key: values.key,
      name: values.name,
      sortOrder: values.order,
    });
  },
  async update(executor, id, changes) {
    await executor
      .update(ticketTypes)
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.isActive !== undefined ? { isActive: changes.isActive } : {}),
        ...(changes.order !== undefined ? { sortOrder: changes.order } : {}),
      })
      .where(eq(ticketTypes.id, id));
  },
  counts: (executor, organisationId) =>
    countsBy(executor, tickets.typeId, eq(tickets.organisationId, organisationId)),
  toSetting: (row, ticketCount) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    sortOrder: row.order,
    active: row.isActive,
    ticketCount,
  }),
};

const priorityKind: SettingKind<PrioritySetting> = {
  noun: 'priority',
  path: 'priorities',
  audit: 'priority',
  fallbackKey: 'priority',
  list: (executor, organisationId) =>
    executor
      .select({
        id: priorities.id,
        key: priorities.key,
        name: priorities.name,
        order: priorities.rank,
        isActive: priorities.isActive,
      })
      .from(priorities)
      .where(eq(priorities.organisationId, organisationId))
      .orderBy(asc(priorities.rank), asc(priorities.name)),
  async insert(executor, values) {
    await executor.insert(priorities).values({
      organisationId: values.organisationId,
      key: values.key,
      name: values.name,
      rank: values.order,
    });
  },
  async update(executor, id, changes) {
    await executor
      .update(priorities)
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.isActive !== undefined ? { isActive: changes.isActive } : {}),
        ...(changes.order !== undefined ? { rank: changes.order } : {}),
      })
      .where(eq(priorities.id, id));
  },
  counts: (executor, organisationId) =>
    countsBy(executor, tickets.priorityId, eq(tickets.organisationId, organisationId)),
  toSetting: (row, ticketCount) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    rank: row.order,
    active: row.isActive,
    ticketCount,
  }),
};

/**
 * One editor at a time per workspace and kind. Names are unique ignoring case, and at least one
 * must stay active; neither has an index to lean on, so the check and the write share this lock.
 */
async function lockKind(tx: Executor, kind: SettingKind<unknown>, organisationId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`ticket-settings:${kind.path}:${organisationId}`}))`,
  );
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function settingsOf<Setting>(
  executor: Executor,
  kind: SettingKind<Setting>,
  organisationId: string,
): Promise<Setting[]> {
  const [rows, counts] = await together(executor, [
    () => kind.list(executor, organisationId),
    () => kind.counts(executor, organisationId),
  ]);
  return rows.map((row) => kind.toSetting(row, counts.get(row.id) ?? 0));
}

function registerSettingKind<Setting extends { id: string }>(
  app: FastifyInstance,
  db: Db,
  kind: SettingKind<Setting>,
  bodies: {
    create: typeof createTicketTypeBodySchema | typeof createPriorityBodySchema;
    update: typeof updateTicketTypeBodySchema | typeof updatePriorityBodySchema;
  },
): void {
  const base = `/api/v1/orgs/:orgId/${kind.path}`;
  const nameTaken = (name: string) =>
    new AppError('conflict', `A ${kind.noun} named "${name}" already exists.`, 409);

  app.post(
    base,
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request, reply): Promise<Setting> => {
      const body = parseBody(bodies.create, request.body);
      const org = request.org!;

      const created = await db.transaction(async (tx) => {
        await lockKind(tx, kind, org.organisationId);
        const rows = await kind.list(tx, org.organisationId);
        if (rows.some((row) => sameName(row.name, body.name))) throw nameTaken(body.name);
        if (rows.length >= MAX_SETTINGS) {
          throw new AppError(
            'conflict',
            `A workspace can have at most ${MAX_SETTINGS} of these. Rename or reactivate one instead.`,
            409,
          );
        }
        const key = settingKeyFromName(
          body.name,
          rows.map((row) => row.key),
          kind.fallbackKey,
        );
        // At the end of the list (for priorities: the most urgent); reordering moves it.
        const order = Math.max(0, ...rows.map((row) => row.order)) + 1;
        await kind.insert(tx, { organisationId: org.organisationId, key, name: body.name, order });
        await recordAudit(tx, {
          organisationId: org.organisationId,
          actorUserId: org.actorUserId,
          action: `${kind.audit}.created`,
          targetType: kind.audit,
          targetId: key,
          after: { key, name: body.name },
          requestId: request.id,
          source: 'user',
          outcome: 'success',
        });
        const [row] = (await kind.list(tx, org.organisationId)).filter((r) => r.key === key);
        return kind.toSetting(row!, 0);
      });
      reply.status(201);
      return created;
    },
  );

  app.patch(
    `${base}/:settingId`,
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request): Promise<Setting> => {
      const id = uuidParam(request, 'settingId');
      const body = parseBody(bodies.update, request.body);
      const org = request.org!;

      return db.transaction(async (tx) => {
        await lockKind(tx, kind, org.organisationId);
        const rows = await kind.list(tx, org.organisationId);
        const before = rows.find((row) => row.id === id);
        if (!before) throw notFound();

        if (
          body.name !== undefined &&
          rows.some((row) => row.id !== id && sameName(row.name, body.name!))
        ) {
          throw nameTaken(body.name);
        }
        // Tickets keep an inactive one, but new tickets need something to choose.
        if (
          body.active === false &&
          before.isActive &&
          !rows.some((row) => row.id !== id && row.isActive)
        ) {
          throw new AppError(
            'conflict',
            `${before.name} is the last active ${kind.noun}. Add or reactivate another first.`,
            409,
          );
        }

        const changes = {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.active !== undefined ? { isActive: body.active } : {}),
        };
        await kind.update(tx, id, changes);
        const after = { ...before, ...changes };
        await recordAudit(tx, {
          organisationId: org.organisationId,
          actorUserId: org.actorUserId,
          action: `${kind.audit}.updated`,
          targetType: kind.audit,
          targetId: before.key,
          before: { name: before.name, active: before.isActive },
          after: { name: after.name, active: after.isActive },
          requestId: request.id,
          source: 'user',
          outcome: 'success',
        });
        const counts = await kind.counts(tx, org.organisationId);
        return kind.toSetting(after, counts.get(id) ?? 0);
      });
    },
  );

  app.put(
    `${base}/order`,
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request): Promise<Setting[]> => {
      const body = parseBody(reorderSettingsBodySchema, request.body);
      const org = request.org!;

      return db.transaction(async (tx) => {
        await lockKind(tx, kind, org.organisationId);
        const rows = await kind.list(tx, org.organisationId);
        const known = new Set(rows.map((row) => row.id));
        if (body.ids.length !== rows.length || body.ids.some((id) => !known.has(id))) {
          throw invalidField('ids', `List every ${kind.noun} of the workspace, each once.`);
        }
        for (const [index, id] of body.ids.entries()) {
          const row = rows.find((candidate) => candidate.id === id)!;
          if (row.order !== index + 1) await kind.update(tx, id, { order: index + 1 });
        }
        await recordAudit(tx, {
          organisationId: org.organisationId,
          actorUserId: org.actorUserId,
          action: `${kind.audit}.reordered`,
          targetType: kind.audit,
          before: { order: rows.map((row) => row.key) },
          after: { order: body.ids.map((id) => rows.find((row) => row.id === id)!.key) },
          requestId: request.id,
          source: 'user',
          outcome: 'success',
        });
        return settingsOf(tx, kind, org.organisationId);
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

async function labelSettings(executor: Executor, organisationId: string): Promise<LabelSetting[]> {
  const rows = await executor
    .select({
      id: labels.id,
      name: labels.name,
      color: labels.color,
      ticketCount: sql<number>`count(${ticketLabels.ticketId})::int`,
    })
    .from(labels)
    .leftJoin(ticketLabels, eq(ticketLabels.labelId, labels.id))
    .where(eq(labels.organisationId, organisationId))
    .groupBy(labels.id)
    .orderBy(asc(sql`lower(${labels.name})`));
  return rows as LabelSetting[];
}

const labelFields = { id: labels.id, name: labels.name, color: labels.color };

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

async function projectIdFor(executor: Executor, organisationId: string, rawKey: string) {
  const key = normalizeProjectKey(rawKey);
  if (!key) throw notFound();
  const [project] = await executor
    .select({ id: projects.id, key: projects.key })
    .from(projects)
    .where(and(eq(projects.organisationId, organisationId), eq(projects.key, key)));
  if (!project) throw notFound();
  return project;
}

async function componentSettings(
  executor: Executor,
  organisationId: string,
  projectId: string,
): Promise<ProjectComponentSettings> {
  const [rows, people, counts] = await together(executor, [
    () =>
      executor
        .select({
          id: components.id,
          projectId: components.projectId,
          name: components.name,
          active: components.isActive,
          leadId: components.leadId,
          defaultAssigneeId: components.defaultAssigneeId,
        })
        .from(components)
        .where(
          and(eq(components.organisationId, organisationId), eq(components.projectId, projectId)),
        )
        .orderBy(asc(components.name)),
    () => ticketViewers(executor, organisationId),
    () =>
      countsBy(
        executor,
        tickets.componentId,
        and(eq(tickets.organisationId, organisationId), eq(tickets.projectId, projectId)),
      ),
  ]);
  // A lead or default assignee whose role no longer lets them see tickets is still named, so
  // the page shows the truth; they are simply not offered again.
  const names = new Map(people.map((person) => [person.id, person.displayName]));
  const missing = rows
    .flatMap((row) => [row.leadId, row.defaultAssigneeId])
    .filter((id): id is string => id !== null && !names.has(id));
  if (missing.length > 0) {
    const extra = await executor
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, [...new Set(missing)]));
    for (const person of extra) names.set(person.id, person.displayName);
  }
  const person = (id: string | null) =>
    id === null ? null : { id, displayName: names.get(id) ?? 'Unknown' };

  return {
    components: rows.map((row): ComponentSetting => ({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      active: row.active,
      lead: person(row.leadId),
      defaultAssignee: person(row.defaultAssigneeId),
      ticketCount: counts.get(row.id) ?? 0,
    })),
    people,
  };
}

export function registerWorkspaceConfigRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  app.get(
    '/api/v1/orgs/:orgId/ticket-settings',
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request): Promise<WorkspaceTicketSettings> => {
      const organisationId = request.org!.organisationId;
      const [types, ranked, labelRows] = await Promise.all([
        settingsOf(db, typeKind, organisationId),
        settingsOf(db, priorityKind, organisationId),
        labelSettings(db, organisationId),
      ]);
      return { types, priorities: ranked, labels: labelRows };
    },
  );

  registerSettingKind(app, db, typeKind, {
    create: createTicketTypeBodySchema,
    update: updateTicketTypeBodySchema,
  });
  registerSettingKind(app, db, priorityKind, {
    create: createPriorityBodySchema,
    update: updatePriorityBodySchema,
  });

  // Labels are tags, not history: a rename, a merge or a delete really changes the tickets.

  app.patch(
    '/api/v1/orgs/:orgId/labels/:labelId',
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request): Promise<Label> => {
      const id = uuidParam(request, 'labelId');
      const body = parseBody(updateLabelBodySchema, request.body);
      const org = request.org!;

      try {
        return await db.transaction(async (tx) => {
          const [before] = await tx
            .select(labelFields)
            .from(labels)
            .where(and(eq(labels.organisationId, org.organisationId), eq(labels.id, id)))
            .for('update');
          if (!before) throw notFound();
          const [row] = await tx
            .update(labels)
            .set({
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.color !== undefined ? { color: body.color } : {}),
            })
            .where(eq(labels.id, id))
            .returning(labelFields);
          await recordAudit(tx, {
            organisationId: org.organisationId,
            actorUserId: org.actorUserId,
            action: 'label.updated',
            targetType: 'label',
            targetId: id,
            before: { name: before.name, color: before.color },
            after: { name: row!.name, color: row!.color },
            requestId: request.id,
            source: 'user',
            outcome: 'success',
          });
          return row as Label;
        });
      } catch (error) {
        if (isUniqueViolation(error, 'labels_organisation_name_unique')) {
          throw new AppError('conflict', `A label named "${body.name}" already exists.`, 409);
        }
        throw error;
      }
    },
  );

  app.post(
    '/api/v1/orgs/:orgId/labels/:labelId/merge',
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request): Promise<LabelMergeResult> => {
      const id = uuidParam(request, 'labelId');
      const body = parseBody(mergeLabelBodySchema, request.body);
      const org = request.org!;

      return db.transaction(async (tx) => {
        // Both rows locked in one statement, in id order, so two opposite merges cannot deadlock.
        const locked = await tx
          .select(labelFields)
          .from(labels)
          .where(
            and(
              eq(labels.organisationId, org.organisationId),
              inArray(labels.id, [id, body.intoId]),
            ),
          )
          .orderBy(asc(labels.id))
          .for('update');
        const source = locked.find((row) => row.id === id);
        if (!source) throw notFound();
        if (body.intoId === id) {
          throw invalidField('intoId', 'A label cannot be merged into itself.');
        }
        const target = locked.find((row) => row.id === body.intoId);
        if (!target) throw invalidField('intoId', 'Unknown label.');

        const had = await tx
          .select({ ticketId: ticketLabels.ticketId })
          .from(ticketLabels)
          .where(eq(ticketLabels.labelId, source.id));
        if (had.length > 0) {
          await tx
            .insert(ticketLabels)
            .values(
              had.map((row) => ({
                organisationId: org.organisationId,
                ticketId: row.ticketId,
                labelId: target.id,
              })),
            )
            .onConflictDoNothing();
        }
        await tx.delete(ticketLabels).where(eq(ticketLabels.labelId, source.id));
        await tx.delete(labels).where(eq(labels.id, source.id));
        await recordAudit(tx, {
          organisationId: org.organisationId,
          actorUserId: org.actorUserId,
          action: 'label.merged',
          targetType: 'label',
          targetId: source.id,
          before: { name: source.name, color: source.color },
          after: { into: { id: target.id, name: target.name }, ticketCount: had.length },
          requestId: request.id,
          source: 'user',
          outcome: 'success',
        });
        return { label: target as Label, ticketCount: had.length };
      });
    },
  );

  app.delete(
    '/api/v1/orgs/:orgId/labels/:labelId',
    { preHandler: orgAccess(db, 'fields.manage') },
    async (request): Promise<LabelDeleteResult> => {
      const id = uuidParam(request, 'labelId');
      const org = request.org!;

      return db.transaction(async (tx) => {
        const [label] = await tx
          .select(labelFields)
          .from(labels)
          .where(and(eq(labels.organisationId, org.organisationId), eq(labels.id, id)))
          .for('update');
        if (!label) throw notFound();
        const removed = await tx
          .delete(ticketLabels)
          .where(eq(ticketLabels.labelId, id))
          .returning({ ticketId: ticketLabels.ticketId });
        await tx.delete(labels).where(eq(labels.id, id));
        await recordAudit(tx, {
          organisationId: org.organisationId,
          actorUserId: org.actorUserId,
          action: 'label.deleted',
          targetType: 'label',
          targetId: id,
          before: { name: label.name, color: label.color },
          after: { ticketCount: removed.length },
          requestId: request.id,
          source: 'user',
          outcome: 'success',
        });
        return { ticketCount: removed.length };
      });
    },
  );

  // Components belong to a project, so they are the project managers' to change.

  app.get(
    '/api/v1/orgs/:orgId/projects/:projectKey/components',
    { preHandler: orgAccess(db, 'projects.manage') },
    async (request): Promise<ProjectComponentSettings> => {
      const organisationId = request.org!.organisationId;
      const project = await projectIdFor(
        db,
        organisationId,
        (request.params as { projectKey: string }).projectKey,
      );
      return componentSettings(db, organisationId, project.id);
    },
  );

  app.patch(
    '/api/v1/orgs/:orgId/projects/:projectKey/components/:componentId',
    { preHandler: orgAccess(db, 'projects.manage') },
    async (request): Promise<ComponentSetting> => {
      const id = uuidParam(request, 'componentId');
      const body = parseBody(updateComponentBodySchema, request.body);
      const org = request.org!;

      try {
        return await db.transaction(async (tx) => {
          const project = await projectIdFor(
            tx,
            org.organisationId,
            (request.params as { projectKey: string }).projectKey,
          );
          const [before] = await tx
            .select()
            .from(components)
            .where(
              and(
                eq(components.organisationId, org.organisationId),
                eq(components.projectId, project.id),
                eq(components.id, id),
              ),
            )
            .for('update');
          if (!before) throw notFound();

          const viewers = new Set(
            (await ticketViewers(tx, org.organisationId)).map((person) => person.id),
          );
          const issues = (['leadId', 'defaultAssigneeId'] as const)
            .filter((field) => body[field] && !viewers.has(body[field]))
            .map((field) => ({ path: field, message: 'Choose a member who can see tickets.' }));
          if (issues.length > 0) {
            throw new AppError('validation_failed', issues[0]!.message, 422, issues);
          }

          await tx
            .update(components)
            .set({
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.active !== undefined ? { isActive: body.active } : {}),
              ...(body.leadId !== undefined ? { leadId: body.leadId } : {}),
              ...(body.defaultAssigneeId !== undefined
                ? { defaultAssigneeId: body.defaultAssigneeId }
                : {}),
            })
            .where(eq(components.id, id));
          const settings = await componentSettings(tx, org.organisationId, project.id);
          const after = settings.components.find((component) => component.id === id)!;
          await recordAudit(tx, {
            organisationId: org.organisationId,
            actorUserId: org.actorUserId,
            action: 'component.updated',
            targetType: 'component',
            targetId: id,
            before: {
              project: project.key,
              name: before.name,
              active: before.isActive,
              leadId: before.leadId,
              defaultAssigneeId: before.defaultAssigneeId,
            },
            after: {
              project: project.key,
              name: after.name,
              active: after.active,
              leadId: after.lead?.id ?? null,
              defaultAssigneeId: after.defaultAssignee?.id ?? null,
            },
            requestId: request.id,
            source: 'user',
            outcome: 'success',
          });
          return after;
        });
      } catch (error) {
        if (isUniqueViolation(error, 'components_project_name_unique')) {
          throw new AppError(
            'conflict',
            `This project already has a component named "${body.name}".`,
            409,
          );
        }
        throw error;
      }
    },
  );
}
