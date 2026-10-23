import { labels, type Db } from '@forge/db';
import { createLabelBodySchema, type Label } from '@forge/shared';
import type { FastifyInstance } from 'fastify';
import { recordAudit } from '../audit';
import { orgAccess } from '../auth/guards';
import { isUniqueViolation } from '../db-errors';
import { AppError } from '../errors';
import { parseBody } from '../validation';

export function registerLabelRoutes(app: FastifyInstance, deps: { db: Db }): void {
  const { db } = deps;

  app.post(
    '/api/v1/orgs/:orgId/labels',
    { preHandler: orgAccess(db, 'tickets.edit') },
    async (request, reply): Promise<Label> => {
      const body = parseBody(createLabelBodySchema, request.body);
      const org = request.org!;

      try {
        const label = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(labels)
            .values({ organisationId: org.organisationId, name: body.name, color: body.color })
            .returning({ id: labels.id, name: labels.name, color: labels.color });
          await recordAudit(tx, {
            organisationId: org.organisationId,
            actorUserId: org.actorUserId,
            action: 'label.created',
            targetType: 'label',
            targetId: row!.id,
            after: { name: body.name, color: body.color },
            requestId: request.id,
            source: 'user',
            outcome: 'success',
          });
          return row!;
        });
        reply.status(201);
        return label as Label;
      } catch (error) {
        // Names are unique per workspace regardless of case; the index decides, so two people
        // creating the same name at once cannot both succeed.
        if (isUniqueViolation(error, 'labels_organisation_name_unique')) {
          throw new AppError('conflict', `A label named "${body.name}" already exists.`, 409);
        }
        throw error;
      }
    },
  );
}
