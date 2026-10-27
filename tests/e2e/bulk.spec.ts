import { expect, test, type Page } from '@playwright/test';
import { hydrated, reseed, signInAs } from './helpers';

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

// A row's key is the text of its row header.
const row = (page: Page, key: string) =>
  page.locator('tbody tr').filter({ has: page.locator('th', { hasText: new RegExp(`^${key}$`) }) });
const bar = (page: Page) => page.getByRole('region', { name: 'Bulk actions' });

async function openList(page: Page, query = '') {
  await page.goto(`/w/acme/tickets${query}`);
  await expect(row(page, 'WEB-3')).toBeVisible();
  await hydrated(page);
}

async function select(page: Page, keys: string[]) {
  for (const key of keys)
    await page.getByRole('checkbox', { name: `Select ${key}`, exact: true }).check();
}

test.describe('bulk edit from the list', () => {
  test('several tickets get a new priority at once', async ({ page }) => {
    await signInAs(page, 'developer');
    await openList(page);
    await expect(bar(page)).toHaveCount(0);

    await select(page, ['WEB-1', 'WEB-2', 'WEB-5']);
    await expect(bar(page)).toContainText('3 selected');
    await bar(page).getByRole('button', { name: 'Priority…' }).click();
    await page
      .getByRole('group', { name: 'Priority for selected' })
      .getByRole('button', { name: 'Blaze', exact: true })
      .click();

    await expect(bar(page)).toContainText('Changed 3 of 3.');
    for (const key of ['WEB-1', 'WEB-2', 'WEB-5']) {
      await expect(
        row(page, key).getByRole('button', { name: `Change priority of ${key}` }),
      ).toHaveText('Blaze');
    }
  });

  test('a change some tickets refuse says which ones and why, and changes the rest', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openList(page);

    // WEB-12 is Quenched, which can only reopen; WEB-11 is Warming, which may go into the Forge.
    await select(page, ['WEB-12', 'WEB-11']);
    await bar(page).getByRole('button', { name: 'Move to…' }).click();
    await page
      .getByRole('group', { name: 'Move selected to' })
      .getByRole('button', { name: 'In the Forge' })
      .click();

    await expect(bar(page)).toContainText('Changed 1 of 2. 1 could not be changed:');
    await expect(bar(page)).toContainText("WEB-12: That move isn't allowed from Quenched.");
    await expect(
      row(page, 'WEB-11').getByRole('button', { name: 'Change status of WEB-11' }),
    ).toHaveText('In the Forge');
    await expect(row(page, 'WEB-12')).toContainText('Quenched');
  });

  test('labels are added to and removed from every selected ticket', async ({ page }) => {
    await signInAs(page, 'developer');
    await openList(page);

    await select(page, ['WEB-1', 'WEB-12']);
    await bar(page).getByRole('button', { name: 'Add label…' }).click();
    await page
      .getByRole('group', { name: 'Add label to selected' })
      .getByRole('button', { name: 'security' })
      .click();
    await expect(bar(page)).toContainText('Changed 2 of 2.');
    await expect(row(page, 'WEB-1')).toContainText('security');
    await expect(row(page, 'WEB-12')).toContainText('security');

    await bar(page).getByRole('button', { name: 'Remove label…' }).click();
    await page
      .getByRole('group', { name: 'Remove label from selected' })
      .getByRole('button', { name: 'security' })
      .click();
    await expect(row(page, 'WEB-1')).not.toContainText('security');
  });

  test('archiving takes the tickets out of the list, and the selection with them', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openList(page);

    await select(page, ['WEB-4', 'WEB-10']);
    await bar(page).getByRole('button', { name: 'Archive' }).click();
    await expect(bar(page)).toContainText('Changed 2 of 2.');
    await expect(row(page, 'WEB-4')).toHaveCount(0);
    await expect(row(page, 'WEB-10')).toHaveCount(0);
    await expect(bar(page)).not.toContainText('selected');
  });

  test('"Select all on this page" selects every row, and Clear selection empties it', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openList(page, '?project=WEB');

    await page.getByRole('checkbox', { name: 'Select all on this page' }).check();
    await expect(bar(page)).toContainText('12 selected');
    await bar(page).getByRole('button', { name: 'Clear selection' }).click();
    await expect(bar(page)).toHaveCount(0);
    await expect(
      page.getByRole('checkbox', { name: 'Select WEB-1', exact: true }),
    ).not.toBeChecked();
  });

  test('a read-only member has no checkboxes', async ({ page }) => {
    await signInAs(page, 'readonly');
    await openList(page);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });
});
