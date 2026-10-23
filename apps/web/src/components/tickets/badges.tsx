import type { Priority, StatusCategory, TicketType } from '@forge/shared';
import {
  Bug,
  CalendarClock,
  LifeBuoy,
  Layers,
  BookOpen,
  Sparkles,
  SquareCheckBig,
  Tag,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { formatDueDate, priorityIntensity, statusTone, type StatusTone } from '@/lib/tickets';

// One vocabulary for the three things every ticket row shows. Each carries a shape and a word, so
// none of them depends on colour alone.

const TONE_CLASS: Record<StatusTone, string> = {
  idle: 'text-muted',
  active: 'text-active',
  done: 'text-ok',
};

/**
 * Empty ring, half-filled ring, or filled disc with a tick: not started, under way, finished.
 * A cancelled status is finished too, but it is not a success, so it gets a struck-through ring
 * in the quiet colour instead of the green tick.
 */
export function StatusGlyph({
  category,
  statusKey,
  size = 14,
}: {
  category: StatusCategory;
  statusKey?: string;
  size?: number;
}) {
  const tone = statusTone(category);
  if (statusKey === 'cancelled') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 14 14"
        aria-hidden="true"
        className="shrink-0 text-muted"
      >
        <circle cx="7" cy="7" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4.6 9.4 9.4 4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      aria-hidden="true"
      className={`shrink-0 ${TONE_CLASS[tone]}`}
    >
      {tone === 'done' ? (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path
            d="M4.3 7.2 6.1 9l3.6-3.9"
            fill="none"
            stroke="var(--bg)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <circle cx="7" cy="7" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          {tone === 'active' && <path d="M7 1.75a5.25 5.25 0 0 1 0 10.5Z" fill="currentColor" />}
        </>
      )}
    </svg>
  );
}

export function StatusBadge({
  status,
}: {
  status: { name: string; category: StatusCategory; key?: string };
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[13px]">
      <StatusGlyph category={status.category} {...(status.key ? { statusKey: status.key } : {})} />
      <span className="truncate">{status.name}</span>
    </span>
  );
}

const BAR_HEIGHTS = [5, 7, 9, 11, 13];

/** Just the bars, hidden from screen readers. Put the priority's name next to it. */
export function PriorityBars({ rank, maxRank }: { rank: number; maxRank: number }) {
  const { filled, total } = priorityIntensity(rank, maxRank);
  const top = filled === total;
  return (
    <span aria-hidden="true" className="flex h-3.5 items-end gap-[2px]">
      {BAR_HEIGHTS.map((height, index) => (
        <span
          key={height}
          style={{ height }}
          className={`w-[3px] rounded-[1px] ${
            index < filled ? (top ? 'bg-fail' : 'bg-text') : 'bg-edge-strong'
          }`}
        />
      ))}
    </span>
  );
}

/** Five rising bars, filled up to the priority's rank. The top rank turns red. */
export function PriorityMark({
  priority,
  maxRank,
  compact = false,
}: {
  priority: Pick<Priority, 'name' | 'rank'>;
  maxRank: number;
  /** Bars only, for tight spaces such as board cards. The name stays available to screen readers. */
  compact?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[13px]"
      title={compact ? `Priority: ${priority.name}` : undefined}
    >
      <PriorityBars rank={priority.rank} maxRank={maxRank} />
      {compact ? (
        <span className="sr-only">Priority: {priority.name}</span>
      ) : (
        <span className="truncate">{priority.name}</span>
      )}
    </span>
  );
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  task: SquareCheckBig,
  bug: Bug,
  feature: Sparkles,
  improvement: TrendingUp,
  epic: Layers,
  documentation: BookOpen,
  support: LifeBuoy,
};

/** Just a type's icon, hidden from screen readers. Put the type's name next to it. */
export function TypeIcon({ typeKey, size = 14 }: { typeKey: string; size?: number }) {
  const Icon = TYPE_ICONS[typeKey] ?? Tag;
  return <Icon size={size} aria-hidden="true" className="shrink-0 text-muted" />;
}

export function TypeBadge({
  type,
  iconOnly = false,
}: {
  type: Pick<TicketType, 'key' | 'name'>;
  /** Just the icon, for a dense row. The name stays available to screen readers. */
  iconOnly?: boolean;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px]">
      <TypeIcon typeKey={type.key} />
      <span className={iconOnly ? 'sr-only' : 'truncate'}>{type.name}</span>
    </span>
  );
}

/**
 * A due date in words ("Tomorrow", "2 days overdue"). `today` comes from the server so the page
 * reads the same when it is hydrated. A finished ticket is never shown as overdue.
 */
export function DueDate({
  date,
  today,
  done = false,
}: {
  date: string | null;
  today: string;
  done?: boolean;
}) {
  if (!date) return <span className="text-[13px] text-muted">No date</span>;
  const { text, overdue } = formatDueDate(date, today, { done });
  const Icon = overdue ? TriangleAlert : CalendarClock;
  return (
    <time
      dateTime={date}
      title={date}
      className={`inline-flex items-center gap-1.5 text-[13px] ${overdue ? 'text-fail' : 'text-muted'}`}
    >
      <Icon size={14} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{text}</span>
    </time>
  );
}
