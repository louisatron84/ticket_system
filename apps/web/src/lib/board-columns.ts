import { DEFAULT_HIDDEN_STATUS_KEYS, type BoardColumnPrefs } from '@forge/shared';

// Which of a project's statuses a person sees as columns, and in what order. Pure, so the rules
// (what a saved choice means when the project's statuses have changed since) are tested on their own.

type HasStatus = { status: { key: string; sortOrder: number } };

export type ColumnLayout<T extends HasStatus> = { column: T; shown: boolean };

/**
 * Every column of the project exactly once, in the person's order, with whether it is shown.
 * Saved keys that name no column are ignored. A column the saved order has not seen (a status added
 * since) comes after the saved ones, in workflow order, and is shown unless it was hidden. With
 * nothing saved, the default order is the workflow and the default hidden list applies.
 */
export function arrangeColumns<T extends HasStatus>(
  columns: T[],
  saved: BoardColumnPrefs | undefined,
): { layout: ColumnLayout<T>[]; shown: T[] } {
  const byKey = new Map(columns.map((column) => [column.status.key, column] as const));
  const hidden = new Set<string>(saved ? saved.hidden : DEFAULT_HIDDEN_STATUS_KEYS);

  const ordered: T[] = [];
  const placed = new Set<string>();
  for (const key of saved?.order ?? []) {
    const column = byKey.get(key);
    if (column && !placed.has(key)) {
      ordered.push(column);
      placed.add(key);
    }
  }
  const rest = columns
    .filter((column) => !placed.has(column.status.key))
    .sort((a, b) => a.status.sortOrder - b.status.sortOrder);
  ordered.push(...rest);

  const layout = ordered.map((column) => ({ column, shown: !hidden.has(column.status.key) }));
  return { layout, shown: layout.filter((item) => item.shown).map((item) => item.column) };
}

/** What to save so that arranging the same columns again gives this very screen. */
export function prefsFromLayout(
  layout: { column: { status: { key: string } }; shown: boolean }[],
): BoardColumnPrefs {
  return {
    hidden: layout.filter((item) => !item.shown).map((item) => item.column.status.key),
    order: layout.map((item) => item.column.status.key),
  };
}

/** The order after moving one key a place up (-1) or down (1). Unchanged at the ends. */
export function moveColumn(order: string[], key: string, by: -1 | 1): string[] {
  const from = order.indexOf(key);
  const to = from + by;
  if (from === -1 || to < 0 || to >= order.length) return order;
  const next = [...order];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
