import type { ReactNode } from 'react';

/**
 * A label above a control, with room for a hint and an error under it. The control must carry
 * `id={id}` and `aria-describedby={describedBy(id)}` so the message is read with it.
 */
export const describedBy = (id: string) => `${id}-message`;

export function FormField({
  id,
  label,
  hint,
  error,
  optional = false,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
        {optional && <span className="ml-1.5 font-normal text-muted">optional</span>}
      </label>
      {children}
      <p
        id={describedBy(id)}
        role={error ? 'alert' : undefined}
        className={`min-h-4 text-xs ${error ? 'text-fail' : 'text-muted'}`}
      >
        {error ?? hint}
      </p>
    </div>
  );
}
