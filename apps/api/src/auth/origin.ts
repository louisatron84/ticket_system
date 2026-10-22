/**
 * Cross-site request forgery defence for cookie sessions, on top of SameSite=Lax. Browsers send an
 * Origin header on cross-origin writes, so a present Origin must be one of ours. Requests without
 * one come from non-browser clients (curl, server-to-server) and cannot be forged by a web page.
 */
export function assertAllowedOrigin(
  origin: string | undefined,
  allowed: readonly string[],
): boolean {
  return origin === undefined || allowed.includes(origin);
}
