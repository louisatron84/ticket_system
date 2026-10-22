'use client';

import type { DevIdentity, Viewer } from '@forge/shared';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { currentWorkspace } from '@/lib/workspaces';
import { Sidebar } from './sidebar';
import { SidebarPreferenceProvider, useSidebarPreference } from './sidebar-preference';
import { Topbar } from './topbar';

export function AppShell({
  viewer,
  devIdentities,
  children,
}: {
  viewer: Viewer;
  devIdentities: DevIdentity[] | null;
  children: ReactNode;
}) {
  return (
    <SidebarPreferenceProvider initial={viewer.preferences.sidebarCollapsed ?? false}>
      <ShellFrame viewer={viewer} devIdentities={devIdentities}>
        {children}
      </ShellFrame>
    </SidebarPreferenceProvider>
  );
}

function ShellFrame({
  viewer,
  devIdentities,
  children,
}: {
  viewer: Viewer;
  devIdentities: DevIdentity[] | null;
  children: ReactNode;
}) {
  const { collapsed, setCollapsed } = useSidebarPreference();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const workspace = currentWorkspace(viewer.memberships, pathname);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  return (
    <div className="flex h-dvh overflow-hidden">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <Sidebar
        workspace={workspace}
        memberships={viewer.memberships}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onNavigate={() => setMobileOpen(false)}
      />
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          viewer={viewer}
          workspace={workspace}
          devIdentities={devIdentities}
          onOpenMenu={() => setMobileOpen(true)}
        />
        <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">{children}</div>
        </main>
      </div>

      <Toaster
        theme="dark"
        position="bottom-center"
        toastOptions={{
          style: {
            background: 'var(--raised)',
            border: '1px solid var(--edge-strong)',
            color: 'var(--text)',
          },
        }}
      />
    </div>
  );
}
