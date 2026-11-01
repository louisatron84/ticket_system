import { expect, test } from '@playwright/test';
import { hydrated, reseed, signInAs } from './helpers';

// P4: the workspace's ticket settings, a project's workflow, and custom fields on a ticket.

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

test('an admin adds a ticket type and renames a priority on the ticket settings page', async ({
  page,
}) => {
  await signInAs(page, 'admin');
  await page.goto('/w/acme/settings');
  await hydrated(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Ticket settings' })).toBeVisible();

  const types = page.getByRole('region', { name: 'Ticket types' });
  await types.getByLabel('New type').fill('Spike');
  await types.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Added Spike.')).toBeVisible();
  await expect(types.getByLabel('Name of Spike')).toBeVisible();

  const priorities = page.getByRole('region', { name: 'Priorities' });
  const inferno = priorities.getByLabel('Name of Inferno');
  await inferno.fill('P1');
  await inferno.press('Enter');
  await expect(page.getByText('Renamed to P1.')).toBeVisible();
});

test('a developer cannot open the ticket settings', async ({ page }) => {
  await signInAs(page, 'developer');
  await page.goto('/w/acme/settings');
  await hydrated(page);
  await expect(page.getByText(/ticket settings/i).first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ticket types' })).toHaveCount(0);
});

test('an admin adds a QA status, and it becomes a board column', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/w/acme/projects/WEB/settings');
  await hydrated(page);

  const workflow = page.getByRole('region', { name: 'Workflow' });
  await expect(workflow.getByText('Loading the workflow…')).toHaveCount(0);
  await workflow.getByLabel('New status').fill('QA');
  await workflow.getByRole('button', { name: 'Add status' }).click();
  await expect(page.getByText('Added QA.')).toBeVisible();
  await expect(workflow.getByTestId('status-qa')).toBeVisible();

  await page.goto('/w/acme/projects/WEB/board');
  await hydrated(page);
  await expect(page.getByRole('heading', { name: /^QA/ })).toBeVisible();
});

test('a custom field made in settings is filled in on a ticket', async ({ page }) => {
  await signInAs(page, 'admin');
  await page.goto('/w/acme/settings');
  await hydrated(page);

  const fields = page.getByRole('region', { name: 'Custom fields' });
  await expect(fields.getByText('No custom fields yet.')).toBeVisible();
  await fields.getByLabel('New field').fill('Customer');
  await fields.getByRole('button', { name: 'Add field' }).click();
  await expect(page.getByText('Added Customer.')).toBeVisible();

  await page.goto('/w/acme/tickets/WEB-2');
  await hydrated(page);
  const custom = page.getByRole('region', { name: 'Custom fields' });
  const customer = custom.getByLabel('Customer');
  await customer.fill('Northwind Traders');
  await customer.press('Enter');
  await expect(customer).toHaveValue('Northwind Traders');

  await page.reload();
  await hydrated(page);
  await expect(
    page.getByRole('region', { name: 'Custom fields' }).getByLabel('Customer'),
  ).toHaveValue('Northwind Traders');
});
