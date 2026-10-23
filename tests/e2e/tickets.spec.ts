import { expect, test, type Page } from '@playwright/test';
import { hydrated, reseed, signInAs, switchTo, viewerOf } from './helpers';

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

const activity = (page: Page) => page.getByRole('region', { name: 'Activity' });

async function acmeId(page: Page) {
  const viewer = await viewerOf(page);
  return viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
}

async function openTicket(page: Page, key: string) {
  await page.goto(`/w/acme/tickets/${key}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await hydrated(page);
}

test.describe('creating a ticket', () => {
  test('a developer creates one, is credited, and it starts in the first status', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets/new?project=WEB');
    await hydrated(page);

    await page.getByLabel('Title').fill('Brand new ticket');
    await page.getByLabel('Description').fill('Steps\nto reproduce');
    await page.getByLabel('Priority').selectOption({ label: 'High' });
    await page.getByRole('button', { name: 'Create ticket' }).click();

    await expect(page).toHaveURL(/\/w\/acme\/tickets\/WEB-13$/);
    await expect(page.getByRole('heading', { name: 'Brand new ticket', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Status')).toHaveValue(/.+/);
    await expect(page.getByLabel('Status').locator('option:checked')).toHaveText('Backlog');
    await expect(activity(page)).toContainText('Dana Developer');
    await expect(activity(page)).toContainText('created this ticket');
    // Line breaks in the description are kept.
    await expect(page.getByText('Steps')).toBeVisible();
  });

  test('a mistake is explained next to the field, and what was typed is kept', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets/new?project=WEB');
    await hydrated(page);

    await page.getByLabel('Title').fill('Half done');
    await page.getByLabel('Estimate').fill('soon');
    await page.getByRole('button', { name: 'Create ticket' }).click();

    await expect(page.getByText('Write it like 90, 45m, 1h 30m or 1.5h.')).toBeVisible();
    await expect(page.getByLabel('Title')).toHaveValue('Half done');
    await expect(page).toHaveURL(/\/tickets\/new/);
  });

  test('a read-only member has no way to create a ticket', async ({ page }) => {
    await signInAs(page, 'readonly');
    await page.goto('/w/acme/tickets');
    await expect(page.getByRole('link', { name: 'New ticket' })).toHaveCount(0);
    await page.goto('/w/acme/tickets/new');
    await expect(
      page.getByRole('heading', { name: "You don't have access to creating tickets" }),
    ).toBeVisible();
  });
});

test.describe('changing a ticket', () => {
  test('each field saves on its own and shows up in the history', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-2');

    await page.getByRole('button', { name: 'Edit title' }).click();
    await page.getByLabel('Title').fill('A better title');
    await page.getByLabel('Title').press('Enter');
    await expect(page.getByRole('heading', { name: 'A better title', level: 1 })).toBeVisible();
    await expect(activity(page)).toContainText('changed the title from');

    await page.getByLabel('Priority').selectOption({ label: 'Critical' });
    await expect(activity(page)).toContainText('changed the priority from Normal to Critical');

    await page.getByLabel('Assignee').selectOption({ label: 'Riley Reviewer' });
    await expect(activity(page)).toContainText('Riley Reviewer');

    // A date is saved on purpose, with its own button.
    await page.getByLabel('Due date').fill('2031-05-01');
    await page.getByRole('button', { name: 'Save due date' }).click();
    await expect(activity(page)).toContainText('changed the due date from');
    await expect(page.getByRole('button', { name: 'Save due date' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit labels' }).click();
    // Controlled by the saved ticket, so it ticks once the save has come back.
    await page.getByRole('checkbox', { name: 'security' }).click();
    await expect(activity(page)).toContainText('added the label security');

    // Everything is still there after a reload.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'A better title', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Priority').locator('option:checked')).toHaveText('Critical');
    await expect(page.getByLabel('Due date')).toHaveValue('2031-05-01');
  });

  test('only the statuses the workflow allows are offered, and moving records it', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-2'); // Open

    const options = await page.getByLabel('Status').locator('option').allTextContents();
    expect(new Set(options)).toEqual(
      new Set(['Open', 'Backlog', 'In Progress', 'Blocked', 'Cancelled']),
    );
    expect(options).not.toContain('Done');
    expect(options).not.toContain('In Review');

    await page.getByLabel('Status').selectOption({ label: 'In Progress' });
    await expect(activity(page)).toContainText('moved this from Open to In Progress');
    await expect(page.getByLabel('Status').locator('option:checked')).toHaveText('In Progress');
  });

  test('a comment appears in the history, as plain text', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-2');

    await page.getByLabel('Add a comment').fill('Looks fine <b>not bold</b>');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();

    const comment = activity(page).getByRole('article', { name: 'Comment by Dana Developer' });
    await expect(comment).toContainText('Looks fine <b>not bold</b>');
    await expect(comment.locator('b')).toHaveCount(0);
    await expect(page.getByLabel('Add a comment')).toHaveValue('');
  });

  test('a person can edit and delete their own comment', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-2');

    await page.getByLabel('Add a comment').fill('First version');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    const comment = activity(page).getByRole('article', { name: 'Comment by Dana Developer' });
    await expect(comment).toContainText('First version');

    await comment.getByRole('button', { name: 'Edit comment' }).click();
    await page.getByLabel('Edit your comment').fill('Second version');
    await page.getByRole('button', { name: 'Save comment' }).click();
    await expect(comment).toContainText('Second version');
    await expect(comment).toContainText('edited');

    await comment.getByRole('button', { name: 'Delete comment' }).click();
    await page.getByRole('button', { name: 'Delete comment', exact: true }).last().click();
    await expect(
      activity(page).getByRole('article', { name: 'Comment by Dana Developer' }),
    ).toHaveCount(0);
    await expect(activity(page)).toContainText('deleted a comment');
  });

  test('a stale edit is refused with a banner, and what was typed stays', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-2');

    // A second tab saves first.
    const other = await page.context().newPage();
    await openTicket(other, 'WEB-2');
    await other.getByLabel('Priority').selectOption({ label: 'Critical' });
    await expect(activity(other)).toContainText('changed the priority from Normal to Critical');
    await other.close();

    // The first tab still holds the old version.
    await page.getByLabel('Estimate').fill('2h');
    await page.getByLabel('Estimate').press('Tab');
    const banner = page.getByRole('alert').filter({ hasText: 'This ticket changed' });
    await expect(banner).toBeVisible();
    await expect(page.getByLabel('Estimate')).toHaveValue('2h');

    await banner.getByRole('button', { name: 'Reload' }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByLabel('Priority').locator('option:checked')).toHaveText('Critical');
  });
});

test.describe('who may do what', () => {
  test('a reviewer can comment but has no field controls', async ({ page }) => {
    await signInAs(page, 'reviewer');
    await openTicket(page, 'WEB-3');

    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit title' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit labels' })).toHaveCount(0);
    await expect(page.getByLabel('Add a comment')).toBeVisible();
  });

  test('a read-only member sees the values but no controls and no comment box', async ({
    page,
  }) => {
    await signInAs(page, 'readonly');
    await openTicket(page, 'WEB-3');

    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByText('cannot comment on tickets')).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Ticket fields' }).getByText('In Review'),
    ).toBeVisible();
  });

  test('crafted API calls are refused the same way', async ({ page }) => {
    await signInAs(page, 'readonly');
    const acme = await acmeId(page);
    const read = await page.request.get(`/api/v1/orgs/${acme}/tickets/WEB-1`);
    expect(read.status()).toBe(200);
    const write = await page.request.patch(`/api/v1/orgs/${acme}/tickets/WEB-1`, {
      data: { version: (await read.json()).version, title: 'Defaced' },
    });
    expect(write.status()).toBe(403);
    const comment = await page.request.post(`/api/v1/orgs/${acme}/tickets/WEB-1/comments`, {
      data: { body: 'hello' },
    });
    expect(comment.status()).toBe(403);

    await switchTo(page, 'restricted');
    expect((await page.request.get(`/api/v1/orgs/${acme}/tickets/WEB-1`)).status()).toBe(403);

    await switchTo(page, 'other-owner');
    expect((await page.request.get(`/api/v1/orgs/${acme}/tickets/WEB-1`)).status()).toBe(404);
    expect((await page.request.get(`/api/v1/orgs/${acme}/tickets/WEB-1/timeline`)).status()).toBe(
      404,
    );
  });

  test('another workspace’s ticket is the same not-found page as one that is missing', async ({
    page,
  }) => {
    // The same person asks for a ticket that exists elsewhere and one that exists nowhere.
    await signInAs(page, 'other-owner');
    const foreign = await page.goto('/w/acme/tickets/WEB-1');
    expect(foreign?.status()).toBe(404);
    const foreignText = await page.locator('main').innerText();
    expect(foreignText).not.toContain('Login redirect');

    const missing = await page.goto('/w/acme/tickets/WEB-9999');
    expect(missing?.status()).toBe(404);
    expect(await page.locator('main').innerText()).toBe(foreignText);
  });

  test('a ticket that does not exist in your own workspace shows the not-found page', async ({
    page,
  }) => {
    await signInAs(page, 'owner');
    await page.goto('/w/acme/tickets/WEB-9999');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await page.goto('/w/acme/tickets/..%2Fx');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });
});

test.describe('text that tries to be something else', () => {
  test('markup in a title, description and comment is shown, not run', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets/new?project=WEB');
    await hydrated(page);

    const title = '<img src=x onerror="window.__pwned = 1">';
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Description').fill('<script>window.__pwned = 2</script>');
    await page.getByRole('button', { name: 'Create ticket' }).click();
    await expect(page).toHaveURL(/\/tickets\/WEB-13$/);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await page.getByLabel('Add a comment').fill('<svg onload="window.__pwned = 3"></svg>');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(activity(page)).toContainText('<svg onload=');

    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    await expect(page.locator('main svg[onload]')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
    expect(dialogs).toEqual([]);
  });
});

test.describe('the list', () => {
  test('filters come from the address, survive a reload, and clear', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets');
    await hydrated(page);

    await page.getByRole('button', { name: 'Priority' }).click();
    // The checkbox follows the address, so it ticks once the navigation has finished.
    await page.getByRole('checkbox', { name: 'High', exact: true }).click();
    await expect(page).toHaveURL(/priority=high/);
    await expect(page.getByRole('button', { name: 'Remove filter Priority: High' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Remove filter Priority: High' })).toBeVisible();
    const rows = page.locator('tbody tr');
    const keysBefore = await rows.locator('th').allTextContents();
    expect(keysBefore.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page).toHaveURL(/\/w\/acme\/tickets$/);
    expect(await rows.count()).toBeGreaterThan(keysBefore.length);
  });

  test('"Me", "Overdue" and sorting give exactly the tickets that match', async ({ page }) => {
    await signInAs(page, 'developer');

    await page.goto('/w/acme/tickets?assignee=me&priority=high&priority=critical');
    const mine = (await page.locator('tbody tr th').allTextContents())
      .map((text) => text.trim())
      .sort();
    expect(mine).toEqual(['API-3', 'WEB-1', 'WEB-3', 'WEB-7']);

    await page.goto('/w/acme/tickets?due=overdue');
    const overdue = (await page.locator('tbody tr th').allTextContents()).map((text) =>
      text.trim(),
    );
    for (const key of ['API-7', 'WEB-1', 'WEB-7', 'WEB-11']) expect(overdue).toContain(key);
    await expect(page.locator('tbody tr', { hasText: 'overdue' })).toHaveCount(overdue.length);

    await page.goto('/w/acme/tickets');
    await hydrated(page);
    await page.getByRole('link', { name: 'Priority' }).click();
    await expect(page).toHaveURL(/sort=priority/);
    await expect(page.locator('tbody tr').first()).toContainText('Critical');
  });

  test('says so when nothing matches, and offers the way back', async ({ page }) => {
    await signInAs(page, 'owner');
    await page.goto('/w/acme/tickets?q=zzzzzzzz');
    await expect(
      page.getByRole('heading', { name: 'No tickets match these filters' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });

  test('a link with some bad filters still opens, and says it ignored them', async ({ page }) => {
    await signInAs(page, 'owner');
    await page.goto('/w/acme/tickets?pageSize=100000&sort=x&q=login');
    await expect(
      page.getByText('Some filters in the link were not valid and have been ignored.'),
    ).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(1);
  });

  test('a personal view is private, and a shared one is seen by everyone', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets?priority=high');
    await hydrated(page);
    await page.getByRole('button', { name: 'Views' }).click();
    await page.getByRole('button', { name: 'Save current view' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('High work');
    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByText('Saved “High work”.')).toBeVisible();
    await page.getByRole('button', { name: 'Views' }).click();
    await expect(page.getByRole('link', { name: 'High work' })).toBeVisible();
    await page.keyboard.press('Escape');

    await switchTo(page, 'admin');
    await page.goto('/w/acme/tickets?assignee=me');
    await hydrated(page);
    await page.getByRole('button', { name: 'Views' }).click();
    await page.getByRole('button', { name: 'Save current view' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Team view');
    await dialog.getByLabel('Everyone in the workspace').check();
    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByText('Saved “Team view”.')).toBeVisible();

    await switchTo(page, 'reviewer');
    await page.goto('/w/acme/tickets');
    await hydrated(page);
    await page.getByRole('button', { name: 'Views' }).click();
    await expect(page.getByRole('link', { name: 'Team view' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'High work' })).toHaveCount(0);

    // Opening it applies its filters.
    await page.getByRole('link', { name: 'Team view' }).click();
    await expect(page).toHaveURL(/assignee=me/);
  });
});
