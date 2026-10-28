import type { Progress } from '@forge/shared';
import { HEAT_COLOURS } from '@/lib/heat';
import { progressSegments, progressSummary, type ProgressBucket } from '@/lib/structure';

const BUCKET_COLOURS: Record<ProgressBucket, string> = {
  completed: HEAT_COLOURS.quenched,
  inProgress: HEAT_COLOURS.forge,
  jammed: HEAT_COLOURS.blocked,
  notStarted: HEAT_COLOURS.cold,
};

/** A segmented bar: how much of a parent's work is done, moving, stuck or waiting. */
export function ProgressBar({ progress, width = '100%' }: { progress: Progress; width?: string }) {
  return (
    <span
      role="img"
      aria-label={progressSummary(progress)}
      style={{ width }}
      className="flex h-1.5 overflow-hidden rounded-full bg-raised"
    >
      {progressSegments(progress).map((segment) => (
        <span
          key={segment.bucket}
          style={{ width: `${segment.percent}%`, backgroundColor: BUCKET_COLOURS[segment.bucket] }}
        />
      ))}
    </span>
  );
}

/** The right bar's Progress section, for a ticket with parts. */
export function TicketProgress({ progress }: { progress: Progress }) {
  return (
    <section aria-labelledby="progress-heading" className="flex flex-col gap-2">
      <h2 id="progress-heading" className="text-[13px] font-semibold">
        Progress
      </h2>
      <ProgressBar progress={progress} />
      <dl className="flex flex-col gap-1 text-[13px]">
        {progressSegments(progress).map((segment) => (
          <div key={segment.bucket} className="flex items-center justify-between gap-2">
            <dt className="flex items-center gap-2 text-muted">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: BUCKET_COLOURS[segment.bucket] }}
              />
              {segment.label}
            </dt>
            <dd>{segment.count}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
