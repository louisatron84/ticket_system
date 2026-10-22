import { healthReadySchema, type HealthReady } from '@forge/shared';

export type UnreachableReason = 'timeout' | 'network error' | 'unexpected response';

export type ReadinessResult =
  | { kind: 'ok'; body: HealthReady }
  | { kind: 'degraded'; body: HealthReady }
  | { kind: 'unreachable'; reason: UnreachableReason };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

class TimedOut extends Error {}

/**
 * Asks the API whether it and its dependencies are ready. Never throws: every failure becomes
 * an `unreachable` result with a fixed reason the UI can explain.
 */
export async function fetchReadiness(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 5000,
): Promise<ReadinessResult> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimedOut());
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchImpl(`${baseUrl}/health/ready`, { cache: 'no-store', signal: controller.signal }),
      deadline,
    ]);

    if (response.status !== 200 && response.status !== 503) {
      return { kind: 'unreachable', reason: 'unexpected response' };
    }

    const parsed = healthReadySchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) return { kind: 'unreachable', reason: 'unexpected response' };

    if (response.status === 200 && parsed.data.status === 'ok') {
      return { kind: 'ok', body: parsed.data };
    }
    if (response.status === 503 && parsed.data.status === 'degraded') {
      return { kind: 'degraded', body: parsed.data };
    }
    return { kind: 'unreachable', reason: 'unexpected response' };
  } catch (error) {
    return {
      kind: 'unreachable',
      reason: error instanceof TimedOut ? 'timeout' : 'network error',
    };
  } finally {
    clearTimeout(timer);
  }
}
