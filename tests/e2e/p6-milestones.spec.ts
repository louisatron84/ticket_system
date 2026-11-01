import { expect, test } from '@playwright/test';
import { hydrated, reseed, signInAs } from './helpers';

// P6: milestones group a project's tickets towards a dated goal.

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

test('a milestone is made, a ticket joins it, and its progress and tickets show', async ({
  page,
}) => {
  await signInAs(page, 'developer');
  await page.goto('/w/acme/projects/WEB/milestones');
  await hydrated(page);
  await expect(page.getByText('No milestones yet.')).toBeVisible();

  await page.getByLabel('New milestone').fill('Public beta');
  await page.getByLabel('Target date').fill('2031-03-01');
  await page.getByRole('button', { name: 'Add milestone' }).click();
  await expect(page.getByText('Added Public beta.')).toBeVisible();
  const card = page.getByRole('listitem', { name: 'Public beta' });
  await expect(card).toContainText('0 of 0 tickets done');

  await page.goto('/w/acme/tickets/WEB-2');
  await hydrated(page);
  await page.getByLabel('Milestone').selectOption({ label: 'Public beta' });
  await expect(page.getByLabel('Milestone')).toHaveValue(/.+/);

  await page.goto('/w/acme/projects/WEB/milestones');
  await hydrated(page);
  await expect(card).toContainText('0 of 1 tickets done');
  await card.getByLabel('Health').selectOption('at_risk');
  await expect(page.getByText('Public beta is at risk.')).toBeVisible();

  await card.getByRole('link', { name: 'View tickets' }).click();
  await expect(page).toHaveURL(/\/projects\/WEB\/list\?milestone=/);
  await hydrated(page);
  await expect(page.getByRole('row', { name: /^Select WEB-2 / })).toBeVisible();
  await expect(page.getByRole('row', { name: /^Select WEB-3 / })).toHaveCount(0);
  await expect(page.getByText('Milestone: a chosen one')).toBeVisible();
});

test('a read-only member sees milestones but cannot add one', async ({ page }) => {
  await signInAs(page, 'readonly');
  await page.goto('/w/acme/projects/WEB/milestones');
  await hydrated(page);
  await expect(page.getByText(/No milestones yet/)).toBeVisible();
  await expect(page.getByLabel('New milestone')).toHaveCount(0);
});
