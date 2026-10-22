/** A named dependency probe for /health/ready. It resolves when healthy and throws otherwise. */
export type ReadinessCheck = {
  name: 'database' | 'migrations';
  run(signal: AbortSignal): Promise<{ detail?: string } | void>;
};

/**
 * Throw this from a check to fail with a reason that is safe to show clients. Any other error is
 * reported as "unreachable", because driver errors can embed connection strings.
 */
export class CheckFailure extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'CheckFailure';
  }
}
