import { expect, test } from '@playwright/test';
import { API_URL, hydrated, openAccountMenu, reseed, signInAs, viewerOf } from './helpers';

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

test('making a token shows it once, it works, and revoking stops it', async ({ page, request }) => {
  await signInAs(page, 'developer');
  await openAccountMenu(page);
  await page.getByRole('link', { name: 'CLI tokens' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'CLI tokens' })).toBeVisible();
  await hydrated(page);

  await page.getByLabel('Name').fill('Work laptop');
  await page.getByLabel('Can').selectOption('read');
  await page.getByRole('button', { name: 'Create token' }).click();
  const shown = page.getByLabel('Your new token', { exact: true });
  await expect(shown).toHaveText(/^forge_pat_[A-Za-z0-9_-]{43}$/);
  const token = (await shown.textContent())!;

  const viewer = await viewerOf(page);
  const acme = viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
  const read = await request.get(`${API_URL}/api/v1/orgs/${acme}/tickets/WEB-1`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(read.status()).toBe(200);

  // After a reload the token itself is gone; only its start remains.
  await page.reload();
  await expect(page.getByLabel('Your new token', { exact: true })).toHaveCount(0);
  const row = page
    .getByRole('region', { name: 'Your tokens' })
    .getByRole('listitem')
    .filter({ hasText: 'Work laptop' });
  await expect(row).toContainText('read only');
  await expect(row).toContainText(`${token.slice(0, 14)}…`);
  await expect(page.locator('body')).not.toContainText(token);

  await row.getByRole('button', { name: 'Revoke Work laptop' }).click();
  await page.getByRole('button', { name: 'Revoke token' }).click();
  await expect(row).toContainText('revoked');
  const after = await request.get(`${API_URL}/api/v1/orgs/${acme}/tickets/WEB-1`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(after.status()).toBe(401);
});

test('approving a forge login in the browser', async ({ page, request }) => {
  const started = await request.post(`${API_URL}/api/v1/cli/login`, {
    data: { machine: 'build-box' },
  });
  expect(started.status()).toBe(201);
  const { userCode, deviceCode } = (await started.json()) as {
    userCode: string;
    deviceCode: string;
  };

  await signInAs(page, 'developer');
  await page.goto(`/cli/approve?code=${userCode}`);
  await hydrated(page);
  await expect(page.getByLabel('Code from your terminal')).toHaveValue(userCode);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('build-box')).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByRole('status')).toContainText('Allowed');

  // What the command line would do next: collect the token, once.
  let poll = await request.post(`${API_URL}/api/v1/cli/token`, { data: { deviceCode } });
  let body = (await poll.json()) as { status: string; token?: string };
  for (let i = 0; i < 5 && body.status !== 'approved'; i += 1) {
    await page.waitForTimeout(2500);
    poll = await request.post(`${API_URL}/api/v1/cli/token`, { data: { deviceCode } });
    body = (await poll.json()) as { status: string; token?: string };
  }
  expect(body.status).toBe('approved');
  const me = await request.get(`${API_URL}/api/v1/cli/whoami`, {
    headers: { authorization: `Bearer ${body.token}` },
  });
  expect(((await me.json()) as { user: { displayName: string } }).user.displayName).toBe(
    'Dana Developer',
  );

  await page.goto('/settings/tokens');
  await expect(
    page.getByRole('listitem').filter({ hasText: 'forge login on build-box' }),
  ).toBeVisible();
});

test('a wrong code is explained, and denying signs nothing in', async ({ page, request }) => {
  await signInAs(page, 'developer');
  await page.goto('/cli/approve');
  await hydrated(page);
  await page.getByLabel('Code from your terminal').fill('ABCD-2345');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('That code is unknown or has expired.')).toBeVisible();

  const started = await request.post(`${API_URL}/api/v1/cli/login`, { data: { machine: 'x' } });
  const { userCode, deviceCode } = (await started.json()) as {
    userCode: string;
    deviceCode: string;
  };
  await page.getByLabel('Code from your terminal').fill(userCode.toLowerCase());
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Deny' }).click();
  await expect(page.getByRole('status')).toContainText('Denied');
  const poll = await request.post(`${API_URL}/api/v1/cli/token`, { data: { deviceCode } });
  expect(((await poll.json()) as { status: string }).status).toBe('denied');
});
