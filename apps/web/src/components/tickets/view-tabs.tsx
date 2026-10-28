'use client';

import { Columns3, Filter, List, Settings } from 'lucide-react';
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
  triage,
}: {
  /** What the tabs are views of, for screen readers ("Project views"). */
  label: string;
  boardHref: string;
  listHref: string;
  /** A project's settings, for people who may manage projects. */
  settingsHref?: string;
  /** The project's triage queue, where triage is on. */
  triage?: { href: string; count: number };
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const tabs = [
    { label: 'Board', path: boardHref, icon: Columns3 },
    { label: 'List', path: listHref, icon: List },
    ...(triage
      ? [
          {
            label: triage.count > 0 ? `Triage (${triage.count})` : 'Triage',
            path: triage.href,
            icon: Filter,
          },
        ]
      : []),
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
                // The triage queue is a page of its own: list filters do not travel to it.
                href={search && !tab.path.includes('?') ? `${tab.path}?${search}` : tab.path}
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
