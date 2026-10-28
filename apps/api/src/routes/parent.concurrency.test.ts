import { tickets } from '@forge/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFacts } from '../test-support/facts';
import { startIntegration, type Integration } from '../test-support/integration';

let ctx: Integration;

beforeAll(async () => {
  ctx = await startIntegration();
});

afterAll(async () => {
  await ctx.close();
});

describe('two people setting parents at the same moment', () => {
  it('never makes a loop: A under B and B under A, sent together, lets exactly one through', async () => {
    await ctx.reseed();
    const f = await loadFacts(ctx.db);
    const developer = await ctx.cookieFor('developer');
    const admin = await ctx.cookieFor('admin');
    const put = (cookie: string, key: string, parentKey: string | null) =>
      ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/orgs/${f.acmeId}/tickets/${key}/parent`,
        headers: { cookie },
        payload: { parentKey },
      });

    for (let round = 0; round < 10; round += 1) {
      const [first, second] = await Promise.all([
        put(developer, 'WEB-6', 'WEB-7'),
        put(admin, 'WEB-7', 'WEB-6'),
      ]);
      expect([first.statusCode, second.statusCode].sort()).toEqual([200, 422]);

      const rows = await ctx.db
        .select({ id: tickets.id, parentId: tickets.parentId })
        .from(tickets)
        .where(eq(tickets.organisationId, f.acmeId));
      const six = rows.find((r) => r.id === f.ticket('WEB-6').id)!;
      const seven = rows.find((r) => r.id === f.ticket('WEB-7').id)!;
      expect(six.parentId === seven.id && seven.parentId === six.id).toBe(false);

      // Start the next round from two top-level tickets.
      expect((await put(developer, 'WEB-6', null)).statusCode).toBe(200);
      expect((await put(developer, 'WEB-7', null)).statusCode).toBe(200);
    }
  });
});
