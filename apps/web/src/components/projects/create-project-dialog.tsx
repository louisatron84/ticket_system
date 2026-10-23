'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { FormField, describedBy } from '@/components/ui/form-field';
import { ApiRequestError, apiFetch } from '@/lib/api-client';
import { cleanKeyInput, validateProjectForm, type ProjectFormErrors } from '@/lib/projects';
import { suggestProjectKey } from '@/lib/tickets';
import { buttonClass, inputClass, textareaClass } from '@/lib/ui';
import { workspaceHref } from '@/lib/nav';

type Field = 'name' | 'key' | 'description';

export function CreateProjectDialog({
  organisationId,
  slug,
  variant = 'primary',
}: {
  organisationId: string;
  slug: string;
  variant?: 'primary' | 'secondary';
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  // Until the person types in the key box themselves, it follows the name.
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<{ field: Field | 'form'; message: string } | null>(
    null,
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function reset() {
    setName('');
    setKey('');
    setKeyEdited(false);
    setDescription('');
    setTouched({});
    setSubmitted(false);
    setServerError(null);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    reset();
  }

  const errors: ProjectFormErrors = validateProjectForm({ name, key, description });
  const shown = (field: Field) =>
    submitted || touched[field]
      ? (errors[field] ?? (serverError?.field === field ? serverError.message : undefined))
      : serverError?.field === field
        ? serverError.message
        : undefined;
  const touch = (field: Field) => setTouched((current) => ({ ...current, [field]: true }));

  function onNameChange(value: string) {
    setName(value);
    if (!keyEdited) setKey(suggestProjectKey(value));
    if (serverError) setServerError(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setServerError(null);
    try {
      await apiFetch(`/api/v1/orgs/${organisationId}/projects`, {
        method: 'POST',
        json: {
          key,
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
        },
      });
      toast.success(`Created ${name.trim()}.`);
      const target = workspaceHref(slug, `/projects/${key}`);
      setBusy(false);
      setOpen(false);
      reset();
      router.push(target);
      router.refresh();
    } catch (error) {
      setBusy(false);
      const message =
        error instanceof ApiRequestError ? error.message : 'Could not create the project.';
      // A taken key is a problem with the key box; anything else belongs to the form.
      setServerError({
        field: error instanceof ApiRequestError && error.status === 409 ? 'key' : 'form',
        message,
      });
    }
  }

  return (
    <>
      <button type="button" className={buttonClass(variant)} onClick={() => setOpen(true)}>
        <Plus size={15} aria-hidden="true" />
        New project
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="create-project-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-md border border-edge-strong bg-panel p-5 text-text backdrop:bg-black/60"
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
          <div>
            <h2 id="create-project-title" className="text-base font-semibold">
              New project
            </h2>
            <p className="mt-1 text-[13px] text-muted">
              A project groups related tickets under one short key.
            </p>
          </div>

          <FormField id="project-name" label="Name" error={shown('name')}>
            <input
              id="project-name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              onBlur={() => touch('name')}
              autoFocus
              autoComplete="off"
              maxLength={200}
              aria-invalid={shown('name') ? true : undefined}
              aria-describedby={describedBy('project-name')}
              className={inputClass(Boolean(shown('name')))}
              placeholder="Web app"
            />
          </FormField>

          <FormField
            id="project-key"
            label="Key"
            error={shown('key')}
            hint={
              key && !errors.key ? (
                <>
                  Tickets will be numbered <span className="font-mono">{key}-1</span>,{' '}
                  <span className="font-mono">{key}-2</span>. It cannot be changed later.
                </>
              ) : (
                'Two to ten capital letters or digits. It cannot be changed later.'
              )
            }
          >
            <input
              id="project-key"
              value={key}
              onChange={(event) => {
                setKeyEdited(true);
                setKey(cleanKeyInput(event.target.value));
                if (serverError) setServerError(null);
              }}
              onBlur={() => touch('key')}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={shown('key') ? true : undefined}
              aria-describedby={describedBy('project-key')}
              className={`${inputClass(Boolean(shown('key')))} max-w-40 font-mono uppercase`}
              placeholder="WEB"
            />
          </FormField>

          <FormField
            id="project-description"
            label="Description"
            optional
            error={shown('description')}
          >
            <textarea
              id="project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => touch('description')}
              rows={3}
              aria-invalid={shown('description') ? true : undefined}
              aria-describedby={describedBy('project-description')}
              className={textareaClass(Boolean(shown('description')))}
            />
          </FormField>

          {serverError?.field === 'form' && (
            <p role="alert" className="text-[13px] text-fail">
              {serverError.message}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              className={buttonClass('secondary')}
              onClick={close}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className={buttonClass('primary')} disabled={busy}>
              {busy ? 'Creating' : 'Create project'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
