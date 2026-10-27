import { hasPermission } from '@forge/shared';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { CommandMenuProvider } from '@/components/command/command-menu';
import { KeyboardShortcuts } from '@/components/command/shortcuts';
import { visibleNavItems, workspaceHref } from '@/lib/nav';
import { getViewer } from '@/lib/server/session';
import { workspaceSlugFromPath } from '@/lib/workspaces';

// A workspace the person does not belong to is indistinguishable from one that does not exist.
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = workspaceSlugFromPath(`/w/${rawSlug}`);

  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const membership = viewer.memberships.find((m) => m.organisation.slug === slug);
  if (!slug || !membership) notFound();

  // The command menu offers the pages the sidebar does, plus the Tickets page's Board tab.
  const pages = visibleNavItems({ slug, permissions: membership.permissions }).flatMap((item) =>
    item.id === 'tickets'
      ? [
          { label: item.label, href: item.href },
          { label: 'Tickets board', href: workspaceHref(slug, '/tickets/board') },
        ]
      : [{ label: item.label, href: item.href }],
  );

  return (
    <CommandMenuProvider
      organisationId={membership.organisation.id}
      slug={slug}
      pages={pages}
      canCreate={hasPermission(membership.permissions, 'tickets.create')}
    >
      {children}
      <KeyboardShortcuts
        slug={slug}
        canCreate={hasPermission(membership.permissions, 'tickets.create')}
      />
    </CommandMenuProvider>
  );
}
