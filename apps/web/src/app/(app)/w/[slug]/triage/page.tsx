import {
  hasPermission,
  normalizeProjectKey,
  projectSchema,
  ticketSummarySchema,
} from '@forge/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PriorityMark, TypeBadge } from '@/components/tickets/badges';
import { NoAccess } from '@/components/workspace/no-access';
import { workspaceHref } from '@/lib/nav';
import { getViewer, serverGet } from '@/lib/server/session';
import { formatRelativeTime } from '@/lib/tickets';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const metadata: Metadata = { title: 'Triage' };
export const dynamic = 'force-dynamic';

/** Tickets waiting for a decision before they join a board, oldest first. */
export default async function TriagePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ project?: string; snoozed?: string }>;
}) {
  const slug = workspaceSlugFromPath(`/w/${(await params).slug}`);
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  if (!membership) notFound();
  if (!hasPermission(membership.permissions, 'tickets.view')) {
    return (
      <NoAccess
        what="triage"
        workspaceName={membership.organisation.name}
        roleName={membership.role.name}
      />
    );
  }
  const query = await searchParams;
  const project = query.project ? normalizeProjectKey(query.project) : null;
  const snoozed = query.snoozed === '1';
  const api = `/api/v1/orgs/${membership.organisation.id}`;
  const params2 = new URLSearchParams();
  if (project) params2.set('project', project);
  if (snoozed) params2.set('snoozed', '1');
  const [queue, projects] = await Promise.all([
    serverGet(`${api}/triage?${params2}`, ticketSummarySchema.array()),
    serverGet(`${api}/projects`, projectSchema.array()),
  ]);
  if (!queue.ok || !projects.ok) notFound();
  const withTriage = projects.data.filter((p) => p.triageEnabled && !p.archived);
  const maxRank = Math.max(1, ...queue.data.map((t) => t.priority.rank));
  const now = new Date().toISOString();
  const href = (next: { project?: string | null; snoozed?: boolean }) => {
    const search = new URLSearchParams();
    const p = next.project === undefined ? project : next.project;
    const s = next.snoozed ?? snoozed;
    if (p) search.set('project', p);
    if (s) search.set('snoozed', '1');
    const text = search.toString();
    return workspaceHref(membership.organisation.slug, `/triage${text ? `?${text}` : ''}`);
  };
  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-xs ${active ? 'border-active bg-active/15 text-text' : 'border-edge text-muted hover:text-text'}`;

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Triage</h1>
        <p className="max-w-prose text-[13px] text-muted">
          New tickets from outside the team wait here. Each decision is proposed by one person and
          approved by another. Projects with triage on:{' '}
          {withTriage.length === 0 ? 'none yet' : withTriage.map((p) => p.key).join(', ')}.
        </p>
      </header>
      <nav aria-label="Filter triage" className="flex flex-wrap gap-2">
        <Link href={href({ project: null })} className={chip(!project)}>
          Every project
        </Link>
        {withTriage.map((p) => (
          <Link key={p.key} href={href({ project: p.key })} className={chip(project === p.key)}>
            {p.key}
          </Link>
        ))}
        <Link href={href({ snoozed: !snoozed })} className={`${chip(snoozed)} ml-auto`}>
          {snoozed ? 'Including snoozed' : 'Show snoozed'}
        </Link>
      </nav>
      {queue.data.length === 0 ? (
        <p className="rounded-md border border-edge px-4 py-8 text-center text-[13px] text-muted">
          Nothing waiting. New arrivals show up here.
        </p>
      ) : (
        <ul
          aria-label="Waiting for triage"
          className="divide-y divide-edge rounded-md border border-edge bg-panel"
        >
          {queue.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <Link
                href={workspaceHref(membership.organisation.slug, `/tickets/${t.key}`)}
                className="min-w-0 flex-1 text-[13px] hover:underline"
              >
                <span className="mr-2 font-mono text-xs text-muted">{t.key}</span>
                {t.title}
              </Link>
              <TypeBadge type={t.type} />
              <PriorityMark priority={t.priority} maxRank={maxRank} compact />
              <time dateTime={t.createdAt} className="w-24 text-right text-xs text-muted">
                {formatRelativeTime(t.createdAt, now)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
