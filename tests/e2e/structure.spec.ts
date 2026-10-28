import { expect, test, type Page } from '@playwright/test';
import { hydrated, keyboardReady, reseed, signInAs, viewerOf } from './helpers';

// The demo data: WEB-5 is an epic over WEB-8, WEB-11 and WEB-12 (Quenched); WEB-10 is a sub-task
// of WEB-8; API-3 blocks WEB-7.

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

const children = (page: Page) => page.getByRole('region', { name: /^Child tickets/ });
const links = (page: Page) => page.getByRole('region', { name: 'Links' });
const parent = (page: Page) => page.getByRole('region', { name: 'Parent' });

async function openTicket(page: Page, key: string) {
  await page.goto(`/w/acme/tickets/${key}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await hydrated(page);
}

/** Types into a ticket picker and picks the option whose text has `title` in it. */
async function pickTicket(page: Page, label: string, search: string, title: string) {
  await page.getByRole('combobox', { name: label }).fill(search);
  await page.getByRole('option').filter({ hasText: title }).click();
}

async function acmeId(page: Page) {
  const viewer = await viewerOf(page);
  return viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
}

test.describe('tickets with parts', () => {
  test('a parent shows its children, progress and breadcrumb', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-5');

    await expect(children(page).getByRole('heading')).toHaveText('Child tickets · 1 of 4 quenched');
    const top = children(page).getByRole('list', { name: 'Child tickets of WEB-5' });
    await expect(top.getByRole('link', { name: /^WEB-\d+$/ })).toHaveText([
      'WEB-8',
      'WEB-10',
      'WEB-11',
      'WEB-12',
    ]);
    // WEB-10 sits under WEB-8, which can be folded away.
    const underEight = children(page).getByRole('list', { name: 'Child tickets of WEB-8' });
    await expect(underEight).toContainText('WEB-10');
    await page.getByRole('button', { name: 'Hide the children of WEB-8' }).click();
    await expect(underEight).toHaveCount(0);

    const progress = page.getByRole('region', { name: 'Progress' });
    await expect(progress.getByRole('img', { name: '1 of 4 quenched' })).toBeVisible();
    await expect(progress).toContainText('Quenched');
    await expect(progress).toContainText('Not started');

    await openTicket(page, 'WEB-10');
    const crumbs = page.getByRole('navigation', { name: 'Parent tickets' });
    await expect(crumbs.getByRole('link')).toHaveText([
      'WEB-5 Migrate form components to the new design system',
      'WEB-8 Accessibility audit of the main navigation',
    ]);
    await expect(parent(page)).toContainText('WEB-8');
  });

  test('adds a new child and an existing ticket as children, and removes one', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-5');

    await children(page).getByRole('button', { name: 'Add a child ticket' }).click();
    await page.getByLabel('Title of the new child ticket').fill('Restyle the date picker');
    await children(page).getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Added WEB-13 as a child of WEB-5.')).toBeVisible();
    await expect(children(page)).toContainText('Restyle the date picker');

    await children(page).getByRole('button', { name: 'Add an existing ticket' }).click();
    await pickTicket(page, 'Ticket to put under WEB-5', 'dark mode', 'dark mode');
    await expect(page.getByText('Added WEB-2 as a child of WEB-5.')).toBeVisible();
    await expect(children(page).getByRole('link', { name: 'WEB-2', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Remove WEB-11 from WEB-5' }).click();
    await expect(page.getByText('Removed WEB-11 from WEB-5.')).toBeVisible();
    await expect(children(page).getByRole('link', { name: 'WEB-11', exact: true })).toHaveCount(0);
    await expect(children(page).getByRole('heading')).toHaveText('Child tickets · 1 of 5 quenched');
  });

  test('sets and clears the parent from the right bar', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-3');
    await expect(parent(page)).toContainText('None. This is a top-level ticket.');

    await parent(page).getByRole('button', { name: 'Set a parent' }).click();
    await pickTicket(page, 'New parent for WEB-3', 'WEB-1', 'Login redirect');
    await expect(page.getByText('WEB-3 is now under WEB-1.')).toBeVisible();
    await expect(parent(page)).toContainText('WEB-1');
    await expect(page.getByRole('navigation', { name: 'Parent tickets' })).toContainText('WEB-1');

    await parent(page).getByRole('button', { name: 'Remove parent' }).click();
    await expect(page.getByText('WEB-3 is now top level.')).toBeVisible();
    await expect(parent(page)).toContainText('None. This is a top-level ticket.');
    await expect(page.getByRole('navigation', { name: 'Parent tickets' })).toHaveCount(0);
  });

  test('refuses a fourth level and says why', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-1');
    await parent(page).getByRole('button', { name: 'Set a parent' }).click();
    await pickTicket(page, 'New parent for WEB-1', 'WEB-10', 'keyboard shortcuts');
    await expect(
      page.getByText("WEB-10 is already at the third level, so it can't have children."),
    ).toBeVisible();
    await expect(parent(page)).toContainText('None. This is a top-level ticket.');
  });
});

test.describe('links', () => {
  test('links and unlinks a ticket, shown from both sides', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-1');

    await links(page).getByRole('button', { name: 'Link a ticket' }).click();
    await links(page).getByRole('combobox', { name: 'WEB-1 …' }).selectOption('Relates to');
    await pickTicket(page, 'Ticket to link', 'README', 'README');
    await expect(page.getByText('Linked: WEB-1 relates to WEB-4.')).toBeVisible();
    await expect(links(page).getByRole('list', { name: 'Relates to' })).toContainText('WEB-4');

    await openTicket(page, 'WEB-4');
    await expect(links(page).getByRole('list', { name: 'Relates to' })).toContainText('WEB-1');
    await links(page).getByRole('button', { name: 'Remove the link: relates to WEB-1' }).click();
    await expect(page.getByText('Removed the link to WEB-1.')).toBeVisible();
    await expect(links(page)).toContainText('No links.');
  });

  test('a blocked ticket says so at the top of the bar and cannot be quenched', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-7');
    await expect(page.getByRole('status').filter({ hasText: 'Blocked by API-3' })).toBeVisible();
    await expect(links(page).getByRole('list', { name: 'Blocked by' })).toContainText('API-3');

    const posted = await page.request.post(
      `/api/v1/orgs/${await acmeId(page)}/tickets/WEB-1/links`,
      { data: { choice: 'blocked_by', otherKey: 'API-4' } },
    );
    expect(posted.status()).toBe(201);
    await openTicket(page, 'WEB-1');
    await expect(page.getByRole('status').filter({ hasText: 'Blocked by API-4' })).toBeVisible();
    await page.getByLabel('Status').selectOption({ label: 'Quenched' });
    await expect(page.getByText("WEB-1 can't be quenched while API-4 is open.")).toBeVisible();
    await expect(page.getByLabel('Status').locator('option:checked')).toHaveText('In the Forge');

    // Scrapping it is still allowed.
    await page.reload();
    await hydrated(page);
    await page.getByLabel('Status').selectOption({ label: 'Scrapped' });
    await expect(page.getByLabel('Status').locator('option:checked')).toHaveText('Scrapped');
  });
});

test.describe('marking a duplicate', () => {
  test('from the actions menu', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-2');
    await page.getByRole('button', { name: 'Actions for WEB-2' }).click();
    await page.getByRole('button', { name: 'Mark as duplicate…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Mark WEB-2 as a duplicate' });
    await pickTicket(page, 'The original ticket', 'WEB-8', 'Accessibility audit');
    await expect(page.getByText('Marked WEB-2 as a duplicate of WEB-8.')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Status').locator('option:checked')).toHaveText('Scrapped');
    await expect(links(page).getByRole('list', { name: 'Duplicates' })).toContainText('WEB-8');
  });

  test('from a card menu on the board', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/projects/WEB/board');
    await hydrated(page);
    await page.getByRole('button', { name: 'Actions for WEB-11' }).click();
    await page.getByRole('button', { name: 'Mark as duplicate…' }).click();
    await pickTicket(page, 'The original ticket', 'WEB-8', 'Accessibility audit');
    await expect(page.getByText('Marked WEB-11 as a duplicate of WEB-8.')).toBeVisible();
    // Scrapped is hidden on the board by default, so the card leaves it.
    await expect(page.locator('li[data-ticket="WEB-11"]')).toHaveCount(0);
  });

  test('from the command menu', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-8');
    await keyboardReady(page);
    await page.waitForFunction(() => document.documentElement.dataset.pageCommands === 'ready');
    await page.keyboard.press('Control+k');
    const menu = page.getByRole('dialog', { name: 'Command menu' });
    await menu.getByRole('combobox').fill('duplicate');
    await menu.getByRole('option', { name: 'Mark as duplicate…' }).click();
    await pickTicket(page, 'The original ticket', 'WEB-2', 'dark mode');
    await expect(page.getByText('Marked WEB-8 as a duplicate of WEB-2.')).toBeVisible();
    await expect(page.getByLabel('Status').locator('option:checked')).toHaveText('Scrapped');
  });
});

test('a read-only account sees the structure but nothing to change it with', async ({ page }) => {
  await signInAs(page, 'readonly');
  await openTicket(page, 'WEB-5');
  await expect(children(page)).toContainText('WEB-8');
  for (const name of [
    'Add a child ticket',
    'Add an existing ticket',
    'Remove WEB-8 from WEB-5',
    'Link a ticket',
    'Set a parent',
    'Actions for WEB-5',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(
      name === 'Actions for WEB-5' ? 1 : 0,
    );
  }
  await page.getByRole('button', { name: 'Actions for WEB-5' }).click();
  await expect(page.getByRole('button', { name: 'Mark as duplicate…' })).toHaveCount(0);
});

test.describe('only what the server allows is offered', () => {
  test('a sub-task at the third level offers no way to add children', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-10');
    await expect(page.getByRole('button', { name: 'Add a child ticket' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add an existing ticket' })).toHaveCount(0);
    // It can still be linked and moved.
    await expect(links(page).getByRole('button', { name: 'Link a ticket' })).toBeVisible();
  });

  test('a ticket in an archived project offers no parent, link or duplicate changes', async ({
    page,
  }) => {
    await signInAs(page, 'admin');
    const archived = await page.request.patch(`/api/v1/orgs/${await acmeId(page)}/projects/API`, {
      data: { archived: true },
    });
    expect(archived.status()).toBe(200);

    await openTicket(page, 'API-1');
    await expect(page.getByRole('button', { name: 'Link a ticket' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Set a parent' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Actions for API-1' }).click();
    await expect(page.getByRole('button', { name: 'Mark as duplicate…' })).toHaveCount(0);

    // Nor is a ticket of that project offered when linking from elsewhere.
    await openTicket(page, 'WEB-1');
    await links(page).getByRole('button', { name: 'Link a ticket' }).click();
    await page.getByRole('combobox', { name: 'Ticket to link' }).fill('Rate limit');
    await page.waitForTimeout(800);
    await expect(
      page
        .getByRole('listbox', { name: 'Ticket to link', includeHidden: true })
        .getByRole('option'),
    ).toHaveCount(0);
    // A ticket of an open project is still found.
    await page.getByRole('combobox', { name: 'Ticket to link' }).fill('README');
    await expect(
      page.getByRole('listbox', { name: 'Ticket to link' }).getByRole('option'),
    ).toHaveCount(1);
  });
});
