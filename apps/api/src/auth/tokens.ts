import { apiTokens, organisations, type Db, type Executor } from '@forge/db';
import {
  hasPermission,
  TOKEN_PATTERN,
  TOKEN_PREFIX,
  type ApiToken,
  type CreatedToken,
  type TokenScope,
} from '@forge/shared';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { recordAudit } from '../audit';
import { AppError } from '../errors';
import { TOKEN_PERMISSIONS } from './guards';
import { loadMembership } from './membership';

const DAY_MS = 86_400_000;
const TOUCH_INTERVAL_MS = 60_000;

/** What a valid bearer token lets its request do. */
export type TokenGrant = {
  tokenId: string;
  userId: string;
  organisationId: string;
  scope: TokenScope;
};

/** Only this hash is stored; the token exists only where the person keeps it. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** `forge_pat_` and the first four characters after it. */
const hintOf = (token: string) => `${token.slice(0, TOKEN_PREFIX.length + 4)}…`;

/**
 * Makes a token for a member of the workspace. Returns the token itself, which is never stored or
 * shown again.
 */
export async function createToken(
  executor: Executor,
  input: {
    userId: string;
    organisationId: string;
    name: string;
    scope: TokenScope;
    expiresInDays: number;
    createdVia: 'page' | 'login';
    requestId: string;
  },
): Promise<{ token: string; id: string }> {
  const membership = await loadMembership(executor, input.organisationId, input.userId);
  if (!membership) throw new AppError('not_found', 'Not found.', 404);
  // A token is never worth more than its owner's role, so a role that can only read gets a token
  // that says so, instead of one labelled "read and change" that is refused at every change.
  const canChange = TOKEN_PERMISSIONS.some(
    (permission) =>
      permission !== 'tickets.view' && hasPermission(membership.permissions, permission),
  );
  const scope: TokenScope = canChange ? input.scope : 'read';

  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const [row] = await executor
    .insert(apiTokens)
    .values({
      userId: input.userId,
      organisationId: input.organisationId,
      name: input.name,
      scope,
      tokenHash: hashToken(token),
      prefix: hintOf(token),
      createdVia: input.createdVia,
      expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
    })
    .returning({ id: apiTokens.id });
  await recordAudit(executor, {
    organisationId: input.organisationId,
    actorUserId: input.userId,
    action: 'token.created',
    targetType: 'api_token',
    targetId: row!.id,
    // Never the token or its hash.
    after: {
      name: input.name,
      scope,
      expiresInDays: input.expiresInDays,
      via: input.createdVia,
    },
    requestId: input.requestId,
    source: 'user',
    outcome: 'success',
  });
  return { token, id: row!.id };
}

const tokenColumns = {
  id: apiTokens.id,
  name: apiTokens.name,
  scope: apiTokens.scope,
  prefix: apiTokens.prefix,
  createdVia: apiTokens.createdVia,
  createdAt: apiTokens.createdAt,
  expiresAt: apiTokens.expiresAt,
  lastUsedAt: apiTokens.lastUsedAt,
  lastUsedIp: apiTokens.lastUsedIp,
  revokedAt: apiTokens.revokedAt,
  workspaceId: organisations.id,
  workspaceSlug: organisations.slug,
  workspaceName: organisations.name,
};

type TokenRow = {
  id: string;
  name: string;
  scope: string;
  prefix: string;
  createdVia: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  revokedAt: Date | null;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
};

const iso = (date: Date | null) => (date ? date.toISOString() : null);

const toToken = (row: TokenRow): ApiToken => ({
  id: row.id,
  name: row.name,
  scope: row.scope as TokenScope,
  hint: row.prefix,
  workspace: { id: row.workspaceId, slug: row.workspaceSlug, name: row.workspaceName },
  createdVia: row.createdVia as 'page' | 'login',
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  lastUsedAt: iso(row.lastUsedAt),
  lastUsedIp: row.lastUsedIp,
  revokedAt: iso(row.revokedAt),
});

/** The person's own tokens, newest first, revoked and expired ones included for the record. */
export async function listTokens(db: Executor, userId: string): Promise<ApiToken[]> {
  const rows = await db
    .select(tokenColumns)
    .from(apiTokens)
    .innerJoin(organisations, eq(organisations.id, apiTokens.organisationId))
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt));
  return rows.map(toToken);
}

export async function loadToken(db: Executor, userId: string, tokenId: string): Promise<ApiToken> {
  const [row] = await db
    .select(tokenColumns)
    .from(apiTokens)
    .innerJoin(organisations, eq(organisations.id, apiTokens.organisationId))
    .where(and(eq(apiTokens.userId, userId), eq(apiTokens.id, tokenId)));
  if (!row) throw new AppError('not_found', 'Not found.', 404);
  return toToken(row);
}

export async function createdToken(
  db: Db,
  input: Parameters<typeof createToken>[1],
): Promise<CreatedToken> {
  return db.transaction(async (tx) => {
    const made = await createToken(tx, input);
    return { token: made.token, details: await loadToken(tx, input.userId, made.id) };
  });
}

/** Revokes one of the person's tokens. Revoking a revoked token changes nothing. */
export async function revokeToken(
  db: Db,
  input: { userId: string; tokenId: string; requestId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiTokens.id, input.tokenId),
          eq(apiTokens.userId, input.userId),
          isNull(apiTokens.revokedAt),
        ),
      )
      .returning({ id: apiTokens.id, organisationId: apiTokens.organisationId });
    if (!row) {
      // Someone else's token and a missing one look alike.
      await loadToken(tx, input.userId, input.tokenId);
      return;
    }
    await recordAudit(tx, {
      organisationId: row.organisationId,
      actorUserId: input.userId,
      action: 'token.revoked',
      targetType: 'api_token',
      targetId: row.id,
      requestId: input.requestId,
      source: 'user',
      outcome: 'success',
    });
  });
}

/**
 * The grant behind a bearer token, or null if it is malformed, unknown, expired or revoked. Use is
 * recorded at most once a minute; the very first use is also written to the audit log.
 */
export async function resolveToken(
  db: Db,
  token: string,
  context: { ip: string; requestId: string },
): Promise<TokenGrant | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [row] = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      organisationId: apiTokens.organisationId,
      scope: apiTokens.scope,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(token)),
        isNull(apiTokens.revokedAt),
        gt(apiTokens.expiresAt, sql`now()`),
      ),
    );
  if (!row) return null;

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.transaction(async (tx) => {
      // Only the request that changes "never used" to "used" writes the audit row.
      const [first] = await tx
        .update(apiTokens)
        .set({ lastUsedAt: new Date(), lastUsedIp: context.ip })
        .where(and(eq(apiTokens.id, row.id), isNull(apiTokens.lastUsedAt)))
        .returning({ id: apiTokens.id });
      if (first) {
        await recordAudit(tx, {
          organisationId: row.organisationId,
          actorUserId: row.userId,
          action: 'token.first_used',
          targetType: 'api_token',
          targetId: row.id,
          after: { ip: context.ip },
          requestId: context.requestId,
          source: 'user',
          outcome: 'success',
        });
      } else {
        await tx
          .update(apiTokens)
          .set({ lastUsedAt: new Date(), lastUsedIp: context.ip })
          .where(eq(apiTokens.id, row.id));
      }
    });
  }
  return {
    tokenId: row.id,
    userId: row.userId,
    organisationId: row.organisationId,
    scope: row.scope as TokenScope,
  };
}
