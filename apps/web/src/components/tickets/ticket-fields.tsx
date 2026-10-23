'use client';

import {
  formatEstimate,
  type Member,
  type Priority,
  type TicketConfig,
  type TicketType,
} from '@forge/shared';
import { useId, useState, type ReactNode } from 'react';
import { parseEstimate, statusOptions, validateDueDate } from '@/lib/ticket-form';
import { formatRelativeTime } from '@/lib/tickets';
import { buttonClass, inputClass } from '@/lib/ui';
import {
  DueDate,
  PriorityBars,
  PriorityMark,
  StatusBadge,
  StatusGlyph,
  TypeBadge,
  TypeIcon,
} from './badges';
import { CheckboxList, FilterPopover } from './filter-popover';
import { LabelChips } from './label-chip';
import { useTicketEditor } from './ticket-editor';
import { Avatar, UserChip } from './user-chip';

/** A value that follows the server's copy, but keeps what was typed until it is saved. */
function useDraft(source: string) {
  const [draft, setDraft] = useState(source);
  const [seen, setSeen] = useState(source);
  if (source !== seen) {
    setSeen(source);
    setDraft(source);
  }
  return [draft, setDraft] as const;
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-start gap-3 py-2">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="pt-1.5 text-xs text-muted">
          {label}
        </label>
      ) : (
        <span id={id} className="pt-1.5 text-xs text-muted">
          {label}
        </span>
      )}
      <div aria-labelledby={htmlFor ? undefined : id} className="min-w-0">
        {children}
      </div>
    </div>
  );
}

/** A native select with a small picture of the chosen value at its left. */
function PicSelect({
  id,
  value,
  onChange,
  disabled,
  icon,
  children,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-2.5 top-0 flex h-8 items-center">
          {icon}
        </span>
      )}
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClass()} ${icon ? 'pl-8' : ''}`}
      >
        {children}
      </select>
    </div>
  );
}

export function TicketFields({
  config,
  members,
  today,
  now,
}: {
  config: TicketConfig;
  /** People who can be assigned. Empty when the viewer may not see the member list. */
  members: Member[];
  today: string;
  now: string;
}) {
  const { ticket, canEdit, canAssign, saving, save } = useTicketEditor();
  const maxRank = Math.max(1, ...config.priorities.map((priority) => priority.rank));
  const done = ticket.status.category === 'completed';
  const projectComponents = config.components.filter(
    (component) => component.projectId === ticket.project.id,
  );

  const [due, setDue] = useDraft(ticket.dueDate ?? '');
  const dueProblem = validateDueDate(due);
  const dueChanged = due !== (ticket.dueDate ?? '');
  const commitDue = () => save({ dueDate: due === '' ? null : due });
  const [estimate, setEstimate] = useDraft(formatEstimate(ticket.estimateMinutes) ?? '');
  const parsedEstimate = parseEstimate(estimate);

  const priority: Priority | undefined = config.priorities.find(
    (item) => item.id === ticket.priority.id,
  );
  const type: TicketType | undefined = config.types.find((item) => item.id === ticket.type.id);
  const statuses = statusOptions(ticket.status, ticket.allowedTransitions);

  return (
    <dl className="divide-y divide-edge rounded-md border border-edge bg-panel px-4">
      <Row label="Status" htmlFor={canEdit ? 'field-status' : undefined}>
        {canEdit ? (
          <PicSelect
            id="field-status"
            value={ticket.status.id}
            disabled={saving}
            icon={<StatusGlyph category={ticket.status.category} statusKey={ticket.status.key} />}
            onChange={(statusId) => void save({ statusId })}
          >
            <optgroup label="Current">
              <option value={ticket.status.id}>{ticket.status.name}</option>
            </optgroup>
            {statuses.length > 1 && (
              <optgroup label="Move to">
                {statuses
                  .filter((status) => !status.current)
                  .map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name}
                    </option>
                  ))}
              </optgroup>
            )}
          </PicSelect>
        ) : (
          <div className="pt-1.5">
            <StatusBadge status={ticket.status} />
          </div>
        )}
      </Row>

      <Row label="Priority" htmlFor={canEdit ? 'field-priority' : undefined}>
        {canEdit ? (
          <PicSelect
            id="field-priority"
            value={ticket.priority.id}
            disabled={saving}
            icon={<PriorityBars rank={ticket.priority.rank} maxRank={maxRank} />}
            onChange={(priorityId) => void save({ priorityId })}
          >
            {[...config.priorities]
              .sort((a, b) => b.rank - a.rank)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </PicSelect>
        ) : (
          <div className="pt-1.5">
            <PriorityMark priority={priority ?? ticket.priority} maxRank={maxRank} />
          </div>
        )}
      </Row>

      <Row label="Type" htmlFor={canEdit ? 'field-type' : undefined}>
        {canEdit ? (
          <PicSelect
            id="field-type"
            value={ticket.type.id}
            disabled={saving}
            icon={<TypeIcon typeKey={ticket.type.key} />}
            onChange={(typeId) => void save({ typeId })}
          >
            {config.types.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </PicSelect>
        ) : (
          <div className="pt-1.5">
            <TypeBadge type={type ?? ticket.type} />
          </div>
        )}
      </Row>

      <Row
        label="Assignee"
        htmlFor={canAssign && members.length > 0 ? 'field-assignee' : undefined}
      >
        {canAssign && members.length > 0 ? (
          <PicSelect
            id="field-assignee"
            value={ticket.assignee?.id ?? ''}
            disabled={saving}
            icon={ticket.assignee ? <Avatar person={ticket.assignee} size={16} /> : undefined}
            onChange={(assigneeId) => void save({ assigneeId: assigneeId || null })}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {member.user.displayName}
              </option>
            ))}
          </PicSelect>
        ) : (
          <div className="pt-1.5">
            <UserChip person={ticket.assignee} />
          </div>
        )}
      </Row>

      <Row label="Labels">
        <div className="flex flex-col items-start gap-2 pt-1">
          {ticket.labels.length > 0 ? (
            <LabelChips labels={ticket.labels} max={20} />
          ) : (
            <span className="text-[13px] text-muted">None</span>
          )}
          {canEdit && config.labels.length > 0 && (
            <FilterPopover label="Edit labels" count={0}>
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
                selected={ticket.labels.map((label) => label.id)}
                onToggle={(id) => {
                  const current = ticket.labels.map((label) => label.id);
                  void save({
                    labelIds: current.includes(id)
                      ? current.filter((existing) => existing !== id)
                      : [...current, id],
                  });
                }}
              />
            </FilterPopover>
          )}
        </div>
      </Row>

      <Row
        label="Component"
        htmlFor={canEdit && projectComponents.length > 0 ? 'field-component' : undefined}
      >
        {canEdit && projectComponents.length > 0 ? (
          <PicSelect
            id="field-component"
            value={ticket.component?.id ?? ''}
            disabled={saving}
            onChange={(componentId) => void save({ componentId: componentId || null })}
          >
            <option value="">None</option>
            {projectComponents.map((component) => (
              <option key={component.id} value={component.id}>
                {component.name}
              </option>
            ))}
          </PicSelect>
        ) : (
          <div className="pt-1.5 text-[13px]">
            {ticket.component?.name ?? <span className="text-muted">None</span>}
          </div>
        )}
      </Row>

      <Row label="Due date" htmlFor={canEdit ? 'field-due' : undefined}>
        {canEdit ? (
          <div className="flex flex-col gap-1">
            <input
              id="field-due"
              type="date"
              value={due}
              disabled={saving}
              onChange={(event) => setDue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && dueChanged && !dueProblem) {
                  event.preventDefault();
                  void commitDue();
                }
              }}
              aria-invalid={dueProblem ? true : undefined}
              className={inputClass(Boolean(dueProblem))}
            />
            {/*
              A date field is saved on purpose, not on every change or on leaving it: typing a
              year fires a change for each partial value, and Tab only moves between its parts.
            */}
            {dueChanged && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`${buttonClass('primary')} h-7 px-2.5 text-xs`}
                  disabled={saving || Boolean(dueProblem)}
                  onClick={() => void commitDue()}
                >
                  {due === '' ? 'Remove due date' : 'Save due date'}
                </button>
                <button
                  type="button"
                  className={`${buttonClass('ghost')} h-7 px-2.5 text-xs`}
                  disabled={saving}
                  onClick={() => setDue(ticket.dueDate ?? '')}
                >
                  Cancel
                </button>
              </div>
            )}
            {ticket.dueDate && !dueChanged && (
              <span className="text-xs">
                <DueDate date={ticket.dueDate} today={today} done={done} />
              </span>
            )}
          </div>
        ) : (
          <div className="pt-1.5">
            <DueDate date={ticket.dueDate} today={today} done={done} />
          </div>
        )}
      </Row>

      <Row label="Estimate" htmlFor={canEdit ? 'field-estimate' : undefined}>
        {canEdit ? (
          <div className="flex flex-col gap-1">
            <input
              id="field-estimate"
              value={estimate}
              disabled={saving}
              placeholder="1h 30m"
              autoComplete="off"
              onChange={(event) => setEstimate(event.target.value)}
              onBlur={() => {
                if (!parsedEstimate.ok) return;
                if (parsedEstimate.minutes === ticket.estimateMinutes) return;
                void save({ estimateMinutes: parsedEstimate.minutes });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              aria-invalid={!parsedEstimate.ok ? true : undefined}
              aria-describedby="field-estimate-problem"
              className={inputClass(!parsedEstimate.ok)}
            />
            <p
              id="field-estimate-problem"
              role={!parsedEstimate.ok ? 'alert' : undefined}
              className="text-xs text-fail"
            >
              {!parsedEstimate.ok ? parsedEstimate.message : null}
            </p>
          </div>
        ) : (
          <div className="pt-1.5 text-[13px]">
            {formatEstimate(ticket.estimateMinutes) ?? <span className="text-muted">None</span>}
          </div>
        )}
      </Row>

      <Row label="Reporter">
        <div className="pt-1.5">
          <UserChip person={ticket.reporter} />
        </div>
      </Row>

      <Row label="Created">
        <div className="pt-1.5 text-[13px] text-muted">
          <time dateTime={ticket.createdAt} title={ticket.createdAt}>
            {formatRelativeTime(ticket.createdAt, now)}
          </time>
        </div>
      </Row>

      <Row label="Updated">
        <div className="pt-1.5 text-[13px] text-muted">
          <time dateTime={ticket.updatedAt} title={ticket.updatedAt}>
            {formatRelativeTime(ticket.updatedAt, now)}
          </time>
        </div>
      </Row>
    </dl>
  );
}
