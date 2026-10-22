'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { buttonClass } from '@/lib/ui';

/** A modal confirmation built on <dialog>, which traps focus and closes on Escape natively. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-md border border-edge-strong bg-panel p-5 text-text"
    >
      <h2 id="confirm-title" className="text-base font-semibold">
        {title}
      </h2>
      <div className="mt-2 text-[13px] text-muted">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          className={buttonClass('secondary')}
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button type="button" className={buttonClass('danger')} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
