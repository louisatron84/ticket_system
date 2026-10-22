'use client';

import type { Membership } from '@forge/shared';
import { ChevronsUpDown } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { workspaceHref } from '@/lib/nav';
import { useDismiss } from '@/lib/use-dismiss';

/** Names the current workspace, and lets people who belong to several move between them. */
export function WorkspaceSwitcher({
  current,
  memberships,
  onNavigate,
}: {
  current: Membership;
  memberships: Membership[];
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(containerRef, open, close);

  const name = current.organisation.name;
  if (memberships.length < 2) {
    return <p className="truncate px-2.5 py-1.5 text-[13px] font-medium">{name}</p>;
  }

  const sorted = [...memberships].sort((a, b) =>
    a.organisation.name.localeCompare(b.organisation.name),
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="workspace-menu"
        aria-label={`Workspace: ${name}. Switch workspace`}
        className="flex h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 text-[13px] font-medium hover:bg-raised"
      >
        <span className="truncate">{name}</span>
        <ChevronsUpDown size={14} aria-hidden="true" className="shrink-0 text-muted" />
      </button>

      {open && (
        <ul
          id="workspace-menu"
          className="absolute inset-x-0 z-50 mt-1 rounded-md border border-edge-strong bg-panel p-1 shadow-lg shadow-black/40"
        >
          {sorted.map((membership) => {
            const isCurrent = membership.organisation.id === current.organisation.id;
            return (
              <li key={membership.organisation.id}>
                <Link
                  href={workspaceHref(membership.organisation.slug)}
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => {
                    close();
                    onNavigate();
                  }}
                  className="block rounded-md px-2 py-1.5 text-[13px] hover:bg-raised"
                >
                  <span className="block truncate">{membership.organisation.name}</span>
                  <span className="block truncate text-xs text-muted">{membership.role.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
