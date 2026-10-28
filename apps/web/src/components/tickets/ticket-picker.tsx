'use client';

import type { Project, TicketList, TicketSummary } from '@forge/shared';
import { useEffect, useId, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { inputClass } from '@/lib/ui';
import { StatusGlyph } from './badges';

const SEARCH_DELAY_MS = 150;

/**
 * A search box that finds a ticket by key or title and hands back its key. Archived tickets are
 * never offered (the list leaves them out), nor are the keys in `exclude`.
 */
export function TicketPicker({
  organisationId,
  label,
  exclude = [],
  autoFocus = false,
  disabled = false,
  onPick,
}: {
  organisationId: string;
  label: string;
  exclude?: string[];
  autoFocus?: boolean;
  disabled?: boolean;
  onPick: (key: string) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ text: string; tickets: TicketSummary[] }>({
    text: '',
    tickets: [],
  });
  const [active, setActive] = useState(0);
  const text = query.trim();
  // Tickets of archived projects cannot be linked or parented, so they are never offered.
  const [archivedProjects, setArchivedProjects] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let current = true;
    apiFetch<Project[]>(`/api/v1/orgs/${organisationId}/projects`)
      .then((projects) => {
        if (current) {
          setArchivedProjects(new Set(projects.filter((p) => p.archived).map((p) => p.key)));
        }
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [organisationId]);

  useEffect(() => {
    if (!text) return;
    let current = true;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: text, pageSize: '8' });
      apiFetch<TicketList>(`/api/v1/orgs/${organisationId}/tickets?${params}`)
        .then((list) => current && setFound({ text, tickets: list.items }))
        .catch(() => current && setFound({ text, tickets: [] }));
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [organisationId, text]);

  const options =
    text && found.text === text
      ? found.tickets.filter(
          (t) => !exclude.includes(t.key) && !archivedProjects.has(t.project.key),
        )
      : [];
  const open = options.length > 0;
  const chosen = Math.min(active, Math.max(0, options.length - 1));

  const pick = (key: string) => {
    setQuery('');
    setActive(0);
    onPick(key);
  };

  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor={`${id}-input`} className="text-xs text-muted">
        {label}
      </label>
      <input
        id={`${id}-input`}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        aria-activedescendant={open ? `${id}-option-${chosen}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder="Key or title"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && open) {
            event.preventDefault();
            setActive((chosen + 1) % options.length);
          } else if (event.key === 'ArrowUp' && open) {
            event.preventDefault();
            setActive((chosen - 1 + options.length) % options.length);
          } else if (event.key === 'Enter' && open) {
            event.preventDefault();
            pick(options[chosen]!.key);
          }
        }}
        className={inputClass()}
      />
      <ul
        id={`${id}-options`}
        role="listbox"
        aria-label={label}
        hidden={!open}
        className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-edge-strong bg-panel py-1 shadow-lg"
      >
        {options.map((ticket, index) => (
          <li
            key={ticket.key}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={index === chosen}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(ticket.key)}
            className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] ${
              index === chosen ? 'bg-raised' : ''
            }`}
          >
            <StatusGlyph category={ticket.status.category} statusKey={ticket.status.key} />
            <span className="font-mono text-xs text-muted">{ticket.key}</span>
            <span className="truncate">{ticket.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
