'use client';

import {
  REACTIONS,
  REACTION_EMOJI,
  type Comment,
  type Reaction,
  type TimelineItem,
} from '@forge/shared';
import { Pencil, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { RichEditor } from '@/components/rich-text/rich-editor';
import { RichText, useRichTextScope } from '@/components/rich-text/rich-text';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { validateComment } from '@/lib/ticket-form';
import { formatRelativeTime } from '@/lib/tickets';
import { groupTimeline, eventAction, type EventGroup } from '@/lib/timeline';
import { buttonClass } from '@/lib/ui';
import { useTicketFiles } from './ticket-content';
import { Avatar } from './user-chip';

type CommentItem = Extract<TimelineItem, { kind: 'comment' }>;

type Props = {
  items: TimelineItem[];
  organisationId: string;
  ticketKey: string;
  viewerUserId: string;
  canComment: boolean;
  /** May delete other people's comments (tickets.edit). */
  canModerate: boolean;
  /** An archived ticket takes no new comments and no changes to the ones it has. */
  archived: boolean;
  /** The server's clock, so relative times read the same once hydrated. */
  now: string;
};

/**
 * Everything that happened to the ticket, oldest first, down a rail. Comments are the entries
 * with a person and their words; the system's own history is a quiet line. People who may comment
 * get a box at the end.
 */
export function TicketTimeline(props: Props) {
  const entries = groupTimeline(props.items);

  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-4">
      <h2 id="activity-heading" className="text-[13px] font-semibold">
        Activity
      </h2>

      {entries.length === 0 ? (
        <p className="text-[13px] text-muted">Nothing has happened to this ticket yet.</p>
      ) : (
        <ol className="relative ml-2.5 flex flex-col gap-5 border-l border-edge pl-6">
          {entries.map((entry) =>
            entry.kind === 'comment' ? (
              <CommentEntry key={entry.item.comment.id} item={entry.item} {...props} />
            ) : (
              <EventEntry key={entry.key} group={entry} now={props.now} />
            ),
          )}
        </ol>
      )}

      {props.archived ? (
        <p className="text-[13px] text-muted">This ticket is archived, so comments are closed.</p>
      ) : props.canComment ? (
        <CommentBox organisationId={props.organisationId} ticketKey={props.ticketKey} />
      ) : (
        <p className="text-[13px] text-muted">
          Your role in this workspace cannot comment on tickets.
        </p>
      )}
    </section>
  );
}

function EventEntry({ group, now }: { group: EventGroup; now: string }) {
  return (
    <li className="relative text-[13px] text-muted">
      <span
        aria-hidden="true"
        className="absolute -left-[29px] top-[7px] size-1.5 rounded-full bg-edge-strong"
      />
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-text">{group.actor?.displayName ?? 'Forge'}</span>
        <time dateTime={group.at} title={group.at} className="shrink-0 text-xs">
          {formatRelativeTime(group.at, now)}
        </time>
      </div>
      <ul className="mt-0.5">
        {group.items.map((item) => (
          <li key={item.id}>{eventAction(item.event)}</li>
        ))}
      </ul>
    </li>
  );
}

function CommentEntry({
  item,
  organisationId,
  ticketKey,
  viewerUserId,
  canComment,
  canModerate,
  archived,
  now,
}: Props & { item: CommentItem }) {
  const router = useRouter();
  const { comment } = item;
  const mine = comment.author.id === viewerUserId;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const problem = validateComment(draft);
  const scope = useRichTextScope();
  const files = useTicketFiles();
  const base = `/api/v1/orgs/${organisationId}/tickets/${ticketKey}/comments/${comment.id}`;

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(base, { method: 'PATCH', json: { body: draft } });
      setEditing(false);
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof ApiRequestError ? failure.message : 'Could not save the comment.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await apiFetch(base, { method: 'DELETE' });
      toast.success('Comment deleted.');
      setDeleting(false);
      router.refresh();
    } catch (failure) {
      toast.error(
        failure instanceof ApiRequestError ? failure.message : 'Could not delete the comment.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="relative">
      <span className="absolute -left-[37px] top-0 rounded-full bg-bg p-0.5">
        <Avatar person={comment.author} size={20} />
      </span>
      <article
        aria-label={`Comment by ${comment.author.displayName}`}
        className="rounded-md border border-edge bg-panel"
      >
        <header className="flex items-center justify-between gap-3 border-b border-edge px-3 py-1.5 text-xs">
          <span className="min-w-0 truncate">
            <span className="text-[13px] font-medium">{comment.author.displayName}</span>
            <time
              dateTime={comment.createdAt}
              title={comment.createdAt}
              className="ml-2 text-muted"
            >
              {formatRelativeTime(comment.createdAt, now)}
            </time>
            {comment.editedAt && (
              <span className="ml-2 text-muted" title={comment.editedAt}>
                edited
              </span>
            )}
          </span>
          {!editing && !archived && (
            <span className="flex shrink-0 items-center gap-0.5">
              {mine && canComment && (
                <button
                  type="button"
                  aria-label="Edit comment"
                  title="Edit comment"
                  onClick={() => {
                    setDraft(comment.body);
                    setEditing(true);
                  }}
                  className="inline-flex size-6 items-center justify-center rounded text-muted hover:bg-raised hover:text-text"
                >
                  <Pencil size={13} aria-hidden="true" />
                </button>
              )}
              {canComment && (mine || canModerate) && (
                <button
                  type="button"
                  aria-label="Delete comment"
                  title="Delete comment"
                  onClick={() => setDeleting(true)}
                  className="inline-flex size-6 items-center justify-center rounded text-muted hover:bg-raised hover:text-text"
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              )}
            </span>
          )}
        </header>

        {editing ? (
          <form onSubmit={saveEdit} className="flex flex-col gap-2 p-3">
            <RichEditor
              id={`edit-${comment.id}`}
              label="Edit your comment"
              value={draft}
              onChange={setDraft}
              autoFocus
              rows={4}
              disabled={busy}
              invalid={Boolean(problem)}
              members={scope?.members ?? []}
              onUpload={files?.canUpload ? files.upload : undefined}
            />
            {(problem || error) && (
              <p role="alert" className="text-xs text-fail">
                {error ?? problem}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                className={buttonClass('primary')}
                disabled={busy || Boolean(problem)}
              >
                {busy ? 'Saving' : 'Save comment'}
              </button>
              <button
                type="button"
                className={buttonClass('secondary')}
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="px-3 py-2.5">
            <RichText text={comment.body} />
          </div>
        )}
        <Reactions comment={comment} base={base} canReact={canComment && !archived} />
      </article>

      <ConfirmDialog
        open={deleting}
        title="Delete this comment?"
        confirmLabel="Delete comment"
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={() => void remove()}
      >
        {mine
          ? 'Your comment will be removed. The history will still note that a comment was deleted.'
          : `${comment.author.displayName}’s comment will be removed. The history will still note that a comment was deleted.`}
      </ConfirmDialog>
    </li>
  );
}

function CommentBox({ organisationId, ticketKey }: { organisationId: string; ticketKey: string }) {
  const router = useRouter();
  const scope = useRichTextScope();
  const files = useTicketFiles();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const problem = body.length > 0 || touched ? validateComment(body) : undefined;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setTouched(true);
    if (validateComment(body)) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/orgs/${organisationId}/tickets/${ticketKey}/comments`, {
        method: 'POST',
        json: { body },
      });
      setBody('');
      setTouched(false);
      router.refresh();
    } catch (failure) {
      // What was typed stays in the box.
      setError(
        failure instanceof ApiRequestError ? failure.message : 'Could not post the comment.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <span aria-hidden="true" className="text-[13px] font-medium">
        Add a comment
      </span>
      <RichEditor
        id="new-comment"
        label="Add a comment"
        value={body}
        onChange={setBody}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit();
        }}
        rows={3}
        disabled={busy}
        invalid={Boolean(error) || Boolean(problem && body.trim().length > 0)}
        describedBy="new-comment-hint"
        placeholder="Write a comment"
        members={scope?.members ?? []}
        onUpload={files?.canUpload ? files.upload : undefined}
      />
      <div className="flex items-center justify-between gap-3">
        <p
          id="new-comment-hint"
          role={error || (problem && body.trim().length > 0) ? 'alert' : undefined}
          className={`text-xs ${error || (problem && body.trim().length > 0) ? 'text-fail' : 'text-muted'}`}
        >
          {error ?? (body.trim().length > 0 ? problem : null) ?? 'Press Ctrl+Enter to post.'}
        </p>
        <button
          type="submit"
          className={buttonClass('primary')}
          disabled={busy || body.trim().length === 0}
        >
          {busy ? 'Posting' : 'Comment'}
        </button>
      </div>
    </form>
  );
}

/** The reactions on a comment, and a way to add one from the fixed set. */
function Reactions({
  comment,
  base,
  canReact,
}: {
  comment: Comment;
  base: string;
  canReact: boolean;
}) {
  const router = useRouter();
  const [reactions, setReactions] = useState(comment.reactions);
  const [picking, setPicking] = useState(false);
  const [seen, setSeen] = useState(comment.reactions);
  // A newer copy from the server (after a refresh) replaces what this showed.
  if (comment.reactions !== seen) {
    setSeen(comment.reactions);
    setReactions(comment.reactions);
  }
  if (reactions.length === 0 && !canReact) return null;

  async function toggle(reaction: Reaction, on: boolean) {
    setPicking(false);
    try {
      const next = await apiFetch<Comment>(`${base}/reactions`, {
        method: 'PUT',
        json: { reaction, on },
      });
      setReactions(next.reactions);
    } catch (failure) {
      toast.error(failure instanceof ApiRequestError ? failure.message : 'Could not react.');
      router.refresh();
    }
  }

  const unused = REACTIONS.filter((reaction) => !reactions.some((r) => r.reaction === reaction));
  return (
    <div
      className="flex flex-wrap items-center gap-1 px-3 pb-2"
      aria-label="Reactions"
      role="group"
    >
      {reactions.map((r) => (
        <button
          key={r.reaction}
          type="button"
          disabled={!canReact}
          aria-pressed={r.mine}
          aria-label={`${REACTION_EMOJI[r.reaction]} ${r.count}, from ${r.names.join(', ')}`}
          title={r.names.join(', ')}
          onClick={() => void toggle(r.reaction, !r.mine)}
          className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs ${r.mine ? 'border-active/60 bg-active/15' : 'border-edge hover:border-edge-strong'}`}
        >
          <span aria-hidden="true">{REACTION_EMOJI[r.reaction]}</span>
          <span aria-hidden="true">{r.count}</span>
        </button>
      ))}
      {canReact && unused.length > 0 && (
        <span className="relative">
          <button
            type="button"
            aria-label="Add a reaction"
            aria-expanded={picking}
            onClick={() => setPicking((open) => !open)}
            className="inline-flex h-6 items-center rounded-full border border-dashed border-edge px-2 text-xs text-muted hover:text-text"
          >
            +☺
          </button>
          {picking && (
            <span
              role="menu"
              aria-label="Reactions"
              className="absolute left-0 top-7 z-20 flex gap-0.5 rounded-md border border-edge-strong bg-panel p-1 shadow-lg"
              onKeyDown={(event) => {
                if (event.key === 'Escape') setPicking(false);
              }}
            >
              {unused.map((reaction) => (
                <button
                  key={reaction}
                  type="button"
                  role="menuitem"
                  aria-label={`React with ${REACTION_EMOJI[reaction]}`}
                  onClick={() => void toggle(reaction, true)}
                  className="inline-flex size-7 items-center justify-center rounded text-base hover:bg-raised"
                >
                  {REACTION_EMOJI[reaction]}
                </button>
              ))}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
