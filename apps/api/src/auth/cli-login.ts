import { cliLogins, type Db } from '@forge/db';
import {
  DEFAULT_TOKEN_DAYS,
  USER_CODE_ALPHABET,
  normaliseUserCode,
  type CliLoginRequest,
  type CliTokenPoll,
  type TokenScope,
} from '@forge/shared';
import { and, eq, gt, sql } from 'drizzle-orm';
import { randomBytes, randomInt } from 'node:crypto';
import { isUniqueViolation } from '../db-errors';
import { AppError } from '../errors';
import { loadMembership } from './membership';
import { createToken, hashToken } from './tokens';

// Signing the command line in from a browser, in the style of OAuth's device flow. The command
// line keeps a long secret device code and shows a short user code; the person checks the short
// code in the browser, where they are already signed in, and allows it. The token is made only when
// the command line collects it, so it is never stored anywhere, not even briefly.

export const LOGIN_TTL_SECONDS = 600;
/** Logins waiting for approval at once, across everyone. */
export const MAX_WAITING_LOGINS = 500;
/** How often the command line may ask whether it has been approved. */
export const POLL_INTERVAL_SECONDS = 3;

const unknownCode = () =>
  new AppError('not_found', 'That code is unknown or has expired. Run `forge login` again.', 404);

function userCode(): string {
  const pick = () => USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]!;
  const part = () => Array.from({ length: 4 }, pick).join('');
  return `${part()}-${part()}`;
}

export async function startLogin(
  db: Db,
  input: { machine: string; ip: string; verificationBase: string },
) {
  // X-Forwarded-For is believed from the loopback proxy, so a caller on this machine can claim a
  // fresh address for each start. Counting by socket would not help: behind the web proxy every
  // caller shares one socket peer, so one noisy caller would lock everyone out. Instead, however
  // the per-address limit is got round, waiting logins never pile up without end.
  const [{ waiting }] = (await db
    .select({ waiting: sql<number>`count(*)::int` })
    .from(cliLogins)
    .where(and(eq(cliLogins.status, 'pending'), gt(cliLogins.expiresAt, sql`now()`)))) as [
    { waiting: number },
  ];
  if (waiting >= MAX_WAITING_LOGINS) {
    throw new AppError(
      'rate_limited',
      'Too many sign-ins are waiting. Try again in a few minutes.',
      429,
    );
  }
  const deviceCode = randomBytes(32).toString('base64url');
  let code = userCode();
  // A user code is unique for all time; on the rare repeat, draw another.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await db.insert(cliLogins).values({
        deviceCodeHash: hashToken(deviceCode),
        userCodeHash: hashToken(code),
        machine: input.machine,
        requestIp: input.ip,
        expiresAt: new Date(Date.now() + LOGIN_TTL_SECONDS * 1000),
      });
      break;
    } catch (error) {
      if (attempt >= 3 || !isUniqueViolation(error, 'cli_logins_user_code_unique')) throw error;
      code = userCode();
    }
  }
  return {
    deviceCode,
    userCode: code,
    verificationUrl: `${input.verificationBase}/cli/approve?code=${code}`,
    expiresIn: LOGIN_TTL_SECONDS,
    interval: POLL_INTERVAL_SECONDS,
  };
}

/** Two addresses are the same caller; every loopback form counts as this one machine. */
function sameAddress(a: string, b: string): boolean {
  const plain = (value: string) => (value.startsWith('::ffff:') ? value.slice(7) : value);
  const local = (value: string) => value === '::1' || /^127\./.test(value);
  const [x, y] = [plain(a), plain(b)];
  return x === y || (local(x) && local(y));
}

/**
 * A pending, unexpired login by its user code, for the approval page. `viewerIp` is the address
 * of the person looking: a login started somewhere else is the shape of a phishing attempt (an
 * attacker runs `forge login` and sends the link), so the page warns and asks again.
 */
export async function lookupLogin(
  db: Db,
  rawCode: string,
  viewerIp: string,
): Promise<CliLoginRequest> {
  const code = normaliseUserCode(rawCode);
  if (!code) throw unknownCode();
  const [row] = await db
    .select()
    .from(cliLogins)
    .where(
      and(
        eq(cliLogins.userCodeHash, hashToken(code)),
        eq(cliLogins.status, 'pending'),
        gt(cliLogins.expiresAt, sql`now()`),
      ),
    );
  if (!row) throw unknownCode();
  return {
    userCode: code,
    machine: row.machine,
    requestIp: row.requestIp,
    fromYourAddress: sameAddress(row.requestIp, viewerIp),
    requestedAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Allows or denies a pending login. Only a pending, unexpired login can be decided, once. */
export async function decideLogin(
  db: Db,
  input:
    | {
        decision: 'allow';
        userCode: string;
        userId: string;
        organisationId: string;
        scope: TokenScope;
        differentAddressConfirmed?: boolean | undefined;
        viewerIp: string;
      }
    | { decision: 'deny'; userCode: string; userId: string },
): Promise<void> {
  const code = normaliseUserCode(input.userCode);
  if (!code) throw unknownCode();
  if (input.decision === 'allow' && !input.differentAddressConfirmed) {
    const pending = await lookupLogin(db, code, input.viewerIp);
    if (!pending.fromYourAddress) {
      throw new AppError(
        'conflict',
        'This sign-in was started from another address than yours. Confirm that you started it yourself, or deny it.',
        409,
      );
    }
  }
  if (input.decision === 'allow') {
    const membership = await loadMembership(db, input.organisationId, input.userId);
    if (!membership) throw new AppError('not_found', 'Not found.', 404);
  }
  const [row] = await db
    .update(cliLogins)
    .set(
      input.decision === 'allow'
        ? {
            status: 'approved',
            approvedBy: input.userId,
            organisationId: input.organisationId,
            scope: input.scope,
          }
        : { status: 'denied' },
    )
    .where(
      and(
        eq(cliLogins.userCodeHash, hashToken(code)),
        eq(cliLogins.status, 'pending'),
        gt(cliLogins.expiresAt, sql`now()`),
      ),
    )
    .returning({ id: cliLogins.id });
  if (!row) throw unknownCode();
}

/** The command line asking whether it is approved yet; on approval, its token, exactly once. */
export async function pollLogin(
  db: Db,
  input: { deviceCode: string; requestId: string },
): Promise<CliTokenPoll> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(cliLogins)
      .where(eq(cliLogins.deviceCodeHash, hashToken(input.deviceCode)))
      .for('update');
    if (!row || row.status === 'collected') return { status: 'expired' };
    if (row.expiresAt.getTime() <= Date.now()) return { status: 'expired' };
    if (row.status === 'denied') return { status: 'denied' };

    const tooSoon =
      row.lastPolledAt !== null &&
      Date.now() - row.lastPolledAt.getTime() < (POLL_INTERVAL_SECONDS - 1) * 1000;
    await tx.update(cliLogins).set({ lastPolledAt: new Date() }).where(eq(cliLogins.id, row.id));
    if (row.status === 'pending') return { status: tooSoon ? 'slow_down' : 'pending' };

    // Approved: spend the login and make the token in the same transaction.
    await tx.update(cliLogins).set({ status: 'collected' }).where(eq(cliLogins.id, row.id));
    const made = await createToken(tx, {
      userId: row.approvedBy!,
      organisationId: row.organisationId!,
      name: `forge login on ${row.machine}`.slice(0, 60),
      scope: row.scope as TokenScope,
      expiresInDays: DEFAULT_TOKEN_DAYS,
      createdVia: 'login',
      requestId: input.requestId,
    });
    return { status: 'approved', token: made.token };
  });
}
