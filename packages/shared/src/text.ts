import { z } from 'zod';

// Text checks shared by every schema. Postgres cannot store NUL, and other control characters
// have no business in user text.

/** True if the text has an ASCII control character (including NUL and DEL) not in `allowed`. */
export function hasControlCharacter(value: string, allowed: number[] = []): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if ((code < 0x20 || code === 0x7f) && !allowed.includes(code)) return true;
  }
  return false;
}

/** A required single-line text, trimmed, 1 to `max` characters. */
export const singleLineText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !hasControlCharacter(value), 'Must not contain control characters.');
