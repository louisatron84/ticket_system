import { hasPermission, type Membership } from '@forge/shared';

const byName = (a: Membership, b: Membership) =>
  a.organisation.name.localeCompare(b.organisation.name);

/** Where `/` sends someone: the first workspace they can open, else the first they belong to. */
export function pickDefaultWorkspace(memberships: Membership[]): Membership | null {
  const sorted = [...memberships].sort(byName);
  return (
    sorted.find((membership) => hasPermission(membership.permissions, 'workspace.view')) ??
    sorted[0] ??
    null
  );
}

/** The workspace slug in a /w/<slug>/... path, or null. Never throws on malformed encoding. */
export function workspaceSlugFromPath(pathname: string): string | null {
  const match = /^\/w\/([^/]+)/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/** The workspace the shell should describe: the one in the URL, else the default. */
export function currentWorkspace(memberships: Membership[], pathname: string): Membership | null {
  const slug = workspaceSlugFromPath(pathname);
  const named = slug ? memberships.find((m) => m.organisation.slug === slug) : undefined;
  return named ?? pickDefaultWorkspace(memberships);
}
