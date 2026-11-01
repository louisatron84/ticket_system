import { describe, expect, it } from 'vitest';
import { barsOf, flowAreas, formatDays, niceTop, seriesOf } from './reports-chart';

describe('niceTop', () => {
  it('rounds up to a tidy number, never below 1', () => {
    expect(niceTop(0)).toBe(1);
    expect(niceTop(3.2)).toBe(4);
    expect(niceTop(7)).toBe(10);
    expect(niceTop(23)).toBe(25);
    expect(niceTop(140)).toBe(200);
  });
});

describe('seriesOf', () => {
  it('spreads values from the left edge to the right', () => {
    expect(seriesOf([0, 5, 10], 10)).toEqual([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ]);
  });
});

describe('flowAreas', () => {
  it('stacks done, in progress and not started', () => {
    const { top, areas } = flowAreas(
      [
        { date: '2031-01-01', notStarted: 2, inProgress: 2, done: 6 },
        { date: '2031-01-02', notStarted: 1, inProgress: 1, done: 8 },
      ],
      100,
      100,
    );
    expect(top).toBe(10);
    expect(areas.done).toBe('M0.0,40.0 L100.0,20.0 L100.0,100.0 L0.0,100.0 Z');
    expect(areas.notStarted).toBe('M0.0,0.0 L100.0,0.0 L100.0,10.0 L0.0,20.0 Z');
  });

  it('draws nothing without days', () => {
    expect(flowAreas([], 100, 100).areas.done).toBe('');
  });
});

describe('barsOf', () => {
  it('scales bars to the top and leaves gaps', () => {
    const bars = barsOf([5, 10], 100, 50);
    expect(bars[1]).toMatchObject({ y: 0, height: 50 });
    expect(bars[0]).toMatchObject({ y: 25, height: 25 });
    expect(bars[0]!.width).toBeLessThan(50);
  });
});

describe('formatDays', () => {
  it('says how many days in words', () => {
    expect(formatDays(null)).toBe('–');
    expect(formatDays(0.4)).toBe('under a day');
    expect(formatDays(1)).toBe('1 day');
    expect(formatDays(3.5)).toBe('3.5 days');
  });
});
