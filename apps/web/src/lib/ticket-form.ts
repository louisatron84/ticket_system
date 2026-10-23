import { hasControlCharacter, hasPermission, type StatusCategory } from '@forge/shared';

const ESTIMATE_FORMAT = 'Write it like 90, 45m, 1h 30m or 1.5h.';
const MAX_ESTIMATE_MINUTES = 99_999;

/**
 * Reads an estimate as people write it. A bare number is minutes. Otherwise hours and minutes in
 * words or letters: `45m`, `2h`, `1h 30m`, `1.5h`. An empty box means no estimate.
 */
export function parseEstimate(
  input: string,
): { ok: true; minutes: number | null } | { ok: false; message: string } {
  const text = input.trim().toLowerCase();
  if (text === '') return { ok: true, minutes: null };

  let minutes: number;
  if (/^\d+$/.test(text)) {
    minutes = Number(text);
  } else {
    const match =
      /^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes))?$/.exec(
        text,
      );
    if (!match || (match[1] === undefined && match[2] === undefined)) {
      return { ok: false, message: ESTIMATE_FORMAT };
    }
    minutes = Math.round(
      (match[1] ? Number(match[1]) * 60 : 0) + (match[2] ? Number(match[2]) : 0),
    );
  }

  if (minutes > MAX_ESTIMATE_MINUTES) return { ok: false, message: 'Use 99,999 minutes or fewer.' };
  return { ok: true, minutes };
}

// Description may run over several lines: tab, line feed and carriage return are fine.
const LINE_BREAKS_AND_TABS = [0x09, 0x0a, 0x0d];

export function validateTitle(title: string): string | undefined {
  const trimmed = title.trim();
  if (trimmed.length === 0) return 'Give the ticket a title.';
  if (trimmed.length > 200) return 'Use 200 characters or fewer.';
  if (hasControlCharacter(trimmed)) return 'Use plain text on one line.';
  return undefined;
}

export function validateComment(body: string): string | undefined {
  if (body.trim().length === 0) return 'Write something to comment.';
  if (body.trim().length > 10_000) return 'Use 10,000 characters or fewer.';
  if (hasControlCharacter(body, LINE_BREAKS_AND_TABS)) return 'Remove control characters.';
  return undefined;
}

export function validateDescription(description: string): string | undefined {
  if (description.length > 20_000) return 'Use 20,000 characters or fewer.';
  if (hasControlCharacter(description, LINE_BREAKS_AND_TABS)) return 'Remove control characters.';
  return undefined;
}

export function validateDueDate(value: string): string | undefined {
  if (value === '') return undefined;
  const real =
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    // An impossible month or day gives an invalid Date, whose toISOString() throws, so check first.
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  return real ? undefined : 'Use a real date, like 2030-01-31.';
}

export type TicketFormValues = {
  project: string;
  title: string;
  description: string;
  typeId: string;
  priorityId: string;
  dueDate: string;
  estimate: string;
};
export type TicketFormErrors = Partial<Record<keyof TicketFormValues, string>>;

/** The rules the server applies, checked while typing so mistakes show before a round trip. */
export function validateTicketForm(values: TicketFormValues): TicketFormErrors {
  const errors: TicketFormErrors = {};
  const set = (field: keyof TicketFormValues, message: string | undefined) => {
    if (message) errors[field] = message;
  };

  if (values.project === '') errors.project = 'Choose a project.';
  set('title', validateTitle(values.title));
  set('description', validateDescription(values.description));
  if (values.typeId === '') errors.typeId = 'Choose a type.';
  if (values.priorityId === '') errors.priorityId = 'Choose a priority.';
  set('dueDate', validateDueDate(values.dueDate));
  const estimate = parseEstimate(values.estimate);
  if (!estimate.ok) errors.estimate = estimate.message;
  return errors;
}

type StatusLike = { id: string; name: string; category: StatusCategory };

/** What the status control offers: where the ticket is now, then only where it is allowed to go. */
export function statusOptions(
  current: StatusLike,
  allowed: StatusLike[],
): (StatusLike & { current: boolean })[] {
  return [
    { ...current, current: true },
    ...allowed
      .filter((status) => status.id !== current.id)
      .map((status) => ({ ...status, current: false })),
  ];
}

/**
 * What this person gets on a ticket page. The server decides in the end; this only decides which
 * controls to draw. Assigning needs editing too, because the change is an edit.
 */
export function fieldPermissions(permissions: readonly string[]) {
  const canEdit = hasPermission(permissions, 'tickets.edit');
  return {
    canEdit,
    canAssign: canEdit && hasPermission(permissions, 'tickets.assign'),
    canComment: hasPermission(permissions, 'tickets.comment'),
    canCreate: hasPermission(permissions, 'tickets.create'),
  };
}
