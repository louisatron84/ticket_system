'use client';

import { projectComponentSettingsSchema } from '@forge/shared';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { buttonClass, inputClass } from '@/lib/ui';
import { useApiData } from '@/lib/use-api-data';
import { NameField } from './setting-list';

const ticketsWord = (count: number) => (count === 1 ? '1 ticket' : `${count} tickets`);

/**
 * A project's components: rename, a lead, a default assignee (a new ticket with the component and
 * nobody assigned goes to them), deactivate and reactivate, add.
 */
export function ComponentsSettings({
  organisationId,
  projectKey,
}: {
  organisationId: string;
  projectKey: string;
}) {
  const router = useRouter();
  const base = `/api/v1/orgs/${organisationId}/projects/${projectKey}/components`;
  const {
    data: settings,
    error: loadError,
    reload: load,
  } = useApiData(
    base,
    (raw) => projectComponentSettingsSchema.parse(raw),
    'Could not load the components.',
  );
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');

  async function run(
    url: string,
    init: RequestInit & { json?: unknown },
    done: string,
    failure: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      await apiFetch(url, init);
      toast.success(done);
      await load();
      router.refresh();
      return true;
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (
      await run(
        base,
        { method: 'POST', json: { name: trimmed } },
        `Added ${trimmed}.`,
        'Could not add the component.',
      )
    ) {
      setName('');
    }
  }

  const personPicker = (
    label: string,
    value: string | null,
    onChange: (id: string | null) => void,
  ) => (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <select
        value={value ?? ''}
        disabled={busy}
        onChange={(event) => onChange(event.target.value || null)}
        className={`${inputClass()} w-44`}
      >
        <option value="">Nobody</option>
        {settings?.people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.displayName}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section aria-labelledby="components-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="components-heading" className="text-[13px] font-semibold">
          Components
        </h2>
        <p className="max-w-2xl text-xs text-muted">
          Parts of {projectKey}. A new ticket with a component and nobody assigned goes to its
          default assignee.
        </p>
      </div>
      {loadError ? (
        <p role="alert" className="text-[13px] text-fail">
          {loadError}
        </p>
      ) : !settings ? (
        <p className="text-[13px] text-muted">Loading the components…</p>
      ) : settings.components.length === 0 ? (
        <p className="text-[13px] text-muted">No components yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-edge rounded-md border border-edge bg-panel">
          {settings.components.map((component) => {
            const path = `${base}/${component.id}`;
            return (
              <li
                key={component.id}
                data-testid={`component-${component.name}`}
                className={`flex flex-wrap items-end gap-3 px-3 py-2 ${component.active ? '' : 'opacity-60'}`}
              >
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Name
                  <NameField
                    key={`${component.id}:${component.name}`}
                    label={`Name of ${component.name}`}
                    initial={component.name}
                    maxLength={60}
                    busy={busy}
                    onSave={(next) =>
                      run(
                        path,
                        { method: 'PATCH', json: { name: next } },
                        `Renamed to ${next}.`,
                        'Could not rename the component.',
                      )
                    }
                  />
                </label>
                {personPicker(
                  'Lead',
                  component.lead?.id ?? null,
                  (leadId) =>
                    void run(
                      path,
                      { method: 'PATCH', json: { leadId } },
                      'Lead saved.',
                      'Could not change the lead.',
                    ),
                )}
                {personPicker(
                  'Default assignee',
                  component.defaultAssignee?.id ?? null,
                  (defaultAssigneeId) =>
                    void run(
                      path,
                      { method: 'PATCH', json: { defaultAssigneeId } },
                      'Default assignee saved.',
                      'Could not change the default assignee.',
                    ),
                )}
                <span className="pb-1.5 text-xs text-muted">
                  {ticketsWord(component.ticketCount)}
                </span>
                <span className="ml-auto">
                  <button
                    type="button"
                    className={buttonClass('ghost')}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        path,
                        { method: 'PATCH', json: { active: !component.active } },
                        component.active
                          ? `${component.name} is no longer offered. Tickets that have it keep it.`
                          : `${component.name} is offered again.`,
                        'Could not change the component.',
                      )
                    }
                  >
                    {component.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={add} noValidate className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          New component
          <input
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            className={`${inputClass()} w-56`}
          />
        </label>
        <button type="submit" className={buttonClass()} disabled={busy || !name.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}
