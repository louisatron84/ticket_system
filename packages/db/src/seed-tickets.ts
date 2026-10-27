import type { LabelColor } from '@forge/shared';
import { DEFAULT_STATUS_TEMPLATE } from '@forge/shared';
import { eq } from 'drizzle-orm';
import { createProject } from './defaults';
import type { Executor } from './organisations';
import { components, labels, priorities, ticketComments, ticketTypes } from './schema';
import { addTicketEvent, createTicketRow } from './tickets';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);
const dateIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

type TicketSpec = {
  title: string;
  description?: string;
  type: string;
  status: string;
  priority: string;
  assignee: string | null;
  reporter: string;
  labels: string[];
  /** Days from today; negative is in the past. */
  due: number | null;
  component?: string;
  ageDays: number;
};

type ProjectSpec = {
  key: string;
  name: string;
  description: string;
  components: string[];
  tickets: TicketSpec[];
};

type WorkspaceSpec = {
  slug: string;
  creator: string;
  labels: [name: string, color: LabelColor][];
  projects: ProjectSpec[];
};

const DEMO: WorkspaceSpec[] = [
  {
    slug: 'acme',
    creator: 'owner',
    labels: [
      ['bug', 'red'],
      ['frontend', 'blue'],
      ['backend', 'teal'],
      ['docs', 'slate'],
      ['security', 'orange'],
      ['performance', 'violet'],
    ],
    projects: [
      {
        key: 'WEB',
        name: 'Web App',
        description: 'The customer-facing website and checkout.',
        components: ['Frontend', 'Checkout'],
        tickets: [
          {
            title: 'Login redirect loops after session expiry',
            description:
              'After the session expires the sign-in page redirects back to itself.\nSteps: sign in, wait for expiry, reload.',
            type: 'bug',
            status: 'in_progress',
            priority: 'high',
            assignee: 'developer',
            reporter: 'reviewer',
            labels: ['bug', 'frontend'],
            due: -2,
            component: 'Frontend',
            ageDays: 12,
          },
          {
            title: 'Add a dark mode toggle to settings',
            type: 'feature',
            status: 'open',
            priority: 'normal',
            assignee: 'developer',
            reporter: 'owner',
            labels: ['frontend'],
            due: 14,
            ageDays: 11,
          },
          {
            title: 'Checkout page is slow on mobile',
            description: 'Largest paint takes more than four seconds on mid-range phones.',
            type: 'bug',
            status: 'in_review',
            priority: 'critical',
            assignee: 'developer',
            reporter: 'admin',
            labels: ['bug', 'performance', 'frontend'],
            due: 1,
            component: 'Checkout',
            ageDays: 10,
          },
          {
            title: 'Update the README with setup steps',
            type: 'documentation',
            status: 'backlog',
            priority: 'low',
            assignee: null,
            reporter: 'admin',
            labels: ['docs'],
            due: null,
            ageDays: 9,
          },
          {
            title: 'Migrate form components to the new design system',
            type: 'improvement',
            status: 'in_progress',
            priority: 'normal',
            assignee: 'admin',
            reporter: 'owner',
            labels: ['frontend'],
            due: 7,
            component: 'Frontend',
            ageDays: 9,
          },
          {
            title: 'Fix typo on the pricing page',
            type: 'task',
            status: 'done',
            priority: 'lowest',
            assignee: 'developer',
            reporter: 'reviewer',
            labels: [],
            due: -5,
            ageDays: 8,
          },
          {
            title: 'Cart total ignores discount codes',
            type: 'bug',
            status: 'blocked',
            priority: 'high',
            assignee: 'developer',
            reporter: 'admin',
            labels: ['bug', 'backend'],
            due: -1,
            component: 'Checkout',
            ageDays: 7,
          },
          {
            title: 'Accessibility audit of the main navigation',
            type: 'task',
            status: 'open',
            priority: 'high',
            assignee: 'reviewer',
            reporter: 'owner',
            labels: ['frontend'],
            due: 3,
            ageDays: 6,
          },
          {
            title: 'Remove the unused analytics script',
            type: 'task',
            status: 'cancelled',
            priority: 'low',
            assignee: null,
            reporter: 'owner',
            labels: ['security'],
            due: null,
            ageDays: 5,
          },
          {
            title: 'Add a keyboard shortcuts help dialog',
            type: 'feature',
            status: 'backlog',
            priority: 'lowest',
            assignee: null,
            reporter: 'developer',
            labels: ['frontend'],
            due: 30,
            ageDays: 4,
          },
          {
            title: 'Image upload fails for files over 5 MB',
            type: 'bug',
            status: 'open',
            priority: 'critical',
            assignee: null,
            reporter: 'reviewer',
            labels: ['bug', 'backend'],
            due: -3,
            ageDays: 3,
          },
          {
            title: 'Document the release process',
            type: 'documentation',
            status: 'done',
            priority: 'normal',
            assignee: 'admin',
            reporter: 'owner',
            labels: ['docs'],
            due: null,
            ageDays: 2,
          },
        ],
      },
      {
        key: 'API',
        name: 'Platform API',
        description: 'Public and internal HTTP APIs.',
        components: ['Gateway', 'Auth'],
        tickets: [
          {
            title: 'Rate limit the public endpoints',
            type: 'feature',
            status: 'in_progress',
            priority: 'high',
            assignee: 'admin',
            reporter: 'owner',
            labels: ['security', 'backend'],
            due: 5,
            component: 'Gateway',
            ageDays: 14,
          },
          {
            title: 'Return 404 for unknown project keys',
            type: 'bug',
            status: 'done',
            priority: 'normal',
            assignee: 'developer',
            reporter: 'reviewer',
            labels: ['bug', 'backend'],
            due: null,
            ageDays: 13,
          },
          {
            title: 'Token refresh has a race condition',
            type: 'bug',
            status: 'in_review',
            priority: 'critical',
            assignee: 'developer',
            reporter: 'admin',
            labels: ['bug', 'security'],
            due: 2,
            component: 'Auth',
            ageDays: 9,
          },
          {
            title: 'Paginate the audit log endpoint',
            type: 'improvement',
            status: 'open',
            priority: 'normal',
            assignee: null,
            reporter: 'owner',
            labels: ['backend', 'performance'],
            due: 21,
            ageDays: 8,
          },
          {
            title: 'Publish OpenAPI documentation',
            type: 'documentation',
            status: 'backlog',
            priority: 'low',
            assignee: 'reviewer',
            reporter: 'admin',
            labels: ['docs'],
            due: null,
            ageDays: 7,
          },
          {
            title: 'Upgrade Fastify to the latest minor release',
            type: 'task',
            status: 'open',
            priority: 'low',
            assignee: 'developer',
            reporter: 'owner',
            labels: ['backend'],
            due: 10,
            ageDays: 5,
          },
          {
            title: 'Audit log is missing role-change entries',
            type: 'bug',
            status: 'blocked',
            priority: 'high',
            assignee: null,
            reporter: 'reviewer',
            labels: ['bug', 'security'],
            due: -1,
            component: 'Auth',
            ageDays: 4,
          },
          {
            title: 'Add a health check for the job queue',
            type: 'feature',
            status: 'backlog',
            priority: 'normal',
            assignee: null,
            reporter: 'admin',
            labels: ['backend'],
            due: null,
            ageDays: 1,
          },
        ],
      },
    ],
  },
  {
    slug: 'northwind',
    creator: 'other-owner',
    labels: [
      ['bug', 'red'],
      ['ops', 'green'],
    ],
    projects: [
      {
        key: 'OPS',
        name: 'Operations',
        description: 'Day-to-day infrastructure work.',
        components: [],
        tickets: [
          {
            title: 'Rotate the staging database credentials',
            type: 'task',
            status: 'open',
            priority: 'high',
            assignee: 'other-owner',
            reporter: 'other-owner',
            labels: ['ops'],
            due: 4,
            ageDays: 6,
          },
          {
            title: 'Run the quarterly backup restore test',
            type: 'task',
            status: 'backlog',
            priority: 'normal',
            assignee: null,
            reporter: 'other-owner',
            labels: ['ops'],
            due: 20,
            ageDays: 5,
          },
          {
            title: 'Update the on-call rota',
            type: 'task',
            status: 'in_progress',
            priority: 'low',
            assignee: 'other-owner',
            reporter: 'other-owner',
            labels: [],
            due: null,
            ageDays: 3,
          },
          {
            title: 'Investigate the disk usage alert',
            type: 'bug',
            status: 'done',
            priority: 'high',
            assignee: 'other-owner',
            reporter: 'other-owner',
            labels: ['bug', 'ops'],
            due: -2,
            ageDays: 2,
          },
        ],
      },
    ],
  },
];

const statusName = (key: string) =>
  DEFAULT_STATUS_TEMPLATE.statuses.find((status) => status.key === key)!.name;

/**
 * Demo projects, labels and tickets for the seeded workspaces. Built through the same helpers the
 * API uses, so numbering, completion times and history behave exactly as they do for real tickets.
 */
export async function insertDemoTickets(
  executor: Executor,
  context: { organisationIds: Map<string, string>; userIds: Map<string, string> },
): Promise<void> {
  const user = (key: string) => {
    const id = context.userIds.get(key);
    if (!id) throw new Error(`Seed bug: no identity "${key}"`);
    return id;
  };

  for (const workspace of DEMO) {
    const organisationId = context.organisationIds.get(workspace.slug);
    if (!organisationId) throw new Error(`Seed bug: no workspace "${workspace.slug}"`);

    const typeIds = new Map(
      (
        await executor
          .select()
          .from(ticketTypes)
          .where(eq(ticketTypes.organisationId, organisationId))
      ).map((row) => [row.key, row.id] as const),
    );
    const priorityIds = new Map(
      (
        await executor
          .select()
          .from(priorities)
          .where(eq(priorities.organisationId, organisationId))
      ).map((row) => [row.key, row.id] as const),
    );
    const labelRows = await executor
      .insert(labels)
      .values(workspace.labels.map(([name, color]) => ({ organisationId, name, color })))
      .returning({ id: labels.id, name: labels.name });
    const labelIds = new Map(labelRows.map((row) => [row.name, row.id] as const));

    for (const project of workspace.projects) {
      const { projectId, statusIds } = await createProject(executor, {
        organisationId,
        key: project.key,
        name: project.name,
        description: project.description,
        createdBy: user(workspace.creator),
      });

      const componentIds = new Map<string, string>();
      if (project.components.length > 0) {
        const rows = await executor
          .insert(components)
          .values(project.components.map((name) => ({ organisationId, projectId, name })))
          .returning({ id: components.id, name: components.name });
        for (const row of rows) componentIds.set(row.name, row.id);
      }

      // Tickets are created oldest first so numbers follow age, like a real project's would.
      const created = new Map<string, { id: string; createdAt: Date; spec: TicketSpec }>();
      for (const spec of project.tickets) {
        const createdAt = daysAgo(spec.ageDays);
        const row = await createTicketRow(executor, {
          organisationId,
          projectId,
          reporterId: user(spec.reporter),
          title: spec.title,
          description: spec.description ?? '',
          typeId: typeIds.get(spec.type)!,
          priorityId: priorityIds.get(spec.priority)!,
          statusId: statusIds[spec.status]!,
          assigneeId: spec.assignee ? user(spec.assignee) : null,
          componentId: spec.component ? componentIds.get(spec.component)! : null,
          dueDate: spec.due === null ? null : dateIn(spec.due),
          labelIds: spec.labels.map((name) => labelIds.get(name)!),
          createdAt,
        });
        created.set(row.key, { id: row.id, createdAt, spec });
      }

      const key = (number: number) => `${project.key}-${number}`;
      const at = (ticketKey: string, hoursAfterCreation: number) =>
        new Date(created.get(ticketKey)!.createdAt.getTime() + hoursAfterCreation * HOUR);
      const idOf = (ticketKey: string) => created.get(ticketKey)!.id;

      const move = (ticketKey: string, from: string, to: string, actor: string, hours: number) =>
        addTicketEvent(executor, {
          organisationId,
          ticketId: idOf(ticketKey),
          actorUserId: user(actor),
          event: {
            type: 'ticket.status_changed',
            data: {
              from: { id: statusIds[from]!, name: statusName(from) },
              to: { id: statusIds[to]!, name: statusName(to) },
            },
          },
          createdAt: at(ticketKey, hours),
        });

      const comment = async (ticketKey: string, author: string, body: string, hours: number) => {
        const [row] = await executor
          .insert(ticketComments)
          .values({
            organisationId,
            ticketId: idOf(ticketKey),
            authorId: user(author),
            body,
            createdAt: at(ticketKey, hours),
          })
          .returning({ id: ticketComments.id });
        await addTicketEvent(executor, {
          organisationId,
          ticketId: idOf(ticketKey),
          actorUserId: user(author),
          event: { type: 'comment.added', data: { commentId: row!.id } },
          createdAt: at(ticketKey, hours),
        });
      };

      if (project.key === 'WEB') {
        await move(key(1), 'open', 'in_progress', 'developer', 5);
        await addTicketEvent(executor, {
          organisationId,
          ticketId: idOf(key(1)),
          actorUserId: user('reviewer'),
          event: {
            type: 'ticket.updated',
            data: { changes: [{ field: 'priority', from: 'Flame', to: 'Blaze' }] },
          },
          createdAt: at(key(1), 3),
        });
        await comment(
          key(1),
          'developer',
          'I can reproduce this on Edge as well. Looking at the session middleware.',
          6,
        );
        await comment(
          key(1),
          'reviewer',
          'Thanks. It only happens when the cookie has already expired, not when it is missing.',
          8,
        );

        await move(key(3), 'open', 'in_progress', 'developer', 4);
        await move(key(3), 'in_progress', 'in_review', 'developer', 30);
        await comment(
          key(3),
          'admin',
          'Can we get a trace from a real device before this goes out?',
          31,
        );
        await comment(
          key(3),
          'developer',
          'Attached the trace to the pull request. Main thread is blocked by the pricing calculation.',
          40,
        );

        await move(key(6), 'in_progress', 'done', 'developer', 20);
        await move(key(12), 'in_progress', 'done', 'admin', 12);
      }
      if (project.key === 'API') {
        await move(key(2), 'in_review', 'done', 'reviewer', 26);
        await move(key(3), 'open', 'in_progress', 'developer', 10);
        await move(key(3), 'in_progress', 'in_review', 'developer', 50);
        await comment(
          key(3),
          'admin',
          'The refresh endpoint needs a lock per session, not per user.',
          52,
        );
      }
    }
  }
}
