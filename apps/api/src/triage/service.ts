import {
  addTicketEvent,
  labels,
  organisationMemberships,
  priorities,
  projectStatuses,
  projects,
  roles,
  ticketLabels,
  ticketTypes,
  tickets,
  triageProposals,
  triageRota,
  triageRules,
  users,
  type Db,
  type Executor,
} from '@forge/db';
import {
  hasPermission,
  onDutyIndex,
  ruleMatches,
  triageRuleActionsSchema,
  triageRuleConditionsSchema,
  type DecideBody,
  type ProposeBody,
  type TicketChange,
  type TicketEvent,
  type TicketSummary,
  type TriageSettings,
  type TriageSettingsBody,
} from '@forge/shared';
import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { AppError } from '../errors';
import { autoWatch, notify, type NotificationDraft } from '../notifications/service';
import { ticketUpdated } from '../notifications/ticket-activity';
import { loadTicketSummaries } from '../tickets/read';
import { findReferenceIssues, invalid, type TicketContext } from '../tickets/service';
import { canonicalKey, markDuplicateIn } from '../tickets/structure';
import { summarise } from './words';

const notFound = () => new AppError('not_found', 'Not found.', 404);
const conflict = (message: string) => new AppError('conflict', message, 409);

type TriageTicket = {
  id: string;
  key: string;
  title: string;
  projectId: string;
  reporterId: string;
  typeId: string;
  statusId: string;
  assigneeId: string | null;
  priorityId: string;
  triageState: string | null;
  archivedAt: Date | null;
};

async function lockTicket(tx: Executor, organisationId: string, key: string) {
  const [ticket] = await tx
    .select({
      id: tickets.id,
      key: tickets.key,
      title: tickets.title,
      projectId: tickets.projectId,
      reporterId: tickets.reporterId,
      typeId: tickets.typeId,
      statusId: tickets.statusId,
      assigneeId: tickets.assigneeId,
      priorityId: tickets.priorityId,
      triageState: tickets.triageState,
      archivedAt: tickets.archivedAt,
    })
    .from(tickets)
    .where(and(eq(tickets.organisationId, organisationId), eq(tickets.key, key)))
    .for('update');
  if (!ticket) throw notFound();
  return ticket as TriageTicket;
}

function recorder(tx: Executor, organisationId: string, ticketId: string, actorId: string | null) {
  let tick = 0;
  const now = Date.now();
  return (event: TicketEvent) =>
    addTicketEvent(tx, {
      organisationId,
      ticketId,
      actorUserId: actorId,
      source: actorId ? 'user' : 'system',
      event,
      createdAt: new Date(now + tick++),
    });
}

/** Members whose role may edit tickets: the people who can triage and approve. */
async function editorIds(tx: Executor, organisationId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: organisationMemberships.userId })
    .from(organisationMemberships)
    .innerJoin(roles, eq(roles.id, organisationMemberships.roleId))
    .where(
      and(
        eq(organisationMemberships.organisationId, organisationId),
        sql`'tickets.edit' = any(${roles.permissions})`,
      ),
    );
  return rows.map((row) => row.userId);
}

/** The rota in order, and who is on duty now. */
async function rotaOf(tx: Executor, projectId: string, now = new Date()) {
  const rota = await tx
    .select({ id: users.id, displayName: users.displayName })
    .from(triageRota)
    .innerJoin(users, eq(users.id, triageRota.userId))
    .where(eq(triageRota.projectId, projectId))
    .orderBy(asc(triageRota.position));
  const index = onDutyIndex(rota.length, now);
  return { rota, onDuty: index === null ? null : rota[index]! };
}

/** Who hears about an arrival: the rule's triager, else whoever is on duty, else every editor. */
async function triagersFor(
  tx: Executor,
  organisationId: string,
  projectId: string,
  ruleTriagerId: string | null,
): Promise<string[]> {
  const editors = await editorIds(tx, organisationId);
  // Whoever a rule or the rota names must still be able to triage now.
  if (ruleTriagerId && editors.includes(ruleTriagerId)) return [ruleTriagerId];
  const { onDuty } = await rotaOf(tx, projectId);
  if (onDuty && editors.includes(onDuty.id)) return [onDuty.id];
  return editors;
}

/**
 * The first rule whose conditions all hold fills in the arriving ticket. Rules only set fields;
 * they never accept or decline anything. Returns the rule's triager, if it names one.
 */
async function applyRules(
  tx: Executor,
  organisationId: string,
  ticket: TriageTicket,
  record: (event: TicketEvent) => Promise<void>,
): Promise<string | null> {
  const rules = await tx
    .select()
    .from(triageRules)
    .where(eq(triageRules.projectId, ticket.projectId))
    .orderBy(asc(triageRules.position));
  if (rules.length === 0) return null;
  const [type] = await tx
    .select({ key: ticketTypes.key })
    .from(ticketTypes)
    .where(eq(ticketTypes.id, ticket.typeId));
  const labelRows = await tx
    .select({ labelId: ticketLabels.labelId })
    .from(ticketLabels)
    .where(eq(ticketLabels.ticketId, ticket.id));
  const facts = {
    typeKey: type?.key ?? '',
    labelIds: labelRows.map((row) => row.labelId),
    title: ticket.title,
    reporterId: ticket.reporterId,
  };
  for (const rule of rules) {
    const conditions = triageRuleConditionsSchema.safeParse(rule.conditions);
    const actions = triageRuleActionsSchema.safeParse(rule.actions);
    if (!conditions.success || !actions.success || !ruleMatches(conditions.data, facts)) continue;

    // What the rule names may have changed since it was written; skip anything no longer valid.
    const set = actions.data;
    const issues = await findReferenceIssues(tx, organisationId, ticket.projectId, {
      ...(set.assigneeId ? { assigneeId: set.assigneeId } : {}),
      ...(set.priorityId ? { priorityId: set.priorityId } : {}),
      ...(set.addLabelIds ? { labelIds: set.addLabelIds } : {}),
    });
    const bad = new Set(issues.map((issue) => issue.path));
    await tx
      .update(tickets)
      .set({
        ...(set.assigneeId && !bad.has('assigneeId') ? { assigneeId: set.assigneeId } : {}),
        ...(set.priorityId && !bad.has('priorityId') ? { priorityId: set.priorityId } : {}),
      })
      .where(eq(tickets.id, ticket.id));
    if (set.addLabelIds && !bad.has('labelIds')) {
      await tx
        .insert(ticketLabels)
        .values(
          set.addLabelIds.map((labelId) => ({ organisationId, ticketId: ticket.id, labelId })),
        )
        .onConflictDoNothing();
    }
    await record({ type: 'triage.rule_applied', data: { rule: rule.name } });
    if (set.assigneeId && !bad.has('assigneeId')) {
      // The person a rule assigns hears about it and watches the ticket, as with any assignment.
      await autoWatch(tx, organisationId, ticket.id, [set.assigneeId]);
      await notify(tx, {
        organisationId,
        actorId: null,
        drafts: [
          {
            recipientId: set.assigneeId,
            kind: 'assigned',
            ticketId: ticket.id,
            text: `The triage rule "${rule.name}" assigned ${ticket.key} to you`,
          },
        ],
      });
    }
    return set.triagerId ?? null;
  }
  return null;
}

async function announceArrival(
  tx: Executor,
  organisationId: string,
  actorId: string | null,
  ticket: { id: string; key: string; projectId: string },
  ruleTriagerId: string | null,
  verb: string,
) {
  const triagers = await triagersFor(tx, organisationId, ticket.projectId, ruleTriagerId);
  await notify(tx, {
    organisationId,
    actorId,
    drafts: triagers.map((recipientId) => ({
      recipientId,
      kind: 'triage_arrival' as const,
      ticketId: ticket.id,
      text: `${ticket.key} ${verb} triage`,
    })),
  });
}

/**
 * Called as a ticket is created. In a project with triage on, a ticket from someone who may create
 * but not edit tickets waits in triage instead of joining the board.
 */
export async function intakeNewTicket(
  tx: Executor,
  input: { context: TicketContext; ticketId: string },
): Promise<void> {
  const { context } = input;
  if (hasPermission(context.permissions, 'tickets.edit')) return;
  const [row] = await tx
    .select({ key: tickets.key, triageEnabled: projects.triageEnabled })
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .where(eq(tickets.id, input.ticketId));
  if (!row?.triageEnabled) return;
  const ticket = await lockTicket(tx, context.organisationId, row.key);
  await tx.update(tickets).set({ triageState: 'waiting' }).where(eq(tickets.id, ticket.id));
  const record = recorder(tx, context.organisationId, ticket.id, context.actorUserId);
  await record({ type: 'triage.entered', data: { reason: 'intake' } });
  const triager = await applyRules(tx, context.organisationId, ticket, record);
  await announceArrival(
    tx,
    context.organisationId,
    context.actorUserId,
    ticket,
    triager,
    'arrived in',
  );
}

export async function sendToTriage(
  db: Db,
  input: { context: TicketContext; ticketKey: string },
): Promise<void> {
  const { context } = input;
  await db.transaction(async (tx) => {
    const ticket = await lockTicket(tx, context.organisationId, input.ticketKey);
    if (ticket.archivedAt) throw conflict('This ticket is archived. Unarchive it first.');
    if (ticket.triageState === 'snoozed') {
      // Undoing a snooze: back in the queue now.
      await tx
        .update(tickets)
        .set({ triageState: 'waiting', triageSnoozedUntil: null })
        .where(eq(tickets.id, ticket.id));
      await recorder(
        tx,
        context.organisationId,
        ticket.id,
        context.actorUserId,
      )({
        type: 'triage.entered',
        data: { reason: 'woke' },
      });
      return;
    }
    if (ticket.triageState) throw conflict(`${ticket.key} is already in triage.`);
    const [status] = await tx
      .select({ category: projectStatuses.category })
      .from(projectStatuses)
      .where(eq(projectStatuses.id, ticket.statusId));
    if (status?.category === 'completed') throw conflict(`${ticket.key} is already finished.`);
    await tx.update(tickets).set({ triageState: 'waiting' }).where(eq(tickets.id, ticket.id));
    await recorder(
      tx,
      context.organisationId,
      ticket.id,
      context.actorUserId,
    )({
      type: 'triage.entered',
      data: { reason: 'sent' },
    });
    await announceArrival(
      tx,
      context.organisationId,
      context.actorUserId,
      ticket,
      null,
      'was sent to',
    );
  });
}

/** One person proposes a decision; it waits for a second person. */
export async function propose(
  db: Db,
  input: { context: TicketContext; ticketKey: string; body: ProposeBody },
): Promise<void> {
  const { context, body } = input;
  await db.transaction(async (tx) => {
    const ticket = await lockTicket(tx, context.organisationId, input.ticketKey);
    if (ticket.triageState !== 'waiting') {
      throw conflict(
        ticket.triageState === 'proposed'
          ? `${ticket.key} already has a proposal waiting for approval.`
          : ticket.triageState === 'snoozed'
            ? `${ticket.key} is snoozed. Wait for it, or send it to triage again.`
            : `${ticket.key} is not in triage.`,
      );
    }
    if (ticket.archivedAt) throw conflict('This ticket is archived. Unarchive it first.');

    if (body.action === 'accept' || body.action === 'accept_warming') {
      const d = body.details;
      if (d.assigneeId !== undefined && !hasPermission(context.permissions, 'tickets.assign')) {
        throw new AppError('forbidden', "You don't have permission to assign tickets.", 403);
      }
      const issues = await findReferenceIssues(tx, context.organisationId, ticket.projectId, {
        ...(d.assigneeId !== undefined ? { assigneeId: d.assigneeId } : {}),
        ...(d.priorityId ? { priorityId: d.priorityId } : {}),
        ...(d.labelIds ? { labelIds: d.labelIds } : {}),
      });
      if (issues.length > 0) throw invalid(issues);
    }
    if (body.action === 'duplicate') {
      const key = canonicalKey(body.details.originalKey);
      const [original] = key
        ? await tx
            .select({ id: tickets.id })
            .from(tickets)
            .where(and(eq(tickets.organisationId, context.organisationId), eq(tickets.key, key)))
        : [];
      if (!original) {
        throw invalid([
          { path: 'originalKey', message: `There is no ticket ${body.details.originalKey} here.` },
        ]);
      }
      if (original.id === ticket.id) {
        throw invalid([{ path: 'originalKey', message: "A ticket can't duplicate itself." }]);
      }
      body.details.originalKey = key!;
    }

    await tx.insert(triageProposals).values({
      organisationId: context.organisationId,
      ticketId: ticket.id,
      action: body.action,
      details: body.details,
      proposedBy: context.actorUserId,
    });
    await tx.update(tickets).set({ triageState: 'proposed' }).where(eq(tickets.id, ticket.id));
    const summary = await summarise(tx, body.action, body.details);
    await recorder(
      tx,
      context.organisationId,
      ticket.id,
      context.actorUserId,
    )({
      type: 'triage.proposed',
      data: { summary },
    });

    // Everyone else who can approve is asked.
    const approvers = (await editorIds(tx, context.organisationId)).filter(
      (id) => id !== context.actorUserId,
    );
    const [proposer] = await tx
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, context.actorUserId));
    await notify(tx, {
      organisationId: context.organisationId,
      actorId: context.actorUserId,
      drafts: approvers.map((recipientId) => ({
        recipientId,
        kind: 'triage_approval' as const,
        ticketId: ticket.id,
        text: `${proposer?.name ?? 'Someone'} proposes for ${ticket.key}: ${summary}. Needs your approval`,
      })),
    });
  });
}

async function statusByKey(tx: Executor, projectId: string, key: string) {
  const [status] = await tx
    .select({
      id: projectStatuses.id,
      name: projectStatuses.name,
      category: projectStatuses.category,
    })
    .from(projectStatuses)
    .where(
      and(
        eq(projectStatuses.projectId, projectId),
        eq(projectStatuses.key, key),
        eq(projectStatuses.isActive, true),
      ),
    );
  return status ?? null;
}

/**
 * The second person approves (the decision is carried out, in their name) or rejects (the ticket
 * goes back to waiting). Nobody decides their own proposal; the ticket row lock makes the first
 * decision the only one.
 */
export async function decide(
  db: Db,
  input: { context: TicketContext; ticketKey: string; body: DecideBody },
): Promise<void> {
  const { context, body } = input;
  await db.transaction(async (tx) => {
    const ticket = await lockTicket(tx, context.organisationId, input.ticketKey);
    const [proposal] = await tx
      .select()
      .from(triageProposals)
      .where(and(eq(triageProposals.ticketId, ticket.id), isNull(triageProposals.decidedAt)));
    if (!proposal) throw conflict(`${ticket.key} has no proposal waiting.`);
    if (ticket.archivedAt) throw conflict('This ticket is archived. Unarchive it first.');
    if (proposal.proposedBy === context.actorUserId) {
      throw new AppError(
        'forbidden',
        'You made this proposal, so someone else has to approve or reject it.',
        403,
      );
    }
    const action = proposal.action as ProposeBody['action'];
    const summary = await summarise(tx, action, proposal.details);
    const [proposer] = await tx
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, proposal.proposedBy));
    const record = recorder(tx, context.organisationId, ticket.id, context.actorUserId);
    const decided = {
      decidedBy: context.actorUserId,
      decidedAt: new Date(),
    };

    if (body.decision === 'reject') {
      await tx
        .update(triageProposals)
        .set({ ...decided, decision: 'rejected', note: body.note })
        .where(eq(triageProposals.id, proposal.id));
      await tx.update(tickets).set({ triageState: 'waiting' }).where(eq(tickets.id, ticket.id));
      await record({ type: 'triage.rejected', data: { summary, note: body.note } });
      await notify(tx, {
        organisationId: context.organisationId,
        actorId: context.actorUserId,
        drafts: [
          {
            recipientId: proposal.proposedBy,
            kind: 'triage_approval',
            ticketId: ticket.id,
            text: `Your proposal for ${ticket.key} was rejected: ${body.note}`,
          },
        ],
      });
      return;
    }

    await tx
      .update(triageProposals)
      .set({ ...decided, decision: 'approved' })
      .where(eq(triageProposals.id, proposal.id));
    await tx
      .update(tickets)
      .set({ triageState: null, triageSnoozedUntil: null })
      .where(eq(tickets.id, ticket.id));
    await record({
      type: 'triage.approved',
      data: { summary, proposedBy: proposer?.name ?? 'someone' },
    });

    let outcome: string;
    if (action === 'duplicate') {
      const d = proposal.details as { originalKey: string };
      await markDuplicateIn(tx, { context, ticketKey: ticket.key, originalKey: d.originalKey });
      outcome = `${ticket.key} was closed as a duplicate of ${d.originalKey}`;
    } else if (action === 'decline') {
      const d = proposal.details as { reason: string };
      await scrap(tx, context, ticket, record);
      outcome = `${ticket.key} was declined: ${d.reason}`;
    } else {
      await accept(tx, context, ticket, action, proposal.details, record);
      outcome = `${ticket.key} was accepted onto the board`;
    }
    await notify(tx, {
      organisationId: context.organisationId,
      actorId: context.actorUserId,
      drafts: [
        {
          recipientId: ticket.reporterId,
          kind: 'triage_outcome',
          ticketId: ticket.id,
          text: outcome,
        },
      ],
    });
  });
}

async function scrap(
  tx: Executor,
  context: TicketContext,
  ticket: TriageTicket,
  record: (event: TicketEvent) => Promise<void>,
) {
  const [cancellation] = await tx
    .select({ id: projectStatuses.id, name: projectStatuses.name })
    .from(projectStatuses)
    .where(
      and(
        eq(projectStatuses.projectId, ticket.projectId),
        eq(projectStatuses.isCancellation, true),
        eq(projectStatuses.isActive, true),
      ),
    )
    .orderBy(asc(projectStatuses.sortOrder))
    .limit(1);
  if (!cancellation) {
    throw invalid([
      { path: 'action', message: "This project has no status for work that won't be done." },
    ]);
  }
  if (cancellation.id === ticket.statusId) return;
  const [from] = await tx
    .select({ id: projectStatuses.id, name: projectStatuses.name })
    .from(projectStatuses)
    .where(eq(projectStatuses.id, ticket.statusId));
  const now = new Date();
  await tx
    .update(tickets)
    .set({
      statusId: cancellation.id,
      completedAt: now,
      version: sql`${tickets.version} + 1`,
      updatedAt: now,
    })
    .where(eq(tickets.id, ticket.id));
  await record({ type: 'ticket.status_changed', data: { from: from!, to: cancellation } });
  await ticketUpdated(tx, {
    organisationId: context.organisationId,
    actorId: context.actorUserId,
    ticket,
    status: { from: from!.name, to: cancellation.name },
  });
}

async function accept(
  tx: Executor,
  context: TicketContext,
  ticket: TriageTicket,
  action: 'accept' | 'accept_warming',
  rawDetails: unknown,
  record: (event: TicketEvent) => Promise<void>,
) {
  const details = (rawDetails ?? {}) as {
    assigneeId?: string | null;
    priorityId?: string;
    labelIds?: string[];
  };
  if (details.assigneeId !== undefined && !hasPermission(context.permissions, 'tickets.assign')) {
    throw new AppError('forbidden', "You don't have permission to assign tickets.", 403);
  }
  // Checked again: what the proposal named may have gone since.
  const issues = await findReferenceIssues(tx, context.organisationId, ticket.projectId, {
    ...(details.assigneeId !== undefined ? { assigneeId: details.assigneeId } : {}),
    ...(details.priorityId ? { priorityId: details.priorityId } : {}),
    ...(details.labelIds ? { labelIds: details.labelIds } : {}),
  });
  if (issues.length > 0) throw invalid(issues);

  const target = await statusByKey(
    tx,
    ticket.projectId,
    action === 'accept_warming' ? 'open' : 'backlog',
  );
  if (!target) {
    throw invalid([{ path: 'action', message: 'This project has no column to accept it into.' }]);
  }
  const [from] = await tx
    .select({ id: projectStatuses.id, name: projectStatuses.name })
    .from(projectStatuses)
    .where(eq(projectStatuses.id, ticket.statusId));

  const changes: TicketChange[] = [];
  const nameOf = async (table: 'user' | 'priority', id: string | null) => {
    if (!id) return null;
    const rows =
      table === 'user'
        ? await tx.select({ name: users.displayName }).from(users).where(eq(users.id, id))
        : await tx.select({ name: priorities.name }).from(priorities).where(eq(priorities.id, id));
    return rows[0]?.name ?? null;
  };
  const assigneeChanged =
    details.assigneeId !== undefined && details.assigneeId !== ticket.assigneeId;
  const priorityChanged =
    details.priorityId !== undefined && details.priorityId !== ticket.priorityId;
  if (assigneeChanged) {
    changes.push({
      field: 'assignee',
      from: await nameOf('user', ticket.assigneeId),
      to: await nameOf('user', details.assigneeId ?? null),
    });
  }
  if (priorityChanged) {
    changes.push({
      field: 'priority',
      from: await nameOf('priority', ticket.priorityId),
      to: await nameOf('priority', details.priorityId!),
    });
  }
  const now = new Date();
  await tx
    .update(tickets)
    .set({
      ...(target.id !== ticket.statusId
        ? { statusId: target.id, completedAt: target.category === 'completed' ? now : null }
        : {}),
      ...(assigneeChanged ? { assigneeId: details.assigneeId ?? null } : {}),
      ...(priorityChanged ? { priorityId: details.priorityId! } : {}),
      version: sql`${tickets.version} + 1`,
      updatedAt: now,
    })
    .where(eq(tickets.id, ticket.id));
  if (changes.length > 0) await record({ type: 'ticket.updated', data: { changes } });
  if (target.id !== ticket.statusId) {
    await record({ type: 'ticket.status_changed', data: { from: from!, to: target } });
  }
  if (details.labelIds && details.labelIds.length > 0) {
    const existing = await tx
      .select({ labelId: ticketLabels.labelId })
      .from(ticketLabels)
      .where(eq(ticketLabels.ticketId, ticket.id));
    const have = new Set(existing.map((row) => row.labelId));
    const added = details.labelIds.filter((id) => !have.has(id));
    if (added.length > 0) {
      await tx.insert(ticketLabels).values(
        added.map((labelId) => ({
          organisationId: context.organisationId,
          ticketId: ticket.id,
          labelId,
        })),
      );
      const names = await tx
        .select({ name: labels.name })
        .from(labels)
        .where(inArray(labels.id, added));
      await record({
        type: 'labels.changed',
        data: { added: names.map((n) => n.name), removed: [] },
      });
    }
  }
  await ticketUpdated(tx, {
    organisationId: context.organisationId,
    actorId: context.actorUserId,
    ticket,
    ...(assigneeChanged
      ? { assignee: { from: ticket.assigneeId, to: details.assigneeId ?? null } }
      : {}),
    ...(target.id !== ticket.statusId ? { status: { from: from!.name, to: target.name } } : {}),
  });
}

/** Hides a waiting ticket from the queue until a day; one person may do it (easy to undo). */
export async function snooze(
  db: Db,
  input: { context: TicketContext; ticketKey: string; until: string },
): Promise<void> {
  const { context } = input;
  const until = new Date(`${input.until}T00:00:00Z`);
  if (until.getTime() <= Date.now()) {
    throw invalid([{ path: 'until', message: 'Choose a day after today.' }]);
  }
  await db.transaction(async (tx) => {
    const ticket = await lockTicket(tx, context.organisationId, input.ticketKey);
    if (ticket.triageState !== 'waiting') {
      throw conflict(`Only a ticket waiting in triage can be snoozed.`);
    }
    await tx
      .update(tickets)
      .set({ triageState: 'snoozed', triageSnoozedUntil: until })
      .where(eq(tickets.id, ticket.id));
    await recorder(
      tx,
      context.organisationId,
      ticket.id,
      context.actorUserId,
    )({
      type: 'triage.snoozed',
      data: { until: input.until },
    });
  });
}

/** Brings snoozed tickets whose day has come back to the queue, and tells their triagers. */
export async function wakeSnoozed(db: Db, now = new Date()): Promise<void> {
  const due = await db
    .select({ key: tickets.key, organisationId: tickets.organisationId })
    .from(tickets)
    .where(
      and(
        eq(tickets.triageState, 'snoozed'),
        isNotNull(tickets.triageSnoozedUntil),
        lte(tickets.triageSnoozedUntil, now),
      ),
    );
  for (const row of due) {
    await db.transaction(async (tx) => {
      const ticket = await lockTicket(tx, row.organisationId, row.key);
      if (ticket.triageState !== 'snoozed') return;
      await tx
        .update(tickets)
        .set({ triageState: 'waiting', triageSnoozedUntil: null })
        .where(eq(tickets.id, ticket.id));
      await recorder(
        tx,
        row.organisationId,
        ticket.id,
        null,
      )({
        type: 'triage.entered',
        data: { reason: 'woke' },
      });
      await announceArrival(tx, row.organisationId, null, ticket, null, 'is back in');
    });
  }
}

/** The tickets in triage, oldest first: one project's, or the whole workspace's. */
export async function triageQueue(
  db: Db,
  input: { organisationId: string; projectKey?: string; includeSnoozed: boolean },
): Promise<TicketSummary[]> {
  const rows = await db
    .select({ id: tickets.id })
    .from(tickets)
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .where(
      and(
        eq(tickets.organisationId, input.organisationId),
        isNull(tickets.archivedAt),
        input.includeSnoozed
          ? isNotNull(tickets.triageState)
          : inArray(tickets.triageState, ['waiting', 'proposed']),
        input.projectKey ? eq(projects.key, input.projectKey) : undefined,
      ),
    )
    .orderBy(asc(tickets.createdAt));
  return loadTicketSummaries(
    db,
    input.organisationId,
    rows.map((row) => row.id),
  );
}

// ---------------------------------------------------------------------------
// Settings: the switch, the rota and the rules
// ---------------------------------------------------------------------------

async function projectOf(executor: Executor, organisationId: string, key: string, lock = false) {
  const query = executor
    .select({ id: projects.id, triageEnabled: projects.triageEnabled })
    .from(projects)
    .where(and(eq(projects.organisationId, organisationId), eq(projects.key, key)));
  const [project] = lock ? await query.for('update') : await query;
  if (!project) throw notFound();
  return project;
}

export async function triageSettings(
  db: Executor,
  organisationId: string,
  projectKey: string,
): Promise<TriageSettings> {
  const project = await projectOf(db, organisationId, projectKey);
  const { rota, onDuty } = await rotaOf(db, project.id);
  const rules = await db
    .select({
      id: triageRules.id,
      name: triageRules.name,
      conditions: triageRules.conditions,
      actions: triageRules.actions,
    })
    .from(triageRules)
    .where(eq(triageRules.projectId, project.id))
    .orderBy(asc(triageRules.position));
  return {
    enabled: project.triageEnabled,
    rota,
    onDuty,
    rules: rules.map((rule) => ({
      ...rule,
      conditions: rule.conditions as Record<string, unknown>,
      actions: rule.actions as Record<string, unknown>,
    })),
  };
}

/** Replaces the project's triage settings in one go, checking every person and value named. */
export async function saveTriageSettings(
  db: Db,
  input: { organisationId: string; projectKey: string; body: TriageSettingsBody },
): Promise<TriageSettings> {
  const { organisationId, body } = input;
  return db.transaction(async (tx) => {
    // Locked, so two saves at once happen one after the other instead of colliding.
    const project = await projectOf(tx, organisationId, input.projectKey, true);
    const issues: { path: string; message: string }[] = [];
    const editors = new Set(await editorIds(tx, organisationId));
    body.rota.forEach((id, index) => {
      if (!editors.has(id)) {
        issues.push({
          path: `rota.${index}`,
          message: 'Only people who can edit tickets can triage.',
        });
      }
    });
    for (const [index, rule] of body.rules.entries()) {
      const found = [
        ...(await findReferenceIssues(tx, organisationId, project.id, {
          ...(rule.actions.assigneeId ? { assigneeId: rule.actions.assigneeId } : {}),
          ...(rule.actions.priorityId ? { priorityId: rule.actions.priorityId } : {}),
          ...(rule.actions.addLabelIds ? { labelIds: rule.actions.addLabelIds } : {}),
        })),
        // Checked on their own: one call cannot hold two label lists.
        ...(rule.conditions.labelId
          ? (
              await findReferenceIssues(tx, organisationId, project.id, {
                labelIds: [rule.conditions.labelId],
              })
            ).map((issue) => ({ ...issue, path: 'conditions.labelId' }))
          : []),
        ...(rule.conditions.reporterId
          ? (
              await findReferenceIssues(tx, organisationId, project.id, {
                assigneeId: rule.conditions.reporterId,
              })
            ).map(() => ({
              path: 'conditions.reporterId',
              message: 'Not a member of this workspace.',
            }))
          : []),
      ];
      for (const issue of found)
        issues.push({ path: `rules.${index}.${issue.path}`, message: issue.message });
      if (rule.actions.triagerId && !editors.has(rule.actions.triagerId)) {
        issues.push({
          path: `rules.${index}.triagerId`,
          message: 'Only people who can edit tickets can triage.',
        });
      }
      if (rule.conditions.typeKey) {
        const [type] = await tx
          .select({ id: ticketTypes.id })
          .from(ticketTypes)
          .where(
            and(
              eq(ticketTypes.organisationId, organisationId),
              eq(ticketTypes.key, rule.conditions.typeKey),
            ),
          );
        if (!type) issues.push({ path: `rules.${index}.typeKey`, message: 'Unknown type.' });
      }
    }
    if (issues.length > 0) throw invalid(issues);

    await tx
      .update(projects)
      .set({ triageEnabled: body.enabled })
      .where(eq(projects.id, project.id));
    await tx.delete(triageRota).where(eq(triageRota.projectId, project.id));
    if (body.rota.length > 0) {
      await tx.insert(triageRota).values(
        body.rota.map((userId, position) => ({
          organisationId,
          projectId: project.id,
          position,
          userId,
        })),
      );
    }
    await tx.delete(triageRules).where(eq(triageRules.projectId, project.id));
    if (body.rules.length > 0) {
      await tx.insert(triageRules).values(
        body.rules.map((rule, position) => ({
          organisationId,
          projectId: project.id,
          position,
          name: rule.name,
          conditions: rule.conditions,
          actions: rule.actions,
        })),
      );
    }
    return triageSettings(tx, organisationId, input.projectKey);
  });
}

export type { NotificationDraft };
