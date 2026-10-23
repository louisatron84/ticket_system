'use client';

import type { Member, Project, TicketConfig, TicketDetail } from '@forge/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { FormField, describedBy } from '@/components/ui/form-field';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { workspaceHref } from '@/lib/nav';
import { parseEstimate, validateTicketForm, type TicketFormErrors } from '@/lib/ticket-form';
import { buttonClass, inputClass, textareaClass } from '@/lib/ui';
import { LabelChips } from './label-chip';
import { CheckboxList, FilterPopover } from './filter-popover';

type Field = keyof TicketFormErrors;

/** The new-ticket page. Checks as you type, and keeps everything you entered if the server says no. */
export function TicketForm({
  organisationId,
  slug,
  projects,
  config,
  members,
  canAssign,
  initialProject,
}: {
  organisationId: string;
  slug: string;
  /** Projects that can take tickets. */
  projects: Project[];
  config: TicketConfig;
  /** People who can be assigned; empty if the viewer may not assign or may not see members. */
  members: Member[];
  canAssign: boolean;
  initialProject: string;
}) {
  const router = useRouter();
  const defaultType = config.types.find((type) => type.key === 'task') ?? config.types[0];
  const defaultPriority =
    config.priorities.find((priority) => priority.key === 'normal') ?? config.priorities[0];

  const [project, setProject] = useState(
    projects.some((item) => item.key === initialProject)
      ? initialProject
      : (projects[0]?.key ?? ''),
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [typeId, setTypeId] = useState(defaultType?.id ?? '');
  const [priorityId, setPriorityId] = useState(defaultPriority?.id ?? '');
  const [assigneeId, setAssigneeId] = useState('');
  const [componentId, setComponentId] = useState('');
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [estimate, setEstimate] = useState('');

  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const errors = validateTicketForm({
    project,
    title,
    description,
    typeId,
    priorityId,
    dueDate,
    estimate,
  });
  const shown = (field: Field) => (submitted || touched[field] ? errors[field] : undefined);
  const touch = (field: Field) => setTouched((current) => ({ ...current, [field]: true }));

  const projectId = projects.find((item) => item.key === project)?.id;
  const components = config.components.filter((component) => component.projectId === projectId);
  const chosenLabels = config.labels.filter((label) => labelIds.includes(label.id));
  const sortedPriorities = [...config.priorities].sort((a, b) => b.rank - a.rank);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (Object.keys(errors).length > 0) return;

    const parsedEstimate = parseEstimate(estimate);
    setBusy(true);
    try {
      const created = await apiFetch<TicketDetail>(
        `/api/v1/orgs/${organisationId}/projects/${project}/tickets`,
        {
          method: 'POST',
          json: {
            title: title.trim(),
            typeId,
            priorityId,
            ...(description.trim() ? { description } : {}),
            ...(assigneeId ? { assigneeId } : {}),
            ...(componentId ? { componentId } : {}),
            ...(labelIds.length > 0 ? { labelIds } : {}),
            ...(dueDate ? { dueDate } : {}),
            ...(parsedEstimate.ok && parsedEstimate.minutes !== null
              ? { estimateMinutes: parsedEstimate.minutes }
              : {}),
          },
        },
      );
      toast.success(`Created ${created.key}.`);
      router.push(workspaceHref(slug, `/tickets/${created.key}`));
    } catch (failure) {
      setBusy(false);
      setServerError(
        failure instanceof ApiRequestError ? failure.message : 'Could not create the ticket.',
      );
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <FormField id="ticket-project" label="Project" error={shown('project')}>
          <select
            id="ticket-project"
            value={project}
            onChange={(event) => {
              setProject(event.target.value);
              setComponentId('');
            }}
            onBlur={() => touch('project')}
            aria-invalid={shown('project') ? true : undefined}
            aria-describedby={describedBy('ticket-project')}
            className={`${inputClass(Boolean(shown('project')))} max-w-xs`}
          >
            {projects.map((item) => (
              <option key={item.id} value={item.key}>
                {item.key} {item.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="ticket-title" label="Title" error={shown('title')}>
          <input
            id="ticket-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => touch('title')}
            autoFocus
            autoComplete="off"
            aria-invalid={shown('title') ? true : undefined}
            aria-describedby={describedBy('ticket-title')}
            className={`${inputClass(Boolean(shown('title')))} h-10 text-[15px]`}
            placeholder="What needs doing?"
          />
        </FormField>

        <FormField
          id="ticket-description"
          label="Description"
          optional
          error={shown('description')}
          hint="Plain text. Line breaks are kept."
        >
          <textarea
            id="ticket-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onBlur={() => touch('description')}
            rows={10}
            aria-invalid={shown('description') ? true : undefined}
            aria-describedby={describedBy('ticket-description')}
            className={textareaClass(Boolean(shown('description')))}
          />
        </FormField>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <FormField id="ticket-type" label="Type" error={shown('typeId')}>
          <select
            id="ticket-type"
            value={typeId}
            onChange={(event) => setTypeId(event.target.value)}
            onBlur={() => touch('typeId')}
            aria-describedby={describedBy('ticket-type')}
            className={inputClass(Boolean(shown('typeId')))}
          >
            {config.types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id="ticket-priority" label="Priority" error={shown('priorityId')}>
          <select
            id="ticket-priority"
            value={priorityId}
            onChange={(event) => setPriorityId(event.target.value)}
            onBlur={() => touch('priorityId')}
            aria-describedby={describedBy('ticket-priority')}
            className={inputClass(Boolean(shown('priorityId')))}
          >
            {sortedPriorities.map((priority) => (
              <option key={priority.id} value={priority.id}>
                {priority.name}
              </option>
            ))}
          </select>
        </FormField>

        {canAssign && members.length > 0 && (
          <FormField id="ticket-assignee" label="Assignee" optional>
            <select
              id="ticket-assignee"
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              aria-describedby={describedBy('ticket-assignee')}
              className={inputClass()}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.user.id} value={member.user.id}>
                  {member.user.displayName}
                </option>
              ))}
            </select>
          </FormField>
        )}

        {components.length > 0 && (
          <FormField id="ticket-component" label="Component" optional>
            <select
              id="ticket-component"
              value={componentId}
              onChange={(event) => setComponentId(event.target.value)}
              aria-describedby={describedBy('ticket-component')}
              className={inputClass()}
            >
              <option value="">None</option>
              {components.map((component) => (
                <option key={component.id} value={component.id}>
                  {component.name}
                </option>
              ))}
            </select>
          </FormField>
        )}

        {config.labels.length > 0 && (
          <div className="flex flex-col gap-1.5">
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
                  selected={labelIds}
                  onToggle={(id) =>
                    setLabelIds((current) =>
                      current.includes(id)
                        ? current.filter((existing) => existing !== id)
                        : [...current, id],
                    )
                  }
                />
              </FilterPopover>
            </div>
          </div>
        )}

        <FormField id="ticket-due" label="Due date" optional error={shown('dueDate')}>
          <input
            id="ticket-due"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            onBlur={() => touch('dueDate')}
            aria-invalid={shown('dueDate') ? true : undefined}
            aria-describedby={describedBy('ticket-due')}
            className={inputClass(Boolean(shown('dueDate')))}
          />
        </FormField>

        <FormField
          id="ticket-estimate"
          label="Estimate"
          optional
          error={shown('estimate')}
          hint="For example 90, 45m, 1h 30m or 1.5h."
        >
          <input
            id="ticket-estimate"
            value={estimate}
            onChange={(event) => setEstimate(event.target.value)}
            onBlur={() => touch('estimate')}
            autoComplete="off"
            aria-invalid={shown('estimate') ? true : undefined}
            aria-describedby={describedBy('ticket-estimate')}
            className={inputClass(Boolean(shown('estimate')))}
          />
        </FormField>
      </div>

      <div className="flex flex-col gap-3 lg:col-span-2">
        {serverError && (
          <p role="alert" className="text-[13px] text-fail">
            {serverError}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className={buttonClass('primary')} disabled={busy}>
            {busy ? 'Creating' : 'Create ticket'}
          </button>
          <Link href={workspaceHref(slug, '/tickets')} className={buttonClass('secondary')}>
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}
