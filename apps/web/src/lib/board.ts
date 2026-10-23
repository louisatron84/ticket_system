import type { Board } from '@forge/shared';

// Pure state for the board, so a card can move the instant it is dropped and move back if the
// server says no. Nothing here knows about the network or the page.

/**
 * The board after a card is moved to another column: it goes to the top of that column, and both
 * columns' counts change. Returns the very same board, untouched, when there is nothing to do
 * (a card that is not on the board, a column that does not exist, or the column it is already in).
 */
export function nextBoardState(board: Board, ticketId: string, toStatusId: string): Board {
  const fromIndex = board.columns.findIndex((column) =>
    column.tickets.some((ticket) => ticket.id === ticketId),
  );
  const toIndex = board.columns.findIndex((column) => column.status.id === toStatusId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return board;

  const target = board.columns[toIndex]!;
  const card = board.columns[fromIndex]!.tickets.find((ticket) => ticket.id === ticketId)!;
  const moved = {
    ...card,
    status: {
      id: target.status.id,
      key: target.status.key,
      name: target.status.name,
      category: target.status.category,
    },
  };

  return {
    ...board,
    columns: board.columns.map((column, index) => {
      if (index === fromIndex) {
        return {
          ...column,
          total: Math.max(0, column.total - 1),
          tickets: column.tickets.filter((ticket) => ticket.id !== ticketId),
        };
      }
      if (index === toIndex) {
        return { ...column, total: column.total + 1, tickets: [moved, ...column.tickets] };
      }
      return column;
    }),
  };
}

/** The statuses a ticket in `fromStatusId` is allowed to move to. */
export function allowedTargets(
  transitions: readonly { fromStatusId: string; toStatusId: string }[],
  fromStatusId: string,
): string[] {
  return transitions
    .filter((transition) => transition.fromStatusId === fromStatusId)
    .map((transition) => transition.toStatusId);
}

/** Whether a card may be dropped on this column. Its own column is never a place to drop. */
export function canDrop(allowedTargetIds: readonly string[], toStatusId: string): boolean {
  return allowedTargetIds.includes(toStatusId);
}

export type BoardState = {
  board: Board;
  /** A move that has been shown but not yet confirmed, with the board to go back to. */
  pending: { ticketId: string; snapshot: Board } | null;
};

export type BoardAction =
  | { type: 'moved'; ticketId: string; toStatusId: string }
  | { type: 'saved'; ticketId: string; version: number }
  | { type: 'rejected' }
  | { type: 'replaced'; board: Board };

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'moved': {
      // One move at a time: the next one waits for the server's answer to this one.
      if (state.pending) return state;
      const board = nextBoardState(state.board, action.ticketId, action.toStatusId);
      if (board === state.board) return state;
      return { board, pending: { ticketId: action.ticketId, snapshot: state.board } };
    }
    case 'saved':
      return {
        board: {
          ...state.board,
          columns: state.board.columns.map((column) => ({
            ...column,
            tickets: column.tickets.map((ticket) =>
              ticket.id === action.ticketId ? { ...ticket, version: action.version } : ticket,
            ),
          })),
        },
        pending: null,
      };
    case 'rejected':
      return state.pending ? { board: state.pending.snapshot, pending: null } : state;
    case 'replaced':
      return { board: action.board, pending: null };
  }
}
