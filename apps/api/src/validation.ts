import type { ZodType } from 'zod';
import { AppError } from './errors';

/** Parses a request body with a shared schema, or throws a 422 listing the offending fields. */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw new AppError(
    'validation_failed',
    'The request body is invalid.',
    422,
    result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}
