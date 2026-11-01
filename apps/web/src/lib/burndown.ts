import { addDays, type Burndown } from '@forge/shared';

export type ChartPoint = { x: number; y: number };

export type BurndownChart = {
  /** What the chart counts: estimate when the cycle has any, else tickets. */
  unit: 'estimate' | 'tickets';
  /** The largest value on the vertical axis. */
  top: number;
  /** How many days the cycle has, start and end included. */
  length: number;
  remaining: ChartPoint[];
  scope: ChartPoint[];
  /** A straight line from the first day's scope down to nothing on the last day. */
  ideal: [ChartPoint, ChartPoint];
};

/** Whole days from one date to another (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

/**
 * The burndown as points in a 0..1 square (x: through the cycle, y: share of the top value, 0 at
 * the bottom), ready to draw at any size.
 */
export function burndownChart(
  cycle: { startsOn: string; endsOn: string },
  days: Burndown['days'],
): BurndownChart {
  const unit = days.some((day) => day.scopeEstimate > 0) ? 'estimate' : 'tickets';
  const scopeOf = (day: Burndown['days'][number]) =>
    unit === 'estimate' ? day.scopeEstimate : day.scopeTickets;
  const remainingOf = (day: Burndown['days'][number]) =>
    unit === 'estimate' ? day.remainingEstimate : day.remainingTickets;
  const length = daysBetween(cycle.startsOn, cycle.endsOn) + 1;
  const top = Math.max(1, ...days.map(scopeOf));
  const span = Math.max(1, length - 1);
  const point = (date: string, value: number): ChartPoint => ({
    x: daysBetween(cycle.startsOn, date) / span,
    y: value / top,
  });
  const first = days[0];
  return {
    unit,
    top,
    length,
    remaining: days.map((day) => point(day.date, remainingOf(day))),
    scope: days.map((day) => point(day.date, scopeOf(day))),
    ideal: [
      point(cycle.startsOn, first ? scopeOf(first) : 0),
      point(addDays(cycle.startsOn, span), 0),
    ],
  };
}

/** An SVG path through the points, in a box of this width and height (y grows downwards). */
export function pathOf(points: ChartPoint[], width: number, height: number): string {
  return points
    .map(
      (p, index) =>
        `${index === 0 ? 'M' : 'L'}${(p.x * width).toFixed(1)},${((1 - p.y) * height).toFixed(1)}`,
    )
    .join(' ');
}
