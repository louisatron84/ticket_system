import type { CheckResult } from '@forge/shared';
import type { ReadinessResult, UnreachableReason } from './api';

export type StatusState = 'ok' | 'failed' | 'unknown';

export type StatusRow = {
  id: 'api' | 'database' | 'migrations';
  label: string;
  state: StatusState;
  detail: string;
  latency: string;
};

export type StatusView = {
  summary: { tone: 'ok' | 'warn' | 'fail'; text: string };
  rows: StatusRow[];
};

const NO_LATENCY = '—';

const formatLatency = (check: CheckResult | undefined) =>
  check?.latencyMs === undefined ? NO_LATENCY : `${check.latencyMs} ms`;

const API_UNREACHABLE: Record<UnreachableReason, string> = {
  timeout: 'No answer within 5 seconds',
  'network error': 'Connection failed. Is npm run dev running?',
  'unexpected response': 'Responded, but not with a health report',
};

function failureDetail(id: StatusRow['id'], detail: string | undefined): string {
  if (detail === 'timeout') return 'No answer within 2 seconds';
  if (detail === 'migrations pending') return 'Pending migrations. Run npm run db:migrate.';
  if (detail === 'unreachable') {
    return id === 'migrations' ? 'Cannot read migration state' : 'Cannot connect to PostgreSQL';
  }
  return detail ?? 'Check failed';
}

function checkRow(
  id: 'database' | 'migrations',
  label: string,
  okDetail: string,
  check: CheckResult | undefined,
): StatusRow {
  if (!check) return { id, label, state: 'unknown', detail: 'Not reported', latency: NO_LATENCY };
  if (check.status === 'ok') {
    return { id, label, state: 'ok', detail: okDetail, latency: formatLatency(check) };
  }
  return {
    id,
    label,
    state: 'failed',
    detail: failureDetail(id, check.detail),
    latency: formatLatency(check),
  };
}

export function describeStatus(result: ReadinessResult): StatusView {
  if (result.kind === 'unreachable') {
    const unknown = {
      state: 'unknown',
      detail: 'Unknown while the API is down',
      latency: NO_LATENCY,
    };
    return {
      summary: { tone: 'fail', text: 'API is not reachable' },
      rows: [
        {
          id: 'api',
          label: 'API',
          state: 'failed',
          detail: API_UNREACHABLE[result.reason],
          latency: NO_LATENCY,
        },
        { id: 'database', label: 'Database', ...unknown } as StatusRow,
        { id: 'migrations', label: 'Migrations', ...unknown } as StatusRow,
      ],
    };
  }

  const { checks } = result.body;
  const failing = Object.values(checks).filter((check) => check.status === 'failed').length;

  return {
    summary:
      result.kind === 'ok'
        ? { tone: 'ok', text: 'All systems running' }
        : { tone: 'warn', text: `${failing} ${failing === 1 ? 'check' : 'checks'} failing` },
    rows: [
      { id: 'api', label: 'API', state: 'ok', detail: 'Responding', latency: NO_LATENCY },
      checkRow('database', 'Database', 'Connected', checks.database),
      checkRow('migrations', 'Migrations', 'Schema is up to date', checks.migrations),
    ],
  };
}
