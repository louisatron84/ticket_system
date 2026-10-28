import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIORITIES,
  allowedMovesSentence,
  DEFAULT_STATUS_TEMPLATE,
  DEFAULT_TICKET_TYPES,
  LABEL_COLORS,
  STATUS_CATEGORIES,
  bulkTicketBodySchema,
  commentBodySchema,
  createComponentBodySchema,
  createLabelBodySchema,
  createProjectBodySchema,
  createTicketBodySchema,
  formatEstimate,
  formatTicketKey,
  hasControlCharacter,
  linkLabel,
  storedLink,
  normalizeProjectKey,
  parseTicketKey,
  ticketSummarySchema,
  updateProjectBodySchema,
  updateTicketBodySchema,
} from './tickets';

const uuid = '01a1656b-1a49-7146-94ac-1c72df43ddb4';
const validTicket = { title: 'Fix the login redirect', typeId: uuid, priorityId: uuid };

describe('ticket keys', () => {
  it.each([
    ['WEB-12', { projectKey: 'WEB', number: 12 }],
    ['web-12', { projectKey: 'WEB', number: 12 }],
    ['A1-1', { projectKey: 'A1', number: 1 }],
    ['ABCDEFGHIJ-999999999', { projectKey: 'ABCDEFGHIJ', number: 999999999 }],
  ])('parses %s', (input, expected) => {
    expect(parseTicketKey(input)).toEqual(expected);
  });

  it.each([
    'WEB-0',
    'WEB-012',
    'WEB-',
    '-12',
    'WEB',
    'WEB-1234567890',
    'WEB-1.5',
    'WEB-+5',
    'W-1-2',
    'WEB 12',
    ' WEB-12',
    'WEB-12 ',
    '../x',
    '',
    'A-1',
    'ABCDEFGHIJK-1',
    '1WEB-1',
    'WEB-１２',
    'x'.repeat(5000),
  ])('rejects %j', (input) => {
    expect(parseTicketKey(input)).toBeNull();
  });

  it('formats a key', () => {
    expect(formatTicketKey('WEB', 7)).toBe('WEB-7');
  });
});

describe('formatEstimate', () => {
  it.each([
    [0, '0m'],
    [45, '45m'],
    [60, '1h'],
    [90, '1h 30m'],
    [150, '2h 30m'],
    [1440, '24h'],
    [99_999, '1666h 39m'],
  ])('formats %i minutes as %s', (minutes, expected) => {
    expect(formatEstimate(minutes)).toBe(expected);
  });

  it('formats no estimate as null', () => {
    expect(formatEstimate(null)).toBeNull();
  });
});

describe('normalizeProjectKey', () => {
  it.each([
    ['WEB', 'WEB'],
    ['web', 'WEB'],
    ['Web2', 'WEB2'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizeProjectKey(input)).toBe(expected);
  });

  it.each(['WEB-1', '', 'W', 'ABCDEFGHIJK', '1AB', 'we b', '..', 'ßs', 'ÅB', 'WEB\u0000'])(
    'rejects %j, including letters that would only become valid after upper-casing',
    (input) => {
      expect(normalizeProjectKey(input)).toBeNull();
    },
  );
});

describe('default templates', () => {
  const { statuses, transitions } = DEFAULT_STATUS_TEMPLATE;
  const keys = statuses.map((status) => status.key);

  it('has exactly one initial status, and it is not started', () => {
    const initial = statuses.filter((status) => status.initial);
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({ key: 'backlog', category: 'not_started' });
  });

  it('uses only the three categories and unique keys', () => {
    for (const status of statuses) expect(STATUS_CATEGORIES).toContain(status.category);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      'backlog',
      'open',
      'in_progress',
      'in_review',
      'blocked',
      'done',
      'cancelled',
    ]);
  });

  it('names the statuses after the heat of the work', () => {
    expect(statuses.map((status) => [status.key, status.name])).toEqual([
      ['backlog', 'Cold Steel'],
      ['open', 'Warming'],
      ['in_progress', 'In the Forge'],
      ['in_review', 'Tempering'],
      ['blocked', 'Jammed'],
      ['done', 'Quenched'],
      ['cancelled', 'Scrapped'],
    ]);
    // Only the words changed: the workflow itself is exactly what it was.
    expect(transitions).toHaveLength(21);
  });

  it('only connects statuses that exist, never to themselves, with no duplicates', () => {
    const seen = new Set<string>();
    for (const [from, to] of transitions) {
      expect(keys).toContain(from);
      expect(keys).toContain(to);
      expect(from).not.toBe(to);
      expect(seen.has(`${from}>${to}`)).toBe(false);
      seen.add(`${from}>${to}`);
    }
  });

  it('lets a ticket reach every status from the initial one', () => {
    const reached = new Set(['backlog']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [from, to] of transitions) {
        if (reached.has(from) && !reached.has(to)) {
          reached.add(to);
          grew = true;
        }
      }
    }
    expect([...reached].sort()).toEqual([...keys].sort());
  });

  it('lets finished work be reopened', () => {
    expect(transitions).toContainEqual(['done', 'open']);
    expect(transitions).toContainEqual(['cancelled', 'open']);
  });

  it('ships seven ticket types and five ranked priorities', () => {
    expect(DEFAULT_TICKET_TYPES.map((type) => type.key)).toEqual([
      'task',
      'bug',
      'feature',
      'improvement',
      'epic',
      'documentation',
      'support',
    ]);
    expect(DEFAULT_PRIORITIES.map((priority) => [priority.key, priority.rank])).toEqual([
      ['lowest', 1],
      ['low', 2],
      ['normal', 3],
      ['high', 4],
      ['critical', 5],
    ]);
  });

  it('offers eight label colours', () => {
    expect(LABEL_COLORS).toHaveLength(8);
  });
});

describe('createProjectBodySchema', () => {
  it('accepts a normal project', () => {
    expect(
      createProjectBodySchema.safeParse({ key: 'WEB', name: 'Web App', description: 'The site' })
        .success,
    ).toBe(true);
  });

  it.each(['a1', 'A', 'ABCDEFGHIJK', '1AB', 'AB-C', 'AB C', 'ab', 'ÅB', ''])(
    'rejects the key %j',
    (key) => {
      expect(createProjectBodySchema.safeParse({ key, name: 'X' }).success).toBe(false);
    },
  );

  it('rejects blank and over-long names, and unknown fields', () => {
    expect(createProjectBodySchema.safeParse({ key: 'WEB', name: '   ' }).success).toBe(false);
    expect(createProjectBodySchema.safeParse({ key: 'WEB', name: 'x'.repeat(81) }).success).toBe(
      false,
    );
    expect(
      createProjectBodySchema.safeParse({ key: 'WEB', name: 'X', nextTicketNumber: 500 }).success,
    ).toBe(false);
  });
});

describe('updateProjectBodySchema', () => {
  it('needs at least one change and cannot change the key', () => {
    expect(updateProjectBodySchema.safeParse({}).success).toBe(false);
    expect(updateProjectBodySchema.safeParse({ key: 'NEW' }).success).toBe(false);
    expect(updateProjectBodySchema.safeParse({ archived: true }).success).toBe(true);
  });
});

describe('createTicketBodySchema', () => {
  it('accepts the smallest valid ticket', () => {
    expect(createTicketBodySchema.safeParse(validTicket).success).toBe(true);
    expect(createTicketBodySchema.safeParse({ ...validTicket, statusId: uuid }).success).toBe(true);
    expect(createTicketBodySchema.safeParse({ ...validTicket, statusId: 'open' }).success).toBe(
      false,
    );
  });

  it('accepts the largest valid ticket', () => {
    const parsed = createTicketBodySchema.safeParse({
      title: 'x'.repeat(200),
      description: 'y'.repeat(20_000),
      typeId: uuid,
      priorityId: uuid,
      assigneeId: uuid,
      componentId: uuid,
      labelIds: Array.from({ length: 20 }, () => uuid),
      dueDate: '2028-02-29',
      estimateMinutes: 99_999,
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['a blank title', { title: '   ' }],
    ['a 201-character title', { title: 'x'.repeat(201) }],
    ['a title with a line break', { title: 'one\ntwo' }],
    ['a title containing NUL', { title: 'a\u0000b' }],
    ['a 20,001-character description', { description: 'y'.repeat(20_001) }],
    ['a description containing NUL', { description: 'a\u0000b' }],
    ['a non-uuid type', { typeId: 'task' }],
    ['21 labels', { labelIds: Array.from({ length: 21 }, () => uuid) }],
    ['an impossible month', { dueDate: '2026-13-40' }],
    ['a date that does not exist', { dueDate: '2026-02-30' }],
    ['a non-leap 29 February', { dueDate: '2027-02-29' }],
    ['a date with a time', { dueDate: '2026-10-23T10:00:00Z' }],
    ['a negative estimate', { estimateMinutes: -1 }],
    ['a fractional estimate', { estimateMinutes: 1.5 }],
    ['an absurd estimate', { estimateMinutes: 100_000 }],
    ['a smuggled key', { key: 'WEB-1' }],
    ['a smuggled reporter', { reporterId: uuid }],
    ['a smuggled project', { projectId: uuid }],
    ['a smuggled organisation', { organisationId: uuid }],
  ])('rejects %s', (_label, change) => {
    expect(createTicketBodySchema.safeParse({ ...validTicket, ...change }).success).toBe(false);
  });

  it('allows tabs and line breaks in the description, and emoji or right-to-left text anywhere', () => {
    const parsed = createTicketBodySchema.safeParse({
      ...validTicket,
      title: 'مرحبا 👋 العالم',
      description: 'line one\r\n\tline two',
    });
    expect(parsed.success).toBe(true);
  });

  it('trims the title', () => {
    expect(createTicketBodySchema.parse({ ...validTicket, title: '  Hello  ' }).title).toBe(
      'Hello',
    );
  });
});

describe('updateTicketBodySchema', () => {
  it('needs a version and at least one change', () => {
    expect(updateTicketBodySchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateTicketBodySchema.safeParse({ title: 'New' }).success).toBe(false);
    expect(updateTicketBodySchema.safeParse({ version: 0, title: 'New' }).success).toBe(false);
    expect(updateTicketBodySchema.safeParse({ version: 1.5, title: 'New' }).success).toBe(false);
    expect(updateTicketBodySchema.safeParse({ version: 3, title: 'New' }).success).toBe(true);
  });

  it('can clear optional fields with null, and change status', () => {
    const parsed = updateTicketBodySchema.safeParse({
      version: 2,
      assigneeId: null,
      dueDate: null,
      componentId: null,
      estimateMinutes: null,
      statusId: uuid,
    });
    expect(parsed.success).toBe(true);
  });

  it.each(['key', 'reporterId', 'number', 'projectId', 'organisationId', 'completedAt', 'id'])(
    'rejects a smuggled %s',
    (field) => {
      expect(
        updateTicketBodySchema.safeParse({ version: 1, title: 'x', [field]: 'anything' }).success,
      ).toBe(false);
    },
  );
});

describe('bulkTicketBodySchema', () => {
  const other = '01a1656b-1a49-7146-94ac-1c72df43ddb5';
  const keys = ['LST-1', 'LST-2'];

  it('needs one to a hundred distinct keys and at least one change', () => {
    const changes = { archived: true };
    expect(bulkTicketBodySchema.safeParse({ keys, changes }).success).toBe(true);
    expect(bulkTicketBodySchema.safeParse({ keys: [], changes }).success).toBe(false);
    expect(bulkTicketBodySchema.safeParse({ keys: ['LST-1', 'LST-1'], changes }).success).toBe(
      false,
    );
    const many = (n: number) => Array.from({ length: n }, (_, i) => `LST-${i + 1}`);
    expect(bulkTicketBodySchema.safeParse({ keys: many(100), changes }).success).toBe(true);
    expect(bulkTicketBodySchema.safeParse({ keys: many(101), changes }).success).toBe(false);
    expect(bulkTicketBodySchema.safeParse({ keys, changes: {} }).success).toBe(false);
  });

  it('accepts each kind of change, clearing with null, and nothing else', () => {
    const changes = {
      statusKey: 'in_progress',
      priorityId: uuid,
      assigneeId: null,
      addLabelIds: [uuid],
      removeLabelIds: [other],
      dueDate: null,
      archived: false,
    };
    expect(bulkTicketBodySchema.safeParse({ keys, changes }).success).toBe(true);
    // The same label cannot be both added and removed.
    const both = bulkTicketBodySchema.safeParse({
      keys,
      changes: { addLabelIds: [uuid, other], removeLabelIds: [other] },
    });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]?.path).toEqual(['changes', 'removeLabelIds']);
    for (const smuggled of [{ title: 'x' }, { statusId: uuid }, { version: 1 }]) {
      expect(
        bulkTicketBodySchema.safeParse({ keys, changes: { archived: true, ...smuggled } }).success,
      ).toBe(false);
    }
    expect(
      bulkTicketBodySchema.safeParse({ keys, changes: { statusKey: 'Not A Key' } }).success,
    ).toBe(false);
    expect(
      bulkTicketBodySchema.safeParse({
        keys,
        changes: { addLabelIds: Array.from({ length: 21 }, () => uuid) },
      }).success,
    ).toBe(false);
  });
});

describe('commentBodySchema and createLabelBodySchema', () => {
  it('bounds comments', () => {
    expect(commentBodySchema.safeParse({ body: 'ok' }).success).toBe(true);
    expect(commentBodySchema.safeParse({ body: '  ' }).success).toBe(false);
    expect(commentBodySchema.safeParse({ body: 'x'.repeat(10_001) }).success).toBe(false);
    expect(commentBodySchema.safeParse({ body: 'a\u0000b' }).success).toBe(false);
  });

  it('keeps label colours to the list and names short', () => {
    expect(createLabelBodySchema.safeParse({ name: 'bug', color: 'red' }).success).toBe(true);
    expect(createLabelBodySchema.safeParse({ name: 'bug', color: 'hotpink' }).success).toBe(false);
    expect(createLabelBodySchema.safeParse({ name: 'x'.repeat(41), color: 'red' }).success).toBe(
      false,
    );
    expect(createLabelBodySchema.safeParse({ name: ' ', color: 'red' }).success).toBe(false);
  });
});

describe('control characters', () => {
  const at = (code: number) => `a${String.fromCharCode(code)}b`;

  it.each([0x00, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x1f, 0x7f])(
    'finds 0x%s in text',
    (code) => {
      expect(hasControlCharacter(at(code))).toBe(true);
    },
  );

  it.each([0x20, 0x7e, 0x80, 0xa0, 0x2028])('leaves 0x%s alone', (code) => {
    expect(hasControlCharacter(at(code))).toBe(false);
  });

  it('lets the caller allow some, and only those', () => {
    expect(hasControlCharacter(at(0x09), [0x09])).toBe(false);
    expect(hasControlCharacter(at(0x0b), [0x09])).toBe(true);
    expect(hasControlCharacter(`${at(0x09)}${at(0x00)}`, [0x09])).toBe(true);
  });

  it('accepts emoji, Arabic and CJK, which are not control characters', () => {
    expect(hasControlCharacter('مرحبا 👋 世界 — naïve café')).toBe(false);
  });

  it('keeps tabs and line breaks in descriptions and comments but not in titles', () => {
    const text = 'line one\r\n\tline two';
    expect(createTicketBodySchema.safeParse({ ...validTicket, description: text }).success).toBe(
      true,
    );
    expect(commentBodySchema.safeParse({ body: text }).success).toBe(true);
    expect(createTicketBodySchema.safeParse({ ...validTicket, title: text }).success).toBe(false);
  });

  it.each([0x0b, 0x0c, 0x7f])('still refuses 0x%s in descriptions and comments', (code) => {
    expect(
      createTicketBodySchema.safeParse({ ...validTicket, description: at(code) }).success,
    ).toBe(false);
    expect(commentBodySchema.safeParse({ body: at(code) }).success).toBe(false);
  });
});

describe('createComponentBodySchema', () => {
  it('takes a trimmed one-line name', () => {
    expect(createComponentBodySchema.parse({ name: '  Frontend  ' })).toEqual({ name: 'Frontend' });
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a blank name', { name: '   ' }],
    ['a missing name', {}],
    ['a 61-character name', { name: 'a'.repeat(61) }],
    ['a name with a line break', { name: 'Front\nend' }],
    ['a name with NUL', { name: 'a\u0000b' }],
    ['a project id the client should not choose', { name: 'Frontend', projectId: uuid }],
    ['an organisation id the client should not choose', { name: 'Frontend', organisationId: uuid }],
  ])('refuses %s', (_label, body) => {
    expect(createComponentBodySchema.safeParse(body).success).toBe(false);
  });

  it('accepts 60 characters, markup and non-Latin text as plain text', () => {
    expect(createComponentBodySchema.safeParse({ name: 'a'.repeat(60) }).success).toBe(true);
    expect(createComponentBodySchema.parse({ name: '<b>مرحبا 👋</b>' }).name).toBe(
      '<b>مرحبا 👋</b>',
    );
  });
});

describe('ticket summary', () => {
  const summary = {
    id: uuid,
    key: 'WEB-3',
    title: 'Checkout page is slow on mobile',
    project: { id: uuid, key: 'WEB', name: 'Web App' },
    type: { id: uuid, key: 'bug', name: 'Bug' },
    status: { id: uuid, key: 'in_review', name: 'Tempering', category: 'in_progress' },
    priority: { id: uuid, key: 'high', name: 'Blaze', rank: 4 },
    assignee: null,
    labels: [],
    dueDate: null,
    version: 1,
    commentCount: 2,
    createdAt: '2026-10-13T09:00:00.000Z',
    updatedAt: '2026-10-14T09:00:00.000Z',
    parentKey: null,
    progress: null,
    openBlockerKeys: [],
    criteria: { done: 0, total: 0 },
  };

  it('carries a comment count', () => {
    expect(ticketSummarySchema.parse(summary).commentCount).toBe(2);
  });

  it('refuses a summary without a comment count, or with a negative or fractional one', () => {
    const { commentCount: _omitted, ...without } = summary;
    expect(ticketSummarySchema.safeParse(without).success).toBe(false);
    expect(ticketSummarySchema.safeParse({ ...summary, commentCount: -1 }).success).toBe(false);
    expect(ticketSummarySchema.safeParse({ ...summary, commentCount: 1.5 }).success).toBe(false);
  });
});

describe('linkLabel', () => {
  it.each([
    ['blocks', 'outward', 'Blocks'],
    ['blocks', 'inward', 'Blocked by'],
    ['duplicates', 'outward', 'Duplicates'],
    ['duplicates', 'inward', 'Duplicated by'],
    ['relates_to', 'outward', 'Relates to'],
    ['relates_to', 'inward', 'Relates to'],
  ] as const)('%s seen %s reads "%s"', (kind, direction, label) => {
    expect(linkLabel(kind, direction)).toBe(label);
  });

  it('turns what a person picks into the stored kind and direction', () => {
    expect(storedLink('blocks')).toEqual({ kind: 'blocks', direction: 'outward' });
    expect(storedLink('blocked_by')).toEqual({ kind: 'blocks', direction: 'inward' });
    expect(storedLink('relates_to')).toEqual({ kind: 'relates_to', direction: 'outward' });
    expect(storedLink('duplicates')).toEqual({ kind: 'duplicates', direction: 'outward' });
    expect(storedLink('duplicated_by')).toEqual({ kind: 'duplicates', direction: 'inward' });
  });
});

describe('allowedMovesSentence', () => {
  it('lists where a ticket can go, in plain words', () => {
    expect(allowedMovesSentence('Tempering', ['In the Forge', 'Quenched', 'Scrapped'])).toBe(
      'From Tempering it can go to In the Forge, Quenched or Scrapped.',
    );
    expect(allowedMovesSentence('Warming', ['Jammed'])).toBe('From Warming it can go to Jammed.');
    expect(allowedMovesSentence('Quenched', [])).toBe('From Quenched it cannot move anywhere.');
  });
});
