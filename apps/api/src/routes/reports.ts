import { cycles, projectStatuses, projects, ticketEvents, tickets, type Db } from '@forge/db';
import {
  addDays,
  normalizeProjectKey,
  type EstimationSystem,
  type ReportRange,
  type Reports,
} from '@forge/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, not, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { orgAccess } from '../auth/guards';
import { AppError } from '../errors';
import { computeReports, type ReportStatus, type ReportTicket } from '../tickets/reports';
import { burndownOf } from './cycles';

const notFound = () => new AppError('not_found', 'Not found.', 404);

const querySchema = z.object({ days: z.enum(['30', '90']).default('30') });

const VELOCITY_CYCLES = 6;

export function registerReportRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  app.get(
    '/api/v1/orgs/:orgId/projects/:projectKey/reports',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<Reports> => {
      const query = querySchema.safeParse(request.query);
      if (!query.success) throw new AppError('validation_failed', 'Bad query.', 422);
      const days = Number(query.data.days) as ReportRange;
      const key = normalizeProjectKey((request.params as { projectKey: string }).projectKey);
      if (!key) throw notFound();
      const [project] = await db
        .select({
          id: projects.id,
          key: projects.key,
          estimation: projects.estimation,
          archivedAt: projects.archivedAt,
          cyclesEnabled: projects.cyclesEnabled,
          cycleLengthDays: projects.cycleLengthDays,
        })
        .from(projects)
        .where(
          and(eq(projects.organisationId, request.org!.organisationId), eq(projects.key, key)),
        );
      if (!project) throw notFound();

      const now = new Date();
      const to = now.toISOString().slice(0, 10);
      const from = addDays(to, -(days - 1));
      const start = new Date(`${from}T00:00:00Z`);

      // Every status the project has had, retired ones too: history may point at them.
      const statusRows = await db
        .select({
          id: projectStatuses.id,
          name: projectStatuses.name,
          category: projectStatuses.category,
          cancellation: projectStatuses.isCancellation,
        })
        .from(projectStatuses)
        .where(eq(projectStatuses.projectId, project.id));
      const statuses = new Map<string, ReportStatus>(
        statusRows.map((row) => [
          row.id,
          {
            name: row.name,
            category: row.category as ReportStatus['category'],
            cancellation: row.cancellation,
          },
        ]),
      );

      // Counted tickets: accepted from triage and not archived. Those done before the range
      // stay done throughout it, so they are only counted.
      const counted = and(
        eq(tickets.projectId, project.id),
        isNull(tickets.archivedAt),
        isNull(tickets.triageState),
      );
      const doneEarlier = and(
        eq(projectStatuses.category, 'completed'),
        or(isNull(tickets.completedAt), lt(tickets.completedAt, start)),
      )!;
      const [[earlier], rows] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(tickets)
          .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
          .where(and(counted, doneEarlier, eq(projectStatuses.isCancellation, false))),
        db
          .select({
            id: tickets.id,
            key: tickets.key,
            title: tickets.title,
            createdAt: tickets.createdAt,
            completedAt: tickets.completedAt,
            statusId: tickets.statusId,
          })
          .from(tickets)
          .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
          .where(and(counted, not(doneEarlier))),
      ]);
      const moves =
        rows.length === 0
          ? []
          : await db
              .select({
                ticketId: ticketEvents.ticketId,
                at: ticketEvents.createdAt,
                from: sql<string>`${ticketEvents.data} -> 'from' ->> 'id'`,
                to: sql<string>`${ticketEvents.data} -> 'to' ->> 'id'`,
              })
              .from(ticketEvents)
              .innerJoin(tickets, eq(tickets.id, ticketEvents.ticketId))
              .innerJoin(projectStatuses, eq(projectStatuses.id, tickets.statusId))
              .where(
                and(
                  counted,
                  not(doneEarlier),
                  inArray(ticketEvents.type, ['ticket.status_changed', 'ticket.status_retired']),
                ),
              )
              .orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id));
      const byTicket = new Map<string, ReportTicket>(
        rows.map((row) => [row.id, { ...row, moves: [] }]),
      );
      for (const move of moves) byTicket.get(move.ticketId)?.moves.push(move);

      const computed = computeReports({
        from,
        to,
        now,
        tickets: [...byTicket.values()],
        doneBefore: earlier?.count ?? 0,
        statuses,
      });

      let cycleReport: Reports['cycles'] = null;
      if (project.cyclesEnabled) {
        const [[active], completed] = await Promise.all([
          db
            .select()
            .from(cycles)
            .where(and(eq(cycles.projectId, project.id), eq(cycles.state, 'active'))),
          db
            .select()
            .from(cycles)
            .where(
              and(
                eq(cycles.projectId, project.id),
                eq(cycles.state, 'completed'),
                isNotNull(cycles.completedAt),
              ),
            )
            .orderBy(desc(cycles.completedAt), desc(cycles.number))
            .limit(VELOCITY_CYCLES),
        ]);
        cycleReport = {
          active: active
            ? {
                id: active.id,
                name: active.name,
                startsOn: active.startsOn,
                endsOn: active.endsOn,
                days: await burndownOf(db, project, active),
              }
            : null,
          velocity: completed.reverse().map((row) => ({
            name: row.name,
            plannedTickets: row.plannedTickets ?? 0,
            doneTickets: row.doneTickets ?? 0,
            plannedEstimate: row.plannedEstimate ?? 0,
            doneEstimate: row.doneEstimate ?? 0,
          })),
        };
      }

      return {
        days,
        from,
        to,
        estimation: project.estimation as EstimationSystem,
        ...computed,
        cycles: cycleReport,
      };
    },
  );
}
