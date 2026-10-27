import { expect, test, type Page } from '@playwright/test';
import { hydrated, keyboardReady, reseed, signInAs } from './helpers';

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

const menu = (page: Page) => page.getByRole('dialog', { name: 'Command menu' });
const input = (page: Page) => menu(page).getByRole('combobox');
const options = (page: Page) => menu(page).getByRole('option');

async function open(page: Page) {
  await page.keyboard.press('Control+k');
  await expect(input(page)).toBeFocused();
}

async function openTicket(page: Page, key: string) {
  await page.goto(`/w/acme/tickets/${key}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await hydrated(page);
  await keyboardReady(page);
}

test.describe('the command menu', () => {
  test('finds a ticket by its key and opens it', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets');
    await hydrated(page);
    await keyboardReady(page);

    await open(page);
    await input(page).fill('web-3');
    await expect(options(page).first()).toContainText('WEB-3');
    await expect(options(page).first()).toContainText('Checkout page is slow on mobile');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/w\/acme\/tickets\/WEB-3$/);
    await expect(menu(page)).toHaveCount(0);
  });

  test('acts on the ticket being looked at', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-12');

    await open(page);
    await input(page).fill('assign');
    await expect(options(page).first()).toHaveText('Assign to me');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Activity' })).toContainText(
      'reassigned this from Adam Admin to Dana Developer',
    );

    await openTicket(page, 'WEB-3');
    await open(page);
    await input(page).fill('move to blocked');
    await page.getByRole('option', { name: 'Move to Blocked' }).click();
    await expect(page.getByLabel('Status').locator('option:checked')).toHaveText('Blocked');
  });

  test('the arrow keys choose, and Escape closes and gives the focus back', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets');
    await hydrated(page);
    await keyboardReady(page);
    const newTicket = page.getByRole('link', { name: 'New ticket' });
    await newTicket.focus();

    await open(page);
    await input(page).fill('create');
    await expect(options(page).first()).toHaveText('Create ticket');
    await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(newTicket).toBeFocused();

    await open(page);
    await input(page).fill('create');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/w\/acme\/tickets\/new$/);
  });

  test('goes to pages and projects', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets');
    await hydrated(page);
    await keyboardReady(page);

    await open(page);
    await input(page).fill('tickets board');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/w\/acme\/tickets\/board$/);

    await open(page);
    await input(page).fill('web app');
    await expect(options(page).first()).toContainText('Web App');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/w\/acme\/projects\/WEB\/board$/);
  });

  test('a read-only member is offered nothing that would change the ticket', async ({ page }) => {
    await signInAs(page, 'readonly');
    await openTicket(page, 'WEB-3');

    await open(page);
    const labels = await options(page).allTextContents();
    expect(labels).toContain('Copy key');
    for (const changing of ['Assign to me', 'Unassign', 'Duplicate', 'Archive', 'Create ticket']) {
      expect(labels).not.toContain(changing);
    }
    expect(labels.some((label) => label.startsWith('Move to'))).toBe(false);
  });

  test('a command that stays on the page gives the focus back', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-12');
    const actions = page.getByRole('button', { name: 'Actions for WEB-12' });
    await actions.focus();

    await open(page);
    await page.keyboard.press('Control+k');
    await input(page).fill('copy key');
    await page.keyboard.press('Enter');
    await expect(actions).toBeFocused();
  });
});
