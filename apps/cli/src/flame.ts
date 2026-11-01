import { FLAME, FLAME_HEAT } from './flame-art';

const RESET = '\x1b[0m';
const HEAT: Record<string, string> = {
  r: '\x1b[31m', // red
  o: '\x1b[38;5;208m', // orange (256-colour; terminals without it show their nearest)
  y: '\x1b[93m', // bright yellow
};

/** The login flame as lines, coloured by heat unless `colour` is false. */
export function flameLines(colour: boolean): string[] {
  if (!colour) return [...FLAME];
  return FLAME.map((row, y) => {
    let line = '';
    let current = '';
    for (let x = 0; x < row.length; x += 1) {
      const heat = row[x] === ' ' ? '' : (HEAT[FLAME_HEAT[y]![x]!] ?? '');
      if (heat && heat !== current) line += heat;
      current = heat || current;
      line += row[x];
    }
    return current ? line + RESET : line;
  });
}

/** Colour only for a person at a terminal who has not asked for none (https://no-color.org). */
export const wantsColour = (env: NodeJS.ProcessEnv = process.env) =>
  env.NO_COLOR === undefined || env.NO_COLOR === '';
