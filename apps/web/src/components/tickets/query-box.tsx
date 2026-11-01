'use client';

import {
  applyTicketQuery,
  parseTicketQuery,
  queryContextSchema,
  suggestQuery,
  type QueryContext,
  type QueryIssue,
  type TicketFilters,
} from '@forge/shared';
import { Search } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { withFilters } from '@/lib/ticket-query';
import { inputClass } from '@/lib/ui';

/** Words like `status:` turn the box from a plain search into a query. */
const looksLikeQuery = (text: string) => /(^|\s)-?[a-zA-Z]+:/.test(text);

/**
 * The search box. Plain words search titles and keys as you type; words like `assignee:me` make
 * it a query, applied on Enter, with suggestions as you type and its problems shown under it.
 * What a query sets shows as chips; the box keeps only the plain words.
 */
export function QueryBox({
  organisationId,
  filters,
  go,
}: {
  organisationId: string;
  filters: TicketFilters;
  go: (next: TicketFilters, mode?: 'push' | 'replace') => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(filters.q);
  // When the address changes under us (back button, a link), the box follows it.
  const [shownQuery, setShownQuery] = useState(filters.q);
  if (filters.q !== shownQuery) {
    setShownQuery(filters.q);
    setText(filters.q);
  }
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [issues, setIssues] = useState<QueryIssue[]>([]);
  const [context, setContext] = useState<QueryContext | null>(null);
  // The one request for the names, shared by everything that needs them while it runs.
  const loading = useRef<Promise<QueryContext | null> | null>(null);
  // Where the caret goes once the box shows the text a suggestion made.
  const pendingCaret = useRef<number | null>(null);
  const queryMode = looksLikeQuery(text);

  // Typing plain words waits for a pause, then replaces the address (so one search is one
  // history entry, not one per keystroke). A query waits for Enter.
  const latest = useRef({ filters, go });
  useEffect(() => {
    latest.current = { filters, go };
  });
  useEffect(() => {
    if (queryMode || text.trim() === filters.q) return;
    const timer = setTimeout(() => {
      latest.current.go(withFilters(latest.current.filters, { q: text.trim() }), 'replace');
    }, 400);
    return () => clearTimeout(timer);
  }, [text, filters.q, queryMode]);

  /** The names a query can use, fetched once, the first time the box is used. */
  function loadContext(): Promise<QueryContext | null> {
    if (context) return Promise.resolve(context);
    loading.current ??= apiFetch<unknown>(`/api/v1/orgs/${organisationId}/ticket-query/context`)
      .then((raw) => {
        const loaded = queryContextSchema.parse(raw);
        setContext(loaded);
        return loaded;
      })
      .catch(() => {
        // Let a later attempt try again.
        loading.current = null;
        return null;
      });
    return loading.current;
  }

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [text]);

  const suggestions =
    context && focused && text.trim() !== '' ? suggestQuery(text, cursor, context) : null;
  const items = suggestions?.items ?? [];
  const open = items.length > 0;

  function edit(next: string, caret: number) {
    setText(next);
    setCursor(caret);
    setActive(-1);
    setIssues([]);
  }

  function accept(index: number) {
    if (!suggestions) return;
    const item = suggestions.items[index];
    if (!item) return;
    // A filter name waits for its value; a finished value is followed by a space.
    const after = text.slice(suggestions.to);
    const spacer = item.insert.endsWith(':') || after.startsWith(' ') ? '' : ' ';
    const next = text.slice(0, suggestions.from) + item.insert + spacer + after;
    const caret = suggestions.from + item.insert.length + spacer.length;
    edit(next, caret);
    pendingCaret.current = caret;
  }

  async function submit() {
    if (!queryMode) {
      go(withFilters(filters, { q: text.trim() }), 'replace');
      return;
    }
    const loaded = await loadContext();
    if (!loaded) {
      setIssues([
        { message: 'Could not load the names to check the query against.', start: 0, end: 0 },
      ]);
      return;
    }
    const parsed = parseTicketQuery(text, loaded);
    if (!parsed.ok) {
      setIssues(parsed.issues);
      return;
    }
    setIssues([]);
    go(applyTicketQuery(filters, parsed));
  }

  const listId = `${id}-suggestions`;
  const issuesId = `${id}-issues`;

  return (
    <div className="relative flex flex-col gap-1">
      <form
        role="search"
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Search
          size={14}
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-2.5 text-muted"
        />
        <label htmlFor="ticket-search" className="sr-only">
          Search tickets, or filter with words like assignee:me
        </label>
        <input
          ref={input}
          id="ticket-search"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          aria-invalid={issues.length > 0 || undefined}
          aria-describedby={issues.length > 0 ? issuesId : undefined}
          value={text}
          onChange={(event) =>
            edit(event.target.value, event.target.selectionStart ?? event.target.value.length)
          }
          onSelect={(event) => setCursor(event.currentTarget.selectionStart ?? 0)}
          onFocus={() => {
            setFocused(true);
            void loadContext();
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => (index + 1) % items.length);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => (index <= 0 ? items.length - 1 : index - 1));
            } else if ((event.key === 'Enter' || event.key === 'Tab') && active >= 0) {
              event.preventDefault();
              accept(active);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setFocused(false);
            }
          }}
          placeholder="Search, or try assignee:me"
          data-shortcut="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
          className={`${inputClass()} w-72 pl-8 ${queryMode ? 'font-mono text-[13px]' : ''}`}
        />
      </form>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="absolute top-full z-30 mt-1 flex w-72 flex-col rounded-md border border-edge bg-panel py-1 shadow-lg"
        >
          {items.map((item, index) => (
            <li
              key={`${item.label}-${index}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // Keeps focus in the box, so the choice lands where the cursor is.
              onMouseDown={(event) => {
                event.preventDefault();
                accept(index);
              }}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1 text-[13px] ${
                index === active ? 'bg-raised text-text' : 'text-text hover:bg-raised'
              }`}
            >
              <span className="truncate font-mono">{item.label}</span>
              {item.detail && <span className="truncate text-xs text-muted">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {issues.length > 0 && (
        <ul id={issuesId} role="alert" className="flex w-72 flex-col gap-0.5 text-xs text-fail">
          {issues.map((issue) => (
            <li key={`${issue.start}-${issue.message}`}>
              {issue.end > issue.start && (
                <span className="mr-1 font-mono">{text.slice(issue.start, issue.end)}:</span>
              )}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
