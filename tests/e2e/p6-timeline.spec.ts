import { expect, test, type Page } from '@playwright/test';
import { hydrated, keyboardReady, reseed, signInAs } from './helpers';

// P6: the timeline places epics from their start to their due date.

/**
 * Types a start date on the open ticket. The fields can take a moment longer to come alive than
 * the page shell, and a value typed before then is lost, so it types again until Save appears.
 */
async function typeStartDate(page: Page, date: string) {
  const field = page.getByLabel('Start date');
  const save = page.getByRole('button', { name: 'Save start date' });
  await expect(async () => {
    await field.fill('');
    await field.fill(date);
    await expect(save).toBeVisible({ timeout: 1000 });
  }).toPass();
  await save.click();
}

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

test('an epic given a start date runs as a bar to its due date', async ({ page }) => {
  await signInAs(page, 'developer');
  const today = new Date().toISOString().slice(0, 10);

  await page.goto('/w/acme/projects/WEB/timeline');
  await hydrated(page);
  // The seeded epic has only a due date: a one-day mark with no start.
  await expect(page.getByRole('link', { name: /^WEB-5 .*: no start to / })).toBeVisible();

  await page.goto('/w/acme/tickets/WEB-5');
  await keyboardReady(page);
  await typeStartDate(page, today);
  await expect(page.getByRole('button', { name: 'Save start date' })).toHaveCount(0);

  await page.goto('/w/acme/projects/WEB/timeline');
  await hydrated(page);
  await expect(
    page.getByRole('link', { name: new RegExp(`^WEB-5 .*: ${today} to `) }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Months' }).click();
  await expect(page.getByRole('button', { name: 'Months' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByRole('link', { name: new RegExp(`^WEB-5 .*: ${today} to `) }),
  ).toBeVisible();
});

test('a start date after the due date is refused with a reason', async ({ page }) => {
  await signInAs(page, 'developer');
  await page.goto('/w/acme/tickets/WEB-5');
  await keyboardReady(page);
  await typeStartDate(page, '2099-01-01');
  await expect(page.getByText(/The start date must be on or before the due date/)).toBeVisible();
});
