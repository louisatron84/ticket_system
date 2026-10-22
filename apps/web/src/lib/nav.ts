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
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** `planned` items stay in the registry but are never rendered: no dead links. */
  availability: 'available' | 'planned';
};

export type Breadcrumb = { label: string; href?: string };

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    href: '/',
    icon: LayoutDashboard,
    availability: 'available',
  },
  { id: 'my-work', label: 'My Work', href: '/inbox', icon: Inbox, availability: 'planned' },
  {
    id: 'projects',
    label: 'Projects',
    href: '/projects',
    icon: FolderKanban,
    availability: 'planned',
  },
  { id: 'tickets', label: 'Tickets', href: '/tickets', icon: Ticket, availability: 'planned' },
  {
    id: 'repositories',
    label: 'Repositories',
    href: '/repositories',
    icon: FolderGit2,
    availability: 'planned',
  },
  {
    id: 'code-reviews',
    label: 'Code Reviews',
    href: '/reviews',
    icon: GitPullRequest,
    availability: 'planned',
  },
  {
    id: 'workflows',
    label: 'Workflows',
    href: '/workflows',
    icon: Workflow,
    availability: 'planned',
  },
  { id: 'activity', label: 'Activity', href: '/activity', icon: Activity, availability: 'planned' },
  {
    id: 'notifications',
    label: 'Notifications',
    href: '/notifications',
    icon: Bell,
    availability: 'planned',
  },
  { id: 'search', label: 'Search', href: '/search', icon: Search, availability: 'planned' },
];

export function visibleNavItems(items: NavItem[] = NAV_ITEMS): NavItem[] {
  return items.filter((item) => item.availability === 'available');
}

export function breadcrumbsFor(pathname: string): Breadcrumb[] {
  const item = NAV_ITEMS.find((candidate) => candidate.href === pathname);
  return item ? [{ label: item.label }] : [];
}
