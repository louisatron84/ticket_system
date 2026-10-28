import { call } from './client';
import type { CliConfig } from './config';

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

/** `web-12` or `WEB-12` as the canonical key, or null if it is not a ticket key. */
export function ticketKey(input: string): string | null {
  const match = /^([A-Za-z][A-Za-z0-9]{1,9})-([1-9][0-9]{0,8})$/.exec(input.trim());
  return match ? `${match[1]!.toUpperCase()}-${match[2]}` : null;
}

type Status = { id: string; key: string; name: string };
type Ticket = {
  key: string;
  title: string;
  version: number;
  status: Status;
  project: { key: string };
};

export type MoveResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Moves a ticket the same way the board does: one PATCH carrying the version just read, so the
 * workflow, the blocker rule and every other check apply with the same messages.
 */
export async function moveTicket(
  config: CliConfig,
  word: MoveWord,
  key: string,
): Promise<MoveResult> {
  const target = MOVE_WORDS[word];
  const api = `/api/v1/orgs/${config.workspace.id}`;
  const ticket = await call<Ticket>(config.server, `${api}/tickets/${key}`, {
    token: config.token,
  });
  const project = await call<{ statuses: Status[] }>(
    config.server,
    `${api}/projects/${ticket.project.key}`,
    { token: config.token },
  );
  const status = project.statuses.find((s) => s.key === target.key);
  if (!status) {
    return { ok: false, message: `${ticket.project.key} has no ${target.column} column.` };
  }
  if (ticket.status.id === status.id) {
    return { ok: true, message: `${ticket.key} is already in ${status.name}.` };
  }
  await call(config.server, `${api}/tickets/${key}`, {
    method: 'PATCH',
    token: config.token,
    json: { version: ticket.version, statusId: status.id },
  });
  return { ok: true, message: `${ticket.key} moved from ${ticket.status.name} to ${status.name}.` };
}
