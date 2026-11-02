import { addDays, type Timeline } from '@forge/shared';
import { daysBetween } from './burndown';

export type Zoom = 'weeks' | 'months';

/** How wide one day is at each zoom. */
export const DAY_WIDTH: Record<Zoom, number> = { weeks: 20, months: 5 };

/** The first and last day the timeline shows, padded to whole weeks or months. */
export function timelineRange(
  timeline: Pick<Timeline, 'epics' | 'milestones'>,
  today: string,
  zoom: Zoom,
): { from: string; to: string } {
  const dates = [
    today,
    ...timeline.epics.flatMap((epic) => [epic.startDate, epic.dueDate]),
    ...timeline.milestones.map((milestone) => milestone.targetDate),
  ].filter((date): date is string => date !== null);
  const sorted = [...dates].sort();
  // Every day in range is walked, so a date far off (entered before dates were limited) must not
  // stretch it: two years back and five ahead is as far as it goes.
  const earliest = addDays(today, -730);
  const latest = addDays(today, 1826);
  let from = sorted[0]! < earliest ? earliest : sorted[0]!;
  let to = sorted.at(-1)! > latest ? latest : sorted.at(-1)!;
  if (zoom === 'weeks') {
    from = addDays(from, -(((new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7) + 7));
    to = addDays(to, 14);
  } else {
    from = `${from.slice(0, 7)}-01`;
    const next = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 2);
    to = addDays(next.toISOString().slice(0, 10), -1);
  }
  // At least two months in view, so a near-empty timeline is not a sliver.
  if (daysBetween(from, to) < 60) to = addDays(from, 60);
  return { from, to };
}

/**
 * Where an epic's bar goes, in days from the start of the range: from its start date to the end of
 * its due date. With only one of the two it is a one-day mark; with neither it is not placed.
 */
export function barOf(
  epic: { startDate: string | null; dueDate: string | null },
  from: string,
): { left: number; days: number; partial: boolean } | null {
  const start = epic.startDate ?? epic.dueDate;
  const end = epic.dueDate ?? epic.startDate;
  if (!start || !end) return null;
  return {
    left: daysBetween(from, start),
    days: daysBetween(start, end) + 1,
    partial: epic.startDate === null || epic.dueDate === null,
  };
}

/** The labelled marks along the top: each Monday at week zoom, each 1st at month zoom. */
export function ticksOf(
  range: { from: string; to: string },
  zoom: Zoom,
): { offset: number; label: string }[] {
  const ticks: { offset: number; label: string }[] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    const value = new Date(`${date}T00:00:00Z`);
    const mark = zoom === 'weeks' ? value.getUTCDay() === 1 : value.getUTCDate() === 1;
    if (!mark) continue;
    ticks.push({
      offset: daysBetween(range.from, date),
      label: value.toLocaleDateString('en-GB', {
        timeZone: 'UTC',
        ...(zoom === 'weeks'
          ? { day: 'numeric', month: 'short' }
          : { month: 'short', year: 'numeric' }),
      }),
    });
  }
  return ticks;
}
