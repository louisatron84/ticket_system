import { CircleCheck, CircleDashed, CircleX, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReadinessResult } from '@/lib/api';
import { describeStatus, type StatusState } from '@/lib/status';
import { RefreshButton } from './refresh-button';

const STATE: Record<StatusState, { icon: LucideIcon; word: string; color: string }> = {
  ok: { icon: CircleCheck, word: 'Running', color: 'text-ok' },
  failed: { icon: CircleX, word: 'Failing', color: 'text-fail' },
  unknown: { icon: CircleDashed, word: 'Unknown', color: 'text-muted' },
};

const SUMMARY_ICON = { ok: CircleCheck, warn: TriangleAlert, fail: CircleX } as const;
const SUMMARY_COLOR = { ok: 'text-ok', warn: 'text-ember', fail: 'text-fail' } as const;

export function SystemStatus({ result, checkedAt }: { result: ReadinessResult; checkedAt: Date }) {
  const { summary, rows } = describeStatus(result);
  const SummaryIcon = SUMMARY_ICON[summary.tone];

  return (
    <section aria-labelledby="system-status-heading">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 id="system-status-heading" className="text-base font-semibold">
            System status
          </h2>
          <p role="status" className="mt-1 flex items-center gap-2 text-[13px]">
            <SummaryIcon size={15} aria-hidden="true" className={SUMMARY_COLOR[summary.tone]} />
            {summary.text}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Checked{' '}
            <time dateTime={checkedAt.toISOString()} className="font-mono">
              {checkedAt.toISOString().slice(11, 19)} UTC
            </time>
          </p>
        </div>
        <RefreshButton />
      </div>

      <div className="overflow-x-auto rounded-md border border-edge bg-panel">
        <table className="w-full text-left text-[13px]">
          <caption className="sr-only">Status of each Forge component</caption>
          <thead>
            <tr className="border-b border-edge text-xs text-muted">
              <th scope="col" className="px-4 py-2 font-medium">
                Component
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Detail
              </th>
              <th scope="col" className="hidden px-4 py-2 text-right font-medium sm:table-cell">
                Latency
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {rows.map((row) => {
              const state = STATE[row.state];
              return (
                <tr key={row.id}>
                  <th scope="row" className="px-4 py-2.5 font-medium">
                    {row.label}
                  </th>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 ${state.color}`}>
                      <state.icon size={14} aria-hidden="true" />
                      {state.word}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{row.detail}</td>
                  <td className="hidden px-4 py-2.5 text-right font-mono text-xs tabular-nums text-muted sm:table-cell">
                    {row.latency}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
