import {
  SORTABLE_FIELD_KINDS,
  STATUS_CATEGORIES,
  fieldFilterValue,
  hasOptions,
  type CustomField,
  type Member,
  type Project,
  type TicketConfig,
} from '@forge/shared';
import { PriorityBars, StatusGlyph, TypeIcon } from './badges';
import type { FilterOptions } from './filter-bar';
import { Avatar } from './user-chip';

const CATEGORY_LABEL = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Finished',
} as const;

/** The choices a filter bar offers, with names and the same small icons the rows use. */
export function buildFilterOptions(input: {
  config: TicketConfig;
  /** Left out for a page that belongs to one project. */
  projects?: Project[];
  /** Only people the viewer is allowed to see in the member list. */
  members?: Member[];
}): FilterOptions {
  const maxRank = Math.max(1, ...input.config.priorities.map((priority) => priority.rank));
  return {
    statusCategories: STATUS_CATEGORIES.map((category) => ({
      value: category,
      label: CATEGORY_LABEL[category],
      icon: <StatusGlyph category={category} />,
    })),
    priorities: [...input.config.priorities]
      .sort((a, b) => b.rank - a.rank)
      .map((priority) => ({
        value: priority.key,
        label: priority.name,
        icon: <PriorityBars rank={priority.rank} maxRank={maxRank} />,
      })),
    types: input.config.types.map((type) => ({
      value: type.key,
      label: type.name,
      icon: <TypeIcon typeKey={type.key} />,
    })),
    labels: input.config.labels.map((label) => ({
      value: label.name,
      label: label.name,
      icon: (
        <span
          aria-hidden="true"
          data-color={label.color}
          className="label-chip inline-block size-2.5 shrink-0 rounded-full"
        />
      ),
    })),
    people: (input.members ?? []).map((member) => ({
      value: member.user.id,
      label: member.user.displayName,
      icon: <Avatar person={member.user} size={16} />,
    })),
    projects: (input.projects ?? []).map((project) => ({
      value: project.key,
      label: project.name,
      icon: <span className="font-mono text-[11px] text-muted">{project.key}</span>,
    })),
    fields: (input.config.fields ?? []).map((field) => ({
      id: field.id,
      name: field.name,
      tests: fieldTests(field),
      sortable: SORTABLE_FIELD_KINDS.includes(field.kind),
    })),
  };
}

/** What a field can be filtered by: its options, yes/no, "me", and for every kind set or empty. */
export function fieldTests(field: CustomField): { value: string; label: string }[] {
  const test = (value: string, label: string) => ({
    value: fieldFilterValue(field.id, value),
    label,
  });
  const specific = hasOptions(field.kind)
    ? field.options.filter((option) => option.active).map((option) => test(option.id, option.name))
    : field.kind === 'boolean'
      ? [test('yes', 'Yes'), test('no', 'No')]
      : field.kind === 'person'
        ? [test('me', 'Me')]
        : [];
  return [...specific, test('set', 'Has a value'), test('empty', 'Empty')];
}

export { CATEGORY_LABEL };
