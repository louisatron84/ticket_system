'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useDismiss } from '@/lib/use-dismiss';

/** One row of an actions menu. */
export function Item({
  icon,
  onClick,
  autoFocus,
  current,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  autoFocus?: boolean;
  /** For a row that offers a choice: this is the one in force now. */
  current?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      aria-current={current ? 'true' : undefined}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-raised"
    >
      {icon}
      {children}
    </button>
  );
}

/** About how tall an actions list is: below this much room under the button it opens upwards. */
const ROOM_FOR_MENU = 280;

/** Where a panel goes beside its button: under it, or over it when there is not room below. */
function placeBeside(rect: DOMRect): CSSProperties {
  const below = window.innerHeight - rect.bottom - 8;
  const above = rect.top - 8;
  const right = Math.max(8, window.innerWidth - rect.right);
  return below < ROOM_FOR_MENU && above > below
    ? { right, bottom: window.innerHeight - rect.top + 4, maxHeight: above }
    : { right, top: rect.bottom + 4, maxHeight: below };
}

/**
 * Whose menu button should get the keyboard focus back when it can take it. It outlives the menu
 * because a card that moves to another column is a new component with a new button, and because
 * the button is switched off while the change is being saved. Stale after a few seconds.
 */
const pendingFocus: { current: { key: string; at: number } | null } = { current: null };
const PENDING_FOR_MS = 5000;

export type ActionMenuState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Counts requests to give the focus back, so the button can act on them once it is enabled. */
  refocus: number;
  /** Names whose menu this is, for finding the button again after its card is redrawn. */
  focusKey: string;
  close: () => void;
  /** Gives the focus back to the menu's button as soon as it is enabled. */
  restoreFocus: () => void;
};

/** Whether one actions menu is open. Kept apart from the button so the actions can close it. */
export function useActionMenu(focusKey: string): ActionMenuState {
  const [open, setOpen] = useState(false);
  const [refocus, setRefocus] = useState(0);
  return {
    open,
    setOpen,
    refocus,
    focusKey,
    close: () => setOpen(false),
    restoreFocus: () => {
      pendingFocus.current = { key: focusKey, at: Date.now() };
      setRefocus((count) => count + 1);
    },
  };
}

/**
 * A button and the panel it opens, beside the button. The panel is fixed to the window, not to
 * what the button sits in, because a board scrolls sideways and would clip it, and it follows the
 * button if the page scrolls. Escape closes it and gives the focus back to the button.
 *
 * `focusFallback` says where the focus goes if the button's card disappears while the focus is on
 * it (an archived card), so it never falls to the top of the page. It is asked while the button is
 * still in the page, and used only if nothing else has taken the focus a moment later.
 */
export function ActionMenu({
  menu,
  label,
  icon,
  size = 'md',
  appearance = 'icon',
  disabled,
  focusFallback,
  children,
}: {
  menu: ActionMenuState;
  label: string;
  /** What the button shows: an icon, or with `appearance="value"` the value the menu changes. */
  icon: ReactNode;
  size?: 'sm' | 'md';
  /**
   * `value` draws the button as the value itself (a table cell); `button` as a bordered button
   * with words, like the filter bar's; the default is a small icon button.
   */
  appearance?: 'icon' | 'value' | 'button';
  disabled: boolean;
  focusFallback?: (button: HTMLElement) => HTMLElement | null | undefined;
  children: ReactNode;
}) {
  const { open, setOpen, focusKey, refocus } = menu;
  const [place, setPlace] = useState<CSSProperties>({});
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useDismiss(wrapperRef, open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const follow = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setPlace(placeBeside(rect));
    };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open]);

  // A request to give the focus back waits for the button to be enabled, which it is not while
  // the change is being saved, and for the button to exist, which it does not until a card that
  // moved to another column has been drawn there.
  useEffect(() => {
    const pending = pendingFocus.current;
    if (disabled || !pending || pending.key !== focusKey) return;
    pendingFocus.current = null;
    if (Date.now() - pending.at < PENDING_FOR_MS) buttonRef.current?.focus();
  }, [disabled, refocus, focusKey]);

  // Going away with the focus on the button, or with the focus still owed to it: put it nearby.
  const latest = useRef({ focusFallback, focusKey });
  useEffect(() => {
    latest.current = { focusFallback, focusKey };
  });
  useLayoutEffect(() => {
    const button = buttonRef.current;
    return () => {
      const { focusFallback: fallback, focusKey: key } = latest.current;
      if (!button || !fallback) return;
      if (document.activeElement !== button && pendingFocus.current?.key !== key) return;
      // The same card may be drawn again (it moved to another column): then its new button
      // takes the focus. If a frame later nothing has it, the focus goes to the fallback.
      const target = fallback(button);
      pendingFocus.current = { key, at: Date.now() };
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body || !active.isConnected) target?.focus();
      });
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
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
        aria-label={label}
        title={appearance === 'icon' ? 'Actions' : undefined}
        disabled={disabled}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (!open && rect) setPlace(placeBeside(rect));
          setOpen(!open);
        }}
        className={
          appearance === 'value'
            ? '-mx-1 inline-flex max-w-full items-center rounded px-1 py-0.5 text-left hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40'
            : appearance === 'button'
              ? 'inline-flex h-8 items-center gap-1.5 rounded-md border border-edge px-2.5 text-[13px] text-muted transition-colors hover:border-edge-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40'
              : `inline-flex items-center justify-center rounded text-muted hover:bg-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-40 ${
                  size === 'sm' ? 'size-6' : 'size-7'
                }`
        }
      >
        {icon}
      </button>
      {open && (
        <div
          id={panelId}
          style={place}
          className="fixed z-40 w-52 overflow-y-auto rounded-md border border-edge-strong bg-panel p-1 shadow-[0_10px_28px_rgba(0,0,0,0.5)]"
        >
          {children}
        </div>
      )}
    </div>
  );
}
