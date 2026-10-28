import { userPreferences } from '@forge/db';
import { apiErrorSchema, preferencesSchema, viewerSchema } from '@forge/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startIntegration, type Integration } from '../test-support/integration';

let ctx: Integration;

beforeAll(async () => {
  ctx = await startIntegration();
});

beforeEach(async () => {
  await ctx.reseed();
});

afterAll(async () => {
  await ctx.close();
});

const get = (cookie?: string) =>
  ctx.app.inject({
    method: 'GET',
    url: '/api/v1/me/preferences',
    headers: cookie ? { cookie } : {},
  });
const patch = (
  cookie: string | undefined,
  payload: unknown,
  headers: Record<string, string> = {},
) =>
  ctx.app.inject({
    method: 'PATCH',
    url: '/api/v1/me/preferences',
    payload: payload as object,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });

describe('/api/v1/me/preferences', () => {
  it('answers 401 when nobody is signed in', async () => {
    expect((await get()).statusCode).toBe(401);
    const response = await patch(undefined, { sidebarCollapsed: true });
    expect(response.statusCode).toBe(401);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe('unauthenticated');
  });

  it('starts empty', async () => {
    const response = await get(await ctx.cookieFor('owner'));
    expect(response.statusCode).toBe(200);
    expect(preferencesSchema.parse(response.json())).toEqual({});
  });

  it('stores a change and shows it in /me too', async () => {
    const cookie = await ctx.cookieFor('owner');
    const response = await patch(cookie, { sidebarCollapsed: true });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sidebarCollapsed: true });

    expect((await get(cookie)).json()).toEqual({ sidebarCollapsed: true });
    const me = await ctx.app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
    expect(viewerSchema.parse(me.json()).preferences).toEqual({ sidebarCollapsed: true });
  });

  it('merges: an empty patch keeps what was stored, and a later patch overrides it', async () => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { sidebarCollapsed: true });
    expect((await patch(cookie, {})).json()).toEqual({ sidebarCollapsed: true });
    expect((await patch(cookie, { sidebarCollapsed: false })).json()).toEqual({
      sidebarCollapsed: false,
    });
  });

  it.each([
    ['an unknown key', { theme: 'light' }],
    ['a wrong type', { sidebarCollapsed: 'yes' }],
    ['a nested object', { sidebarCollapsed: { deep: true } }],
    ['no body', undefined],
  ])('refuses %s with 422 and keeps the stored value', async (_label, payload) => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { sidebarCollapsed: true });
    const response = await patch(cookie, payload);
    expect(response.statusCode).toBe(422);
    expect((await get(cookie)).json()).toEqual({ sidebarCollapsed: true });
  });

  it("never mixes two people's preferences", async () => {
    const owner = await ctx.cookieFor('owner');
    const admin = await ctx.cookieFor('admin');
    await patch(owner, { sidebarCollapsed: true });
    expect((await get(admin)).json()).toEqual({});
    await patch(admin, { sidebarCollapsed: false });
    expect((await get(owner)).json()).toEqual({ sidebarCollapsed: true });
  });

  it('refuses a write from a foreign Origin', async () => {
    const cookie = await ctx.cookieFor('owner');
    const response = await patch(
      cookie,
      { sidebarCollapsed: true },
      { origin: 'http://evil.test' },
    );
    expect(response.statusCode).toBe(403);
    expect((await get(cookie)).json()).toEqual({});
  });
});

describe('board settings in /api/v1/me/preferences', () => {
  it('merges board changes made one after another', async () => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { board: { density: 'compact' } });
    const response = await patch(cookie, { board: { heat: false } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ board: { density: 'compact', heat: false } });
    expect((await get(cookie)).json()).toEqual({ board: { density: 'compact', heat: false } });
  });

  it('merges card fields, and a later value for the same field wins', async () => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { board: { fields: { labels: false } } });
    await patch(cookie, { board: { fields: { type: true } } });
    expect((await get(cookie)).json()).toEqual({
      board: { fields: { labels: false, type: true } },
    });
    await patch(cookie, { board: { fields: { labels: true } } });
    expect((await get(cookie)).json()).toEqual({ board: { fields: { labels: true, type: true } } });
  });

  it('leaves the sidebar setting alone, and the other way round', async () => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { sidebarCollapsed: true });
    await patch(cookie, { board: { heat: false } });
    expect((await get(cookie)).json()).toEqual({ sidebarCollapsed: true, board: { heat: false } });
    await patch(cookie, { sidebarCollapsed: false });
    expect((await get(cookie)).json()).toEqual({ sidebarCollapsed: false, board: { heat: false } });
  });

  // Each round starts from nothing saved. Only the settings are cleared, not the whole database:
  // a full reseed per round is slow enough under load to time the test out mid-round.
  it(
    'keeps every one of several changes that arrive at the same moment',
    { timeout: 30_000 },
    async () => {
      const fresh = await ctx.cookieFor('owner');
      for (let round = 0; round < 10; round += 1) {
        await ctx.db.delete(userPreferences);
        const responses = await Promise.all([
          patch(fresh, { board: { heat: false } }),
          patch(fresh, { board: { density: 'compact' } }),
          patch(fresh, { board: { fields: { comments: false } } }),
        ]);
        expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200]);
        expect((await get(fresh)).json(), `round ${round}`).toEqual({
          board: { heat: false, density: 'compact', fields: { comments: false } },
        });
      }
    },
  );

  it.each([
    ['an unknown key', { board: { colour: 'red' } }],
    ['an unknown card field', { board: { fields: { assignee: false } } }],
    ['a field that is not a boolean', { board: { fields: { labels: 'no' } } }],
    ['an unknown density', { board: { density: 'huge' } }],
    ['heat that is not a boolean', { board: { heat: 'yes' } }],
    ['a board that is not an object', { board: 'compact' }],
  ])('refuses %s with 422 and keeps what was stored', async (_label, payload) => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { board: { density: 'compact' } });
    const response = await patch(cookie, payload);
    expect(response.statusCode).toBe(422);
    expect((await get(cookie)).json()).toEqual({ board: { density: 'compact' } });
  });

  it('lets a read-only member save their own settings', async () => {
    const cookie = await ctx.cookieFor('readonly');
    const response = await patch(cookie, { board: { heat: false } });
    expect(response.statusCode).toBe(200);
    expect((await get(cookie)).json()).toEqual({ board: { heat: false } });
  });

  it("never mixes two people's settings", async () => {
    const owner = await ctx.cookieFor('owner');
    const admin = await ctx.cookieFor('admin');
    await patch(owner, { board: { density: 'compact' } });
    expect((await get(admin)).json()).toEqual({});
    await patch(admin, { board: { heat: false } });
    expect((await get(owner)).json()).toEqual({ board: { density: 'compact' } });
  });
});

describe('the Tickets board columns in /api/v1/me/preferences', () => {
  const choice = { hidden: ['blocked'], order: ['open'] };
  const web = { hidden: ['cancelled'], order: [] };

  it('saves the choice and replaces it as a whole', async () => {
    const cookie = await ctx.cookieFor('owner');
    const saved = await patch(cookie, { ticketsBoardColumns: choice });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ ticketsBoardColumns: choice });
    await patch(cookie, { ticketsBoardColumns: { hidden: [], order: ['done'] } });
    expect((await get(cookie)).json()).toEqual({
      ticketsBoardColumns: { hidden: [], order: ['done'] },
    });
  });

  it('forgets it with null', async () => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { ticketsBoardColumns: choice, sidebarCollapsed: true });
    await patch(cookie, { ticketsBoardColumns: null });
    expect((await get(cookie)).json()).toEqual({ sidebarCollapsed: true });
  });

  it('stores nothing for a null first save', async () => {
    const cookie = await ctx.cookieFor('owner');
    const response = await patch(cookie, { ticketsBoardColumns: null });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({});
  });

  it('is kept apart from project boards and the display settings, both ways', async () => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { boardColumns: { WEB: web }, board: { heat: false } });
    await patch(cookie, { ticketsBoardColumns: choice });
    await patch(cookie, { boardColumns: { API: web } });
    expect((await get(cookie)).json()).toEqual({
      board: { heat: false },
      boardColumns: { WEB: web, API: web },
      ticketsBoardColumns: choice,
    });
  });

  it('refuses a bad choice with 422', async () => {
    const cookie = await ctx.cookieFor('owner');
    const response = await patch(cookie, { ticketsBoardColumns: { hidden: ['Bad Key'] } });
    expect(response.statusCode).toBe(422);
  });
});

describe('board columns in /api/v1/me/preferences', () => {
  const web = { hidden: ['cancelled'], order: ['open', 'backlog'] };
  const api = { hidden: [], order: ['in_progress'] };

  it('remembers a project and keeps the others when another changes', async () => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { boardColumns: { WEB: web } });
    const response = await patch(cookie, { boardColumns: { API: api } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ boardColumns: { WEB: web, API: api } });
    expect((await get(cookie)).json()).toEqual({ boardColumns: { WEB: web, API: api } });
  });

  it("replaces one project's choice as a whole", async () => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { boardColumns: { WEB: web } });
    await patch(cookie, { boardColumns: { WEB: { hidden: [], order: [] } } });
    expect((await get(cookie)).json()).toEqual({
      boardColumns: { WEB: { hidden: [], order: [] } },
    });
  });

  it("forgets a project's choice with null, and keeps the rest", async () => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { boardColumns: { WEB: web, API: api } });
    await patch(cookie, { boardColumns: { WEB: null } });
    expect((await get(cookie)).json()).toEqual({ boardColumns: { API: api } });
  });

  it('never stores a null, even for a person who has saved nothing yet', async () => {
    const cookie = await ctx.cookieFor('owner');
    const response = await patch(cookie, { boardColumns: { WEB: null, API: api } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ boardColumns: { API: api } });
  });

  it('keeps board display and columns apart from each other and from the sidebar', async () => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { sidebarCollapsed: true, board: { heat: false } });
    await patch(cookie, { boardColumns: { WEB: web } });
    await patch(cookie, { board: { density: 'compact' } });
    expect((await get(cookie)).json()).toEqual({
      sidebarCollapsed: true,
      board: { heat: false, density: 'compact' },
      boardColumns: { WEB: web },
    });
  });

  it(
    'keeps the choices for different projects that are saved at the same moment',
    { timeout: 30_000 },
    async () => {
      const cookie = await ctx.cookieFor('owner');
      for (let round = 0; round < 10; round += 1) {
        await ctx.db.delete(userPreferences);
        const responses = await Promise.all([
          patch(cookie, { boardColumns: { WEB: web } }),
          patch(cookie, { boardColumns: { API: api } }),
          patch(cookie, { boardColumns: { OPS: { hidden: ['blocked'], order: [] } } }),
        ]);
        expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200]);
        expect((await get(cookie)).json(), `round ${round}`).toEqual({
          boardColumns: { WEB: web, API: api, OPS: { hidden: ['blocked'], order: [] } },
        });
      }
    },
  );

  it.each([
    ['a lower-case project key', { boardColumns: { web } }],
    [
      '21 hidden statuses',
      {
        boardColumns: { WEB: { hidden: Array.from({ length: 21 }, (_, i) => `s${i}`), order: [] } },
      },
    ],
    ['an unknown field', { boardColumns: { WEB: { hidden: [], order: [], pinned: [] } } }],
    ['a status key with capitals', { boardColumns: { WEB: { hidden: ['Cancelled'], order: [] } } }],
    ['a list that is not a list', { boardColumns: { WEB: { hidden: 'cancelled', order: [] } } }],
  ])('refuses %s with 422 and keeps what was stored', async (_label, payload) => {
    const cookie = await ctx.cookieFor('owner');
    await patch(cookie, { boardColumns: { WEB: web } });
    const response = await patch(cookie, payload);
    expect(response.statusCode).toBe(422);
    expect((await get(cookie)).json()).toEqual({ boardColumns: { WEB: web } });
  });

  it('refuses a change that would remember more than 100 projects in all', async () => {
    const cookie = await ctx.cookieFor('owner');
    const batch = (from: number) =>
      Object.fromEntries(
        Array.from({ length: 60 }, (_, i) => [`K${from + i}`, { hidden: [], order: [] }]),
      );
    expect((await patch(cookie, { boardColumns: batch(0) })).statusCode).toBe(200);
    const response = await patch(cookie, { boardColumns: batch(60) });
    expect(response.statusCode).toBe(422);
    // Nothing of the refused change was kept.
    expect(Object.keys((await get(cookie)).json().boardColumns)).toHaveLength(60);
    // Replacing remembered projects, or forgetting some, still works at the cap.
    const forget = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`K${i}`, null]));
    expect((await patch(cookie, { boardColumns: forget })).statusCode).toBe(200);
    expect((await patch(cookie, { boardColumns: batch(60) })).statusCode).toBe(200);
  });

  it('still saves other settings for someone already over the cap from before it held', async () => {
    const cookie = await ctx.cookieFor('owner');
    expect((await patch(cookie, { sidebarCollapsed: false })).statusCode).toBe(200);
    const tooMany = Object.fromEntries(
      Array.from({ length: 150 }, (_, i) => [`K${i}`, { hidden: [], order: [] }]),
    );
    await ctx.db
      .update(userPreferences)
      .set({ data: { sidebarCollapsed: false, boardColumns: tooMany } });
    expect((await patch(cookie, { sidebarCollapsed: true })).statusCode).toBe(200);
    expect((await patch(cookie, { boardColumns: { K0: null } })).statusCode).toBe(200);
    expect(
      (await patch(cookie, { boardColumns: { NEW: { hidden: [], order: [] } } })).statusCode,
    ).toBe(422);
  });

  it('refuses more than 100 projects', async () => {
    const cookie = await ctx.cookieFor('owner');
    const many = Object.fromEntries(
      Array.from({ length: 101 }, (_, i) => [`K${i}`, { hidden: [], order: [] }]),
    );
    expect((await patch(cookie, { boardColumns: many })).statusCode).toBe(422);
    expect((await get(cookie)).json()).toEqual({});
  });

  it('does not let one person see or change another', async () => {
    const owner = await ctx.cookieFor('owner');
    const admin = await ctx.cookieFor('admin');
    await patch(owner, { boardColumns: { WEB: web } });
    expect((await get(admin)).json()).toEqual({});
    await patch(admin, { boardColumns: { WEB: api } });
    expect((await get(owner)).json()).toEqual({ boardColumns: { WEB: web } });
  });
});
