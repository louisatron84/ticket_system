'use client';

import { useId, useRef, useState } from 'react';
import { validateTitle } from '@/lib/ticket-form';

/**
 * The one-line form at the top of a column: a title and Enter. On the Tickets board it also asks
 * which project the ticket is for, because that board holds several. Escape closes it. After a
 * ticket is made the form stays open and empty, so several can be added one after another.
 */
export function QuickCreate({
  statusName,
  projects,
  defaultProject,
  showProject,
  onCreate,
  onClose,
}: {
  statusName: string;
  /** The projects that have this status and can take a new ticket. */
  projects: { key: string; name: string }[];
  defaultProject: string;
  /** Ask for the project. A project's own board already knows it. */
  showProject: boolean;
  /** Makes the ticket; true when it was made. It says what went wrong itself when it was not. */
  onCreate: (title: string, projectKey: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [project, setProject] = useState(defaultProject);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLSelectElement>(null);
  const errorId = useId();

  async function submit() {
    if (working) return;
    const problem = validateTitle(title);
    if (problem) {
      setError(problem);
      titleRef.current?.focus();
      return;
    }
    if (project === '') {
      setError('Choose a project.');
      projectRef.current?.focus();
      return;
    }
    setError(null);
    setWorking(true);
    const made = await onCreate(title.trim(), project);
    setWorking(false);
    if (made) setTitle('');
    titleRef.current?.focus();
  }

  return (
    <form
      aria-label={`New ticket in ${statusName}`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      className="flex flex-col gap-1.5 rounded-md border border-edge-strong bg-panel p-2"
    >
      {showProject && (
        <select
          ref={projectRef}
          aria-label="Project for the new ticket"
          value={project}
          onChange={(event) => {
            setProject(event.target.value);
            setError(null);
          }}
          className="rounded border border-edge bg-bg px-2 py-1 text-[13px]"
        >
          <option value="">Project…</option>
          {projects.map((item) => (
            <option key={item.key} value={item.key}>
              {item.key} · {item.name}
            </option>
          ))}
        </select>
      )}
      <input
        ref={titleRef}
        autoFocus
        aria-label="New ticket title"
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error !== null && error !== 'Choose a project.'}
        placeholder="What needs doing?"
        value={title}
        readOnly={working}
        onChange={(event) => {
          setTitle(event.target.value);
          setError(null);
        }}
        className="rounded border border-edge bg-bg px-2 py-1 text-[13px] placeholder:text-muted"
      />
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-fail">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted">Enter to add, Esc to close.</p>
      )}
    </form>
  );
}
