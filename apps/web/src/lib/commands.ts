// The command menu's entries and how a typed query orders them. Pure, so the ordering is tested
// without a page.

export type CommandGroup = 'Actions' | 'Tickets' | 'Projects' | 'Views' | 'Pages';

/** One thing the menu can do: go somewhere (`href`) or act (`run`). `hint` is a key, if any. */
export type Command = {
  id: string;
  group: CommandGroup;
  label: string;
  hint?: string;
} & ({ href: string; run?: never } | { run: () => void; href?: never });

/** How well a command matches: lower is better; null is no match. */
function score(query: string, command: Command): number | null {
  const hint = command.hint?.toLowerCase() ?? '';
  const label = command.label.toLowerCase();
  if (hint.startsWith(query)) return 0;
  if (label.startsWith(query) || label.split(/\s+/).some((word) => word.startsWith(query))) {
    return 1;
  }
  if (hint.includes(query) || label.includes(query)) return 2;
  return null;
}

/**
 * The commands that match the query, best first: a key that starts with it, then a word of the
 * label that starts with it, then anything containing it. Ties keep their given order, and an empty
 * query keeps everything as it is.
 */
export function rankCommands(query: string, commands: readonly Command[]): Command[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [...commands];
  return commands
    .map((command, index) => ({ command, index, score: score(wanted, command) }))
    .filter((entry): entry is typeof entry & { score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.command);
}
