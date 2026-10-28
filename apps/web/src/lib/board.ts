import type { StatusCategory, TicketSummary, Workflow } from '@forge/shared';

// Pure state for the board, so a card can move the instant it is dropped and move back if the
// server says no. Nothing here knows about the network or the page.
//
// Columns are identified by status key, not id: on the Tickets page one column holds tickets of
// several projects, each with its own status of that key. A move is always checked against the
// ticket's own project's workflow.

export type StatusRef = { id: string; key: string; name: string; category: StatusCategory };

export type BoardColumnData = {
  status: { key: string; name: string; category: StatusCategory; sortOrder: number };
  total: number;
  tickets: TicketSummary[];
};

export type BoardData = { columns: BoardColumnData[] };

const workflowOf = (workflows: readonly Workflow[], ticket: TicketSummary) =>
  workflows.find((workflow) => workflow.projectId === ticket.project.id);

/** Whether the ticket can be moved at all: its project is known and not archived. */
export function isMovable(workflows: readonly Workflow[], ticket: TicketSummary): boolean {
  const workflow = workflowOf(workflows, ticket);
  return workflow !== undefined && !workflow.archived;
}

/** The statuses of its own project the ticket may move to, in that project's order. */
export function allowedStatuses(
  workflows: readonly Workflow[],
  ticket: TicketSummary,
): StatusRef[] {
  const workflow = workflowOf(workflows, ticket);
  if (!workflow || workflow.archived) return [];
  const targets = new Set(
    workflow.transitions
      .filter((transition) => transition.fromStatusId === ticket.status.id)
      .map((transition) => transition.toStatusId),
  );
  return workflow.statuses.filter((status) => targets.has(status.id));
}

/** The ticket's own status with this key, if the ticket may move there; otherwise null. */
export function canMoveTo(
  workflows: readonly Workflow[],
  ticket: TicketSummary,
  toKey: string,
): StatusRef | null {
  return allowedStatuses(workflows, ticket).find((status) => status.key === toKey) ?? null;
}

/**
 * Every status key the projects use, once each, for choosing a status across projects (a bulk
 * move). Named after the first project that has the key, as on the Tickets board; the id is the
 * key, since each ticket resolves it in its own project. Archived projects take no moves.
 */
export function statusesAcross(workflows: readonly Workflow[]): StatusRef[] {
  const seen = new Map<string, StatusRef>();
  for (const workflow of workflows) {
    if (workflow.archived) continue;
    for (const status of workflow.statuses) {
      if (!seen.has(status.key)) {
        const { key, name, category } = status;
        seen.set(key, { id: key, key, name, category });
      }
    }
  }
  return [...seen.values()];
}

/**
 * The board after a card is moved to another column: it goes to the top of that column with the
 * status it was given, and both columns' counts change. Returns the very same board, untouched,
 * when there is nothing to do (a card that is not on the board, a column that does not exist, or
 * the column it is already in).
 */
export function nextBoardState(
  board: BoardData,
  ticketId: string,
  toKey: string,
  status: StatusRef,
): BoardData {
  const fromIndex = board.columns.findIndex((column) =>
    column.tickets.some((ticket) => ticket.id === ticketId),
  );
  const toIndex = board.columns.findIndex((column) => column.status.key === toKey);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return board;

  const card = board.columns[fromIndex]!.tickets.find((ticket) => ticket.id === ticketId)!;
  const moved = { ...card, status };

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

export type BoardState = {
  board: BoardData;
  /** A move that has been shown but not yet confirmed, with the board to go back to. */
  pending: { ticketId: string; snapshot: BoardData } | null;
};

export type BoardAction =
  | { type: 'moved'; ticketId: string; toKey: string; status: StatusRef }
  | { type: 'saved'; ticketId: string; version: number }
  | { type: 'rejected' }
  | { type: 'replaced'; board: BoardData };

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'moved': {
      // One move at a time: the next one waits for the server's answer to this one.
      if (state.pending) return state;
      const board = nextBoardState(state.board, action.ticketId, action.toKey, action.status);
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

/**
 * The board with only top-level tickets: cards with a parent are left out, and each column's
 * count drops by as many as were left out. The same board comes back when nothing changes.
 */
export function topLevelOnly(board: BoardData): BoardData {
  if (board.columns.every((column) => column.tickets.every((ticket) => !ticket.parentKey))) {
    return board;
  }
  return {
    ...board,
    columns: board.columns.map((column) => {
      const tickets = column.tickets.filter((ticket) => !ticket.parentKey);
      return {
        ...column,
        tickets,
        total: Math.max(0, column.total - (column.tickets.length - tickets.length)),
      };
    }),
  };
}

export type Lane = {
  project: { key: string; name: string };
  /** Tickets in the lane, across its columns. */
  total: number;
  columns: BoardColumnData[];
};

/**
 * One lane (swimlane) per project that has tickets on the board, in key order. Every lane has the
 * columns given, in the order given; a lane's column counts the tickets loaded into it.
 */
export function lanesOf(columns: BoardColumnData[]): Lane[] {
  const projects = new Map<string, string>();
  for (const column of columns) {
    for (const ticket of column.tickets) projects.set(ticket.project.key, ticket.project.name);
  }
  return [...projects]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, name]) => {
      const laneColumns = columns.map((column) => {
        const tickets = column.tickets.filter((ticket) => ticket.project.key === key);
        return { ...column, tickets, total: tickets.length };
      });
      return {
        project: { key, name },
        total: laneColumns.reduce((sum, column) => sum + column.total, 0),
        columns: laneColumns,
      };
    });
}

// A status key is lower-case letters, digits and underscores, so `|` never appears in one.
const LANE_SEPARATOR = '|';

/** The id of a column as a drop target: its status key, and its lane's project when in lanes. */
export const dropId = (statusKey: string, laneKey?: string) =>
  laneKey ? `${laneKey}${LANE_SEPARATOR}${statusKey}` : statusKey;

export function parseDropId(id: string): { statusKey: string; laneKey: string | null } {
  const at = id.indexOf(LANE_SEPARATOR);
  return at === -1
    ? { statusKey: id, laneKey: null }
    : { statusKey: id.slice(at + 1), laneKey: id.slice(0, at) };
}

/** A ticket stays in its own project's lane: it never changes project by being dragged. */
export const fitsLane = (ticket: TicketSummary, laneKey: string | null) =>
  laneKey === null || ticket.project.key === laneKey;
