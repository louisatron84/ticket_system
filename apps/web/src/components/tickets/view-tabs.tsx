'use client';

import { Columns3, List, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Board and List of a project, or of the whole Tickets page. The current tab carries the accent
 * colour, the same way the current page does in the sidebar. Filters in the address travel with you
 * from tab to tab.
 */
export function ViewTabs({
  label,
  boardHref,
  listHref,
  settingsHref,
}: {
  /** What the tabs are views of, for screen readers ("Project views"). */
  label: string;
  boardHref: string;
  listHref: string;
  /** A project's settings, for people who may manage projects. */
  settingsHref?: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const tabs = [
    { label: 'Board', path: boardHref, icon: Columns3 },
    { label: 'List', path: listHref, icon: List },
    ...(settingsHref ? [{ label: 'Settings', path: settingsHref, icon: Settings }] : []),
  ];

  return (
    <nav aria-label={label}>
      <ul className="flex gap-1 border-b border-edge">
        {tabs.map((tab) => {
          const active = pathname === tab.path;
          return (
            <li key={tab.path}>
              <Link
                href={search ? `${tab.path}?${search}` : tab.path}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px inline-flex h-9 items-center gap-2 border-b-2 px-3 text-[13px] font-medium transition-colors ${
                  active
                    ? 'border-active text-text'
                    : 'border-transparent text-muted hover:text-text'
                }`}
              >
                <tab.icon size={14} aria-hidden="true" />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
