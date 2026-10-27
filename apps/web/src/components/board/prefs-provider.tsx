'use client';

import {
  DEFAULT_BOARD_DISPLAY,
  applyDisplayChange,
  undoOf,
  type BoardColumnPrefs,
  type BoardDisplay,
  type BoardDisplayPrefs,
} from '@forge/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';

type BoardPrefs = {
  display: BoardDisplay;
  /** Applies the change at once and saves it. If the save fails the change is undone. */
  updateDisplay: (change: BoardDisplayPrefs) => void;
  resetDisplay: () => void;
  /** This person's choice of columns for this board, or undefined for the defaults. */
  columnPrefs: BoardColumnPrefs | undefined;
  /** Saves the choice for this board; null goes back to the defaults. Undone if the save fails. */
  setColumnPrefs: (prefs: BoardColumnPrefs | null) => void;
};

/** Which board the column choice belongs to: one project's, or the Tickets page's. */
export type BoardScope = { kind: 'project'; projectKey: string } | { kind: 'tickets' };

const Context = createContext<BoardPrefs | null>(null);

const SAVE_FAILED = "Couldn't save your board settings.";

/**
 * A person's board settings, kept on their account so they follow them between browsers and
 * render correctly on the first paint: which card fields show, density and heat (the same on every
 * board), and which columns show in what order (separately for each project and for the Tickets
 * page). Like the sidebar setting, the screen changes immediately; unlike it, a failed save is
 * undone and reported, so what is on screen never claims to be saved when it is not.
 */
export function BoardPrefsProvider({
  scope,
  initialDisplay,
  initialColumns,
  children,
}: {
  scope: BoardScope;
  initialDisplay: BoardDisplay;
  initialColumns: BoardColumnPrefs | undefined;
  children: ReactNode;
}) {
  // Null for the Tickets page's board, which spans projects.
  const projectKey = scope.kind === 'project' ? scope.projectKey : null;
  const [display, setDisplay] = useState(initialDisplay);
  const [columnPrefs, setColumnPrefsState] = useState(initialColumns);
  // The latest values, readable inside callbacks without waiting for a render.
  const latest = useRef({ display, columnPrefs });
  useEffect(() => {
    latest.current = { display, columnPrefs };
  }, [display, columnPrefs]);

  const saveDisplay = useCallback((change: BoardDisplayPrefs, previous: BoardDisplay) => {
    apiFetch('/api/v1/me/preferences', { method: 'PATCH', json: { board: change } }).catch(() => {
      // Undo only what this change touched, not whatever the person did after it.
      const undo = undoOf(previous, change);
      setDisplay((current) => applyDisplayChange(current, undo));
      toast.error(SAVE_FAILED);
    });
  }, []);

  const updateDisplay = useCallback(
    (change: BoardDisplayPrefs) => {
      const previous = latest.current.display;
      setDisplay((current) => applyDisplayChange(current, change));
      saveDisplay(change, previous);
    },
    [saveDisplay],
  );

  const resetDisplay = useCallback(() => {
    const previous = latest.current.display;
    setDisplay(DEFAULT_BOARD_DISPLAY);
    saveDisplay(DEFAULT_BOARD_DISPLAY, previous);
  }, [saveDisplay]);

  const setColumnPrefs = useCallback(
    (prefs: BoardColumnPrefs | null) => {
      const previous = latest.current.columnPrefs;
      setColumnPrefsState(prefs ?? undefined);
      apiFetch('/api/v1/me/preferences', {
        method: 'PATCH',
        json: projectKey
          ? { boardColumns: { [projectKey]: prefs } }
          : { ticketsBoardColumns: prefs },
      }).catch(() => {
        setColumnPrefsState(previous);
        toast.error(SAVE_FAILED);
      });
    },
    [projectKey],
  );

  return (
    <Context value={{ display, updateDisplay, resetDisplay, columnPrefs, setColumnPrefs }}>
      {children}
    </Context>
  );
}

export function useBoardPrefs(): BoardPrefs {
  const value = useContext(Context);
  if (!value) throw new Error('useBoardPrefs must be used inside a BoardPrefsProvider.');
  return value;
}
