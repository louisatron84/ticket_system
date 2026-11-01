import { addDays, type DurationStats, type Reports } from '@forge/shared';

/** What a report needs to know about a status: where it sits in the flow, or that it is scrapped. */
export type ReportStatus = {
  name: string;
  category: 'not_started' | 'in_progress' | 'completed';
  cancellation: boolean;
};

export type ReportTicket = {
  key: string;
  title: string;
  createdAt: Date;
  completedAt: Date | null;
  statusId: string;
  /** Its status changes, oldest first. */
  moves: { at: Date; from: string; to: string }[];
};

const DAY = 24 * 60 * 60 * 1000;
const endOfDay = (date: string) => new Date(`${addDays(date, 1)}T00:00:00Z`);
const toDays = (ms: number) => Math.round((ms / DAY) * 10) / 10;

/** Monday on or before a date. */
export const weekStartOf = (date: string) =>
  addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

/** The middle value and the 85th percentile (nearest rank), in days to one decimal. */
export function durationStats(durations: number[]): DurationStats {
  if (durations.length === 0) return { count: 0, medianDays: null, p85Days: null };
  const sorted = [...durations].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const p85 = sorted[Math.ceil(0.85 * sorted.length) - 1]!;
  return { count: sorted.length, medianDays: toDays(median), p85Days: toDays(p85) };
}

/** The status a ticket was in at a moment, or null if it did not exist yet. */
function statusAt(ticket: ReportTicket, at: Date): string | null {
  if (ticket.createdAt >= at) return null;
  let status = ticket.moves[0]?.from ?? ticket.statusId;
  for (const move of ticket.moves) {
    if (move.at >= at) break;
    status = move.to;
  }
  return status;
}

/** Done, not scrapped: in a completed status that is not a cancellation. */
const isDone = (status: ReportStatus | undefined) =>
  status !== undefined && status.category === 'completed' && !status.cancellation;

/**
 * Everything in a project's reports that comes from its tickets, over the days `from` to `to`
 * (UTC). Scrapped tickets are left out of the counts; a ticket is done from its `completedAt`.
 * `tickets` need only hold those not already done before `from`: those stay done throughout, so
 * they come in as `doneBefore`, a count.
 */
export function computeReports(input: {
  from: string;
  to: string;
  now: Date;
  tickets: ReportTicket[];
  doneBefore: number;
  statuses: Map<string, ReportStatus>;
}): Pick<Reports, 'createdResolved' | 'throughput' | 'flow' | 'leadTime' | 'cycleTime' | 'age'> {
  const { from, to, now, statuses } = input;
  const start = new Date(`${from}T00:00:00Z`);
  const end = endOfDay(to);
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);

  // Tickets done in the range, by the day they were done; each counted once, by its last finish.
  const doneInRange = input.tickets.filter(
    (ticket) =>
      ticket.completedAt !== null &&
      ticket.completedAt >= start &&
      ticket.completedAt < end &&
      isDone(statuses.get(ticket.statusId)),
  );
  const day = (at: Date) => at.toISOString().slice(0, 10);

  let created = 0;
  let resolved = 0;
  const createdByDay = new Map<string, number>();
  for (const ticket of input.tickets) {
    if (ticket.createdAt < start || ticket.createdAt >= end) continue;
    const key = day(ticket.createdAt);
    createdByDay.set(key, (createdByDay.get(key) ?? 0) + 1);
  }
  const resolvedByDay = new Map<string, number>();
  for (const ticket of doneInRange) {
    const key = day(ticket.completedAt!);
    resolvedByDay.set(key, (resolvedByDay.get(key) ?? 0) + 1);
  }
  const createdResolved = dates.map((date) => {
    created += createdByDay.get(date) ?? 0;
    resolved += resolvedByDay.get(date) ?? 0;
    return { date, created, resolved };
  });

  const throughput: Reports['throughput'] = [];
  for (let week = weekStartOf(from); week <= to; week = addDays(week, 7)) {
    throughput.push({ weekStart: week, done: 0 });
  }
  for (const ticket of doneInRange) {
    const week = weekStartOf(day(ticket.completedAt!));
    const entry = throughput.find((item) => item.weekStart === week);
    if (entry) entry.done += 1;
  }

  const flow = dates.map((date) => {
    const at = endOfDay(date) < now ? endOfDay(date) : now;
    const counts = { date, notStarted: 0, inProgress: 0, done: input.doneBefore };
    for (const ticket of input.tickets) {
      const id = statusAt(ticket, at);
      const status = id === null ? undefined : statuses.get(id);
      if (!status || status.cancellation) continue;
      if (status.category === 'not_started') counts.notStarted += 1;
      else if (status.category === 'in_progress') counts.inProgress += 1;
      else counts.done += 1;
    }
    return counts;
  });

  const leadTime = durationStats(
    doneInRange.map((ticket) => ticket.completedAt!.getTime() - ticket.createdAt.getTime()),
  );
  const cycleTime = durationStats(
    doneInRange.flatMap((ticket) => {
      const started = ticket.moves.find(
        (move) => statuses.get(move.to)?.category === 'in_progress',
      );
      return started && started.at <= ticket.completedAt!
        ? [ticket.completedAt!.getTime() - started.at.getTime()]
        : [];
    }),
  );

  // Open tickets, and how long since they last moved (or were made).
  const open = input.tickets.flatMap((ticket) => {
    const status = statuses.get(ticket.statusId);
    if (!status || status.category === 'completed') return [];
    const since = ticket.moves.at(-1)?.at ?? ticket.createdAt;
    return [{ ticket, status, ms: Math.max(0, now.getTime() - since.getTime()) }];
  });
  const byStatus = new Map<string, typeof open>();
  for (const item of open) {
    const list = byStatus.get(item.ticket.statusId) ?? [];
    list.push(item);
    byStatus.set(item.ticket.statusId, list);
  }
  const statusRows = [...byStatus.values()].map((items) => {
    const stats = durationStats(items.map((item) => item.ms));
    return {
      name: items[0]!.status.name,
      category: items[0]!.status.category as 'not_started' | 'in_progress',
      count: items.length,
      medianDays: stats.medianDays!,
      oldestDays: toDays(Math.max(...items.map((item) => item.ms))),
    };
  });
  statusRows.sort(
    (a, b) =>
      (a.category === b.category ? 0 : a.category === 'not_started' ? -1 : 1) ||
      b.oldestDays - a.oldestDays,
  );
  const oldest = [...open]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 10)
    .map((item) => ({
      key: item.ticket.key,
      title: item.ticket.title,
      status: item.status.name,
      days: toDays(item.ms),
    }));

  return {
    createdResolved,
    throughput,
    flow,
    leadTime,
    cycleTime,
    age: { statuses: statusRows, oldest },
  };
}
