import { expect, test } from '@playwright/test';
import { hydrated, keyboardReady, reseed, signInAs } from './helpers';

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

test.describe('keyboard shortcuts', () => {
  test('g then b, t or p goes to the Tickets board, the list and Projects', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets');
    await hydrated(page);
    await keyboardReady(page);

    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await expect(page).toHaveURL(/\/w\/acme\/tickets\/board$/);
    await hydrated(page);
    await keyboardReady(page);
    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await expect(page).toHaveURL(/\/w\/acme\/projects$/);
    await hydrated(page);
    await keyboardReady(page);
    await page.keyboard.press('g');
    await page.keyboard.press('t');
    await expect(page).toHaveURL(/\/w\/acme\/tickets$/);
  });

  test('c starts a new ticket, in the project being looked at', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/projects/WEB/board');
    await hydrated(page);
    await keyboardReady(page);

    await page.keyboard.press('c');
    await expect(page).toHaveURL(/\/w\/acme\/tickets\/new\?project=WEB$/);
  });

  test('/ goes to the search box, and ? shows the shortcuts', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets');
    await hydrated(page);
    await keyboardReady(page);

    await page.keyboard.press('/');
    await expect(page.getByPlaceholder('Search title or key')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.locator('body').click({ position: { x: 5, y: 5 } });

    await page.keyboard.press('?');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toContainText('Open the command menu');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('j and k walk the list, Enter opens a ticket, and x selects it', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets');
    await hydrated(page);
    await keyboardReady(page);
    const keys = await page.locator('tbody tr th').allTextContents();

    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await expect(
      page.getByRole('checkbox', { name: `Select ${keys[1]}`, exact: true }),
    ).toBeChecked();
    await page.keyboard.press('k');
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/acme/tickets/${keys[1]}$`));
  });

  test('on a ticket, a assigns it to me and m goes to its status', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets/WEB-12');
    await hydrated(page);
    await keyboardReady(page);
    await page.waitForFunction(() => document.documentElement.dataset.pageCommands === 'ready');

    await page.keyboard.press('a');
    await expect(page.getByRole('region', { name: 'Activity' })).toContainText(
      'reassigned this from Adam Admin to Dana Developer',
    );
    await page.keyboard.press('m');
    await expect(page.getByLabel('Status')).toBeFocused();
  });

  test('shortcuts never fire while typing', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets/WEB-3');
    await hydrated(page);
    await keyboardReady(page);

    const box = page.getByRole('textbox', { name: 'Add a comment' });
    await box.click();
    await page.keyboard.type('c a ? / g b');
    await expect(box).toHaveValue('c a ? / g b');
    await expect(page).toHaveURL(/\/w\/acme\/tickets\/WEB-3$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Activity' })).not.toContainText('assigned');
  });

  test('nothing moves behind the shortcut sheet, and c needs the right to create', async ({
    page,
  }) => {
    await signInAs(page, 'readonly');
    await page.goto('/w/acme/tickets');
    await hydrated(page);
    await keyboardReady(page);

    // Nothing should happen, so wait as long as a navigation takes and look once.
    await page.keyboard.press('c');
    await page.waitForTimeout(1500);
    expect(page.url()).toMatch(/\/w\/acme\/tickets$/);

    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('b');
    await page.waitForTimeout(1500);
    expect(page.url()).toMatch(/\/w\/acme\/tickets$/);
  });

  test('j and k still work after clicking a row checkbox', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets');
    await hydrated(page);
    await keyboardReady(page);
    const keys = await page.locator('tbody tr th').allTextContents();

    await page.getByRole('checkbox', { name: `Select ${keys[0]}`, exact: true }).click();
    await page.keyboard.press('j');
    await expect(page.locator('a[data-row-link]').nth(1)).toBeFocused();
  });
});
