import { sessions, users, type Db, type Executor } from '@forge/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'forge_session';

// 32 random bytes encode to exactly 43 base64url characters; anything else cannot be ours.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const TOUCH_INTERVAL_MS = 60_000;

export type ResolvedSession = {
  sessionId: string;
  user: { id: string; email: string; displayName: string };
};

/** Only this hash is stored; the token itself exists only in the person's cookie. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  db: Executor,
  input: { userId: string; ttlHours: number; createdVia: 'dev' },
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + input.ttlHours * 3_600_000);
  const [row] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      createdVia: input.createdVia,
    })
    .returning({ id: sessions.id });
  if (!row) throw new Error('Session insert returned no row');
  return { token, sessionId: row.id, expiresAt };
}

/** The user behind a cookie token, or null if it is unknown, tampered with, expired or revoked. */
export async function resolveSession(db: Db, token: string): Promise<ResolvedSession | null> {
  if (!TOKEN_SHAPE.test(token)) return null;

  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  if (!row) return null;

  // Avoid a write on every request: record activity at most once a minute.
  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    user: { id: row.userId, email: row.email, displayName: row.displayName },
  };
}

export async function revokeSession(db: Executor, sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}
