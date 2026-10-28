'use client';

import type { TicketFilters } from '@forge/shared';
import { Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import {
  clearFilters,
  hasActiveFilters,
  hrefFor,
  structureChips,
  toggleFilterValue,
  withFilters,
  type FilterField,
} from '@/lib/ticket-query';
import { buttonClass, inputClass } from '@/lib/ui';
import { CheckboxList, FilterPopover, RadioList, type FilterOption } from './filter-popover';
import { StructureFilter } from './structure-filter';

export type FilterOptions = {
  statusCategories: FilterOption[];
  priorities: FilterOption[];
  types: FilterOption[];
  labels: FilterOption[];
  /** People to pick as assignee or reporter, after the built-in "Me" and "Unassigned". */
  people: FilterOption[];
  /** Only for a list that spans projects. */
  projects: FilterOption[];
};

const DUE_OPTIONS: FilterOption[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Due in the next 7 days' },
  { value: 'none', label: 'No due date' },
];

/**
 * Search, filters and the chips for what is active. Nothing is kept here: every change navigates,
 * so the address always describes what is on screen and a reload, a shared link or the back button
 * all land in the same place.
 */
export function FilterBar({
  basePath,
  filters,
  scoped,
  options,
  ignored,
  trailing,
  showStatus = true,
  showTree = false,
}: {
  basePath: string;
  filters: TicketFilters;
  /** The page belongs to one project, so there is no project filter and none in the address. */
  scoped: boolean;
  /** A board's columns are the statuses, so it has no status filter. */
  showStatus?: boolean;
  options: FilterOptions;
  /** Part of the address was invalid and has been left out. */
  ignored: boolean;
  /** Saved views, aligned to the right. */
  trailing?: ReactNode;
  /** Offer the Tree switch, which nests children under their parents (the list only). */
  showTree?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (next: TicketFilters, mode: 'push' | 'replace' = 'push') =>
    startTransition(() => router[mode](hrefFor(basePath, next, { omitProject: scoped })));

  // Typing in the search box waits for a pause, then replaces the address (so one search is one
  // history entry, not one per keystroke).
  const [text, setText] = useState(filters.q);
  // When the address changes under us (back button, a link), the box follows it.
  const [shownQuery, setShownQuery] = useState(filters.q);
  if (filters.q !== shownQuery) {
    setShownQuery(filters.q);
    setText(filters.q);
  }
  const latest = useRef({ filters, go });
  useEffect(() => {
    latest.current = { filters, go };
  });
  useEffect(() => {
    if (text.trim() === filters.q) return;
    const timer = setTimeout(() => {
      latest.current.go(withFilters(latest.current.filters, { q: text.trim() }), 'replace');
    }, 400);
    return () => clearTimeout(timer);
  }, [text, filters.q]);

  const toggle = (field: FilterField) => (value: string) =>
    go(toggleFilterValue(filters, field, value));

  const people: FilterOption[] = [
    { value: 'me', label: 'Me' },
    { value: 'none', label: 'Unassigned' },
    ...options.people,
  ];
  const reporters: FilterOption[] = [{ value: 'me', label: 'Me' }, ...options.people];

  // What to show as removable chips, with names rather than ids.
  const chips: { key: string; text: string; remove: () => void }[] = [];
  const addChips = (field: FilterField, group: string, choices: FilterOption[]) => {
    for (const value of filters[field]) {
      const name = choices.find((choice) => choice.value === value)?.label ?? value;
      chips.push({
        key: `${field}:${value}`,
        text: `${group}: ${name}`,
        remove: () => go(toggleFilterValue(filters, field, value)),
      });
    }
  };
  if (!scoped) addChips('project', 'Project', options.projects);
  if (showStatus) addChips('statusCategory', 'Status', options.statusCategories);
  addChips('priority', 'Priority', options.priorities);
  addChips('type', 'Type', options.types);
  addChips('assignee', 'Assignee', people);
  addChips('reporter', 'Reporter', reporters);
  addChips('label', 'Label', options.labels);
  if (filters.due) {
    const due = filters.due;
    chips.push({
      key: 'due',
      text: DUE_OPTIONS.find((option) => option.value === due)?.label ?? due,
      remove: () => go(withFilters(filters, { due: undefined })),
    });
  }

  for (const chip of structureChips(filters)) {
    chips.push({ ...chip, remove: () => go(withFilters(filters, chip.remove)) });
  }

  const active = hasActiveFilters(filters, { ignoreProject: scoped });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          role="search"
          className="relative"
          onSubmit={(event) => {
            event.preventDefault();
            go(withFilters(filters, { q: text.trim() }), 'replace');
          }}
        >
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-2.5 text-muted"
          />
          <label htmlFor="ticket-search" className="sr-only">
            Search tickets by title or key
          </label>
          <input
            id="ticket-search"
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Search title or key"
            data-shortcut="search"
            autoComplete="off"
            maxLength={100}
            className={`${inputClass()} w-56 pl-8`}
          />
        </form>

        {!scoped && (
          <FilterPopover label="Project" count={filters.project.length}>
            <CheckboxList
              name="Project"
              options={options.projects}
              selected={filters.project}
              onToggle={toggle('project')}
            />
          </FilterPopover>
        )}
        {showStatus && (
          <FilterPopover label="Status" count={filters.statusCategory.length}>
            <CheckboxList
              name="Status"
              options={options.statusCategories}
              selected={filters.statusCategory}
              onToggle={toggle('statusCategory')}
            />
          </FilterPopover>
        )}
        <FilterPopover label="Priority" count={filters.priority.length}>
          <CheckboxList
            name="Priority"
            options={options.priorities}
            selected={filters.priority}
            onToggle={toggle('priority')}
          />
        </FilterPopover>
        <FilterPopover label="Type" count={filters.type.length}>
          <CheckboxList
            name="Type"
            options={options.types}
            selected={filters.type}
            onToggle={toggle('type')}
          />
        </FilterPopover>
        <FilterPopover label="Assignee" count={filters.assignee.length}>
          <CheckboxList
            name="Assignee"
            options={people}
            selected={filters.assignee}
            onToggle={toggle('assignee')}
          />
        </FilterPopover>
        <FilterPopover label="Label" count={filters.label.length}>
          <CheckboxList
            name="Label"
            options={options.labels}
            selected={filters.label}
            onToggle={toggle('label')}
          />
        </FilterPopover>
        <FilterPopover label="Due" count={filters.due ? 1 : 0}>
          <RadioList
            name="Due"
            options={DUE_OPTIONS}
            selected={filters.due}
            onChoose={(value) => go(withFilters(filters, { due: value as TicketFilters['due'] }))}
          />
        </FilterPopover>

        <StructureFilter
          // A new address (a removed chip, the back button) starts the form afresh.
          key={`${filters.parent}|${filters.epic}|${filters.linked}`}
          filters={filters}
          go={(next) => go(next)}
        />
        {showTree && (
          <button
            type="button"
            role="switch"
            aria-checked={filters.tree}
            onClick={() => go(withFilters(filters, { tree: !filters.tree }))}
            className={`${buttonClass(filters.tree ? 'secondary' : 'ghost')} h-8 px-3 text-[13px]`}
          >
            Tree
          </button>
        )}

        {pending && (
          <span role="status" className="text-xs text-muted">
            Updating
          </span>
        )}
        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>

      {ignored && (
        <p role="status" className="text-[13px] text-muted">
          Some filters in the link were not valid and have been ignored.
        </p>
      )}

      {active && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label="Active filters"
          role="group"
        >
          {filters.q && (
            <Chip
              text={`Text: ${filters.q}`}
              onRemove={() => {
                setText('');
                go(withFilters(filters, { q: '' }));
              }}
            />
          )}
          {chips.map((chip) => (
            <Chip key={chip.key} text={chip.text} onRemove={chip.remove} />
          ))}
          <button
            type="button"
            className={`${buttonClass('ghost')} h-7 px-2 text-xs`}
            onClick={() => {
              setText('');
              go(clearFilters(filters, { keepProject: scoped }));
            }}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

function Chip({ text, onRemove }: { text: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-6 max-w-full items-center gap-1 rounded border border-edge-strong bg-raised pl-2 pr-0.5 text-xs">
      <span className="truncate">{text}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter ${text}`}
        className="inline-flex size-5 items-center justify-center rounded text-muted hover:bg-edge hover:text-text"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  );
}
