'use client';

import { MILESTONE_HEALTH_LABELS, type Timeline } from '@forge/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { daysBetween } from '@/lib/burndown';
import { workspaceHref } from '@/lib/nav';
import { DAY_WIDTH, barOf, ticksOf, timelineRange, type Zoom } from '@/lib/timeline-layout';

const ROW = 36;
const LABEL_WIDTH = 240;

type Epic = Timeline['epics'][number];

function barColour(epic: Epic) {
  if (epic.status.key === 'blocked') return 'bg-fail/80';
  if (epic.status.category === 'completed') return 'bg-ok/70';
  if (epic.status.category === 'in_progress') return 'bg-active/80';
  return 'bg-edge-strong';
}

function percentDone(epic: Epic): number | null {
  const progress = epic.progress;
  if (!progress) return null;
  const total = progress.completed + progress.inProgress + progress.jammed + progress.notStarted;
  return total === 0 ? null : Math.round((progress.completed / total) * 100);
}

/**
 * A project's epics as bars from start to due date and its milestones as diamonds, with arrows
 * from each blocking epic to the one it blocks. Read-only: dates are changed on the ticket and the
 * milestone.
 */
export function TimelineView({
  slug,
  projectKey,
  timeline,
  today,
}: {
  slug: string;
  projectKey: string;
  timeline: Timeline;
  today: string;
}) {
  const [zoom, setZoom] = useState<Zoom>('weeks');
  const scroller = useRef<HTMLDivElement>(null);
  const range = timelineRange(timeline, today, zoom);
  const dayWidth = DAY_WIDTH[zoom];
  const width = (daysBetween(range.from, range.to) + 1) * dayWidth;
  const ticks = ticksOf(range, zoom);
  const todayX = daysBetween(range.from, today) * dayWidth;

  const placed = timeline.epics.flatMap((epic) => {
    const bar = barOf(epic, range.from);
    return bar ? [{ epic, bar }] : [];
  });
  const unscheduled = timeline.epics.filter((epic) => !barOf(epic, range.from));
  const rowOf = new Map(placed.map((item, index) => [item.epic.key, index] as const));
  const dated = timeline.milestones.filter((milestone) => milestone.targetDate !== null);

  // Open on today, a little in from the left edge.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 120);
  }, [todayX]);

  const ticketHref = (key: string) => workspaceHref(slug, `/tickets/${key}`);
  const arrows = timeline.dependencies.flatMap((link) => {
    const from = rowOf.get(link.blocker);
    const to = rowOf.get(link.blocked);
    if (from === undefined || to === undefined) return [];
    const a = placed[from]!.bar;
    const b = placed[to]!.bar;
    const x1 = (a.left + a.days) * dayWidth;
    const y1 = from * ROW + ROW / 2;
    const x2 = b.left * dayWidth;
    const y2 = to * ROW + ROW / 2;
    const bend = Math.max(x1 + 8, Math.min(x2 - 8, (x1 + x2) / 2));
    return [{ key: `${link.blocker}-${link.blocked}`, d: `M${x1},${y1} H${bend} V${y2} H${x2}` }];
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Zoom" className="inline-flex rounded-md border border-edge">
          {(['weeks', 'months'] as const).map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={zoom === choice}
              onClick={() => setZoom(choice)}
              className={`px-3 py-1 text-[13px] first:rounded-l-md last:rounded-r-md ${
                zoom === choice ? 'bg-raised font-medium text-text' : 'text-muted hover:text-text'
              }`}
            >
              {choice === 'weeks' ? 'Weeks' : 'Months'}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          Epics run from their start date to their due date. Set both on an epic to place it.
        </p>
      </div>

      {placed.length === 0 && dated.length === 0 ? (
        <p className="rounded-md border border-dashed border-edge p-6 text-center text-[13px] text-muted">
          Nothing on the timeline yet. Give an epic in {projectKey} a start and due date, or a
          milestone a target date.
        </p>
      ) : (
        <div className="flex overflow-hidden rounded-md border border-edge bg-panel">
          <div style={{ width: LABEL_WIDTH }} className="shrink-0 border-r border-edge">
            <div className="h-8 border-b border-edge px-3 pt-1.5 text-xs font-medium text-muted">
              Epic
            </div>
            <div
              style={{ height: ROW }}
              className="flex items-center border-b border-edge px-3 text-xs text-muted"
            >
              Milestones
            </div>
            <ul aria-label="Epics on the timeline">
              {placed.map(({ epic }) => (
                <li
                  key={epic.key}
                  style={{ height: ROW }}
                  className="flex items-center gap-2 border-b border-edge px-3 last:border-b-0"
                >
                  <Link
                    href={ticketHref(epic.key)}
                    className="font-mono text-xs text-muted hover:text-text"
                  >
                    {epic.key}
                  </Link>
                  <span className="truncate text-[13px]" title={epic.title}>
                    {epic.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto">
            <div style={{ width }} className="relative">
              <div className="relative h-8 border-b border-edge">
                {ticks.map((tick) => (
                  <span
                    key={tick.offset}
                    style={{ left: tick.offset * dayWidth }}
                    className="absolute top-0 h-full border-l border-edge pl-1 pt-1.5 text-[11px] whitespace-nowrap text-muted"
                  >
                    {tick.label}
                  </span>
                ))}
              </div>

              <div style={{ height: ROW }} className="relative border-b border-edge">
                {dated.map((milestone) => (
                  <Link
                    key={milestone.id}
                    href={workspaceHref(slug, `/projects/${projectKey}/milestones`)}
                    aria-label={`Milestone ${milestone.name}, target ${milestone.targetDate}, ${MILESTONE_HEALTH_LABELS[milestone.health].toLowerCase()}${milestone.closed ? ', closed' : ''}`}
                    title={`${milestone.name} · ${milestone.targetDate}`}
                    style={{
                      left:
                        daysBetween(range.from, milestone.targetDate!) * dayWidth + dayWidth / 2,
                    }}
                    className="absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5"
                  >
                    <span
                      aria-hidden="true"
                      className={`size-3 rotate-45 border ${
                        milestone.closed
                          ? 'border-muted bg-raised'
                          : milestone.health === 'off_track'
                            ? 'border-fail bg-fail'
                            : milestone.health === 'at_risk'
                              ? 'border-ember bg-ember'
                              : 'border-ok bg-ok'
                      }`}
                    />
                    <span className="text-[11px] whitespace-nowrap">{milestone.name}</span>
                  </Link>
                ))}
              </div>

              <div className="relative" style={{ height: placed.length * ROW }}>
                {placed.map(({ epic }, index) => (
                  <div
                    key={epic.key}
                    style={{ top: index * ROW, height: ROW }}
                    className="absolute inset-x-0 border-b border-edge last:border-b-0"
                  />
                ))}
                {placed.map(({ epic, bar }, index) => {
                  const done = percentDone(epic);
                  return (
                    <Link
                      key={epic.key}
                      href={ticketHref(epic.key)}
                      aria-label={`${epic.key} ${epic.title}: ${epic.startDate ?? 'no start'} to ${epic.dueDate ?? 'no due date'}, ${epic.status.name}${done !== null ? `, ${done}% done` : ''}`}
                      title={`${epic.key} ${epic.title}`}
                      style={{
                        top: index * ROW + 8,
                        left: bar.left * dayWidth,
                        width: Math.max(bar.days * dayWidth, 6),
                        height: ROW - 16,
                      }}
                      className={`absolute flex items-center overflow-hidden rounded ${barColour(epic)} ${
                        bar.partial ? 'opacity-60' : ''
                      } hover:ring-2 hover:ring-active`}
                    >
                      {done !== null && (
                        <span
                          aria-hidden="true"
                          style={{ width: `${done}%` }}
                          className="h-full bg-text/15"
                        />
                      )}
                    </Link>
                  );
                })}
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 overflow-visible"
                  width={width}
                  height={placed.length * ROW}
                >
                  <defs>
                    <marker
                      id="timeline-arrow"
                      viewBox="0 0 6 6"
                      refX="5"
                      refY="3"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto"
                    >
                      <path d="M0,0 L6,3 L0,6 z" className="fill-muted" />
                    </marker>
                  </defs>
                  {arrows.map((arrow) => (
                    <path
                      key={arrow.key}
                      d={arrow.d}
                      fill="none"
                      className="stroke-muted"
                      strokeWidth={1.25}
                      markerEnd="url(#timeline-arrow)"
                    />
                  ))}
                </svg>
              </div>

              {todayX >= 0 && todayX <= width && (
                <div
                  aria-hidden="true"
                  style={{ left: todayX + dayWidth / 2 }}
                  className="pointer-events-none absolute top-0 bottom-0 w-px bg-active"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {timeline.dependencies.length > 0 && (
        <section aria-labelledby="timeline-dependencies" className="flex flex-col gap-1">
          <h2 id="timeline-dependencies" className="text-[13px] font-semibold">
            Dependencies
          </h2>
          <ul className="flex flex-col gap-0.5 text-[13px]">
            {timeline.dependencies.map((link) => (
              <li key={`${link.blocker}-${link.blocked}`}>
                <Link href={ticketHref(link.blocker)} className="font-mono text-xs hover:underline">
                  {link.blocker}
                </Link>{' '}
                blocks{' '}
                <Link href={ticketHref(link.blocked)} className="font-mono text-xs hover:underline">
                  {link.blocked}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {unscheduled.length > 0 && (
        <section aria-labelledby="timeline-unscheduled" className="flex flex-col gap-1">
          <h2 id="timeline-unscheduled" className="text-[13px] font-semibold">
            Not scheduled
          </h2>
          <ul className="flex flex-col gap-0.5 text-[13px]">
            {unscheduled.map((epic) => (
              <li key={epic.key} className="flex gap-2">
                <Link
                  href={ticketHref(epic.key)}
                  className="font-mono text-xs text-muted hover:text-text"
                >
                  {epic.key}
                </Link>
                <span className="truncate">{epic.title}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {timeline.hiddenEpics > 0 && (
        <p className="text-xs text-muted">
          {timeline.hiddenEpics} more {timeline.hiddenEpics === 1 ? 'epic is' : 'epics are'} not
          shown.
        </p>
      )}
    </div>
  );
}
