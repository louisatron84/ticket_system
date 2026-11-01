'use client';

import type { TicketTemplate } from '@forge/shared';
import { useEffect, useState } from 'react';
import { FormField, describedBy } from '@/components/ui/form-field';
import { apiFetch } from '@/lib/api-client';
import { inputClass } from '@/lib/ui';

/**
 * The "Template" control of the new-ticket form: the chosen project's templates, loaded when the
 * project changes. Shows nothing while a project has none, or if they cannot be loaded (the form
 * works the same without them).
 */
export function TemplatePicker({
  organisationId,
  projectKey,
  value,
  onPick,
}: {
  organisationId: string;
  projectKey: string;
  /** The picked template's id, or '' for none. */
  value: string;
  onPick: (template: TicketTemplate | null) => void;
}) {
  const [loaded, setLoaded] = useState<{ key: string; templates: TicketTemplate[] } | null>(null);

  useEffect(() => {
    if (!projectKey) return;
    let live = true;
    apiFetch<TicketTemplate[]>(`/api/v1/orgs/${organisationId}/projects/${projectKey}/templates`)
      .then((templates) => live && setLoaded({ key: projectKey, templates }))
      .catch(() => live && setLoaded({ key: projectKey, templates: [] }));
    return () => {
      live = false;
    };
  }, [organisationId, projectKey]);

  // Templates of the project picked before stay hidden until this one's arrive.
  const templates = loaded?.key === projectKey ? loaded.templates : [];
  if (templates.length === 0) return null;

  return (
    <FormField
      id="ticket-template"
      label="Template"
      optional
      hint="Fills the form below; you can still change everything."
    >
      <select
        id="ticket-template"
        value={value}
        onChange={(event) =>
          onPick(templates.find((template) => template.id === event.target.value) ?? null)
        }
        aria-describedby={describedBy('ticket-template')}
        className={`${inputClass()} max-w-xs`}
      >
        <option value="">No template</option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </select>
    </FormField>
  );
}
