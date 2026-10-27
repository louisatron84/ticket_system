import { expect, test, type Page } from '@playwright/test';
import { hydrated, reseed, signInAs } from './helpers';

// Wide enough for all six shown columns, so a card can be dragged to any of them.
test.use({ viewport: { width: 1920, height: 1000 } });

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

const column = (page: Page, name: string) => page.locator(`section[aria-label^="${name},"]`);
const card = (page: Page, key: string) => page.locator(`li[data-ticket="${key}"]`);
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Ticket views' });

async function openTicketsBoard(page: Page, query = '') {
  await page.goto(`/w/acme/tickets/board${query}`);
  await expect(page.getByRole('heading', { name: 'Tickets', level: 1 })).toBeVisible();
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

const savedPreferences = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/me/preferences') && response.request().method() === 'PATCH',
  );

async function hideColumn(page: Page, name: string) {
  await page.getByRole('button', { name: 'Display', exact: true }).click();
  await Promise.all([
    savedPreferences(page),
    page.getByRole('switch', { name: `Show ${name}` }).click(),
  ]);
  await page.keyboard.press('Escape');
}

test.describe('the Tickets page', () => {
  test('has Board and List tabs, and filters travel between them', async ({ page }) => {
    await signInAs(page, 'owner');
    await page.goto('/w/acme/tickets?priority=high');
    await hydrated(page);
    await expect(tabs(page).getByRole('link', { name: 'List' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await tabs(page).getByRole('link', { name: 'Board' }).click();
    await expect(page).toHaveURL(/\/w\/acme\/tickets\/board\?priority=high$/);
    await expect(tabs(page).getByRole('link', { name: 'Board' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('button', { name: 'Remove filter Priority: Blaze' })).toBeVisible();

    await tabs(page).getByRole('link', { name: 'List' }).click();
    await expect(page).toHaveURL(/\/w\/acme\/tickets\?priority=high$/);
  });

  test('the board holds every project’s tickets, by status', async ({ page }) => {
    await signInAs(page, 'owner');
    await openTicketsBoard(page);

    const expected: [string, string][] = [
      ['Cold Steel', 'Cold Steel, 4 tickets'],
      ['Warming', 'Warming, 5 tickets'],
      ['In the Forge', 'In the Forge, 3 tickets'],
      ['Tempering', 'Tempering, 2 tickets'],
      ['Jammed', 'Jammed, 2 tickets'],
      ['Quenched', 'Quenched, 3 tickets'],
    ];
    for (const [name, label] of expected) {
      await expect(column(page, name)).toHaveAttribute('aria-label', label);
    }
    await expect(column(page, 'Warming').locator('li[data-ticket^="WEB-"]')).toHaveCount(3);
    await expect(column(page, 'Warming').locator('li[data-ticket="API-4"]')).toBeVisible();

    // The page uses the full width, like a project's board, so every column is on screen.
    const rights = await page.evaluate(() =>
      Array.from(document.querySelectorAll('section[data-heat]')).map(
        (section) => section.getBoundingClientRect().right,
      ),
    );
    expect(Math.max(...rights)).toBeLessThanOrEqual(1920);
  });

  test('a card from another project moves under its own workflow and stays moved', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openTicketsBoard(page);

    await dragCard(page, 'API-4', 'In the Forge');
    await expect(column(page, 'In the Forge').locator('li[data-ticket="API-4"]')).toBeVisible();
    await expect(column(page, 'In the Forge')).toHaveAttribute(
      'aria-label',
      'In the Forge, 4 tickets',
    );

    await page.reload();
    await expect(column(page, 'In the Forge').locator('li[data-ticket="API-4"]')).toBeVisible();
    await page.goto('/w/acme/tickets/API-4');
    await expect(page.getByLabel('Status').locator('option:checked')).toHaveText('In the Forge');
  });

  test('a move its project does not allow is refused with a reason', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicketsBoard(page);

    await dragCard(page, 'API-2', 'Cold Steel'); // Quenched can only reopen to Warming
    await expect(page.getByText('API-2 cannot move from Quenched to Cold Steel.')).toBeVisible();
    await expect(column(page, 'Quenched').locator('li[data-ticket="API-2"]')).toBeVisible();
    await expect(column(page, 'Cold Steel')).toHaveAttribute('aria-label', 'Cold Steel, 4 tickets');
  });

  test('column choices on the Tickets board are its own', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicketsBoard(page);
    await hideColumn(page, 'Jammed');
    await expect(column(page, 'Jammed')).toHaveCount(0);

    await page.goto('/w/acme/projects/WEB/board');
    await hydrated(page);
    await expect(column(page, 'Jammed')).toBeVisible();
    await hideColumn(page, 'Tempering');
    await expect(column(page, 'Tempering')).toHaveCount(0);

    await openTicketsBoard(page);
    await expect(column(page, 'Tempering')).toBeVisible();
    await expect(column(page, 'Jammed')).toHaveCount(0);
  });

  test('a saved board view without a project opens the Tickets board', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicketsBoard(page, '?priority=high');
    await page.getByRole('button', { name: 'Views' }).click();
    await page.getByRole('button', { name: 'Save current view' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('Hot board');
    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByText('Saved “Hot board”.')).toBeVisible();

    await page.goto('/w/acme/tickets');
    await hydrated(page);
    await page.getByRole('button', { name: 'Views' }).click();
    await page.getByRole('link', { name: 'Hot board' }).click();
    await expect(page).toHaveURL(/\/w\/acme\/tickets\/board\?priority=high$/);
    await expect(column(page, 'Warming')).toBeVisible();
  });

  test('with no project to show, it says so instead of blaming hidden columns', async ({
    page,
  }) => {
    await signInAs(page, 'owner');
    await openTicketsBoard(page, '?project=ZZZ');
    await expect(
      page.getByText(
        'No project’s statuses to show. Create a project, or clear the Project filter.',
      ),
    ).toBeVisible();
    await expect(page.getByText('Every column is hidden.')).toHaveCount(0);
  });

  test('a read-only member can look but has nothing to grab', async ({ page }) => {
    await signInAs(page, 'readonly');
    await openTicketsBoard(page);
    await expect(card(page, 'API-4')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Pick up / })).toHaveCount(0);
  });
});

test.describe('quick create on the Tickets board', () => {
  const addButton = (page: Page, name: string) =>
    page.getByRole('button', { name: `Add a ticket to ${name}` });

  test('with one project in the filter, the ticket goes to that project', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicketsBoard(page, '?project=API');

    await addButton(page, 'Warming').click();
    await expect(page.getByLabel('Project for the new ticket')).toHaveValue('API');
    await page.getByLabel('New ticket title').fill('Rate limit the login route');
    await page.keyboard.press('Enter');

    await expect(column(page, 'Warming').locator('li[data-ticket="API-9"]')).toContainText(
      'Rate limit the login route',
    );
    await page.reload();
    await expect(column(page, 'Warming').locator('li[data-ticket="API-9"]')).toBeVisible();
  });

  test('with no filter, the person picks the project, and must', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicketsBoard(page);

    await addButton(page, 'Warming').click();
    await expect(page.getByLabel('Project for the new ticket')).toHaveValue('');
    await page.getByLabel('New ticket title').fill('Rate limit the login route');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Choose a project.')).toBeVisible();
    await expect(column(page, 'Warming').locator('li[data-ticket="API-9"]')).toHaveCount(0);

    await page.getByLabel('Project for the new ticket').selectOption('API');
    await page.getByLabel('New ticket title').press('Enter');
    await expect(column(page, 'Warming').locator('li[data-ticket="API-9"]')).toBeVisible();
    await expect(column(page, 'Warming')).toHaveAttribute('aria-label', 'Warming, 6 tickets');
  });

  test('a read-only member gets no plus and only the copies in a card’s menu', async ({ page }) => {
    await signInAs(page, 'readonly');
    await openTicketsBoard(page);
    await expect(card(page, 'API-4')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Add a ticket to / })).toHaveCount(0);

    await page.getByRole('button', { name: 'Actions for API-4' }).click();
    await expect(page.getByRole('group', { name: 'API-4 actions' }).getByRole('button')).toHaveText(
      ['Copy key', 'Copy link'],
    );
  });
});
