import {
  addTicketEvent,
  projectStatuses,
  projects,
  statusTransitions,
  tickets,
  type Db,
  type Executor,
} from '@forge/db';
import {
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABELS,
  normalizeProjectKey,
  statusKeyFromName,
  type CopyWorkflowBody,
  type CreateStatusBody,
  type DeactivateStatusBody,
  type ReorderStatusesBody,
  type SaveTransitionsBody,
  type StatusCategory,
  type TransitionRule,
  type UpdateStatusBody,
  type WorkflowConfig,
} from '@forge/shared';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../audit';
import { AppError } from '../errors';
import { invalid } from '../tickets/service';

// Workflow editing: a project's statuses and the moves between them. Every change runs under a
// lock on the project row, so two editors take turns; every change is checked against the rules
// that keep tickets from being stranded, bumps the workflow version and is audited.

/** Who is acting, in which workspace, and the request to name in the audit trail. */
export type WorkflowActor = { organisationId: string; actorUserId: string; requestId: string };

type ProjectRow = typeof projects.$inferSelect;
type StatusRow = typeof projectStatuses.$inferSelect;

const notFound = () => new AppError('not_found', 'Not found.', 404);
const conflict = (message: string) => new AppError('conflict', message, 409);

const ticketsWord = (n: number) => (n === 1 ? '1 ticket' : `${n} tickets`);

/** "A", "A and B", "A, B and C". */
const listOf = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

async function findProject(executor: Executor, organisationId: string, rawKey: string) {
  const key = normalizeProjectKey(rawKey);
  if (!key) return null;
  const [project] = await executor
    .select()
    .from(projects)
    .where(and(eq(projects.organisationId, organisationId), eq(projects.key, key)));
  return project ?? null;
}

/** The project row, locked for the rest of the transaction. Archived projects are frozen. */
async function lockProject(tx: Executor, organisationId: string, rawKey: string) {
  const key = normalizeProjectKey(rawKey);
  if (!key) throw notFound();
  const [project] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.organisationId, organisationId), eq(projects.key, key)))
    .for('update');
  if (!project) throw notFound();
  if (project.archivedAt) {
    throw conflict('This project is archived. Unarchive it to change its workflow.');
  }
  return project;
}

const statusesOf = (executor: Executor, projectId: string) =>
  executor
    .select()
    .from(projectStatuses)
    .where(eq(projectStatuses.projectId, projectId))
    .orderBy(asc(projectStatuses.sortOrder), asc(projectStatuses.key));

/** How many tickets (archived ones too) are in each status of the project. */
async function ticketCounts(executor: Executor, projectId: string): Promise<Map<string, number>> {
  const rows = await executor
    .select({ statusId: tickets.statusId, n: count() })
    .from(tickets)
    .where(eq(tickets.projectId, projectId))
    .groupBy(tickets.statusId);
  return new Map(rows.map((row) => [row.statusId, Number(row.n)]));
}

/** The project's whole workflow, inactive statuses and their moves included. */
export async function readWorkflowConfig(
  executor: Executor,
  project: Pick<ProjectRow, 'id' | 'key' | 'archivedAt' | 'workflowVersion'>,
): Promise<WorkflowConfig> {
  const [statuses, transitions, counts] = await Promise.all([
    statusesOf(executor, project.id),
    executor
      .select()
      .from(statusTransitions)
      .where(eq(statusTransitions.projectId, project.id))
      .orderBy(asc(statusTransitions.id)),
    ticketCounts(executor, project.id),
  ]);
  return {
    projectId: project.id,
    projectKey: project.key,
    archived: project.archivedAt !== null,
    version: project.workflowVersion,
    statuses: statuses.map((status) => ({
      id: status.id,
      key: status.key,
      name: status.name,
      category: status.category as StatusCategory,
      sortOrder: status.sortOrder,
      initial: status.isInitial,
      active: status.isActive,
      cancellation: status.isCancellation,
      ticketCount: counts.get(status.id) ?? 0,
    })),
    transitions: transitions.map((row) => ({
      fromStatusId: row.fromStatusId,
      toStatusId: row.toStatusId,
      rules: row.rules as TransitionRule[],
    })),
  };
}

export async function getWorkflow(
  db: Db,
  organisationId: string,
  projectKey: string,
): Promise<WorkflowConfig> {
  const project = await findProject(db, organisationId, projectKey);
  if (!project) throw notFound();
  return readWorkflowConfig(db, project);
}

/**
 * Refuses a workflow that could strand tickets or confuse people: active names must differ
 * ignoring case, exactly one status is initial and it is active and not started, and every
 * category keeps an active status. Run after each change, inside its transaction.
 */
async function assertSound(tx: Executor, projectId: string) {
  const statuses = await statusesOf(tx, projectId);
  const active = statuses.filter((status) => status.isActive);

  const seen = new Map<string, string>();
  for (const status of active) {
    const folded = status.name.toLowerCase();
    if (seen.has(folded)) {
      throw conflict(
        `Two active statuses would both be called "${status.name}". Rename one first.`,
      );
    }
    seen.set(folded, status.name);
  }

  const initial = statuses.filter((status) => status.isInitial);
  if (initial.length !== 1 || !initial[0]!.isActive || initial[0]!.category !== 'not_started') {
    throw conflict('New tickets need exactly one place to start: an active, not started status.');
  }

  for (const category of STATUS_CATEGORIES) {
    if (!active.some((status) => status.category === category)) {
      throw conflict(
        `A workflow needs at least one active status that is ${STATUS_CATEGORY_LABELS[category].toLowerCase()}.`,
      );
    }
  }
}

/**
 * Keeps completion dates true when a status changes category: tickets in a status that becomes
 * completed are completed now (if not already); tickets in one that stops being completed are not.
 */
async function syncCompletedAt(
  tx: Executor,
  statusId: string,
  from: string,
  to: string,
  now: Date,
) {
  if (from === to) return;
  if (to === 'completed') {
    await tx
      .update(tickets)
      .set({
        completedAt: sql`coalesce(${tickets.completedAt}, ${now.toISOString()}::timestamptz)`,
      })
      .where(eq(tickets.statusId, statusId));
  } else if (from === 'completed') {
    await tx.update(tickets).set({ completedAt: null }).where(eq(tickets.statusId, statusId));
  }
}

type Audit = { action: string; before?: unknown; after?: unknown };

/**
 * Runs one workflow change: locks the project, applies `apply`, checks the result is sound, bumps
 * the version and writes the audit event, all in one transaction. `apply` returns null when there
 * was nothing to do; then nothing is bumped or audited. Answers with the workflow as it now is.
 */
async function change(
  db: Db,
  actor: WorkflowActor,
  projectKey: string,
  apply: (tx: Executor, project: ProjectRow) => Promise<Audit | null>,
): Promise<WorkflowConfig> {
  return db.transaction(async (tx) => {
    const project = await lockProject(tx, actor.organisationId, projectKey);
    const audit = await apply(tx, project);
    if (audit) {
      await assertSound(tx, project.id);
      await tx
        .update(projects)
        .set({ workflowVersion: sql`${projects.workflowVersion} + 1` })
        .where(eq(projects.id, project.id));
      await recordAudit(tx, {
        organisationId: actor.organisationId,
        actorUserId: actor.actorUserId,
        action: audit.action,
        targetType: 'workflow',
        targetId: project.key,
        before: audit.before,
        after: audit.after,
        requestId: actor.requestId,
        source: 'user',
        outcome: 'success',
      });
    }
    const [fresh] = await tx.select().from(projects).where(eq(projects.id, project.id));
    return readWorkflowConfig(tx, fresh!);
  });
}

/** A status of this project by id, or a 404: a status id is only ever valid under its project. */
async function statusOf(tx: Executor, project: ProjectRow, statusId: string): Promise<StatusRow> {
  if (!z.uuid().safeParse(statusId).success) throw notFound();
  const [status] = await tx
    .select()
    .from(projectStatuses)
    .where(and(eq(projectStatuses.projectId, project.id), eq(projectStatuses.id, statusId)));
  if (!status) throw notFound();
  return status;
}

/** Refuses a name another active status of the project already has, ignoring case. */
function refuseTakenName(
  project: ProjectRow,
  statuses: StatusRow[],
  name: string,
  exceptId?: string,
) {
  const folded = name.toLowerCase();
  if (statuses.some((s) => s.isActive && s.id !== exceptId && s.name.toLowerCase() === folded)) {
    throw conflict(`The project ${project.key} already has a status named "${name}".`);
  }
}

const statusSnapshot = (status: StatusRow) => ({
  key: status.key,
  name: status.name,
  category: status.category,
  sortOrder: status.sortOrder,
  initial: status.isInitial,
  active: status.isActive,
});

export async function createStatus(
  db: Db,
  actor: WorkflowActor,
  projectKey: string,
  body: CreateStatusBody,
): Promise<{ workflow: WorkflowConfig; statusId: string }> {
  let statusId = '';
  const workflow = await change(db, actor, projectKey, async (tx, project) => {
    const statuses = await statusesOf(tx, project.id);
    refuseTakenName(project, statuses, body.name);
    const key = statusKeyFromName(
      body.name,
      statuses.map((status) => status.key),
    );
    const sortOrder = Math.max(0, ...statuses.map((status) => status.sortOrder)) + 1;
    const [row] = await tx
      .insert(projectStatuses)
      .values({
        organisationId: actor.organisationId,
        projectId: project.id,
        key,
        name: body.name,
        category: body.category,
        sortOrder,
      })
      .returning();
    statusId = row!.id;
    return { action: 'workflow.status_created', after: statusSnapshot(row!) };
  });
  return { workflow, statusId };
}

export async function updateStatus(
  db: Db,
  actor: WorkflowActor,
  projectKey: string,
  statusId: string,
  body: UpdateStatusBody,
): Promise<WorkflowConfig> {
  return change(db, actor, projectKey, async (tx, project) => {
    const status = await statusOf(tx, project, statusId);
    const statuses = await statusesOf(tx, project.id);
    const name = body.name !== undefined && body.name !== status.name ? body.name : undefined;
    const category =
      body.category !== undefined && body.category !== status.category ? body.category : undefined;
    const makeInitial = body.initial === true && !status.isInitial;
    if (name === undefined && category === undefined && !makeInitial) return null;

    // A rename may change only the case of the name; it still must not match another status.
    if (name !== undefined && status.isActive) refuseTakenName(project, statuses, name, status.id);
    if (category !== undefined && status.isInitial) {
      throw conflict(
        `${status.name} is where new tickets start, so it must stay not started. Make another status the initial one first.`,
      );
    }
    if (makeInitial && (!status.isActive || (category ?? status.category) !== 'not_started')) {
      throw conflict('Only an active, not started status can be where new tickets start.');
    }

    if (makeInitial) {
      // The partial unique index allows one initial at a time, so the old one lets go first.
      await tx
        .update(projectStatuses)
        .set({ isInitial: false })
        .where(and(eq(projectStatuses.projectId, project.id), eq(projectStatuses.isInitial, true)));
    }
    const [after] = await tx
      .update(projectStatuses)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(makeInitial ? { isInitial: true } : {}),
      })
      .where(eq(projectStatuses.id, status.id))
      .returning();
    if (category !== undefined) {
      await syncCompletedAt(tx, status.id, status.category, category, new Date());
    }
    return {
      action: 'workflow.status_updated',
      before: statusSnapshot(status),
      after: statusSnapshot(after!),
    };
  });
}

export async function reorderStatuses(
  db: Db,
  actor: WorkflowActor,
  projectKey: string,
  body: ReorderStatusesBody,
): Promise<WorkflowConfig> {
  return change(db, actor, projectKey, async (tx, project) => {
    const statuses = await statusesOf(tx, project.id);
    const known = new Set(statuses.map((status) => status.id));
    if (body.statusIds.length !== statuses.length || body.statusIds.some((id) => !known.has(id))) {
      throw invalid([{ path: 'statusIds', message: 'List every status of the project once.' }]);
    }
    if (statuses.every((status, index) => status.id === body.statusIds[index])) return null;
    for (const [index, id] of body.statusIds.entries()) {
      await tx
        .update(projectStatuses)
        .set({ sortOrder: index + 1 })
        .where(eq(projectStatuses.id, id));
    }
    const keyOf = new Map(statuses.map((status) => [status.id, status.key]));
    return {
      action: 'workflow.statuses_reordered',
      before: statuses.map((status) => status.key),
      after: body.statusIds.map((id) => keyOf.get(id)),
    };
  });
}

/**
 * Retires a status. Its tickets (archived ones too) move to the destination in the same
 * transaction, each with a history line, without workflow or rule checks: it is an
 * administrator's act. Its transitions are kept for when it comes back.
 */
export async function deactivateStatus(
  db: Db,
  actor: WorkflowActor,
  projectKey: string,
  statusId: string,
  body: DeactivateStatusBody,
): Promise<WorkflowConfig> {
  return change(db, actor, projectKey, async (tx, project) => {
    const status = await statusOf(tx, project, statusId);
    if (!status.isActive) return null;
    if (status.isInitial) {
      throw conflict(
        `${status.name} is where new tickets start. Make another status the initial one first.`,
      );
    }

    const held = await tx
      .select({ id: tickets.id, completedAt: tickets.completedAt })
      .from(tickets)
      .where(eq(tickets.statusId, status.id))
      .for('update');

    let destination: StatusRow | undefined;
    if (held.length > 0) {
      if (!body.destinationStatusId) {
        throw invalid([
          {
            path: 'destinationStatusId',
            message: `${status.name} has ${ticketsWord(held.length)}. Choose an active status for them to move to.`,
          },
        ]);
      }
      [destination] = await tx
        .select()
        .from(projectStatuses)
        .where(
          and(
            eq(projectStatuses.projectId, project.id),
            eq(projectStatuses.id, body.destinationStatusId),
            eq(projectStatuses.isActive, true),
          ),
        );
      if (!destination || destination.id === status.id) {
        throw invalid([
          {
            path: 'destinationStatusId',
            message: 'Choose another active status of this project for its tickets.',
          },
        ]);
      }

      const now = new Date();
      await tx
        .update(tickets)
        .set({
          statusId: destination.id,
          completedAt:
            destination.category === 'completed'
              ? sql`coalesce(${tickets.completedAt}, ${now.toISOString()}::timestamptz)`
              : null,
          statusBeforeJamId: null,
          version: sql`${tickets.version} + 1`,
          updatedAt: now,
        })
        .where(eq(tickets.statusId, status.id));
      for (const ticket of held) {
        await addTicketEvent(tx, {
          organisationId: actor.organisationId,
          ticketId: ticket.id,
          actorUserId: actor.actorUserId,
          event: {
            type: 'ticket.status_retired',
            data: {
              from: { id: status.id, name: status.name },
              to: { id: destination.id, name: destination.name },
            },
          },
          createdAt: now,
        });
      }
    }

    await tx
      .update(projectStatuses)
      .set({ isActive: false })
      .where(eq(projectStatuses.id, status.id));
    return {
      action: 'workflow.status_deactivated',
      before: statusSnapshot(status),
      after: {
        ...statusSnapshot({ ...status, isActive: false }),
        movedTickets: held.length,
        destination: destination?.key ?? null,
      },
    };
  });
}

/** Brings a status back as it was, its transitions included. */
export async function reactivateStatus(
  db: Db,
  actor: WorkflowActor,
  projectKey: string,
  statusId: string,
): Promise<WorkflowConfig> {
  return change(db, actor, projectKey, async (tx, project) => {
    const status = await statusOf(tx, project, statusId);
    if (status.isActive) return null;
    refuseTakenName(project, await statusesOf(tx, project.id), status.name, status.id);
    await tx
      .update(projectStatuses)
      .set({ isActive: true })
      .where(eq(projectStatuses.id, status.id));
    return {
      action: 'workflow.status_reactivated',
      before: statusSnapshot(status),
      after: statusSnapshot({ ...status, isActive: true }),
    };
  });
}

const staleWorkflow = (version: number) =>
  new AppError(
    'conflict',
    'This workflow was changed by someone else. Reload it to see the latest version.',
    409,
    [{ path: 'version', message: `The workflow is now at version ${version}.` }],
  );

/** "open>in_progress" with its rules, for the audit trail. */
const describeTransition = (
  keyOf: Map<string, string>,
  t: { fromStatusId: string; toStatusId: string; rules: readonly string[] },
) =>
  `${keyOf.get(t.fromStatusId)}>${keyOf.get(t.toStatusId)}${t.rules.length > 0 ? ` [${[...t.rules].sort().join(', ')}]` : ''}`;

/**
 * Saves the whole grid between active statuses, against the version the person was looking at.
 * Moves to or from inactive statuses are kept as they are and cannot be sent.
 */
export async function saveTransitions(
  db: Db,
  actor: WorkflowActor,
  projectKey: string,
  body: SaveTransitionsBody,
): Promise<WorkflowConfig> {
  return change(db, actor, projectKey, async (tx, project) => {
    if (body.version !== project.workflowVersion) throw staleWorkflow(project.workflowVersion);

    const statuses = await statusesOf(tx, project.id);
    const active = new Set(statuses.filter((s) => s.isActive).map((s) => s.id));
    const keyOf = new Map(statuses.map((s) => [s.id, s.key]));

    const pairs = new Set<string>();
    for (const [index, t] of body.transitions.entries()) {
      const path = `transitions.${index}`;
      if (!active.has(t.fromStatusId) || !active.has(t.toStatusId)) {
        throw invalid([
          { path, message: 'A move must be between active statuses of this project.' },
        ]);
      }
      if (t.fromStatusId === t.toStatusId) {
        throw invalid([{ path, message: 'A status cannot move to itself.' }]);
      }
      const pair = `${t.fromStatusId}>${t.toStatusId}`;
      if (pairs.has(pair)) throw invalid([{ path, message: 'Each move may be listed only once.' }]);
      pairs.add(pair);
    }

    const existing = (
      await tx.select().from(statusTransitions).where(eq(statusTransitions.projectId, project.id))
    ).filter((t) => active.has(t.fromStatusId) && active.has(t.toStatusId));
    const sortRules = (rules: readonly string[]) => [...rules].sort();
    const before = existing.map((t) => describeTransition(keyOf, t)).sort();
    const after = body.transitions
      .map((t) => describeTransition(keyOf, { ...t, rules: sortRules(t.rules) }))
      .sort();
    if (before.length === after.length && before.every((line, i) => line === after[i])) {
      return null;
    }

    if (existing.length > 0) {
      await tx.delete(statusTransitions).where(
        inArray(
          statusTransitions.id,
          existing.map((t) => t.id),
        ),
      );
    }
    if (body.transitions.length > 0) {
      await tx.insert(statusTransitions).values(
        body.transitions.map((t) => ({
          organisationId: actor.organisationId,
          projectId: project.id,
          fromStatusId: t.fromStatusId,
          toStatusId: t.toStatusId,
          rules: sortRules(t.rules),
        })),
      );
    }
    return { action: 'workflow.transitions_saved', before, after };
  });
}

/**
 * Makes this project's workflow a copy of another's. Statuses are matched by key: names,
 * categories, order, active flags and the initial status come from the source, and its missing
 * keys are added. A status only this project has is deactivated if it is empty; if it holds
 * tickets the copy is refused, naming it. The transitions and their rules are the source's.
 */
export async function copyWorkflow(
  db: Db,
  actor: WorkflowActor,
  projectKey: string,
  body: CopyWorkflowBody,
): Promise<WorkflowConfig> {
  return change(db, actor, projectKey, async (tx, project) => {
    const source = await findProject(tx, actor.organisationId, body.sourceProjectKey);
    if (!source) {
      throw invalid([{ path: 'sourceProjectKey', message: 'There is no project with that key.' }]);
    }
    if (source.id === project.id) {
      throw invalid([
        { path: 'sourceProjectKey', message: 'Choose another project to copy from.' },
      ]);
    }

    const [sourceStatuses, sourceTransitions, targetStatuses, counts] = await Promise.all([
      statusesOf(tx, source.id),
      tx.select().from(statusTransitions).where(eq(statusTransitions.projectId, source.id)),
      statusesOf(tx, project.id),
      ticketCounts(tx, project.id),
    ]);
    const sourceByKey = new Map(sourceStatuses.map((s) => [s.key, s]));

    // Tickets must never be left in a status the copy makes inactive.
    const stranded = targetStatuses.filter((status) => {
      const from = sourceByKey.get(status.key);
      const activeAfter = from ? from.isActive : false;
      return status.isActive && !activeAfter && (counts.get(status.id) ?? 0) > 0;
    });
    if (stranded.length > 0) {
      throw conflict(
        `The copy would leave tickets in statuses that are not active: ${listOf(
          stranded.map((s) => `${s.name} (${ticketsWord(counts.get(s.id) ?? 0)})`),
        )}. Deactivate them here first, choosing where their tickets go.`,
      );
    }

    const before = await readWorkflowConfig(tx, project);
    const now = new Date();
    await tx
      .update(projectStatuses)
      .set({ isInitial: false })
      .where(eq(projectStatuses.projectId, project.id));

    const idByKey = new Map<string, string>();
    const targetByKey = new Map(targetStatuses.map((s) => [s.key, s]));
    for (const from of sourceStatuses) {
      const values = {
        name: from.name,
        category: from.category,
        sortOrder: from.sortOrder,
        isActive: from.isActive,
        isInitial: from.isInitial,
      };
      const match = targetByKey.get(from.key);
      if (match) {
        await tx.update(projectStatuses).set(values).where(eq(projectStatuses.id, match.id));
        await syncCompletedAt(tx, match.id, match.category, from.category, now);
        idByKey.set(from.key, match.id);
      } else {
        const [row] = await tx
          .insert(projectStatuses)
          .values({
            organisationId: actor.organisationId,
            projectId: project.id,
            key: from.key,
            isCancellation: from.isCancellation,
            ...values,
          })
          .returning({ id: projectStatuses.id });
        idByKey.set(from.key, row!.id);
      }
    }
    // What only this project has goes quiet (it is empty, checked above), after the source's.
    const leftovers = targetStatuses.filter((s) => !sourceByKey.has(s.key));
    for (const [index, status] of leftovers.entries()) {
      await tx
        .update(projectStatuses)
        .set({
          isActive: false,
          sortOrder: Math.max(0, ...sourceStatuses.map((s) => s.sortOrder)) + index + 1,
        })
        .where(eq(projectStatuses.id, status.id));
    }

    await tx.delete(statusTransitions).where(eq(statusTransitions.projectId, project.id));
    const keyOfSource = new Map(sourceStatuses.map((s) => [s.id, s.key]));
    if (sourceTransitions.length > 0) {
      await tx.insert(statusTransitions).values(
        sourceTransitions.map((t) => ({
          organisationId: actor.organisationId,
          projectId: project.id,
          fromStatusId: idByKey.get(keyOfSource.get(t.fromStatusId)!)!,
          toStatusId: idByKey.get(keyOfSource.get(t.toStatusId)!)!,
          rules: t.rules,
        })),
      );
    }

    return {
      action: 'workflow.copied',
      before: {
        statuses: before.statuses.map((s) => `${s.key}:${s.name}${s.active ? '' : ' (inactive)'}`),
        transitions: before.transitions.length,
      },
      after: {
        from: source.key,
        statuses: sourceStatuses.map((s) => `${s.key}:${s.name}${s.isActive ? '' : ' (inactive)'}`),
        deactivated: leftovers.map((s) => s.key),
        transitions: sourceTransitions.length,
      },
    };
  });
}
