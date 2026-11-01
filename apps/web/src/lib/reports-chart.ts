import type { Reports } from '@forge/shared';
import type { ChartPoint } from './burndown';

/** A top for a vertical axis: at least 1, rounded up to a tidy number. */
export function niceTop(value: number): number {
  if (value <= 5) return Math.max(1, Math.ceil(value));
  const step = 10 ** Math.floor(Math.log10(value));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (value <= factor * step) return factor * step;
  }
  return 10 * step;
}

/** Values spread evenly across a 0..1 square: the first at the left edge, the last at the right. */
export function seriesOf(values: number[], top: number): ChartPoint[] {
  const span = Math.max(1, values.length - 1);
  return values.map((value, index) => ({ x: index / span, y: value / top }));
}

export type FlowBand = 'notStarted' | 'inProgress' | 'done';

/**
 * The cumulative flow as three stacked bands, each a closed SVG path in a box of this size: done at
 * the bottom, then in progress, then not started on top.
 */
export function flowAreas(
  flow: Reports['flow'],
  width: number,
  height: number,
): { top: number; areas: Record<FlowBand, string> } {
  const top = niceTop(Math.max(0, ...flow.map((d) => d.notStarted + d.inProgress + d.done)));
  const span = Math.max(1, flow.length - 1);
  const x = (index: number) => ((index / span) * width).toFixed(1);
  const y = (value: number) => ((1 - value / top) * height).toFixed(1);
  const band = (
    lower: (d: Reports['flow'][number]) => number,
    size: (d: Reports['flow'][number]) => number,
  ) => {
    if (flow.length === 0) return '';
    const upper = flow.map((d, index) => `${x(index)},${y(lower(d) + size(d))}`);
    const base = flow.map((d, index) => `${x(index)},${y(lower(d))}`).reverse();
    return `M${upper.join(' L')} L${base.join(' L')} Z`;
  };
  return {
    top,
    areas: {
      done: band(
        () => 0,
        (d) => d.done,
      ),
      inProgress: band(
        (d) => d.done,
        (d) => d.inProgress,
      ),
      notStarted: band(
        (d) => d.done + d.inProgress,
        (d) => d.notStarted,
      ),
    },
  };
}

/** Bars for a row of values in a box of this size, with a gap between them. */
export function barsOf(
  values: number[],
  width: number,
  height: number,
  top = niceTop(Math.max(0, ...values)),
): { x: number; y: number; width: number; height: number }[] {
  if (values.length === 0) return [];
  const slot = width / values.length;
  const gap = Math.min(8, slot * 0.25);
  return values.map((value, index) => {
    const barHeight = (value / top) * height;
    return {
      x: index * slot + gap / 2,
      y: height - barHeight,
      width: slot - gap,
      height: barHeight,
    };
  });
}

/** Days in words: "under a day", "1 day", "3.5 days". */
export function formatDays(days: number | null): string {
  if (days === null) return '–';
  if (days < 1) return 'under a day';
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
