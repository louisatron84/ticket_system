'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

/**
 * Folds away the rows under a top-level ticket in the list's tree. Each tree is its own table
 * body, so the button marks that body collapsed and the rows below the first hide themselves.
 */
export function TreeToggle({ ticketKey }: { ticketKey: string }) {
  const [open, setOpen] = useState(true);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} the tickets under ${ticketKey}`}
      onClick={(event) => {
        event.currentTarget.closest('tbody')?.toggleAttribute('data-collapsed', open);
        setOpen(!open);
      }}
      className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded text-muted hover:text-text"
    >
      {open ? (
        <ChevronDown size={14} aria-hidden="true" />
      ) : (
        <ChevronRight size={14} aria-hidden="true" />
      )}
    </button>
  );
}
