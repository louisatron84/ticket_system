import { describe, expect, it } from 'vitest';
import { arrangeColumns, moveColumn, prefsFromLayout } from './board-columns';

// A column here is just what the arrangement needs: a status key and its place in the workflow.
const column = (key: string, sortOrder: number) => ({ status: { key, sortOrder } });
const WORKFLOW = [
  column('backlog', 1),
  column('open', 2),
  column('in_progress', 3),
  column('in_review', 4),
  column('blocked', 5),
  column('done', 6),
  column('cancelled', 7),
];
const keys = (columns: { status: { key: string } }[]) => columns.map((c) => c.status.key);

describe('arrangeColumns', () => {
  it('hides Scrapped by default and shows the rest in workflow order', () => {
    const { shown, layout } = arrangeColumns(WORKFLOW, undefined);
    expect(keys(shown)).toEqual(['backlog', 'open', 'in_progress', 'in_review', 'blocked', 'done']);
    expect(layout.map((item) => [item.column.status.key, item.shown])).toEqual([
      ['backlog', true],
      ['open', true],
      ['in_progress', true],
      ['in_review', true],
      ['blocked', true],
      ['done', true],
      ['cancelled', false],
    ]);
  });

  it('follows a saved order and a saved hidden list', () => {
    const { shown } = arrangeColumns(WORKFLOW, {
      hidden: ['backlog', 'cancelled'],
      order: ['done', 'blocked', 'in_review', 'in_progress', 'open', 'backlog', 'cancelled'],
    });
    expect(keys(shown)).toEqual(['done', 'blocked', 'in_review', 'in_progress', 'open']);
  });

  it('a saved empty hidden list shows everything, including Scrapped', () => {
    const { shown } = arrangeColumns(WORKFLOW, { hidden: [], order: [] });
    expect(keys(shown)).toEqual(keys(WORKFLOW));
  });

  it('puts a status the saved order has never seen after the saved ones, in workflow order', () => {
    const withNew = [...WORKFLOW, column('qa', 8), column('staging', 9)];
    const { layout } = arrangeColumns(withNew, {
      hidden: [],
      order: ['done', 'open'],
    });
    expect(keys(layout.map((item) => item.column))).toEqual([
      'done',
      'open',
      'backlog',
      'in_progress',
      'in_review',
      'blocked',
      'cancelled',
      'qa',
      'staging',
    ]);
    // Once a person has made a choice, only what they hid is hidden: the new statuses are shown,
    // and so is Scrapped, because their saved list did not hide it.
    expect(layout.every((item) => item.shown)).toBe(true);
  });

  it('ignores saved keys for statuses the project no longer has', () => {
    const { layout, shown } = arrangeColumns(WORKFLOW, {
      hidden: ['gone', 'cancelled'],
      order: ['ghost', 'done', 'gone', 'open'],
    });
    expect(keys(layout.map((item) => item.column))).toEqual([
      'done',
      'open',
      'backlog',
      'in_progress',
      'in_review',
      'blocked',
      'cancelled',
    ]);
    expect(keys(shown)).not.toContain('cancelled');
    expect(keys(shown)).toHaveLength(6);
  });

  it('shows every status exactly once whatever is saved', () => {
    const messy = {
      hidden: ['open', 'open', 'x', 'done'],
      order: ['done', 'done', 'open', 'zzz', 'backlog', 'open'],
    };
    const { layout } = arrangeColumns(WORKFLOW, messy);
    const all = keys(layout.map((item) => item.column));
    expect(all.sort()).toEqual(keys(WORKFLOW).sort());
    expect(new Set(all).size).toBe(WORKFLOW.length);
  });

  it('copes with a project that has no statuses', () => {
    expect(arrangeColumns([], undefined)).toEqual({ layout: [], shown: [] });
    expect(arrangeColumns([], { hidden: ['a'], order: ['a'] })).toEqual({ layout: [], shown: [] });
  });

  it('does not modify what it is given', () => {
    const saved = { hidden: ['done'], order: ['done', 'open'] };
    const before = JSON.stringify([WORKFLOW, saved]);
    arrangeColumns(WORKFLOW, saved);
    expect(JSON.stringify([WORKFLOW, saved])).toBe(before);
  });
});

describe('prefsFromLayout', () => {
  it('describes what is on screen, and arranging it again gives the same screen', () => {
    const first = arrangeColumns(WORKFLOW, {
      hidden: ['blocked', 'cancelled'],
      order: ['in_progress', 'open'],
    });
    const prefs = prefsFromLayout(first.layout);
    expect(prefs.hidden.sort()).toEqual(['blocked', 'cancelled']);
    expect(prefs.order).toHaveLength(WORKFLOW.length);

    const again = arrangeColumns(WORKFLOW, prefs);
    expect(again.layout.map((item) => [item.column.status.key, item.shown])).toEqual(
      first.layout.map((item) => [item.column.status.key, item.shown]),
    );
  });
});

describe('moveColumn', () => {
  const order = ['a', 'b', 'c'];

  it('moves a key one place up or down', () => {
    expect(moveColumn(order, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveColumn(order, 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('does nothing at either end or for an unknown key', () => {
    expect(moveColumn(order, 'a', -1)).toEqual(order);
    expect(moveColumn(order, 'c', 1)).toEqual(order);
    expect(moveColumn(order, 'zzz', 1)).toEqual(order);
  });

  it('does not modify the list it is given', () => {
    moveColumn(order, 'b', 1);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});
