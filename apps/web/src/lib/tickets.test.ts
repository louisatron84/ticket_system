import { PROJECT_KEY_PATTERN } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import {
  formatDueDate,
  formatRelativeTime,
  initials,
  priorityIntensity,
  suggestProjectKey,
} from './tickets';

describe('priorityIntensity', () => {
  it('fills one bar per rank on the default five-step scale', () => {
    for (const rank of [1, 2, 3, 4, 5]) {
      expect(priorityIntensity(rank, 5)).toEqual({ filled: rank, total: 5 });
    }
  });

  it('scales a longer or shorter scale onto the same five bars', () => {
    expect(priorityIntensity(10, 10)).toEqual({ filled: 5, total: 5 });
    expect(priorityIntensity(5, 10)).toEqual({ filled: 3, total: 5 });
    expect(priorityIntensity(1, 10)).toEqual({ filled: 1, total: 5 });
    expect(priorityIntensity(2, 3)).toEqual({ filled: 3, total: 5 });
  });

  it('always shows at least one bar and never more than five, whatever it is given', () => {
    expect(priorityIntensity(0, 5).filled).toBe(1);
    expect(priorityIntensity(-4, 5).filled).toBe(1);
    expect(priorityIntensity(99, 5).filled).toBe(5);
    expect(priorityIntensity(3, 0).filled).toBe(1);
  });
});

describe('formatDueDate', () => {
  const today = '2030-06-15';
  const text = (date: string, options?: { done?: boolean }) => formatDueDate(date, today, options);

  it.each([
    ['2030-06-15', 'Today'],
    ['2030-06-16', 'Tomorrow'],
    ['2030-06-18', 'In 3 days'],
    ['2030-06-28', 'In 13 days'],
  ])('says %s is "%s" and not overdue', (date, expected) => {
    expect(text(date)).toEqual({ text: expected, overdue: false });
  });

  it('switches to a plain date two weeks out, without the year in the same year', () => {
    expect(text('2030-06-29')).toEqual({ text: '29 Jun', overdue: false });
    expect(text('2030-09-01')).toEqual({ text: '1 Sep', overdue: false });
  });

  it('adds the year when the date is in another year', () => {
    expect(text('2031-01-05')).toEqual({ text: '5 Jan 2031', overdue: false });
    expect(text('2029-12-31', { done: true })).toEqual({ text: '31 Dec 2029', overdue: false });
  });

  it('counts days overdue, in the singular for one', () => {
    expect(text('2030-06-14')).toEqual({ text: '1 day overdue', overdue: true });
    expect(text('2030-06-12')).toEqual({ text: '3 days overdue', overdue: true });
    expect(text('2030-05-16')).toEqual({ text: '30 days overdue', overdue: true });
  });

  it('crosses month and year ends correctly', () => {
    expect(formatDueDate('2030-12-31', '2031-01-02')).toEqual({
      text: '2 days overdue',
      overdue: true,
    });
    expect(formatDueDate('2031-01-01', '2030-12-31')).toEqual({ text: 'Tomorrow', overdue: false });
    // 2030 is not a leap year, 2032 is.
    expect(formatDueDate('2030-03-01', '2030-02-28')).toEqual({ text: 'Tomorrow', overdue: false });
    expect(formatDueDate('2032-02-29', '2032-02-28')).toEqual({ text: 'Tomorrow', overdue: false });
    expect(formatDueDate('2032-03-01', '2032-02-28')).toEqual({
      text: 'In 2 days',
      overdue: false,
    });
  });

  it('shows a finished ticket’s past due date as a plain date, never as overdue', () => {
    expect(text('2030-06-14', { done: true })).toEqual({ text: '14 Jun', overdue: false });
    expect(text('2030-01-01', { done: true })).toEqual({ text: '1 Jan', overdue: false });
  });

  it('still says Today and Tomorrow for a finished ticket', () => {
    expect(text('2030-06-15', { done: true })).toEqual({ text: 'Today', overdue: false });
  });

  it('returns what it was given, not a crash, for something that is not a date', () => {
    expect(formatDueDate('soon', today)).toEqual({ text: 'soon', overdue: false });
    expect(formatDueDate('2030-02-31', today)).toEqual({ text: '2030-02-31', overdue: false });
  });
});

describe('initials', () => {
  it.each([
    ['Dana Developer', 'DD'],
    ['Remy Read-only', 'RR'],
    ['Mary Jane Watson', 'MW'],
    ['madonna', 'MA'],
    ['  spaced   out  ', 'SO'],
    ['x', 'X'],
    ['', '?'],
    ['   ', '?'],
    // The second word starts with the article "ال", so its first letter is alef.
    ['مرحبا العالم', 'ما'],
    ['👋 Wave', '👋W'],
  ])('turns %j into %j', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe('suggestProjectKey', () => {
  it.each([
    ['Web App', 'WA'],
    ['Platform API', 'PA'],
    ['Customer Support Portal', 'CSP'],
    ['Platform', 'PLA'],
    ['ab', 'AB'],
    ['x', 'XX'],
    ['web-app v2', 'WAV'],
    ['  spaced   out  ', 'SO'],
    ['2fa login', 'FL'],
    ['Café Latte', 'CL'],
    ['a b c d e f g h i j k l', 'ABCDEFGHIJ'],
  ])('suggests %j → %j', (name, expected) => {
    expect(suggestProjectKey(name)).toBe(expected);
  });

  it.each(['', '   ', '123', '!!!', '日本語', '👋'])('has no suggestion for %j', (name) => {
    expect(suggestProjectKey(name)).toBe('');
  });

  it('always suggests something that is a valid key, and never one that is too long', () => {
    for (const name of [
      'Web App',
      'x',
      'A very long project name with many many many many words in it',
      'q9',
      'Hello, World!',
    ]) {
      const key = suggestProjectKey(name);
      expect(key, name).toMatch(PROJECT_KEY_PATTERN);
      expect(key.length).toBeLessThanOrEqual(10);
    }
  });
});

describe('formatRelativeTime', () => {
  const now = '2030-06-15T12:00:00.000Z';
  const ago = (ms: number) => new Date(Date.parse(now) - ms).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it.each([
    [0, 'Just now'],
    [44_000, 'Just now'],
    [60_000, '1 min ago'],
    [59 * MIN, '59 min ago'],
    [60 * MIN, '1 h ago'],
    [23 * HOUR, '23 h ago'],
    [24 * HOUR, 'Yesterday'],
    [47 * HOUR, 'Yesterday'],
    [2 * DAY, '2 days ago'],
    [6 * DAY, '6 days ago'],
  ])('says %i ms ago is "%s"', (elapsed, expected) => {
    expect(formatRelativeTime(ago(elapsed), now)).toBe(expected);
  });

  it('switches to a plain date after a week, with the year only if it is another year', () => {
    expect(formatRelativeTime(ago(7 * DAY), now)).toBe('8 Jun');
    expect(formatRelativeTime('2029-12-31T10:00:00.000Z', now)).toBe('31 Dec 2029');
  });

  it('treats a time slightly in the future (clock drift) as just now', () => {
    expect(formatRelativeTime(new Date(Date.parse(now) + 30_000).toISOString(), now)).toBe(
      'Just now',
    );
  });

  it('returns what it was given for something that is not a time', () => {
    expect(formatRelativeTime('later', now)).toBe('later');
  });
});
