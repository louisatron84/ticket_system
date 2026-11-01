import { describe, expect, it } from 'vitest';
import { barOf, ticksOf, timelineRange } from './timeline-layout';

const epic = (startDate: string | null, dueDate: string | null) => ({
  key: 'WEB-1',
  title: 'Epic',
  status: { key: 'open', name: 'Warming', category: 'not_started' as const },
  startDate,
  dueDate,
  assignee: null,
  progress: null,
});

describe('timelineRange', () => {
  it('starts on a Monday at least a week early and runs on two weeks past the last date', () => {
    // 2031-01-15 is a Wednesday.
    const range = timelineRange(
      { epics: [epic('2031-01-15', '2031-04-30')], milestones: [] },
      '2031-01-20',
      'weeks',
    );
    expect(range.from).toBe('2031-01-06');
    expect(new Date(`${range.from}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(range.to).toBe('2031-05-14');
  });

  it('covers whole months at month zoom', () => {
    const range = timelineRange(
      {
        epics: [epic(null, '2031-03-10')],
        milestones: [
          { id: 'x', name: 'M', targetDate: '2031-05-20', health: 'on_track', closed: false },
        ],
      },
      '2031-02-14',
      'months',
    );
    expect(range).toEqual({ from: '2031-02-01', to: '2031-06-30' });
  });

  it('shows at least two months around today when nothing has dates', () => {
    const range = timelineRange(
      { epics: [epic(null, null)], milestones: [] },
      '2031-01-15',
      'weeks',
    );
    expect(range.from <= '2031-01-15').toBe(true);
    expect(range.to >= '2031-03-01').toBe(true);
  });
});

describe('barOf', () => {
  it('runs from the start to the end of the due date', () => {
    expect(barOf(epic('2031-01-03', '2031-01-05'), '2031-01-01')).toEqual({
      left: 2,
      days: 3,
      partial: false,
    });
  });

  it('is a one-day mark with only one date, and absent with none', () => {
    expect(barOf(epic(null, '2031-01-05'), '2031-01-01')).toEqual({
      left: 4,
      days: 1,
      partial: true,
    });
    expect(barOf(epic(null, null), '2031-01-01')).toBeNull();
  });
});

describe('ticksOf', () => {
  it('marks Mondays at week zoom and the 1st at month zoom', () => {
    const weeks = ticksOf({ from: '2031-01-06', to: '2031-01-20' }, 'weeks');
    expect(weeks.map((tick) => tick.offset)).toEqual([0, 7, 14]);
    expect(weeks[0]!.label).toBe('6 Jan');
    const months = ticksOf({ from: '2031-01-01', to: '2031-03-31' }, 'months');
    expect(months.map((tick) => tick.label)).toEqual(['Jan 2031', 'Feb 2031', 'Mar 2031']);
  });
});
