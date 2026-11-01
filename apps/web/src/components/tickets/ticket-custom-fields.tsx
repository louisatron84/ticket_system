'use client';

import type { Member, TicketField } from '@forge/shared';
import { useId, useState } from 'react';
import { inputClass } from '@/lib/ui';
import { useTicketEditor } from './ticket-editor';

/**
 * The ticket's custom fields: every active field that applies to its type, with or without a
 * value. People who may edit change them in place; everyone else reads the value in words.
 */
export function TicketCustomFields({ members }: { members: Member[] }) {
  const { ticket, canEdit, saving, saveField } = useTicketEditor();
  if (ticket.fields.length === 0) return null;

  return (
    <section aria-label="Custom fields" className="rounded-md border border-edge bg-panel px-4">
      <dl className="divide-y divide-edge">
        {ticket.fields.map((field) => (
          <FieldRow
            key={`${field.fieldId}:${ticket.version}`}
            field={field}
            canEdit={canEdit}
            busy={saving}
            members={members}
            onSave={(value) => saveField(field.fieldId, value)}
          />
        ))}
      </dl>
    </section>
  );
}

function FieldRow({
  field,
  canEdit,
  busy,
  members,
  onSave,
}: {
  field: TicketField;
  canEdit: boolean;
  busy: boolean;
  members: Member[];
  onSave: (value: unknown) => Promise<boolean>;
}) {
  const id = useId();
  // A person field without the member list (no members.view) can only be read.
  const editable = canEdit && (field.kind !== 'person' || members.length > 0);
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-start gap-3 py-2">
      <dt>
        <label
          htmlFor={editable ? id : undefined}
          className="pt-1.5 text-xs text-muted"
          title={field.description || undefined}
        >
          {field.name}
        </label>
      </dt>
      <dd className="min-w-0 text-[13px]">
        {editable ? (
          <FieldEditor id={id} field={field} busy={busy} members={members} onSave={onSave} />
        ) : (
          <ReadOnlyValue field={field} />
        )}
      </dd>
    </div>
  );
}

function ReadOnlyValue({ field }: { field: TicketField }) {
  if (field.text === null) return <span className="text-muted">None</span>;
  if (field.kind === 'url' && typeof field.value === 'string') {
    return (
      <a
        href={field.value}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="break-all underline"
      >
        {field.text}
      </a>
    );
  }
  return <span className="whitespace-pre-wrap break-words">{field.text}</span>;
}

/** A text-like value saved when the field loses focus, and only if it changed. */
function TextEditor({
  id,
  initial,
  type,
  multiline,
  busy,
  label,
  onSave,
}: {
  id: string;
  initial: string;
  type: 'text' | 'number' | 'date' | 'url';
  multiline?: boolean;
  busy: boolean;
  label: string;
  onSave: (text: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(initial);
  const save = async () => {
    if (value === initial) return;
    if (!(await onSave(value))) setValue(initial);
  };
  const shared = {
    id,
    value,
    disabled: busy,
    'aria-label': label,
    onBlur: () => void save(),
    className: `${inputClass()} w-full`,
  };
  return multiline ? (
    <textarea {...shared} rows={3} onChange={(event) => setValue(event.target.value)} />
  ) : (
    <input
      {...shared}
      type={type}
      step={type === 'number' ? 'any' : undefined}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') setValue(initial);
      }}
    />
  );
}

function FieldEditor({
  id,
  field,
  busy,
  members,
  onSave,
}: {
  id: string;
  field: TicketField;
  busy: boolean;
  members: Member[];
  onSave: (value: unknown) => Promise<boolean>;
}) {
  const value = field.value;
  const label = field.name;
  const offered = field.options.filter(
    (option) =>
      option.active || option.id === value || (Array.isArray(value) && value.includes(option.id)),
  );

  switch (field.kind) {
    case 'text':
    case 'url':
    case 'long_text':
      return (
        <TextEditor
          id={id}
          label={label}
          initial={typeof value === 'string' ? value : ''}
          type={field.kind === 'url' ? 'url' : 'text'}
          multiline={field.kind === 'long_text'}
          busy={busy}
          onSave={(text) => onSave(text.trim() === '' ? null : text)}
        />
      );
    case 'number':
      return (
        <TextEditor
          id={id}
          label={label}
          initial={typeof value === 'number' ? String(value) : ''}
          type="number"
          busy={busy}
          onSave={(text) => onSave(text.trim() === '' ? null : Number(text))}
        />
      );
    case 'date':
      return (
        <TextEditor
          id={id}
          label={label}
          initial={typeof value === 'string' ? value : ''}
          type="date"
          busy={busy}
          onSave={(text) => onSave(text === '' ? null : text)}
        />
      );
    case 'boolean':
      return (
        <select
          id={id}
          value={value === true ? 'yes' : value === false ? 'no' : ''}
          disabled={busy}
          onChange={(event) =>
            void onSave(event.target.value === '' ? null : event.target.value === 'yes')
          }
          className={`${inputClass()} w-full`}
        >
          <option value="">None</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      );
    case 'select':
      return (
        <select
          id={id}
          value={typeof value === 'string' ? value : ''}
          disabled={busy}
          onChange={(event) => void onSave(event.target.value || null)}
          className={`${inputClass()} w-full`}
        >
          <option value="">None</option>
          {offered.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
              {option.active ? '' : ' (turned off)'}
            </option>
          ))}
        </select>
      );
    case 'multi_select': {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <fieldset id={id} className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
          <legend className="sr-only">{label}</legend>
          {offered.length === 0 && <span className="text-muted">No options yet.</span>}
          {offered.map((option) => (
            <label key={option.id} className="flex items-center gap-1 text-[13px]">
              <input
                type="checkbox"
                checked={chosen.includes(option.id)}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...chosen, option.id]
                    : chosen.filter((optionId) => optionId !== option.id);
                  void onSave(next.length === 0 ? null : next);
                }}
              />
              {option.name}
            </label>
          ))}
        </fieldset>
      );
    }
    case 'person':
      return (
        <select
          id={id}
          value={typeof value === 'string' ? value : ''}
          disabled={busy}
          onChange={(event) => void onSave(event.target.value || null)}
          className={`${inputClass()} w-full`}
        >
          <option value="">Nobody</option>
          {members.map((member) => (
            <option key={member.user.id} value={member.user.id}>
              {member.user.displayName}
            </option>
          ))}
        </select>
      );
  }
}
