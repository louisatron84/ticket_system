import { expect, test, type Page } from '@playwright/test';
import { hydrated, reseed, signInAs, switchTo } from './helpers';

// These tests drive the running stack (database, API and web); see docs/testing.md.

async function screenshot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

test.beforeEach(async ({ page, request }) => {
  await reseed(request);
  await signInAs(page, 'owner');
});

test.describe('Workspace overview', () => {
  test('shows live system status from the API', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Acme Robotics', level: 1 })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'All systems running' })).toBeVisible();

    const table = page.getByRole('table', { name: 'Status of each Forge component' });
    for (const component of ['API', 'Database', 'Migrations']) {
      await expect(table.getByRole('row', { name: new RegExp(`^${component}`) })).toContainText(
        'Running',
      );
    }
    await screenshot(page, 'overview-desktop');
  });

  test('re-checks on demand and confirms with a toast', async ({ page }) => {
    await hydrated(page);
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByText('Status checked')).toBeVisible();
  });

  test('marks the current page in the navigation and breadcrumbs', async ({ page }) => {
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Overview' }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Overview'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('offers only pages that exist, and only those the role may see', async ({ page }) => {
    const links = page.getByRole('navigation', { name: 'Primary' }).getByRole('link');
    await expect(links).toHaveText(['Overview', 'Projects', 'Tickets', 'Members']);
  });
});

test.describe('Sidebar', () => {
  const collapse = (page: Page) => page.getByRole('button', { name: 'Collapse sidebar' });
  const expand = (page: Page) => page.getByRole('button', { name: 'Expand sidebar' });

  async function collapseAndWaitForSave(page: Page) {
    await hydrated(page);
    await expect(collapse(page)).toHaveAttribute('aria-expanded', 'true');
    await collapse(page).click();
    await expect(expand(page)).toHaveAttribute('aria-expanded', 'false');
    await expect
      .poll(
        async () =>
          (await (await page.request.get('/api/v1/me/preferences')).json()).sidebarCollapsed,
      )
      .toBe(true);
  }

  test('collapses and remembers the choice after a reload', async ({ page }) => {
    await collapseAndWaitForSave(page);
    await screenshot(page, 'overview-collapsed');

    await page.reload();
    await expect(expand(page)).toBeVisible();
  });

  test('is rendered collapsed on the very first paint, with no flash of the wide sidebar', async ({
    page,
  }) => {
    await collapseAndWaitForSave(page);
    const html = await (await page.request.get('/w/acme')).text();
    expect(html).toContain('md:w-14');
    expect(html).not.toContain('md:w-58');
  });

  test('is kept on the server, so clearing browser storage changes nothing', async ({ page }) => {
    await collapseAndWaitForSave(page);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await expect(expand(page)).toBeVisible();
  });

  test('belongs to one person: another identity still sees it expanded', async ({ page }) => {
    await collapseAndWaitForSave(page);
    await switchTo(page, 'admin');
    await expect(collapse(page)).toBeVisible();
  });

  test('can also be changed from the profile page, and the two stay in step', async ({ page }) => {
    await page.goto('/settings/profile');
    await hydrated(page);
    await page.getByRole('switch', { name: /Collapse the sidebar/ }).check();
    await expect(expand(page)).toBeVisible();
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect(page.getByRole('switch', { name: /Collapse the sidebar/ })).not.toBeChecked();
  });

  test('is reachable by keyboard from a skip link', async ({ page }) => {
    await page.reload();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });
});

test.describe('Phone width', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('has no horizontal page scroll and tucks the navigation into a drawer', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Wait out the slide transition: fully on screen when open, fully off screen when closed.
    const overviewLink = page.getByRole('link', { name: 'Overview', exact: true });
    const right = async () => {
      const box = await overviewLink.boundingBox();
      return box ? box.x + box.width : Number.NaN;
    };
    const left = async () => (await overviewLink.boundingBox())?.x ?? Number.NaN;

    await expect.poll(right).toBeLessThanOrEqual(0);

    await hydrated(page);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect.poll(left).toBeGreaterThanOrEqual(0);
    await screenshot(page, 'overview-mobile-drawer');

    await page.keyboard.press('Escape');
    await expect.poll(right).toBeLessThanOrEqual(0);
    await screenshot(page, 'overview-mobile');
  });

  test('keeps the members table readable without sideways page scroll', async ({ page }) => {
    await page.goto('/w/acme/members');
    await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('Unknown routes', () => {
  test('answer 404 with a way back', async ({ page }) => {
    const response = await page.goto('/does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to Overview' }).click();
    await expect(page.getByRole('heading', { name: 'Acme Robotics', level: 1 })).toBeVisible();
  });
});
