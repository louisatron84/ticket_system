import { expect, test, type Page } from '@playwright/test';
import { hydrated, reseed, signInAs, switchTo, viewerOf } from './helpers';

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

const activity = (page: Page) => page.getByRole('region', { name: 'Activity' });
const actionsButton = (page: Page, key: string) =>
  page.getByRole('button', { name: `Actions for ${key}` });
const actionsMenu = (page: Page, key: string) =>
  page.getByRole('group', { name: `${key} actions` });

async function openTicket(page: Page, key: string) {
  await page.goto(`/w/acme/tickets/${key}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await hydrated(page);
}

async function choose(page: Page, key: string, action: string) {
  await actionsButton(page, key).click();
  await actionsMenu(page, key).getByRole('button', { name: action, exact: true }).click();
}

test.describe('the ticket actions menu', () => {
  test('archiving shows a banner and makes the ticket read-only, and unarchiving restores it', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-3');
    await expect(page.getByLabel('Priority')).toBeEnabled();

    await choose(page, 'WEB-3', 'Archive');
    await expect(page.getByText('Archived WEB-3.')).toBeVisible();
    const banner = page.getByRole('status').filter({ hasText: 'This ticket is archived' });
    await expect(banner).toBeVisible();
    await expect(activity(page)).toContainText('archived this ticket');

    // Nothing on the page can change it now.
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit title' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit labels' })).toHaveCount(0);
    await expect(page.getByLabel('Add a comment')).toHaveCount(0);
    await expect(page.getByText('comments are closed')).toBeVisible();

    // It leaves the list.
    await page.goto('/w/acme/tickets');
    await expect(page.getByRole('link', { name: 'Checkout page is slow on mobile' })).toHaveCount(
      0,
    );

    await openTicket(page, 'WEB-3');
    await choose(page, 'WEB-3', 'Unarchive');
    await expect(page.getByText('Unarchived WEB-3.')).toBeVisible();
    await expect(banner).toHaveCount(0);
    await expect(activity(page)).toContainText('unarchived this ticket');
    await expect(page.getByLabel('Priority')).toBeEnabled();
    await expect(page.getByLabel('Add a comment')).toBeVisible();

    await page.goto('/w/acme/tickets');
    await expect(
      page.getByRole('link', { name: 'Checkout page is slow on mobile' }).first(),
    ).toBeVisible();
  });

  test('the banner has its own Unarchive, which restores the editable ticket', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-3');
    await choose(page, 'WEB-3', 'Archive');
    const banner = page.getByRole('status').filter({ hasText: 'This ticket is archived' });
    await expect(banner).toBeVisible();
    await expect(page.getByLabel('Add a comment')).toHaveCount(0);

    await banner.getByRole('button', { name: 'Unarchive' }).click();
    await expect(page.getByText('Unarchived WEB-3.')).toBeVisible();
    await expect(banner).toHaveCount(0);
    await expect(activity(page)).toContainText('unarchived this ticket');
    await expect(page.getByLabel('Priority')).toBeEnabled();
    await expect(page.getByLabel('Add a comment')).toBeVisible();
  });

  test('someone who cannot edit sees the banner but no Unarchive', async ({ page }) => {
    await signInAs(page, 'developer');
    const acme = (await viewerOf(page)).memberships.find((m) => m.organisation.slug === 'acme')!
      .organisation.id;
    const archived = await page.request.post(`/api/v1/orgs/${acme}/tickets/WEB-3/archive`);
    expect(archived.status()).toBe(200);

    await switchTo(page, 'readonly');
    await openTicket(page, 'WEB-3');
    const banner = page.getByRole('status').filter({ hasText: 'This ticket is archived' });
    await expect(banner).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unarchive' })).toHaveCount(0);
    await actionsButton(page, 'WEB-3').click();
    await expect(actionsMenu(page, 'WEB-3').getByRole('button')).toHaveText([
      'Copy key',
      'Copy link',
    ]);
  });

  test('duplicating opens the copy, which remembers where it came from', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-3');

    await choose(page, 'WEB-3', 'Duplicate');

    await expect(page).toHaveURL(/\/w\/acme\/tickets\/WEB-13$/);
    await expect(
      page.getByRole('heading', { name: 'Copy of Checkout page is slow on mobile', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('Created WEB-13, a copy of WEB-3.')).toBeVisible();
    await expect(activity(page)).toContainText('duplicated this from WEB-3');
  });

  test('Copy key and Copy link put the right text on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-3');
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

    await choose(page, 'WEB-3', 'Copy key');
    await expect(page.getByText('Copied WEB-3.')).toBeVisible();
    expect(await clipboard()).toBe('WEB-3');

    await choose(page, 'WEB-3', 'Copy link');
    await expect(page.getByText('Copied the link to WEB-3.')).toBeVisible();
    expect(await clipboard()).toBe(`${new URL(page.url()).origin}/w/acme/tickets/WEB-3`);
  });

  test('the menu opens and closes from the keyboard', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-3');

    await actionsButton(page, 'WEB-3').focus();
    await page.keyboard.press('Enter');
    await expect(actionsMenu(page, 'WEB-3')).toBeVisible();
    await expect(
      actionsMenu(page, 'WEB-3').getByRole('button', { name: 'Copy key' }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(actionsMenu(page, 'WEB-3')).toHaveCount(0);
    await expect(actionsButton(page, 'WEB-3')).toBeFocused();
  });

  test('someone who can only read is offered only the two copies', async ({ page }) => {
    await signInAs(page, 'readonly');
    await openTicket(page, 'WEB-3');

    await actionsButton(page, 'WEB-3').click();
    const items = actionsMenu(page, 'WEB-3').getByRole('button');
    await expect(items).toHaveText(['Copy key', 'Copy link']);
  });

  test('a reviewer, who may comment but not change tickets, is refused by the API as well', async ({
    page,
  }) => {
    await signInAs(page, 'reviewer');
    await openTicket(page, 'WEB-3');

    await actionsButton(page, 'WEB-3').click();
    await expect(actionsMenu(page, 'WEB-3').getByRole('button')).toHaveText([
      'Copy key',
      'Copy link',
    ]);

    const viewer = await (await page.request.get('/api/v1/me')).json();
    const acme = viewer.memberships.find(
      (m: { organisation: { slug: string } }) => m.organisation.slug === 'acme',
    ).organisation.id;
    const duplicate = await page.request.post(`/api/v1/orgs/${acme}/tickets/WEB-3/duplicate`);
    expect(duplicate.status()).toBe(403);
    const archive = await page.request.post(`/api/v1/orgs/${acme}/tickets/WEB-3/archive`);
    expect(archive.status()).toBe(403);
  });
});
