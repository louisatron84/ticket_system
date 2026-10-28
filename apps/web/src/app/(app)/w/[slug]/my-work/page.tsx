import { hasPermission, ticketListSchema } from '@forge/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DueDate, PriorityMark, StatusBadge } from '@/components/tickets/badges';
import { NoAccess } from '@/components/workspace/no-access';
import {
  MY_WORK_TABS,
  MY_WORK_TAB_LABELS,
  groupMyWork,
  myWorkQuery,
  type MyWorkTab,
} from '@/lib/my-work';
import { workspaceHref } from '@/lib/nav';
import { getViewer, serverGet } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'My work' };
export const dynamic = 'force-dynamic';

export default async function MyWorkPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const slug = workspaceSlugFromPath(`/w/${(await params).slug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  if (!membership) notFound();
  if (!hasPermission(membership.permissions, 'tickets.view')) {
    return (
      <NoAccess
        what="this page"
        workspaceName={membership.organisation.name}
        roleName={membership.role.name}
      />
    );
  }
  const requested = (await searchParams).tab;
  const tab: MyWorkTab = MY_WORK_TABS.includes(requested as MyWorkTab)
    ? (requested as MyWorkTab)
    : 'assigned';
  const list = await serverGet(
    `/api/v1/orgs/${membership.organisation.id}/tickets?${myWorkQuery(tab)}`,
    ticketListSchema,
  );
  if (!list.ok) notFound();
  const today = new Date().toISOString().slice(0, 10);
  const groups = groupMyWork(list.data.items, today);
  const maxRank = Math.max(1, ...list.data.items.map((t) => t.priority.rank));

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">My work</h1>
        <p className="text-[13px] text-muted">
          Open tickets of yours, the most pressing first. Finished ones drop off.
        </p>
      </header>
      <nav aria-label="My work" className="flex gap-1 border-b border-edge">
        {MY_WORK_TABS.map((value) => (
          <Link
            key={value}
            href={workspaceHref(
              membership.organisation.slug,
              value === 'assigned' ? '/my-work' : `/my-work?tab=${value}`,
            )}
            aria-current={tab === value ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] ${tab === value ? 'border-active font-medium text-text' : 'border-transparent text-muted hover:text-text'}`}
          >
            {MY_WORK_TAB_LABELS[value]}
          </Link>
        ))}
      </nav>
      {groups.length === 0 ? (
        <p className="rounded-md border border-edge px-4 py-8 text-center text-[13px] text-muted">
          Nothing open here.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.title} aria-label={group.title} className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold">
              {group.title}
              <span className="ml-1.5 font-normal text-muted">{group.tickets.length}</span>
            </h2>
            <ul className="divide-y divide-edge rounded-md border border-edge bg-panel">
              {group.tickets.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
                  <Link
                    href={workspaceHref(membership.organisation.slug, `/tickets/${t.key}`)}
                    className="min-w-0 flex-1 text-[13px] hover:underline"
                  >
                    <span className="mr-2 font-mono text-xs text-muted">{t.key}</span>
                    {t.title}
                  </Link>
                  <StatusBadge status={t.status} />
                  <PriorityMark priority={t.priority} maxRank={maxRank} compact />
                  <span className="w-28 text-right text-xs">
                    <DueDate date={t.dueDate} today={today} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
