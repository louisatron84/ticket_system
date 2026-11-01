import { describe, expect, it } from 'vitest';
import {
  createCustomFieldBodySchema,
  fieldApplies,
  formatFieldNumber,
  parseFieldFilter,
  parseFieldValue,
  setFieldValueBodySchema,
  updateCustomFieldBodySchema,
  type CustomFieldKind,
} from './custom-fields';
import { describeTicketEvent } from './ticket-events';

const id = '01a1656b-1a49-7146-94ac-1c72df43ddb4';
const other = '01a1656b-1a49-7146-94ac-1c72df43ddb5';

describe('parseFieldValue', () => {
  const accepted: [CustomFieldKind, unknown, unknown][] = [
    ['text', '  Acme Ltd  ', 'Acme Ltd'],
    ['text', 'x'.repeat(500), 'x'.repeat(500)],
    ['text', '   ', null],
    ['long_text', 'Line one\n\tLine two', 'Line one\n\tLine two'],
    ['long_text', 'x'.repeat(10_000), 'x'.repeat(10_000)],
    ['long_text', '\n\n', null],
    ['number', 0, 0],
    ['number', -3.25, -3.25],
    ['boolean', false, false],
    ['date', '2028-02-29', '2028-02-29'],
    ['url', ' https://example.com/a?b=c ', 'https://example.com/a?b=c'],
    ['url', 'http://localhost:3000', 'http://localhost:3000'],
    ['select', id, id],
    ['person', id, id],
    ['multi_select', [id, other], [id, other]],
    ['multi_select', [], null],
  ];
  it.each(accepted)('%s accepts %j', (kind, value, stored) => {
    expect(parseFieldValue(kind, value)).toEqual({ ok: true, value: stored });
  });

  it('treats null as clearing, for every kind', () => {
    for (const kind of ['text', 'number', 'boolean', 'multi_select'] as const) {
      expect(parseFieldValue(kind, null)).toEqual({ ok: true, value: null });
    }
  });

  const refused: [CustomFieldKind, unknown][] = [
    ['text', 'x'.repeat(501)],
    ['text', 'a\nb'],
    ['text', 'a\u0000b'],
    ['text', 7],
    ['long_text', 'x'.repeat(10_001)],
    ['long_text', 'a\u0007b'],
    ['long_text', 'a‮b'],
    ['number', '5'],
    ['number', Number.POSITIVE_INFINITY],
    ['number', Number.NaN],
    ['boolean', 'yes'],
    ['boolean', 1],
    ['date', '2027-02-29'],
    ['date', '2026-13-01'],
    ['date', '29/10/2026'],
    ['url', 'javascript:alert(1)'],
    ['url', 'ftp://example.com'],
    ['url', 'example.com'],
    ['url', 'https://exa mple.com'],
    ['url', `https://example.com/${'a'.repeat(2000)}`],
    ['select', 'not-an-id'],
    ['select', [id]],
    ['person', 42],
    ['multi_select', id],
    ['multi_select', [id, id]],
    [
      'multi_select',
      Array.from({ length: 21 }, (_, i) => id.slice(0, -2) + `${i}`.padStart(2, '0')),
    ],
  ];
  it.each(refused)('%s refuses %j', (kind, value) => {
    const result = parseFieldValue(kind, value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/\.$/);
  });
});

describe('field bodies', () => {
  it('creates a select field with its first options', () => {
    expect(
      createCustomFieldBodySchema.parse({
        name: ' Customer ',
        kind: 'select',
        options: ['A', 'B'],
      }),
    ).toEqual({ name: 'Customer', kind: 'select', options: ['A', 'B'] });
  });

  it.each([
    ['an unknown kind', { name: 'X', kind: 'formula' }],
    ['options on a text field', { name: 'X', kind: 'text', options: ['A'] }],
    ['two options of the same name', { name: 'X', kind: 'select', options: ['A', 'a'] }],
    ['the same type twice', { name: 'X', kind: 'text', typeIds: [id, id] }],
    ['a name that is too long', { name: 'x'.repeat(61), kind: 'text' }],
    ['a workspace the client chose', { name: 'X', kind: 'text', organisationId: id }],
  ])('refuses %s', (_name, body) => {
    expect(createCustomFieldBodySchema.safeParse(body).success).toBe(false);
  });

  it('never changes the kind, and needs something to change', () => {
    expect(updateCustomFieldBodySchema.safeParse({ kind: 'number' }).success).toBe(false);
    expect(updateCustomFieldBodySchema.safeParse({}).success).toBe(false);
    expect(updateCustomFieldBodySchema.parse({ active: false })).toEqual({ active: false });
  });

  it('needs the version with a value', () => {
    expect(setFieldValueBodySchema.safeParse({ value: 'x' }).success).toBe(false);
    expect(setFieldValueBodySchema.parse({ version: 3, value: null })).toEqual({
      version: 3,
      value: null,
    });
  });
});

describe('fieldApplies', () => {
  it('applies an active field to every type when it names none', () => {
    expect(fieldApplies({ active: true, typeIds: [] }, id)).toBe(true);
    expect(fieldApplies({ active: true, typeIds: [other] }, id)).toBe(false);
    expect(fieldApplies({ active: true, typeIds: [other, id] }, id)).toBe(true);
    expect(fieldApplies({ active: false, typeIds: [] }, id)).toBe(false);
  });
});

describe('parseFieldFilter', () => {
  it('splits the field from the test', () => {
    expect(parseFieldFilter(`${id}.empty`)).toEqual({ fieldId: id, test: 'empty' });
    expect(parseFieldFilter(`${id}.${other}`)).toEqual({ fieldId: id, test: other });
    expect(parseFieldFilter(`${id}.whatever`)).toBeNull();
    expect(parseFieldFilter(id)).toBeNull();
  });
});

describe('formatFieldNumber', () => {
  it('writes numbers as people type them', () => {
    expect(formatFieldNumber(3)).toBe('3');
    expect(formatFieldNumber(-2.5)).toBe('-2.5');
    expect(formatFieldNumber(0.1 + 0.2)).toBe('0.3');
  });
});

describe('the history line for a field', () => {
  const line = (from: string | null, to: string | null) =>
    describeTicketEvent({ type: 'field.changed', data: { field: 'Customer', from, to } }, 'Dana');

  it('says what changed, from and to', () => {
    expect(line(null, 'Acme')).toBe('Dana set Customer to Acme');
    expect(line('Acme', 'Globex')).toBe('Dana changed Customer from Acme to Globex');
    expect(line('Acme', null)).toBe('Dana cleared Customer (was Acme)');
    expect(line(null, null)).toBe('Dana edited Customer');
  });
});
