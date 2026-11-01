import {
  REPORT_RANGES,
  formatEstimate,
  formatPoints,
  type DurationStats,
  type Reports,
} from '@forge/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { burndownChart, pathOf } from '@/lib/burndown';
import { workspaceHref } from '@/lib/nav';
import { barsOf, flowAreas, formatDays, niceTop, seriesOf } from '@/lib/reports-chart';

const WIDTH = 560;
const HEIGHT = 160;

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  });

function Panel({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-md border border-edge bg-panel p-4"
    >
      <h2 id={id} className="text-[13px] font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Key({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <span>
      <span
        aria-hidden="true"
        className={`mr-1 inline-block size-2.5 rounded-sm align-middle ${swatch}`}
      />
      {children}
    </span>
  );
}

/** A box for a chart, with the value at its top above it and the first and last dates under it. */
function Chart({
  label,
  top,
  from,
  to,
  children,
}: {
  label: string;
  top: string;
  from?: string;
  to?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span aria-hidden="true" className="text-[11px] text-muted">
        {top}
      </span>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={label}
        className="h-40 w-full overflow-visible"
        preserveAspectRatio="none"
      >
        <line x1={0} y1={HEIGHT} x2={WIDTH} y2={HEIGHT} className="stroke-edge" strokeWidth={1} />
        {children}
      </svg>
      {from && to && (
        <div className="flex justify-between text-[11px] text-muted">
          <span>{shortDate(from)}</span>
          <span>{shortDate(to)}</span>
        </div>
      )}
    </div>
  );
}

const line = (className: string, width = 2, dashed = false) => ({
  className,
  strokeWidth: width,
  fill: 'none',
  vectorEffect: 'non-scaling-stroke' as const,
  ...(dashed ? { strokeDasharray: '4 4' } : {}),
});

function Duration({ label, stats, help }: { label: string; stats: DurationStats; help: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-edge bg-panel p-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-lg font-semibold">{formatDays(stats.medianDays)}</span>
      <span className="text-xs text-muted">
        {stats.count === 0
          ? help
          : `Median of ${stats.count}. 85% within ${formatDays(stats.p85Days)}.`}
      </span>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-edge bg-panel p-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  );
}

function CycleCharts({ reports }: { reports: Reports }) {
  const cycles = reports.cycles!;
  const format = (value: number) =>
    reports.estimation === 'points' ? formatPoints(value)! : (formatEstimate(value) ?? '0m');
  const active = cycles.active;
  const chart = active ? burndownChart(active, active.days) : null;
  const doneOf = (day: NonNullable<typeof active>['days'][number]) =>
    chart?.unit === 'estimate'
      ? day.scopeEstimate - day.remainingEstimate
      : day.scopeTickets - day.remainingTickets;
  const amount = (value: number) =>
    chart?.unit === 'estimate' ? format(value) : `${value} ${value === 1 ? 'ticket' : 'tickets'}`;
  const last = active?.days.at(-1);

  const byEstimate = cycles.velocity.some((cycle) => cycle.plannedEstimate > 0);
  const planned = cycles.velocity.map((c) => (byEstimate ? c.plannedEstimate : c.plannedTickets));
  const done = cycles.velocity.map((c) => (byEstimate ? c.doneEstimate : c.doneTickets));
  const top = niceTop(Math.max(0, ...planned, ...done));
  const plannedBars = barsOf(planned, WIDTH, HEIGHT, top);
  const doneBars = barsOf(done, WIDTH, HEIGHT, top);
  const velocityAmount = (value: number) =>
    byEstimate ? format(value) : `${value} ${value === 1 ? 'ticket' : 'tickets'}`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={active ? `Burndown and burnup: ${active.name}` : 'Burndown'} id="report-burn">
        {!active || !chart || active.days.length === 0 ? (
          <p className="text-[13px] text-muted">No cycle is running.</p>
        ) : (
          <>
            <Chart
              label={`${active.name}: ${amount(last ? doneOf(last) : 0)} done of ${amount(
                last ? (chart.unit === 'estimate' ? last.scopeEstimate : last.scopeTickets) : 0,
              )} in scope.`}
              top={amount(chart.top)}
              from={active.startsOn}
              to={active.endsOn}
            >
              <path d={pathOf(chart.ideal, WIDTH, HEIGHT)} {...line('stroke-muted', 1, true)} />
              <path d={pathOf(chart.scope, WIDTH, HEIGHT)} {...line('stroke-edge-strong', 1.5)} />
              <path d={pathOf(chart.remaining, WIDTH, HEIGHT)} {...line('stroke-active')} />
              <path
                d={pathOf(
                  active.days.map((day, index) => ({
                    x: chart.scope[index]!.x,
                    y: doneOf(day) / chart.top,
                  })),
                  WIDTH,
                  HEIGHT,
                )}
                {...line('stroke-ok')}
              />
            </Chart>
            <p className="flex flex-wrap gap-x-4 text-xs text-muted">
              <Key swatch="bg-active">Left</Key>
              <Key swatch="bg-ok">Done</Key>
              <Key swatch="bg-edge-strong">Scope</Key>
              <span>Dashed: ideal</span>
            </p>
          </>
        )}
      </Panel>

      <Panel title="Velocity" id="report-velocity">
        {cycles.velocity.length === 0 ? (
          <p className="text-[13px] text-muted">Velocity shows once a cycle has been completed.</p>
        ) : (
          <>
            <Chart
              label={`Planned and done over the last ${cycles.velocity.length} cycles: ${cycles.velocity
                .map(
                  (cycle, index) =>
                    `${cycle.name} ${velocityAmount(done[index]!)} of ${velocityAmount(planned[index]!)}`,
                )
                .join('; ')}.`}
              top={velocityAmount(top)}
            >
              {plannedBars.map((bar, index) => (
                <rect key={`p${index}`} {...bar} className="fill-edge-strong/50" />
              ))}
              {doneBars.map((bar, index) => (
                <rect
                  key={`d${index}`}
                  x={bar.x + bar.width * 0.2}
                  y={bar.y}
                  width={bar.width * 0.6}
                  height={bar.height}
                  className="fill-ok"
                />
              ))}
            </Chart>
            <ul className="grid gap-x-4 text-xs text-muted sm:grid-cols-2">
              {cycles.velocity.map((cycle, index) => (
                <li key={cycle.name} className="flex justify-between gap-2">
                  <span className="truncate">{cycle.name}</span>
                  <span className="font-mono text-text">
                    {velocityAmount(done[index]!)} / {velocityAmount(planned[index]!)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="flex flex-wrap gap-x-4 text-xs text-muted">
              <Key swatch="bg-ok">Done</Key>
              <Key swatch="bg-edge-strong/50">Planned at the start</Key>
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}

/** A project's reports over the last 30 or 90 days, drawn as plain SVG charts. */
export function ReportsView({
  slug,
  projectKey,
  reports,
}: {
  slug: string;
  projectKey: string;
  reports: Reports;
}) {
  const base = workspaceHref(slug, `/projects/${projectKey}/reports`);
  const last = reports.createdResolved.at(-1) ?? { created: 0, resolved: 0 };
  const crTop = niceTop(Math.max(last.created, last.resolved));
  const created = seriesOf(
    reports.createdResolved.map((day) => day.created),
    crTop,
  );
  const resolved = seriesOf(
    reports.createdResolved.map((day) => day.resolved),
    crTop,
  );
  const throughputTop = niceTop(Math.max(0, ...reports.throughput.map((week) => week.done)));
  const weeks = barsOf(
    reports.throughput.map((week) => week.done),
    WIDTH,
    HEIGHT,
    throughputTop,
  );
  const flow = flowAreas(reports.flow, WIDTH, HEIGHT);
  const today = reports.flow.at(-1);
  const ticketHref = (key: string) => workspaceHref(slug, `/tickets/${key}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Range" className="inline-flex rounded-md border border-edge">
          {REPORT_RANGES.map((days) => (
            <Link
              key={days}
              href={days === 30 ? base : `${base}?days=${days}`}
              aria-current={reports.days === days ? 'page' : undefined}
              className={`px-3 py-1 text-[13px] first:rounded-l-md last:rounded-r-md ${
                reports.days === days
                  ? 'bg-raised font-medium text-text'
                  : 'text-muted hover:text-text'
              }`}
            >
              Last {days} days
            </Link>
          ))}
        </nav>
        <p className="text-xs text-muted">
          {shortDate(reports.from)} to {shortDate(reports.to)}. Archived and scrapped tickets are
          left out.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Count label="Made" value={last.created} />
        <Count label="Done" value={last.resolved} />
        <Duration
          label="Lead time (made to done)"
          stats={reports.leadTime}
          help="Nothing done in this range yet."
        />
        <Duration
          label="Cycle time (started to done)"
          stats={reports.cycleTime}
          help="Nothing started and done in this range yet."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Made and done" id="report-created">
          <Chart
            label={`Over the last ${reports.days} days, ${last.created} tickets were made and ${last.resolved} were done.`}
            top={String(crTop)}
            from={reports.from}
            to={reports.to}
          >
            <path d={pathOf(created, WIDTH, HEIGHT)} {...line('stroke-ember')} />
            <path d={pathOf(resolved, WIDTH, HEIGHT)} {...line('stroke-ok')} />
          </Chart>
          <p className="flex flex-wrap gap-x-4 text-xs text-muted">
            <Key swatch="bg-ember">Made: {last.created}</Key>
            <Key swatch="bg-ok">Done: {last.resolved}</Key>
            <span>Running totals; a widening gap means work is piling up.</span>
          </p>
        </Panel>

        <Panel title="Throughput" id="report-throughput">
          <Chart
            label={`Tickets done each week: ${reports.throughput
              .map((week) => `week of ${shortDate(week.weekStart)}, ${week.done}`)
              .join('; ')}.`}
            top={String(throughputTop)}
          >
            {weeks.map((bar, index) => (
              <rect key={index} {...bar} className="fill-active/80" />
            ))}
          </Chart>
          <div className="flex justify-between text-[11px] text-muted">
            <span>Week of {shortDate(reports.throughput[0]?.weekStart ?? reports.from)}</span>
            <span>
              {reports.throughput.length > 0
                ? `Week of ${shortDate(reports.throughput.at(-1)!.weekStart)}`
                : ''}
            </span>
          </div>
          <p className="text-xs text-muted">
            Done each week, {reports.throughput.reduce((sum, week) => sum + week.done, 0)} in all.
          </p>
        </Panel>

        <Panel title="Cumulative flow" id="report-flow">
          <Chart
            label={
              today
                ? `Today ${today.notStarted} not started, ${today.inProgress} in progress and ${today.done} done.`
                : 'No tickets yet.'
            }
            top={String(flow.top)}
            from={reports.from}
            to={reports.to}
          >
            <path d={flow.areas.done} className="fill-ok/60" />
            <path d={flow.areas.inProgress} className="fill-active/60" />
            <path d={flow.areas.notStarted} className="fill-muted/40" />
          </Chart>
          <p className="flex flex-wrap gap-x-4 text-xs text-muted">
            <Key swatch="bg-muted/40">Not started: {today?.notStarted ?? 0}</Key>
            <Key swatch="bg-active/60">In progress: {today?.inProgress ?? 0}</Key>
            <Key swatch="bg-ok/60">Done: {today?.done ?? 0}</Key>
          </p>
        </Panel>

        <Panel title="Age in status" id="report-age">
          {reports.age.statuses.length === 0 ? (
            <p className="text-[13px] text-muted">No open tickets.</p>
          ) : (
            <>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-1 font-medium">Status</th>
                    <th className="pb-1 text-right font-medium">Open</th>
                    <th className="pb-1 text-right font-medium">Median</th>
                    <th className="pb-1 text-right font-medium">Longest</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.age.statuses.map((status) => (
                    <tr key={status.name} className="border-t border-edge">
                      <td className="py-1">{status.name}</td>
                      <td className="py-1 text-right font-mono">{status.count}</td>
                      <td className="py-1 text-right">{formatDays(status.medianDays)}</td>
                      <td className="py-1 text-right">{formatDays(status.oldestDays)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3 className="text-xs font-medium text-muted">Waiting longest</h3>
              <ul className="flex flex-col gap-0.5 text-[13px]">
                {reports.age.oldest.map((item) => (
                  <li key={item.key} className="flex items-center gap-2">
                    <Link
                      href={ticketHref(item.key)}
                      className="font-mono text-xs text-muted hover:text-text"
                    >
                      {item.key}
                    </Link>
                    <span className="min-w-0 flex-1 truncate" title={item.title}>
                      {item.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {item.status}, {formatDays(item.days)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      {reports.cycles && <CycleCharts reports={reports} />}
    </div>
  );
}
