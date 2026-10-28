// The decisions behind the text editor, kept pure so they can be tested without a browser.

/** The `@name` being typed just before the caret, or null when the caret is not in one. */
export function mentionQuery(beforeCaret: string): { start: number; query: string } | null {
  const match = /(^|[\s(])@([\p{L}\p{N}._-]{0,30})$/u.exec(beforeCaret);
  if (!match) return null;
  return { start: match.index + match[1]!.length, query: match[2]! };
}

/** The text with `insertion` replacing `start` to `end`, and where the caret goes after it. */
export function replaceRange(
  value: string,
  start: number,
  end: number,
  insertion: string,
): { value: string; caret: number } {
  return {
    value: value.slice(0, start) + insertion + value.slice(end),
    caret: start + insertion.length,
  };
}

/** Members whose name or email starts a word with the query, best first, at most `limit`. */
export function matchMembers<T extends { displayName: string; email: string }>(
  members: T[],
  query: string,
  limit = 6,
): T[] {
  const q = query.toLowerCase();
  const score = (member: T) => {
    const name = member.displayName.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.split(/\s+/).some((word) => word.startsWith(q))) return 1;
    if (member.email.toLowerCase().startsWith(q)) return 2;
    return -1;
  };
  return members
    .map((member) => ({ member, rank: score(member) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.member.displayName.localeCompare(b.member.displayName))
    .slice(0, limit)
    .map((entry) => entry.member);
}

/** Text to put around an inserted block so it sits on its own line. */
export function onOwnLine(value: string, at: number, block: string): string {
  const before = at > 0 && value[at - 1] !== '\n' ? '\n' : '';
  const after = value[at] !== undefined && value[at] !== '\n' ? '\n' : '';
  return `${before}${block}${after}`;
}

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** A readable size: "820 B", "14 KB", "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
