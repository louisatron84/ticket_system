import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Direct address of the e2e API, for calls that deliberately bypass the web app. */
export const API_URL = 'http://127.0.0.1:4100';

export const IDENTITIES = {
  owner: 'Olivia Owner',
  admin: 'Adam Admin',
  developer: 'Dana Developer',
  reviewer: 'Riley Reviewer',
  readonly: 'Remy Read-only',
  restricted: 'Casey Restricted',
  'other-owner': 'Nora Northwind',
} as const;

export type IdentityKey = keyof typeof IDENTITIES;

/** The workspace overview, which is where signing in or switching always ends up. */
const WORKSPACE_URL = /\/w\/[^/]+$/;

/** Restores the seeded demo data. Goes straight to the API's dev reset route. */
export async function reseed(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${API_URL}/api/dev/reset`);
  expect(response.status()).toBe(204);
}

/** Signs in through the real login page. */
export async function signInAs(page: Page, key: IdentityKey): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: `Sign in as ${IDENTITIES[key]}` }).click();
  // Wait for the landing redirect to finish, not just for the shell to appear.
  await expect(page).toHaveURL(WORKSPACE_URL);
  await expect(accountMenuButton(page)).toContainText(IDENTITIES[key]);
  await hydrated(page);
}

export const accountMenuButton = (page: Page) =>
  page.locator('button[aria-controls="account-menu"]');

/**
 * Waits until React has hydrated the page, i.e. until the account menu button really responds to
 * clicks. A click that lands earlier is silently lost, which makes tests flaky.
 */
export async function hydrated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-controls="account-menu"]');
    return !!button && Object.keys(button).some((key) => key.startsWith('__reactProps'));
  });
}

/** Opens the account menu if it is not already open. */
export async function openAccountMenu(page: Page): Promise<void> {
  await hydrated(page);
  const button = accountMenuButton(page);
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

/** A row of the dev switcher inside the open account menu (not the menu button itself). */
export const switcherRow = (page: Page, key: IdentityKey) =>
  page.locator('#account-menu').getByRole('button', { name: new RegExp(IDENTITIES[key]) });

/** Opens the account menu and switches test account without signing out. */
export async function switchTo(page: Page, key: IdentityKey): Promise<void> {
  await openAccountMenu(page);
  await switcherRow(page, key).click();
  await expect(page).toHaveURL(WORKSPACE_URL);
  await expect(accountMenuButton(page)).toContainText(IDENTITIES[key]);
  await hydrated(page);
}

/** Reads the session's memberships through the web proxy, as the browser itself would. */
export async function viewerOf(page: Page) {
  const response = await page.request.get('/api/v1/me');
  expect(response.status()).toBe(200);
  return response.json() as Promise<{
    user: { id: string; email: string; displayName: string };
    memberships: {
      organisation: { id: string; slug: string; name: string };
      role: { id: string; key: string; name: string };
      permissions: string[];
    }[];
  }>;
}

/**
 * Waits until the workspace's keyboard shortcuts and command menu are listening, and the page's own
 * content is on screen: a page streams in hidden behind its loading skeleton, and a shortcut that
 * acts on the page (focus the search box, walk the list) needs it to be shown.
 */
export async function keyboardReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.keyboard === 'ready' &&
      Array.from(document.querySelectorAll('h1')).some(
        (heading) => (heading as HTMLElement).offsetParent !== null,
      ),
  );
}
