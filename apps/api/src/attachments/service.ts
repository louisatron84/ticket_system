import { addTicketEvent, ticketAttachments, tickets, type Db, type Executor } from '@forge/db';
import { hasControlCharacter, hasPermission, type UploadResult } from '@forge/shared';
import { and, eq, sql } from 'drizzle-orm';
import { AppError } from '../errors';
import { loadAttachments } from '../tickets/content';
import {
  archivedTicketError,
  refuseIfProjectArchived,
  type TicketContext,
} from '../tickets/service';
import { detectType } from './sniff';
import type { AttachmentStorage } from './storage';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TICKET = 100;

const notFound = () => new AppError('not_found', 'Not found.', 404);
const invalid = (message: string, path = 'file') =>
  new AppError('validation_failed', message, 422, [{ path, message }]);

/**
 * The name to keep: only the last part of whatever path was sent, without control characters.
 * It is shown and offered as the download name, never used to find the file.
 */
export function cleanFileName(raw: string | undefined): string {
  let name = raw ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    throw invalid('The file name could not be read.', 'fileName');
  }
  name = name.split(/[\\/]/).pop()!.trim();
  if (!name || name === '.' || name === '..') throw invalid('The file needs a name.', 'fileName');
  if (hasControlCharacter(name)) throw invalid('The file name has control characters.', 'fileName');
  if (name.length > 255) throw invalid('The file name is longer than 255 characters.', 'fileName');
  return name;
}

async function ticketOf(
  executor: Executor,
  organisationId: string,
  ticketKey: string,
  lock = false,
) {
  const query = executor
    .select({ id: tickets.id, archivedAt: tickets.archivedAt })
    .from(tickets)
    .where(and(eq(tickets.organisationId, organisationId), eq(tickets.key, ticketKey)));
  const [ticket] = lock ? await query.for('update') : await query;
  if (!ticket) throw notFound();
  return ticket;
}

export async function uploadAttachment(
  db: Db,
  storage: AttachmentStorage,
  input: { context: TicketContext; ticketKey: string; fileName: string; bytes: Uint8Array },
): Promise<UploadResult> {
  const { context, bytes } = input;
  if (bytes.length === 0) throw invalid('The file is empty.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new AppError('payload_too_large', 'Files can be at most 10 MB.', 413);
  }
  const detected = detectType(bytes, input.fileName);
  if (!detected) {
    throw invalid(
      'Forge accepts PNG, JPEG, GIF and WebP images, PDF, ZIP and plain text files (.txt, .md, .csv, .json, .log).',
    );
  }

  // Checked before the bytes are stored, and again under the lock below.
  const ticket = await ticketOf(db, context.organisationId, input.ticketKey);
  if (ticket.archivedAt) throw archivedTicketError();
  await refuseIfProjectArchived(db, ticket.id);

  const key = await storage.put(bytes);
  try {
    return await db.transaction(async (tx) => {
      const locked = await ticketOf(tx, context.organisationId, input.ticketKey, true);
      if (locked.archivedAt) throw archivedTicketError();
      await refuseIfProjectArchived(tx, locked.id);
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketAttachments)
        .where(eq(ticketAttachments.ticketId, locked.id))) as [{ count: number }];
      if (count >= MAX_ATTACHMENTS_PER_TICKET) {
        throw invalid(`A ticket can have at most ${MAX_ATTACHMENTS_PER_TICKET} attachments.`);
      }
      const [row] = await tx
        .insert(ticketAttachments)
        .values({
          organisationId: context.organisationId,
          ticketId: locked.id,
          uploaderId: context.actorUserId,
          fileName: input.fileName,
          contentType: detected.contentType,
          sizeBytes: bytes.length,
          storageKey: key,
        })
        .returning({ id: ticketAttachments.id });
      await addTicketEvent(tx, {
        organisationId: context.organisationId,
        ticketId: locked.id,
        actorUserId: context.actorUserId,
        event: { type: 'attachment.added', data: { fileName: input.fileName } },
      });
      const attachments = await loadAttachments(tx, locked.id);
      return { created: attachments.find((a) => a.id === row!.id)!, attachments };
    });
  } catch (error) {
    // Nothing points at the stored bytes, so they go.
    await storage.remove(key);
    throw error;
  }
}

/** The attachment row, found only under its own ticket in this workspace. */
async function attachmentOf(
  executor: Executor,
  organisationId: string,
  ticketId: string,
  attachmentId: string,
) {
  const [row] = await executor
    .select()
    .from(ticketAttachments)
    .where(
      and(
        eq(ticketAttachments.organisationId, organisationId),
        eq(ticketAttachments.ticketId, ticketId),
        eq(ticketAttachments.id, attachmentId),
      ),
    );
  if (!row) throw notFound();
  return row;
}

export async function readAttachment(
  db: Db,
  storage: AttachmentStorage,
  input: { organisationId: string; ticketKey: string; attachmentId: string },
): Promise<{ fileName: string; contentType: string; bytes: Buffer }> {
  const ticket = await ticketOf(db, input.organisationId, input.ticketKey);
  const row = await attachmentOf(db, input.organisationId, ticket.id, input.attachmentId);
  return {
    fileName: row.fileName,
    contentType: row.contentType,
    bytes: await storage.get(row.storageKey),
  };
}

export async function deleteAttachment(
  db: Db,
  storage: AttachmentStorage,
  input: { context: TicketContext; ticketKey: string; attachmentId: string },
): Promise<void> {
  const { context } = input;
  const storageKey = await db.transaction(async (tx) => {
    const ticket = await ticketOf(tx, context.organisationId, input.ticketKey, true);
    if (ticket.archivedAt) throw archivedTicketError();
    await refuseIfProjectArchived(tx, ticket.id);
    const row = await attachmentOf(tx, context.organisationId, ticket.id, input.attachmentId);
    const mayDelete =
      row.uploaderId === context.actorUserId || hasPermission(context.permissions, 'tickets.edit');
    if (!mayDelete) {
      throw new AppError('forbidden', 'You can only remove files you attached.', 403);
    }
    await tx.delete(ticketAttachments).where(eq(ticketAttachments.id, row.id));
    await addTicketEvent(tx, {
      organisationId: context.organisationId,
      ticketId: ticket.id,
      actorUserId: context.actorUserId,
      event: { type: 'attachment.removed', data: { fileName: row.fileName } },
    });
    return row.storageKey;
  });
  // After the row is gone: a failed removal leaves an orphaned file, never a row without its file.
  await storage.remove(storageKey);
}
