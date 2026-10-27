import { describe, expect, it } from 'vitest';
import { selectionReducer } from './selection';

const none: string[] = [];

describe('selectionReducer', () => {
  it('toggles one key on and off, keeping the order they were picked in', () => {
    const one = selectionReducer(none, { type: 'toggle', key: 'WEB-2' });
    const two = selectionReducer(one, { type: 'toggle', key: 'WEB-1' });
    expect(two).toEqual(['WEB-2', 'WEB-1']);
    expect(selectionReducer(two, { type: 'toggle', key: 'WEB-2' })).toEqual(['WEB-1']);
  });

  it('selects every key on the page, or clears them when all are selected already', () => {
    const page = ['WEB-1', 'WEB-2', 'WEB-3'];
    const some = selectionReducer(none, { type: 'toggle', key: 'WEB-2' });
    expect(selectionReducer(some, { type: 'toggleAll', keys: page })).toEqual([
      'WEB-2',
      'WEB-1',
      'WEB-3',
    ]);
    expect(selectionReducer(page, { type: 'toggleAll', keys: page })).toEqual([]);
  });

  it('clears everything', () => {
    expect(selectionReducer(['WEB-1', 'WEB-2'], { type: 'clear' })).toEqual([]);
  });

  it('keeps only keys still on the page when the rows change', () => {
    const before = ['WEB-1', 'WEB-2', 'WEB-3'];
    expect(selectionReducer(before, { type: 'retain', keys: ['WEB-3', 'WEB-1', 'WEB-9'] })).toEqual(
      ['WEB-1', 'WEB-3'],
    );
  });

  it('returns the very same list when nothing changes, so nothing redraws', () => {
    const before = ['WEB-1'];
    expect(selectionReducer(before, { type: 'retain', keys: ['WEB-1', 'WEB-2'] })).toBe(before);
    expect(selectionReducer(none, { type: 'clear' })).toBe(none);
  });
});
