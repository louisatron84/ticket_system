import { describe, expect, it } from 'vitest';
import { ERROR_CODES, apiErrorSchema } from './errors';

describe('apiErrorSchema', () => {
  it('accepts a minimal error body', () => {
    const parsed = apiErrorSchema.safeParse({
      error: { code: 'not_found', message: 'No such ticket', requestId: 'req-12345678' },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts field-level details', () => {
    const parsed = apiErrorSchema.safeParse({
      error: {
        code: 'validation_failed',
        message: 'Invalid input',
        requestId: 'req-12345678',
        details: [{ path: 'title', message: 'Required' }],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown error code', () => {
    const parsed = apiErrorSchema.safeParse({
      error: { code: 'kaboom', message: 'x', requestId: 'req-12345678' },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a body without a requestId', () => {
    const parsed = apiErrorSchema.safeParse({ error: { code: 'not_found', message: 'x' } });
    expect(parsed.success).toBe(false);
  });

  it('lists every code the API may return', () => {
    expect(ERROR_CODES).toEqual([
      'validation_failed',
      'not_found',
      'unauthenticated',
      'forbidden',
      'conflict',
      'payload_too_large',
      'rate_limited',
      'dependency_unavailable',
      'internal_error',
    ]);
  });
});
