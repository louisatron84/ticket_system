import { UserRound } from 'lucide-react';
import { initials } from '@/lib/tickets';

type Person = { displayName: string };

/** A person's initials in a small circle. Always paired with their name, in view or for screen readers. */
export function Avatar({ person, size = 20 }: { person: Person; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-edge-strong bg-raised font-semibold text-muted"
    >
      {initials(person.displayName)}
    </span>
  );
}

export function UserChip({
  person,
  compact = false,
}: {
  person: Person | null;
  compact?: boolean;
}) {
  if (!person) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted" title="Unassigned">
        <span
          aria-hidden="true"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-edge-strong"
        >
          <UserRound size={11} />
        </span>
        <span className={compact ? 'sr-only' : ''}>Unassigned</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5 text-[13px]"
      title={compact ? person.displayName : undefined}
    >
      <Avatar person={person} />
      <span className={compact ? 'sr-only' : 'truncate'}>{person.displayName}</span>
    </span>
  );
}
