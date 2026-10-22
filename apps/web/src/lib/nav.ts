import { hasPermission, type Permission } from '@forge/shared';
import {
  Activity,
  Bell,
  FolderGit2,
  FolderKanban,
  GitPullRequest,
  Inbox,
  LayoutDashboard,
  Search,
  Ticket,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  id: string;
  label: string;
  /** Relative to the workspace: the page lives at /w/<slug><path>. */
  path: string;
  icon: LucideIcon;
  /** `planned` items stay in the registry but are never rendered: no dead links. */
  availability: 'available' | 'planned';
  /** Hidden from anyone lacking this permission. The API enforces it too; this only tidies the UI. */
  requires?: Permission;
};

export type VisibleNavItem = { id: string; label: string; href: string; icon: LucideIcon };

export type Breadcrumb = { label: string; href?: string };

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    path: '',
    icon: LayoutDashboard,
    availability: 'available',
    requires: 'workspace.view',
  },
  { id: 'my-work', label: 'My Work', path: '/inbox', icon: Inbox, availability: 'planned' },
  {
    id: 'projects',
    label: 'Projects',
    path: '/projects',
    icon: FolderKanban,
    availability: 'planned',
  },
  { id: 'tickets', label: 'Tickets', path: '/tickets', icon: Ticket, availability: 'planned' },
  {
    id: 'repositories',
    label: 'Repositories',
    path: '/repositories',
    icon: FolderGit2,
    availability: 'planned',
  },
  {
    id: 'code-reviews',
    label: 'Code Reviews',
    path: '/reviews',
    icon: GitPullRequest,
    availability: 'planned',
  },
  {
    id: 'workflows',
    label: 'Workflows',
    path: '/workflows',
    icon: Workflow,
    availability: 'planned',
  },
  { id: 'activity', label: 'Activity', path: '/activity', icon: Activity, availability: 'planned' },
  {
    id: 'notifications',
    label: 'Notifications',
    path: '/notifications',
    icon: Bell,
    availability: 'planned',
  },
  { id: 'search', label: 'Search', path: '/search', icon: Search, availability: 'planned' },
  {
    id: 'members',
    label: 'Members',
    path: '/members',
    icon: Users,
    availability: 'available',
    requires: 'members.view',
  },
];

export const workspaceHref = (slug: string, path = '') => `/w/${encodeURIComponent(slug)}${path}`;

/** The navigation this person may see in this workspace: real pages only, filtered by permission. */
export function visibleNavItems(context: {
  slug: string;
  permissions: readonly string[];
}): VisibleNavItem[] {
  return NAV_ITEMS.filter(
    (item) =>
      item.availability === 'available' &&
      (item.requires === undefined || hasPermission(context.permissions, item.requires)),
  ).map(({ id, label, path, icon }) => ({
    id,
    label,
    href: workspaceHref(context.slug, path),
    icon,
  }));
}

export function breadcrumbsFor(
  pathname: string,
  workspace?: { slug: string; name: string },
): Breadcrumb[] {
  if (pathname === '/settings/profile') return [{ label: 'Profile' }];

  const match = /^\/w\/([^/]+)(\/[a-z-]+)?$/.exec(pathname);
  if (!match || !workspace) return [];
  if (decodeURIComponent(match[1]!) !== workspace.slug) return [];

  const item = NAV_ITEMS.find(
    (candidate) => candidate.availability === 'available' && candidate.path === (match[2] ?? ''),
  );
  if (!item) return [];
  return [{ label: workspace.name, href: workspaceHref(workspace.slug) }, { label: item.label }];
}
