import type { StatusCategory } from '@forge/shared';

// How hot the work is. A status's colour and the shape of its symbol both come from here, so a
// status looks the same on the board, in a list, on a ticket and in a filter.

export type HeatToken =
  'cold' | 'warming' | 'forge' | 'tempering' | 'blocked' | 'quenched' | 'scrapped';

/** Each at least 3:1 against the app's surfaces (heat.test.ts checks it against globals.css). */
export const HEAT_COLOURS: Record<HeatToken, string> = {
  cold: '#7f8ea3',
  warming: '#9db0c6',
  forge: '#e8793a',
  tempering: '#f2c14e',
  blocked: '#c24d46',
  quenched: '#5b86b0',
  scrapped: '#76808f',
};

const BY_KEY: Record<string, HeatToken> = {
  backlog: 'cold',
  open: 'warming',
  in_progress: 'forge',
  in_review: 'tempering',
  blocked: 'blocked',
  done: 'quenched',
  cancelled: 'scrapped',
};

const BY_CATEGORY: Record<StatusCategory, HeatToken> = {
  not_started: 'cold',
  in_progress: 'forge',
  completed: 'quenched',
};

/** The heat of a status: its own for the seven defaults, otherwise by its category. */
export function heatOf(status: { key: string; category: StatusCategory }): HeatToken {
  return BY_KEY[status.key] ?? BY_CATEGORY[status.category];
}

export type GlyphShape =
  'dashed-ring' | 'ring' | 'half-ring' | 'barred-ring' | 'tick' | 'struck-ring';

const SHAPES: Record<HeatToken, GlyphShape> = {
  cold: 'dashed-ring',
  warming: 'ring',
  forge: 'half-ring',
  tempering: 'half-ring',
  blocked: 'barred-ring',
  quenched: 'tick',
  scrapped: 'struck-ring',
};

/** The symbol drawn for a heat, so colour is never the only way to tell statuses apart. */
export function glyphShapeOf(token: HeatToken): GlyphShape {
  return SHAPES[token];
}
