'use client';

import type { Attachment, Criterion, TicketRef, UploadResult } from '@forge/shared';
import { MAX_CRITERIA, MAX_CRITERION_LENGTH, MAX_GOAL_LENGTH } from '@forge/shared';
import { ArrowDown, ArrowUp, Paperclip, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { RichLine, attachmentUrl } from '@/components/rich-text/rich-text';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { workspaceHref } from '@/lib/nav';
import { formatBytes } from '@/lib/rich-editor';
import { buttonClass, inputClass, textareaClass } from '@/lib/ui';
import { useTicketEditor } from './ticket-editor';

const failure = (error: unknown) =>
  error instanceof ApiRequestError ? error.message : 'Something went wrong. Try again.';

// ---------------------------------------------------------------------------
// Files: one list for the page, so an image pasted into the description shows up in it too.
// ---------------------------------------------------------------------------

type Files = {
  attachments: Attachment[];
  canUpload: boolean;
  upload: (file: File) => Promise<Attachment | null>;
  remove: (id: string) => Promise<void>;
};

const FilesContext = createContext<Files | null>(null);

export function useTicketFiles(): Files | null {
  return useContext(FilesContext);
}

export function TicketFilesProvider({
  organisationId,
  ticketKey,
  initial,
  canUpload,
  children,
}: {
  organisationId: string;
  ticketKey: string;
  initial: Attachment[];
  canUpload: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [attachments, setAttachments] = useState(initial);
  const base = `/api/v1/orgs/${organisationId}/tickets/${ticketKey}/attachments`;

  async function upload(file: File): Promise<Attachment | null> {
    try {
      const result = await apiFetch<UploadResult>(base, {
        method: 'POST',
        body: file,
        headers: {
          'content-type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name || 'pasted image.png'),
        },
      });
      setAttachments(result.attachments);
      router.refresh();
      return result.created;
    } catch (error) {
      toast.error(`${file.name || 'The file'}: ${failure(error)}`);
      return null;
    }
  }

  async function remove(id: string) {
    try {
      await apiFetch(`${base}/${id}`, { method: 'DELETE' });
      setAttachments((current) => current.filter((item) => item.id !== id));
      router.refresh();
    } catch (error) {
      toast.error(failure(error));
    }
  }

  return (
    <FilesContext.Provider value={{ attachments, canUpload, upload, remove }}>
      {children}
    </FilesContext.Provider>
  );
}

export function TicketAttachments({
  organisationId,
  ticketKey,
  viewerId,
  canModerate,
}: {
  organisationId: string;
  ticketKey: string;
  viewerId: string;
  /** May remove anyone's files (tickets.edit, not archived). */
  canModerate: boolean;
}) {
  const files = useTicketFiles()!;
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (files.attachments.length === 0 && !files.canUpload) return null;

  async function send(list: FileList | null) {
    if (!list) return;
    setBusy(true);
    for (const file of [...list]) await files.upload(file);
    setBusy(false);
    if (picker.current) picker.current.value = '';
  }

  return (
    <section aria-labelledby="attachments-heading" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 id="attachments-heading" className="text-[13px] font-semibold">
          Attachments
          {files.attachments.length > 0 && (
            <span className="ml-1.5 font-normal text-muted">{files.attachments.length}</span>
          )}
        </h2>
        {files.canUpload && (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              className="sr-only"
              id="attachment-picker"
              aria-label="Attach files"
              onChange={(event) => void send(event.target.files)}
            />
            <button
              type="button"
              className={`${buttonClass('ghost')} h-7 px-2 text-xs`}
              disabled={busy}
              onClick={() => picker.current?.click()}
            >
              <Paperclip size={12} aria-hidden="true" />
              {busy ? 'Uploading' : 'Attach'}
            </button>
          </>
        )}
      </div>
      {files.attachments.length === 0 ? (
        <p className="text-[13px] text-muted">
          No files yet. Attach one, or paste a screenshot into the description.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-edge rounded-md border border-edge">
          {files.attachments.map((file) => {
            const href = attachmentUrl({ organisationId, ticketKey }, file.id);
            const image = file.contentType.startsWith('image/');
            return (
              <li key={file.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                {image ? (
                  <img
                    src={attachmentUrl({ organisationId, ticketKey }, file.id, true)}
                    alt=""
                    loading="lazy"
                    className="size-9 shrink-0 rounded border border-edge object-cover"
                  />
                ) : (
                  <Paperclip size={16} aria-hidden="true" className="shrink-0 text-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <a href={href} className="block truncate font-medium hover:underline" download>
                    {file.fileName}
                  </a>
                  <p className="text-xs text-muted">
                    {formatBytes(file.sizeBytes)} · {file.uploader.displayName} ·{' '}
                    {file.createdAt.slice(0, 10)}
                  </p>
                </div>
                {(canModerate || (files.canUpload && file.uploader.id === viewerId)) && (
                  <button
                    type="button"
                    aria-label={`Remove ${file.fileName}`}
                    title="Remove"
                    className={`${buttonClass('ghost')} size-7 px-0`}
                    onClick={() => void files.remove(file.id)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Goal
// ---------------------------------------------------------------------------

export function TicketGoal() {
  const { ticket, canEdit, saving, save } = useTicketEditor();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ticket.goal);
  const tooLong = draft.length > MAX_GOAL_LENGTH;

  if (!ticket.goal && !canEdit) return null;

  async function commit() {
    if (tooLong) return;
    if (draft === ticket.goal || (await save({ goal: draft }))) setEditing(false);
  }

  return (
    <section aria-labelledby="goal-heading" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <h2 id="goal-heading" className="text-[13px] font-semibold">
          Goal
        </h2>
        {canEdit && !editing && (
          <button
            type="button"
            className={`${buttonClass('ghost')} h-7 px-2 text-xs`}
            onClick={() => {
              setDraft(ticket.goal);
              setEditing(true);
            }}
          >
            <Pencil size={12} aria-hidden="true" />
            {ticket.goal ? 'Edit' : 'Add'}
            <span className="sr-only"> goal</span>
          </button>
        )}
      </div>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setEditing(false);
          }}
        >
          <label htmlFor="ticket-goal" className="sr-only">
            Goal
          </label>
          <textarea
            id="ticket-goal"
            value={draft}
            rows={2}
            autoFocus
            disabled={saving}
            placeholder="Why this matters, in a line or two"
            onChange={(event) => setDraft(event.target.value)}
            aria-invalid={tooLong ? true : undefined}
            aria-describedby="ticket-goal-problem"
            className={`${textareaClass(tooLong)} min-h-14`}
          />
          <p
            id="ticket-goal-problem"
            role={tooLong ? 'alert' : undefined}
            className="min-h-4 text-xs text-fail"
          >
            {tooLong ? `Keep the goal to ${MAX_GOAL_LENGTH} characters.` : ''}
          </p>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass('primary')} disabled={saving || tooLong}>
              {saving ? 'Saving' : 'Save goal'}
            </button>
            <button
              type="button"
              className={buttonClass('secondary')}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : ticket.goal ? (
        <p className="max-w-prose whitespace-pre-wrap break-words text-[14px] leading-relaxed">
          <RichLine text={ticket.goal} />
        </p>
      ) : (
        <p className="text-[13px] text-muted">No goal yet. Say why this work matters.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Acceptance criteria
// ---------------------------------------------------------------------------

export function AcceptanceCriteria({
  organisationId,
  ticketKey,
  initial,
  canEdit,
}: {
  organisationId: string;
  ticketKey: string;
  initial: Criterion[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/v1/orgs/${organisationId}/tickets/${ticketKey}/criteria`;

  if (items.length === 0 && !canEdit) return null;

  async function run(request: () => Promise<Criterion[]>) {
    setBusy(true);
    try {
      setItems(await request());
      router.refresh();
      return true;
    } catch (error) {
      toast.error(failure(error));
      // Someone else may have changed the list; show it as it is now.
      router.refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }

  const done = items.filter((item) => item.done).length;
  const move = (index: number, by: number) => {
    const ids = items.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    return run(() => apiFetch(`${base}/order`, { method: 'PUT', json: { ids } }));
  };

  return (
    <section aria-labelledby="criteria-heading" className="flex flex-col gap-2">
      <h2 id="criteria-heading" className="text-[13px] font-semibold">
        Acceptance criteria
        {items.length > 0 && (
          <span className="ml-1.5 font-normal text-muted">
            {done} of {items.length} met
          </span>
        )}
      </h2>
      {items.length > 0 && (
        <ul className="flex flex-col gap-0.5" aria-label="Acceptance criteria">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="group flex items-start gap-2 rounded px-1 py-1 hover:bg-raised/50"
            >
              <input
                type="checkbox"
                id={`criterion-${item.id}`}
                checked={item.done}
                disabled={!canEdit || busy}
                onChange={(event) => {
                  const done = event.target.checked;
                  // Shown at once; the server's answer puts it right if the tick is refused.
                  setItems((current) =>
                    current.map((other) => (other.id === item.id ? { ...other, done } : other)),
                  );
                  void run(() =>
                    apiFetch(`${base}/${item.id}`, { method: 'PATCH', json: { done } }),
                  );
                }}
                className="mt-1 size-3.5 shrink-0 accent-[var(--ok)]"
              />
              {editingId === item.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const text = editText.trim();
                    if (!text) return;
                    const ok =
                      text === item.text ||
                      (await run(() =>
                        apiFetch(`${base}/${item.id}`, { method: 'PATCH', json: { text } }),
                      ));
                    if (ok) setEditingId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setEditingId(null);
                  }}
                >
                  <label htmlFor={`criterion-edit-${item.id}`} className="sr-only">
                    Criterion
                  </label>
                  <input
                    id={`criterion-edit-${item.id}`}
                    value={editText}
                    maxLength={MAX_CRITERION_LENGTH}
                    autoFocus
                    onChange={(event) => setEditText(event.target.value)}
                    className={inputClass()}
                  />
                  <button type="submit" className={buttonClass('primary')} disabled={busy}>
                    Save
                  </button>
                </form>
              ) : (
                <label
                  htmlFor={`criterion-${item.id}`}
                  className={`min-w-0 flex-1 break-words text-[14px] leading-snug ${item.done ? 'text-muted line-through decoration-muted/60' : ''}`}
                  title={
                    item.done && item.doneBy ? `Ticked by ${item.doneBy.displayName}` : undefined
                  }
                >
                  <RichLine text={item.text} />
                </label>
              )}
              {canEdit && editingId !== item.id && (
                <div className="flex shrink-0 items-center opacity-60 group-hover:opacity-100 group-focus-within:opacity-100">
                  <IconButton
                    label={`Move "${item.text}" up`}
                    disabled={busy || index === 0}
                    onClick={() => void move(index, -1)}
                  >
                    <ArrowUp size={12} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Move "${item.text}" down`}
                    disabled={busy || index === items.length - 1}
                    onClick={() => void move(index, 1)}
                  >
                    <ArrowDown size={12} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Edit "${item.text}"`}
                    disabled={busy}
                    onClick={() => {
                      setEditingId(item.id);
                      setEditText(item.text);
                    }}
                  >
                    <Pencil size={12} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Remove "${item.text}"`}
                    disabled={busy}
                    onClick={() =>
                      void run(() => apiFetch(`${base}/${item.id}`, { method: 'DELETE' }))
                    }
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length === 0 && (
        <p className="text-[13px] text-muted">
          No criteria yet. List what the reviewer should check before this is done.
        </p>
      )}
      {canEdit && items.length < MAX_CRITERIA && (
        <form
          className="flex gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const text = draft.trim();
            if (!text) return;
            if (await run(() => apiFetch(base, { method: 'POST', json: { text } }))) setDraft('');
          }}
        >
          <label htmlFor="new-criterion" className="sr-only">
            New acceptance criterion
          </label>
          <input
            id="new-criterion"
            value={draft}
            maxLength={MAX_CRITERION_LENGTH}
            placeholder="Add a criterion"
            onChange={(event) => setDraft(event.target.value)}
            className={inputClass()}
          />
          <button
            type="submit"
            className={buttonClass('secondary')}
            disabled={busy || !draft.trim()}
          >
            Add
          </button>
        </form>
      )}
    </section>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-6 items-center justify-center rounded text-muted hover:bg-raised hover:text-text disabled:opacity-30"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Mentioned in
// ---------------------------------------------------------------------------

export function MentionedIn({ slug, tickets }: { slug: string; tickets: TicketRef[] }) {
  if (tickets.length === 0) return null;
  return (
    <section aria-labelledby="mentioned-heading" className="flex flex-col gap-1.5">
      <h2 id="mentioned-heading" className="text-[13px] font-semibold">
        Mentioned in
      </h2>
      <ul className="flex flex-col gap-1 text-[13px]">
        {tickets.map((ref) => (
          <li key={ref.key} className="min-w-0 truncate">
            <Link href={workspaceHref(slug, `/tickets/${ref.key}`)} className="hover:underline">
              <span className="font-mono text-xs text-muted">{ref.key}</span> {ref.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
