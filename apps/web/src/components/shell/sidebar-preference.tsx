'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';

type SidebarPreference = { collapsed: boolean; setCollapsed: (value: boolean) => void };

const Context = createContext<SidebarPreference | null>(null);

/**
 * The sidebar's collapsed state, stored on the server per person so it follows them across
 * browsers and renders correctly on the first paint. The UI updates immediately; a failed save
 * is reported but does not undo what they see.
 */
export function SidebarPreferenceProvider({
  initial,
  children,
}: {
  initial: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsedState] = useState(initial);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    apiFetch('/api/v1/me/preferences', {
      method: 'PATCH',
      json: { sidebarCollapsed: value },
    }).catch(() => toast.error("Couldn't save your sidebar preference."));
  }, []);

  return <Context value={{ collapsed, setCollapsed }}>{children}</Context>;
}

export function useSidebarPreference(): SidebarPreference {
  const value = useContext(Context);
  if (!value) throw new Error('useSidebarPreference must be used inside the app shell.');
  return value;
}
