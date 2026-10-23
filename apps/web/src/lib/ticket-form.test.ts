import { describe, expect, it } from 'vitest';
import {
  fieldPermissions,
  parseEstimate,
  statusOptions,
  validateComment,
  validateTicketForm,
} from './ticket-form';

describe('parseEstimate', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['90', 90],
    ['0', 0],
    ['45m', 45],
    ['45 m', 45],
    ['45 min', 45],
    ['2h', 120],
    ['2 h', 120],
    ['2 hours', 120],
    ['1h 30m', 90],
    ['1h30m', 90],
    ['1H 30M', 90],
    ['1.5h', 90],
    ['0.5h', 30],
    ['1.25h', 75],
    ['1h 90m', 150],
    ['99999', 99_999],
  ])('reads %j as %j minutes', (input, minutes) => {
    expect(parseEstimate(input)).toEqual({ ok: true, minutes });
  });

  it.each([
    ['abc', 'Write it like 90, 45m, 1h 30m or 1.5h.'],
    ['-5', 'Write it like 90, 45m, 1h 30m or 1.5h.'],
    ['1.5', 'Write it like 90, 45m, 1h 30m or 1.5h.'],
    ['1d', 'Write it like 90, 45m, 1h 30m or 1.5h.'],
    ['1h 30', 'Write it like 90, 45m, 1h 30m or 1.5h.'],
    ['h', 'Write it like 90, 45m, 1h 30m or 1.5h.'],
    ['1,5h', 'Write it like 90, 45m, 1h 30m or 1.5h.'],
    ['100000', 'Use 99,999 minutes or fewer.'],
    ['2000h', 'Use 99,999 minutes or fewer.'],
  ])('refuses %j', (input, message) => {
    expect(parseEstimate(input)).toEqual({ ok: false, message });
  });
});

describe('validateTicketForm', () => {
  const valid = {
    project: 'WEB',
    title: 'Fix the login redirect',
    description: '',
    typeId: 'type-id',
    priorityId: 'priority-id',
    dueDate: '',
    estimate: '',
  };

  it('accepts a complete form, with or without the optional parts', () => {
    expect(validateTicketForm(valid)).toEqual({});
    expect(
      validateTicketForm({
        ...valid,
        description: 'Steps\nto reproduce',
        dueDate: '2030-01-31',
        estimate: '1h 30m',
      }),
    ).toEqual({});
  });

  it('wants a title, and not a blank one', () => {
    expect(validateTicketForm({ ...valid, title: '' }).title).toBe('Give the ticket a title.');
    expect(validateTicketForm({ ...valid, title: '   ' }).title).toBe('Give the ticket a title.');
  });

  it('allows 200 characters of title and no more', () => {
    expect(validateTicketForm({ ...valid, title: 'a'.repeat(200) })).toEqual({});
    expect(validateTicketForm({ ...valid, title: 'a'.repeat(201) }).title).toBe(
      'Use 200 characters or fewer.',
    );
  });

  it('keeps the title to one line of plain text', () => {
    expect(validateTicketForm({ ...valid, title: 'a\nb' }).title).toBe(
      'Use plain text on one line.',
    );
    expect(validateTicketForm({ ...valid, title: 'a\u0000b' }).title).toBe(
      'Use plain text on one line.',
    );
  });

  it('accepts markup, emoji and right-to-left text as plain text', () => {
    expect(
      validateTicketForm({ ...valid, title: '<img src=x onerror=alert(1)> مرحبا 👋' }),
    ).toEqual({});
  });

  it('allows 20,000 characters of description, with line breaks, and no more', () => {
    expect(validateTicketForm({ ...valid, description: 'a'.repeat(20_000) })).toEqual({});
    expect(validateTicketForm({ ...valid, description: 'a'.repeat(20_001) }).description).toBe(
      'Use 20,000 characters or fewer.',
    );
    expect(validateTicketForm({ ...valid, description: 'a\u0007b' }).description).toBe(
      'Remove control characters.',
    );
  });

  it('wants a project, a type and a priority', () => {
    expect(validateTicketForm({ ...valid, project: '' }).project).toBe('Choose a project.');
    expect(validateTicketForm({ ...valid, typeId: '' }).typeId).toBe('Choose a type.');
    expect(validateTicketForm({ ...valid, priorityId: '' }).priorityId).toBe('Choose a priority.');
  });

  it.each([
    ['2030-01-31', true],
    ['2030-02-29', false],
    ['2032-02-29', true],
    ['2030-13-01', false],
    ['31/01/2030', false],
    ['tomorrow', false],
    ['', true],
  ])('says the due date %j is valid: %s', (dueDate, ok) => {
    const errors = validateTicketForm({ ...valid, dueDate });
    expect(errors.dueDate === undefined).toBe(ok);
    if (!ok) expect(errors.dueDate).toBe('Use a real date, like 2030-01-31.');
  });

  it('reports a bad estimate in its own words', () => {
    expect(validateTicketForm({ ...valid, estimate: 'soon' }).estimate).toBe(
      'Write it like 90, 45m, 1h 30m or 1.5h.',
    );
  });

  it('reports every problem at once', () => {
    expect(
      Object.keys(
        validateTicketForm({
          project: '',
          title: '',
          description: '',
          typeId: '',
          priorityId: '',
          dueDate: 'x',
          estimate: 'x',
        }),
      ),
    ).toEqual(['project', 'title', 'typeId', 'priorityId', 'dueDate', 'estimate']);
  });
});

describe('statusOptions', () => {
  const current = { id: 's1', name: 'Open', category: 'not_started' as const };
  const allowed = [
    { id: 's2', name: 'In Progress', category: 'in_progress' as const },
    { id: 's3', name: 'Blocked', category: 'in_progress' as const },
  ];

  it('lists the current status first, then only the ones it may move to', () => {
    expect(statusOptions(current, allowed).map((option) => option.id)).toEqual(['s1', 's2', 's3']);
  });

  it('marks which one is the current status', () => {
    expect(statusOptions(current, allowed).map((option) => option.current)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('never lists the current status twice, even if the API lists it', () => {
    expect(statusOptions(current, [current, ...allowed]).map((option) => option.id)).toEqual([
      's1',
      's2',
      's3',
    ]);
  });

  it('offers nothing but the current status when there is nowhere to go', () => {
    expect(statusOptions(current, [])).toHaveLength(1);
  });
});

describe('fieldPermissions', () => {
  const held = (...permissions: string[]) => fieldPermissions(permissions);

  it('lets someone who may edit change the fields, but not the assignee on their own', () => {
    expect(held('tickets.view', 'tickets.edit')).toEqual({
      canEdit: true,
      canAssign: false,
      canComment: false,
      canCreate: false,
    });
  });

  it('lets someone who may edit and assign change the assignee too', () => {
    expect(held('tickets.view', 'tickets.edit', 'tickets.assign').canAssign).toBe(true);
  });

  it('does not let assign without edit do anything, because the server refuses it', () => {
    expect(held('tickets.view', 'tickets.assign')).toMatchObject({
      canEdit: false,
      canAssign: false,
    });
  });

  it('gives a reviewer a comment box and no field controls', () => {
    expect(held('tickets.view', 'tickets.comment')).toEqual({
      canEdit: false,
      canAssign: false,
      canComment: true,
      canCreate: false,
    });
  });

  it('gives someone who can only view nothing to change', () => {
    expect(held('tickets.view')).toEqual({
      canEdit: false,
      canAssign: false,
      canComment: false,
      canCreate: false,
    });
  });

  it('reports who may create tickets', () => {
    expect(held('tickets.view', 'tickets.create').canCreate).toBe(true);
  });
});

describe('validateComment', () => {
  it('accepts ordinary text, line breaks and non-Latin text', () => {
    expect(validateComment('Looks good')).toBeUndefined();
    expect(validateComment('line one\r\n\tline two')).toBeUndefined();
    expect(validateComment('مرحبا 👋 世界 <b>not markup</b>')).toBeUndefined();
  });

  it('wants something written', () => {
    expect(validateComment('')).toBe('Write something to comment.');
    expect(validateComment(' \n\t ')).toBe('Write something to comment.');
  });

  it('allows 10,000 characters and no more', () => {
    expect(validateComment('a'.repeat(10_000))).toBeUndefined();
    expect(validateComment('a'.repeat(10_001))).toBe('Use 10,000 characters or fewer.');
  });

  it('refuses control characters other than tab and line breaks', () => {
    expect(validateComment('a\u0000b')).toBe('Remove control characters.');
    expect(validateComment('a\u000Bb')).toBe('Remove control characters.');
  });
});
