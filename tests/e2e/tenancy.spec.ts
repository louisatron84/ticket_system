import { expect, test, type Page } from '@playwright/test';
import { hydrated, reseed, signInAs, switchTo, viewerOf } from './helpers';

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

async function acmeId(page: Page) {
  const viewer = await viewerOf(page);
  return viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
}

test.describe('one workspace cannot see another', () => {
  test('a foreign workspace looks exactly like one that does not exist', async ({ page }) => {
    await signInAs(page, 'other-owner');
    await expect(page).toHaveURL(/\/w\/northwind$/);

    const foreign = await page.goto('/w/acme');
    expect(foreign?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    const foreignText = await page.locator('main').innerText();

    const missing = await page.goto('/w/does-not-exist');
    expect(missing?.status()).toBe(404);
    expect(await page.locator('main').innerText()).toBe(foreignText);

    // The Acme members page and its name must not leak anywhere on the foreign page.
    await page.goto('/w/acme/members');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByText('Acme Robotics')).toHaveCount(0);
    await expect(page.getByText('@acme.test')).toHaveCount(0);
  });

  test('the API gives the same 404 for reads and writes across workspaces', async ({ page }) => {
    await signInAs(page, 'owner');
    const acme = await acmeId(page);

    await switchTo(page, 'other-owner');
    const reads = [
      `/api/v1/orgs/${acme}`,
      `/api/v1/orgs/${acme}/members`,
      `/api/v1/orgs/${acme}/roles`,
    ];
    for (const url of reads) {
      expect((await page.request.get(url)).status(), url).toBe(404);
    }
    const write = await page.request.patch(`/api/v1/orgs/${acme}`, {
      data: { name: 'Taken over' },
    });
    expect(write.status()).toBe(404);
  });

  test('a person in two workspaces can move between them, with a different role in each', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await hydrated(page);

    await page.getByRole('button', { name: /^Workspace: Acme Robotics/ }).click();
    const menu = page.locator('#workspace-menu');
    await expect(menu).toContainText('Acme Robotics');
    await expect(menu).toContainText('Northwind Traders');
    await menu.getByRole('link', { name: /Northwind Traders/ }).click();

    await expect(page).toHaveURL(/\/w\/northwind$/);
    await expect(page.getByRole('heading', { name: 'Northwind Traders', level: 1 })).toBeVisible();
    await expect(page.getByText('Your role: Read-only')).toBeVisible();

    // Read-only there: the member list has no editing controls.
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Members' })
      .click();
    await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveCount(0);
  });

  test('switching identity never shows the previous identity’s data, even with Back', async ({
    page,
  }) => {
    await signInAs(page, 'owner');
    await page.goto('/w/acme/members');
    await hydrated(page);
    await expect(page.getByText('readonly@acme.test')).toBeVisible();

    await switchTo(page, 'other-owner');
    await expect(page).toHaveURL(/\/w\/northwind$/);

    await page.goBack();
    // Whatever the browser shows for the Acme members page now, it must be fresh for Nora.
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByText('readonly@acme.test')).toHaveCount(0);
    await expect(page.getByText('Olivia Owner')).toHaveCount(0);
  });
});
