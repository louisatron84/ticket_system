import { z } from 'zod';
import { singleLineText } from './tickets';

// Personal access tokens for the command line, and signing the command line in from a browser.

export const TOKEN_PREFIX = 'forge_pat_';
/** `forge_pat_` and 32 random bytes in base64url. */
export const TOKEN_PATTERN = /^forge_pat_[A-Za-z0-9_-]{43}$/;

export const TOKEN_SCOPES = ['read', 'write'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const DEFAULT_TOKEN_DAYS = 30;
export const MAX_TOKEN_DAYS = 365;

export const createTokenBodySchema = z.strictObject({
  name: singleLineText(60),
  organisationId: z.uuid(),
  scope: z.enum(TOKEN_SCOPES),
  /** Every token expires; a year at most. */
  expiresInDays: z.number().int().min(1).max(MAX_TOKEN_DAYS),
});
export type CreateTokenBody = z.infer<typeof createTokenBodySchema>;

const workspaceRef = z.object({ id: z.uuid(), slug: z.string(), name: z.string() });

export const apiTokenSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  scope: z.enum(TOKEN_SCOPES),
  /** The start of the token, e.g. `forge_pat_Ab3d…`, to tell tokens apart. Never the whole thing. */
  hint: z.string(),
  workspace: workspaceRef,
  createdVia: z.enum(['page', 'login']),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  lastUsedIp: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type ApiToken = z.infer<typeof apiTokenSchema>;

/** The answer to making a token: the only time the token itself is ever sent. */
export const createdTokenSchema = z.object({ token: z.string(), details: apiTokenSchema });
export type CreatedToken = z.infer<typeof createdTokenSchema>;

export const cliWhoAmISchema = z.object({
  user: z.object({ displayName: z.string(), email: z.string() }),
  workspace: workspaceRef,
  scope: z.enum(TOKEN_SCOPES),
  expiresAt: z.string(),
});
export type CliWhoAmI = z.infer<typeof cliWhoAmISchema>;

// ---------------------------------------------------------------------------
// Browser sign-in for the command line
// ---------------------------------------------------------------------------

/** The user code: 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L), as XXXX-XXXX. */
export const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const USER_CODE_PATTERN =
  /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

/** A code as someone typed it: case and stray spaces or dashes do not matter. */
export function normaliseUserCode(input: string): string | null {
  const bare = input.toUpperCase().replace(/[\s-]/g, '');
  const code = `${bare.slice(0, 4)}-${bare.slice(4)}`;
  return USER_CODE_PATTERN.test(code) ? code : null;
}

export const cliLoginStartBodySchema = z.strictObject({ machine: singleLineText(100) });

export const cliLoginStartSchema = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUrl: z.string(),
  expiresIn: z.number().int(),
  interval: z.number().int(),
});

export const cliTokenPollBodySchema = z.strictObject({ deviceCode: z.string().max(100) });

export const cliTokenPollSchema = z.discriminatedUnion('status', [
  z.object({ status: z.enum(['pending', 'slow_down', 'denied', 'expired']) }),
  z.object({ status: z.literal('approved'), token: z.string() }),
]);
export type CliTokenPoll = z.infer<typeof cliTokenPollSchema>;

/** What the approval page shows before the person allows a login. */
export const cliLoginRequestSchema = z.object({
  userCode: z.string(),
  machine: z.string(),
  requestIp: z.string(),
  requestedAt: z.string(),
  expiresAt: z.string(),
});
export type CliLoginRequest = z.infer<typeof cliLoginRequestSchema>;

export const cliLoginLookupBodySchema = z.strictObject({ userCode: z.string().max(20) });

export const cliLoginDecisionBodySchema = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('allow'),
    userCode: z.string().max(20),
    organisationId: z.uuid(),
    scope: z.enum(TOKEN_SCOPES),
  }),
  z.strictObject({ decision: z.literal('deny'), userCode: z.string().max(20) }),
]);
export type CliLoginDecisionBody = z.infer<typeof cliLoginDecisionBodySchema>;
