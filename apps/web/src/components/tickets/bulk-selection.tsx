'use client';

import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';
import { selectionReducer, type SelectionAction } from '@/lib/selection';

type Selection = { selected: string[]; dispatch: (action: SelectionAction) => void };

const Context = createContext<Selection | null>(null);

/**
 * The tickets of the list picked for a bulk change. Only the rows on this page can be picked; when
 * the rows change (another page, a filter, an archive) the picks that left the page are dropped.
 */
export function BulkSelection({ keys, children }: { keys: string[]; children: ReactNode }) {
  const [selected, dispatch] = useReducer(selectionReducer, []);
  const shown = keys.join(' ');
  useEffect(() => {
    dispatch({ type: 'retain', keys: shown.split(' ') });
  }, [shown]);
  return <Context value={{ selected, dispatch }}>{children}</Context>;
}

export function useSelection(): Selection {
  const value = useContext(Context);
  if (!value) throw new Error('useSelection must be used inside a BulkSelection.');
  return value;
}

export function RowCheckbox({ ticketKey }: { ticketKey: string }) {
  const { selected, dispatch } = useSelection();
  return (
    <input
      type="checkbox"
      aria-label={`Select ${ticketKey}`}
      checked={selected.includes(ticketKey)}
      onChange={() => dispatch({ type: 'toggle', key: ticketKey })}
      className="size-3.5 accent-[var(--active)]"
    />
  );
}

export function SelectAllCheckbox({ keys }: { keys: string[] }) {
  const { selected, dispatch } = useSelection();
  const picked = keys.filter((key) => selected.includes(key)).length;
  return (
    <input
      type="checkbox"
      aria-label="Select all on this page"
      checked={keys.length > 0 && picked === keys.length}
      // Some but not all: shown as a dash, the usual way.
      ref={(input) => {
        if (input) input.indeterminate = picked > 0 && picked < keys.length;
      }}
      onChange={() => dispatch({ type: 'toggleAll', keys })}
      className="size-3.5 accent-[var(--active)]"
    />
  );
}
