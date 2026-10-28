'use client';

import type { TicketDetail, UpdateTicketBody } from '@forge/shared';
import { TriangleAlert, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { fieldPermissions } from '@/lib/ticket-form';
import { buttonClass } from '@/lib/ui';

type Patch = Partial<Omit<UpdateTicketBody, 'version'>>;

type Editor = {
  ticket: TicketDetail;
  saving: boolean;
  canEdit: boolean;
  canAssign: boolean;
  canComment: boolean;
  /** Saves one change with the version this person is looking at. True if it was saved. */
  save: (patch: Patch) => Promise<boolean>;
};

const EditorContext = createContext<Editor | null>(null);

export function useTicketEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('useTicketEditor must be used inside a TicketEditorProvider.');
  return editor;
}

/**
 * Holds the ticket being looked at and saves changes to it, one at a time, each carrying the
 * version this person saw. If someone else changed the ticket first the save is refused, a banner
 * says so, and whatever was typed stays where it is so nothing is lost.
 */
export function TicketEditorProvider({
  initial,
  organisationId,
  permissions,
  children,
}: {
  initial: TicketDetail;
  organisationId: string;
  permissions: readonly string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [ticket, setTicket] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  // When the server sends a newer copy (after a reload, or someone else's change), take it.
  const [seenVersion, setSeenVersion] = useState(initial.version);
  if (initial.version !== seenVersion) {
    setSeenVersion(initial.version);
    setTicket(initial);
    setConflict(false);
  }

  // An archived ticket is read-only for everyone, whatever their role allows.
  const archived = ticket.archivedAt !== null;
  const allowed = fieldPermissions(permissions);
  const canEdit = allowed.canEdit && !archived;
  const canAssign = allowed.canAssign && !archived;
  const canComment = allowed.canComment && !archived;

  async function save(patch: Patch): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    setError(null);
    try {
      const next = await apiFetch<TicketDetail>(
        `/api/v1/orgs/${organisationId}/tickets/${ticket.key}`,
        { method: 'PATCH', json: { version: ticket.version, ...patch } },
      );
      setTicket(next);
      setConflict(false);
      // The history on the page is rendered by the server; ask for it again.
      router.refresh();
      return true;
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 409) setConflict(true);
      else setError(failure instanceof ApiRequestError ? failure.message : 'Could not save.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditorContext.Provider value={{ ticket, saving, canEdit, canAssign, canComment, save }}>
      {conflict && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-edge-strong bg-raised px-3 py-2 text-[13px]"
        >
          <TriangleAlert size={16} aria-hidden="true" className="shrink-0" />
          <p className="min-w-0 flex-1">
            This ticket changed while you were looking at it. Reload to see the latest. What you
            typed is still there.
          </p>
          <button
            type="button"
            className={buttonClass('secondary')}
            onClick={() => {
              router.refresh();
            }}
          >
            Reload
          </button>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-md border border-fail/50 bg-fail/10 px-3 py-2 text-[13px]"
        >
          <p className="min-w-0 flex-1">{error}</p>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-muted hover:text-text"
            onClick={() => setError(null)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      {children}
    </EditorContext.Provider>
  );
}
