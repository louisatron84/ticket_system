import { sessions, users } from '@forge/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startIntegration, type Integration } from '../test-support/integration';
import { createSession, hashSessionToken, resolveSession, revokeSession } from './sessions';

let ctx: Integration;
let ownerId: string;

beforeAll(async () => {
  ctx = await startIntegration();
  const [owner] = await ctx.db.select().from(users).where(eq(users.email, 'owner@acme.test'));
  ownerId = owner!.id;
});

afterAll(async () => {
  await ctx.close();
});

const create = () => createSession(ctx.db, { userId: ownerId, ttlHours: 1, createdVia: 'dev' });

describe('createSession', () => {
  it('returns a 43-character url-safe token and stores only its hash', async () => {
    const { token, sessionId } = await create();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [row] = await ctx.db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row?.tokenHash).toBe(hashSessionToken(token));
    expect(row?.tokenHash).not.toContain(token);
    expect(row?.createdVia).toBe('dev');
  });

  it('issues a different token every time', async () => {
    const [a, b] = [await create(), await create()];
    expect(a.token).not.toBe(b.token);
  });

  it('sets the expiry from the time-to-live', async () => {
    const { expiresAt } = await createSession(ctx.db, {
      userId: ownerId,
      ttlHours: 2,
      createdVia: 'dev',
    });
    const hours = (expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(1.99);
    expect(hours).toBeLessThanOrEqual(2);
  });
});

describe('resolveSession', () => {
  it('returns the user for a fresh token', async () => {
    const { token, sessionId } = await create();
    expect(await resolveSession(ctx.db, token)).toEqual({
      sessionId,
      user: { id: ownerId, email: 'owner@acme.test', displayName: 'Olivia Owner' },
    });
  });

  it.each([
    ['a random string', 'not-a-token'],
    ['an empty string', ''],
    ['a very long string', 'a'.repeat(5000)],
    ['a 43-character string that was never issued', 'A'.repeat(43)],
  ])('returns null for %s', async (_label, token) => {
    expect(await resolveSession(ctx.db, token)).toBeNull();
  });

  it('returns null when a single character of a real token is changed', async () => {
    const { token } = await create();
    const last = token.at(-1)!;
    const tampered = token.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    expect(await resolveSession(ctx.db, tampered)).toBeNull();
  });

  it('returns null once the session has expired', async () => {
    const { token, sessionId } = await create();
    await ctx.db
      .update(sessions)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(sessions.id, sessionId));
    expect(await resolveSession(ctx.db, token)).toBeNull();
  });

  it('returns null once the session has been revoked', async () => {
    const { token, sessionId } = await create();
    await revokeSession(ctx.db, sessionId);
    expect(await resolveSession(ctx.db, token)).toBeNull();
  });

  it('keeps two sessions of one user independent', async () => {
    const [a, b] = [await create(), await create()];
    await revokeSession(ctx.db, a.sessionId);
    expect(await resolveSession(ctx.db, a.token)).toBeNull();
    expect(await resolveSession(ctx.db, b.token)).not.toBeNull();
  });

  it('refreshes last-seen at most once a minute', async () => {
    const { token, sessionId } = await create();
    const seen = async () =>
      (await ctx.db.select().from(sessions).where(eq(sessions.id, sessionId)))[0]!.lastSeenAt;

    const first = await seen();
    await resolveSession(ctx.db, token);
    expect((await seen()).getTime()).toBe(first.getTime());

    await ctx.db
      .update(sessions)
      .set({ lastSeenAt: sql`now() - interval '5 minutes'` })
      .where(eq(sessions.id, sessionId));
    const stale = await seen();
    await resolveSession(ctx.db, token);
    expect((await seen()).getTime()).toBeGreaterThan(stale.getTime() + 60_000);
  });
});
