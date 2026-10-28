import { normalizeProjectKey } from '@forge/shared';
import { notFound, redirect } from 'next/navigation';
import { workspaceHref } from '@/lib/nav';
import { workspaceSlugFromPath } from '@/lib/workspaces';

export const dynamic = 'force-dynamic';

// A project's own address opens its board.
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string; key: string }>;
}) {
  const { slug: rawSlug, key: rawKey } = await params;
  const slug = workspaceSlugFromPath(`/w/${rawSlug}`);
  const key = normalizeProjectKey(rawKey);
  if (!slug || !key) notFound();
  redirect(workspaceHref(slug, `/projects/${key}/board`));
}
