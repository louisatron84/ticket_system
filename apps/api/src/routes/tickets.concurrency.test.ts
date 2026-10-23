import { ticketDetailSchema } from '@forge/shared';
import { tickets } from '@forge/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts, ticketRow } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';

let ctx: Integration;

beforeAll(async () => {
  ctx = await startIntegration();
});

afterAll(async () => {
  await ctx.close();
});

describe('tickets created at the same moment', () => {
  it('get distinct, consecutive numbers', async () => {
    await ctx.reseed();
    const f = await loadFacts(ctx.db);
    const owner = await ctx.cookieFor('owner');

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        ctx.app.inject({
          method: 'POST',
          url: `/api/v1/orgs/${f.acmeId}/projects/WEB/tickets`,
          headers: { cookie: owner },
          payload: {
            title: `Parallel ${i}`,
            typeId: f.typeId('acme', 'task'),
            priorityId: f.priorityId('acme', 'normal'),
          },
        }),
      ),
    );

    expect(responses.map((r) => r.statusCode)).toEqual(Array(20).fill(201));
    const numbers = responses
      .map((r) => Number(ticketDetailSchema.parse(r.json()).key.split('-')[1]))
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => 13 + i));
  });
});

describe('two people saving the same ticket at the same moment', () => {
  it('lets exactly one win, every time', async () => {
    await ctx.reseed();
    const f = await loadFacts(ctx.db);
    const owner = await ctx.cookieFor('owner');
    const admin = await ctx.cookieFor('admin');

    for (let round = 0; round < 10; round += 1) {
      const current = (await ticketRow(ctx.db, 'WEB-4'))!;
      const save = (cookie: string, title: string) =>
        ctx.app.inject({
          method: 'PATCH',
          url: `/api/v1/orgs/${f.acmeId}/tickets/WEB-4`,
          headers: { cookie },
          payload: { version: current.version, title },
        });

      const [a, b] = await Promise.all([
        save(owner, `Owner ${round}`),
        save(admin, `Admin ${round}`),
      ]);
      expect([a.statusCode, b.statusCode].sort(), `round ${round}`).toEqual([200, 409]);

      const after = (await ctx.db.select().from(tickets).where(eq(tickets.key, 'WEB-4')))[0]!;
      expect(after.version, `round ${round}`).toBe(current.version + 1);
      const winner = a.statusCode === 200 ? `Owner ${round}` : `Admin ${round}`;
      expect(after.title).toBe(winner);
    }
  });
});
