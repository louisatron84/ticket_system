import { z } from 'zod';

export const ERROR_CODES = [
  'validation_failed',
  'not_found',
  'unauthenticated',
  'forbidden',
  'conflict',
  'payload_too_large',
  'rate_limited',
  'dependency_unavailable',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
