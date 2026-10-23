import { expect, test, type Page } from '@playwright/test';
import { hydrated, reseed, signInAs, switchTo, viewerOf } from './helpers';

// Wide enough to show most of the seven columns at once, so a card can be dragged to any of them.
test.use({ viewport: { width: 1920, height: 1000 } });

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

const column = (page: Page, name: string) => page.locator(`section[aria-label^="${name},"]`);
const card = (page: Page, key: string) => page.locator(`li[data-ticket="${key}"]`);

async function openBoard(page: Page) {
  await page.goto('/w/acme/projects/WEB/board');
  await expect(page.getByRole('heading', { name: 'Web App', level: 1 })).toBeVisible();
  await hydrated(page);
}

/** Picks a card up by its grip with the mouse, carries it over a column and lets go. */
async function dragCard(page: Page, key: string, toColumn: string) {
  const grip = page.getByRole('button', { name: `Pick up ${key} to move it` });
  const from = (await grip.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  const target = (await column(page, toColumn).boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + 100, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test.describe('the board', () => {
  test('has a column for every status, with the seeded counts', async ({ page }) => {
    await signInAs(page, 'owner');
    await openBoard(page);

    const expected: [string, string][] = [
      ['Backlog', 'Backlog, 2 tickets'],
      ['Open', 'Open, 3 tickets'],
      ['In Progress', 'In Progress, 2 tickets'],
      ['In Review', 'In Review, 1 ticket'],
      ['Blocked', 'Blocked, 1 ticket'],
      ['Done', 'Done, 2 tickets'],
      ['Cancelled', 'Cancelled, 1 ticket'],
    ];
    for (const [name, label] of expected) {
      await expect(column(page, name)).toHaveAttribute('aria-label', label);
    }
    await expect(card(page, 'WEB-3')).toContainText('Checkout page is slow on mobile');
  });

  test('a card dragged to another column stays there after a reload', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await expect(column(page, 'In Review').locator('li[data-ticket="WEB-3"]')).toBeVisible();

    await dragCard(page, 'WEB-3', 'Blocked');
    await expect(column(page, 'Blocked').locator('li[data-ticket="WEB-3"]')).toBeVisible();
    await expect(column(page, 'Blocked')).toHaveAttribute('aria-label', 'Blocked, 2 tickets');
    await expect(column(page, 'In Review')).toHaveAttribute('aria-label', 'In Review, 0 tickets');

    await page.reload();
    await expect(column(page, 'Blocked').locator('li[data-ticket="WEB-3"]')).toBeVisible();

    // The ticket itself agrees, and its history says who moved it.
    await page.goto('/w/acme/tickets/WEB-3');
    await expect(page.getByLabel('Status').locator('option:checked')).toHaveText('Blocked');
    await expect(page.getByRole('region', { name: 'Activity' })).toContainText(
      'moved this from In Review to Blocked',
    );
  });

  test('a card can be moved with the keyboard alone', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await expect(column(page, 'In Progress').locator('li[data-ticket="WEB-1"]')).toBeVisible();

    // What a screen reader is told, step by step. Waiting for each announcement also gives the
    // drag time to get ready, which a person's pace does and a script's does not.
    const announcement = page.locator('[id^="DndLiveRegion"]');

    await page.getByRole('button', { name: 'Pick up WEB-1 to move it' }).focus();
    await page.keyboard.press('Space');
    await expect(announcement).toHaveText('WEB-1 is over In Progress.');
    // The next column to the right that will take it is In Review.
    await page.keyboard.press('ArrowRight');
    await expect(announcement).toHaveText('WEB-1 is over In Review.');
    await page.keyboard.press('Space');
    await expect(announcement).toHaveText('WEB-1 dropped on In Review.');

    await expect(column(page, 'In Review').locator('li[data-ticket="WEB-1"]')).toBeVisible();
    await page.reload();
    await expect(column(page, 'In Review').locator('li[data-ticket="WEB-1"]')).toBeVisible();
  });

  test('"Move to" does the same without dragging, offering only allowed statuses', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    await page.getByRole('button', { name: 'Move WEB-2 to another status' }).click();
    const menu = page.getByRole('group', { name: 'Move WEB-2 to' });
    await expect(menu.getByRole('button')).toHaveText([
      'Backlog',
      'In Progress',
      'Blocked',
      'Cancelled',
    ]);
    await menu.getByRole('button', { name: 'In Progress' }).click();

    await expect(column(page, 'In Progress').locator('li[data-ticket="WEB-2"]')).toBeVisible();
  });

  test('a move the workflow does not allow is refused with a reason, and the card stays', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    await dragCard(page, 'WEB-3', 'Backlog'); // In Review cannot go straight to Backlog
    await expect(page.getByText('WEB-3 cannot move from In Review to Backlog.')).toBeVisible();
    await expect(column(page, 'In Review').locator('li[data-ticket="WEB-3"]')).toBeVisible();
    await expect(column(page, 'Backlog')).toHaveAttribute('aria-label', 'Backlog, 2 tickets');

    await page.reload();
    await expect(column(page, 'In Review').locator('li[data-ticket="WEB-3"]')).toBeVisible();
  });

  test('a card someone else already moved is put right instead of being overwritten', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    // Someone else moves WEB-3 first, behind this page's back.
    const viewer = await viewerOf(page);
    const acme = viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
    const project = await (await page.request.get(`/api/v1/orgs/${acme}/projects/WEB`)).json();
    const blocked = project.statuses.find((s: { key: string }) => s.key === 'blocked').id;
    const ticket = await (await page.request.get(`/api/v1/orgs/${acme}/tickets/WEB-3`)).json();
    const moved = await page.request.patch(`/api/v1/orgs/${acme}/tickets/WEB-3`, {
      data: { version: ticket.version, statusId: blocked },
    });
    expect(moved.status()).toBe(200);

    // This page still shows it in In Review, and the drag uses that old version.
    await dragCard(page, 'WEB-3', 'In Progress');
    await expect(page.getByText(/changed by someone else/)).toBeVisible();
    await expect(column(page, 'Blocked').locator('li[data-ticket="WEB-3"]')).toBeVisible();
    await expect(column(page, 'In Progress').locator('li[data-ticket="WEB-3"]')).toHaveCount(0);
  });

  test('a read-only member can look but has nothing to grab', async ({ page }) => {
    await signInAs(page, 'readonly');
    await openBoard(page);

    await expect(card(page, 'WEB-3')).toBeVisible();
    await expect(page.getByRole('button', { name: /Pick up/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /to another status/ })).toHaveCount(0);
  });

  test('a filter narrows every column, and the status columns do not change', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/projects/WEB/board?assignee=me&label=bug');
    await hydrated(page);

    await expect(card(page, 'WEB-1')).toBeVisible();
    await expect(card(page, 'WEB-7')).toBeVisible();
    await expect(card(page, 'WEB-2')).toHaveCount(0);
    await expect(column(page, 'Backlog')).toHaveAttribute('aria-label', 'Backlog, 0 tickets');
    await expect(page.getByRole('button', { name: 'Remove filter Assignee: Me' })).toBeVisible();
  });

  test('switching identity never shows the previous identity’s tickets on Back', async ({
    page,
  }) => {
    await signInAs(page, 'owner');
    await openBoard(page);
    await expect(card(page, 'WEB-3')).toBeVisible();

    await switchTo(page, 'other-owner');
    await page.goBack();

    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByText('WEB-3')).toHaveCount(0);
    await expect(page.getByText('Checkout page')).toHaveCount(0);
  });
});
