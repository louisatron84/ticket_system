import { describe, expect, it } from 'vitest';
import { estimateTotal, moveItem, placeFor } from './backlog';

describe('moveItem', () => {
  it('moves down and up, and leaves the list alone for a bad index', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
  });
});

describe('placeFor', () => {
  it('names the ends, or the two neighbours', () => {
    const keys = ['WEB-1', 'WEB-2', 'WEB-3'];
    expect(placeFor(keys, 0)).toEqual({ to: 'top' });
    expect(placeFor(keys, 2)).toEqual({ to: 'bottom' });
    expect(placeFor(keys, 1)).toEqual({ after: 'WEB-1', before: 'WEB-3' });
  });
});

describe('estimateTotal', () => {
  const items = [
    { estimateMinutes: 90, estimatePoints: 3 },
    { estimateMinutes: null, estimatePoints: 5 },
    { estimateMinutes: 30, estimatePoints: null },
  ];

  it('adds time estimates', () => {
    expect(estimateTotal('time', items)).toEqual({ text: '2h', missing: 1 });
  });

  it('adds points', () => {
    expect(estimateTotal('points', items)).toEqual({ text: '8 pts', missing: 1 });
  });

  it('reads zero for an empty backlog', () => {
    expect(estimateTotal('time', [])).toEqual({ text: '0m', missing: 0 });
    expect(estimateTotal('points', [])).toEqual({ text: '0 pts', missing: 0 });
  });
});
