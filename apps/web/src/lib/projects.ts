import { PROJECT_KEY_PATTERN, hasControlCharacter } from '@forge/shared';

export type ProjectFormValues = { name: string; key: string; description: string };
export type ProjectFormErrors = Partial<Record<keyof ProjectFormValues, string>>;

// Description may run over several lines: tab, line feed and carriage return are fine.
const LINE_BREAKS_AND_TABS = [0x09, 0x0a, 0x0d];

/** Keeps a key to what a key can be as someone types it: capitals and digits, ten at most. */
export function cleanKeyInput(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
}

/**
 * The same rules the server applies, so mistakes show while typing instead of after a round trip.
 * The server still checks everything; this only saves the wait.
 */
export function validateProjectForm(values: ProjectFormValues): ProjectFormErrors {
  const errors: ProjectFormErrors = {};

  const name = values.name.trim();
  if (name.length === 0) errors.name = 'Give the project a name.';
  else if (name.length > 80) errors.name = 'Use 80 characters or fewer.';
  else if (hasControlCharacter(name)) errors.name = 'Use plain text on one line.';

  if (values.key.length === 0) errors.key = 'Choose a key.';
  else if (!PROJECT_KEY_PATTERN.test(values.key)) {
    errors.key = 'Use 2 to 10 capital letters or digits, starting with a letter.';
  }

  if (values.description.length > 2000) errors.description = 'Use 2000 characters or fewer.';
  else if (hasControlCharacter(values.description, LINE_BREAKS_AND_TABS)) {
    errors.description = 'Remove control characters.';
  }

  return errors;
}
