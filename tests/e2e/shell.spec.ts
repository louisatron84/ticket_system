import { expect, test, type Page } from '@playwright/test';

// These tests drive the running stack (database, API and web); see docs/testing.md.

async function screenshot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

test.describe('Overview', () => {
  test('shows live system status from the API', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
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
    await page.goto('/');
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.getByText('Status checked')).toBeVisible();
  });

  test('marks the current page in the navigation', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Overview' }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Overview'),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('offers only routes that exist', async ({ page }) => {
    await page.goto('/');
    const links = page.getByRole('navigation', { name: 'Primary' }).getByRole('link');
    await expect(links).toHaveCount(1);
  });
});

test.describe('Sidebar', () => {
  test('collapses and remembers the choice after a reload', async ({ page }) => {
    await page.goto('/');
    const collapse = page.getByRole('button', { name: 'Collapse sidebar' });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await collapse.click();

    const expand = page.getByRole('button', { name: 'Expand sidebar' });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await screenshot(page, 'overview-collapsed');

    await page.reload();
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('forge.sidebar.collapsed'))).toBe('true');
  });

  test('ignores a corrupt stored preference', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    await page.addInitScript(() => localStorage.setItem('forge.sidebar.collapsed', '{'));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('keeps working when browser storage is blocked', async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', (error) => errors.push(error));
    await page.addInitScript(() => {
      const blocked = () => {
        throw new DOMException('blocked', 'SecurityError');
      };
      Storage.prototype.getItem = blocked;
      Storage.prototype.setItem = blocked;
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('is reachable by keyboard from a skip link', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });
});

test.describe('Phone width', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('has no horizontal page scroll and tucks the navigation into a drawer', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Wait out the slide transition: fully on screen when open, fully off screen when closed.
    const overviewLink = page.getByRole('link', { name: 'Overview' });
    const right = async () => {
      const box = await overviewLink.boundingBox();
      return box ? box.x + box.width : Number.NaN;
    };
    const left = async () => (await overviewLink.boundingBox())?.x ?? Number.NaN;

    await expect.poll(right).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect.poll(left).toBeGreaterThanOrEqual(0);
    await screenshot(page, 'overview-mobile-drawer');

    await page.keyboard.press('Escape');
    await expect.poll(right).toBeLessThanOrEqual(0);
    await screenshot(page, 'overview-mobile');
  });
});

test.describe('Unknown routes', () => {
  test('answer 404 with a way back', async ({ page }) => {
    const response = await page.goto('/does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to Overview' }).click();
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  });
});
