import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SidebarPreferenceSwitch } from '@/components/profile/sidebar-preference-switch';
import { getViewer } from '@/lib/server/session';

export const metadata: Metadata = { title: 'Profile and preferences' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');

  const memberships = [...viewer.memberships].sort((a, b) =>
    a.organisation.name.localeCompare(b.organisation.name),
  );

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <h1 className="text-xl font-semibold tracking-tight">Profile and preferences</h1>

      <section aria-labelledby="profile-title">
        <h2 id="profile-title" className="mb-3 text-base font-semibold">
          You
        </h2>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-[13px]">
          <dt className="text-muted">Name</dt>
          <dd>{viewer.user.displayName}</dd>
          <dt className="text-muted">Email</dt>
          <dd className="font-mono text-xs leading-5">{viewer.user.email}</dd>
        </dl>
      </section>

      <section aria-labelledby="preferences-title">
        <h2 id="preferences-title" className="mb-3 text-base font-semibold">
          Preferences
        </h2>
        <SidebarPreferenceSwitch />
      </section>

      <section aria-labelledby="workspaces-title">
        <h2 id="workspaces-title" className="mb-3 text-base font-semibold">
          Your workspaces
        </h2>
        {memberships.length === 0 ? (
          <p className="text-[13px] text-muted">You don&apos;t belong to any workspace yet.</p>
        ) : (
          <ul className="divide-y divide-edge rounded-md border border-edge bg-panel text-[13px]">
            {memberships.map((membership) => (
              <li
                key={membership.organisation.id}
                className="flex items-center justify-between gap-4 px-4 py-2.5"
              >
                <span className="font-medium">{membership.organisation.name}</span>
                <span className="text-muted">{membership.role.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
