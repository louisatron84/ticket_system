'use client';

import { ChevronDown } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { useDismiss } from '@/lib/use-dismiss';

export type FilterOption = { value: string; label: string; icon?: ReactNode };

/** A button that opens a small panel of choices. Closes on Escape or a press outside. */
export function FilterPopover({
  label,
  count = 0,
  children,
}: {
  label: string;
  /** How many choices are active; shown on the button so a filter in use is visible when closed. */
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useDismiss(ref, open, () => setOpen(false));

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors ${
          count > 0
            ? 'border-edge-strong bg-raised text-text'
            : 'border-edge text-muted hover:border-edge-strong hover:text-text'
        }`}
      >
        {label}
        {count > 0 && (
          <span className="rounded bg-text px-1 font-mono text-[11px] leading-4 text-bg">
            {count}
          </span>
        )}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute left-0 top-9 z-30 max-h-80 min-w-52 overflow-y-auto rounded-md border border-edge-strong bg-panel p-1 shadow-[0_10px_28px_rgba(0,0,0,0.5)]"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Several choices at once. */
export function CheckboxList({
  name,
  options,
  selected,
  onToggle,
}: {
  name: string;
  options: FilterOption[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) return <p className="px-2 py-1.5 text-[13px] text-muted">None yet.</p>;
  return (
    <ul role="group" aria-label={name}>
      {options.map((option) => (
        <li key={option.value}>
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-raised">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => onToggle(option.value)}
              className="size-3.5 accent-[var(--text)]"
            />
            {option.icon}
            <span className="truncate">{option.label}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** One choice, which can be picked again to clear it. */
export function RadioList({
  name,
  options,
  selected,
  onChoose,
}: {
  name: string;
  options: FilterOption[];
  selected: string | undefined;
  onChoose: (value: string | undefined) => void;
}) {
  return (
    <ul role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <li key={option.value}>
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-raised">
            <input
              type="radio"
              name={name}
              checked={selected === option.value}
              // A radio cannot be unchecked by clicking it, so a click on the chosen one clears it.
              onChange={() => onChoose(option.value)}
              onClick={() => {
                if (selected === option.value) onChoose(undefined);
              }}
              className="size-3.5 accent-[var(--text)]"
            />
            {option.icon}
            <span className="truncate">{option.label}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
