import {
  MAX_TEMPLATE_NAME_LENGTH,
  MAX_TITLE_PREFIX_LENGTH,
  hasControlCharacter,
  type CreateTemplateBody,
  type TicketConfig,
  type TicketTemplate,
} from '@forge/shared';
import { criteriaLines, validateCriteria, validateDescription, validateGoal } from './ticket-form';

/** The parts of the create form a template can fill. Criteria are one per line, as typed. */
export type TemplateFill = {
  title: string;
  typeId: string;
  priorityId: string;
  componentId: string;
  labelIds: string[];
  goal: string;
  criteria: string;
  description: string;
};

/**
 * What a new ticket can be given right now: active types and priorities, this project's active
 * components, the workspace's labels.
 */
export type Available = {
  typeIds: ReadonlySet<string>;
  priorityIds: ReadonlySet<string>;
  componentIds: ReadonlySet<string>;
  labelIds: ReadonlySet<string>;
};

/** The choices a template (or a new ticket) may offer, in the config's order. */
export function offeredChoices(config: TicketConfig, projectId: string | undefined) {
  return {
    types: config.types.filter((type) => type.active),
    priorities: config.priorities.filter((priority) => priority.active),
    components: config.components.filter(
      (component) => component.active && component.projectId === projectId,
    ),
    labels: config.labels,
  };
}

export function availableFrom(config: TicketConfig, projectId: string | undefined): Available {
  const offered = offeredChoices(config, projectId);
  const ids = (items: { id: string }[]) => new Set(items.map((item) => item.id));
  return {
    typeIds: ids(offered.types),
    priorityIds: ids(offered.priorities),
    componentIds: ids(offered.components),
    labelIds: ids(offered.labels),
  };
}

/** The title without a prefix an earlier template put in front of it. */
export function withoutPrefix(title: string, prefix: string): string {
  if (!prefix) return title;
  if (title === prefix || title === `${prefix} `) return '';
  return title.startsWith(`${prefix} `) ? title.slice(prefix.length + 1) : title;
}

/** The prefix in front of whatever the person typed, once. */
export function withPrefix(title: string, prefix: string): string {
  if (!prefix || title === prefix || title.startsWith(`${prefix} `)) return title;
  return `${prefix} ${title.trimStart()}`;
}

/**
 * Fills the form from a template. The title keeps what the person typed, with the template's
 * prefix in front (in place of the previous template's). Everything the template leaves empty
 * stays as it is, and so does anything it names that is no longer offered (a type made inactive,
 * a component of another project, a label since deleted): that value is skipped quietly. The
 * person can change all of it afterwards.
 */
export function applyTemplate(
  form: TemplateFill,
  template: TicketTemplate,
  available: Available,
  previous: TicketTemplate | null,
): TemplateFill {
  const title = withPrefix(
    withoutPrefix(form.title, previous?.titlePrefix ?? ''),
    template.titlePrefix,
  );
  const labelIds = template.labelIds.filter((id) => available.labelIds.has(id));
  return {
    title,
    typeId:
      template.typeId && available.typeIds.has(template.typeId) ? template.typeId : form.typeId,
    priorityId:
      template.priorityId && available.priorityIds.has(template.priorityId)
        ? template.priorityId
        : form.priorityId,
    componentId:
      template.componentId && available.componentIds.has(template.componentId)
        ? template.componentId
        : form.componentId,
    labelIds: labelIds.length > 0 ? labelIds : form.labelIds,
    goal: template.goal || form.goal,
    criteria: template.criteria.length > 0 ? template.criteria.join('\n') : form.criteria,
    description: template.description || form.description,
  };
}

// ---------------------------------------------------------------------------
// The settings form
// ---------------------------------------------------------------------------

/** A template as the settings form edits it: every control as a string, criteria one per line. */
export type TemplateDraft = {
  name: string;
  titlePrefix: string;
  typeId: string;
  priorityId: string;
  componentId: string;
  labelIds: string[];
  goal: string;
  criteria: string;
  description: string;
};

export const blankDraft: TemplateDraft = {
  name: '',
  titlePrefix: '',
  typeId: '',
  priorityId: '',
  componentId: '',
  labelIds: [],
  goal: '',
  criteria: '',
  description: '',
};

/**
 * A stored template as a draft. A value no longer offered is shown as "none", so saving the
 * template again does not fail on something that was retired since.
 */
export function draftOf(template: TicketTemplate, available: Available): TemplateDraft {
  const keep = (id: string | null, offered: ReadonlySet<string>) =>
    id && offered.has(id) ? id : '';
  return {
    name: template.name,
    titlePrefix: template.titlePrefix,
    typeId: keep(template.typeId, available.typeIds),
    priorityId: keep(template.priorityId, available.priorityIds),
    componentId: keep(template.componentId, available.componentIds),
    labelIds: template.labelIds.filter((id) => available.labelIds.has(id)),
    goal: template.goal,
    criteria: template.criteria.join('\n'),
    description: template.description,
  };
}

/** The request body for a draft: every field, so an edit replaces the template as shown. */
export function bodyOf(draft: TemplateDraft): Required<CreateTemplateBody> {
  return {
    name: draft.name.trim(),
    titlePrefix: draft.titlePrefix.trim(),
    typeId: draft.typeId || null,
    priorityId: draft.priorityId || null,
    componentId: draft.componentId || null,
    labelIds: draft.labelIds,
    goal: draft.goal,
    criteria: criteriaLines(draft.criteria),
    description: draft.description,
  };
}

export type TemplateDraftErrors = Partial<Record<keyof TemplateDraft, string>>;

/** The server's rules, checked while typing: the same limits a new ticket has. */
export function validateDraft(draft: TemplateDraft): TemplateDraftErrors {
  const errors: TemplateDraftErrors = {};
  const set = (field: keyof TemplateDraft, message: string | undefined) => {
    if (message) errors[field] = message;
  };
  const name = draft.name.trim();
  if (name.length === 0) errors.name = 'Give the template a name.';
  else if (name.length > MAX_TEMPLATE_NAME_LENGTH)
    errors.name = `Use ${MAX_TEMPLATE_NAME_LENGTH} characters or fewer.`;
  else if (hasControlCharacter(name)) errors.name = 'Use plain text on one line.';
  const prefix = draft.titlePrefix.trim();
  if (prefix.length > MAX_TITLE_PREFIX_LENGTH)
    errors.titlePrefix = `Use ${MAX_TITLE_PREFIX_LENGTH} characters or fewer.`;
  else if (hasControlCharacter(prefix)) errors.titlePrefix = 'Use plain text on one line.';
  set('goal', validateGoal(draft.goal));
  set('criteria', validateCriteria(draft.criteria));
  set('description', validateDescription(draft.description));
  return errors;
}

/** Moves one item of a list by `by` places, as the up and down buttons do. */
export function moved<T>(list: readonly T[], index: number, by: number): T[] {
  const target = index + by;
  if (target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}
