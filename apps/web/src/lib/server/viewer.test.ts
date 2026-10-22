import { describe, expect, it } from 'vitest';
import { fetchDevIdentities, fetchViewer } from './viewer';

const uuid = '01a1656b-1a49-7146-94ac-1c72df43ddb4';
const viewer = {
  user: { id: uuid, email: 'owner@acme.test', displayName: 'Olivia Owner' },
  memberships: [
    {
      organisation: { id: uuid, slug: 'acme', name: 'Acme Robotics' },
      role: { id: uuid, key: 'owner', name: 'Owner' },
      permissions: ['workspace.view'],
    },
  ],
  preferences: {},
};

const respond = (status: number, body: unknown) => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('fetchViewer', () => {
  it('returns the viewer for a valid 200', async () => {
    expect(await fetchViewer('http://api', 'forge_session=abc', respond(200, viewer))).toEqual(
      viewer,
    );
  });

  it('returns null when the API says the session is not valid', async () => {
    expect(await fetchViewer('http://api', 'forge_session=abc', respond(401, {}))).toBeNull();
  });

  it('returns null without calling the API when there is no cookie', async () => {
    let called = false;
    const result = await fetchViewer('http://api', '', async () => {
      called = true;
      return new Response('{}');
    });
    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it('forwards the cookie and never caches', async () => {
    let seen: { url: string; cookie: string | null; cache?: RequestCache } | undefined;
    await fetchViewer('http://api:4000', 'forge_session=abc; theme=dark', async (url, init) => {
      seen = {
        url,
        cookie: new Headers(init?.headers).get('cookie'),
        cache: init?.cache,
      };
      return new Response(JSON.stringify(viewer), { status: 200 });
    });
    expect(seen).toEqual({
      url: 'http://api:4000/api/v1/me',
      cookie: 'forge_session=abc; theme=dark',
      cache: 'no-store',
    });
  });

  it.each([
    ['a server error', respond(500, { error: { code: 'internal_error' } })],
    ['an invalid body', respond(200, { nope: true })],
    ['a non-JSON body', respond(200, '<html>')],
  ])('throws on %s instead of pretending nobody is signed in', async (_label, impl) => {
    await expect(fetchViewer('http://api', 'forge_session=abc', impl)).rejects.toThrow();
  });

  it('throws when the API cannot be reached', async () => {
    await expect(
      fetchViewer('http://api', 'forge_session=abc', async () => {
        throw new TypeError('fetch failed');
      }),
    ).rejects.toThrow(/reach/i);
  });
});

describe('fetchDevIdentities', () => {
  const identities = [
    {
      key: 'owner',
      label: 'Owner',
      description: 'Full control',
      email: 'owner@acme.test',
      displayName: 'Olivia Owner',
    },
  ];

  it('returns the list when development sign-in is on', async () => {
    expect(await fetchDevIdentities('http://api', respond(200, identities))).toEqual(identities);
  });

  it('returns null when the routes do not exist (production)', async () => {
    expect(await fetchDevIdentities('http://api', respond(404, {}))).toBeNull();
  });

  it('returns null when refused, unreachable or malformed, so the switcher simply stays hidden', async () => {
    expect(await fetchDevIdentities('http://api', respond(403, {}))).toBeNull();
    expect(await fetchDevIdentities('http://api', respond(200, { nope: 1 }))).toBeNull();
    expect(
      await fetchDevIdentities('http://api', async () => {
        throw new TypeError('fetch failed');
      }),
    ).toBeNull();
  });
});
