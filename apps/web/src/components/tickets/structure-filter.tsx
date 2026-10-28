'use client';

import { parseTicketKey, type TicketFilters } from '@forge/shared';
import { useState, type FormEvent } from 'react';
import { structureChips, withFilters } from '@/lib/ticket-query';
import { buttonClass, inputClass } from '@/lib/ui';
import { CheckboxList, FilterPopover, RadioList } from './filter-popover';

const KEY_FIELDS = [
  { field: 'parent', label: 'Parent' },
  { field: 'epic', label: 'Epic' },
  { field: 'linked', label: 'Linked to' },
] as const;

/**
 * Narrow by how tickets fit together: under a parent, anywhere in an epic, linked to a ticket,
 * blocked or not, or only top-level ones.
 */
export function StructureFilter({
  filters,
  go,
}: {
  filters: TicketFilters;
  go: (next: TicketFilters) => void;
}) {
  const [keys, setKeys] = useState({
    parent: filters.parent ?? '',
    epic: filters.epic ?? '',
    linked: filters.linked ?? '',
  });
  const [invalid, setInvalid] = useState<string | null>(null);

  function apply(event: FormEvent) {
    event.preventDefault();
    const patch: Partial<TicketFilters> = {};
    for (const { field, label } of KEY_FIELDS) {
      const text = keys[field].trim();
      if (!text) {
        patch[field] = undefined;
        continue;
      }
      const parsed = parseTicketKey(text);
      if (!parsed) {
        setInvalid(`${label}: “${text}” is not a ticket key, like WEB-5.`);
        return;
      }
      patch[field] = `${parsed.projectKey}-${parsed.number}`;
    }
    setInvalid(null);
    go(withFilters(filters, patch));
  }

  return (
    <FilterPopover label="Structure" count={structureChips(filters).length}>
      <div className="flex w-64 flex-col gap-2 p-1.5">
        <RadioList
          name="Has blocker"
          options={[
            { value: 'yes', label: 'Has an open blocker' },
            { value: 'no', label: 'Has no open blocker' },
          ]}
          selected={filters.blocked}
          onChoose={(value) =>
            go(withFilters(filters, { blocked: value as TicketFilters['blocked'] }))
          }
        />
        <CheckboxList
          name="Level"
          options={[{ value: 'top', label: 'Top level only' }]}
          selected={filters.top ? ['top'] : []}
          onToggle={() => go(withFilters(filters, { top: !filters.top }))}
        />
        <form onSubmit={apply} className="flex flex-col gap-2 px-2 pb-1">
          {KEY_FIELDS.map(({ field, label }) => (
            <label key={field} className="flex flex-col gap-1 text-xs text-muted">
              {label}
              <input
                value={keys[field]}
                placeholder="WEB-5"
                autoComplete="off"
                onChange={(event) => setKeys({ ...keys, [field]: event.target.value })}
                className={inputClass()}
              />
            </label>
          ))}
          <p role={invalid ? 'alert' : undefined} className="text-xs text-fail">
            {invalid}
          </p>
          <button type="submit" className={`${buttonClass()} h-8 text-xs`}>
            Apply
          </button>
        </form>
      </div>
    </FilterPopover>
  );
}
