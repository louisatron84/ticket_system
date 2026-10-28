// Which tickets of the list are selected for a bulk change, by key. Pure, so the rules are tested
// without a page: the order is the order they were picked in, and a selection never holds a key
// that is no longer on the page (after a page change, a filter, or an archive).

export type SelectionAction =
  | { type: 'toggle'; key: string }
  /** Selects every key on the page; if they are all selected already, clears them instead. */
  | { type: 'toggleAll'; keys: string[] }
  | { type: 'clear' }
  /** The rows changed: keep only the keys still shown. */
  | { type: 'retain'; keys: string[] };

export function selectionReducer(selected: string[], action: SelectionAction): string[] {
  switch (action.type) {
    case 'toggle':
      return selected.includes(action.key)
        ? selected.filter((key) => key !== action.key)
        : [...selected, action.key];
    case 'toggleAll': {
      const all = action.keys.every((key) => selected.includes(key));
      if (all) return selected.filter((key) => !action.keys.includes(key));
      return [...selected, ...action.keys.filter((key) => !selected.includes(key))];
    }
    case 'clear':
      return selected.length === 0 ? selected : [];
    case 'retain': {
      const kept = selected.filter((key) => action.keys.includes(key));
      return kept.length === selected.length ? selected : kept;
    }
  }
}
