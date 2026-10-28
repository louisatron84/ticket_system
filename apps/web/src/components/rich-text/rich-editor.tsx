'use client';

import { imageToken, mentionToken } from '@forge/shared';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import {
  IMAGE_TYPES,
  matchMembers,
  mentionQuery,
  onOwnLine,
  replaceRange,
} from '@/lib/rich-editor';
import { textareaClass } from '@/lib/ui';
import { RichText } from './rich-text';

export type MentionCandidate = { id: string; displayName: string; email: string };

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  placeholder?: string;
  /** People `@` can suggest. */
  members: MentionCandidate[];
  /** Uploads a pasted or dropped file; resolves to the attachment, or null if it was refused. */
  onUpload?: (file: File) => Promise<{ id: string; fileName: string } | null>;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

/**
 * A plain text box with formatting shown on a Preview tab. Typing `@` suggests a member; pasting
 * or dropping an image uploads it and puts it in the text.
 */
export function RichEditor(props: Props) {
  const { id, value, onChange, members, onUpload } = props;
  const area = useRef<HTMLTextAreaElement>(null);
  // The newest text, for uploads that finish after the person has typed more.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const [uploading, setUploading] = useState(0);
  const listId = useId();
  const helpId = `${id}-help`;

  const suggestions = query ? matchMembers(members, query.query) : [];
  const open = suggestions.length > 0;

  function track(next: string, caret: number) {
    setQuery(mentionQuery(next.slice(0, caret)));
    setActive(0);
  }

  function place(nextValue: string, caret: number) {
    latest.current = nextValue;
    onChange(nextValue);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(caret, caret);
    });
  }

  function choose(member: MentionCandidate) {
    if (!query || !area.current) return;
    const caret = area.current.selectionStart;
    const next = replaceRange(
      value,
      query.start,
      caret,
      `${mentionToken(member.id, member.displayName)} `,
    );
    setQuery(null);
    place(next.value, next.caret);
  }

  async function upload(files: File[]) {
    if (!onUpload || files.length === 0) return;
    setUploading((n) => n + files.length);
    for (const file of files) {
      const made = await onUpload(file);
      setUploading((n) => n - 1);
      if (!made || !IMAGE_TYPES.includes(file.type)) continue;
      const text = latest.current;
      const at = Math.min(area.current?.selectionStart ?? text.length, text.length);
      const block = onOwnLine(text, at, imageToken(made.id, made.fileName));
      const next = replaceRange(text, at, at, block);
      place(next.value, next.caret);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files];
    if (files.length === 0 || !onUpload) return;
    event.preventDefault();
    void upload(files);
  }

  function onDrop(event: DragEvent<HTMLTextAreaElement>) {
    const files = [...event.dataTransfer.files];
    if (files.length === 0 || !onUpload) return;
    event.preventDefault();
    void upload(files);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((current) => (current + step + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        choose(suggestions[active]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setQuery(null);
        return;
      }
    }
    props.onKeyDown?.(event);
  }

  const tabClass = (on: boolean) =>
    `rounded px-2 py-0.5 text-xs font-medium ${on ? 'bg-raised text-text' : 'text-muted hover:text-text'}`;

  return (
    <div className="flex flex-col gap-1.5">
      <div role="tablist" aria-label="Write or preview" className="flex gap-1">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'write'}
          className={tabClass(tab === 'write')}
          onClick={() => setTab('write')}
        >
          Write
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'preview'}
          className={tabClass(tab === 'preview')}
          onClick={() => setTab('preview')}
        >
          Preview
        </button>
      </div>

      {tab === 'write' ? (
        <div className="relative">
          <label htmlFor={id} className="sr-only">
            {props.label}
          </label>
          <textarea
            ref={area}
            id={id}
            value={value}
            rows={props.rows ?? 6}
            disabled={props.disabled}
            autoFocus={props.autoFocus}
            placeholder={props.placeholder}
            aria-invalid={props.invalid ? true : undefined}
            aria-describedby={[props.describedBy, helpId].filter(Boolean).join(' ')}
            aria-autocomplete="list"
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open ? `${listId}-${active}` : undefined}
            onChange={(event) => {
              onChange(event.target.value);
              track(event.target.value, event.target.selectionStart);
            }}
            onSelect={(event) =>
              track(event.currentTarget.value, event.currentTarget.selectionStart)
            }
            onBlur={() => setQuery(null)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onDrop={onDrop}
            className={textareaClass(Boolean(props.invalid))}
          />
          {open && (
            <ul
              id={listId}
              role="listbox"
              aria-label="People to mention"
              className="absolute left-2 z-20 mt-1 w-64 overflow-hidden rounded-md border border-edge-strong bg-panel py-1 shadow-lg"
            >
              {suggestions.map((member, index) => (
                <li
                  key={member.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  // Chosen on mouse down, before the text box loses focus and closes the list.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(member);
                  }}
                  className={`cursor-pointer px-3 py-1.5 text-[13px] ${index === active ? 'bg-raised' : ''}`}
                >
                  {member.displayName}
                  <span className="ml-2 text-xs text-muted">{member.email}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="min-h-24 rounded-md border border-edge px-3 py-2">
          {value.trim() ? (
            <RichText text={value} />
          ) : (
            <p className="text-[13px] text-muted">Nothing to preview.</p>
          )}
        </div>
      )}
      <p id={helpId} className="text-[11px] text-muted">
        **bold**, *italic*, `code`, - lists, &gt; quotes, [link](https://…), @ to mention, WEB-12 to
        link a ticket{onUpload ? '; paste or drop an image to attach it' : ''}.
        {uploading > 0 && <span role="status"> Uploading…</span>}
      </p>
    </div>
  );
}
