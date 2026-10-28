import { ServerError, call } from './client';
import type { CliConfig } from './config';
import { MOVE_WORDS } from './words';

// Reading tickets: `forge catalogue` lists them, `forge inspect` shows one.

type Ref = { key: string; name: string };
type Summary = {
  key: string;
  title: string;
  version: number;
  status: Ref & { id: string; category: string };
  priority: Ref;
  assignee: { displayName: string } | null;
  parentKey: string | null;
  openBlockerKeys: string[];
  criteria: { done: number; total: number };
};
type Detail = Summary & {
  type: Ref;
  project: { key: string; name: string };
  goal: string;
  description: string;
  criteriaItems: { text: string; done: boolean }[];
  allowedTransitions: Ref[];
  dueDate: string | null;
  archivedAt: string | null;
};

/** The move word for each status key, so `inspect` can say which commands would work. */
const WORD_FOR_KEY = new Map<string, string>();
for (const [word, { key }] of Object.entries(MOVE_WORDS)) {
  if (!WORD_FOR_KEY.has(key)) WORD_FOR_KEY.set(key, word);
}

/** A 404 for a ticket says which ticket and where, not just "Not found". */
export async function readTicket(config: CliConfig, key: string): Promise<Detail> {
  try {
    return await call<Detail>(config.server, `/api/v1/orgs/${config.workspace.id}/tickets/${key}`, {
      token: config.token,
    });
  } catch (error) {
    if (error instanceof ServerError && error.status === 404) {
      throw new ServerError(404, `${key} doesn't exist in ${config.workspace.name}.`);
    }
    throw error;
  }
}

export type CatalogueOptions = {
  mine: boolean;
  project?: string;
  status?: string;
  search?: string;
  limit: number;
};

export async function listTickets(
  config: CliConfig,
  options: CatalogueOptions,
): Promise<{ items: Summary[]; total: number }> {
  const params = new URLSearchParams({ pageSize: String(options.limit) });
  if (options.mine) params.append('assignee', 'me');
  if (options.project) params.append('project', options.project.toUpperCase());
  if (options.status) params.append('statusKey', options.status);
  if (options.search) params.set('q', options.search);
  return call(config.server, `/api/v1/orgs/${config.workspace.id}/tickets?${params}`, {
    token: config.token,
  });
}

const clip = (text: string, width: number) =>
  text.length <= width ? text.padEnd(width) : `${text.slice(0, width - 1)}…`;

/** A plain table that fits an 100-column terminal. */
export function formatCatalogue(list: { items: Summary[]; total: number }): string[] {
  if (list.items.length === 0) return ['No tickets match.'];
  const lines = [
    `${'KEY'.padEnd(10)} ${'STATUS'.padEnd(13)} ${'HEAT'.padEnd(9)} ${'WHO'.padEnd(16)} TITLE`,
  ];
  for (const t of list.items) {
    const flags = [t.openBlockerKeys.length > 0 ? 'jammed by ' + t.openBlockerKeys.join(',') : '']
      .filter(Boolean)
      .join(' ');
    lines.push(
      [
        clip(t.key, 10),
        clip(t.status.name, 13),
        clip(t.priority.name, 9),
        clip(t.assignee?.displayName ?? '-', 16),
        t.title + (flags ? `  [${flags}]` : ''),
      ].join(' '),
    );
  }
  if (list.total > list.items.length) {
    lines.push(
      `Showing ${list.items.length} of ${list.total}. Narrow it with --mine, --status or --search.`,
    );
  }
  return lines;
}

/** One ticket as readable text: the parts a reviewer needs, then what can be done next. */
export function formatTicket(t: Detail, server: string, slug: string): string[] {
  const lines = [`${t.key}  ${t.title}`];
  lines.push(
    `${t.type.name} in ${t.project.name} · ${t.status.name} · ${t.priority.name} · ${t.assignee?.displayName ?? 'unassigned'}` +
      (t.dueDate ? ` · due ${t.dueDate}` : '') +
      (t.archivedAt ? ' · archived' : ''),
  );
  if (t.parentKey) lines.push(`Part of ${t.parentKey}`);
  if (t.openBlockerKeys.length > 0) lines.push(`Blocked by ${t.openBlockerKeys.join(', ')}`);
  if (t.goal) lines.push('', 'Goal', `  ${t.goal.replace(/\n/g, '\n  ')}`);
  if (t.criteriaItems.length > 0) {
    lines.push('', `Acceptance criteria (${t.criteria.done} of ${t.criteria.total} met)`);
    for (const item of t.criteriaItems) lines.push(`  [${item.done ? 'x' : ' '}] ${item.text}`);
  }
  if (t.description) lines.push('', 'Description', `  ${t.description.replace(/\n/g, '\n  ')}`);
  const moves = t.allowedTransitions
    .map((status) => {
      const word = WORD_FOR_KEY.get(status.key);
      return word ? `forge ${word} ${t.key} (${status.name})` : null;
    })
    .filter((move): move is string => move !== null);
  if (moves.length > 0) lines.push('', 'Next moves', ...moves.map((move) => `  ${move}`));
  lines.push('', `${server}/w/${slug}/tickets/${t.key}`);
  return lines;
}
