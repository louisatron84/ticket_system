'use client';

import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { validateDescription, validateTitle } from '@/lib/ticket-form';
import { buttonClass, inputClass, textareaClass } from '@/lib/ui';
import { useTicketEditor } from './ticket-editor';

/** The ticket's title. Anyone who may edit can change it in place; everyone else just reads it. */
export function TicketTitle() {
  const { ticket, canEdit, saving, save } = useTicketEditor();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ticket.title);
  const problem = validateTitle(draft);

  async function commit() {
    if (problem) return;
    if (draft.trim() === ticket.title) {
      setEditing(false);
      return;
    }
    if (await save({ title: draft.trim() })) setEditing(false);
  }

  if (editing) {
    return (
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
        <label htmlFor="ticket-title" className="sr-only">
          Title
        </label>
        <input
          id="ticket-title"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          autoFocus
          disabled={saving}
          aria-invalid={problem ? true : undefined}
          aria-describedby="ticket-title-problem"
          className={`${inputClass(Boolean(problem))} h-10 text-lg font-semibold`}
        />
        <p
          id="ticket-title-problem"
          role={problem ? 'alert' : undefined}
          className="min-h-4 text-xs text-fail"
        >
          {problem}
        </p>
        <div className="flex gap-2">
          <button
            type="submit"
            className={buttonClass('primary')}
            disabled={saving || Boolean(problem)}
          >
            {saving ? 'Saving' : 'Save title'}
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
    );
  }

  return (
    <div className="group flex items-start gap-2">
      <h1 className="min-w-0 break-words text-xl font-semibold leading-snug tracking-tight">
        {ticket.title}
      </h1>
      {canEdit && (
        <button
          type="button"
          aria-label="Edit title"
          title="Edit title"
          onClick={() => {
            setDraft(ticket.title);
            setEditing(true);
          }}
          className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded text-muted opacity-60 hover:bg-raised hover:text-text hover:opacity-100 focus-visible:opacity-100"
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** The description as plain text with its line breaks kept. Never interpreted as markup. */
export function TicketDescription() {
  const { ticket, canEdit, saving, save } = useTicketEditor();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ticket.description);
  const problem = validateDescription(draft);

  async function commit() {
    if (problem) return;
    if (draft === ticket.description) {
      setEditing(false);
      return;
    }
    if (await save({ description: draft })) setEditing(false);
  }

  return (
    <section aria-labelledby="description-heading" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 id="description-heading" className="text-[13px] font-semibold">
          Description
        </h2>
        {canEdit && !editing && (
          <button
            type="button"
            className={`${buttonClass('ghost')} h-7 px-2 text-xs`}
            onClick={() => {
              setDraft(ticket.description);
              setEditing(true);
            }}
          >
            <Pencil size={12} aria-hidden="true" />
            Edit
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
        >
          <label htmlFor="ticket-description" className="sr-only">
            Description
          </label>
          <textarea
            id="ticket-description"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
            rows={8}
            disabled={saving}
            aria-invalid={problem ? true : undefined}
            aria-describedby="ticket-description-problem"
            className={textareaClass(Boolean(problem))}
          />
          <p
            id="ticket-description-problem"
            role={problem ? 'alert' : undefined}
            className="min-h-4 text-xs text-fail"
          >
            {problem}
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              className={buttonClass('primary')}
              disabled={saving || Boolean(problem)}
            >
              {saving ? 'Saving' : 'Save description'}
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
      ) : ticket.description ? (
        <p className="max-w-prose whitespace-pre-wrap break-words text-[14px] leading-relaxed">
          {ticket.description}
        </p>
      ) : (
        <p className="text-[13px] text-muted">
          {canEdit
            ? 'No description yet. Add one so the next person knows the context.'
            : 'No description.'}
        </p>
      )}
    </section>
  );
}
