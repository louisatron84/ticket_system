import type { TicketConfig, TicketTemplate } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  availableFrom,
  blankDraft,
  bodyOf,
  draftOf,
  moved,
  validateDraft,
  withPrefix,
  withoutPrefix,
  type TemplateFill,
} from './templates';

const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const PROJECT = id(100);
const OTHER_PROJECT = id(101);

const config: TicketConfig = {
  // The config lists inactive ones too, flagged; id(9), id(19) and id(33) are retired.
  types: [
    { id: id(1), key: 'task', name: 'Task', sortOrder: 1, active: true },
    { id: id(2), key: 'bug', name: 'Bug', sortOrder: 2, active: true },
    { id: id(9), key: 'old', name: 'Old', sortOrder: 3, active: false },
  ],
  priorities: [
    { id: id(11), key: 'normal', name: 'Flame', rank: 3, active: true },
    { id: id(12), key: 'high', name: 'Blaze', rank: 4, active: true },
    { id: id(19), key: 'old', name: 'Old', rank: 5, active: false },
  ],
  labels: [
    { id: id(21), name: 'bug', color: 'red' },
    { id: id(22), name: 'frontend', color: 'blue' },
  ],
  components: [
    { id: id(31), projectId: PROJECT, name: 'Checkout', active: true },
    { id: id(32), projectId: OTHER_PROJECT, name: 'Gateway', active: true },
    { id: id(33), projectId: PROJECT, name: 'Legacy', active: false },
  ],
};
const available = availableFrom(config, PROJECT);

const template = (patch: Partial<TicketTemplate> = {}): TicketTemplate => ({
  id: id(50),
  name: 'Bug report',
  titlePrefix: '',
  typeId: null,
  priorityId: null,
  componentId: null,
  labelIds: [],
  goal: '',
  criteria: [],
  description: '',
  ...patch,
});

const form = (patch: Partial<TemplateFill> = {}): TemplateFill => ({
  title: '',
  typeId: id(1),
  priorityId: id(11),
  componentId: '',
  labelIds: [],
  goal: '',
  criteria: '',
  description: '',
  ...patch,
});

describe('the title prefix', () => {
  it.each([
    ['', '[Bug]', '[Bug] '],
    ['Login loops', '[Bug]', '[Bug] Login loops'],
    ['  Login loops', '[Bug]', '[Bug] Login loops'],
    ['[Bug] Login loops', '[Bug]', '[Bug] Login loops'],
    ['[Bug]', '[Bug]', '[Bug]'],
    ['Login loops', '', 'Login loops'],
  ])('%j with %j becomes %j', (title, prefix, expected) => {
    expect(withPrefix(title, prefix)).toBe(expected);
  });

  it.each([
    ['[Bug] Login loops', '[Bug]', 'Login loops'],
    ['[Bug] ', '[Bug]', ''],
    ['[Bug]', '[Bug]', ''],
    ['[Bug]Login', '[Bug]', '[Bug]Login'],
    ['Login loops', '[Bug]', 'Login loops'],
    ['Login loops', '', 'Login loops'],
  ])('%j without %j is %j', (title, prefix, expected) => {
    expect(withoutPrefix(title, prefix)).toBe(expected);
  });
});

describe('applyTemplate', () => {
  it('fills every field the template sets, keeping what the person typed in the title', () => {
    const filled = applyTemplate(
      form({ title: 'Login loops' }),
      template({
        titlePrefix: '[Bug]',
        typeId: id(2),
        priorityId: id(12),
        componentId: id(31),
        labelIds: [id(21), id(22)],
        goal: 'Find it.',
        criteria: ['Reproduced', 'Fixed'],
        description: '**Steps**',
      }),
      available,
      null,
    );
    expect(filled).toEqual({
      title: '[Bug] Login loops',
      typeId: id(2),
      priorityId: id(12),
      componentId: id(31),
      labelIds: [id(21), id(22)],
      goal: 'Find it.',
      criteria: 'Reproduced\nFixed',
      description: '**Steps**',
    });
  });

  it('leaves alone whatever the template does not set', () => {
    const before = form({
      title: 'Typed',
      componentId: id(31),
      labelIds: [id(22)],
      goal: 'Mine',
      criteria: 'One',
      description: 'Notes',
    });
    expect(applyTemplate(before, template(), available, null)).toEqual(before);
  });

  it('skips quietly a type, priority, component or label that is no longer offered', () => {
    const before = form({ componentId: id(31), labelIds: [id(22)] });
    const filled = applyTemplate(
      before,
      template({
        typeId: id(9), // made inactive
        priorityId: id(19), // made inactive
        componentId: id(32), // another project's
        labelIds: [id(29)], // deleted
        goal: 'Still filled',
      }),
      available,
      null,
    );
    expect(filled).toEqual({ ...before, goal: 'Still filled' });
    // An inactive component of the project itself is skipped the same way.
    expect(applyTemplate(before, template({ componentId: id(33) }), available, null)).toEqual(
      before,
    );
  });

  it('keeps the labels that are still there and drops the rest', () => {
    const filled = applyTemplate(form(), template({ labelIds: [id(29), id(21)] }), available, null);
    expect(filled.labelIds).toEqual([id(21)]);
  });

  it('swaps one template’s prefix for the next one’s', () => {
    const first = template({ titlePrefix: '[Bug]' });
    const second = template({ id: id(51), titlePrefix: '[Feature]' });
    const once = applyTemplate(form({ title: 'Login' }), first, available, null);
    expect(once.title).toBe('[Bug] Login');
    expect(applyTemplate(once, second, available, first).title).toBe('[Feature] Login');
    // A template without a prefix takes the old one away.
    expect(applyTemplate(once, template({ id: id(52) }), available, first).title).toBe('Login');
  });

  it('does not touch a prefix the person has already edited away', () => {
    const first = template({ titlePrefix: '[Bug]' });
    const second = template({ id: id(51), titlePrefix: '[Feature]' });
    expect(applyTemplate(form({ title: 'Bug: Login' }), second, available, first).title).toBe(
      '[Feature] Bug: Login',
    );
  });
});

describe('the settings draft', () => {
  it('round-trips a template into a full request body', () => {
    const stored = template({
      titlePrefix: '[Bug]',
      typeId: id(2),
      priorityId: id(12),
      componentId: id(31),
      labelIds: [id(21)],
      goal: 'Find it.',
      criteria: ['Reproduced', 'Fixed'],
      description: 'Notes',
    });
    expect(bodyOf(draftOf(stored, available))).toEqual({
      name: 'Bug report',
      titlePrefix: '[Bug]',
      typeId: id(2),
      priorityId: id(12),
      componentId: id(31),
      labelIds: [id(21)],
      goal: 'Find it.',
      criteria: ['Reproduced', 'Fixed'],
      description: 'Notes',
    });
  });

  it('shows a retired value as none, so saving again does not fail on it', () => {
    const draft = draftOf(
      template({ typeId: id(9), priorityId: id(19), componentId: id(32), labelIds: [id(29)] }),
      available,
    );
    expect(draft).toMatchObject({ typeId: '', priorityId: '', componentId: '', labelIds: [] });
  });

  it('sends empty choices as null, trims the name and prefix, and skips blank criteria', () => {
    expect(
      bodyOf({ ...blankDraft, name: '  Plain  ', titlePrefix: ' [x] ', criteria: 'a\n\n  b  \n' }),
    ).toEqual({
      name: 'Plain',
      titlePrefix: '[x]',
      typeId: null,
      priorityId: null,
      componentId: null,
      labelIds: [],
      goal: '',
      criteria: ['a', 'b'],
      description: '',
    });
  });

  it.each([
    [{ name: '' }, 'name', 'Give the template a name.'],
    [{ name: '   ' }, 'name', 'Give the template a name.'],
    [{ name: 'a'.repeat(61) }, 'name', 'Use 60 characters or fewer.'],
    [{ name: 'a\u0007' }, 'name', 'Use plain text on one line.'],
    [{ name: 'T', titlePrefix: 'p'.repeat(61) }, 'titlePrefix', 'Use 60 characters or fewer.'],
    [{ name: 'T', goal: 'g'.repeat(501) }, 'goal', 'Use 500 characters or fewer.'],
    [
      { name: 'T', criteria: 'c'.repeat(301) },
      'criteria',
      'Criterion 1 is longer than 300 characters.',
    ],
    [
      { name: 'T', description: 'd'.repeat(20_001) },
      'description',
      'Use 20,000 characters or fewer.',
    ],
  ])('refuses %j on %s', (patch, field, message) => {
    expect(validateDraft({ ...blankDraft, ...patch })).toEqual({ [field]: message });
  });

  it('accepts a template with only a name', () => {
    expect(validateDraft({ ...blankDraft, name: 'Plain' })).toEqual({});
  });
});

describe('moved', () => {
  it.each([
    [0, 1, ['b', 'a', 'c']],
    [2, -1, ['a', 'c', 'b']],
    [0, -1, ['a', 'b', 'c']],
    [2, 1, ['a', 'b', 'c']],
  ])('moves item %i by %i', (index, by, expected) => {
    expect(moved(['a', 'b', 'c'], index, by)).toEqual(expected);
  });
});
