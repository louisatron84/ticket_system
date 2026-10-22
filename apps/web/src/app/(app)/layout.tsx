import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { getDevIdentities, getViewer } from '@/lib/server/session';

// Everything inside (app) needs a signed-in person. The API makes the real decision about every
// request; this only decides what to render and where to send someone who is not signed in.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const devIdentities = await getDevIdentities();
  return (
    <AppShell viewer={viewer} devIdentities={devIdentities}>
      {children}
    </AppShell>
  );
}
