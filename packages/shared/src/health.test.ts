import { describe, expect, it } from 'vitest';
import { healthLiveSchema, healthReadySchema } from './health';

describe('healthReadySchema', () => {
  it('accepts a degraded report with a failed check', () => {
    const parsed = healthReadySchema.safeParse({
      status: 'degraded',
      checks: { database: { status: 'failed', detail: 'timeout' } },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts an ok report with latencies', () => {
    const parsed = healthReadySchema.safeParse({
      status: 'ok',
      checks: { database: { status: 'ok', latencyMs: 3 }, migrations: { status: 'ok' } },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a check whose status is not ok or failed', () => {
    const parsed = healthReadySchema.safeParse({
      status: 'ok',
      checks: { database: { status: 'maybe' } },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('healthLiveSchema', () => {
  it('accepts a liveness body', () => {
    const parsed = healthLiveSchema.safeParse({
      status: 'ok',
      version: '0.0.0',
      uptimeSeconds: 12,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects negative uptime', () => {
    const parsed = healthLiveSchema.safeParse({
      status: 'ok',
      version: '0.0.0',
      uptimeSeconds: -1,
    });
    expect(parsed.success).toBe(false);
  });
});
