import type { Db } from '@forge/db';
import {
  copyWorkflowBodySchema,
  createStatusBodySchema,
  deactivateStatusBodySchema,
  reorderStatusesBodySchema,
  saveTransitionsBodySchema,
  updateStatusBodySchema,
  type WorkflowConfig,
} from '@forge/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { orgAccess } from '../auth/guards';
import { parseBody } from '../validation';
import {
  copyWorkflow,
  createStatus,
  deactivateStatus,
  getWorkflow,
  reactivateStatus,
  reorderStatuses,
  saveTransitions,
  updateStatus,
  type WorkflowActor,
} from '../workflow/service';

const BASE = '/api/v1/orgs/:orgId/projects/:projectKey/workflow';

type Params = { projectKey: string; statusId?: string };

/**
 * A project's workflow editor: its statuses (inactive ones too) and the transitions grid, each
 * change answered with the whole workflow as it now is. Everything needs `workflows.configure`.
 * See docs/workflows.md.
 */
export function registerWorkflowRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;
  const guard = { preHandler: orgAccess(db, 'workflows.configure') };

  const actor = (request: FastifyRequest): WorkflowActor => ({
    organisationId: request.org!.organisationId,
    actorUserId: request.org!.actorUserId,
    requestId: request.id,
  });
  const params = (request: FastifyRequest) => request.params as Params;

  app.get(BASE, guard, async (request): Promise<WorkflowConfig> =>
    getWorkflow(db, request.org!.organisationId, params(request).projectKey),
  );

  app.post(`${BASE}/statuses`, guard, async (request, reply): Promise<WorkflowConfig> => {
    const body = parseBody(createStatusBodySchema, request.body);
    const { workflow } = await createStatus(db, actor(request), params(request).projectKey, body);
    reply.status(201);
    return workflow;
  });

  app.patch(`${BASE}/statuses/:statusId`, guard, async (request): Promise<WorkflowConfig> => {
    const body = parseBody(updateStatusBodySchema, request.body);
    const { projectKey, statusId } = params(request);
    return updateStatus(db, actor(request), projectKey, statusId!, body);
  });

  app.put(`${BASE}/order`, guard, async (request): Promise<WorkflowConfig> => {
    const body = parseBody(reorderStatusesBodySchema, request.body);
    return reorderStatuses(db, actor(request), params(request).projectKey, body);
  });

  app.post(
    `${BASE}/statuses/:statusId/deactivate`,
    guard,
    async (request): Promise<WorkflowConfig> => {
      const body = parseBody(deactivateStatusBodySchema, request.body ?? {});
      const { projectKey, statusId } = params(request);
      return deactivateStatus(db, actor(request), projectKey, statusId!, body);
    },
  );

  app.post(
    `${BASE}/statuses/:statusId/reactivate`,
    guard,
    async (request): Promise<WorkflowConfig> => {
      const { projectKey, statusId } = params(request);
      return reactivateStatus(db, actor(request), projectKey, statusId!);
    },
  );

  app.put(`${BASE}/transitions`, guard, async (request): Promise<WorkflowConfig> => {
    const body = parseBody(saveTransitionsBodySchema, request.body);
    return saveTransitions(db, actor(request), params(request).projectKey, body);
  });

  app.post(`${BASE}/copy`, guard, async (request): Promise<WorkflowConfig> => {
    const body = parseBody(copyWorkflowBodySchema, request.body);
    return copyWorkflow(db, actor(request), params(request).projectKey, body);
  });
}
