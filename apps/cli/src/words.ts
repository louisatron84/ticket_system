/** The owner's words for each column, as doing words, and the status key each one means. */
export const MOVE_WORDS = {
  cold: { key: 'backlog', column: 'Cold Steel' },
  warm: { key: 'open', column: 'Warming' },
  hammer: { key: 'in_progress', column: 'In the Forge' },
  temper: { key: 'in_review', column: 'Tempering' },
  jammed: { key: 'blocked', column: 'Jammed' },
  jam: { key: 'blocked', column: 'Jammed' },
  quench: { key: 'done', column: 'Quenched' },
  scrap: { key: 'cancelled', column: 'Scrapped' },
} as const;

export type MoveWord = keyof typeof MOVE_WORDS;

export const isMoveWord = (word: string): word is MoveWord => Object.hasOwn(MOVE_WORDS, word);
