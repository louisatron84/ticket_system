import { describe, expect, it } from 'vitest';
import { computeReports, durationStats, weekStartOf, type ReportStatus } from './reports';

const statuses = new Map<string, ReportStatus>([
  ['open', { name: 'Warming', category: 'not_started', cancellation: false }],
  ['doing', { name: 'Forging', category: 'in_progress', cancellation: false }],
  ['done', { name: 'Quenched', category: 'completed', cancellation: false }],
  ['scrap', { name: 'Scrapped', category: 'completed', cancellation: true }],
]);

const at = (date: string, hour = 12) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);

const report = (tickets: Parameters<typeof computeReports>[0]['tickets'], doneBefore = 0) =>
  computeReports({
    from: '2031-01-06',
    to: '2031-01-12',
    now: at('2031-01-12', 18),
    tickets,
    doneBefore,
    statuses,
  });

describe('durationStats', () => {
  it('gives the median and 85th percentile in days', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(durationStats([1, 2, 3, 4, 10].map((n) => n * day))).toEqual({
      count: 5,
      medianDays: 3,
      p85Days: 10,
    });
    expect(durationStats([1, 2].map((n) => n * day)).medianDays).toBe(1.5);
    expect(durationStats([])).toEqual({ count: 0, medianDays: null, p85Days: null });
  });
});

describe('weekStartOf', () => {
  it('is the Monday on or before', () => {
    expect(weekStartOf('2031-01-06')).toBe('2031-01-06');
    expect(weekStartOf('2031-01-12')).toBe('2031-01-06');
  });
});

describe('computeReports', () => {
  const finished = {
    key: 'WEB-1',
    title: 'Finished',
    createdAt: at('2031-01-06', 9),
    completedAt: at('2031-01-09', 9),
    statusId: 'done',
    moves: [
      { at: at('2031-01-07', 9), from: 'open', to: 'doing' },
      { at: at('2031-01-09', 9), from: 'doing', to: 'done' },
    ],
  };
  const waiting = {
    key: 'WEB-2',
    title: 'Waiting',
    createdAt: at('2031-01-08', 18),
    completedAt: null,
    statusId: 'open',
    moves: [],
  };

  it('runs totals of tickets made and done', () => {
    const result = report([finished, waiting]);
    expect(result.createdResolved[0]).toEqual({ date: '2031-01-06', created: 1, resolved: 0 });
    expect(result.createdResolved.at(-1)).toEqual({ date: '2031-01-12', created: 2, resolved: 1 });
    expect(result.throughput).toEqual([{ weekStart: '2031-01-06', done: 1 }]);
  });

  it('follows each ticket through the kinds of status, day by day', () => {
    const result = report([finished, waiting], 4);
    const day = (date: string) => result.flow.find((item) => item.date === date);
    expect(day('2031-01-06')).toMatchObject({ notStarted: 1, inProgress: 0, done: 4 });
    expect(day('2031-01-07')).toMatchObject({ notStarted: 0, inProgress: 1, done: 4 });
    expect(day('2031-01-08')).toMatchObject({ notStarted: 1, inProgress: 1, done: 4 });
    expect(day('2031-01-09')).toMatchObject({ notStarted: 1, inProgress: 0, done: 5 });
  });

  it('measures lead time from made and cycle time from first started', () => {
    const result = report([finished]);
    expect(result.leadTime).toEqual({ count: 1, medianDays: 3, p85Days: 3 });
    expect(result.cycleTime).toEqual({ count: 1, medianDays: 2, p85Days: 2 });
  });

  it('leaves scrapped tickets out', () => {
    const scrapped = {
      ...finished,
      key: 'WEB-3',
      statusId: 'scrap',
      moves: [{ at: at('2031-01-09', 9), from: 'open', to: 'scrap' }],
    };
    const result = report([scrapped]);
    expect(result.createdResolved.at(-1)!.resolved).toBe(0);
    expect(result.leadTime.count).toBe(0);
    expect(result.flow.at(-1)).toMatchObject({ notStarted: 0, inProgress: 0, done: 0 });
  });

  it('ages open tickets from their last move, oldest first', () => {
    const stuck = {
      key: 'WEB-4',
      title: 'Stuck',
      createdAt: at('2031-01-01'),
      completedAt: null,
      statusId: 'doing',
      moves: [{ at: at('2031-01-02', 18), from: 'open', to: 'doing' }],
    };
    const result = report([finished, waiting, stuck]);
    expect(result.age.oldest.map((item) => item.key)).toEqual(['WEB-4', 'WEB-2']);
    expect(result.age.oldest[0]).toMatchObject({ status: 'Forging', days: 10 });
    expect(result.age.statuses).toEqual([
      { name: 'Warming', category: 'not_started', count: 1, medianDays: 4, oldestDays: 4 },
      { name: 'Forging', category: 'in_progress', count: 1, medianDays: 10, oldestDays: 10 },
    ]);
  });
});
