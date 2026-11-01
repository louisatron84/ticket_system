// Backlog ranks: text keys that sort in byte order (the database compares them in the C collation),
// so a ticket moved between two others gets a key between theirs and no other row changes.
//
// A key is an integer part and an optional fraction. The integer's first character says how long it
// is ('a'..'z' for zero and up, 'A'..'Z' below zero), so keys made by always adding at the end stay
// short; the fraction only grows when tickets are put between two that are already next to each
// other. A fraction never ends in '0', so there is always room between two keys.

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SMALLEST_INTEGER = `A${'0'.repeat(26)}`;

/** The longest rank stored; past this the project's ranks are spread out again. */
export const RANK_MAX_LENGTH = 64;

const digit = (character: string) => {
  const value = DIGITS.indexOf(character);
  if (value < 0) throw new Error(`Not a rank digit: ${character}`);
  return value;
};

/** A key between two fractions (`b` null means no upper bound). Neither may end in '0'. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let shared = 0;
    while ((a[shared] ?? '0') === b[shared]) shared += 1;
    if (shared > 0) return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
  }
  const low = a ? digit(a[0]!) : 0;
  const high = b !== null ? digit(b[0]!) : DIGITS.length;
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)]!;
  // The first digits are next to each other.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[low]! + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`Not a rank: bad head ${head}`);
}

function integerPart(key: string): string {
  const length = integerLength(key[0] ?? '');
  if (length > key.length) throw new Error(`Not a rank: ${key}`);
  return key.slice(0, length);
}

/** Whether text is a rank this module could have made. */
export function isRank(key: string): boolean {
  try {
    if (key === SMALLEST_INTEGER || key.length > RANK_MAX_LENGTH * 2) return false;
    const integer = integerPart(key);
    for (const character of key) digit(character);
    return !key.slice(integer.length).endsWith('0');
  } catch {
    return false;
  }
}

function incrementInteger(integer: string): string | null {
  const [head, ...digits] = integer.split('') as [string, ...string[]];
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const next = digit(digits[index]!) + 1;
    if (next < DIGITS.length) {
      digits[index] = DIGITS[next]!;
      return head + digits.join('');
    }
    digits[index] = '0';
  }
  // Every digit carried: the integer gets one digit longer (or shorter, below zero).
  if (head === 'Z') return 'a0';
  if (head === 'z') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push('0');
  else digits.pop();
  return nextHead + digits.join('');
}

function decrementInteger(integer: string): string | null {
  const [head, ...digits] = integer.split('') as [string, ...string[]];
  const top = DIGITS[DIGITS.length - 1]!;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const next = digit(digits[index]!) - 1;
    if (next >= 0) {
      digits[index] = DIGITS[next]!;
      return head + digits.join('');
    }
    digits[index] = top;
  }
  if (head === 'a') return `Z${top}`;
  if (head === 'A') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (nextHead < 'Z') digits.push(top);
  else digits.pop();
  return nextHead + digits.join('');
}

/**
 * A rank that sorts after `before` and ahead of `after`. Either may be null: null `before` means
 * "at the top", null `after` means "at the bottom", both null is the first rank of an empty list.
 */
export function rankBetween(before: string | null, after: string | null): string {
  if (before !== null && !isRank(before)) throw new Error(`Not a rank: ${before}`);
  if (after !== null && !isRank(after)) throw new Error(`Not a rank: ${after}`);
  if (before !== null && after !== null && before >= after) {
    throw new Error(`Ranks out of order: ${before} >= ${after}`);
  }

  if (before === null) {
    if (after === null) return 'a0';
    const integer = integerPart(after);
    const fraction = after.slice(integer.length);
    if (integer === SMALLEST_INTEGER) return integer + midpoint('', fraction);
    if (integer < after) return integer;
    const smaller = decrementInteger(integer);
    if (smaller === null) throw new Error('No room above the top rank');
    return smaller;
  }

  const integer = integerPart(before);
  const fraction = before.slice(integer.length);
  if (after === null) {
    const larger = incrementInteger(integer);
    return larger === null ? integer + midpoint(fraction, null) : larger;
  }

  const afterInteger = integerPart(after);
  if (integer === afterInteger) {
    return integer + midpoint(fraction, after.slice(afterInteger.length));
  }
  const larger = incrementInteger(integer);
  if (larger === null) throw new Error('No room between ranks');
  return larger < after ? larger : integer + midpoint(fraction, null);
}

/** `count` ranks in order, evenly spread, for filling or re-spreading a list. */
export function spreadRanks(count: number): string[] {
  const ranks: string[] = [];
  let previous: string | null = null;
  for (let index = 0; index < count; index += 1) {
    previous = rankBetween(previous, null);
    ranks.push(previous);
  }
  return ranks;
}
