import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'No workspace' };

export default function NoWorkspacePage() {
  return (
    <section className="flex max-w-prose flex-col gap-3">
      <h1 className="text-xl font-semibold tracking-tight">
        You don&apos;t belong to a workspace yet
      </h1>
      <p className="text-muted">
        Ask an owner or administrator of a workspace to add you. Once they do, it will appear here.
      </p>
    </section>
  );
}
