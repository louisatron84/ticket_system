import { expect, test, type Browser, type Page } from '@playwright/test';
import { hydrated, reseed, signInAs, viewerOf, type IdentityKey } from './helpers';

// WEB has triage switched on in the demo data; Rowan Reporter may create tickets but not edit
// them, so Rowan's WEB tickets wait in triage.

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

async function personIn(browser: Browser, who: IdentityKey): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, who);
  return page;
}

async function openTicket(page: Page, key: string) {
  await page.goto(`/w/acme/tickets/${key}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await hydrated(page);
}

const bell = (page: Page) => page.getByRole('button', { name: /^Notifications/ });

test('the bell counts a new notification live, without a reload', async ({ browser }) => {
  const admin = await personIn(browser, 'admin');
  await admin.goto('/w/acme');
  await hydrated(admin);
  await expect(bell(admin)).toHaveAccessibleName('Notifications');

  const owner = await personIn(browser, 'owner');
  await openTicket(owner, 'WEB-4');
  await owner.getByLabel('Assignee').selectOption({ label: 'Adam Admin' });

  // Adam's page was never reloaded.
  await expect(bell(admin)).toHaveAccessibleName('Notifications, 1 unread', { timeout: 15_000 });
  await bell(admin).click();
  const panel = admin.getByRole('dialog', { name: 'Notifications' });
  await expect(panel).toContainText('Olivia Owner assigned WEB-4 to you');
  await panel.getByRole('link', { name: /assigned WEB-4 to you/ }).click();
  await expect(admin).toHaveURL(/\/w\/acme\/tickets\/WEB-4$/);
  await expect(bell(admin)).toHaveAccessibleName('Notifications');
});

test('the inbox lists, filters and marks read', async ({ page, request }) => {
  await signInAs(page, 'owner');
  const viewer = await viewerOf(page);
  const acme = viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
  const developer = (await (await page.request.get(`/api/v1/orgs/${acme}/members`)).json()) as {
    user: { id: string; displayName: string };
  }[];
  const dana = developer.find((m) => m.user.displayName === 'Dana Developer')!.user.id;
  await page.request.post(`/api/v1/orgs/${acme}/tickets/WEB-2/comments`, {
    data: { body: `@[Dana Developer](user:${dana}) please check` },
  });
  void request;

  const dev = await page
    .context()
    .browser()!
    .newContext()
    .then((c) => c.newPage());
  await signInAs(dev, 'developer');
  await dev.goto('/w/acme/inbox');
  await hydrated(dev);
  const list = dev.getByRole('region', { name: 'Your notifications' });
  await expect(list).toContainText('Olivia Owner mentioned you in a comment on WEB-2');
  await dev.getByRole('link', { name: /Unread/ }).click();
  // The filter is a navigation: wait for it to land before acting on the new page.
  await expect(dev).toHaveURL(/filter=unread/);
  await hydrated(dev);
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await dev.getByRole('button', { name: 'Mark all read' }).click();
  await expect(dev.getByRole('link', { name: 'Unread', exact: true })).toBeVisible();
});

test('watching a ticket, and turning a kind of notification off', async ({ page }) => {
  await signInAs(page, 'reviewer');
  await openTicket(page, 'WEB-3');
  const watchers = page.getByRole('region', { name: /Watchers/ });
  await watchers.getByRole('button', { name: 'Watch' }).click();
  await expect(watchers).toContainText('Riley Reviewer');
  await watchers.getByRole('button', { name: 'Stop watching' }).click();
  await expect(watchers).not.toContainText('Riley Reviewer');

  await page.goto('/settings/profile');
  await hydrated(page);
  const setting = page.getByRole('switch', { name: 'A comment on a ticket I watch' });
  await expect(setting).toBeChecked();
  await setting.uncheck();
  await page.reload();
  await expect(
    page.getByRole('switch', { name: 'A comment on a ticket I watch' }),
  ).not.toBeChecked();
});

test('My work groups my open tickets, and Assigned to me filters any list', async ({ page }) => {
  await signInAs(page, 'developer');
  await page.goto('/w/acme/my-work');
  await hydrated(page);
  await expect(page.getByRole('heading', { level: 1, name: 'My work' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Overdue' })).toContainText('WEB-1');
  await page.getByRole('link', { name: 'Watching' }).click();
  await expect(page).toHaveURL(/tab=watching/);

  await page.goto('/w/acme/tickets');
  await hydrated(page);
  const toggle = page.getByRole('button', { name: 'Assigned to me' });
  await toggle.click();
  await expect(page).toHaveURL(/assignee=me/);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift+M');
  await expect(page).not.toHaveURL(/assignee=me/);
});

test('a reporter’s ticket waits in triage until two people agree', async ({ browser }) => {
  const reporter = await personIn(browser, 'reporter');
  await reporter.goto('/w/acme/tickets/new?project=WEB');
  await hydrated(reporter);
  await reporter.getByLabel('Title').fill('Export button does nothing');
  await reporter.getByRole('button', { name: 'Create ticket' }).click();
  await expect(reporter.getByRole('heading', { name: /In triage: waiting/ })).toBeVisible();
  const key = /\/tickets\/([A-Z]+-\d+)$/.exec(reporter.url())![1]!;

  const dana = await personIn(browser, 'developer');
  await dana.goto('/w/acme/triage');
  await hydrated(dana);
  await expect(dana.getByRole('list', { name: 'Waiting for triage' })).toContainText(key);
  await openTicket(dana, key);
  await dana.getByRole('button', { name: 'Accept to Warming' }).click();
  await dana.getByRole('button', { name: 'Propose' }).click();
  await expect(dana.getByRole('heading', { name: /awaiting approval/ })).toBeVisible();
  await expect(
    dana.getByText('Someone else has to approve or reject your proposal.'),
  ).toBeVisible();
  await expect(dana.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  const adam = await personIn(browser, 'admin');
  await openTicket(adam, key);
  await adam.getByRole('button', { name: 'Approve' }).click();
  await expect(adam.getByRole('heading', { name: /In triage/ })).toHaveCount(0);
  await expect(adam.getByRole('region', { name: 'Activity' })).toContainText(
    "approved Dana Developer's proposal: Accept to Warming",
  );

  await reporter.goto('/w/acme/inbox');
  await expect(reporter.getByRole('region', { name: 'Your notifications' })).toContainText(
    `${key} was accepted onto the board`,
  );
});

test('a project’s triage settings: switch, rota and a rule', async ({ page }) => {
  await signInAs(page, 'owner');
  await page.goto('/w/acme/projects/WEB/settings');
  await hydrated(page);
  await expect(page.getByRole('switch', { name: /New tickets go to triage/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /Adam Admin/ }).check();
  await page.getByRole('button', { name: 'Add a rule' }).click();
  const rule = page.getByRole('group', { name: 'Rule 1' });
  await rule.getByLabel('Rule name').fill('Exports');
  await rule.getByLabel('Title contains (all words)').fill('export');
  await rule.getByLabel('Assignee').selectOption({ label: 'Dana Developer' });
  await page.getByRole('button', { name: 'Save triage settings' }).click();
  await expect(page.getByText('On duty this week: Adam Admin.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Rule 1: Exports' })).toBeVisible();
});
