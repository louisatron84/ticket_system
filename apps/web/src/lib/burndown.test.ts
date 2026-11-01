import { describe, expect, it } from 'vitest';
import { burndownChart, daysBetween, pathOf } from './burndown';

const day = (date: string, scope: number, remaining: number, estimate = true) => ({
  date,
  scopeTickets: estimate ? 2 : scope,
  remainingTickets: estimate ? 1 : remaining,
  scopeEstimate: estimate ? scope : 0,
  remainingEstimate: estimate ? remaining : 0,
});

describe('daysBetween', () => {
  it('counts whole days across a month', () => {
    expect(daysBetween('2031-01-30', '2031-02-02')).toBe(3);
    expect(daysBetween('2031-01-01', '2031-01-01')).toBe(0);
  });
});

describe('burndownChart', () => {
  const cycle = { startsOn: '2031-01-01', endsOn: '2031-01-11' };

  it('places each day through the cycle, as a share of the largest scope', () => {
    const chart = burndownChart(cycle, [day('2031-01-01', 100, 100), day('2031-01-06', 100, 50)]);
    expect(chart.unit).toBe('estimate');
    expect(chart.length).toBe(11);
    expect(chart.top).toBe(100);
    expect(chart.remaining).toEqual([
      { x: 0, y: 1 },
      { x: 0.5, y: 0.5 },
    ]);
    expect(chart.ideal).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ]);
  });

  it('counts tickets when nothing is estimated', () => {
    const chart = burndownChart(cycle, [day('2031-01-01', 4, 3, false)]);
    expect(chart.unit).toBe('tickets');
    expect(chart.remaining[0]).toEqual({ x: 0, y: 0.75 });
  });

  it('copes with no days at all', () => {
    const chart = burndownChart(cycle, []);
    expect(chart.remaining).toEqual([]);
    expect(chart.top).toBe(1);
  });
});

describe('pathOf', () => {
  it('draws from the top left, with y growing downwards', () => {
    expect(
      pathOf(
        [
          { x: 0, y: 1 },
          { x: 1, y: 0 },
        ],
        200,
        100,
      ),
    ).toBe('M0.0,0.0 L200.0,100.0');
  });
});
