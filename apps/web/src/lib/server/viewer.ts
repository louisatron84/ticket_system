import { devIdentitySchema, viewerSchema, type DevIdentity, type Viewer } from '@forge/shared';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Who the API says is signed in. `null` means nobody (no cookie, or the API rejected it). Any
 * other failure throws, so an outage never masquerades as "signed out".
 */
export async function fetchViewer(
  baseUrl: string,
  cookieHeader: string,
  fetchImpl: FetchLike = fetch,
): Promise<Viewer | null> {
  if (!cookieHeader) return null;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/v1/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
  } catch {
    throw new Error('Could not reach the Forge API.');
  }

  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`The Forge API answered ${response.status}.`);

  const parsed = viewerSchema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new Error('The Forge API returned an unexpected response.');
  return parsed.data;
}

/**
 * The seeded test identities, or `null` when development sign-in is unavailable (production,
 * refused, unreachable, malformed). `null` simply hides the switcher.
 */
export async function fetchDevIdentities(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<DevIdentity[] | null> {
  try {
    const response = await fetchImpl(`${baseUrl}/api/dev/identities`, { cache: 'no-store' });
    if (response.status !== 200) return null;
    const parsed = devIdentitySchema
      .array()
      .safeParse(await response.json().catch(() => undefined));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
