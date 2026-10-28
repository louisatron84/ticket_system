import { expect, test } from '@playwright/test';
import { hydrated, reseed, signInAs, viewerOf } from './helpers';

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

const RULE = "Tickets with an open blocker can't be completed";

test('an admin turns the blocker rule off, and a blocked ticket can then be quenched', async ({
  page,
}) => {
  await signInAs(page, 'admin');
  const viewer = await viewerOf(page);
  const acme = viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
  const linked = await page.request.post(`/api/v1/orgs/${acme}/tickets/WEB-1/links`, {
    data: { choice: 'blocked_by', otherKey: 'API-4' },
  });
  expect(linked.status()).toBe(201);

  await page.goto('/w/acme/projects/WEB/board');
  await hydrated(page);
  await page
    .getByRole('navigation', { name: 'Project views' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page).toHaveURL(/\/w\/acme\/projects\/WEB\/settings$/);
  await hydrated(page);
  const rule = page.getByRole('switch', { name: RULE });
  await expect(rule).toBeChecked();

  await rule.click();
  await expect(page.getByText('Blocked tickets of WEB can now be completed.')).toBeVisible();
  await page.reload();
  await hydrated(page);
  await expect(page.getByRole('switch', { name: RULE })).not.toBeChecked();

  await page.goto('/w/acme/tickets/WEB-1');
  await hydrated(page);
  await page.getByLabel('Status').selectOption({ label: 'Quenched' });
  await expect(page.getByLabel('Status').locator('option:checked')).toHaveText('Quenched');
});

test('someone who cannot manage projects has no Settings tab, and the page is not found', async ({
  page,
}) => {
  await signInAs(page, 'developer');
  await page.goto('/w/acme/projects/WEB/board');
  await hydrated(page);
  await expect(
    page.getByRole('navigation', { name: 'Project views' }).getByRole('link', { name: 'Settings' }),
  ).toHaveCount(0);
  // The page streams, so the answer is the not-found page rather than a 404 status.
  await page.goto('/w/acme/projects/WEB/settings');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);
});
