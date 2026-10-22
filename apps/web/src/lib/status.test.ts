import { describe, expect, it } from 'vitest';
import { describeStatus } from './status';

describe('describeStatus', () => {
  it('summarises a healthy stack', () => {
    const view = describeStatus({
      kind: 'ok',
      body: {
        status: 'ok',
        checks: {
          database: { status: 'ok', latencyMs: 12 },
          migrations: { status: 'ok', latencyMs: 14 },
        },
      },
    });
    expect(view.summary).toEqual({ tone: 'ok', text: 'All systems running' });
    expect(view.rows).toEqual([
      { id: 'api', label: 'API', state: 'ok', detail: 'Responding', latency: '—' },
      { id: 'database', label: 'Database', state: 'ok', detail: 'Connected', latency: '12 ms' },
      {
        id: 'migrations',
        label: 'Migrations',
        state: 'ok',
        detail: 'Schema is up to date',
        latency: '14 ms',
      },
    ]);
  });

  it('turns failure reasons into actionable text', () => {
    const view = describeStatus({
      kind: 'degraded',
      body: {
        status: 'degraded',
        checks: {
          database: { status: 'failed', detail: 'timeout', latencyMs: 2001 },
          migrations: { status: 'failed', detail: 'migrations pending', latencyMs: 5 },
        },
      },
    });
    expect(view.summary).toEqual({ tone: 'warn', text: '2 checks failing' });
    expect(view.rows[1]).toMatchObject({
      id: 'database',
      state: 'failed',
      detail: 'No answer within 2 seconds',
    });
    expect(view.rows[2]).toMatchObject({
      id: 'migrations',
      state: 'failed',
      detail: 'Pending migrations. Run npm run db:migrate.',
    });
  });

  it('uses the singular for one failing check', () => {
    const view = describeStatus({
      kind: 'degraded',
      body: {
        status: 'degraded',
        checks: { database: { status: 'failed', detail: 'unreachable' } },
      },
    });
    expect(view.summary.text).toBe('1 check failing');
    expect(view.rows[1]).toMatchObject({ detail: 'Cannot connect to PostgreSQL' });
  });

  it('marks everything unknown when the API cannot be reached', () => {
    const view = describeStatus({ kind: 'unreachable', reason: 'network error' });
    expect(view.summary).toEqual({ tone: 'fail', text: 'API is not reachable' });
    expect(view.rows.map((row) => [row.id, row.state])).toEqual([
      ['api', 'failed'],
      ['database', 'unknown'],
      ['migrations', 'unknown'],
    ]);
    expect(view.rows[0]?.detail).toBe('Connection failed. Is npm run dev running?');
  });

  it('explains a timeout distinctly from a refused connection', () => {
    const view = describeStatus({ kind: 'unreachable', reason: 'timeout' });
    expect(view.rows[0]?.detail).toBe('No answer within 5 seconds');
  });
});
