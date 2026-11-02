import { PgTransaction } from 'drizzle-orm/pg-core';

type Results<T extends readonly (() => PromiseLike<unknown>)[]> = {
  -readonly [K in keyof T]: T[K] extends () => PromiseLike<infer R> ? R : never;
};

/**
 * Runs independent reads. On the pool they run at once, each on its own connection; a transaction
 * has a single connection, which must never be asked two things at once (pg queues them today and
 * will refuse in pg 9), so there they run one after another.
 */
export async function together<const T extends readonly (() => PromiseLike<unknown>)[]>(
  executor: unknown,
  tasks: T,
): Promise<Results<T>> {
  if (!(executor instanceof PgTransaction)) {
    return (await Promise.all(tasks.map((task) => task()))) as Results<T>;
  }
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as Results<T>;
}
