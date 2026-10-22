'use client';

import { useSidebarPreference } from '@/components/shell/sidebar-preference';

/** Same preference as the sidebar's own collapse button; both stay in step. */
export function SidebarPreferenceSwitch() {
  const { collapsed, setCollapsed } = useSidebarPreference();

  return (
    <label className="flex cursor-pointer items-start gap-3 text-[13px]">
      <input
        type="checkbox"
        role="switch"
        checked={collapsed}
        onChange={(event) => setCollapsed(event.target.checked)}
        className="mt-0.5 size-4 accent-[var(--ember)]"
      />
      <span>
        <span className="block font-medium">Collapse the sidebar</span>
        <span className="block text-muted">
          Keeps navigation to a narrow icon rail. Saved to your account, so it follows you to other
          browsers.
        </span>
      </span>
    </label>
  );
}
