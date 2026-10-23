'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A modal dialog on the native <dialog>, which traps focus, shows a backdrop and closes on Escape.
 * `onClose` is called for Escape; the owner decides whether to honour it (for example, not while
 * saving).
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  width = '32rem',
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  width?: string;
  children: ReactNode;
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
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      style={{ width: `min(${width}, calc(100vw - 2rem))` }}
      className="m-auto rounded-md border border-edge-strong bg-panel p-5 text-text backdrop:bg-black/60"
    >
      {children}
    </dialog>
  );
}
