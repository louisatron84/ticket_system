'use client';

import { hasPermission, type DevIdentity, type Membership, type Viewer } from '@forge/shared';
import { Menu } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { breadcrumbsFor } from '@/lib/nav';
import { NotificationBell } from '@/components/notifications/bell';
import { AccountMenu } from './account-menu';
import { Breadcrumbs } from './breadcrumbs';

export function Topbar({
  viewer,
  workspace,
  devIdentities,
  onOpenMenu,
}: {
  viewer: Viewer;
  workspace: Membership | null;
  devIdentities: DevIdentity[] | null;
  onOpenMenu: () => void;
}) {
  const pathname = usePathname();
  const development = process.env.NODE_ENV !== 'production';

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-edge bg-bg px-3 md:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open navigation"
        aria-controls="primary-nav"
        className="-ml-1 flex size-8 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-text md:hidden"
      >
        <Menu size={18} aria-hidden="true" />
      </button>

      <Breadcrumbs
        items={breadcrumbsFor(
          pathname,
          workspace
            ? { slug: workspace.organisation.slug, name: workspace.organisation.name }
            : undefined,
        )}
      />

      <div className="ml-auto flex items-center gap-3">
        {development && (
          <span
            title="This is a development build"
            className="rounded border border-edge-strong px-1.5 py-0.5 font-mono text-[11px] text-muted"
          >
            development
          </span>
        )}
        {workspace && hasPermission(workspace.permissions, 'tickets.view') && (
          <NotificationBell
            // A new workspace is a new stream of counts.
            key={workspace.organisation.id}
            organisationId={workspace.organisation.id}
            slug={workspace.organisation.slug}
          />
        )}
        <AccountMenu viewer={viewer} workspace={workspace} devIdentities={devIdentities} />
      </div>
    </header>
  );
}
