'use client';

import type {
  Member,
  TicketConfig,
  TriageRuleBody,
  TriageSettings,
  TriageSettingsBody,
} from '@forge/shared';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { buttonClass, inputClass } from '@/lib/ui';

type RuleDraft = {
  name: string;
  titleWords: string;
  typeKey: string;
  labelId: string;
  reporterId: string;
  assigneeId: string;
  priorityId: string;
  addLabelId: string;
  triagerId: string;
};

const blank: RuleDraft = {
  name: '',
  titleWords: '',
  typeKey: '',
  labelId: '',
  reporterId: '',
  assigneeId: '',
  priorityId: '',
  addLabelId: '',
  triagerId: '',
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');

function draftOf(rule: TriageSettings['rules'][number]): RuleDraft {
  const c = rule.conditions as Record<string, unknown>;
  const a = rule.actions as Record<string, unknown>;
  return {
    name: rule.name,
    titleWords: Array.isArray(c.titleWords) ? (c.titleWords as string[]).join(' ') : '',
    typeKey: text(c.typeKey),
    labelId: text(c.labelId),
    reporterId: text(c.reporterId),
    assigneeId: text(a.assigneeId),
    priorityId: text(a.priorityId),
    addLabelId: Array.isArray(a.addLabelIds) ? text((a.addLabelIds as string[])[0]) : '',
    triagerId: text(a.triagerId),
  };
}

function bodyOf(rule: RuleDraft): TriageRuleBody {
  const words = rule.titleWords.split(/\s+/).filter(Boolean);
  return {
    name: rule.name.trim(),
    conditions: {
      ...(words.length > 0 ? { titleWords: words } : {}),
      ...(rule.typeKey ? { typeKey: rule.typeKey } : {}),
      ...(rule.labelId ? { labelId: rule.labelId } : {}),
      ...(rule.reporterId ? { reporterId: rule.reporterId } : {}),
    },
    actions: {
      ...(rule.assigneeId ? { assigneeId: rule.assigneeId } : {}),
      ...(rule.priorityId ? { priorityId: rule.priorityId } : {}),
      ...(rule.addLabelId ? { addLabelIds: [rule.addLabelId] } : {}),
      ...(rule.triagerId ? { triagerId: rule.triagerId } : {}),
    },
  };
}

/** The project's triage: the switch, who is on the weekly rota, and the arrival rules. */
export function TriageSettingsForm({
  organisationId,
  projectKey,
  initial,
  members,
  config,
}: {
  organisationId: string;
  projectKey: string;
  initial: TriageSettings;
  members: Member[];
  config: TicketConfig;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [rota, setRota] = useState(initial.rota.map((person) => person.id));
  const [rules, setRules] = useState<RuleDraft[]>(initial.rules.map(draftOf));
  const [busy, setBusy] = useState(false);
  const [onDuty, setOnDuty] = useState(initial.onDuty);

  const people = members.map((m) => ({ id: m.user.id, name: m.user.displayName }));
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'someone';
  const setRule = (index: number, patch: Partial<RuleDraft>) =>
    setRules((list) => list.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  const moveRule = (index: number, by: number) =>
    setRules((list) => {
      const next = [...list];
      const [rule] = next.splice(index, 1);
      next.splice(index + by, 0, rule!);
      return next;
    });

  async function save() {
    setBusy(true);
    const body: TriageSettingsBody = { enabled, rota, rules: rules.map(bodyOf) };
    try {
      const saved = await apiFetch<TriageSettings>(
        `/api/v1/orgs/${organisationId}/projects/${projectKey}/triage-settings`,
        { method: 'PUT', json: body },
      );
      setOnDuty(saved.onDuty);
      toast.success('Triage settings saved.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const select = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: { value: string; label: string }[],
  ) => (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass()}
      >
        <option value="">Any / leave</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
  const peopleOptions = people.map((p) => ({ value: p.id, label: p.name }));
  const labelOptions = config.labels.map((l) => ({ value: l.id, label: l.name }));

  return (
    <section aria-labelledby="triage-settings-heading" className="flex flex-col gap-4">
      <h2 id="triage-settings-heading" className="text-[13px] font-semibold">
        Triage
      </h2>
      <label className="flex cursor-pointer items-start gap-3 text-[13px]">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="mt-0.5 size-4 accent-[var(--active)]"
        />
        <span>
          <span className="block font-medium">New tickets go to triage</span>
          <span className="block text-muted">
            Tickets from people who can create but not edit tickets wait in triage until two people
            agree what to do with them. Your team&apos;s own tickets go straight onto the board.
          </span>
        </span>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-medium">Weekly rota</legend>
        <p className="text-xs text-muted">
          One person a week is told about each arrival, turning every Monday. Leave it empty to tell
          everyone who can triage.
          {onDuty ? ` On duty this week: ${onDuty.displayName}.` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          {people.map((person) => {
            const position = rota.indexOf(person.id);
            return (
              <label
                key={person.id}
                className="flex items-center gap-1.5 rounded border border-edge px-2 py-1 text-xs"
              >
                <input
                  type="checkbox"
                  checked={position !== -1}
                  onChange={(event) =>
                    setRota((list) =>
                      event.target.checked
                        ? [...list, person.id]
                        : list.filter((id) => id !== person.id),
                    )
                  }
                />
                {person.name}
                {position !== -1 && <span className="text-muted">#{position + 1}</span>}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-[13px] font-medium">Arrival rules</legend>
        <p className="text-xs text-muted">
          The first rule whose conditions all match fills in a new arrival. Rules never accept or
          decline a ticket.
        </p>
        {rules.map((rule, index) => (
          <div
            key={index}
            role="group"
            aria-label={`Rule ${index + 1}${rule.name ? `: ${rule.name}` : ''}`}
            className="flex flex-col gap-2 rounded-md border border-edge p-3"
          >
            <div className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
                Rule name
                <input
                  value={rule.name}
                  maxLength={80}
                  onChange={(event) => setRule(index, { name: event.target.value })}
                  className={inputClass()}
                />
              </label>
              <button
                type="button"
                aria-label={`Move rule ${index + 1} up`}
                disabled={index === 0}
                onClick={() => moveRule(index, -1)}
                className={`${buttonClass('ghost')} size-8 px-0`}
              >
                <ArrowUp size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Move rule ${index + 1} down`}
                disabled={index === rules.length - 1}
                onClick={() => moveRule(index, 1)}
                className={`${buttonClass('ghost')} size-8 px-0`}
              >
                <ArrowDown size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Remove rule ${index + 1}`}
                onClick={() => setRules((list) => list.filter((_, i) => i !== index))}
                className={`${buttonClass('ghost')} size-8 px-0`}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
            <p className="text-xs font-medium">When a new arrival matches</p>
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Title contains (all words)
                <input
                  value={rule.titleWords}
                  onChange={(event) => setRule(index, { titleWords: event.target.value })}
                  className={inputClass()}
                />
              </label>
              {select(
                'Type',
                rule.typeKey,
                (v) => setRule(index, { typeKey: v }),
                config.types.map((t) => ({ value: t.key, label: t.name })),
              )}
              {select('Label', rule.labelId, (v) => setRule(index, { labelId: v }), labelOptions)}
              {select(
                'Filed by',
                rule.reporterId,
                (v) => setRule(index, { reporterId: v }),
                peopleOptions,
              )}
            </div>
            <p className="text-xs font-medium">Then set</p>
            <div className="grid gap-2 sm:grid-cols-4">
              {select(
                'Assignee',
                rule.assigneeId,
                (v) => setRule(index, { assigneeId: v }),
                peopleOptions,
              )}
              {select(
                'Priority',
                rule.priorityId,
                (v) => setRule(index, { priorityId: v }),
                [...config.priorities]
                  .sort((a, b) => b.rank - a.rank)
                  .map((p) => ({ value: p.id, label: p.name })),
              )}
              {select(
                'Add label',
                rule.addLabelId,
                (v) => setRule(index, { addLabelId: v }),
                labelOptions,
              )}
              {select(
                'Who triages it',
                rule.triagerId,
                (v) => setRule(index, { triagerId: v }),
                peopleOptions,
              )}
            </div>
            {rule.triagerId && (
              <p className="text-xs text-muted">
                {nameOf(rule.triagerId)} is told about matching arrivals instead of the rota.
              </p>
            )}
          </div>
        ))}
        <button
          type="button"
          className={`${buttonClass('secondary')} self-start`}
          onClick={() => setRules((list) => [...list, { ...blank }])}
          disabled={rules.length >= 20}
        >
          <Plus size={13} aria-hidden="true" />
          Add a rule
        </button>
      </fieldset>

      <button
        type="button"
        className={`${buttonClass('primary')} self-start`}
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? 'Saving' : 'Save triage settings'}
      </button>
    </section>
  );
}
