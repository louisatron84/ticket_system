// Single-key shortcuts and what each one means. Pure, so the rules are tested without a page: a key
// typed into a field is text, never a shortcut, and keys held with Ctrl, Cmd or Alt belong to the
// browser (Ctrl/Cmd+K is the command menu's, which listens for it itself).

export type ShortcutAction =
  | 'help'
  | 'search'
  | 'create'
  | 'next'
  | 'previous'
  | 'select'
  | 'assign-me'
  | 'move'
  | 'go-projects'
  | 'go-tickets'
  | 'go-board';

export type KeyPress = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** `type` is an input's type, so a checkbox (which takes no text) does not block shortcuts. */
  target: { tagName: string; type?: string; isContentEditable: boolean } | null;
};

/** How long `g` waits for the second key, in milliseconds. */
export const SEQUENCE_TIMEOUT_MS = 1000;

/** Every shortcut, for the shortcut sheet. */
export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: 'Ctrl K', does: 'Open the command menu (Cmd K on a Mac)' },
  { keys: '?', does: 'Show these shortcuts' },
  { keys: '/', does: 'Search the list or board' },
  { keys: 'c', does: 'New ticket' },
  { keys: 'g then p', does: 'Go to Projects' },
  { keys: 'g then t', does: 'Go to the Tickets list' },
  { keys: 'g then b', does: 'Go to the Tickets board' },
  { keys: 'j / k', does: 'Next or previous ticket in the list' },
  { keys: 'x', does: 'Select the ticket in the list' },
  { keys: 'a', does: 'Assign the open ticket to me' },
  { keys: 'm', does: 'Move the open ticket to another status' },
];

const SINGLE: Record<string, ShortcutAction> = {
  '?': 'help',
  '/': 'search',
  c: 'create',
  j: 'next',
  k: 'previous',
  x: 'select',
  a: 'assign-me',
  m: 'move',
};

const AFTER_G: Record<string, ShortcutAction> = {
  p: 'go-projects',
  t: 'go-tickets',
  b: 'go-board',
};

/** Inputs that take no typed text: a key pressed on one of them is still a shortcut. */
const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset']);

const typing = (target: KeyPress['target']) =>
  target !== null &&
  (target.isContentEditable ||
    ['TEXTAREA', 'SELECT'].includes(target.tagName) ||
    (target.tagName === 'INPUT' && !NOT_TEXT.has(target.type ?? 'text')));

/**
 * What a key press means. `pending` is `g` when the previous key started a two-key sequence;
 * the result says to wait for the next key, or names the action, or is null for nothing.
 */
export function shortcutFor(
  event: KeyPress,
  pending: 'g' | null,
): { action: ShortcutAction } | { pending: 'g' } | null {
  if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return null;
  if (pending === 'g') {
    const action = AFTER_G[event.key];
    return action ? { action } : null;
  }
  if (event.key === 'g') return { pending: 'g' };
  const action = SINGLE[event.key];
  return action ? { action } : null;
}
