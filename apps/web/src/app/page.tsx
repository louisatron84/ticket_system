import { redirect } from 'next/navigation';
import { workspaceHref } from '@/lib/nav';
import { getViewer } from '@/lib/server/session';
import { pickDefaultWorkspace } from '@/lib/workspaces';

export const dynamic = 'force-dynamic';

// "/" has no content of its own: it is a plain HTTP redirect to wherever the person belongs.
// It lives outside the signed-in layout on purpose, so the redirect happens before anything has
// been sent to the browser (inside that layout it would arrive late, as a client-side hop).
export default async function HomePage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const target = pickDefaultWorkspace(viewer.memberships);
  redirect(target ? workspaceHref(target.organisation.slug) : '/no-workspace');
}
