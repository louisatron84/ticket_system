import type { Db } from '@forge/db';
import {
  decideBodySchema,
  normalizeProjectKey,
  proposeBodySchema,
  snoozeBodySchema,
  triageSettingsBodySchema,
  type TicketDetail,
  type TicketSummary,
  type TriageSettings,
} from '@forge/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { orgAccess } from '../auth/guards';
import { AppError } from '../errors';
import { loadTicketDetail } from '../tickets/read';
import type { TicketContext } from '../tickets/service';
import {
  decide,
  propose,
  saveTriageSettings,
  sendToTriage,
  snooze,
  triageQueue,
  triageSettings,
} from '../triage/service';
import { parseBody } from '../validation';
import { ticketKeyParam } from './tickets';

const queueQuerySchema = z.object({
  project: z.string().max(10).optional(),
  snoozed: z.enum(['0', '1']).default('0'),
});

/** Triage: the queue, the four-eyes decisions, and each project's settings. */
export function registerTriageRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  const context = (request: FastifyRequest): TicketContext => {
    const org = request.org!;
    return {
      organisationId: org.organisationId,
      actorUserId: org.actorUserId,
      permissions: org.permissions,
    };
  };
  const projectKeyOf = (request: FastifyRequest) => {
    const key = normalizeProjectKey((request.params as { key: string }).key);
    if (!key) throw new AppError('not_found', 'Not found.', 404);
    return key;
  };
  const detail = async (request: FastifyRequest, key: string): Promise<TicketDetail> =>
    (await loadTicketDetail(db, request.org!.organisationId, key))!;

  app.get(
    '/api/v1/orgs/:orgId/triage',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<TicketSummary[]> => {
      const query = queueQuerySchema.safeParse(request.query);
      if (!query.success) throw new AppError('validation_failed', 'Bad query.', 422);
      const projectKey = query.data.project ? normalizeProjectKey(query.data.project) : undefined;
      if (query.data.project && !projectKey) throw new AppError('not_found', 'Not found.', 404);
      return triageQueue(db, {
        organisationId: request.org!.organisationId,
        ...(projectKey ? { projectKey } : {}),
        includeSnoozed: query.data.snoozed === '1',
      });
    },
  );

  const action = (path: string, run: (request: FastifyRequest, key: string) => Promise<void>) =>
    app.post(
      `/api/v1/orgs/:orgId/tickets/:ticketKey/triage/${path}`,
      { preHandler: orgAccess(db, 'tickets.edit') },
      async (request): Promise<TicketDetail> => {
        const key = ticketKeyParam(request);
        await run(request, key);
        return detail(request, key);
      },
    );

  action('send', (request, ticketKey) =>
    sendToTriage(db, { context: context(request), ticketKey }),
  );
  action('propose', (request, ticketKey) =>
    propose(db, {
      context: context(request),
      ticketKey,
      body: parseBody(proposeBodySchema, request.body),
    }),
  );
  action('decide', (request, ticketKey) =>
    decide(db, {
      context: context(request),
      ticketKey,
      body: parseBody(decideBodySchema, request.body),
    }),
  );
  action('snooze', (request, ticketKey) =>
    snooze(db, {
      context: context(request),
      ticketKey,
      until: parseBody(snoozeBodySchema, request.body).until,
    }),
  );

  app.get(
    '/api/v1/orgs/:orgId/projects/:key/triage-settings',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request): Promise<TriageSettings> =>
      triageSettings(db, request.org!.organisationId, projectKeyOf(request)),
  );

  app.put(
    '/api/v1/orgs/:orgId/projects/:key/triage-settings',
    { preHandler: orgAccess(db, 'projects.manage') },
    async (request): Promise<TriageSettings> =>
      saveTriageSettings(db, {
        organisationId: request.org!.organisationId,
        projectKey: projectKeyOf(request),
        body: parseBody(triageSettingsBodySchema, request.body),
      }),
  );
}
