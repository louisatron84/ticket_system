import { expect, test } from '@playwright/test';
import { hydrated, reseed, signInAs } from './helpers';

// P6: cycles, switched on per project, planned from the backlog, started and completed.

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

test('the Cycles tab appears only once cycles are switched on', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/w/acme/projects/WEB/settings');
  await hydrated(page);
  await expect(page.getByRole('link', { name: 'Cycles' })).toHaveCount(0);
  await page.getByRole('switch', { name: /Plan in cycles/ }).check();
  await expect(page.getByText('WEB now plans in cycles.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cycles' })).toBeVisible();
});

test('a cycle is planned from the backlog, started with a burndown, and completed', async ({
  page,
}) => {
  await signInAs(page, 'admin');
  await page.goto('/w/acme/projects/WEB/settings');
  await hydrated(page);
  await page.getByRole('switch', { name: /Plan in cycles/ }).check();
  await expect(page.getByText('WEB now plans in cycles.')).toBeVisible();

  await page.goto('/w/acme/projects/WEB/cycles');
  await hydrated(page);
  await page.getByRole('button', { name: 'Plan a cycle' }).click();
  await expect(page.getByText('Planned a new cycle.')).toBeVisible();
  await expect(page.getByRole('listitem', { name: 'Cycle 1' })).toBeVisible();

  await page.goto('/w/acme/projects/WEB/backlog');
  await hydrated(page);
  await page.getByLabel('Cycle for WEB-2').selectOption({ label: 'Cycle 1' });
  await expect(page.getByText('WEB-2 is in Cycle 1.')).toBeVisible();

  await page.goto('/w/acme/projects/WEB/cycles');
  await hydrated(page);
  const planned = page.getByRole('listitem', { name: 'Cycle 1' });
  await expect(planned).toContainText('1 ticket');
  await planned.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Started Cycle 1.')).toBeVisible();
  await expect(page.getByRole('img', { name: /Burndown of Cycle 1/ })).toBeVisible();

  await page.getByRole('button', { name: 'Complete cycle' }).click();
  await page.getByRole('button', { name: 'Back to the backlog' }).click();
  await expect(page.getByText('Completed Cycle 1.')).toBeVisible();
  await expect(page.getByText('No cycle is running.')).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Cycle 1');

  await page.goto('/w/acme/tickets/WEB-2');
  await hydrated(page);
  await expect(page.getByLabel('Cycle')).toHaveValue('');
});
