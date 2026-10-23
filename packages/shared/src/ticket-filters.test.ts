import { describe, expect, it } from 'vitest';
import {
  parseTicketFilters,
  saveViewBodySchema,
  ticketFiltersToSearchParams,
  updateViewBodySchema,
  viewDefinitionSchema,
  type TicketFilters,
} from './ticket-filters';

const uuid = '01a1656b-1a49-7146-94ac-1c72df43ddb4';

function parsed(input: Record<string, string | string[] | undefined>): TicketFilters {
  const result = parseTicketFilters(input);
  if (!result.ok) throw new Error(`unexpected issues: ${result.issues.join('; ')}`);
  return result.filters;
}

describe('parseTicketFilters: defaults', () => {
  it('returns sensible defaults for no input', () => {
    expect(parsed({})).toEqual({
      q: '',
      project: [],
      statusKey: [],
      statusCategory: [],
      type: [],
      priority: [],
      assignee: [],
      reporter: [],
      label: [],
      due: undefined,
      archived: false,
      sort: 'updated',
      dir: 'desc',
      page: 1,
      pageSize: 50,
    });
  });

  it('ignores parameters it does not know', () => {
    expect(parsed({ utm_source: 'mail', foo: ['a', 'b'] })).toEqual(parsed({}));
  });
});

describe('parseTicketFilters: reading values', () => {
  it('turns repeated parameters into arrays, and a single one into a one-item array', () => {
    expect(parsed({ statusKey: ['open', 'in_progress'] }).statusKey).toEqual([
      'open',
      'in_progress',
    ]);
    expect(parsed({ statusKey: 'open' }).statusKey).toEqual(['open']);
  });

  it('upper-cases project keys', () => {
    expect(parsed({ project: 'web' }).project).toEqual(['WEB']);
  });

  it('understands me and none for people, and uuids', () => {
    expect(parsed({ assignee: ['me', 'none', uuid] }).assignee).toEqual(['me', 'none', uuid]);
    expect(parsed({ reporter: 'me' }).reporter).toEqual(['me']);
  });

  it('reads numbers, booleans, enums and the due filter', () => {
    const filters = parsed({
      page: '3',
      pageSize: '25',
      sort: 'priority',
      dir: 'asc',
      archived: 'true',
      due: 'overdue',
      statusCategory: 'in_progress',
    });
    expect(filters).toMatchObject({
      page: 3,
      pageSize: 25,
      sort: 'priority',
      dir: 'asc',
      archived: true,
      due: 'overdue',
      statusCategory: ['in_progress'],
    });
  });

  it('keeps a hostile search term verbatim, because it is only ever a bound parameter', () => {
    expect(parsed({ q: "'; DROP TABLE tickets;--" }).q).toBe("'; DROP TABLE tickets;--");
    expect(parsed({ q: '%_\\' }).q).toBe('%_\\');
  });

  it('trims the search term', () => {
    expect(parsed({ q: '  login  ' }).q).toBe('login');
  });
});

describe('parseTicketFilters: refusing bad input', () => {
  it.each([
    ['pageSize=101', { pageSize: '101' }],
    ['pageSize=0', { pageSize: '0' }],
    ['pageSize=100000', { pageSize: '100000' }],
    ['page=0', { page: '0' }],
    ['page=-1', { page: '-1' }],
    ['page=abc', { page: 'abc' }],
    ['page=1.5', { page: '1.5' }],
    ['page=10001', { page: '10001' }],
    ['sort=password', { sort: 'password' }],
    ['dir=sideways', { dir: 'sideways' }],
    ['due=yesterday', { due: 'yesterday' }],
    ['archived=maybe', { archived: 'maybe' }],
    ['assignee=not-a-uuid', { assignee: 'not-a-uuid' }],
    ['reporter=none', { reporter: 'none' }],
    ['a status key with spaces', { statusKey: 'in progress' }],
    ['a status key with SQL', { statusKey: "x'; --" }],
    ['21 labels', { label: Array.from({ length: 21 }, (_, i) => `l${i}`) }],
    ['500 repeated parameters', { priority: Array.from({ length: 500 }, () => 'high') }],
    ['a 101-character q', { q: 'x'.repeat(101) }],
    ['NUL in q', { q: 'a\u0000b' }],
    ['a control character in a label', { label: 'a\u0007b' }],
    ['two pageSize values', { pageSize: ['10', '20'] }],
    ['two sort values', { sort: ['updated', 'created'] }],
  ])('refuses %s with a readable issue', (_label, input) => {
    const result = parseTicketFilters(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      for (const issue of result.issues) expect(issue.length).toBeLessThan(200);
    }
  });
});

describe('ticketFiltersToSearchParams', () => {
  it('omits everything that is a default', () => {
    expect(ticketFiltersToSearchParams(parsed({})).toString()).toBe('');
  });

  it('round-trips a fully loaded filter set', () => {
    const filters = parsed({
      q: 'login & logout',
      project: ['WEB', 'API'],
      statusKey: ['open', 'blocked'],
      statusCategory: ['not_started'],
      type: ['bug'],
      priority: ['high', 'critical'],
      assignee: ['me', uuid],
      reporter: [uuid],
      label: ['front end', 'bug'],
      due: 'week',
      archived: 'true',
      sort: 'due',
      dir: 'asc',
      page: '4',
      pageSize: '20',
    });
    const params = ticketFiltersToSearchParams(filters);
    const again = parseTicketFilters(
      Object.fromEntries(
        [...new Set(params.keys())].map((key) => {
          const values = params.getAll(key);
          return [key, values.length === 1 ? values[0] : values];
        }),
      ),
    );
    expect(again).toEqual({ ok: true, filters });
  });

  it('writes repeated parameters for arrays and encodes awkward characters', () => {
    const params = ticketFiltersToSearchParams(parsed({ label: ['a&b', 'c d'], q: 'x=y' }));
    expect(params.getAll('label')).toEqual(['a&b', 'c d']);
    expect(params.get('q')).toBe('x=y');
    expect(params.toString()).not.toContain(' ');
  });
});

describe('viewDefinitionSchema', () => {
  it('fills in the defaults, so a stored view is always complete', () => {
    const definition = viewDefinitionSchema.parse({ filters: {}, display: 'board' });
    expect(definition.display).toBe('board');
    expect(definition.filters).toMatchObject({
      q: '',
      project: [],
      archived: false,
      sort: 'updated',
      dir: 'desc',
      pageSize: 50,
    });
    expect(definition.filters).not.toHaveProperty('page');
  });

  it('keeps what was chosen', () => {
    const definition = viewDefinitionSchema.parse({
      filters: { project: ['web'], assignee: ['me'], label: ['bug'], sort: 'due', dir: 'asc' },
      display: 'list',
    });
    expect(definition.filters).toMatchObject({
      project: ['WEB'],
      assignee: ['me'],
      label: ['bug'],
      sort: 'due',
      dir: 'asc',
    });
  });

  it.each([
    [
      'a page number, which belongs to the moment, not the view',
      { filters: { page: 2 }, display: 'list' },
    ],
    ['an unknown filter', { filters: { colour: 'red' }, display: 'list' }],
    ['an unknown sort', { filters: { sort: 'password' }, display: 'list' }],
    ['no display', { filters: {} }],
    ['an unknown display', { filters: {}, display: 'calendar' }],
    ['no filters', { display: 'list' }],
    ['an unknown top-level key', { filters: {}, display: 'list', extra: 1 }],
    [
      '21 projects',
      { filters: { project: Array.from({ length: 21 }, () => 'WEB') }, display: 'list' },
    ],
  ])('refuses %s', (_label, input) => {
    expect(viewDefinitionSchema.safeParse(input).success).toBe(false);
  });
});

describe('saveViewBodySchema', () => {
  const definition = { filters: {}, display: 'list' as const };

  it('takes a trimmed name, a scope and a definition', () => {
    expect(
      saveViewBodySchema.parse({ name: '  My open work  ', scope: 'personal', definition }),
    ).toMatchObject({ name: 'My open work', scope: 'personal' });
    expect(
      saveViewBodySchema.safeParse({ name: 'Team', scope: 'shared', definition }).success,
    ).toBe(true);
  });

  it.each([
    ['an empty name', { name: '', scope: 'personal', definition }],
    ['an 81-character name', { name: 'a'.repeat(81), scope: 'personal', definition }],
    ['a name with a line break', { name: 'a\nb', scope: 'personal', definition }],
    ['a name with NUL', { name: 'a\u0000b', scope: 'personal', definition }],
    ['an unknown scope', { name: 'x', scope: 'public', definition }],
    ['no scope', { name: 'x', definition }],
    ['no definition', { name: 'x', scope: 'personal' }],
    ['an owner the client chose', { name: 'x', scope: 'personal', definition, ownerUserId: uuid }],
    [
      'a workspace the client chose',
      { name: 'x', scope: 'personal', definition, organisationId: uuid },
    ],
  ])('refuses %s', (_label, input) => {
    expect(saveViewBodySchema.safeParse(input).success).toBe(false);
  });
});

describe('updateViewBodySchema', () => {
  const definition = { filters: { assignee: ['me'] }, display: 'board' as const };

  it('takes a new name, a new definition, or both', () => {
    expect(updateViewBodySchema.parse({ name: ' Renamed ' })).toEqual({ name: 'Renamed' });
    expect(updateViewBodySchema.parse({ definition }).definition?.display).toBe('board');
    expect(updateViewBodySchema.safeParse({ name: 'Renamed', definition }).success).toBe(true);
  });

  it.each([
    ['nothing to change', {}],
    ['a scope, which cannot change', { scope: 'shared' }],
    ['an owner', { name: 'x', ownerUserId: uuid }],
    ['an empty name', { name: '' }],
    ['a definition with a page in it', { definition: { filters: { page: 3 }, display: 'list' } }],
    ['an unknown key', { name: 'x', colour: 'red' }],
  ])('refuses %s', (_label, input) => {
    expect(updateViewBodySchema.safeParse(input).success).toBe(false);
  });
});
