import { describe, expect, it } from 'vitest';
import { preferencesSchema } from './api';
import {
  BOARD_DENSITIES,
  BOARD_LANES,
  BOARD_SHOWS,
  CARD_FIELD_KEYS,
  DEFAULT_BOARD_DISPLAY,
  DEFAULT_CARD_FIELDS,
  DEFAULT_HIDDEN_STATUS_KEYS,
  applyDisplayChange,
  boardColumnPrefsSchema,
  boardDisplaySchema,
  resolveBoardDisplay,
  undoOf,
} from './board-display';

describe('card fields', () => {
  it('names the six things a card can show or hide', () => {
    expect([...CARD_FIELD_KEYS]).toEqual([
      'labels',
      'dueDate',
      'priority',
      'comments',
      'criteria',
      'type',
    ]);
  });

  it('shows everything by default except the type', () => {
    expect(DEFAULT_CARD_FIELDS).toEqual({
      labels: true,
      dueDate: true,
      priority: true,
      comments: true,
      criteria: true,
      type: false,
    });
  });
});

describe('board display', () => {
  it('has comfortable density and heat on by default', () => {
    expect([...BOARD_DENSITIES]).toEqual(['comfortable', 'compact']);
    expect(DEFAULT_BOARD_DISPLAY).toEqual({
      fields: DEFAULT_CARD_FIELDS,
      density: 'comfortable',
      heat: true,
      show: 'all',
      lanes: 'none',
    });
  });

  it('shows every ticket in no lanes by default, and remembers top-level-only and project lanes', () => {
    expect([...BOARD_SHOWS]).toEqual(['all', 'top']);
    expect([...BOARD_LANES]).toEqual(['none', 'project']);
    const saved = boardDisplaySchema.parse({ show: 'top', lanes: 'project' });
    expect(resolveBoardDisplay(saved)).toMatchObject({ show: 'top', lanes: 'project' });
    expect(boardDisplaySchema.safeParse({ show: 'children' }).success).toBe(false);
    expect(boardDisplaySchema.safeParse({ lanes: 'epic' }).success).toBe(false);
  });

  it('undoes a change to what is shown or to the lanes', () => {
    const before = resolveBoardDisplay({});
    const after = applyDisplayChange(before, { show: 'top', lanes: 'project' });
    expect(after).toMatchObject({ show: 'top', lanes: 'project', heat: true });
    expect(applyDisplayChange(after, undoOf(before, { show: 'top', lanes: 'project' }))).toEqual(
      before,
    );
  });

  it('accepts a partial display', () => {
    expect(boardDisplaySchema.parse({})).toEqual({});
    expect(boardDisplaySchema.parse({ heat: false })).toEqual({ heat: false });
    expect(boardDisplaySchema.parse({ fields: { labels: false }, density: 'compact' })).toEqual({
      fields: { labels: false },
      density: 'compact',
    });
  });

  it.each([
    ['an unknown key', { colour: 'red' }],
    ['an unknown card field', { fields: { assignee: false } }],
    ['a field that is not a boolean', { fields: { labels: 'no' } }],
    ['an unknown density', { density: 'huge' }],
    ['heat that is not a boolean', { heat: 'yes' }],
    ['null', null],
  ])('refuses %s', (_name, value) => {
    expect(boardDisplaySchema.safeParse(value).success).toBe(false);
  });

  it('resolves saved values over the defaults, field by field', () => {
    expect(resolveBoardDisplay(undefined)).toEqual(DEFAULT_BOARD_DISPLAY);
    expect(resolveBoardDisplay({ fields: { labels: false } })).toEqual({
      ...DEFAULT_BOARD_DISPLAY,
      fields: { ...DEFAULT_CARD_FIELDS, labels: false },
    });
    expect(resolveBoardDisplay({ density: 'compact', heat: false })).toEqual({
      ...DEFAULT_BOARD_DISPLAY,
      density: 'compact',
      heat: false,
    });
  });

  it('applies a change without touching anything else', () => {
    const current = resolveBoardDisplay({ density: 'compact', fields: { type: true } });
    const next = applyDisplayChange(current, { fields: { labels: false } });
    expect(next).toEqual({
      ...current,
      fields: { ...current.fields, labels: false },
    });
    expect(next.fields.type).toBe(true);
    expect(next.density).toBe('compact');
    // The input is never modified.
    expect(current.fields.labels).toBe(true);
  });
});

describe('preferences', () => {
  it('accept a board display next to the sidebar setting', () => {
    expect(preferencesSchema.parse({ sidebarCollapsed: true, board: { heat: false } })).toEqual({
      sidebarCollapsed: true,
      board: { heat: false },
    });
  });

  it('refuse a bad board display', () => {
    expect(preferencesSchema.safeParse({ board: { density: 'huge' } }).success).toBe(false);
  });
});

describe('undoing a change', () => {
  it('restores exactly the parts the change touched', () => {
    const before = resolveBoardDisplay({ density: 'compact', fields: { type: true } });
    const change = { fields: { labels: false }, heat: false };
    const after = applyDisplayChange(before, change);

    expect(undoOf(before, change)).toEqual({ fields: { labels: true }, heat: true });
    expect(applyDisplayChange(after, undoOf(before, change))).toEqual(before);
  });

  it('does not undo a later change to something else', () => {
    const before = DEFAULT_BOARD_DISPLAY;
    const first = { heat: false };
    const later = applyDisplayChange(applyDisplayChange(before, first), { density: 'compact' });

    expect(applyDisplayChange(later, undoOf(before, first))).toEqual({
      ...before,
      density: 'compact',
    });
  });

  it('is empty for an empty change', () => {
    expect(undoOf(DEFAULT_BOARD_DISPLAY, {})).toEqual({});
  });
});

const statusKeys = (count: number) => Array.from({ length: count }, (_, i) => `status_${i}`);

describe('column preferences', () => {
  it('hide Scrapped by default', () => {
    expect([...DEFAULT_HIDDEN_STATUS_KEYS]).toEqual(['cancelled']);
  });

  it('accept a list of hidden statuses and an order', () => {
    const entry = { hidden: ['cancelled'], order: ['backlog', 'open', 'in_progress'] };
    expect(boardColumnPrefsSchema.parse(entry)).toEqual(entry);
    expect(boardColumnPrefsSchema.parse({ hidden: [], order: [] })).toEqual({
      hidden: [],
      order: [],
    });
  });

  it.each([
    ['more than 20 hidden statuses', { hidden: statusKeys(21), order: [] }],
    ['more than 20 ordered statuses', { hidden: [], order: statusKeys(21) }],
    ['a status key with capitals', { hidden: ['Cancelled'], order: [] }],
    ['an unknown field', { hidden: [], order: [], pinned: [] }],
    ['a missing list', { hidden: [] }],
  ])('refuse %s', (_name, value) => {
    expect(boardColumnPrefsSchema.safeParse(value).success).toBe(false);
  });

  it('are remembered per project in the preferences, and null forgets a project', () => {
    const parsed = preferencesSchema.parse({
      boardColumns: { WEB: { hidden: [], order: ['open'] }, OPS: null },
    });
    expect(parsed.boardColumns).toEqual({ WEB: { hidden: [], order: ['open'] }, OPS: null });
  });

  it.each([
    ['a lower-case project key', { web: { hidden: [], order: [] } }],
    ['a project key that is too long', { ABCDEFGHIJK: { hidden: [], order: [] } }],
  ])('refuse %s as a key', (_name, boardColumns) => {
    expect(preferencesSchema.safeParse({ boardColumns }).success).toBe(false);
  });

  it('keep a separate choice for the Tickets board, which null resets', () => {
    const choice = { hidden: ['done'], order: [] };
    expect(preferencesSchema.parse({ ticketsBoardColumns: choice }).ticketsBoardColumns).toEqual(
      choice,
    );
    expect(preferencesSchema.parse({ ticketsBoardColumns: null }).ticketsBoardColumns).toBeNull();
  });

  it.each([
    ['a bad status key', { hidden: ['Bad Key'], order: [] }],
    ['an unknown setting', { hidden: [], order: [], extra: true }],
  ])('refuse %s on the Tickets board', (_name, ticketsBoardColumns) => {
    expect(preferencesSchema.safeParse({ ticketsBoardColumns }).success).toBe(false);
  });

  it('refuse more than 100 projects', () => {
    const many = Object.fromEntries(
      Array.from({ length: 101 }, (_, i) => [`K${i}`, { hidden: [], order: [] }]),
    );
    expect(preferencesSchema.safeParse({ boardColumns: many }).success).toBe(false);
    const fine = Object.fromEntries(Object.entries(many).slice(0, 100));
    expect(preferencesSchema.safeParse({ boardColumns: fine }).success).toBe(true);
  });
});
