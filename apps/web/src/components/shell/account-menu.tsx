'use client';

import type { DevIdentity, Membership, Viewer } from '@forge/shared';
import { ChevronDown, KeyRound, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { useDismiss } from '@/lib/use-dismiss';
import { DevSwitcher } from './dev-switcher';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

export function AccountMenu({
  viewer,
  workspace,
  devIdentities,
}: {
  viewer: Viewer;
  workspace: Membership | null;
  devIdentities: DevIdentity[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(containerRef, open, close);

  async function signOut() {
    setSigningOut(true);
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } catch (error) {
      // A session that is already gone still means "signed out"; anything else is worth showing.
      if (!(error instanceof ApiRequestError && error.status === 401)) {
        toast.error(error instanceof ApiRequestError ? error.message : 'Could not sign out.');
        setSigningOut(false);
        return;
      }
    }
    window.location.assign('/login');
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="account-menu"
        className="flex h-8 items-center gap-2 rounded-md px-1.5 text-[13px] hover:bg-raised"
      >
        <span
          aria-hidden="true"
          className="flex size-6 items-center justify-center rounded-full border border-edge-strong bg-raised text-[11px] font-medium"
        >
          {initials(viewer.user.displayName)}
        </span>
        <span className="hidden max-w-40 truncate sm:inline">{viewer.user.displayName}</span>
        <ChevronDown size={14} aria-hidden="true" className="text-muted" />
      </button>

      {open && (
        <div
          id="account-menu"
          className="absolute right-0 z-50 mt-1 w-72 rounded-md border border-edge-strong bg-panel shadow-lg shadow-black/40"
        >
          <div className="px-3 py-3">
            <p className="font-medium">{viewer.user.displayName}</p>
            <p className="truncate text-xs text-muted">{viewer.user.email}</p>
            {workspace && (
              <p className="mt-1.5 text-xs text-muted">
                {workspace.role.name} in {workspace.organisation.name}
              </p>
            )}
          </div>

          <ul className="border-t border-edge p-1">
            <li>
              <Link
                href="/settings/profile"
                onClick={close}
                className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-raised"
              >
                <UserRound size={15} aria-hidden="true" />
                Profile and preferences
              </Link>
            </li>
            <li>
              <Link
                href="/settings/tokens"
                onClick={close}
                className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-raised"
              >
                <KeyRound size={15} aria-hidden="true" />
                CLI tokens
              </Link>
            </li>
            <li>
              <button
                type="button"
                onClick={signOut}
                disabled={signingOut}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] hover:bg-raised disabled:opacity-60"
              >
                <LogOut size={15} aria-hidden="true" />
                {signingOut ? 'Signing out' : 'Sign out'}
              </button>
            </li>
          </ul>

          {devIdentities && (
            <DevSwitcher identities={devIdentities} currentEmail={viewer.user.email} />
          )}
        </div>
      )}
    </div>
  );
}
