import type { Board, TicketSummary } from '@forge/shared';
import { describe, expect, it } from 'vitest';
import { allowedTargets, boardReducer, canDrop, nextBoardState, type BoardState } from './board';

const uuid = (n: number) => `01a1656b-1a49-7146-94ac-${String(n).padStart(12, '0')}`;

const status = (
  n: number,
  key: string,
  name: string,
  category: 'not_started' | 'in_progress' | 'completed',
) => ({
  id: uuid(n),
  key,
  name,
  category,
  sortOrder: n,
  initial: n === 1,
});

const OPEN = status(1, 'open', 'Open', 'not_started');
const DOING = status(2, 'doing', 'In Progress', 'in_progress');
const DONE = status(3, 'done', 'Done', 'completed');

const ticket = (n: number, from: typeof OPEN): TicketSummary => ({
  id: uuid(100 + n),
  key: `WEB-${n}`,
  title: `Ticket ${n}`,
  project: { id: uuid(900), key: 'WEB', name: 'Web' },
  type: { id: uuid(901), key: 'task', name: 'Task' },
  status: { id: from.id, key: from.key, name: from.name, category: from.category },
  priority: { id: uuid(902), key: 'normal', name: 'Normal', rank: 3 },
  assignee: null,
  labels: [],
  dueDate: null,
  version: 1,
  createdAt: '2030-01-01T00:00:00.000Z',
  updatedAt: '2030-01-01T00:00:00.000Z',
});

const fixture = (): Board => ({
  columns: [
    { status: OPEN, total: 2, tickets: [ticket(1, OPEN), ticket(2, OPEN)] },
    { status: DOING, total: 1, tickets: [ticket(3, DOING)] },
    { status: DONE, total: 0, tickets: [] },
  ],
});

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const keysIn = (board: Board, column: number) => board.columns[column]!.tickets.map((t) => t.key);

describe('nextBoardState', () => {
  it('moves a card to the top of another column', () => {
    const next = nextBoardState(fixture(), uuid(101), DOING.id);
    expect(keysIn(next, 0)).toEqual(['WEB-2']);
    expect(keysIn(next, 1)).toEqual(['WEB-1', 'WEB-3']);
  });

  it('updates both counts', () => {
    const next = nextBoardState(fixture(), uuid(101), DOING.id);
    expect(next.columns.map((column) => column.total)).toEqual([1, 2, 0]);
  });

  it('gives the moved card its new status', () => {
    const next = nextBoardState(fixture(), uuid(101), DONE.id);
    expect(next.columns[2]!.tickets[0]!.status).toEqual({
      id: DONE.id,
      key: 'done',
      name: 'Done',
      category: 'completed',
    });
  });

  it('leaves the columns it did not touch exactly as they were', () => {
    const board = fixture();
    const next = nextBoardState(board, uuid(101), DOING.id);
    expect(next.columns[2]).toBe(board.columns[2]);
  });

  it('counts against the real total when a column shows only part of its tickets', () => {
    const board = fixture();
    board.columns[0] = { status: OPEN, total: 58, tickets: [ticket(1, OPEN), ticket(2, OPEN)] };
    const next = nextBoardState(board, uuid(101), DOING.id);
    expect(next.columns[0]!.total).toBe(57);
    expect(next.columns[1]!.total).toBe(2);
  });

  it('never counts below zero', () => {
    const board = fixture();
    board.columns[1] = { status: DOING, total: 0, tickets: [ticket(3, DOING)] };
    expect(nextBoardState(board, uuid(103), DONE.id).columns[1]!.total).toBe(0);
  });

  it('returns the very same board for a move that changes nothing', () => {
    const board = fixture();
    expect(nextBoardState(board, uuid(101), OPEN.id)).toBe(board);
    expect(nextBoardState(board, uuid(777), DOING.id)).toBe(board);
    expect(nextBoardState(board, uuid(101), uuid(888))).toBe(board);
  });

  it('does not change the board it was given', () => {
    const board = deepFreeze(fixture());
    expect(() => nextBoardState(board, uuid(101), DONE.id)).not.toThrow();
  });
});

describe('allowedTargets and canDrop', () => {
  const transitions = [
    { fromStatusId: OPEN.id, toStatusId: DOING.id },
    { fromStatusId: DOING.id, toStatusId: DONE.id },
    { fromStatusId: DOING.id, toStatusId: OPEN.id },
  ];

  it('lists where a status may go', () => {
    expect(allowedTargets(transitions, OPEN.id)).toEqual([DOING.id]);
    expect([...allowedTargets(transitions, DOING.id)].sort()).toEqual([OPEN.id, DONE.id].sort());
    expect(allowedTargets(transitions, DONE.id)).toEqual([]);
  });

  it('accepts a drop only on a column the card may move to', () => {
    const allowed = allowedTargets(transitions, OPEN.id);
    expect(canDrop(allowed, DOING.id)).toBe(true);
    expect(canDrop(allowed, DONE.id)).toBe(false);
  });

  it('never accepts a drop on the column the card is already in', () => {
    expect(canDrop(allowedTargets(transitions, DOING.id), DOING.id)).toBe(false);
  });

  it('accepts nothing when there is nowhere to go', () => {
    expect(canDrop([], DOING.id)).toBe(false);
  });
});

describe('boardReducer', () => {
  const start = (): BoardState => ({ board: fixture(), pending: null });

  it('applies a move at once and remembers how to undo it', () => {
    const before = start();
    const after = boardReducer(before, {
      type: 'moved',
      ticketId: uuid(101),
      toStatusId: DOING.id,
    });
    expect(keysIn(after.board, 1)).toEqual(['WEB-1', 'WEB-3']);
    expect(after.pending).toEqual({ ticketId: uuid(101), snapshot: before.board });
  });

  it('puts the board back exactly as it was when the move is refused', () => {
    const before = start();
    const moved = boardReducer(before, {
      type: 'moved',
      ticketId: uuid(101),
      toStatusId: DOING.id,
    });
    const undone = boardReducer(moved, { type: 'rejected' });
    expect(undone.board).toBe(before.board);
    expect(undone.pending).toBeNull();
  });

  it('keeps the move and records the new version when it is saved', () => {
    const moved = boardReducer(start(), {
      type: 'moved',
      ticketId: uuid(101),
      toStatusId: DOING.id,
    });
    const saved = boardReducer(moved, { type: 'saved', ticketId: uuid(101), version: 2 });
    expect(saved.pending).toBeNull();
    expect(saved.board.columns[1]!.tickets[0]).toMatchObject({ key: 'WEB-1', version: 2 });
    expect(keysIn(saved.board, 0)).toEqual(['WEB-2']);
  });

  it('does not start a second move while one is waiting for the server', () => {
    const moved = boardReducer(start(), {
      type: 'moved',
      ticketId: uuid(101),
      toStatusId: DOING.id,
    });
    const again = boardReducer(moved, { type: 'moved', ticketId: uuid(102), toStatusId: DONE.id });
    expect(again).toBe(moved);
  });

  it('ignores a move that changes nothing, leaving nothing to undo', () => {
    const before = start();
    const same = boardReducer(before, { type: 'moved', ticketId: uuid(101), toStatusId: OPEN.id });
    expect(same).toBe(before);
  });

  it('ignores a rejection when nothing is pending', () => {
    const before = start();
    expect(boardReducer(before, { type: 'rejected' })).toBe(before);
  });

  it('takes the server’s board when a fresh one arrives, dropping anything pending', () => {
    const moved = boardReducer(start(), {
      type: 'moved',
      ticketId: uuid(101),
      toStatusId: DOING.id,
    });
    const fresh = fixture();
    const replaced = boardReducer(moved, { type: 'replaced', board: fresh });
    expect(replaced).toEqual({ board: fresh, pending: null });
  });
});
