import type { ZodType } from 'zod';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { fetchDevIdentities, fetchViewer } from './viewer';

export const apiBaseUrl = () => process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

async function cookieHeader(): Promise<string> {
  const store = await cookies();
  return store
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join('; ');
}

// `cache` shares one lookup between the layout and the page within a single request.
export const getViewer = cache(async () => fetchViewer(apiBaseUrl(), await cookieHeader()));
export const getDevIdentities = cache(() => fetchDevIdentities(apiBaseUrl()));

export type ServerGet<T> = { ok: true; data: T } | { ok: false; status: number };

/**
 * GET an API resource on behalf of the signed-in person. 4xx answers come back as `ok: false` so
 * a page can show "no access" or not-found; outages and bad responses throw to the error page.
 */
export async function serverGet<T>(path: string, schema: ZodType<T>): Promise<ServerGet<T>> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      headers: { cookie: await cookieHeader() },
      cache: 'no-store',
    });
  } catch {
    throw new Error('Could not reach the Forge API.');
  }

  if (response.status >= 400 && response.status < 500)
    return { ok: false, status: response.status };
  if (!response.ok) throw new Error(`The Forge API answered ${response.status}.`);

  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new Error('The Forge API returned an unexpected response.');
  return { ok: true, data: parsed.data };
}
