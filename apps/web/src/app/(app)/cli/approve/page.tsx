import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CliApproval } from '@/components/tokens/cli-approval';
import { getViewer } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Sign in the forge command' };
export const dynamic = 'force-dynamic';

export default async function CliApprovePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const { code } = await searchParams;
  const workspaces = [...viewer.memberships]
    .map((m) => ({ id: m.organisation.id, name: m.organisation.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Sign in the forge command</h1>
        <p className="text-[13px] text-muted">
          Signed in here as {viewer.user.displayName}. Allowing this gives the terminal a token in
          your name.
        </p>
      </header>
      <CliApproval
        // Only a well-formed code is carried over from the address; anything else starts empty.
        initialCode={typeof code === 'string' && /^[A-Za-z0-9-]{4,12}$/.test(code) ? code : ''}
        workspaces={workspaces}
      />
    </div>
  );
}
