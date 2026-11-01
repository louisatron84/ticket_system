'use client';

import {
  CUSTOM_FIELD_KINDS,
  CUSTOM_FIELD_KIND_LABELS,
  MAX_CUSTOM_FIELDS,
  customFieldSchema,
  hasOptions,
  type CustomField,
  type CustomFieldKind,
} from '@forge/shared';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { buttonClass, inputClass } from '@/lib/ui';
import { useApiData } from '@/lib/use-api-data';
import { NameField, moveId } from './setting-list';

type Run = (
  path: string,
  init: RequestInit & { json?: unknown },
  done: string,
  failure: string,
) => Promise<boolean>;

const valuesWord = (count: number) =>
  count === 1 ? '1 ticket has a value' : `${count} tickets have a value`;

/**
 * The workspace's custom fields. The kind is chosen once; a field with values can be turned off
 * (hidden, values kept) but not deleted, and an option some ticket has chosen likewise.
 */
export function CustomFieldsSettings({
  organisationId,
  types,
}: {
  organisationId: string;
  types: { id: string; name: string; active: boolean }[];
}) {
  const router = useRouter();
  const base = `/api/v1/orgs/${organisationId}/custom-fields`;
  const {
    data: fields,
    error: loadError,
    reload: load,
  } = useApiData(base, (raw) => customFieldSchema.array().parse(raw), 'Could not load the fields.');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<CustomField | null>(null);

  const run: Run = async (path, init, done, failure) => {
    setBusy(true);
    try {
      await apiFetch(`${base}${path}`, init);
      toast.success(done);
      await load();
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : failure);
      if (error instanceof ApiRequestError && error.status === 409) void load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const ids = fields?.map((field) => field.id) ?? [];

  return (
    <section aria-labelledby="fields-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="fields-heading" className="text-[13px] font-semibold">
          Custom fields
        </h2>
        <p className="max-w-2xl text-xs text-muted">
          Extra information on tickets, for every project. A field&apos;s kind never changes; a
          field tickets have values for can be turned off but not deleted.
        </p>
      </div>
      {loadError ? (
        <p role="alert" className="text-[13px] text-fail">
          {loadError}
        </p>
      ) : !fields ? (
        <p className="text-[13px] text-muted">Loading the fields…</p>
      ) : (
        <>
          {fields.length === 0 ? (
            <p className="text-[13px] text-muted">No custom fields yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-edge rounded-md border border-edge bg-panel">
              {fields.map((field, index) => (
                <li
                  key={field.id}
                  data-testid={`field-${field.name}`}
                  className={`flex flex-col gap-2 px-3 py-2 ${field.active ? '' : 'opacity-60'}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex flex-col">
                      <button
                        type="button"
                        className="text-muted hover:text-text disabled:opacity-30"
                        aria-label={`Move ${field.name} up`}
                        disabled={busy || index === 0}
                        onClick={() =>
                          void run(
                            '/order',
                            { method: 'PUT', json: { ids: moveId(ids, field.id, -1) } },
                            'Order saved.',
                            'Could not reorder the fields.',
                          )
                        }
                      >
                        <ArrowUp size={12} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="text-muted hover:text-text disabled:opacity-30"
                        aria-label={`Move ${field.name} down`}
                        disabled={busy || index === ids.length - 1}
                        onClick={() =>
                          void run(
                            '/order',
                            { method: 'PUT', json: { ids: moveId(ids, field.id, 1) } },
                            'Order saved.',
                            'Could not reorder the fields.',
                          )
                        }
                      >
                        <ArrowDown size={12} aria-hidden="true" />
                      </button>
                    </span>
                    <NameField
                      key={`${field.id}:${field.name}`}
                      label={`Name of ${field.name}`}
                      initial={field.name}
                      maxLength={60}
                      busy={busy}
                      onSave={(next) =>
                        run(
                          `/${field.id}`,
                          { method: 'PATCH', json: { name: next } },
                          `Renamed to ${next}.`,
                          'Could not rename the field.',
                        )
                      }
                    />
                    <span className="text-xs text-muted">
                      {CUSTOM_FIELD_KIND_LABELS[field.kind]}
                    </span>
                    <span className="text-xs text-muted">{valuesWord(field.valueCount)}</span>
                    <span className="ml-auto flex gap-2">
                      <button
                        type="button"
                        className={buttonClass('ghost')}
                        disabled={busy}
                        onClick={() =>
                          void run(
                            `/${field.id}`,
                            { method: 'PATCH', json: { active: !field.active } },
                            field.active
                              ? `${field.name} is hidden. Its values are kept.`
                              : `${field.name} is shown again.`,
                            'Could not change the field.',
                          )
                        }
                      >
                        {field.active ? 'Turn off' : 'Turn on'}
                      </button>
                      {field.valueCount === 0 && (
                        <button
                          type="button"
                          className={buttonClass('ghost')}
                          disabled={busy}
                          onClick={() => setDeleting(field)}
                        >
                          Delete…
                        </button>
                      )}
                    </span>
                  </div>
                  <TypeChoice
                    label={`Ticket types for ${field.name}`}
                    types={types}
                    value={field.typeIds}
                    busy={busy}
                    onChange={(typeIds) =>
                      void run(
                        `/${field.id}`,
                        { method: 'PATCH', json: { typeIds } },
                        typeIds.length === 0
                          ? `${field.name} is now on every type.`
                          : `${field.name} is now on ${typeIds.length === 1 ? 'one type' : `${typeIds.length} types`}.`,
                        'Could not change the ticket types.',
                      )
                    }
                  />
                  {hasOptions(field.kind) && <OptionsEditor field={field} busy={busy} run={run} />}
                </li>
              ))}
            </ul>
          )}
          <NewField types={types} busy={busy || fields.length >= MAX_CUSTOM_FIELDS} run={run} />
          {fields.length >= MAX_CUSTOM_FIELDS && (
            <p className="text-xs text-muted">
              A workspace can have at most {MAX_CUSTOM_FIELDS} fields.
            </p>
          )}
        </>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `Delete ${deleting.name}` : 'Delete'}
        confirmLabel="Delete field"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          void run(
            `/${deleting.id}`,
            { method: 'DELETE' },
            `Deleted ${deleting.name}.`,
            'Could not delete the field.',
          ).then((ok) => ok && setDeleting(null));
        }}
      >
        <p className="text-[13px]">No ticket has a value for it, so nothing else is lost.</p>
      </ConfirmDialog>
    </section>
  );
}

/** Which ticket types a field is for; none ticked means every type. */
function TypeChoice({
  label,
  types,
  value,
  busy,
  onChange,
}: {
  label: string;
  types: { id: string; name: string; active: boolean }[];
  value: string[];
  busy: boolean;
  onChange: (typeIds: string[]) => void;
}) {
  const shown = types.filter((type) => type.active || value.includes(type.id));
  return (
    <fieldset className="flex flex-wrap items-center gap-3 text-xs">
      <legend className="sr-only">{label}</legend>
      <span className="text-muted">{value.length === 0 ? 'On every type' : 'Only on'}</span>
      {shown.map((type) => (
        <label key={type.id} className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={value.includes(type.id)}
            disabled={busy}
            onChange={(event) =>
              onChange(
                event.target.checked ? [...value, type.id] : value.filter((id) => id !== type.id),
              )
            }
          />
          {type.name}
        </label>
      ))}
    </fieldset>
  );
}

function OptionsEditor({ field, busy, run }: { field: CustomField; busy: boolean; run: Run }) {
  const [name, setName] = useState('');
  const ids = field.options.map((option) => option.id);
  const path = `/${field.id}/options`;

  async function add(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (
      await run(
        path,
        { method: 'POST', json: { name: trimmed } },
        `Added ${trimmed}.`,
        'Could not add the option.',
      )
    ) {
      setName('');
    }
  }

  return (
    <div className="flex flex-col gap-2 pl-6">
      <ul className="flex flex-col gap-1">
        {field.options.map((option, index) => (
          <li
            key={option.id}
            className={`flex flex-wrap items-center gap-2 ${option.active ? '' : 'opacity-60'}`}
          >
            <span className="flex">
              <button
                type="button"
                className="text-muted hover:text-text disabled:opacity-30"
                aria-label={`Move ${option.name} up`}
                disabled={busy || index === 0}
                onClick={() =>
                  void run(
                    `${path}/order`,
                    { method: 'PUT', json: { ids: moveId(ids, option.id, -1) } },
                    'Order saved.',
                    'Could not reorder the options.',
                  )
                }
              >
                <ArrowUp size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="text-muted hover:text-text disabled:opacity-30"
                aria-label={`Move ${option.name} down`}
                disabled={busy || index === ids.length - 1}
                onClick={() =>
                  void run(
                    `${path}/order`,
                    { method: 'PUT', json: { ids: moveId(ids, option.id, 1) } },
                    'Order saved.',
                    'Could not reorder the options.',
                  )
                }
              >
                <ArrowDown size={12} aria-hidden="true" />
              </button>
            </span>
            <NameField
              key={`${option.id}:${option.name}`}
              label={`Option ${option.name} of ${field.name}`}
              initial={option.name}
              maxLength={60}
              busy={busy}
              onSave={(next) =>
                run(
                  `${path}/${option.id}`,
                  { method: 'PATCH', json: { name: next } },
                  `Renamed to ${next}.`,
                  'Could not rename the option.',
                )
              }
            />
            <button
              type="button"
              className={buttonClass('ghost')}
              disabled={busy}
              onClick={() =>
                void run(
                  `${path}/${option.id}`,
                  { method: 'PATCH', json: { active: !option.active } },
                  option.active
                    ? `${option.name} is no longer offered.`
                    : `${option.name} is offered again.`,
                  'Could not change the option.',
                )
              }
            >
              {option.active ? 'Turn off' : 'Turn on'}
            </button>
            {!option.used && (
              <button
                type="button"
                className={buttonClass('ghost')}
                disabled={busy}
                onClick={() =>
                  void run(
                    `${path}/${option.id}`,
                    { method: 'DELETE' },
                    `Removed ${option.name}.`,
                    'Could not remove the option.',
                  )
                }
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} noValidate className="flex items-end gap-2">
        <input
          aria-label={`New option for ${field.name}`}
          placeholder="New option"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          className={`${inputClass()} w-48`}
        />
        <button type="submit" className={buttonClass('secondary')} disabled={busy || !name.trim()}>
          Add option
        </button>
      </form>
    </div>
  );
}

function NewField({
  types,
  busy,
  run,
}: {
  types: { id: string; name: string; active: boolean }[];
  busy: boolean;
  run: Run;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CustomFieldKind>('text');
  const [typeIds, setTypeIds] = useState<string[]>([]);

  async function add(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (
      await run(
        '',
        { method: 'POST', json: { name: trimmed, kind, typeIds } },
        `Added ${trimmed}.${hasOptions(kind) ? ' Add its options below it.' : ''}`,
        'Could not add the field.',
      )
    ) {
      setName('');
      setTypeIds([]);
    }
  }

  return (
    <form onSubmit={add} noValidate className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          New field
          <input
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            className={`${inputClass()} w-56`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Kind
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as CustomFieldKind)}
            className={`${inputClass()} w-40`}
          >
            {CUSTOM_FIELD_KINDS.map((value) => (
              <option key={value} value={value}>
                {CUSTOM_FIELD_KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClass()} disabled={busy || !name.trim()}>
          Add field
        </button>
      </div>
      <TypeChoice
        label="Ticket types for the new field"
        types={types}
        value={typeIds}
        busy={busy}
        onChange={setTypeIds}
      />
    </form>
  );
}
