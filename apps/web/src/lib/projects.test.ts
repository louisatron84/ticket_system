import { describe, expect, it } from 'vitest';
import { cleanKeyInput, validateProjectForm } from './projects';

const valid = { name: 'Web App', key: 'WEB', description: '' };

describe('cleanKeyInput', () => {
  it.each([
    ['web', 'WEB'],
    ['we b-1', 'WEB1'],
    ['  ab  ', 'AB'],
    ['a_b', 'AB'],
    ['ünï', 'N'],
    ['abcdefghijklmnop', 'ABCDEFGHIJ'],
    ['', ''],
    ['!!!', ''],
  ])('turns %j into %j as it is typed', (input, expected) => {
    expect(cleanKeyInput(input)).toBe(expected);
  });
});

describe('validateProjectForm', () => {
  it('accepts a complete form', () => {
    expect(validateProjectForm(valid)).toEqual({});
    expect(validateProjectForm({ ...valid, description: 'Customer-facing site.' })).toEqual({});
  });

  it('wants a name', () => {
    expect(validateProjectForm({ ...valid, name: '' }).name).toBe('Give the project a name.');
    expect(validateProjectForm({ ...valid, name: '   ' }).name).toBe('Give the project a name.');
  });

  it('allows 80 characters of name and no more', () => {
    expect(validateProjectForm({ ...valid, name: 'a'.repeat(80) })).toEqual({});
    expect(validateProjectForm({ ...valid, name: 'a'.repeat(81) }).name).toBe(
      'Use 80 characters or fewer.',
    );
  });

  it('refuses control characters in the name, as the server does', () => {
    expect(validateProjectForm({ ...valid, name: 'a\nb' }).name).toBe(
      'Use plain text on one line.',
    );
    expect(validateProjectForm({ ...valid, name: 'a\u0000b' }).name).toBe(
      'Use plain text on one line.',
    );
  });

  it('accepts emoji and non-Latin names', () => {
    expect(validateProjectForm({ ...valid, name: 'مشروع 👋 日本語' })).toEqual({});
  });

  it.each([
    ['', 'Choose a key.'],
    ['W', 'Use 2 to 10 capital letters or digits, starting with a letter.'],
    ['1AB', 'Use 2 to 10 capital letters or digits, starting with a letter.'],
    ['web', 'Use 2 to 10 capital letters or digits, starting with a letter.'],
    ['W-B', 'Use 2 to 10 capital letters or digits, starting with a letter.'],
    ['ABCDEFGHIJK', 'Use 2 to 10 capital letters or digits, starting with a letter.'],
  ])('refuses the key %j', (key, message) => {
    expect(validateProjectForm({ ...valid, key }).key).toBe(message);
  });

  it.each(['AB', 'W2', 'ABCDEFGHIJ', 'A1B2C3'])('accepts the key %s', (key) => {
    expect(validateProjectForm({ ...valid, key })).toEqual({});
  });

  it('allows 2000 characters of description and no more', () => {
    expect(validateProjectForm({ ...valid, description: 'a'.repeat(2000) })).toEqual({});
    expect(validateProjectForm({ ...valid, description: 'a'.repeat(2001) }).description).toBe(
      'Use 2000 characters or fewer.',
    );
  });

  it('allows line breaks in the description but not other control characters', () => {
    expect(validateProjectForm({ ...valid, description: 'one\r\n\ttwo' })).toEqual({});
    expect(validateProjectForm({ ...valid, description: 'a\u0007b' }).description).toBe(
      'Remove control characters.',
    );
  });

  it('reports every problem at once', () => {
    expect(
      Object.keys(validateProjectForm({ name: '', key: '', description: 'x'.repeat(2001) })),
    ).toEqual(['name', 'key', 'description']);
  });
});
