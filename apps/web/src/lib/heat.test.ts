import { readFileSync } from 'node:fs';
import type { StatusCategory } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import { glyphShapeOf, HEAT_COLOURS, heatOf, type HeatToken } from './heat';

describe('heatOf', () => {
  it.each([
    ['backlog', 'not_started', 'cold'],
    ['open', 'not_started', 'warming'],
    ['in_progress', 'in_progress', 'forge'],
    ['in_review', 'in_progress', 'tempering'],
    ['blocked', 'in_progress', 'blocked'],
    ['done', 'completed', 'quenched'],
    ['cancelled', 'completed', 'scrapped'],
  ] as [string, StatusCategory, HeatToken][])(
    'maps the default status %s to %s',
    (key, category, token) => {
      expect(heatOf({ key, category })).toBe(token);
    },
  );

  it.each([
    ['not_started', 'cold'],
    ['in_progress', 'forge'],
    ['completed', 'quenched'],
  ] as [StatusCategory, HeatToken][])(
    'falls back by category for a status it does not know (%s)',
    (category, token) => {
      expect(heatOf({ key: 'qa', category })).toBe(token);
      expect(heatOf({ key: '', category })).toBe(token);
    },
  );
});

describe('glyphShapeOf', () => {
  it('gives every heat its own shape where neighbours would otherwise look alike', () => {
    expect(glyphShapeOf('cold')).toBe('dashed-ring');
    expect(glyphShapeOf('warming')).toBe('ring');
    expect(glyphShapeOf('forge')).toBe('half-ring');
    expect(glyphShapeOf('tempering')).toBe('half-ring');
    expect(glyphShapeOf('blocked')).toBe('barred-ring');
    expect(glyphShapeOf('quenched')).toBe('tick');
    expect(glyphShapeOf('scrapped')).toBe('struck-ring');
    expect(glyphShapeOf('cold')).not.toBe(glyphShapeOf('warming'));
    expect(glyphShapeOf('forge')).not.toBe(glyphShapeOf('blocked'));
    expect(glyphShapeOf('warming')).not.toBe(glyphShapeOf('forge'));
  });
});

// Contrast is checked against the surfaces the app really draws on, read from the stylesheet so
// the two cannot drift apart.
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const surface = (name: string): string => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match) throw new Error(`--${name} not found in globals.css`);
  return match[1]!;
};

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('heat colours', () => {
  const surfaces = ['bg', 'panel', 'raised'];
  const tokens = Object.keys(HEAT_COLOURS) as HeatToken[];

  it('has a colour for each of the seven heats', () => {
    expect(tokens.sort()).toEqual(
      ['blocked', 'cold', 'forge', 'quenched', 'scrapped', 'tempering', 'warming'].sort(),
    );
  });

  it.each(tokens.flatMap((token) => surfaces.map((name) => [token, name] as const)))(
    'keeps %s readable on --%s (at least 3:1)',
    (token, name) => {
      expect(contrast(HEAT_COLOURS[token], surface(name))).toBeGreaterThanOrEqual(3);
    },
  );
});

describe('text colours', () => {
  // Small text needs 4.5:1 (WCAG AA). Muted text is used for most of the small print.
  it.each(
    ['bg', 'panel', 'raised'].flatMap((name) => [
      ['text', name] as const,
      ['muted', name] as const,
    ]),
  )('keeps --%s readable on --%s (at least 4.5:1)', (token, name) => {
    expect(contrast(surface(token), surface(name))).toBeGreaterThanOrEqual(4.5);
  });
});
