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
  /** `refusal`: why the move would be refused now; missing from a server older than this. */
  allowedTransitions: (Ref & { rules?: string[]; refusal?: string | null })[];
  dueDate: string | null;
  archivedAt: string | null;
  /** Custom fields that apply to the ticket; missing from a server older than P4. */
  fields?: { name: string; text: string | null }[];
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
  /** A query, like `assignee:me is:open order:priority`, read by the server. */
  query?: string;
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
  if (options.query !== undefined) params.set('query', options.query);
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
      `Showing ${list.items.length} of ${list.total}. Narrow it with --mine, --status, --search or --query.`,
    );
  }
  return lines;
}

/** A move as a command: its word when it has one, or `forge move` with the status name. */
function moveCommand(key: string, status: Ref): string {
  const word = WORD_FOR_KEY.get(status.key);
  if (word) return `forge ${word} ${key}`;
  return `forge move ${key} ${/^[\w-]+$/.test(status.name) ? status.name : `"${status.name}"`}`;
}

/** One ticket as readable text: the parts a reviewer needs, then what can be done next. */
export function formatTicket(
  t: Detail,
  server: string,
  slug: string,
  options: { readOnly?: boolean } = {},
): string[] {
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
  // Custom fields: only those with a value, one per line; a long text keeps its line breaks.
  const filled = (t.fields ?? []).filter((field) => field.text !== null && field.text !== '');
  if (filled.length > 0) {
    lines.push('', 'Fields');
    for (const field of filled) {
      lines.push(`  ${field.name}: ${field.text!.replace(/\n/g, '\n    ')}`);
    }
  }
  if (t.description) lines.push('', 'Description', `  ${t.description.replace(/\n/g, '\n  ')}`);
  // Only moves that would go through are offered; the rest say why not, so nothing listed fails.
  if (options.readOnly) {
    lines.push('', 'Next moves', '  None with this token: it is read only.');
  } else if (t.allowedTransitions.length > 0) {
    lines.push('', 'Next moves');
    for (const status of t.allowedTransitions) {
      if (status.refusal) {
        lines.push(`  ${status.name}: not now. ${status.refusal}`);
        continue;
      }
      const needsComment = status.rules?.includes('needs_comment') ? ' -m "why"' : '';
      lines.push(`  ${moveCommand(t.key, status)}${needsComment} (${status.name})`);
    }
  }
  lines.push('', `${server}/w/${slug}/tickets/${t.key}`);
  return lines;
}
