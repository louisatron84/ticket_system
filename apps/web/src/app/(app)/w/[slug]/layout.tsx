import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
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
  if (!slug || !viewer.memberships.some((m) => m.organisation.slug === slug)) notFound();

  return children;
}
