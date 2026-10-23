'use client';

import type { StatusCategory } from '@forge/shared';
import { ArrowRightLeft } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { StatusGlyph } from '@/components/tickets/badges';
import { useDismiss } from '@/lib/use-dismiss';

export type MoveTarget = { id: string; key: string; name: string; category: StatusCategory };

/**
 * "Move to…": the way to change a card's status without dragging. A plain button and a list of
 * buttons, so it works with a keyboard and a screen reader, and offers only the moves the
 * workflow allows.
 */
export function MoveMenu({
  ticketKey,
  targets,
  disabled,
  onMove,
}: {
  ticketKey: string;
  targets: MoveTarget[];
  disabled: boolean;
  onMove: (statusId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useDismiss(ref, open, () => setOpen(false));

  const none = targets.length === 0;
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
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Move ${ticketKey} to another status`}
        title={none ? 'Nowhere to move this from its current status' : 'Move to…'}
        disabled={disabled || none}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex size-6 items-center justify-center rounded text-muted hover:bg-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ArrowRightLeft size={13} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={`Move ${ticketKey} to`}
          className="absolute right-0 top-7 z-30 w-48 rounded-md border border-edge-strong bg-panel p-1 shadow-[0_10px_28px_rgba(0,0,0,0.5)]"
        >
          <p className="px-2 py-1 text-xs text-muted">Move to</p>
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              autoFocus={target === targets[0]}
              onClick={() => {
                setOpen(false);
                onMove(target.id);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-raised"
            >
              <StatusGlyph category={target.category} statusKey={target.key} />
              {target.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
