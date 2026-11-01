import { describe, expect, it } from 'vitest';
import { parseTicketFilters, resolveDateSpec, ticketFilterSchema } from './ticket-filters';
import {
  applyTicketQuery,
  closest,
  formatTicketQuery,
  parseTicketQuery,
  suggestQuery,
  tokenizeQuery,
  type QueryContext,
} from './ticket-query-language';

const ADAM = '11111111-1111-4111-8111-111111111111';
const ADA = '22222222-2222-4222-8222-222222222222';
const BETA = '33333333-3333-4333-8333-333333333333';

const context: QueryContext = {
  statuses: [
    { key: 'open', name: 'Warming' },
    { key: 'in_progress', name: 'In the Forge' },
    { key: 'done', name: 'Quenched' },
  ],
  types: [
    { key: 'bug', name: 'Bug' },
    { key: 'task', name: 'Task' },
  ],
  priorities: [
    { key: 'high', name: 'High' },
    { key: 'low', name: 'Low' },
  ],
  people: [
    { id: ADAM, name: 'Adam Admin', email: 'adam@acme.test' },
    { id: ADA, name: 'Ada Lovelace', email: 'ada@acme.test' },
  ],
  milestones: [{ id: BETA, name: 'Beta launch' }],
  cycles: [],
  projects: ['WEB', 'API'],
  labels: ['bug', 'ui'],
};

const parse = (text: string) => parseTicketQuery(text, context);
const ok = (text: string) => {
  const result = parse(text);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.filters;
};
const issues = (text: string) => {
  const result = parse(text);
  if (result.ok) throw new Error('expected issues');
  return result.issues;
};

describe('tokenizeQuery', () => {
  it('splits on spaces outside quotes and keeps positions', () => {
    expect(tokenizeQuery('status:"in the forge"  login')).toEqual([
      { raw: 'status:"in the forge"', start: 0, end: 21 },
      { raw: 'login', start: 23, end: 28 },
    ]);
  });
});

describe('parseTicketQuery', () => {
  it('reads the roadmap’s example', () => {
    const filters = ok('status:"in the forge" assignee:me label:bug updated:>-7d order:priority');
    expect(filters).toMatchObject({
      statusKey: ['in_progress'],
      assignee: ['me'],
      label: ['bug'],
      updatedFrom: '-7d',
      sort: 'priority',
      dir: 'desc',
      q: '',
    });
  });

  it('takes keys or names in any case, and several values', () => {
    expect(ok('STATUS:warming,done type:BUG priority:high')).toMatchObject({
      statusKey: ['open', 'done'],
      type: ['bug'],
      priority: ['high'],
    });
    expect(ok('project:web project:api').project).toEqual(['WEB', 'API']);
  });

  it('finds people by email, full name or a part only they have', () => {
    expect(ok('assignee:adam@acme.test').assignee).toEqual([ADAM]);
    expect(ok('assignee:"Ada Lovelace"').assignee).toEqual([ADA]);
    expect(ok('reporter:lovelace').reporter).toEqual([ADA]);
    expect(issues('assignee:ad')[0]!.message).toMatch(/could be Adam Admin or Ada Lovelace/);
    expect(issues('reporter:none')[0]!.message).toMatch(/No one called none/);
  });

  it('turns is: into categories and flags', () => {
    expect(ok('is:open is:blocked is:watching')).toMatchObject({
      statusCategory: ['not_started', 'in_progress'],
      blocked: 'yes',
      watching: true,
    });
    expect(issues('is:blocked is:unblocked')[0]!.message).toMatch(/both/);
  });

  it('reads date ranges as on-or-after and before', () => {
    expect(ok('created:>2026-10-01 created:<-2w updated:>=-1d')).toMatchObject({
      createdFrom: '2026-10-01',
      createdBefore: '-2w',
      updatedFrom: '-1d',
    });
    expect(issues('updated:-7d')[0]!.message).toMatch(/Say which side/);
    expect(issues('created:>2026-02-30')[0]!.message).toMatch(/not a date/);
  });

  it('orders in the natural direction unless told', () => {
    expect(ok('order:due')).toMatchObject({ sort: 'due', dir: 'asc' });
    expect(ok('order:due-desc')).toMatchObject({ sort: 'due', dir: 'desc' });
    expect(issues('order:size')[0]!.message).toMatch(/order: is one of/);
  });

  it('keeps plain and quoted words as the text search', () => {
    expect(ok('login "error:500" broken').q).toBe('login error:500 broken');
  });

  it('names what it does not understand, where it is, with a suggestion', () => {
    expect(issues('login statsu:open')).toEqual([
      {
        message: 'There is no filter called statsu. Did you mean status?',
        start: 6,
        end: 17,
      },
    ]);
    expect(issues('status:quenchd')[0]!.message).toBe('No status quenchd. Did you mean Quenched?');
    expect(issues('-label:bug')[0]!.message).toMatch(/not supported/);
    expect(issues('due:soon due:today').map((issue) => issue.message)).toEqual([
      expect.stringMatching(/due: is one of/),
      'Give due: only once.',
    ]);
    expect(issues('milestone:"Beta')[0]!.message).toBe('A quote is not closed.');
    expect(issues('epic:nope')[0]!.message).toMatch(/ticket key/);
    expect(issues('project:XYZ')[0]!.message).toMatch(/No project XYZ/);
  });

  it('refuses control characters and very long queries', () => {
    expect(issues('a\u0007b')[0]!.message).toMatch(/control/);
    expect(issues('x'.repeat(501))[0]!.message).toMatch(/under 500/);
  });

  it('gives filters the API accepts', () => {
    const filters = ok('milestone:"beta launch",none label:ui is:archived epic:web-1');
    expect(filters).toMatchObject({ milestone: [BETA, 'none'], archived: true, epic: 'WEB-1' });
    expect(ticketFilterSchema.safeParse({ ...filters }).success).toBe(true);
  });
});

describe('formatTicketQuery', () => {
  it('writes filters back as a query that reads the same', () => {
    const text =
      'project:WEB status:"In the Forge" is:open type:Bug assignee:me,ada@acme.test label:ui ' +
      'milestone:"Beta launch" due:overdue updated:>-7d is:blocked epic:WEB-1 order:due-desc login';
    const filters = { ...ticketFilterSchema.parse({}), ...ok(text) };
    const written = formatTicketQuery(filters, context);
    expect(written).toBe(text);
    expect(ok(written)).toEqual(ok(text));
  });

  it('is empty for no filters', () => {
    expect(formatTicketQuery(ticketFilterSchema.parse({}), context)).toBe('');
  });
});

describe('suggestQuery', () => {
  it('offers filter names for a bare word', () => {
    const result = suggestQuery('login st', 8, context);
    expect(result).toMatchObject({ from: 6, to: 8 });
    expect(result.items.map((item) => item.label)).toEqual(['status:']);
  });

  it('offers values, quoted when needed, after the last comma', () => {
    expect(suggestQuery('status:in', 9, context).items[0]).toMatchObject({
      label: 'In the Forge',
      insert: 'status:"In the Forge"',
    });
    expect(suggestQuery('label:bug,u', 11, context).items.map((item) => item.insert)).toEqual([
      'label:bug,ui',
    ]);
    expect(suggestQuery('assignee:', 9, context).items.map((item) => item.label)).toEqual([
      'me',
      'none',
      'adam@acme.test',
      'ada@acme.test',
    ]);
  });
});

describe('closest', () => {
  it('only suggests near misses', () => {
    expect(closest('prority', ['priority', 'project'])).toBe('priority');
    expect(closest('zzz', ['priority'])).toBeNull();
  });
});

describe('date filters', () => {
  it('are kept as written and resolved against now', () => {
    const parsed = parseTicketFilters({ updatedFrom: '-7d', createdBefore: '2026-10-01' });
    expect(parsed.ok).toBe(true);
    const now = new Date('2026-11-01T12:00:00Z');
    expect(resolveDateSpec('-7d', now).toISOString()).toBe('2026-10-25T12:00:00.000Z');
    expect(resolveDateSpec('-2w', now).toISOString()).toBe('2026-10-18T12:00:00.000Z');
    expect(resolveDateSpec('2026-10-01', now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(parseTicketFilters({ updatedFrom: 'yesterday' }).ok).toBe(false);
  });
});

describe('applyTicketQuery', () => {
  it('changes only what the query names, and the search words', () => {
    const before = { ...ticketFilterSchema.parse({}), project: ['WEB'], q: 'old', page: 3 };
    const parsed = parseTicketQuery('assignee:me order:updated login', context);
    if (!parsed.ok) throw new Error('expected a query');
    expect(applyTicketQuery({ ...before, sort: 'due', dir: 'asc' }, parsed)).toMatchObject({
      project: ['WEB'],
      assignee: ['me'],
      q: 'login',
      sort: 'updated',
      dir: 'desc',
      page: 1,
    });
  });
});

describe('suggestQuery by key', () => {
  it('finds a value by its key as well as its name', () => {
    const themed = { ...context, priorities: [{ key: 'high', name: 'Blaze' }] };
    expect(suggestQuery('priority:hig', 12, themed).items).toEqual([
      { label: 'Blaze', insert: 'priority:Blaze', detail: 'high' },
    ]);
  });
});
