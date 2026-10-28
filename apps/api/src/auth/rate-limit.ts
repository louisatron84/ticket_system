import { AppError } from '../errors';

/**
 * A small fixed-window counter kept in memory: enough for one API process. Each key may be used
 * `limit` times per `windowMs`; after that the call is refused with 429 until the window ends.
 */
export function rateLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key: string, message = 'Too many attempts. Wait a minute and try again.') {
      const now = Date.now();
      // Forget finished windows now and then, so the map cannot grow without bound.
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
      }
      const current = windows.get(key);
      if (!current || now - current.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return;
      }
      current.count += 1;
      if (current.count > limit) throw new AppError('rate_limited', message, 429);
    },
  };
}
