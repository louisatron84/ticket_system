import { z } from 'zod';
import { PROJECT_KEY_PATTERN, STATUS_KEY_PATTERN } from './tickets';

// How a person likes their board to look. These choices belong to the person, not to the project:
// they follow the person to every board they open.

/** The things a card can show or hide. Its key, title and assignee are always shown. */
export const CARD_FIELD_KEYS = [
  'labels',
  'dueDate',
  'priority',
  'comments',
  'criteria',
  'type',
] as const;

export type CardFields = Record<(typeof CARD_FIELD_KEYS)[number], boolean>;

/** Everything is shown except the type icon, which the card is clear enough without. */
export const DEFAULT_CARD_FIELDS: CardFields = {
  labels: true,
  dueDate: true,
  priority: true,
  comments: true,
  criteria: true,
  type: false,
};

/** At most this many custom fields on a card. */
export const MAX_CARD_CUSTOM_FIELDS = 10;

export const BOARD_DENSITIES = ['comfortable', 'compact'] as const;
export type BoardDensity = (typeof BOARD_DENSITIES)[number];

/** Every ticket, or only those with no parent (the big picture). */
export const BOARD_SHOWS = ['all', 'top'] as const;
export type BoardShow = (typeof BOARD_SHOWS)[number];

/** No lanes, or one lane (swimlane) per project. Lanes are offered on the Tickets board only. */
export const BOARD_LANES = ['none', 'project'] as const;
export type BoardLanes = (typeof BOARD_LANES)[number];

/** What is saved: any part of it may be missing, and a missing part means the default. */
export const boardDisplaySchema = z
  .strictObject({
    fields: z
      .strictObject({
        labels: z.boolean(),
        dueDate: z.boolean(),
        priority: z.boolean(),
        comments: z.boolean(),
        criteria: z.boolean(),
        type: z.boolean(),
      })
      .partial(),
    density: z.enum(BOARD_DENSITIES),
    heat: z.boolean(),
    show: z.enum(BOARD_SHOWS),
    lanes: z.enum(BOARD_LANES),
    /** Custom fields shown on cards, by id, in the order they were switched on. */
    customFields: z
      .array(z.uuid())
      .max(MAX_CARD_CUSTOM_FIELDS)
      .refine((ids) => new Set(ids).size === ids.length, 'Each field may be listed only once.'),
  })
  .partial();
export type BoardDisplayPrefs = z.infer<typeof boardDisplaySchema>;

/** The display with every choice settled. */
export type BoardDisplay = {
  fields: CardFields;
  density: BoardDensity;
  heat: boolean;
  show: BoardShow;
  lanes: BoardLanes;
  /** Custom fields are off by default: none is shown until the person switches it on. */
  customFields: string[];
};

export const DEFAULT_BOARD_DISPLAY: BoardDisplay = {
  fields: DEFAULT_CARD_FIELDS,
  density: 'comfortable',
  heat: true,
  show: 'all',
  lanes: 'none',
  customFields: [],
};

/** Switches one custom field on or off for cards. */
export function toggleCardCustomField(display: BoardDisplay, fieldId: string): string[] {
  return display.customFields.includes(fieldId)
    ? display.customFields.filter((id) => id !== fieldId)
    : [...display.customFields, fieldId].slice(-MAX_CARD_CUSTOM_FIELDS);
}

/** Saved choices laid over the defaults, field by field. */
export function resolveBoardDisplay(saved: BoardDisplayPrefs | undefined): BoardDisplay {
  return applyDisplayChange(DEFAULT_BOARD_DISPLAY, saved ?? {});
}

/**
 * The change that puts back what `change` altered, taking the values from `previous`. Used when a
 * save fails: it undoes only that change, not anything the person did since.
 */
export function undoOf(previous: BoardDisplay, change: BoardDisplayPrefs): BoardDisplayPrefs {
  const undo: BoardDisplayPrefs = {};
  if (change.fields) {
    const fields: Partial<CardFields> = {};
    for (const key of CARD_FIELD_KEYS) {
      if (change.fields[key] !== undefined) fields[key] = previous.fields[key];
    }
    undo.fields = fields;
  }
  if (change.density !== undefined) undo.density = previous.density;
  if (change.heat !== undefined) undo.heat = previous.heat;
  if (change.show !== undefined) undo.show = previous.show;
  if (change.lanes !== undefined) undo.lanes = previous.lanes;
  if (change.customFields !== undefined) undo.customFields = previous.customFields;
  return undo;
}

/** The display after a change. Neither argument is modified. */
export function applyDisplayChange(current: BoardDisplay, change: BoardDisplayPrefs): BoardDisplay {
  return {
    fields: { ...current.fields, ...change.fields },
    density: change.density ?? current.density,
    heat: change.heat ?? current.heat,
    show: change.show ?? current.show,
    lanes: change.lanes ?? current.lanes,
    customFields: change.customFields ?? current.customFields,
  };
}

// ---------------------------------------------------------------------------
// Columns: which statuses a person shows on a project's board, and in what order
// ---------------------------------------------------------------------------

const statusKey = z.string().regex(STATUS_KEY_PATTERN);

/** One person's choice for one project. Statuses are named by key, so renaming one changes nothing. */
export const boardColumnPrefsSchema = z.strictObject({
  hidden: z.array(statusKey).max(20),
  order: z.array(statusKey).max(20),
});
export type BoardColumnPrefs = z.infer<typeof boardColumnPrefsSchema>;

/** What a project's board hides until the person chooses otherwise: Scrapped (cancelled) work. */
export const DEFAULT_HIDDEN_STATUS_KEYS = ['cancelled'] as const;

export const MAX_REMEMBERED_PROJECTS = 100;

/** By project key. A null entry means "forget this project's choice" and is never stored. */
export const boardColumnsSchema = z
  .record(z.string().regex(PROJECT_KEY_PATTERN), boardColumnPrefsSchema.nullable())
  .refine(
    (projects) => Object.keys(projects).length <= MAX_REMEMBERED_PROJECTS,
    `At most ${MAX_REMEMBERED_PROJECTS} projects can be remembered.`,
  );
