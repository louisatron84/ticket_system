import { z } from 'zod';

// Text checks shared by every schema. Postgres cannot store NUL, and other control characters
// have no business in user text.

/**
 * Invisible characters that change how text around them is shown: the bidirectional overrides,
 * embeddings and isolates (the "Trojan Source" characters, which can make `gnp.exe` read as
 * `exe.png`), zero-width spaces and joiners that hide inside words, and the byte-order mark.
 * The plain direction marks (LRM, RLM, ALM) and the emoji joiners (ZWJ, ZWNJ) stay allowed:
 * right-to-left writing and emoji need them, and they cannot reorder text.
 */
const INVISIBLE_FORMATTING = new Set([
  0x200b, 0x2060, 0xfeff, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);

/**
 * True if the text has a control character not in `allowed`: ASCII controls (including NUL and
 * DEL), the C1 controls (U+0080 to U+009F, which terminals read as escape codes), or one of the
 * invisible formatting characters above.
 */
export function hasControlCharacter(value: string, allowed: number[] = []): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const control = code < 0x20 || (code >= 0x7f && code <= 0x9f) || INVISIBLE_FORMATTING.has(code);
    if (control && !allowed.includes(code)) return true;
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
