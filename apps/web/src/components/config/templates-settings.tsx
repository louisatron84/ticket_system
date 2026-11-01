'use client';

import { MAX_TEMPLATES, type TicketConfig, type TicketTemplate } from '@forge/shared';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { CheckboxList, FilterPopover } from '@/components/tickets/filter-popover';
import { LabelChips } from '@/components/tickets/label-chip';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormField, describedBy } from '@/components/ui/form-field';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import {
  availableFrom,
  blankDraft,
  bodyOf,
  draftOf,
  moved,
  offeredChoices,
  validateDraft,
  type TemplateDraft,
} from '@/lib/templates';
import { buttonClass, inputClass, textareaClass } from '@/lib/ui';

/** Which template the form is open for: a new one, or an existing one by id. */
type Editing = { mode: 'new' } | { mode: 'edit'; id: string } | null;

/**
 * The project's ticket templates: a name plus anything a new ticket can start with. People who
 * create tickets pick one on the new-ticket form; it fills the form and is not kept on the ticket.
 */
export function TemplatesSettings({
  organisationId,
  projectKey,
  projectId,
  archived,
  config,
}: {
  organisationId: string;
  projectKey: string;
  projectId: string;
  archived: boolean;
  /** Active types and priorities, the workspace's labels, every project's components. */
  config: TicketConfig;
}) {
  const base = `/api/v1/orgs/${organisationId}/projects/${projectKey}/templates`;
  const available = availableFrom(config, projectId);
  const [templates, setTemplates] = useState<TicketTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<TicketTemplate | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    apiFetch<TicketTemplate[]>(base)
      .then((list) => live && setTemplates(list))
      .catch((error: unknown) => {
        if (live) {
          setLoadError(
            error instanceof ApiRequestError ? error.message : 'Could not load the templates.',
          );
        }
      });
    return () => {
      live = false;
    };
  }, [base]);

  async function reorder(index: number, by: number) {
    if (!templates) return;
    const next = moved(templates, index, by);
    setBusy(true);
    try {
      setTemplates(
        await apiFetch<TicketTemplate[]>(`${base}/order`, {
          method: 'PUT',
          json: { ids: next.map((template) => template.id) },
        }),
      );
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not reorder.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(template: TicketTemplate) {
    setBusy(true);
    try {
      await apiFetch(`${base}/${template.id}`, { method: 'DELETE' });
      setTemplates((list) => (list ?? []).filter((item) => item.id !== template.id));
      toast.success(`Deleted the template “${template.name}”.`);
      setDeleting(null);
      if (editing?.mode === 'edit' && editing.id === template.id) setEditing(null);
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not delete it.');
    } finally {
      setBusy(false);
    }
  }

  const saved = (template: TicketTemplate) => {
    setTemplates((list) => {
      const current = list ?? [];
      return current.some((item) => item.id === template.id)
        ? current.map((item) => (item.id === template.id ? template : item))
        : [...current, template];
    });
    setEditing(null);
  };

  const full = (templates?.length ?? 0) >= MAX_TEMPLATES;

  return (
    <section aria-labelledby="templates-heading" className="flex flex-col gap-3">
      <h2 id="templates-heading" className="text-[13px] font-semibold">
        Templates
      </h2>
      <p className="max-w-prose text-xs text-muted">
        A template fills the new-ticket form: a title prefix, type, priority, component, labels,
        goal, criteria and description. People can still change everything before creating, and the
        ticket does not remember which template it came from. Up to {MAX_TEMPLATES} per project.
      </p>
      {archived && (
        <p className="text-xs text-muted">This project is archived, so its templates are fixed.</p>
      )}

      {loadError && (
        <p role="alert" className="text-[13px] text-fail">
          {loadError}
        </p>
      )}
      {templates === null && !loadError && <p className="text-xs text-muted">Loading templates…</p>}
      {templates !== null && templates.length === 0 && editing?.mode !== 'new' && (
        <p className="text-xs text-muted">No templates yet.</p>
      )}

      {templates !== null && templates.length > 0 && (
        <ol
          aria-label="Templates"
          className="flex flex-col divide-y divide-edge rounded-md border border-edge"
        >
          {templates.map((template, index) =>
            editing?.mode === 'edit' && editing.id === template.id ? (
              <li key={template.id} className="p-3">
                <TemplateForm
                  base={base}
                  config={config}
                  projectId={projectId}
                  template={template}
                  initial={draftOf(template, available)}
                  onSaved={saved}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={template.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{template.name}</p>
                  <p className="truncate text-xs text-muted">{summaryOf(template, config)}</p>
                </div>
                {!archived && (
                  <>
                    <button
                      type="button"
                      aria-label={`Move ${template.name} up`}
                      disabled={busy || index === 0}
                      onClick={() => void reorder(index, -1)}
                      className={`${buttonClass('ghost')} size-8 px-0`}
                    >
                      <ArrowUp size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${template.name} down`}
                      disabled={busy || index === templates.length - 1}
                      onClick={() => void reorder(index, 1)}
                      className={`${buttonClass('ghost')} size-8 px-0`}
                    >
                      <ArrowDown size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit ${template.name}`}
                      disabled={busy}
                      onClick={() => setEditing({ mode: 'edit', id: template.id })}
                      className={`${buttonClass('ghost')} size-8 px-0`}
                    >
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${template.name}`}
                      disabled={busy}
                      onClick={() => setDeleting(template)}
                      className={`${buttonClass('ghost')} size-8 px-0`}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            ),
          )}
        </ol>
      )}

      {editing?.mode === 'new' ? (
        <div className="rounded-md border border-edge p-3">
          <TemplateForm
            base={base}
            config={config}
            projectId={projectId}
            template={null}
            initial={blankDraft}
            onSaved={saved}
            onCancel={() => setEditing(null)}
          />
        </div>
      ) : (
        !archived &&
        templates !== null && (
          <button
            type="button"
            className={`${buttonClass('secondary')} self-start`}
            disabled={full || busy}
            onClick={() => setEditing({ mode: 'new' })}
          >
            <Plus size={13} aria-hidden="true" />
            {full ? `${MAX_TEMPLATES} templates is the most a project can have` : 'Add a template'}
          </button>
        )
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this template?"
        confirmLabel="Delete template"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
      >
        {`“${deleting?.name ?? ''}” will no longer be offered on the new-ticket form. Tickets made from it are not affected.`}
      </ConfirmDialog>
    </section>
  );
}

/** One line saying what a template fills in. */
function summaryOf(template: TicketTemplate, config: TicketConfig): string {
  const named = (item: { name: string; active: boolean } | undefined) =>
    item && (item.active ? item.name : `${item.name} (inactive, skipped)`);
  const parts = [
    template.titlePrefix && `“${template.titlePrefix}”`,
    named(config.types.find((type) => type.id === template.typeId)),
    named(config.priorities.find((priority) => priority.id === template.priorityId)),
    named(config.components.find((component) => component.id === template.componentId)),
    template.labelIds.length > 0 &&
      `${template.labelIds.length} label${template.labelIds.length === 1 ? '' : 's'}`,
    template.goal && 'goal',
    template.criteria.length > 0 &&
      `${template.criteria.length} criteri${template.criteria.length === 1 ? 'on' : 'a'}`,
    template.description && 'description',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'Fills nothing yet';
}

function TemplateForm({
  base,
  config,
  projectId,
  template,
  initial,
  onSaved,
  onCancel,
}: {
  base: string;
  config: TicketConfig;
  projectId: string;
  /** Null for a new template. */
  template: TicketTemplate | null;
  initial: TemplateDraft;
  onSaved: (template: TicketTemplate) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TemplateDraft>(initial);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const errors = validateDraft(draft);
  const shown = (field: keyof TemplateDraft) => (submitted ? errors[field] : undefined);
  const set = (patch: Partial<TemplateDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const prefix = template ? `template-${template.id}` : 'template-new';
  // Only what a new ticket could be given; a retired value already on the template shows as "Not set".
  const offered = offeredChoices(config, projectId);
  const components = offered.components;
  const chosenLabels = config.labels.filter((label) => draft.labelIds.includes(label.id));
  const sortedPriorities = [...offered.priorities].sort((a, b) => b.rank - a.rank);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    try {
      const result = await apiFetch<TicketTemplate>(template ? `${base}/${template.id}` : base, {
        method: template ? 'PATCH' : 'POST',
        json: bodyOf(draft),
      });
      toast.success(template ? `Saved “${result.name}”.` : `Added the template “${result.name}”.`);
      onSaved(result);
    } catch (error) {
      setBusy(false);
      setServerError(error instanceof ApiRequestError ? error.message : 'Could not save.');
    }
  }

  const choice = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: { id: string; name: string }[],
  ) => (
    <FormField id={id} label={label} optional>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={describedBy(id)}
        className={inputClass()}
      >
        <option value="">Not set</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </FormField>
  );

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={template ? `Edit ${template.name}` : 'New template'}
      className="flex flex-col gap-2"
    >
      <div className="grid gap-x-3 sm:grid-cols-2">
        <FormField id={`${prefix}-name`} label="Name" error={shown('name')}>
          <input
            id={`${prefix}-name`}
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
            autoFocus
            autoComplete="off"
            aria-invalid={shown('name') ? true : undefined}
            aria-describedby={describedBy(`${prefix}-name`)}
            className={inputClass(Boolean(shown('name')))}
          />
        </FormField>
        <FormField
          id={`${prefix}-title-prefix`}
          label="Title prefix"
          optional
          error={shown('titlePrefix')}
          hint="Goes before the title, such as [Bug]."
        >
          <input
            id={`${prefix}-title-prefix`}
            value={draft.titlePrefix}
            onChange={(event) => set({ titlePrefix: event.target.value })}
            autoComplete="off"
            aria-invalid={shown('titlePrefix') ? true : undefined}
            aria-describedby={describedBy(`${prefix}-title-prefix`)}
            className={inputClass(Boolean(shown('titlePrefix')))}
          />
        </FormField>
      </div>

      <div className="grid gap-x-3 sm:grid-cols-3">
        {choice(`${prefix}-type`, 'Type', draft.typeId, (typeId) => set({ typeId }), offered.types)}
        {choice(
          `${prefix}-priority`,
          'Priority',
          draft.priorityId,
          (priorityId) => set({ priorityId }),
          sortedPriorities,
        )}
        {choice(
          `${prefix}-component`,
          'Component',
          draft.componentId,
          (componentId) => set({ componentId }),
          components,
        )}
      </div>

      {config.labels.length > 0 && (
        <div className="flex flex-col gap-1.5 pb-4">
          <span className="text-[13px] font-medium">
            Labels<span className="ml-1.5 font-normal text-muted">optional</span>
          </span>
          <div className="flex flex-col items-start gap-2">
            {chosenLabels.length > 0 && <LabelChips labels={chosenLabels} max={20} />}
            <FilterPopover label={chosenLabels.length > 0 ? 'Change labels' : 'Add labels'}>
              <CheckboxList
                name="Labels"
                options={config.labels.map((label) => ({
                  value: label.id,
                  label: label.name,
                  icon: (
                    <span
                      aria-hidden="true"
                      data-color={label.color}
                      className="label-chip inline-block size-2.5 shrink-0 rounded-full"
                    />
                  ),
                }))}
                selected={draft.labelIds}
                onToggle={(id) =>
                  set({
                    labelIds: draft.labelIds.includes(id)
                      ? draft.labelIds.filter((existing) => existing !== id)
                      : [...draft.labelIds, id],
                  })
                }
              />
            </FilterPopover>
          </div>
        </div>
      )}

      <FormField id={`${prefix}-goal`} label="Goal" optional error={shown('goal')}>
        <textarea
          id={`${prefix}-goal`}
          value={draft.goal}
          onChange={(event) => set({ goal: event.target.value })}
          rows={2}
          aria-invalid={shown('goal') ? true : undefined}
          aria-describedby={describedBy(`${prefix}-goal`)}
          className={`${textareaClass(Boolean(shown('goal')))} min-h-14`}
        />
      </FormField>
      <FormField
        id={`${prefix}-criteria`}
        label="Acceptance criteria"
        optional
        error={shown('criteria')}
        hint="One per line."
      >
        <textarea
          id={`${prefix}-criteria`}
          value={draft.criteria}
          onChange={(event) => set({ criteria: event.target.value })}
          rows={3}
          aria-invalid={shown('criteria') ? true : undefined}
          aria-describedby={describedBy(`${prefix}-criteria`)}
          className={textareaClass(Boolean(shown('criteria')))}
        />
      </FormField>
      <FormField
        id={`${prefix}-description`}
        label="Description"
        optional
        error={shown('description')}
      >
        <textarea
          id={`${prefix}-description`}
          value={draft.description}
          onChange={(event) => set({ description: event.target.value })}
          rows={5}
          aria-invalid={shown('description') ? true : undefined}
          aria-describedby={describedBy(`${prefix}-description`)}
          className={textareaClass(Boolean(shown('description')))}
        />
      </FormField>

      {serverError && (
        <p role="alert" className="text-[13px] text-fail">
          {serverError}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass('primary')} disabled={busy}>
          {busy ? 'Saving' : template ? 'Save template' : 'Add template'}
        </button>
        <button
          type="button"
          className={buttonClass('secondary')}
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
