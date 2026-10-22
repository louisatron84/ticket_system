import { expect, test } from '@playwright/test';
import { openAccountMenu, reseed, signInAs, switchTo, switcherRow } from './helpers';

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

test.describe('signing in and out', () => {
  test('sends someone who is not signed in to the login page', async ({ page }) => {
    for (const path of ['/', '/w/acme', '/w/acme/members', '/settings/profile']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test('says plainly that this is development sign-in', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
    await expect(page.getByRole('note')).toContainText('Development sign-in');
    await expect(page.getByRole('button', { name: /^Sign in as / })).toHaveCount(7);
  });

  test('signs in as an identity and lands in its workspace', async ({ page }) => {
    await signInAs(page, 'owner');
    await expect(page).toHaveURL(/\/w\/acme$/);
    await expect(page.getByRole('heading', { name: 'Acme Robotics', level: 1 })).toBeVisible();
    await expect(page.getByText('Your role: Owner')).toBeVisible();
  });

  test('keeps a signed-in person away from the login page', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.goto('/login');
    await expect(page).toHaveURL(/\/w\/acme$/);
  });

  test('signs out, and the back button does not reveal workspace content', async ({ page }) => {
    await signInAs(page, 'owner');
    await page.goto('/w/acme/members');
    await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();

    await openAccountMenu(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Members' })).toHaveCount(0);
    await expect(page.getByText('owner@acme.test')).toHaveCount(0);
  });

  test('notices a session that disappeared mid-visit', async ({ page, context }) => {
    await signInAs(page, 'owner');
    await context.clearCookies();
    await page.goto('/w/acme');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('a replayed cookie stops working after sign-out', async ({ page, context }) => {
    await signInAs(page, 'owner');
    const saved = await context.cookies();
    await openAccountMenu(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await context.addCookies(saved);
    const response = await page.request.get('/api/v1/me');
    expect(response.status()).toBe(401);
  });
});

test.describe('the switcher refuses to be reached under a foreign name (DNS rebinding)', () => {
  const WEB = 'http://127.0.0.1:3100';

  test('works under a loopback name', async ({ request }) => {
    const response = await request.get(`${WEB}/api/dev/identities`);
    expect(response.status()).toBe(200);
  });

  test('gets nothing under a foreign Host header, for every switcher route', async ({
    request,
  }) => {
    const headers = { host: 'evil.test' };
    const attempts = [
      await request.get(`${WEB}/api/dev/identities`, { headers }),
      await request.post(`${WEB}/api/dev/session`, { headers, data: { key: 'owner' } }),
      await request.post(`${WEB}/api/dev/reset`, { headers }),
    ];
    for (const response of attempts) {
      expect(response.status()).toBe(404);
      expect(response.headers()['set-cookie']).toBeUndefined();
    }
  });

  test('also gets nothing for a look-alike name', async ({ request }) => {
    const response = await request.get(`${WEB}/api/dev/identities`, {
      headers: { host: 'localhost.evil.test' },
    });
    expect(response.status()).toBe(404);
  });
});

test.describe('switching test accounts without signing out', () => {
  test('moves between identities and always shows who is current', async ({ page }) => {
    await signInAs(page, 'owner');

    for (const key of ['developer', 'readonly', 'restricted', 'admin'] as const) {
      await switchTo(page, key);
      await openAccountMenu(page);
      const current = switcherRow(page, key);
      await expect(current).toBeDisabled();
      await expect(current).toContainText('Current');
      await page.keyboard.press('Escape');
    }
  });

  test('marks the switcher as development-only', async ({ page }) => {
    await signInAs(page, 'owner');
    await openAccountMenu(page);
    await expect(page.getByText('Development only: switch test account')).toBeVisible();
    await expect(page.getByText('development', { exact: true })).toBeVisible();
  });

  test('resets the demo data only after confirmation', async ({ page }) => {
    await signInAs(page, 'owner');
    await openAccountMenu(page);
    await page.getByRole('button', { name: 'Reset demo data' }).click();

    const dialog = page.getByRole('dialog', { name: 'Reset all demo data?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/w\/acme$/);

    await openAccountMenu(page);
    await page.getByRole('button', { name: 'Reset demo data' }).click();
    await page.getByRole('button', { name: 'Reset everything' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
