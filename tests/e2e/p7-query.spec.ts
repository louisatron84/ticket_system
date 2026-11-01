import { expect, test } from '@playwright/test';
import { hydrated, reseed, signInAs } from './helpers';

// P7: the search box takes a query (`assignee:me is:open`), with suggestions and named problems.

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

test('a typed query becomes filters, shown as chips', async ({ page }) => {
  await signInAs(page, 'developer');
  await page.goto('/w/acme/projects/WEB/list');
  await hydrated(page);
  const box = page.getByRole('combobox', { name: /Search tickets/ });
  await box.fill('assignee:me is:open login');
  await box.press('Enter');
  await expect(page).toHaveURL(/assignee=me/);
  await expect(page).toHaveURL(/statusCategory=not_started/);
  const chips = page.getByRole('group', { name: 'Active filters' });
  await expect(chips.getByText('Assignee: Me')).toBeVisible();
  await expect(chips.getByText('Text: login')).toBeVisible();
  // The box keeps only the plain words.
  await expect(box).toHaveValue('login');
});

test('a mistake is named under the box, with a suggestion', async ({ page }) => {
  await signInAs(page, 'developer');
  await page.goto('/w/acme/projects/WEB/list');
  await hydrated(page);
  const box = page.getByRole('combobox', { name: /Search tickets/ });
  await box.fill('statsu:open');
  await box.press('Enter');
  await expect(
    page.getByRole('alert').filter({ hasText: 'There is no filter called statsu' }),
  ).toContainText('Did you mean status?');
  await expect(box).toHaveAttribute('aria-invalid', 'true');
  await expect(page).not.toHaveURL(/statusKey/);
});

test('suggestions complete filter names and values from the keyboard', async ({ page }) => {
  await signInAs(page, 'developer');
  await page.goto('/w/acme/projects/WEB/list');
  await hydrated(page);
  const box = page.getByRole('combobox', { name: /Search tickets/ });
  await box.click();
  await box.pressSequentially('prio');
  await expect(page.getByRole('option', { name: /^priority:/ })).toBeVisible();
  await box.press('ArrowDown');
  await box.press('Enter');
  await expect(box).toHaveValue('priority:');
  await box.pressSequentially('hig');
  // Priorities have their own names here: High is Blaze. Its key finds it too.
  await expect(page.getByRole('option', { name: /^Blaze/ })).toBeVisible();
  await box.press('ArrowDown');
  await box.press('Enter');
  await expect(box).toHaveValue('priority:Blaze ');
  await box.press('Enter');
  await expect(page).toHaveURL(/priority=high/);
});
