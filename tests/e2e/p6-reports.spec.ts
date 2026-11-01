import { expect, test } from '@playwright/test';
import { hydrated, reseed, signInAs } from './helpers';

// P6: reports on how work has flowed through a project.

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

test('the Reports tab shows the project’s charts over 30 or 90 days', async ({ page }) => {
  await signInAs(page, 'readonly');
  await page.goto('/w/acme/projects/WEB/board');
  await hydrated(page);
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/projects\/WEB\/reports$/);

  for (const heading of ['Made and done', 'Throughput', 'Cumulative flow', 'Age in status']) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  await expect(page.getByRole('img', { name: /^Over the last 30 days, / })).toBeVisible();
  await expect(page.getByText('Lead time (made to done)')).toBeVisible();
  // Cycles are off, so there is no velocity.
  await expect(page.getByRole('heading', { name: 'Velocity' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Last 90 days' }).click();
  await expect(page).toHaveURL(/\?days=90$/);
  await expect(page.getByRole('img', { name: /^Over the last 90 days, / })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Last 90 days' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('with cycles on, the reports add the burndown and velocity', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/w/acme/projects/WEB/settings');
  await hydrated(page);
  await page.getByRole('switch', { name: /Plan in cycles/ }).check();
  await expect(page.getByText('WEB now plans in cycles.')).toBeVisible();

  await page.goto('/w/acme/projects/WEB/reports');
  await hydrated(page);
  await expect(page.getByRole('heading', { name: 'Burndown' })).toBeVisible();
  await expect(page.getByText('No cycle is running.')).toBeVisible();
  await expect(page.getByText('Velocity shows once a cycle has been completed.')).toBeVisible();
});
