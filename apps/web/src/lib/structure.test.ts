import { describe, expect, it } from 'vitest';
import { blockedLine, progressSegments, progressSummary } from './structure';

describe('progressSegments', () => {
  it('gives each bucket with tickets its share, done first and jammed before the rest', () => {
    expect(progressSegments({ completed: 3, inProgress: 2, jammed: 1, notStarted: 1 })).toEqual([
      { bucket: 'completed', label: 'Quenched', count: 3, percent: (3 / 7) * 100 },
      { bucket: 'inProgress', label: 'In progress', count: 2, percent: (2 / 7) * 100 },
      { bucket: 'jammed', label: 'Jammed', count: 1, percent: (1 / 7) * 100 },
      { bucket: 'notStarted', label: 'Not started', count: 1, percent: (1 / 7) * 100 },
    ]);
  });

  it('leaves out empty buckets', () => {
    expect(
      progressSegments({ completed: 0, inProgress: 0, jammed: 0, notStarted: 2 }).map(
        (segment) => segment.bucket,
      ),
    ).toEqual(['notStarted']);
  });
});

describe('progressSummary', () => {
  it('counts the finished ones out of all', () => {
    expect(progressSummary({ completed: 3, inProgress: 2, jammed: 1, notStarted: 1 })).toBe(
      '3 of 7 quenched',
    );
    expect(progressSummary({ completed: 0, inProgress: 0, jammed: 0, notStarted: 1 })).toBe(
      '0 of 1 quenched',
    );
  });
});

describe('blockedLine', () => {
  it('names every open blocker', () => {
    expect(blockedLine(['API-4'])).toBe('Blocked by API-4');
    expect(blockedLine(['API-4', 'OPS-2'])).toBe('Blocked by API-4 and OPS-2');
    expect(blockedLine(['API-4', 'OPS-2', 'WEB-9'])).toBe('Blocked by API-4, OPS-2 and WEB-9');
  });

  it('is empty when nothing blocks the ticket', () => {
    expect(blockedLine([])).toBe('');
  });
});
