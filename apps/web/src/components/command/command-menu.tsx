'use client';

import type { Project, SavedView, TicketList } from '@forge/shared';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch } from '@/lib/api-client';
import { rankCommands, type Command } from '@/lib/commands';
import { workspaceHref } from '@/lib/nav';
import { viewTarget } from '@/lib/saved-views';

type CommandMenuContext = {
  /** The current page's own commands (a ticket's actions), or null to take them away. */
  setPageCommands: (commands: Command[] | null) => void;
  open: () => void;
  /** Runs one of the current page's commands by id (a shortcut for it). False if there is none. */
  runPageCommand: (id: string) => boolean;
};

const Context = createContext<CommandMenuContext | null>(null);

/**
 * Registers commands for as long as the calling component is on the page. The menu is told only
 * when the list itself changes (by id and label); running a command always uses the caller's latest
 * version of it, so it acts on what the page shows now.
 */
export function usePageCommands(commands: Command[]) {
  const setPageCommands = useContext(Context)?.setPageCommands;
  const latest = useRef(commands);
  useEffect(() => {
    latest.current = commands;
  });
  const signature = commands.map((command) => `${command.id}\u0000${command.label}`).join('\n');
  useEffect(() => {
    if (!setPageCommands) return;
    setPageCommands(
      latest.current.map((command): Command => {
        if (command.href !== undefined) return command;
        const { id } = command;
        return {
          ...command,
          run: () => {
            const current = latest.current.find((item) => item.id === id);
            if (current?.run) current.run();
          },
        };
      }),
    );
    // Tells browser tests the page's own commands (and their shortcuts) can be used.
    document.documentElement.dataset.pageCommands = 'ready';
    return () => {
      setPageCommands(null);
      delete document.documentElement.dataset.pageCommands;
    };
  }, [setPageCommands, signature]);
}

/** Opens the command menu, for a button or another shortcut. Null outside a workspace. */
export function useOpenCommandMenu(): (() => void) | null {
  return useContext(Context)?.open ?? null;
}

/** Runs one of the current page's commands by id, for a keyboard shortcut. */
export function useRunPageCommand(): (id: string) => boolean {
  return useContext(Context)?.runPageCommand ?? (() => false);
}

const SEARCH_DELAY_MS = 150;

/** What the menu finds as the person types: tickets by key or title, from the API. */
function useTicketSearch(organisationId: string, slug: string, query: string, active: boolean) {
  // Results are kept with the text they answer, so stale ones are never shown for new text.
  const [found, setFound] = useState<{ text: string; commands: Command[] }>({
    text: '',
    commands: [],
  });
  const text = query.trim();
  useEffect(() => {
    if (!active || !text) return;
    let current = true;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: text, pageSize: '8' });
      apiFetch<TicketList>(`/api/v1/orgs/${organisationId}/tickets?${params}`)
        .then((list) => {
          if (!current) return;
          setFound({
            text,
            commands: list.items.map((ticket) => ({
              id: `ticket:${ticket.key}`,
              group: 'Tickets',
              label: ticket.title,
              hint: ticket.key,
              href: workspaceHref(slug, `/tickets/${ticket.key}`),
            })),
          });
        })
        // A failed search finds nothing; the rest of the menu still works.
        .catch(() => current && setFound({ text, commands: [] }));
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [organisationId, slug, text, active]);
  return active && text && found.text === text ? found.commands : [];
}

/** Projects and saved views, loaded when the menu first opens. */
function useWorkspaceCommands(organisationId: string, slug: string, active: boolean) {
  const [commands, setCommands] = useState<Command[] | null>(null);
  useEffect(() => {
    if (!active || commands !== null) return;
    const api = `/api/v1/orgs/${organisationId}`;
    Promise.all([
      apiFetch<Project[]>(`${api}/projects`).catch(() => []),
      apiFetch<SavedView[]>(`${api}/views`).catch(() => []),
    ]).then(([projects, views]) =>
      setCommands([
        ...projects
          .filter((project) => !project.archived)
          .map((project): Command => ({
            id: `project:${project.key}`,
            group: 'Projects',
            label: project.name,
            hint: project.key,
            href: workspaceHref(slug, `/projects/${project.key}/board`),
          })),
        ...views.map((view): Command => ({
          id: `view:${view.id}`,
          group: 'Views',
          label: view.name,
          href: viewTarget(slug, view),
        })),
      ]),
    );
  }, [organisationId, slug, active, commands]);
  return commands ?? [];
}

/**
 * The command menu, opened with Ctrl+K (Cmd+K on a Mac) anywhere in a workspace: type to find a
 * ticket, a project, a saved view or a page, and on a ticket's page that ticket's own actions.
 * The arrow keys choose, Enter runs, Escape closes and puts the focus back where it was.
 */
export function CommandMenuProvider({
  organisationId,
  slug,
  pages,
  canCreate,
  children,
}: {
  organisationId: string;
  slug: string;
  /** The pages this person may open, as the sidebar lists them. */
  pages: { label: string; href: string }[];
  canCreate: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pageCommands, setPageCommands] = useState<Command[] | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const found = useTicketSearch(organisationId, slug, query, isOpen);
  const workspace = useWorkspaceCommands(organisationId, slug, isOpen);

  const open = () => {
    // Pressing Ctrl+K again while it is open keeps the place to go back to.
    if (isOpen) return;
    returnTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setActive(0);
    setOpen(true);
  };

  const close = (giveFocusBack: boolean) => {
    setOpen(false);
    if (giveFocusBack) returnTo.current?.focus();
  };

  // Ctrl+K (Cmd+K) is the one shortcut that works even while typing, as in other tools.
  const latestOpen = useRef(open);
  useEffect(() => {
    latestOpen.current = open;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        latestOpen.current();
      }
    };
    window.addEventListener('keydown', onKey);
    // Says the keyboard is listening (this runs after the shortcuts inside it have attached), so
    // browser tests do not press keys before anything can hear them.
    document.documentElement.dataset.keyboard = 'ready';
    return () => {
      window.removeEventListener('keydown', onKey);
      delete document.documentElement.dataset.keyboard;
    };
  }, []);

  const all: Command[] = [
    ...(pageCommands ?? []),
    ...(canCreate
      ? [
          {
            id: 'create-ticket',
            group: 'Actions' as const,
            label: 'Create ticket',
            href: workspaceHref(slug, '/tickets/new'),
          },
        ]
      : []),
    ...found,
    ...workspace,
    ...pages.map((page): Command => ({
      id: `page:${page.href}`,
      group: 'Pages',
      label: page.label,
      href: page.href,
    })),
  ];
  const shown = rankCommands(query, all);
  const chosen = Math.min(active, Math.max(0, shown.length - 1));

  const runPageCommand = (id: string) => {
    const command = pageCommands?.find((item) => item.id === id);
    if (!command?.run) return false;
    command.run();
    return true;
  };

  const run = (command: Command) => {
    // A command that stays on the page gives the focus back to where it was.
    close(command.href === undefined);
    if (command.href !== undefined) router.push(command.href);
    else command.run();
  };

  return (
    <Context value={{ setPageCommands, open, runPageCommand }}>
      {children}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close(true);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command menu"
            className="w-full max-w-lg overflow-hidden rounded-lg border border-edge-strong bg-panel shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
          >
            <input
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={shown.length > 0 ? optionId(chosen) : undefined}
              aria-label="Search tickets, projects, views and pages"
              placeholder="Type a ticket key, a title, a project or an action…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActive((chosen + 1) % Math.max(1, shown.length));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive((chosen - 1 + shown.length) % Math.max(1, shown.length));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const command = shown[chosen];
                  if (command) run(command);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  close(true);
                }
              }}
              className="w-full border-b border-edge bg-transparent px-4 py-3 text-[14px] outline-none placeholder:text-muted/70"
            />
            <ul
              id={listId}
              role="listbox"
              aria-label="Results"
              className="max-h-80 overflow-y-auto p-1"
            >
              {shown.length === 0 ? (
                <li className="px-3 py-3 text-[13px] text-muted">Nothing matches.</li>
              ) : (
                shown.map((command, index) => (
                  <li
                    key={command.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === chosen}
                    onMouseMove={() => setActive(index)}
                    onClick={() => run(command)}
                    className={`flex cursor-pointer items-center gap-3 rounded px-3 py-2 text-[13px] ${
                      index === chosen ? 'bg-raised' : ''
                    }`}
                  >
                    {command.hint && (
                      <span className="shrink-0 font-mono text-xs text-muted">{command.hint}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </Context>
  );
}
