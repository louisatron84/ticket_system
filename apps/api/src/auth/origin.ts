/**
 * Cross-site request forgery defence for cookie sessions, on top of SameSite=Lax. Browsers send an
 * Origin header on cross-origin writes, so a present Origin must be one of ours. Requests without
 * one come from non-browser clients (curl, server-to-server) and cannot be forged by a web page:
 * such a client could just as well send our Origin, so demanding it would protect nothing.
 *
 * As a second line, a browser that says (Sec-Fetch-Site) the request comes from another site is
 * refused even without an Origin, in case some browser or extension ever leaves Origin out.
 */
export function assertAllowedOrigin(
  origin: string | undefined,
  allowed: readonly string[],
  fetchSite?: string,
): boolean {
  if (origin !== undefined) return allowed.includes(origin);
  return fetchSite === undefined || fetchSite === 'same-origin' || fetchSite === 'none';
}
