'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { workspaceHref } from '@/lib/nav';
import { SEQUENCE_TIMEOUT_MS, SHORTCUTS, shortcutFor, type ShortcutAction } from '@/lib/shortcuts';
import { useRunPageCommand } from './command-menu';

/** The ticket links of the list, top to bottom, for j and k. */
const rowLinks = () => Array.from(document.querySelectorAll<HTMLElement>('a[data-row-link]'));

/** Moves the focus to the next (1) or previous (-1) row of the list, from the focused one. */
function walkRows(step: 1 | -1) {
  const links = rowLinks();
  if (links.length === 0) return;
  const row = document.activeElement?.closest('tr');
  const at = row ? links.findIndex((link) => row.contains(link)) : -1;
  const next = at === -1 ? (step === 1 ? 0 : links.length - 1) : at + step;
  links[Math.max(0, Math.min(links.length - 1, next))]?.focus();
}

/** Ticks or unticks the bulk checkbox of the row with the focus. */
function selectFocusedRow() {
  const row = document.activeElement?.closest('tr');
  row?.querySelector<HTMLInputElement>('input[type="checkbox"][aria-label^="Select "]')?.click();
}

function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-md rounded-lg border border-edge-strong bg-panel p-4 shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="text-[13px] text-muted underline hover:text-text"
          >
            Close
          </button>
        </div>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="contents">
              <dt>
                <kbd className="rounded border border-edge-strong bg-raised px-1.5 py-0.5 font-mono text-xs">
                  {shortcut.keys}
                </kbd>
              </dt>
              <dd className="text-muted">{shortcut.does}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">
          Shortcuts do nothing while you are typing in a field.
        </p>
      </div>
    </div>
  );
}

/**
 * Single-key shortcuts for the whole workspace (the list is in `lib/shortcuts.ts`): go to a page,
 * start a ticket, search, walk the list, and act on the open ticket. Every one of them is also
 * reachable with the mouse; the `?` sheet lists them.
 */
export function KeyboardShortcuts({ slug, canCreate }: { slug: string; canCreate: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const runPageCommand = useRunPageCommand();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef(false);
  useEffect(() => {
    sheetRef.current = sheetOpen;
  }, [sheetOpen]);
  const pending = useRef<{ key: 'g'; at: number } | null>(null);

  const perform = (action: ShortcutAction) => {
    switch (action) {
      case 'help':
        return setSheetOpen(true);
      case 'search':
        return document.querySelector<HTMLElement>('[data-shortcut="search"]')?.focus();
      case 'create': {
        // Like the command menu, offered only to people who may create tickets.
        if (!canCreate) return;
        // On a project's pages the new ticket goes into that project.
        const project = /^\/w\/[^/]+\/projects\/([^/]+)/.exec(pathname)?.[1];
        return router.push(
          workspaceHref(slug, project ? `/tickets/new?project=${project}` : '/tickets/new'),
        );
      }
      case 'go-projects':
        return router.push(workspaceHref(slug, '/projects'));
      case 'go-tickets':
        return router.push(workspaceHref(slug, '/tickets'));
      case 'go-board':
        return router.push(workspaceHref(slug, '/tickets/board'));
      case 'next':
        return walkRows(1);
      case 'previous':
        return walkRows(-1);
      case 'select':
        return selectFocusedRow();
      case 'assign-me':
        return void runPageCommand('ticket:assign-me');
      case 'move':
        return document.getElementById('field-status')?.focus();
    }
  };

  const latest = useRef(perform);
  useEffect(() => {
    latest.current = perform;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The sheet is open: it handles its own keys (Escape), and nothing behind it should move.
      if (event.defaultPrevented || sheetRef.current) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const waiting =
        pending.current && Date.now() - pending.current.at < SEQUENCE_TIMEOUT_MS ? 'g' : null;
      pending.current = null;
      const result = shortcutFor(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          target: target
            ? {
                tagName: target.tagName,
                isContentEditable: target.isContentEditable,
                ...(target instanceof HTMLInputElement ? { type: target.type } : {}),
              }
            : null,
        },
        waiting,
      );
      if (!result) return;
      event.preventDefault();
      if ('pending' in result) pending.current = { key: 'g', at: Date.now() };
      else latest.current(result.action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return sheetOpen ? <ShortcutSheet onClose={() => setSheetOpen(false)} /> : null;
}
