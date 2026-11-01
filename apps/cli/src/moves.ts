import { call } from './client';
import { readTicket } from './tickets';
import type { CliConfig } from './config';
import { MOVE_WORDS, type MoveWord } from './words';

export { MOVE_WORDS, isMoveWord, type MoveWord } from './words';

/** `web-12` or `WEB-12` as the canonical key, or null if it is not a ticket key. */
export function ticketKey(input: string): string | null {
  const match = /^([A-Za-z][A-Za-z0-9]{1,9})-([1-9][0-9]{0,8})$/.exec(input.trim());
  return match ? `${match[1]!.toUpperCase()}-${match[2]}` : null;
}

export type Status = { id: string; key: string; name: string; active?: boolean };
export type MoveResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * The status a person means by `text`: its name as shown ("In the Forge", any case), its key
 * (`in_progress`), or one of the move words (`hammer`). Inactive statuses are never meant.
 */
export function findStatus(statuses: readonly Status[], text: string): Status | undefined {
  const wanted = text.trim().toLowerCase();
  const usable = statuses.filter((status) => status.active !== false);
  const byWord = Object.hasOwn(MOVE_WORDS, wanted) ? MOVE_WORDS[wanted as MoveWord].key : null;
  return (
    usable.find((status) => status.name.toLowerCase() === wanted) ??
    usable.find((status) => status.key === wanted) ??
    (byWord ? usable.find((status) => status.key === byWord) : undefined)
  );
}

/**
 * Moves a ticket the same way the board does: one PATCH carrying the version just read, so the
 * workflow, its rules, the blocker rule and every other check apply with the same messages.
 * `target` is a move word or any status by name or key; `comment` goes with the move (a rule may
 * need one).
 */
export async function moveTicket(
  config: CliConfig,
  target: { word: MoveWord } | { status: string },
  key: string,
  comment?: string,
): Promise<MoveResult> {
  const api = `/api/v1/orgs/${config.workspace.id}`;
  const ticket = await readTicket(config, key);
  const project = await call<{ statuses: Status[] }>(
    config.server,
    `${api}/projects/${ticket.project.key}`,
    { token: config.token },
  );
  const status =
    'word' in target
      ? project.statuses.find((s) => s.key === MOVE_WORDS[target.word].key && s.active !== false)
      : findStatus(project.statuses, target.status);
  if (!status) {
    const names = project.statuses
      .filter((s) => s.active !== false)
      .map((s) => s.name)
      .join(', ');
    return {
      ok: false,
      message:
        'word' in target
          ? `${ticket.project.key} has no ${MOVE_WORDS[target.word].column} column.`
          : `${ticket.project.key} has no status "${target.status}". Its statuses: ${names}.`,
    };
  }
  if (ticket.status.id === status.id) {
    return { ok: true, message: `${ticket.key} is already in ${status.name}.` };
  }
  await call(config.server, `${api}/tickets/${key}`, {
    method: 'PATCH',
    token: config.token,
    json: { version: ticket.version, statusId: status.id, ...(comment ? { comment } : {}) },
  });
  return { ok: true, message: `${ticket.key} moved from ${ticket.status.name} to ${status.name}.` };
}

/**
 * The status key for `--status`: a name, key or move word, looked up in the projects' own
 * statuses (in `projectKeys`, or every project). Null when no project has such a status.
 */
export async function statusKeyFor(
  config: CliConfig,
  text: string,
  projectKeys?: string[],
): Promise<string | null> {
  const api = `/api/v1/orgs/${config.workspace.id}`;
  const keys =
    projectKeys ??
    (await call<{ key: string }[]>(config.server, `${api}/projects`, { token: config.token })).map(
      (project) => project.key,
    );
  for (const projectKey of keys) {
    const project = await call<{ statuses: Status[] }>(
      config.server,
      `${api}/projects/${encodeURIComponent(projectKey.toUpperCase())}`,
      { token: config.token },
    );
    const status = findStatus(project.statuses, text);
    if (status) return status.key;
  }
  return null;
}
