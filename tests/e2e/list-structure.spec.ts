import { expect, test, type Page } from '@playwright/test';
import { hydrated, keyboardReady, reseed, signInAs } from './helpers';

// The demo data: WEB-5 (In the Forge) is an epic over WEB-8 and WEB-11 (Warming) and WEB-12
// (Quenched); WEB-10 is a sub-task of WEB-8; API-3 blocks WEB-7.

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

const rowKeys = (page: Page) => page.locator('tbody tr th');
const row = (page: Page, key: string) =>
  page.locator('tbody tr').filter({ has: page.getByRole('rowheader', { name: key, exact: true }) });

async function openList(page: Page, query: string) {
  await page.goto(`/w/acme/tickets?${query}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await hydrated(page);
}

async function structure(page: Page) {
  await page.getByRole('button', { name: /^Structure/ }).click();
}

test.describe('the list as a tree', () => {
  test('nests children under their parents and greys parents that do not match', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openList(page, 'project=WEB&statusKey=open&sort=key&dir=asc');
    await expect(rowKeys(page)).toHaveText(['WEB-2', 'WEB-8', 'WEB-11']);

    await page.getByRole('switch', { name: 'Tree' }).click();
    await expect(page).toHaveURL(/tree=true/);
    await expect(rowKeys(page)).toHaveText(['WEB-2', 'WEB-5', 'WEB-8', 'WEB-11']);
    await expect(row(page, 'WEB-5')).toHaveAttribute('data-context', 'true');
    await expect(row(page, 'WEB-8')).not.toHaveAttribute('data-context');
    await expect(page.getByRole('switch', { name: 'Tree' })).toBeChecked();

    // Clearing the filters keeps the tree, because it is a way of looking, not a filter.
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page).toHaveURL(/tree=true/);
  });

  test('a tree folds away and opens again', async ({ page }) => {
    await signInAs(page, 'developer');
    await openList(page, 'project=WEB&statusKey=open&sort=key&dir=asc&tree=true');
    await page.getByRole('button', { name: 'Hide the tickets under WEB-5' }).click();
    await expect(row(page, 'WEB-8')).toBeHidden();
    await expect(row(page, 'WEB-5')).toBeVisible();
    await page.getByRole('button', { name: 'Show the tickets under WEB-5' }).click();
    await expect(row(page, 'WEB-8')).toBeVisible();
  });

  test('only matching rows can be selected, and j and k walk every row', async ({ page }) => {
    await signInAs(page, 'developer');
    await openList(page, 'project=WEB&statusKey=open&sort=key&dir=asc&tree=true');
    await keyboardReady(page);

    // WEB-5 is a greyed row; the walk goes through it like any other.
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await expect(page.locator('a[data-row-link]').nth(1)).toBeFocused();
    await page.keyboard.press('k');
    await expect(page.locator('a[data-row-link]').nth(0)).toBeFocused();

    await expect(page.getByRole('checkbox', { name: 'Select WEB-5', exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Select WEB-8', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Select WEB-8', exact: true })).toBeChecked();
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeVisible();
  });

  test('a flat row says which ticket it is part of', async ({ page }) => {
    await signInAs(page, 'developer');
    await openList(page, 'project=WEB&sort=key&dir=asc');
    await expect(row(page, 'WEB-8')).toContainText('↑ WEB-5');
    await expect(row(page, 'WEB-1')).not.toContainText('↑');
  });
});

test.describe('structure filters', () => {
  test('has blocker and top level only narrow the list and survive a reload', async ({ page }) => {
    await signInAs(page, 'developer');
    await openList(page, 'project=WEB&sort=key&dir=asc');

    await structure(page);
    await page
      .getByRole('radiogroup', { name: 'Has blocker' })
      .getByText('Has an open blocker')
      .click();
    await expect(rowKeys(page)).toHaveText(['WEB-7']);
    await expect(
      page.getByRole('button', { name: 'Remove filter Has blocker: Yes' }),
    ).toBeVisible();
    await page.reload();
    await hydrated(page);
    await expect(rowKeys(page)).toHaveText(['WEB-7']);
    await page.getByRole('button', { name: 'Remove filter Has blocker: Yes' }).click();
    await expect(page).not.toHaveURL(/blocked=/);
    await expect(rowKeys(page)).toHaveCount(12);

    await structure(page);
    await page.getByRole('checkbox', { name: 'Top level only' }).click();
    await expect(page.getByRole('button', { name: 'Remove filter Top level only' })).toBeVisible();
    await expect(rowKeys(page)).toHaveCount(8);
    await expect(row(page, 'WEB-8')).toHaveCount(0);
  });

  test('parent, epic and linked to take a ticket key, and a saved view keeps them', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openList(page, 'sort=key&dir=asc');

    await structure(page);
    await page.getByLabel('Epic').fill('web-5');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('button', { name: 'Remove filter Epic: WEB-5' })).toBeVisible();
    await expect(rowKeys(page)).toHaveText(['WEB-8', 'WEB-10', 'WEB-11', 'WEB-12']);

    await page.getByRole('button', { name: 'Views' }).click();
    await page.getByRole('button', { name: 'Save current view' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('Checkout epic');
    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByText('Saved “Checkout epic”.')).toBeVisible();

    await openList(page, 'sort=key&dir=asc');
    await page.getByRole('button', { name: 'Views' }).click();
    await page.getByRole('link', { name: 'Checkout epic' }).click();
    await expect(rowKeys(page)).toHaveText(['WEB-8', 'WEB-10', 'WEB-11', 'WEB-12']);

    await openList(page, 'sort=key&dir=asc&parent=WEB-5');
    await expect(rowKeys(page)).toHaveText(['WEB-8', 'WEB-11', 'WEB-12']);
    await openList(page, 'sort=key&dir=asc&linked=API-3');
    await expect(rowKeys(page)).toHaveText(['WEB-7']);

    await structure(page);
    await page.getByLabel('Parent').fill('nonsense');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'nonsense' })).toHaveText(
      'Parent: “nonsense” is not a ticket key, like WEB-5.',
    );
  });
});
