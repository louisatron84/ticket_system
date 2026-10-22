import { ShieldOff } from 'lucide-react';

/** Shown when the person is a member but their role does not include this page. */
export function NoAccess({
  what,
  workspaceName,
  roleName,
}: {
  what: string;
  workspaceName: string;
  roleName: string;
}) {
  return (
    <section aria-labelledby="no-access-title" className="flex max-w-prose flex-col gap-3">
      <h1
        id="no-access-title"
        className="flex items-center gap-2.5 text-xl font-semibold tracking-tight"
      >
        <ShieldOff size={20} aria-hidden="true" className="text-muted" />
        You don&apos;t have access to {what}
      </h1>
      <p className="text-muted">
        Your role in {workspaceName} is <strong className="text-text">{roleName}</strong>, and it
        doesn&apos;t include this. Ask an owner or administrator if you need it.
      </p>
    </section>
  );
}
