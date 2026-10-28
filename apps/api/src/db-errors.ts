// Drizzle wraps driver errors; the Postgres error (with its SQLSTATE `code` and `constraint`)
// is on `cause`. These read it without caring which layer threw.

const source = (error: unknown) => (error as { cause?: unknown }).cause ?? error;

export const pgErrorCode = (error: unknown): string | undefined =>
  (source(error) as { code?: string }).code;

export const pgConstraint = (error: unknown): string | undefined =>
  (source(error) as { constraint?: string }).constraint;

/** A unique constraint refused a row. Pass a constraint or index name to match only that one. */
export const isUniqueViolation = (error: unknown, constraint?: string): boolean =>
  pgErrorCode(error) === '23505' &&
  (constraint === undefined || pgConstraint(error) === constraint);

/** A foreign key (including the composite ones that keep data inside a workspace) refused a row. */
export const isForeignKeyViolation = (error: unknown): boolean => pgErrorCode(error) === '23503';
