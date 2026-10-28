import { apiTokenSchema } from '@forge/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TokenManager } from '@/components/tokens/token-manager';
import { getViewer, serverGet } from '@/lib/server/session';

export const metadata: Metadata = { title: 'CLI tokens' };
export const dynamic = 'force-dynamic';

export default async function TokensPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const tokens = await serverGet('/api/v1/me/tokens', apiTokenSchema.array());
  if (!tokens.ok) throw new Error('Could not load your tokens.');

  const workspaces = [...viewer.memberships]
    .map((m) => ({ id: m.organisation.id, name: m.organisation.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">CLI tokens</h1>
        <p className="text-[13px] text-muted">
          The <code className="font-mono">forge</code> command signs in with a token. Each one works
          in one workspace, expires, and can be revoked here at any time.
        </p>
      </header>
      <TokenManager initial={tokens.data} workspaces={workspaces} now={new Date().toISOString()} />
    </div>
  );
}
