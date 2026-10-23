'use client';

import type { SavedView, TicketFilters, ViewDefinition } from '@forge/shared';
import { Bookmark, Check, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { FormField, describedBy } from '@/components/ui/form-field';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Modal } from '@/components/ui/modal';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { definitionFromFilters, matchesView, viewTarget } from '@/lib/saved-views';
import { buttonClass, inputClass } from '@/lib/ui';
import { useDismiss } from '@/lib/use-dismiss';

type Props = {
  slug: string;
  organisationId: string;
  viewerUserId: string;
  views: SavedView[];
  /** May create and change shared views (the projects.manage permission). */
  canShare: boolean;
  /** The filters on screen, saved as they are now. */
  filters: TicketFilters;
  display: ViewDefinition['display'];
};

/** The "Views" button: open a saved view, or save what is on screen as one. */
export function SavedViewsMenu(props: Props) {
  const { slug, viewerUserId, views, canShare, filters, display } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useDismiss(ref, open, () => setOpen(false));

  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<SavedView | null>(null);
  const [deleting, setDeleting] = useState<SavedView | null>(null);
  const [busy, setBusy] = useState(false);

  const personal = views.filter((view) => view.scope === 'personal');
  const shared = views.filter((view) => view.scope === 'shared');
  const canChange = (view: SavedView) =>
    view.scope === 'shared' ? canShare : view.ownerUserId === viewerUserId;

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    try {
      await action();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : failure);
    } finally {
      setBusy(false);
    }
  }

  const updateToCurrent = (view: SavedView) =>
    run(async () => {
      await apiFetch(`/api/v1/orgs/${props.organisationId}/views/${view.id}`, {
        method: 'PATCH',
        json: { definition: definitionFromFilters(filters, display) },
      });
      toast.success(`Updated “${view.name}” with what you see now.`);
    }, 'Could not update the view.');

  const group = (title: string, items: SavedView[]) =>
    items.length > 0 && (
      <section aria-label={title}>
        <h3 className="px-2 pb-1 pt-2 text-xs text-muted">{title}</h3>
        <ul>
          {items.map((view) => {
            const current = matchesView(view, filters, display);
            return (
              <li key={view.id} className="group flex items-center rounded hover:bg-raised">
                <Link
                  href={viewTarget(slug, view)}
                  onClick={() => setOpen(false)}
                  aria-current={current ? 'true' : undefined}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-[13px]"
                >
                  <span className="inline-flex size-4 shrink-0 items-center justify-center">
                    {current && <Check size={14} aria-hidden="true" />}
                  </span>
                  <span className="truncate">{view.name}</span>
                  <span className="sr-only">{current ? ', current view' : ''}</span>
                </Link>
                {canChange(view) && (
                  <span className="flex shrink-0 items-center pr-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                    <IconButton
                      label={`Update ${view.name} with the current filters`}
                      onClick={() => void updateToCurrent(view)}
                      disabled={busy}
                    >
                      <RefreshCw size={13} aria-hidden="true" />
                    </IconButton>
                    <IconButton label={`Rename ${view.name}`} onClick={() => setRenaming(view)}>
                      <Pencil size={13} aria-hidden="true" />
                    </IconButton>
                    <IconButton label={`Delete ${view.name}`} onClick={() => setDeleting(view)}>
                      <Trash2 size={13} aria-hidden="true" />
                    </IconButton>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );

  return (
    <div
      ref={ref}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className={buttonClass('secondary')}
      >
        <Bookmark size={14} aria-hidden="true" />
        Views
        {views.length > 0 && <span className="font-mono text-xs text-muted">{views.length}</span>}
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute right-0 top-9 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-edge-strong bg-panel p-1 shadow-[0_10px_28px_rgba(0,0,0,0.5)]"
        >
          {views.length === 0 ? (
            <p className="px-2 py-2 text-[13px] text-muted">
              No saved views yet. Set some filters, then save them here to come back to.
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {group('Your views', personal)}
              {group('Shared views', shared)}
            </div>
          )}
          <div className="mt-1 border-t border-edge p-1">
            <button
              type="button"
              className={`${buttonClass('ghost')} w-full justify-start`}
              onClick={() => {
                setOpen(false);
                setSaving(true);
              }}
            >
              Save current view
            </button>
          </div>
        </div>
      )}

      <SaveViewDialog
        mode="create"
        open={saving}
        onClose={() => setSaving(false)}
        organisationId={props.organisationId}
        canShare={canShare}
        definition={definitionFromFilters(filters, display)}
      />
      <SaveViewDialog
        mode="rename"
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        organisationId={props.organisationId}
        canShare={canShare}
        view={renaming}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete this view?"
        confirmLabel="Delete view"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const view = deleting;
          if (!view) return;
          void run(async () => {
            await apiFetch(`/api/v1/orgs/${props.organisationId}/views/${view.id}`, {
              method: 'DELETE',
            });
            toast.success(`Deleted “${view.name}”.`);
            setDeleting(null);
          }, 'Could not delete the view.');
        }}
      >
        {deleting?.scope === 'shared'
          ? `“${deleting.name}” is shared, so it disappears for everyone in the workspace.`
          : `“${deleting?.name ?? ''}” will be removed. The tickets themselves are not affected.`}
      </ConfirmDialog>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex size-6 items-center justify-center rounded text-muted hover:bg-edge hover:text-text disabled:opacity-50"
    >
      {children}
    </button>
  );
}

type DialogProps = {
  open: boolean;
  onClose: () => void;
  organisationId: string;
  canShare: boolean;
} & (
  | { mode: 'create'; definition: ViewDefinition; view?: undefined }
  | { mode: 'rename'; view: SavedView | null; definition?: undefined }
);

/** Name a new view (and choose who sees it), or rename one. */
function SaveViewDialog(props: DialogProps) {
  const { open, onClose, organisationId, canShare } = props;
  const router = useRouter();
  const titleId = useId();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'personal' | 'shared'>('personal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // Start from the view's own name each time the rename dialog opens for a view.
  const [lastView, setLastView] = useState<string | null>(null);
  const viewId = props.mode === 'rename' ? (props.view?.id ?? null) : null;
  if (props.mode === 'rename' && viewId !== lastView) {
    setLastView(viewId);
    setName(props.view?.name ?? '');
    setError(null);
  }

  const trimmed = name.trim();
  const problem =
    trimmed.length === 0
      ? 'Give the view a name.'
      : trimmed.length > 80
        ? 'Use 80 characters or fewer.'
        : undefined;

  function close() {
    if (busy) return;
    setName('');
    setScope('personal');
    setError(null);
    setTouched(false);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      if (props.mode === 'create') {
        await apiFetch(`/api/v1/orgs/${organisationId}/views`, {
          method: 'POST',
          json: { name: trimmed, scope, definition: props.definition },
        });
        toast.success(`Saved “${trimmed}”.`);
      } else if (props.view) {
        await apiFetch(`/api/v1/orgs/${organisationId}/views/${props.view.id}`, {
          method: 'PATCH',
          json: { name: trimmed },
        });
        toast.success(`Renamed to “${trimmed}”.`);
      }
      setBusy(false);
      setName('');
      setScope('personal');
      setTouched(false);
      onClose();
      router.refresh();
    } catch (failure) {
      setBusy(false);
      setError(failure instanceof ApiRequestError ? failure.message : 'Could not save the view.');
    }
  }

  const fieldId = `${titleId}-name`;
  const shownError = error ?? (touched ? problem : undefined);
  return (
    <Modal open={open} onClose={close} labelledBy={titleId} width="26rem">
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <h2 id={titleId} className="text-base font-semibold">
          {props.mode === 'create' ? 'Save current view' : 'Rename view'}
        </h2>
        <FormField id={fieldId} label="Name" error={shownError}>
          <input
            id={fieldId}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            onBlur={() => setTouched(true)}
            autoFocus
            autoComplete="off"
            aria-invalid={shownError ? true : undefined}
            aria-describedby={describedBy(fieldId)}
            className={inputClass(Boolean(shownError))}
            placeholder="My open work"
          />
        </FormField>

        {props.mode === 'create' && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[13px] font-medium">Who can see it</legend>
            <label className="flex items-start gap-2 text-[13px]">
              <input
                type="radio"
                name={`${titleId}-scope`}
                checked={scope === 'personal'}
                onChange={() => setScope('personal')}
                className="mt-0.5 accent-[var(--text)]"
              />
              <span>
                Only me
                <span className="block text-xs text-muted">Appears in your own list of views.</span>
              </span>
            </label>
            {canShare && (
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="radio"
                  name={`${titleId}-scope`}
                  checked={scope === 'shared'}
                  onChange={() => setScope('shared')}
                  className="mt-0.5 accent-[var(--text)]"
                />
                <span>
                  Everyone in the workspace
                  <span className="block text-xs text-muted">
                    Owners and administrators can change or delete it.
                  </span>
                </span>
              </label>
            )}
          </fieldset>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            className={buttonClass('secondary')}
            onClick={close}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="submit" className={buttonClass('primary')} disabled={busy}>
            {busy ? 'Saving' : props.mode === 'create' ? 'Save view' : 'Rename'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
