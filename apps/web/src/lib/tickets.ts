// Pure helpers for how tickets are shown. Nothing here touches the network, the clock or the
// browser, so dates are always compared against a "today" the caller passes in.

const PRIORITY_BARS = 5;

/**
 * How many of five bars to fill for a priority, whatever scale the workspace uses: the lowest rank
 * still shows one bar, the top rank shows all five.
 */
export function priorityIntensity(
  rank: number,
  maxRank: number,
): { filled: number; total: number } {
  if (!(maxRank > 0)) return { filled: 1, total: PRIORITY_BARS };
  const filled = Math.round((Math.max(rank, 0) / maxRank) * PRIORITY_BARS);
  return { filled: Math.min(PRIORITY_BARS, Math.max(1, filled)), total: PRIORITY_BARS };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

/** Days since the epoch for a calendar date like 2030-06-15, or null if it is not a real date. */
function dayNumber(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return ms / DAY_MS;
}

/** "5 Jan 2031", or "5 Jan" when it is in the same year as today. Fixed English, so the server and the browser agree. */
function plainDate(date: string, today: string): string {
  const [year, month, day] = date.split('-');
  const sameYear = year === today.slice(0, 4);
  return `${Number(day)} ${MONTHS[Number(month) - 1]}${sameYear ? '' : ` ${year}`}`;
}

/**
 * How a due date reads next to a ticket. Near dates are relative ("Tomorrow", "In 3 days"),
 * far ones are plain dates, and past ones count the days overdue. A finished ticket is never
 * overdue: its past due date is shown as a plain date.
 */
export function formatDueDate(
  date: string,
  today: string,
  options: { done?: boolean } = {},
): { text: string; overdue: boolean } {
  const due = dayNumber(date);
  const now = dayNumber(today);
  if (due === null || now === null) return { text: date, overdue: false };

  const difference = due - now;
  if (difference === 0) return { text: 'Today', overdue: false };
  if (difference === 1) return { text: 'Tomorrow', overdue: false };
  if (difference > 1 && difference < 14) return { text: `In ${difference} days`, overdue: false };
  if (difference >= 14) return { text: plainDate(date, today), overdue: false };

  if (options.done) return { text: plainDate(date, today), overdue: false };
  const days = -difference;
  return { text: `${days} ${days === 1 ? 'day' : 'days'} overdue`, overdue: true };
}

/**
 * How long ago something happened, for a column of "updated" times: minutes and hours today,
 * "Yesterday", days up to a week, then a plain date. `now` is passed in so a server-rendered page
 * and its hydrated copy agree.
 */
export function formatRelativeTime(iso: string, nowIso: string): string {
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(then) || Number.isNaN(now)) return iso;

  const seconds = Math.floor((now - then) / 1000);
  // Includes a time slightly in the future, which clock drift between machines can produce.
  if (seconds < 45) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(minutes, 1)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return plainDate(iso.slice(0, 10), nowIso.slice(0, 10));
}

/** Two letters for an avatar: first and last word's first letters, or the first two of one word. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0]!);
  if (words.length === 1) return first.slice(0, 2).join('').toUpperCase();
  return (first[0]! + Array.from(words.at(-1)!)[0]!).toUpperCase();
}

/**
 * A project key to offer while someone types a project name: the first letters of its words
 * ("Web App" becomes WA), or the first three letters of a single word. Only ASCII letters and
 * digits survive, because that is all a key allows. Returns "" when nothing usable is left.
 */
export function suggestProjectKey(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let key: string;

  if (words.length >= 2) {
    key = words
      .map((word) => /[A-Za-z]/.exec(word)?.[0])
      .filter((letter): letter is string => letter !== undefined)
      .join('');
  } else {
    const word = words[0] ?? '';
    const start = word.search(/[A-Za-z]/);
    key = start === -1 ? '' : word.slice(start, start + 3);
  }

  key = key.toUpperCase().slice(0, 10);
  return key.length === 1 ? key + key : key;
}
