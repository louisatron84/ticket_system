import { expect, test } from '@playwright/test';
import { hydrated, reseed, signInAs } from './helpers';

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

test.describe('projects', () => {
  test('an owner creates a project and lands on its board', async ({ page }) => {
    await signInAs(page, 'owner');
    await page.goto('/w/acme/projects');
    await hydrated(page);

    await page.getByRole('button', { name: 'New project' }).click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByLabel('Name').fill('Customer Portal');
    // The key follows the name until it is edited by hand.
    await expect(dialog.getByLabel('Key')).toHaveValue('CP');
    await expect(dialog.getByText('CP-1')).toBeVisible();

    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/\/w\/acme\/projects\/CP\/board$/);
    await expect(page.getByRole('heading', { name: 'Customer Portal', level: 1 })).toBeVisible();
    // A new project has the standard workflow and nothing in it yet.
    await expect(page.locator('section[aria-label^="Backlog"]')).toBeVisible();
    await expect(page.getByText('No tickets')).toHaveCount(7);
  });

  test('a taken key is explained next to the key, and nothing typed is lost', async ({ page }) => {
    await signInAs(page, 'owner');
    await page.goto('/w/acme/projects');
    await hydrated(page);

    await page.getByRole('button', { name: 'New project' }).click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByLabel('Name').fill('Another web');
    await dialog.getByLabel('Key').fill('web');
    await expect(dialog.getByLabel('Key')).toHaveValue('WEB');
    await dialog.getByRole('button', { name: 'Create project' }).click();

    await expect(dialog.getByText('The project key WEB is already in use.')).toBeVisible();
    await expect(dialog.getByLabel('Name')).toHaveValue('Another web');
    await expect(page).toHaveURL(/\/w\/acme\/projects$/);
  });

  test('mistakes show while typing, before anything is sent', async ({ page }) => {
    await signInAs(page, 'owner');
    await page.goto('/w/acme/projects');
    await hydrated(page);

    await page.getByRole('button', { name: 'New project' }).click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByLabel('Key').fill('w');
    await dialog.getByLabel('Key').blur();
    await expect(
      dialog.getByText('Use 2 to 10 capital letters or digits, starting with a letter.'),
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(dialog.getByText('Give the project a name.')).toBeVisible();
  });

  test('a read-only member sees the projects but no way to create one', async ({ page }) => {
    await signInAs(page, 'readonly');
    await page.goto('/w/acme/projects');
    await expect(page.getByRole('link', { name: 'Web App' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New project' })).toHaveCount(0);
  });

  test('a restricted member is told they have no access', async ({ page }) => {
    await signInAs(page, 'restricted');
    await page.goto('/w/acme/projects');
    await expect(
      page.getByRole('heading', { name: "You don't have access to projects" }),
    ).toBeVisible();
  });

  test("another workspace's project looks exactly like one that does not exist", async ({
    page,
  }) => {
    await signInAs(page, 'other-owner');

    const foreign = await page.goto('/w/acme/projects/WEB/board');
    expect(foreign?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    const foreignText = await page.locator('main').innerText();
    expect(foreignText).not.toContain('Web App');

    const missing = await page.goto('/w/acme/projects/NOPE/board');
    expect(missing?.status()).toBe(404);
    expect(await page.locator('main').innerText()).toBe(foreignText);
  });

  test('a project that does not exist in your own workspace shows the not-found page', async ({
    page,
  }) => {
    await signInAs(page, 'owner');
    await page.goto('/w/acme/projects/NOPE/board');
    // The page streams in behind the workspace's loading skeleton, so the status is already sent;
    // what matters here is that the person sees the not-found page, not a broken or empty one.
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Web App' })).toHaveCount(0);
  });
});
