import { expect, test, type Locator, type Page } from '@playwright/test';
import { hydrated, reseed, signInAs, viewerOf } from './helpers';

// The demo data: WEB-5 is an epic over WEB-8, WEB-11 and WEB-12 (Quenched); WEB-10 is a sub-task
// of WEB-8; API-3 blocks WEB-7.

test.use({ viewport: { width: 1920, height: 1100 } });

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

const card = (page: Page | Locator, key: string) => page.locator(`li[data-ticket="${key}"]`);
const column = (scope: Page | Locator, name: string) =>
  scope.locator(`section[aria-label^="${name},"]`);
const lane = (page: Page, key: string) => page.locator(`section[aria-label^="${key} lane,"]`);

const saved = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/me/preferences') && response.request().method() === 'PATCH',
  );

async function openBoard(page: Page, path = '/w/acme/projects/WEB/board') {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await hydrated(page);
}

async function choose(page: Page, group: string, option: string) {
  await page.getByRole('button', { name: 'Display', exact: true }).click();
  await Promise.all([
    saved(page),
    page.getByRole('radiogroup', { name: group }).getByText(option, { exact: true }).click(),
  ]);
  await page.keyboard.press('Escape');
}

/** Picks a card up by its grip with the mouse, carries it over a column and lets go. */
async function dragCard(page: Page, key: string, target: Locator) {
  const grip = page.getByRole('button', { name: `Pick up ${key} to move it` });
  const from = (await grip.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(100, box.height / 2), {
    steps: 12,
  });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test.describe('the board shows structure', () => {
  test('a parent card shows its progress and a child card its parent', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await expect(card(page, 'WEB-5')).toContainText('1/4');
    await expect(card(page, 'WEB-5').getByRole('img', { name: '1 of 4 quenched' })).toBeVisible();
    await expect(card(page, 'WEB-8')).toContainText('Part of WEB-5');
    await expect(card(page, 'WEB-1')).not.toContainText('Part of');
  });

  test('a blocked card shows what blocks it', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await expect(card(page, 'WEB-7')).toContainText('Blocked by API-3');
    await expect(card(page, 'WEB-3')).not.toContainText('Blocked by');
  });

  test('top level only hides child cards and is remembered', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await expect(column(page, 'Warming')).toHaveAttribute('aria-label', 'Warming, 3 tickets');

    await choose(page, 'Show', 'Top level only');
    for (const child of ['WEB-8', 'WEB-10', 'WEB-11', 'WEB-12']) {
      await expect(card(page, child)).toHaveCount(0);
    }
    await expect(card(page, 'WEB-5')).toBeVisible();
    // WEB-8 and WEB-11 were two of Warming's three.
    await expect(column(page, 'Warming')).toHaveAttribute('aria-label', 'Warming, 1 ticket');

    await page.reload();
    await hydrated(page);
    await expect(card(page, 'WEB-8')).toHaveCount(0);

    await choose(page, 'Show', 'All tickets');
    await expect(card(page, 'WEB-8')).toBeVisible();
  });

  test('the Tickets board can show a lane per project, each with its count, and fold one away', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page, '/w/acme/tickets/board');
    // A project's board has no lanes to offer.
    await expect(lane(page, 'WEB')).toHaveCount(0);

    await choose(page, 'Lanes', 'Per project');
    await expect(lane(page, 'API')).toHaveAttribute('aria-label', 'API lane, 8 tickets');
    // Scrapped is hidden, so WEB-9 is not counted.
    await expect(lane(page, 'WEB')).toHaveAttribute('aria-label', 'WEB lane, 11 tickets');
    await expect(card(lane(page, 'API'), 'API-3')).toBeVisible();
    await expect(card(lane(page, 'API'), 'WEB-3')).toHaveCount(0);
    await expect(column(lane(page, 'WEB'), 'Jammed')).toHaveAttribute(
      'aria-label',
      'Jammed, 1 ticket',
    );

    await lane(page, 'WEB').getByRole('button', { expanded: true }).click();
    await expect(card(page, 'WEB-3')).toHaveCount(0);
    await expect(card(page, 'API-3')).toBeVisible();
    await lane(page, 'WEB').getByRole('button', { expanded: false }).click();
    await expect(card(page, 'WEB-3')).toBeVisible();

    await page.goto('/w/acme/projects/WEB/board');
    await hydrated(page);
    await expect(lane(page, 'WEB')).toHaveCount(0);
  });
});

test.describe('moving on a board with structure', () => {
  test('dragging a blocked card to Quenched is refused with the reason, and the card returns', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    const viewer = await viewerOf(page);
    const acme = viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
    const posted = await page.request.post(`/api/v1/orgs/${acme}/tickets/WEB-1/links`, {
      data: { choice: 'blocked_by', otherKey: 'API-4' },
    });
    expect(posted.status()).toBe(201);

    await openBoard(page);
    await expect(card(page, 'WEB-1')).toContainText('Blocked by API-4');
    await dragCard(page, 'WEB-1', column(page, 'Quenched'));
    await expect(page.getByText("WEB-1 can't be quenched while API-4 is open.")).toBeVisible();
    await expect(card(column(page, 'In the Forge'), 'WEB-1')).toBeVisible();
  });

  test('a card cannot be dropped into another project’s lane', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page, '/w/acme/tickets/board');
    await choose(page, 'Lanes', 'Per project');

    await dragCard(page, 'WEB-1', column(lane(page, 'API'), 'Tempering'));
    await expect(
      page.getByText("WEB-1 belongs to WEB, so it stays in that project's lane."),
    ).toBeVisible();
    await expect(card(column(lane(page, 'WEB'), 'In the Forge'), 'WEB-1')).toBeVisible();

    // Within its own lane it moves as usual.
    await dragCard(page, 'WEB-1', column(lane(page, 'WEB'), 'Tempering'));
    await expect(card(column(lane(page, 'WEB'), 'Tempering'), 'WEB-1')).toBeVisible();
  });
});

test('top level only counts every top-level ticket of a column, beyond the cards loaded', async ({
  page,
}) => {
  await signInAs(page, 'developer');
  const viewer = await viewerOf(page);
  const acme = viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
  const project = (await (await page.request.get(`/api/v1/orgs/${acme}/projects/WEB`)).json()) as {
    statuses: { id: string; key: string }[];
  };
  const config = (await (await page.request.get(`/api/v1/orgs/${acme}/ticket-config`)).json()) as {
    types: { id: string; key: string }[];
    priorities: { id: string; key: string }[];
  };
  const body = {
    typeId: config.types.find((t) => t.key === 'task')!.id,
    priorityId: config.priorities.find((p) => p.key === 'normal')!.id,
    statusId: project.statuses.find((s) => s.key === 'open')!.id,
  };
  // More children in Warming than a column loads, so the loaded cards are nearly all children.
  for (let i = 0; i < 55; i += 1) {
    const made = await page.request.post(`/api/v1/orgs/${acme}/tickets/WEB-5/children`, {
      data: { ...body, title: `Part ${i}` },
    });
    expect(made.status()).toBe(201);
  }

  await openBoard(page);
  await choose(page, 'Show', 'Top level only');
  // WEB-2 is the only top-level ticket in Warming.
  await expect(column(page, 'Warming')).toHaveAttribute('aria-label', 'Warming, 1 ticket');
  await expect(card(column(page, 'Warming'), 'WEB-2')).toBeVisible();
});
