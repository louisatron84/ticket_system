import type { TicketSummary, Workflow } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import {
  allowedStatuses,
  boardReducer,
  canMoveTo,
  dropId,
  fitsLane,
  lanesOf,
  parseDropId,
  topLevelOnly,
  isMovable,
  nextBoardState,
  statusesAcross,
  type BoardData,
  type BoardState,
  type StatusRef,
} from './board';

const uuid = (n: number) => `01a1656b-1a49-7146-94ac-${String(n).padStart(12, '0')}`;

const status = (
  n: number,
  key: string,
  name: string,
  category: 'not_started' | 'in_progress' | 'completed',
): Workflow['statuses'][number] => ({ id: uuid(n), key, name, category, initial: false });

// Project WEB has open, doing and done. Project API has its own open and a "qa" status WEB lacks.
const OPEN = status(1, 'open', 'Open', 'not_started');
const DOING = status(2, 'doing', 'In Progress', 'in_progress');
const DONE = status(3, 'done', 'Done', 'completed');
const API_OPEN = status(11, 'open', 'Ready', 'not_started');
const API_QA = status(12, 'qa', 'QA', 'in_progress');

const WEB = { id: uuid(900), key: 'WEB' };
const API = { id: uuid(950), key: 'API' };

const workflow = (
  project: { id: string; key: string },
  statuses: Workflow['statuses'],
  moves: [StatusRef, StatusRef][],
  archived = false,
): Workflow => ({
  projectId: project.id,
  projectKey: project.key,
  archived,
  statuses,
  transitions: moves.map(([from, to]) => ({ fromStatusId: from.id, toStatusId: to.id })),
});

const WORKFLOWS: Workflow[] = [
  workflow(
    WEB,
    [OPEN, DOING, DONE],
    [
      [OPEN, DOING],
      [DOING, DONE],
      [DOING, OPEN],
    ],
  ),
  workflow(API, [API_OPEN, API_QA], [[API_OPEN, API_QA]]),
];

const ticket = (
  n: number,
  from: StatusRef,
  project: { id: string; key: string } = WEB,
): TicketSummary => ({
  id: uuid(100 + n),
  key: `${project.key}-${n}`,
  title: `Ticket ${n}`,
  project: { ...project, name: project.key },
  type: { id: uuid(901), key: 'task', name: 'Task' },
  status: from,
  priority: { id: uuid(902), key: 'normal', name: 'Flame', rank: 3 },
  assignee: null,
  labels: [],
  dueDate: null,
  version: 1,
  commentCount: 0,
  parentKey: null,
  progress: null,
  openBlockerKeys: [],
  criteria: { done: 0, total: 0 },
  createdAt: '2030-01-01T00:00:00.000Z',
  updatedAt: '2030-01-01T00:00:00.000Z',
});

const column = (key: string, name: string, sortOrder: number) => ({
  key,
  name,
  category: 'not_started' as const,
  sortOrder,
});

const fixture = (): BoardData => ({
  columns: [
    {
      status: column('open', 'Open', 1),
      total: 3,
      tickets: [ticket(1, OPEN), ticket(2, OPEN), ticket(4, API_OPEN, API)],
    },
    { status: column('doing', 'In Progress', 2), total: 1, tickets: [ticket(3, DOING)] },
    { status: column('done', 'Done', 3), total: 0, tickets: [] },
  ],
});

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const keysIn = (board: BoardData, index: number) => board.columns[index]!.tickets.map((t) => t.key);

describe('nextBoardState', () => {
  it('moves a card to the top of the column with that key', () => {
    const next = nextBoardState(fixture(), uuid(101), 'doing', DOING);
    expect(keysIn(next, 0)).toEqual(['WEB-2', 'API-4']);
    expect(keysIn(next, 1)).toEqual(['WEB-1', 'WEB-3']);
  });

  it('updates both counts', () => {
    const next = nextBoardState(fixture(), uuid(101), 'doing', DOING);
    expect(next.columns.map((c) => c.total)).toEqual([2, 2, 0]);
  });

  it('gives the moved card the status it was given', () => {
    const next = nextBoardState(fixture(), uuid(101), 'done', DONE);
    expect(next.columns[2]!.tickets[0]!.status).toEqual(DONE);
  });

  it('leaves the columns it did not touch exactly as they were', () => {
    const board = fixture();
    expect(nextBoardState(board, uuid(101), 'doing', DOING).columns[2]).toBe(board.columns[2]);
  });

  it('counts against the real total when a column shows only part of its tickets', () => {
    const board = fixture();
    board.columns[0] = { ...board.columns[0]!, total: 58 };
    const next = nextBoardState(board, uuid(101), 'doing', DOING);
    expect(next.columns[0]!.total).toBe(57);
    expect(next.columns[1]!.total).toBe(2);
  });

  it('never counts below zero', () => {
    const board = fixture();
    board.columns[1] = { ...board.columns[1]!, total: 0 };
    expect(nextBoardState(board, uuid(103), 'done', DONE).columns[1]!.total).toBe(0);
  });

  it('returns the very same board for a move that changes nothing', () => {
    const board = fixture();
    expect(nextBoardState(board, uuid(101), 'open', OPEN)).toBe(board);
    expect(nextBoardState(board, uuid(777), 'doing', DOING)).toBe(board);
    expect(nextBoardState(board, uuid(101), 'nowhere', DOING)).toBe(board);
  });

  it('does not change the board it was given', () => {
    const board = deepFreeze(fixture());
    expect(() => nextBoardState(board, uuid(101), 'done', DONE)).not.toThrow();
  });
});

describe('moves are checked against the ticket’s own project', () => {
  it('lists only the statuses its own project allows', () => {
    expect(allowedStatuses(WORKFLOWS, ticket(1, OPEN))).toEqual([DOING]);
    expect(allowedStatuses(WORKFLOWS, ticket(3, DOING))).toEqual([OPEN, DONE]);
    expect(allowedStatuses(WORKFLOWS, ticket(4, API_OPEN, API))).toEqual([API_QA]);
    expect(allowedStatuses(WORKFLOWS, ticket(5, DONE))).toEqual([]);
  });

  it('resolves a column key to that project’s own status', () => {
    expect(canMoveTo(WORKFLOWS, ticket(1, OPEN), 'doing')).toEqual(DOING);
    expect(canMoveTo(WORKFLOWS, ticket(4, API_OPEN, API), 'qa')).toEqual(API_QA);
  });

  it('refuses a key the workflow does not allow, or the one it is already in', () => {
    expect(canMoveTo(WORKFLOWS, ticket(1, OPEN), 'done')).toBeNull();
    expect(canMoveTo(WORKFLOWS, ticket(1, OPEN), 'open')).toBeNull();
  });

  it('refuses a key its project does not have', () => {
    expect(canMoveTo(WORKFLOWS, ticket(3, DOING), 'qa')).toBeNull();
    expect(canMoveTo(WORKFLOWS, ticket(4, API_OPEN, API), 'doing')).toBeNull();
  });

  it('refuses every move in an archived project, and for a project it does not know', () => {
    const archived = [WORKFLOWS[0]!, { ...WORKFLOWS[1]!, archived: true }];
    expect(canMoveTo(archived, ticket(4, API_OPEN, API), 'qa')).toBeNull();
    expect(isMovable(archived, ticket(4, API_OPEN, API))).toBe(false);
    expect(isMovable(archived, ticket(1, OPEN))).toBe(true);
    const stranger = ticket(6, OPEN, { id: uuid(999), key: 'ZZZ' });
    expect(isMovable(WORKFLOWS, stranger)).toBe(false);
    expect(canMoveTo(WORKFLOWS, stranger, 'doing')).toBeNull();
  });
});

describe('boardReducer', () => {
  const start = (): BoardState => ({ board: fixture(), pending: null });
  const moveWeb1 = { type: 'moved', ticketId: uuid(101), toKey: 'doing', status: DOING } as const;

  it('applies a move at once and remembers how to undo it', () => {
    const before = start();
    const after = boardReducer(before, moveWeb1);
    expect(keysIn(after.board, 1)).toEqual(['WEB-1', 'WEB-3']);
    expect(after.pending).toEqual({ ticketId: uuid(101), snapshot: before.board });
  });

  it('puts the board back exactly as it was when the move is refused', () => {
    const before = start();
    const undone = boardReducer(boardReducer(before, moveWeb1), { type: 'rejected' });
    expect(undone.board).toBe(before.board);
    expect(undone.pending).toBeNull();
  });

  it('keeps the move and records the new version when it is saved', () => {
    const moved = boardReducer(start(), moveWeb1);
    const saved = boardReducer(moved, { type: 'saved', ticketId: uuid(101), version: 2 });
    expect(saved.pending).toBeNull();
    expect(saved.board.columns[1]!.tickets[0]).toMatchObject({ key: 'WEB-1', version: 2 });
    expect(keysIn(saved.board, 0)).toEqual(['WEB-2', 'API-4']);
  });

  it('does not start a second move while one is waiting for the server', () => {
    const moved = boardReducer(start(), moveWeb1);
    const again = boardReducer(moved, {
      type: 'moved',
      ticketId: uuid(102),
      toKey: 'done',
      status: DONE,
    });
    expect(again).toBe(moved);
  });

  it('ignores a move that changes nothing, leaving nothing to undo', () => {
    const before = start();
    expect(
      boardReducer(before, { type: 'moved', ticketId: uuid(101), toKey: 'open', status: OPEN }),
    ).toBe(before);
  });

  it('ignores a rejection when nothing is pending', () => {
    const before = start();
    expect(boardReducer(before, { type: 'rejected' })).toBe(before);
  });

  it('takes the server’s board when a fresh one arrives, dropping anything pending', () => {
    const fresh = fixture();
    const replaced = boardReducer(boardReducer(start(), moveWeb1), {
      type: 'replaced',
      board: fresh,
    });
    expect(replaced).toEqual({ board: fresh, pending: null });
  });
});

describe('statusesAcross', () => {
  it('lists each status key once, named after the first project that has it, in workflow order', () => {
    expect(statusesAcross(WORKFLOWS)).toEqual([
      { id: 'open', key: 'open', name: 'Open', category: 'not_started' },
      { id: 'doing', key: 'doing', name: 'In Progress', category: 'in_progress' },
      { id: 'done', key: 'done', name: 'Done', category: 'completed' },
      { id: 'qa', key: 'qa', name: 'QA', category: 'in_progress' },
    ]);
  });

  it('leaves out archived projects', () => {
    const archived = [WORKFLOWS[0]!, { ...WORKFLOWS[1]!, archived: true }];
    expect(statusesAcross(archived).map((status) => status.key)).toEqual(['open', 'doing', 'done']);
  });
});

describe('top level only', () => {
  it('hides cards that have a parent and takes them off the counts', () => {
    const board = fixture();
    board.columns[0]!.tickets[1] = { ...board.columns[0]!.tickets[1]!, parentKey: 'WEB-1' };
    const top = topLevelOnly(deepFreeze(board));
    expect(keysIn(top, 0)).toEqual(['WEB-1', 'API-4']);
    expect(top.columns[0]!.total).toBe(2);
    expect(top.columns[1]!.total).toBe(1);
  });

  it('gives back the same board when nothing has a parent', () => {
    const board = deepFreeze(fixture());
    expect(topLevelOnly(board)).toBe(board);
  });
});

describe('lanes per project', () => {
  it('makes one lane per project with tickets, in key order, each with every column', () => {
    const lanes = lanesOf(deepFreeze(fixture()).columns);
    expect(lanes.map((lane) => lane.project.key)).toEqual(['API', 'WEB']);
    expect(
      lanes[0]!.columns.map((c) => [c.status.key, c.total, c.tickets.map((t) => t.key)]),
    ).toEqual([
      ['open', 1, ['API-4']],
      ['doing', 0, []],
      ['done', 0, []],
    ]);
    expect(lanes[1]!.columns.map((c) => [c.status.key, c.total])).toEqual([
      ['open', 2],
      ['doing', 1],
      ['done', 0],
    ]);
    expect(lanes[1]!.total).toBe(3);
  });

  it('keeps the order of the columns it was given, so hidden and reordered columns hold', () => {
    const [open, doing] = fixture().columns;
    const lanes = lanesOf([doing!, open!]);
    expect(lanes[1]!.columns.map((c) => c.status.key)).toEqual(['doing', 'open']);
  });

  it('names a drop target by lane and status, and reads it back', () => {
    expect(parseDropId(dropId('blocked'))).toEqual({ statusKey: 'blocked', laneKey: null });
    expect(parseDropId(dropId('blocked', 'WEB'))).toEqual({ statusKey: 'blocked', laneKey: 'WEB' });
  });

  it('refuses a drop into another project’s lane', () => {
    const card = ticket(1, OPEN);
    expect(fitsLane(card, null)).toBe(true);
    expect(fitsLane(card, 'WEB')).toBe(true);
    expect(fitsLane(card, 'API')).toBe(false);
  });
});
