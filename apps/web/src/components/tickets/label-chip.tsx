import type { Label } from '@forge/shared';

/** A small tinted tag. The colour is one of the eight names the API allows; the name is escaped text. */
export function LabelChip({ label }: { label: Pick<Label, 'name' | 'color'> }) {
  return (
    <span
      data-color={label.color}
      title={label.name}
      className="label-chip inline-flex h-5 max-w-[10rem] items-center rounded px-1.5 text-[11px] font-medium"
    >
      <span className="truncate">{label.name}</span>
    </span>
  );
}

/** The first few labels, then "+n" for the rest, with the full list on hover. */
export function LabelChips({
  labels,
  max = 3,
}: {
  labels: Pick<Label, 'name' | 'color'>[];
  max?: number;
}) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, max);
  const hidden = labels.slice(max);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((label) => (
        <LabelChip key={label.name} label={label} />
      ))}
      {hidden.length > 0 && (
        <span
          title={hidden.map((label) => label.name).join(', ')}
          className="text-[11px] text-muted"
        >
          +{hidden.length}
        </span>
      )}
    </span>
  );
}
