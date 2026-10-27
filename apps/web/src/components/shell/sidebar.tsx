'use client';

import type { Membership } from '@forge/shared';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { visibleNavItems } from '@/lib/nav';
import { BrandMark } from './brand-mark';
import { WorkspaceSwitcher } from './workspace-switcher';

type SidebarProps = {
  workspace: Membership | null;
  memberships: Membership[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onNavigate: () => void;
};

export function Sidebar({
  workspace,
  memberships,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onNavigate,
}: SidebarProps) {
  const pathname = usePathname();
  const items = workspace
    ? visibleNavItems({
        slug: workspace.organisation.slug,
        permissions: workspace.permissions,
      })
    : [];

  // The most specific matching link is the current one, so Overview is not also lit up on /members.
  const activeHref = items
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  // The icon rail only exists on desktop; the mobile drawer always shows labels.
  const hideLabel = collapsed ? 'md:sr-only' : '';

  return (
    <aside
      id="primary-nav"
      className={[
        'fixed inset-y-0 left-0 z-40 flex w-58 flex-col border-r border-edge bg-panel',
        'transition-transform duration-150 md:static md:translate-x-0 md:transition-none',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        collapsed ? 'md:w-14' : 'md:w-58',
      ].join(' ')}
    >
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-edge px-4">
        <BrandMark />
        <span className={`text-[15px] font-semibold tracking-tight ${hideLabel}`}>Forge</span>
      </div>

      {workspace && (
        <div className={`shrink-0 border-b border-edge p-2 ${collapsed ? 'md:hidden' : ''}`}>
          <WorkspaceSwitcher
            current={workspace}
            memberships={memberships}
            onNavigate={onNavigate}
          />
        </div>
      )}

      <nav aria-label="Primary" className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  className={[
                    'relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
                    active ? 'bg-raised text-text' : 'text-muted hover:bg-raised hover:text-text',
                    active
                      ? 'before:absolute before:inset-y-1.5 before:-left-2 before:w-0.5 before:rounded-full before:bg-active before:shadow-[0_0_10px_var(--active)]'
                      : '',
                  ].join(' ')}
                >
                  <item.icon size={16} aria-hidden="true" className="shrink-0" />
                  <span className={hideLabel}>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="hidden shrink-0 border-t border-edge p-2 md:block">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="primary-nav"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted transition-colors hover:bg-raised hover:text-text"
        >
          {collapsed ? (
            <PanelLeftOpen size={16} aria-hidden="true" className="shrink-0" />
          ) : (
            <PanelLeftClose size={16} aria-hidden="true" className="shrink-0" />
          )}
          <span className={hideLabel}>{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
        </button>
      </div>
    </aside>
  );
}
