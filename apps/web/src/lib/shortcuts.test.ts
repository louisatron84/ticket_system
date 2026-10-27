import { describe, expect, it } from 'vitest';
import { shortcutFor, type KeyPress } from './shortcuts';

const press = (key: string, over: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: { tagName: 'BODY', isContentEditable: false },
  ...over,
});

describe('shortcutFor', () => {
  it.each([
    ['?', 'help'],
    ['/', 'search'],
    ['c', 'create'],
    ['j', 'next'],
    ['k', 'previous'],
    ['x', 'select'],
    ['a', 'assign-me'],
    ['m', 'move'],
  ])('%s is %s', (key, action) => {
    expect(shortcutFor(press(key), null)).toEqual({ action });
  });

  it('g waits for a second key: p, t or b', () => {
    expect(shortcutFor(press('g'), null)).toEqual({ pending: 'g' });
    expect(shortcutFor(press('p'), 'g')).toEqual({ action: 'go-projects' });
    expect(shortcutFor(press('t'), 'g')).toEqual({ action: 'go-tickets' });
    expect(shortcutFor(press('b'), 'g')).toEqual({ action: 'go-board' });
  });

  it('a key after g that is not one of those does nothing', () => {
    expect(shortcutFor(press('c'), 'g')).toBeNull();
    expect(shortcutFor(press('g'), 'g')).toBeNull();
  });

  it('ignores upper-case letters, so Shift+C is not c', () => {
    expect(shortcutFor(press('C'), null)).toBeNull();
  });

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('never fires while typing in a %s', (tagName) => {
    for (const key of ['c', 'a', '?', '/', 'g', 'j']) {
      expect(
        shortcutFor(press(key, { target: { tagName, isContentEditable: false } }), null),
      ).toBeNull();
    }
    expect(
      shortcutFor(press('b', { target: { tagName, isContentEditable: false } }), 'g'),
    ).toBeNull();
  });

  it.each(['checkbox', 'radio', 'button'])(
    'still works from an input that is a %s, which takes no text',
    (type) => {
      expect(
        shortcutFor(
          press('j', { target: { tagName: 'INPUT', type, isContentEditable: false } }),
          null,
        ),
      ).toEqual({ action: 'next' });
    },
  );

  it('never fires in editable text', () => {
    expect(
      shortcutFor(press('c', { target: { tagName: 'DIV', isContentEditable: true } }), null),
    ).toBeNull();
  });

  it('leaves keys held with Ctrl, Cmd or Alt to the browser and the command menu', () => {
    expect(shortcutFor(press('c', { ctrlKey: true }), null)).toBeNull();
    expect(shortcutFor(press('k', { metaKey: true }), null)).toBeNull();
    expect(shortcutFor(press('a', { altKey: true }), null)).toBeNull();
  });

  it('does nothing for other keys', () => {
    expect(shortcutFor(press('q'), null)).toBeNull();
    expect(shortcutFor(press('Enter'), null)).toBeNull();
  });
});
