'use client';

import {
  CARD_FIELD_KEYS,
  type BoardDensity,
  type BoardLanes,
  type BoardShow,
  type CardFields,
} from '@forge/shared';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { FilterPopover } from '@/components/tickets/filter-popover';
import { arrangeColumns, moveColumn, prefsFromLayout } from '@/lib/board-columns';
import { useBoardPrefs } from './prefs-provider';

const FIELD_LABELS: Record<(typeof CARD_FIELD_KEYS)[number], string> = {
  labels: 'Labels',
  dueDate: 'Due date',
  priority: 'Priority',
  comments: 'Comment count',
  criteria: 'Acceptance criteria',
  type: 'Type',
};

const DENSITIES: { value: BoardDensity; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

const SHOWS: { value: BoardShow; label: string }[] = [
  { value: 'all', label: 'All tickets' },
  { value: 'top', label: 'Top level only' },
];

const LANES: { value: BoardLanes; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'project', label: 'Per project' },
];

/** Two or three side-by-side choices, one of which is picked. */
function Choices<T extends string>({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 px-2">
      {options.map((option) => (
        <label
          key={option.value}
          className={`flex h-8 flex-1 cursor-pointer items-center justify-center rounded-md border text-[13px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-active ${
            value === option.value
              ? 'border-edge-strong bg-raised text-text'
              : 'border-edge text-muted hover:text-text'
          }`}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded px-2 py-1.5 text-[13px] hover:bg-raised">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[var(--active)]"
      />
    </label>
  );
}

/** What the menu needs of a column: enough to name it, count it and place it in the workflow. */
export type MenuColumn = {
  status: { key: string; name: string; sortOrder: number };
  total: number;
};

/**
 * The one menu that customises the board for the person using it. What is chosen here is saved to
 * their account and applies to every board they open.
 */
export function DisplayMenu({
  columns,
  lanes = false,
}: {
  columns: MenuColumn[];
  /** Offer lanes per project: on the Tickets board, which spans projects. */
  lanes?: boolean;
}) {
  const { display, updateDisplay, resetDisplay, columnPrefs, setColumnPrefs } = useBoardPrefs();
  const { layout } = arrangeColumns(columns, columnPrefs);

  function toggle(key: string) {
    setColumnPrefs(
      prefsFromLayout(
        layout.map((item) =>
          item.column.status.key === key ? { ...item, shown: !item.shown } : item,
        ),
      ),
    );
  }

  function move(key: string, by: -1 | 1) {
    const order = moveColumn(
      layout.map((item) => item.column.status.key),
      key,
      by,
    );
    setColumnPrefs(
      prefsFromLayout(
        order.map((orderedKey) => layout.find((item) => item.column.status.key === orderedKey)!),
      ),
    );
  }

  return (
    <FilterPopover label="Display" align="right" tall>
      <div className="flex w-64 flex-col gap-2 p-1.5">
        <fieldset>
          <legend className="px-2 pb-1 text-xs text-muted">Show on cards</legend>
          {CARD_FIELD_KEYS.map((key) => (
            <Switch
              key={key}
              label={FIELD_LABELS[key]}
              checked={display.fields[key]}
              onChange={(checked) =>
                updateDisplay({ fields: { [key]: checked } as Partial<CardFields> })
              }
            />
          ))}
        </fieldset>

        <fieldset>
          <legend className="px-2 pb-1 text-xs text-muted">Density</legend>
          <div role="radiogroup" aria-label="Density" className="flex gap-1 px-2">
            {DENSITIES.map(({ value, label }) => (
              <label
                key={value}
                className={`flex h-8 flex-1 cursor-pointer items-center justify-center rounded-md border text-[13px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-active ${
                  display.density === value
                    ? 'border-edge-strong bg-raised text-text'
                    : 'border-edge text-muted hover:text-text'
                }`}
              >
                <input
                  type="radio"
                  name="board-density"
                  value={value}
                  checked={display.density === value}
                  onChange={() => updateDisplay({ density: value })}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="px-2 pb-1 text-xs text-muted">Show</legend>
          <Choices
            name="board-show"
            label="Show"
            options={SHOWS}
            value={display.show}
            onChange={(show) => updateDisplay({ show })}
          />
        </fieldset>

        {lanes && (
          <fieldset>
            <legend className="px-2 pb-1 text-xs text-muted">Lanes</legend>
            <Choices
              name="board-lanes"
              label="Lanes"
              options={LANES}
              value={display.lanes}
              onChange={(value) => updateDisplay({ lanes: value })}
            />
          </fieldset>
        )}

        <fieldset>
          <legend className="px-2 pb-1 text-xs text-muted">Colour</legend>
          <Switch
            label="Heat colours on columns"
            checked={display.heat}
            onChange={(checked) => updateDisplay({ heat: checked })}
          />
        </fieldset>

        <fieldset>
          <legend className="px-2 pb-1 text-xs text-muted">Columns</legend>
          <ul className="flex flex-col">
            {layout.map(({ column, shown }, index) => (
              <li
                key={column.status.key}
                className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-raised"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1 text-[13px]">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`Show ${column.status.name}`}
                    checked={shown}
                    onChange={() => toggle(column.status.key)}
                    className="size-4 shrink-0 accent-[var(--active)]"
                  />
                  <span className="min-w-0 flex-1 truncate">{column.status.name}</span>
                  <span className="font-mono text-xs text-muted">{column.total}</span>
                </label>
                <button
                  type="button"
                  aria-label={`Move ${column.status.name} up`}
                  disabled={index === 0}
                  onClick={() => move(column.status.key, -1)}
                  className="inline-flex size-6 items-center justify-center rounded text-muted hover:bg-edge hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${column.status.name} down`}
                  disabled={index === layout.length - 1}
                  onClick={() => move(column.status.key, 1)}
                  className="inline-flex size-6 items-center justify-center rounded text-muted hover:bg-edge hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </fieldset>

        <button
          type="button"
          onClick={() => {
            resetDisplay();
            setColumnPrefs(null);
          }}
          className="mx-2 mb-1 h-8 rounded-md border border-edge text-[13px] text-muted hover:border-edge-strong hover:text-text"
        >
          Reset to default
        </button>
      </div>
    </FilterPopover>
  );
}
