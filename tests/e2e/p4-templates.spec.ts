import { expect, test } from '@playwright/test';
import { hydrated, reseed, signInAs } from './helpers';

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

test('an admin adds a template, and a developer picks it on the new-ticket form', async ({
  browser,
}) => {
  const admin = await (await browser.newContext()).newPage();
  await signInAs(admin, 'admin');
  await admin.goto('/w/acme/projects/WEB/settings');
  await hydrated(admin);

  const section = admin.getByRole('region', { name: 'Templates' });
  await expect(section.getByText('No templates yet.')).toBeVisible();
  await section.getByRole('button', { name: 'Add a template' }).click();
  const form = section.getByRole('form', { name: 'New template' });
  await form.getByLabel('Name').fill('Bug report');
  await form.getByLabel('Title prefix').fill('[Bug]');
  await form.getByLabel('Type').selectOption({ label: 'Bug' });
  await form.getByLabel('Priority').selectOption({ label: 'Blaze' });
  await form.getByLabel('Component').selectOption({ label: 'Checkout' });
  await form.getByLabel('Goal').fill('Find out what broke.');
  await form.getByLabel('Acceptance criteria').fill('It is reproduced\nIt is fixed');
  await form.getByRole('button', { name: 'Add template' }).click();
  await expect(admin.getByText('Added the template “Bug report”.')).toBeVisible();
  await expect(section.getByRole('listitem').filter({ hasText: 'Bug report' })).toBeVisible();

  const developer = await (await browser.newContext()).newPage();
  await signInAs(developer, 'developer');
  await developer.goto('/w/acme/tickets/new?project=WEB');
  await hydrated(developer);
  await developer.getByLabel('Title').fill('Checkout button does nothing');
  await developer.getByLabel('Template').selectOption({ label: 'Bug report' });

  await expect(developer.getByLabel('Title')).toHaveValue('[Bug] Checkout button does nothing');
  await expect(developer.getByLabel('Type').locator('option:checked')).toHaveText('Bug');
  await expect(developer.getByLabel('Priority').locator('option:checked')).toHaveText('Blaze');
  await expect(developer.getByLabel('Component').locator('option:checked')).toHaveText('Checkout');
  await expect(developer.getByLabel('Goal')).toHaveValue('Find out what broke.');
  await expect(developer.getByLabel('Acceptance criteria')).toHaveValue(
    'It is reproduced\nIt is fixed',
  );

  // Everything can still be changed before creating.
  await developer.getByLabel('Priority').selectOption({ label: 'Flame' });
  await developer.getByRole('button', { name: 'Create ticket' }).click();
  await expect(developer).toHaveURL(/\/w\/acme\/tickets\/WEB-\d+$/);
  await expect(
    developer.getByRole('heading', { name: '[Bug] Checkout button does nothing' }),
  ).toBeVisible();
});

test('a template is deleted only after confirming', async ({ page }) => {
  await signInAs(page, 'owner');
  await page.goto('/w/acme/projects/WEB/settings');
  await hydrated(page);
  const section = page.getByRole('region', { name: 'Templates' });
  await section.getByRole('button', { name: 'Add a template' }).click();
  await section.getByRole('form', { name: 'New template' }).getByLabel('Name').fill('Chore');
  await section.getByRole('button', { name: 'Add template' }).click();
  await expect(section.getByRole('listitem').filter({ hasText: 'Chore' })).toBeVisible();

  await section.getByRole('button', { name: 'Delete Chore' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(section.getByRole('listitem').filter({ hasText: 'Chore' })).toBeVisible();

  await section.getByRole('button', { name: 'Delete Chore' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete template' }).click();
  await expect(section.getByText('No templates yet.')).toBeVisible();
});

test('a project without templates shows no Template control', async ({ page }) => {
  await signInAs(page, 'developer');
  await page.goto('/w/acme/tickets/new?project=WEB');
  await hydrated(page);
  await expect(page.getByLabel('Title')).toBeVisible();
  await expect(page.getByLabel('Template')).toHaveCount(0);
});
