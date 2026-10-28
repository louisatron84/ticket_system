import type { Db } from '@forge/db';
import {
  addCriterionBodySchema,
  reorderCriteriaBodySchema,
  updateCriterionBodySchema,
  type UploadResult,
  type Criterion,
} from '@forge/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MAX_ATTACHMENT_BYTES,
  cleanFileName,
  deleteAttachment,
  readAttachment,
  uploadAttachment,
} from '../attachments/service';
import { INLINE_TYPES } from '../attachments/sniff';
import type { AttachmentStorage } from '../attachments/storage';
import { orgAccess } from '../auth/guards';
import { AppError } from '../errors';
import {
  addCriterion,
  removeCriterion,
  reorderCriteria,
  updateCriterion,
} from '../tickets/criteria';
import type { TicketContext } from '../tickets/service';
import { parseBody } from '../validation';
import { ticketKeyParam } from './tickets';

const FILE_NAME_HEADER = 'x-file-name';

function idParam(request: { params: unknown }, name: string): string {
  const parsed = z.uuid().safeParse((request.params as Record<string, string>)[name]);
  if (!parsed.success) throw new AppError('not_found', 'Not found.', 404);
  return parsed.data;
}

/** encodeURIComponent leaves some characters RFC 5987 does not allow; encode those too. */
const encodeRfc5987 = (text: string) =>
  encodeURIComponent(text).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** `filename*` per RFC 5987, so any name is safe in the header and still reads right. */
function contentDisposition(kind: 'attachment' | 'inline', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}

/** Acceptance criteria and attachments: what a ticket carries beyond its fields. */
export function registerTicketContentRoutes(
  app: FastifyInstance,
  deps: { db: Db; storage: AttachmentStorage },
): void {
  const { db, storage } = deps;

  const context = (request: FastifyRequest): TicketContext => {
    const org = request.org!;
    return {
      organisationId: org.organisationId,
      actorUserId: org.actorUserId,
      permissions: org.permissions,
    };
  };

  // Uploads are sent as the raw file, so no multipart parser is needed.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  app.post(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/criteria',
    { preHandler: orgAccess(db, 'tickets.edit') },
    async (request, reply): Promise<Criterion[]> => {
      const { text } = parseBody(addCriterionBodySchema, request.body);
      const criteria = await addCriterion(db, {
        context: context(request),
        ticketKey: ticketKeyParam(request),
        text,
      });
      reply.status(201);
      return criteria;
    },
  );

  app.patch(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/criteria/:criterionId',
    { preHandler: orgAccess(db, 'tickets.edit') },
    async (request): Promise<Criterion[]> =>
      updateCriterion(db, {
        context: context(request),
        ticketKey: ticketKeyParam(request),
        criterionId: idParam(request, 'criterionId'),
        body: parseBody(updateCriterionBodySchema, request.body),
      }),
  );

  app.put(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/criteria/order',
    { preHandler: orgAccess(db, 'tickets.edit') },
    async (request): Promise<Criterion[]> =>
      reorderCriteria(db, {
        context: context(request),
        ticketKey: ticketKeyParam(request),
        ids: parseBody(reorderCriteriaBodySchema, request.body).ids,
      }),
  );

  app.delete(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/criteria/:criterionId',
    { preHandler: orgAccess(db, 'tickets.edit') },
    async (request): Promise<Criterion[]> =>
      removeCriterion(db, {
        context: context(request),
        ticketKey: ticketKeyParam(request),
        criterionId: idParam(request, 'criterionId'),
      }),
  );

  app.post(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/attachments',
    // One byte over the limit, so the service (not the parser) explains a file that is too big.
    { preHandler: orgAccess(db, 'tickets.edit'), bodyLimit: MAX_ATTACHMENT_BYTES + 1 },
    async (request, reply): Promise<UploadResult> => {
      if (!Buffer.isBuffer(request.body)) {
        const message = 'Send the file itself as application/octet-stream.';
        throw new AppError('validation_failed', message, 422, [{ path: 'file', message }]);
      }
      const header = request.headers[FILE_NAME_HEADER];
      const attachments = await uploadAttachment(db, storage, {
        context: context(request),
        ticketKey: ticketKeyParam(request),
        fileName: cleanFileName(typeof header === 'string' ? header : undefined),
        bytes: request.body,
      });
      reply.status(201);
      return attachments;
    },
  );

  // Checked on every download: the caller must be able to see the ticket the file belongs to.
  app.get(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/attachments/:attachmentId/file',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request, reply) => {
      const file = await readAttachment(db, storage, {
        organisationId: request.org!.organisationId,
        ticketKey: ticketKeyParam(request),
        attachmentId: idParam(request, 'attachmentId'),
      });
      const wantsInline = (request.query as { inline?: string }).inline === '1';
      const inline = wantsInline && INLINE_TYPES.has(file.contentType);
      reply
        .header('content-type', file.contentType)
        .header(
          'content-disposition',
          contentDisposition(inline ? 'inline' : 'attachment', file.fileName),
        )
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('cross-origin-resource-policy', 'same-site')
        .header('cache-control', 'private, no-store');
      return reply.send(file.bytes);
    },
  );

  app.delete(
    '/api/v1/orgs/:orgId/tickets/:ticketKey/attachments/:attachmentId',
    { preHandler: orgAccess(db, 'tickets.view') },
    async (request, reply): Promise<void> => {
      await deleteAttachment(db, storage, {
        context: context(request),
        ticketKey: ticketKeyParam(request),
        attachmentId: idParam(request, 'attachmentId'),
      });
      reply.status(204).send();
    },
  );
}
