import { expect, test, type Page } from '@playwright/test';
import { hydrated, reseed, signInAs } from './helpers';

// P6: a project's ranked backlog, and estimating in points.

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

const rows = (page: Page) => page.getByRole('list', { name: /backlog, top first/ }).locator('li');
const keyOf = async (page: Page, index: number) =>
  ((await rows(page).nth(index).getAttribute('data-testid')) ?? '').replace('backlog-', '');

test('an editor moves a ticket to the top of the backlog, and it stays there', async ({ page }) => {
  await signInAs(page, 'developer');
  await page.goto('/w/acme/projects/WEB/backlog');
  await hydrated(page);
  await expect(page.getByRole('link', { name: 'Backlog' })).toHaveAttribute('aria-current', 'page');

  const last = await keyOf(page, (await rows(page).count()) - 1);
  await page.getByRole('button', { name: `Move ${last} to the top` }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `${last} moved to position 1` }),
  ).toBeAttached();
  expect(await keyOf(page, 0)).toBe(last);

  await page.reload();
  await hydrated(page);
  expect(await keyOf(page, 0)).toBe(last);
});

test('Alt+Down moves the focused ticket one place down', async ({ page }) => {
  await signInAs(page, 'developer');
  await page.goto('/w/acme/projects/WEB/backlog');
  await hydrated(page);
  const first = await keyOf(page, 0);
  const second = await keyOf(page, 1);

  await rows(page).nth(0).getByRole('link', { name: first }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(
    page.getByRole('status').filter({ hasText: `${first} moved to position 2` }),
  ).toBeAttached();
  expect(await keyOf(page, 0)).toBe(second);
  expect(await keyOf(page, 1)).toBe(first);
});

test('a read-only member sees the backlog without move controls', async ({ page }) => {
  await signInAs(page, 'readonly');
  await page.goto('/w/acme/projects/WEB/backlog');
  await hydrated(page);
  await expect(rows(page).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Move .* to the top$/ })).toHaveCount(0);
});

test('a project switched to points estimates tickets in points', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/w/acme/projects/WEB/settings');
  await hydrated(page);
  await page.getByRole('radio', { name: /^Points/ }).check();
  await expect(page.getByText('WEB now estimates in points.')).toBeVisible();

  await page.goto('/w/acme/tickets/WEB-2');
  await hydrated(page);
  const estimate = page.getByLabel('Estimate');
  await estimate.selectOption('5');
  await expect(page.getByText('5 pts').first()).toBeVisible();

  await page.goto('/w/acme/projects/WEB/backlog');
  await hydrated(page);
  await expect(page.getByTestId('backlog-WEB-2')).toContainText('5 pts');
});
