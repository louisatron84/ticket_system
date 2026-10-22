export const SIDEBAR_COLLAPSED_KEY = 'forge.sidebar.collapsed';

function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    // Accessing localStorage throws when site data is blocked.
    return undefined;
  }
}

/** Anything other than the exact strings "true" or "false" reads as the default (expanded). */
export function readSidebarCollapsed(storage?: Pick<Storage, 'getItem'>): boolean {
  try {
    return (storage ?? browserStorage())?.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(value: boolean, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? browserStorage())?.setItem(SIDEBAR_COLLAPSED_KEY, String(value));
  } catch {
    // The preference just won't persist; the UI keeps working.
  }
}
