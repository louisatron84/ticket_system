'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { buttonClass, textareaClass } from '@/lib/ui';

/** What a move waiting for its comment is: the ticket, and where it is going. */
export type CommentedMove = { ticketKey: string; statusId: string; statusName: string };

/**
 * Asks for the comment a move needs (a transition with the "needs a comment" rule). The move and
 * the comment are sent together, so the move is never made without it. Used by the ticket page,
 * the list and the board alike.
 */
export function MoveCommentDialog({
  move,
  busy = false,
  onSubmit,
  onCancel,
}: {
  /** The move waiting for a comment; null while there is none, which closes the dialog. */
  move: CommentedMove | null;
  busy?: boolean;
  onSubmit: (comment: string) => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={move !== null} onClose={() => !busy && onCancel()} labelledBy="move-comment-title">
      {/* Keyed by the move, so each one starts with an empty box. */}
      {move && (
        <MoveCommentForm
          key={`${move.ticketKey}:${move.statusId}`}
          move={move}
          busy={busy}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      )}
    </Modal>
  );
}

function MoveCommentForm({
  move,
  busy,
  onSubmit,
  onCancel,
}: {
  move: CommentedMove;
  busy: boolean;
  onSubmit: (comment: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const comment = text.trim();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (comment && !busy) onSubmit(comment);
      }}
      className="flex flex-col gap-3"
    >
      <h2 id="move-comment-title" className="text-base font-semibold">
        Move {move.ticketKey} to {move.statusName}
      </h2>
      <label className="flex flex-col gap-1.5 text-[13px]">
        <span className="text-muted">This move needs a comment. It is added to the ticket.</span>
        <textarea
          autoFocus
          value={text}
          maxLength={10_000}
          onChange={(event) => setText(event.target.value)}
          className={textareaClass()}
          aria-label="Comment"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={buttonClass('secondary')}
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="submit" className={buttonClass('primary')} disabled={busy || !comment}>
          {busy ? 'Moving' : `Move to ${move.statusName}`}
        </button>
      </div>
    </form>
  );
}
