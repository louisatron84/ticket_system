import { ShieldOff } from 'lucide-react';

/** Shown when the person is a member but their role does not include this page. */
export function NoAccess({
  what,
  workspaceName,
  roleName,
  level = 1,
}: {
  what: string;
  workspaceName: string;
  roleName: string;
  /** 2 inside a page that already has its own main heading. */
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <section aria-labelledby="no-access-title" className="flex max-w-prose flex-col gap-3">
      <Heading
        id="no-access-title"
        className="flex items-center gap-2.5 text-xl font-semibold tracking-tight"
      >
        <ShieldOff size={20} aria-hidden="true" className="text-muted" />
        You don&apos;t have access to {what}
      </Heading>
      <p className="text-muted">
        Your role in {workspaceName} is <strong className="text-text">{roleName}</strong>, and it
        doesn&apos;t include this. Ask an owner or administrator if you need it.
      </p>
    </section>
  );
}
