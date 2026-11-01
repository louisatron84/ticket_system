import {
  TRANSITION_RULES,
  type SaveTransitionsBody,
  type TransitionRule,
  type WorkflowConfig,
} from '@forge/shared';

// Pure state for the workflow editor's transitions grid, so the grid can be edited freely and
// saved as a whole. Nothing here knows about the network or the page.

/** The grid being edited: each allowed move, by "from>to", with its rules. */
export type GridDraft = Readonly<Record<string, readonly TransitionRule[]>>;

export const cellKey = (fromStatusId: string, toStatusId: string) =>
  `${fromStatusId}>${toStatusId}`;

/** The draft for a saved workflow: every move between its active statuses. */
export function draftOf(workflow: WorkflowConfig): GridDraft {
  const active = new Set(workflow.statuses.filter((s) => s.active).map((s) => s.id));
  const draft: Record<string, TransitionRule[]> = {};
  for (const t of workflow.transitions) {
    if (active.has(t.fromStatusId) && active.has(t.toStatusId)) {
      draft[cellKey(t.fromStatusId, t.toStatusId)] = sortRules(t.rules);
    }
  }
  return draft;
}

/** Rules in the fixed order of the list, each once. */
export const sortRules = (rules: readonly TransitionRule[]): TransitionRule[] =>
  TRANSITION_RULES.filter((rule) => rules.includes(rule));

/** Allows the move, or takes it away (with its rules). A status never moves to itself. */
export function toggleMove(draft: GridDraft, from: string, to: string): GridDraft {
  if (from === to) return draft;
  const key = cellKey(from, to);
  if (key in draft) {
    const { [key]: _removed, ...rest } = draft;
    return rest;
  }
  return { ...draft, [key]: [] };
}

/** Turns one rule of an allowed move on or off. A move that is not allowed is left alone. */
export function toggleRule(
  draft: GridDraft,
  from: string,
  to: string,
  rule: TransitionRule,
): GridDraft {
  const key = cellKey(from, to);
  const rules = draft[key];
  if (!rules) return draft;
  const next = rules.includes(rule) ? rules.filter((r) => r !== rule) : [...rules, rule];
  return { ...draft, [key]: sortRules(next) };
}

/** Whether the draft differs from what is saved. */
export function isDirty(draft: GridDraft, saved: GridDraft): boolean {
  const keys = Object.keys(draft);
  if (keys.length !== Object.keys(saved).length) return true;
  return keys.some((key) => {
    const a = draft[key]!;
    const b = saved[key];
    return !b || a.length !== b.length || a.some((rule, i) => rule !== b[i]);
  });
}

/** The draft as the moves to save, in a stable order. */
export function transitionsOf(draft: GridDraft): SaveTransitionsBody['transitions'] {
  return Object.keys(draft)
    .sort()
    .map((key) => {
      const [fromStatusId, toStatusId] = key.split('>') as [string, string];
      return { fromStatusId, toStatusId, rules: [...draft[key]!] };
    });
}

/** The ids with one moved a place up (-1) or down (+1); the same list at either end. */
export function moveInOrder(ids: readonly string[], id: string, by: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + by;
  if (from === -1 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
