import { formatEstimate, formatPoints, type EstimationSystem } from '@forge/shared';

/** Where a backlog move sends a ticket, as the rank request names it. */
export type RankPlace = { to: 'top' | 'bottom' } | { after?: string; before?: string };

/** The list with the item at `from` taken out and put back at `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return [...items];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/**
 * The place to ask for once a ticket sits at `index` of the new order: the top or bottom when it is
 * at an end, otherwise between its new neighbours.
 */
export function placeFor(keys: readonly string[], index: number): RankPlace {
  if (index <= 0) return { to: 'top' };
  if (index >= keys.length - 1) return { to: 'bottom' };
  return { after: keys[index - 1]!, before: keys[index + 1]! };
}

/** The total of the backlog's estimates, in the project's system, and how many have none. */
export function estimateTotal(
  system: EstimationSystem,
  items: readonly { estimateMinutes: number | null; estimatePoints: number | null }[],
): { text: string; missing: number } {
  const values = items.map((item) =>
    system === 'points' ? item.estimatePoints : item.estimateMinutes,
  );
  const sum = values.reduce<number>((total, value) => total + (value ?? 0), 0);
  const missing = values.filter((value) => value === null).length;
  const text = system === 'points' ? formatPoints(sum)! : (formatEstimate(sum) ?? '0m');
  return { text, missing };
}
