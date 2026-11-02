import { z } from 'zod';
import {
  DATE_SPEC_PATTERN,
  DUE_FILTERS,
  TICKET_SORTS,
  ticketFilterSchema,
  type TicketFilters,
} from './ticket-filters';
import { PROJECT_KEY_PATTERN, hasControlCharacter, parseTicketKey } from './tickets';

/**
 * The query language: `status:"in the forge" assignee:me label:bug updated:>-7d order:priority`,
 * read into the same filters the filter bar, saved views and the API already use. One parser for
 * all of them. Names are looked up in a context, so `assignee:adam` finds a person.
 */

/** What names in a query can mean. Built by the API from the database. */
export type QueryContext = {
  statuses: { key: string; name: string }[];
  types: { key: string; name: string }[];
  priorities: { key: string; name: string }[];
  /** Empty for someone who may not see the member list; `me` still works. */
  people: { id: string; name: string; email: string | null }[];
  milestones: { id: string; name: string }[];
  cycles: { id: string; name: string }[];
  projects: string[];
  labels: string[];
};

export type QueryIssue = { message: string; start: number; end: number };

/** The filters a query describes in full; everything else (custom fields, tree…) is left alone. */
export const QUERY_FIELDS = [
  'q',
  'project',
  'statusKey',
  'statusCategory',
  'type',
  'priority',
  'assignee',
  'reporter',
  'label',
  'milestone',
  'cycle',
  'due',
  'updatedFrom',
  'updatedBefore',
  'createdFrom',
  'createdBefore',
  'archived',
  'sort',
  'dir',
  'parent',
  'epic',
  'linked',
  'blocked',
  'top',
  'triage',
  'watching',
] as const satisfies readonly (keyof TicketFilters)[];
export type QueryField = (typeof QUERY_FIELDS)[number];
export type QueryFilters = Pick<TicketFilters, QueryField>;

const KEYS = [
  'project',
  'status',
  'type',
  'priority',
  'assignee',
  'reporter',
  'label',
  'milestone',
  'cycle',
  'due',
  'updated',
  'created',
  'is',
  'order',
  'parent',
  'epic',
  'linked',
] as const;
type Key = (typeof KEYS)[number];

const IS_VALUES = [
  'open',
  'todo',
  'started',
  'done',
  'blocked',
  'unblocked',
  'archived',
  'watching',
  'top',
  'triage',
] as const;

/** The direction each order reads most naturally in, used when none is given. */
const NATURAL_DIR: Record<TicketFilters['sort'], 'asc' | 'desc'> = {
  updated: 'desc',
  created: 'desc',
  priority: 'desc',
  due: 'asc',
  key: 'asc',
  rank: 'asc',
};

const MAX_QUERY_LENGTH = 500;
const MAX_VALUES = 20;

type Token = {
  /** The words as typed, quotes included. */
  raw: string;
  start: number;
  end: number;
};

/** Splits on spaces outside double quotes. */
export function tokenizeQuery(text: string): Token[] {
  const tokens: Token[] = [];
  let start = -1;
  let quoted = false;
  for (let index = 0; index <= text.length; index += 1) {
    const char = text[index];
    const atEnd = index === text.length;
    if (!atEnd && char === '"') quoted = !quoted;
    const space = atEnd || (!quoted && /\s/.test(char!));
    if (space) {
      if (start !== -1) tokens.push({ raw: text.slice(start, index), start, end: index });
      start = -1;
    } else if (start === -1) {
      start = index;
    }
  }
  return tokens;
}

/** Splits a value on commas outside quotes, and takes the quotes off each part. */
function splitValues(raw: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of raw) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim());
}

const quote = (value: string) => (/[\s,":]/.test(value) || value === '' ? `"${value}"` : value);
const lower = (value: string) => value.toLowerCase();

/** How many single-letter edits turn one word into the other. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length]!;
}

/** The closest of the choices, if any is close enough to be what was meant. */
export function closest(word: string, choices: readonly string[]): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const choice of choices) {
    const score = lower(choice).startsWith(lower(word)) ? 0 : distance(lower(word), lower(choice));
    if (score < bestScore) {
      best = choice;
      bestScore = score;
    }
  }
  return best !== null && bestScore <= Math.max(1, Math.floor(word.length / 3)) ? best : null;
}

const didYouMean = (word: string, choices: readonly string[]) => {
  const guess = closest(word, choices);
  return guess ? ` Did you mean ${quote(guess)}?` : '';
};

/** The filters a query leaves at their defaults. */
export function emptyQueryFilters(): QueryFilters {
  const defaults = ticketFilterSchema.parse({});
  const result = {} as Record<string, unknown>;
  for (const field of QUERY_FIELDS) result[field] = defaults[field];
  return result as QueryFilters;
}

/**
 * Reads a query. Every word is accounted for: anything not understood is an issue naming where it
 * is, never a guess. Plain words become the text search.
 */
export function parseTicketQuery(
  text: string,
  context: QueryContext,
):
  | { ok: true; filters: QueryFilters; mentioned: QueryField[] }
  | { ok: false; issues: QueryIssue[] } {
  const issues: QueryIssue[] = [];
  if (text.length > MAX_QUERY_LENGTH) {
    return {
      ok: false,
      issues: [
        {
          message: `Keep a query under ${MAX_QUERY_LENGTH} characters.`,
          start: 0,
          end: text.length,
        },
      ],
    };
  }
  if (hasControlCharacter(text)) {
    return {
      ok: false,
      issues: [
        { message: 'A query must not contain control characters.', start: 0, end: text.length },
      ],
    };
  }
  if ((text.match(/"/g) ?? []).length % 2 === 1) {
    const at = text.lastIndexOf('"');
    issues.push({ message: 'A quote is not closed.', start: at, end: text.length });
  }

  const filters = emptyQueryFilters();
  const words: string[] = [];
  const seen = new Set<string>();
  const statusCategories = new Set<TicketFilters['statusCategory'][number]>();
  // The fields the query speaks about, so applying it changes only those.
  const mentioned = new Set<QueryField>(['q']);

  for (const token of tokenizeQuery(text)) {
    const match = /^(-?)([a-zA-Z]+):(.*)$/s.exec(token.raw);
    if (!match) {
      words.push(token.raw.replace(/"/g, ''));
      continue;
    }
    const [, negated, rawKey, rawValue] = match as unknown as [string, string, string, string];
    const key = lower(rawKey) as Key;
    const problem = (message: string) =>
      issues.push({ message, start: token.start, end: token.end });
    if (!(KEYS as readonly string[]).includes(key)) {
      problem(`There is no filter called ${rawKey}.${didYouMean(key, KEYS)}`);
      continue;
    }
    if (negated) {
      problem(`Leaving things out (-${key}:) is not supported; a filter can only pick tickets in.`);
      continue;
    }
    const values = splitValues(rawValue);
    if (values.some((value) => value === '')) {
      problem(`Give ${key}: a value, like ${example(key)}.`);
      continue;
    }
    const once = (field: string) => {
      if (seen.has(field)) {
        problem(`Give ${field}: only once.`);
        return false;
      }
      seen.add(field);
      if (values.length > 1) {
        problem(`${field}: takes a single value.`);
        return false;
      }
      return true;
    };
    const many = <T>(field: QueryField, resolved: T[]) => {
      const list = [...new Set([...(filters[field] as T[]), ...resolved])];
      if (list.length > MAX_VALUES) problem(`At most ${MAX_VALUES} values for ${key}:.`);
      (filters as Record<string, unknown>)[field] = list;
      mentioned.add(field);
    };

    switch (key) {
      case 'project': {
        const keys = values.map((value) => value.toUpperCase());
        const unknown = keys.filter(
          (value) => !PROJECT_KEY_PATTERN.test(value) || !context.projects.includes(value),
        );
        if (unknown.length > 0) {
          problem(`No project ${unknown[0]}.${didYouMean(unknown[0]!, context.projects)}`);
          break;
        }
        many('project', keys);
        break;
      }
      case 'status':
      case 'type':
      case 'priority': {
        const choices =
          key === 'status' ? context.statuses : key === 'type' ? context.types : context.priorities;
        const resolved: string[] = [];
        for (const value of values) {
          const found = choices.filter(
            (choice) => lower(choice.key) === lower(value) || lower(choice.name) === lower(value),
          );
          if (found.length === 0) {
            problem(
              `No ${key} ${quote(value)}.${didYouMean(value, [...new Set(choices.map((choice) => choice.name))])}`,
            );
          }
          resolved.push(...found.map((choice) => choice.key));
        }
        many(key === 'status' ? 'statusKey' : key, resolved);
        break;
      }
      case 'assignee':
      case 'reporter': {
        const resolved: string[] = [];
        for (const value of values) {
          if (lower(value) === 'me') resolved.push('me');
          else if (lower(value) === 'none' && key === 'assignee') resolved.push('none');
          else {
            const person = findPerson(value, context.people);
            if (typeof person === 'string') problem(person);
            else resolved.push(person.id);
          }
        }
        many(key, resolved);
        break;
      }
      case 'label': {
        const tooLong = values.find((value) => value.length > 40);
        if (tooLong) {
          problem('A label is at most 40 characters.');
          break;
        }
        many('label', values);
        break;
      }
      case 'milestone':
      case 'cycle': {
        const choices = key === 'milestone' ? context.milestones : context.cycles;
        const resolved: string[] = [];
        for (const value of values) {
          if (lower(value) === 'none') {
            resolved.push('none');
            continue;
          }
          const found = choices.filter((choice) => lower(choice.name) === lower(value));
          if (found.length === 0) {
            problem(
              `No ${key} ${quote(value)}.${didYouMean(
                value,
                choices.map((choice) => choice.name),
              )}`,
            );
          }
          resolved.push(...found.map((choice) => choice.id));
        }
        many(key, resolved);
        break;
      }
      case 'due': {
        if (!once('due')) break;
        const value = lower(values[0]!);
        if (!(DUE_FILTERS as readonly string[]).includes(value)) {
          problem(`due: is one of ${DUE_FILTERS.join(', ')}.${didYouMean(value, DUE_FILTERS)}`);
          break;
        }
        filters.due = value as TicketFilters['due'];
        mentioned.add('due');
        break;
      }
      case 'updated':
      case 'created': {
        if (values.length > 1) {
          problem(`${key}: takes a single value.`);
          break;
        }
        const range = /^([<>])=?(.*)$/.exec(values[0]!);
        if (!range) {
          problem(`Say which side: ${key}:>-7d for since, ${key}:<2026-10-01 for before.`);
          break;
        }
        const [, side, spec] = range as unknown as [string, string, string];
        const field = `${key}${side === '>' ? 'From' : 'Before'}` as
          'updatedFrom' | 'updatedBefore' | 'createdFrom' | 'createdBefore';
        if (seen.has(field)) {
          problem(`Give ${key}:${side} only once.`);
          break;
        }
        seen.add(field);
        const valid = ticketFilterSchema.shape[field].safeParse(lower(spec));
        if (!DATE_SPEC_PATTERN.test(lower(spec)) || !valid.success) {
          problem(
            `${quote(spec)} is not a date. Use 2026-10-01, or -7d or -2w for days or weeks ago.`,
          );
          break;
        }
        filters[field] = lower(spec);
        mentioned.add(field);
        break;
      }
      case 'is': {
        for (const raw of values) {
          const value = lower(raw);
          switch (value) {
            case 'open':
              statusCategories.add('not_started').add('in_progress');
              break;
            case 'todo':
              statusCategories.add('not_started');
              break;
            case 'started':
              statusCategories.add('in_progress');
              break;
            case 'done':
              statusCategories.add('completed');
              break;
            case 'blocked':
            case 'unblocked':
              if (filters.blocked && filters.blocked !== (value === 'blocked' ? 'yes' : 'no')) {
                problem('A ticket cannot be both blocked and unblocked.');
              }
              filters.blocked = value === 'blocked' ? 'yes' : 'no';
              mentioned.add('blocked');
              break;
            case 'archived':
            case 'watching':
            case 'top':
            case 'triage':
              filters[value] = true;
              mentioned.add(value);
              break;
            default:
              problem(`is: is one of ${IS_VALUES.join(', ')}.${didYouMean(value, IS_VALUES)}`);
          }
        }
        break;
      }
      case 'order': {
        if (!once('order')) break;
        const [field, dir, ...rest] = lower(values[0]!).split('-');
        if (!(TICKET_SORTS as readonly string[]).includes(field!) || rest.length > 0) {
          problem(
            `order: is one of ${TICKET_SORTS.join(', ')}.${didYouMean(field!, TICKET_SORTS)}`,
          );
          break;
        }
        if (dir !== undefined && dir !== 'asc' && dir !== 'desc') {
          problem(`End order: with -asc or -desc, like order:${field}-asc.`);
          break;
        }
        filters.sort = field as TicketFilters['sort'];
        mentioned.add('sort').add('dir');
        filters.dir = (dir as 'asc' | 'desc' | undefined) ?? NATURAL_DIR[filters.sort];
        break;
      }
      case 'parent':
      case 'epic':
      case 'linked': {
        if (!once(key)) break;
        const parsed = parseTicketKey(values[0]!);
        if (!parsed) {
          problem(`${key}: takes a ticket key, like ${key}:WEB-12.`);
          break;
        }
        filters[key] = `${parsed.projectKey}-${parsed.number}`;
        mentioned.add(key);
        break;
      }
    }
  }

  filters.statusCategory = [...statusCategories];
  if (statusCategories.size > 0) mentioned.add('statusCategory');
  filters.q = words.join(' ').trim();
  if (filters.q.length > 100) {
    issues.push({
      message: 'Keep the search words under 100 characters.',
      start: 0,
      end: text.length,
    });
  }
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, filters, mentioned: [...mentioned] };
}

/**
 * Puts a query's filters on top of others: the fields the query names (and the search words)
 * change, the rest stay. Back to the first page, since the list is a different one.
 */
export function applyTicketQuery(
  filters: TicketFilters,
  query: { filters: QueryFilters; mentioned: readonly QueryField[] },
): TicketFilters {
  const next: Record<string, unknown> = { ...filters, page: 1 };
  for (const field of query.mentioned) next[field] = query.filters[field];
  return next as TicketFilters;
}

function example(key: Key): string {
  switch (key) {
    case 'updated':
    case 'created':
      return `${key}:>-7d`;
    case 'is':
      return 'is:open';
    case 'order':
      return 'order:priority';
    case 'parent':
    case 'epic':
    case 'linked':
      return `${key}:WEB-12`;
    case 'assignee':
    case 'reporter':
      return `${key}:me`;
    case 'due':
      return 'due:overdue';
    case 'project':
      return 'project:WEB';
    default:
      return `${key}:something`;
  }
}

/** A person by email, full name, or a part of their name only they have; or what went wrong. */
function findPerson(value: string, people: QueryContext['people']) {
  const wanted = lower(value);
  const exact = people.filter(
    (person) => lower(person.email ?? '') === wanted || lower(person.name) === wanted,
  );
  if (exact.length === 1) return exact[0]!;
  const partial =
    exact.length > 1 ? exact : people.filter((person) => lower(person.name).includes(wanted));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    return `${quote(value)} could be ${partial
      .slice(0, 3)
      .map((person) => person.name)
      .join(' or ')}. Use their email.`;
  }
  return `No one called ${quote(value)} here.`;
}

/** Writes filters back as a query, the way someone would type them. */
export function formatTicketQuery(filters: TicketFilters, context: QueryContext): string {
  const terms: string[] = [];
  const nameOf = (list: { key: string; name: string }[], key: string) =>
    quote(list.find((item) => item.key === key)?.name ?? key);
  const person = (id: string) => {
    if (id === 'me' || id === 'none') return id;
    const found = context.people.find((p) => p.id === id);
    return found ? quote(found.email ?? found.name) : null;
  };
  const named = (list: { id: string; name: string }[], id: string) =>
    id === 'none' ? 'none' : quote(list.find((item) => item.id === id)?.name ?? '');

  if (filters.project.length > 0) terms.push(`project:${filters.project.join(',')}`);
  if (filters.statusKey.length > 0) {
    terms.push(`status:${filters.statusKey.map((key) => nameOf(context.statuses, key)).join(',')}`);
  }
  const categories = new Set(filters.statusCategory);
  if (categories.has('not_started') && categories.has('in_progress')) {
    terms.push('is:open');
    categories.delete('not_started');
    categories.delete('in_progress');
  }
  if (categories.has('not_started')) terms.push('is:todo');
  if (categories.has('in_progress')) terms.push('is:started');
  if (categories.has('completed')) terms.push('is:done');
  if (filters.type.length > 0) {
    terms.push(`type:${filters.type.map((key) => nameOf(context.types, key)).join(',')}`);
  }
  if (filters.priority.length > 0) {
    terms.push(
      `priority:${filters.priority.map((key) => nameOf(context.priorities, key)).join(',')}`,
    );
  }
  for (const field of ['assignee', 'reporter'] as const) {
    const people = filters[field].map(person).filter((p): p is string => p !== null);
    if (people.length > 0) terms.push(`${field}:${people.join(',')}`);
  }
  for (const label of filters.label) terms.push(`label:${quote(label)}`);
  if (filters.milestone.length > 0) {
    terms.push(
      `milestone:${filters.milestone.map((id) => named(context.milestones, id)).join(',')}`,
    );
  }
  if (filters.cycle.length > 0) {
    terms.push(`cycle:${filters.cycle.map((id) => named(context.cycles, id)).join(',')}`);
  }
  if (filters.due) terms.push(`due:${filters.due}`);
  if (filters.updatedFrom) terms.push(`updated:>${filters.updatedFrom}`);
  if (filters.updatedBefore) terms.push(`updated:<${filters.updatedBefore}`);
  if (filters.createdFrom) terms.push(`created:>${filters.createdFrom}`);
  if (filters.createdBefore) terms.push(`created:<${filters.createdBefore}`);
  if (filters.blocked) terms.push(filters.blocked === 'yes' ? 'is:blocked' : 'is:unblocked');
  for (const flag of ['archived', 'watching', 'top', 'triage'] as const) {
    if (filters[flag]) terms.push(`is:${flag}`);
  }
  for (const field of ['parent', 'epic', 'linked'] as const) {
    if (filters[field]) terms.push(`${field}:${filters[field]}`);
  }
  if (filters.sort !== 'updated' || filters.dir !== 'desc') {
    terms.push(
      `order:${filters.sort}${filters.dir === NATURAL_DIR[filters.sort] ? '' : `-${filters.dir}`}`,
    );
  }
  if (filters.q) terms.push(filters.q);
  return terms.join(' ');
}

export type QuerySuggestion = {
  /** What to show. */
  label: string;
  /** What replaces the word being typed (from `from` to `to`). */
  insert: string;
  /** A short note beside it: what a filter does, or the key of a status. */
  detail?: string;
};

const KEY_HELP: Record<Key, string> = {
  project: 'In a project',
  status: 'In a status',
  type: 'Of a type',
  priority: 'Of a priority',
  assignee: 'Assigned to (me, none, a name)',
  reporter: 'Reported by',
  label: 'With a label',
  milestone: 'In a milestone',
  cycle: 'In a cycle',
  due: 'overdue, today, week or none',
  updated: 'Changed since (>-7d) or before (<date)',
  created: 'Made since (>-7d) or before (<date)',
  is: 'open, done, blocked, watching…',
  order: 'Order by',
  parent: 'Directly under a ticket',
  epic: 'Anywhere under an epic',
  linked: 'Linked to a ticket',
};

/** What could complete the word at the cursor: a filter name, or a value for one. */
export function suggestQuery(
  text: string,
  cursor: number,
  context: QueryContext,
): { from: number; to: number; items: QuerySuggestion[] } {
  const token = tokenizeQuery(text).find((item) => item.start <= cursor && cursor <= item.end);
  const from = token?.start ?? cursor;
  const to = token?.end ?? cursor;
  const typed = token ? text.slice(token.start, cursor) : '';
  const colon = typed.indexOf(':');
  const limit = (items: QuerySuggestion[]) => items.slice(0, 8);

  if (colon === -1) {
    const word = lower(typed);
    return {
      from,
      to,
      items: limit(
        KEYS.filter((key) => key.startsWith(word) && word.length > 0).map((key) => ({
          label: `${key}:`,
          insert: `${key}:`,
          detail: KEY_HELP[key],
        })),
      ),
    };
  }

  const key = lower(typed.slice(0, colon)) as Key;
  // Only the last of several comma-separated values is being typed.
  const valueText = typed.slice(colon + 1);
  const lastComma = valueText.lastIndexOf(',');
  const before =
    typed.slice(0, colon + 1) + (lastComma === -1 ? '' : valueText.slice(0, lastComma + 1));
  const partial = lower(valueText.slice(lastComma + 1).replace(/"/g, ''));
  const already = new Set(
    lastComma === -1 ? [] : splitValues(valueText.slice(0, lastComma)).map(lower),
  );
  // A value is found by what it is called or by its key (`hig` finds Blaze, key high).
  const words = (pair: { value: string; detail?: string }) => [
    lower(pair.value),
    lower(pair.detail ?? ''),
  ];
  const options = (pairs: { value: string; detail?: string }[]) =>
    limit(
      pairs
        .filter(
          (pair) =>
            words(pair).some((word) => word.includes(partial)) && !already.has(lower(pair.value)),
        )
        .sort(
          (a, b) =>
            Number(!words(a).some((word) => word.startsWith(partial))) -
            Number(!words(b).some((word) => word.startsWith(partial))),
        )
        .map((pair) => ({
          label: pair.value,
          insert: `${before}${quote(pair.value)}`,
          ...(pair.detail ? { detail: pair.detail } : {}),
        })),
    );
  const unique = (values: string[]) => [...new Set(values)].map((value) => ({ value }));
  const keyedOptions = (list: { key: string; name: string }[]) => {
    const seen = new Set<string>();
    return options(
      list
        .filter((item) => !seen.has(item.name) && Boolean(seen.add(item.name)))
        .map((item) => ({ value: item.name, detail: item.key })),
    );
  };

  let items: QuerySuggestion[];
  switch (key) {
    case 'project':
      items = options(unique(context.projects));
      break;
    case 'status':
      items = keyedOptions(context.statuses);
      break;
    case 'type':
      items = keyedOptions(context.types);
      break;
    case 'priority':
      items = keyedOptions(context.priorities);
      break;
    case 'assignee':
    case 'reporter':
      items = options([
        { value: 'me' },
        ...(key === 'assignee' ? [{ value: 'none', detail: 'Unassigned' }] : []),
        ...context.people.map((person) => ({
          value: person.email ?? person.name,
          detail: person.name,
        })),
      ]);
      break;
    case 'label':
      items = options(unique(context.labels));
      break;
    case 'milestone':
      items = options([{ value: 'none' }, ...unique(context.milestones.map((m) => m.name))]);
      break;
    case 'cycle':
      items = options([{ value: 'none' }, ...unique(context.cycles.map((c) => c.name))]);
      break;
    case 'due':
      items = options(unique([...DUE_FILTERS]));
      break;
    case 'is':
      items = options(unique([...IS_VALUES]));
      break;
    case 'order':
      items = options(
        TICKET_SORTS.flatMap((sort) => [
          { value: sort },
          { value: `${sort}-${NATURAL_DIR[sort] === 'asc' ? 'desc' : 'asc'}` },
        ]),
      );
      break;
    case 'updated':
    case 'created':
      items = options([
        { value: '>-1d', detail: 'In the last day' },
        { value: '>-7d', detail: 'In the last week' },
        { value: '>-30d', detail: 'In the last 30 days' },
        { value: '<-30d', detail: 'Over 30 days ago' },
      ]).map((item) => ({ ...item, insert: item.insert.replace(/"/g, '') }));
      break;
    default:
      items = [];
  }
  return { from, to, items };
}

const keyed = z.array(z.object({ key: z.string(), name: z.string() }));
const named = z.array(z.object({ id: z.uuid(), name: z.string() }));

/** The query context as the API sends it. */
export const queryContextSchema = z.object({
  statuses: keyed,
  types: keyed,
  priorities: keyed,
  people: z.array(z.object({ id: z.uuid(), name: z.string(), email: z.string().nullable() })),
  milestones: named,
  cycles: named,
  projects: z.array(z.string()),
  labels: z.array(z.string()),
}) satisfies z.ZodType<QueryContext>;
