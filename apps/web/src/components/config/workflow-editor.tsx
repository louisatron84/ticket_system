'use client';

import {
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABELS,
  STATUS_NAME_MAX,
  TRANSITION_RULES,
  TRANSITION_RULE_LABELS,
  statusesWithoutWayOut,
  type Project,
  type StatusCategory,
  type WorkflowConfig,
  type WorkflowStatus,
} from '@forge/shared';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { StatusGlyph } from '@/components/tickets/badges';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Modal } from '@/components/ui/modal';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { buttonClass, inputClass } from '@/lib/ui';
import {
  cellKey,
  draftOf,
  isDirty,
  moveInOrder,
  toggleMove,
  toggleRule,
  transitionsOf,
  type GridDraft,
} from '@/lib/workflow-editor';

const ticketsWord = (n: number) => (n === 1 ? '1 ticket' : `${n} tickets`);

/**
 * A project's workflow: its statuses (add, rename, change category, reorder, choose where new
 * tickets start, deactivate with a destination for their tickets, reactivate), the transitions
 * grid with each move's rules, and copying another project's workflow. Every status change is
 * saved at once; the grid is saved as a whole against the version it was loaded at.
 */
export function WorkflowEditor({
  organisationId,
  projectKey,
}: {
  organisationId: string;
  projectKey: string;
}) {
  const router = useRouter();
  const base = `/api/v1/orgs/${organisationId}/projects/${projectKey}/workflow`;
  const [workflow, setWorkflow] = useState<WorkflowConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GridDraft>({});
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  async function load() {
    try {
      const fresh = await apiFetch<WorkflowConfig>(base);
      setWorkflow(fresh);
      setDraft(draftOf(fresh));
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof ApiRequestError ? error.message : 'Could not load the workflow.',
      );
    }
  }

  useEffect(() => {
    let live = true;
    apiFetch<WorkflowConfig>(base)
      .then((fresh) => {
        if (!live) return;
        setWorkflow(fresh);
        setDraft(draftOf(fresh));
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setLoadError(
          error instanceof ApiRequestError ? error.message : 'Could not load the workflow.',
        );
      });
    apiFetch<Project[]>(`/api/v1/orgs/${organisationId}/projects`)
      .then(setProjects)
      .catch(() => setProjects([]));
    return () => {
      live = false;
    };
    // Loaded once per project; later changes come back in each answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  /**
   * Runs one change and shows the workflow it answers with. Unsaved grid edits survive a status
   * change, as long as the answer shows no one else changed the workflow in between.
   */
  async function run(
    path: string,
    init: RequestInit & { json?: unknown },
    done: string,
    failure: string,
  ): Promise<boolean> {
    if (!workflow) return false;
    setBusy(true);
    try {
      const next = await apiFetch<WorkflowConfig>(`${base}${path}`, init);
      const onlyMine = next.version <= workflow.version + 1;
      const keepDraft = onlyMine && isDirty(draft, draftOf(workflow)) && path !== '/copy';
      setWorkflow(next);
      if (keepDraft) {
        // Moves of statuses that are no longer active drop out of the grid.
        const shown = draftOf({ ...next, transitions: transitionsOf(draft) });
        setDraft(shown);
      } else {
        setDraft(draftOf(next));
      }
      toast.success(done);
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : failure);
      if (error instanceof ApiRequestError && error.status === 409) void load();
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="workflow-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="workflow-heading" className="text-[13px] font-semibold">
          Workflow
        </h2>
        <p className="max-w-2xl text-xs text-muted">
          The statuses tickets of {projectKey} move through, and which moves are allowed. A status
          keeps its key when renamed, so filters, views and the CLI keep working.
        </p>
      </div>
      {loadError ? (
        <p role="alert" className="text-[13px] text-fail">
          {loadError}
        </p>
      ) : !workflow ? (
        <p className="text-[13px] text-muted">Loading the workflow…</p>
      ) : (
        <>
          {workflow.archived && (
            <p className="text-[13px] text-muted">
              This project is archived. Unarchive it to change its workflow.
            </p>
          )}
          <StatusList workflow={workflow} busy={busy || workflow.archived} run={run} />
          <TransitionsGrid
            workflow={workflow}
            draft={draft}
            setDraft={setDraft}
            busy={busy || workflow.archived}
            onSave={() =>
              run(
                '/transitions',
                {
                  method: 'PUT',
                  json: { version: workflow.version, transitions: transitionsOf(draft) },
                },
                'Transitions saved.',
                'Could not save the transitions.',
              )
            }
            onDiscard={() => setDraft(draftOf(workflow))}
          />
          <CopyWorkflow
            projectKey={projectKey}
            projects={projects.filter((p) => p.key !== projectKey)}
            busy={busy || workflow.archived}
            onCopy={(sourceProjectKey) =>
              run(
                '/copy',
                { method: 'POST', json: { sourceProjectKey } },
                `Copied the workflow of ${sourceProjectKey}.`,
                'Could not copy the workflow.',
              )
            }
          />
        </>
      )}
    </section>
  );
}

type Run = (
  path: string,
  init: RequestInit & { json?: unknown },
  done: string,
  failure: string,
) => Promise<boolean>;

function StatusList({
  workflow,
  busy,
  run,
}: {
  workflow: WorkflowConfig;
  busy: boolean;
  run: Run;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<StatusCategory>('in_progress');
  const [retiring, setRetiring] = useState<WorkflowStatus | null>(null);
  const ids = workflow.statuses.map((status) => status.id);

  const statusPath = (status: WorkflowStatus) => `/statuses/${status.id}`;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-muted">Statuses</h3>
      <ul className="flex flex-col divide-y divide-edge rounded-md border border-edge bg-panel">
        {workflow.statuses.map((status, index) => (
          <li
            key={status.id}
            data-testid={`status-${status.key}`}
            className={`flex flex-wrap items-center gap-2 px-3 py-2 ${status.active ? '' : 'opacity-60'}`}
          >
            <span className="flex flex-col">
              <button
                type="button"
                className="text-muted hover:text-text disabled:opacity-30"
                aria-label={`Move ${status.name} up`}
                disabled={busy || index === 0}
                onClick={() =>
                  void run(
                    '/order',
                    { method: 'PUT', json: { statusIds: moveInOrder(ids, status.id, -1) } },
                    'Order saved.',
                    'Could not reorder the statuses.',
                  )
                }
              >
                <ArrowUp size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="text-muted hover:text-text disabled:opacity-30"
                aria-label={`Move ${status.name} down`}
                disabled={busy || index === ids.length - 1}
                onClick={() =>
                  void run(
                    '/order',
                    { method: 'PUT', json: { statusIds: moveInOrder(ids, status.id, 1) } },
                    'Order saved.',
                    'Could not reorder the statuses.',
                  )
                }
              >
                <ArrowDown size={12} aria-hidden="true" />
              </button>
            </span>
            <StatusGlyph category={status.category} statusKey={status.key} />
            <StatusName
              key={`${status.id}:${status.name}`}
              status={status}
              busy={busy}
              onRename={(next) =>
                run(
                  statusPath(status),
                  { method: 'PATCH', json: { name: next } },
                  `Renamed to ${next}.`,
                  'Could not rename the status.',
                )
              }
            />
            <span
              className="font-mono text-xs text-muted"
              title="The fixed key: it never changes when the name does. Queries and the API take either."
            >
              key {status.key}
            </span>
            <select
              aria-label={`Category of ${status.name}`}
              className={`${inputClass()} w-36`}
              value={status.category}
              disabled={busy}
              onChange={(event) =>
                void run(
                  statusPath(status),
                  { method: 'PATCH', json: { category: event.target.value } },
                  `${status.name} is now ${STATUS_CATEGORY_LABELS[event.target.value as StatusCategory].toLowerCase()}.`,
                  'Could not change the category.',
                )
              }
            >
              {STATUS_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">{ticketsWord(status.ticketCount)}</span>
            <span className="ml-auto flex items-center gap-2">
              {status.initial ? (
                <span className="text-xs text-muted">Where new tickets start</span>
              ) : (
                status.active &&
                status.category === 'not_started' && (
                  <button
                    type="button"
                    className={buttonClass('ghost')}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        statusPath(status),
                        { method: 'PATCH', json: { initial: true } },
                        `New tickets now start in ${status.name}.`,
                        'Could not change where tickets start.',
                      )
                    }
                  >
                    Start here
                  </button>
                )
              )}
              {status.active ? (
                !status.initial && (
                  <button
                    type="button"
                    className={buttonClass('ghost')}
                    disabled={busy}
                    onClick={() => setRetiring(status)}
                  >
                    Deactivate
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className={buttonClass('ghost')}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      `${statusPath(status)}/reactivate`,
                      { method: 'POST', json: {} },
                      `${status.name} is active again.`,
                      'Could not reactivate the status.',
                    )
                  }
                >
                  Reactivate
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          void run(
            '/statuses',
            { method: 'POST', json: { name: trimmed, category } },
            `Added ${trimmed}.`,
            'Could not add the status.',
          ).then((ok) => ok && setName(''));
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-muted">
          New status
          <input
            className={`${inputClass()} w-56`}
            value={name}
            maxLength={STATUS_NAME_MAX}
            placeholder="QA"
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Category
          <select
            className={`${inputClass()} w-36`}
            value={category}
            disabled={busy}
            onChange={(event) => setCategory(event.target.value as StatusCategory)}
          >
            {STATUS_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {STATUS_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass()} disabled={busy || !name.trim()}>
          Add status
        </button>
      </form>

      <RetireDialog
        status={retiring}
        workflow={workflow}
        busy={busy}
        onCancel={() => setRetiring(null)}
        onConfirm={(destinationStatusId) => {
          if (!retiring) return;
          void run(
            `${statusPath(retiring)}/deactivate`,
            { method: 'POST', json: destinationStatusId ? { destinationStatusId } : {} },
            `${retiring.name} is no longer active.`,
            'Could not deactivate the status.',
          ).then(() => setRetiring(null));
        }}
      />
    </div>
  );
}

/** A status's name as a field: saved on Enter or when it loses focus, put back on Escape. */
function StatusName({
  status,
  busy,
  onRename,
}: {
  status: WorkflowStatus;
  busy: boolean;
  onRename: (name: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(status.name);
  const commit = () => {
    const next = value.trim();
    if (!next || next === status.name) {
      setValue(status.name);
      return;
    }
    void onRename(next).then((ok) => !ok && setValue(status.name));
  };
  return (
    <input
      aria-label={`Name of ${status.key}`}
      className={`${inputClass()} w-48`}
      value={value}
      maxLength={STATUS_NAME_MAX}
      disabled={busy}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          setValue(status.name);
        }
      }}
    />
  );
}

/** Deactivating a status: where its tickets go, when it has any. */
function RetireDialog({
  status,
  workflow,
  busy,
  onCancel,
  onConfirm,
}: {
  status: WorkflowStatus | null;
  workflow: WorkflowConfig;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (destinationStatusId: string | null) => void;
}) {
  const others = workflow.statuses.filter((s) => s.active && s.id !== status?.id);
  const [destination, setDestination] = useState('');
  const chosen = others.some((s) => s.id === destination) ? destination : (others[0]?.id ?? '');
  const hasTickets = (status?.ticketCount ?? 0) > 0;

  return (
    <Modal open={status !== null} onClose={() => !busy && onCancel()} labelledBy="retire-title">
      {status && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(hasTickets ? chosen : null);
          }}
        >
          <h2 id="retire-title" className="text-base font-semibold">
            Deactivate {status.name}
          </h2>
          <p className="text-[13px] text-muted">
            It will no longer be offered. Its transitions are kept, and reactivating it brings it
            back as it was.
          </p>
          {hasTickets && (
            <label className="flex flex-col gap-1.5 text-[13px]">
              <span>Move its {ticketsWord(status.ticketCount)} to</span>
              <select
                className={inputClass()}
                value={chosen}
                onChange={(event) => setDestination(event.target.value)}
              >
                {others.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted">
                Each ticket&apos;s history will say it moved when {status.name} was retired.
              </span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={buttonClass('secondary')}
              onClick={onCancel}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className={buttonClass('danger')} disabled={busy}>
              {busy ? 'Working' : 'Deactivate'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/**
 * Rows are "from", columns are "to"; a tick allows the move. The selected move's rules are
 * chosen below the grid.
 */
function TransitionsGrid({
  workflow,
  draft,
  setDraft,
  busy,
  onSave,
  onDiscard,
}: {
  workflow: WorkflowConfig;
  draft: GridDraft;
  setDraft: (draft: GridDraft) => void;
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const active = workflow.statuses.filter((status) => status.active);
  const [selected, setSelected] = useState<{ from: string; to: string } | null>(null);
  const dirty = isDirty(draft, draftOf(workflow));
  const stuck = statusesWithoutWayOut(
    active,
    Object.keys(draft).map((key) => {
      const [fromStatusId, toStatusId] = key.split('>') as [string, string];
      return { fromStatusId, toStatusId };
    }),
  );
  const nameOf = (id: string) => active.find((s) => s.id === id)?.name ?? '';
  const selectedRules = selected ? draft[cellKey(selected.from, selected.to)] : undefined;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-muted">Transitions</h3>
      <div className="overflow-x-auto rounded-md border border-edge bg-panel">
        <table className="text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 text-left text-xs font-normal text-muted">
                From ↓ / To →
              </th>
              {active.map((to) => (
                <th key={to.id} scope="col" className="px-2 py-2 text-xs font-medium">
                  {to.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {active.map((from) => (
              <tr key={from.id}>
                <th scope="row" className="px-3 py-1.5 text-left font-medium whitespace-nowrap">
                  {from.name}
                </th>
                {active.map((to) => {
                  if (from.id === to.id) {
                    return (
                      <td key={to.id} className="px-2 py-1.5 text-center text-muted">
                        –
                      </td>
                    );
                  }
                  const rules = draft[cellKey(from.id, to.id)];
                  const isSelected = selected?.from === from.id && selected.to === to.id;
                  return (
                    <td
                      key={to.id}
                      className={`px-2 py-1.5 text-center ${isSelected ? 'bg-raised' : ''}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="checkbox"
                          aria-label={`Allow ${from.name} to ${to.name}`}
                          checked={rules !== undefined}
                          disabled={busy}
                          onChange={() => {
                            setDraft(toggleMove(draft, from.id, to.id));
                            setSelected(rules === undefined ? { from: from.id, to: to.id } : null);
                          }}
                          className="size-3.5 accent-[var(--active)]"
                        />
                        {rules !== undefined && (
                          <button
                            type="button"
                            className="rounded px-1 text-xs text-muted hover:bg-raised hover:text-text"
                            aria-label={`Rules for ${from.name} to ${to.name}: ${rules.length}`}
                            aria-pressed={isSelected}
                            onClick={() => setSelected({ from: from.id, to: to.id })}
                          >
                            {rules.length > 0
                              ? `${rules.length} rule${rules.length === 1 ? '' : 's'}`
                              : 'rules'}
                          </button>
                        )}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && selectedRules !== undefined && (
        <fieldset className="flex flex-col gap-1.5 rounded-md border border-edge bg-panel p-3">
          <legend className="px-1 text-xs text-muted">
            {nameOf(selected.from)} → {nameOf(selected.to)} needs
          </legend>
          {TRANSITION_RULES.map((rule) => (
            <label key={rule} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={selectedRules.includes(rule)}
                disabled={busy}
                onChange={() => setDraft(toggleRule(draft, selected.from, selected.to, rule))}
                className="size-3.5 accent-[var(--active)]"
              />
              {TRANSITION_RULE_LABELS[rule]}
            </label>
          ))}
        </fieldset>
      )}

      {stuck.length > 0 && (
        <p className="text-xs text-ember" role="status" data-testid="no-way-out">
          {stuck.map((s) => s.name).join(', ')} {stuck.length === 1 ? 'has' : 'have'} no way out: a
          ticket there could not move on.
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass('primary')}
          disabled={busy || !dirty}
          onClick={onSave}
        >
          Save transitions
        </button>
        {dirty && (
          <button
            type="button"
            className={buttonClass('ghost')}
            disabled={busy}
            onClick={onDiscard}
          >
            Discard changes
          </button>
        )}
      </div>
    </div>
  );
}

function CopyWorkflow({
  projectKey,
  projects,
  busy,
  onCopy,
}: {
  projectKey: string;
  projects: Project[];
  busy: boolean;
  onCopy: (sourceProjectKey: string) => Promise<boolean>;
}) {
  const [source, setSource] = useState('');
  const [confirming, setConfirming] = useState(false);
  if (projects.length === 0) return null;
  const chosen = projects.find((p) => p.key === source) ?? projects[0]!;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted">Copy from another project</h3>
      <div className="flex flex-wrap items-end gap-2">
        <select
          aria-label="Project to copy the workflow from"
          className={`${inputClass()} w-64`}
          value={chosen.key}
          disabled={busy}
          onChange={(event) => setSource(event.target.value)}
        >
          {projects.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key} · {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={buttonClass()}
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          Copy workflow
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={`Copy the workflow of ${chosen.key}?`}
        confirmLabel="Copy workflow"
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void onCopy(chosen.key).then(() => setConfirming(false))}
      >
        {projectKey} takes the statuses, transitions and rules of {chosen.key}. Statuses only{' '}
        {projectKey} has are deactivated; if any of them hold tickets the copy is refused, so
        deactivate those first and choose where their tickets go.
      </ConfirmDialog>
    </div>
  );
}
