import { FlaskConical } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Toaster } from 'sonner';
import { DevSignIn } from '@/components/login/dev-sign-in';
import { BrandMark } from '@/components/shell/brand-mark';
import { getDevIdentities, getViewer } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getViewer()) redirect('/');

  // Present only when the API was started with development sign-in on. Never in production.
  const identities = await getDevIdentities();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-2.5">
        <BrandMark />
        <span className="text-[15px] font-semibold tracking-tight">Forge</span>
      </div>

      <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>

      {identities ? (
        <>
          <div
            role="note"
            className="flex gap-2.5 rounded-md border border-edge-strong border-l-ember bg-panel px-3.5 py-3 text-[13px] [border-left-width:3px]"
          >
            <FlaskConical size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ember" />
            <p>
              <strong className="font-medium">Development sign-in.</strong>{' '}
              <span className="text-muted">
                These are seeded test accounts. This screen does not exist in production.
              </span>
            </p>
          </div>
          <DevSignIn identities={identities} />
        </>
      ) : (
        <p className="max-w-prose text-muted">
          Sign-in isn&apos;t configured for this environment yet. Ask whoever runs this Forge server
          how to get access.
        </p>
      )}

      <Toaster theme="dark" position="bottom-center" />
    </main>
  );
}
