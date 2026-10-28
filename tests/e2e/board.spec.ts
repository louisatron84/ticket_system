import { expect, test, type Page } from '@playwright/test';
import { hydrated, reseed, signInAs, switchTo, viewerOf } from './helpers';

// Wide enough to show most of the seven columns at once, so a card can be dragged to any of them.
test.use({ viewport: { width: 1920, height: 1000 } });

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

const column = (page: Page, name: string) => page.locator(`section[aria-label^="${name},"]`);
const card = (page: Page, key: string) => page.locator(`li[data-ticket="${key}"]`);
const actionsButton = (page: Page, key: string) =>
  page.getByRole('button', { name: `Actions for ${key}` });
const actionsMenu = (page: Page, key: string) =>
  page.getByRole('group', { name: `${key} actions` });

async function openBoard(page: Page) {
  await page.goto('/w/acme/projects/WEB/board');
  await expect(page.getByRole('heading', { name: 'Web App', level: 1 })).toBeVisible();
  await hydrated(page);
}

/** Picks a card up by its grip with the mouse, carries it over a column and lets go. */
async function dragCard(page: Page, key: string, toColumn: string) {
  const grip = page.getByRole('button', { name: `Pick up ${key} to move it` });
  const from = (await grip.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
  const target = (await column(page, toColumn).boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + 100, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test.describe('the board', () => {
  test('has a column for every status but Scrapped, with the seeded counts', async ({ page }) => {
    await signInAs(page, 'owner');
    await openBoard(page);

    const expected: [string, string][] = [
      ['Cold Steel', 'Cold Steel, 2 tickets'],
      ['Warming', 'Warming, 3 tickets'],
      ['In the Forge', 'In the Forge, 2 tickets'],
      ['Tempering', 'Tempering, 1 ticket'],
      ['Jammed', 'Jammed, 1 ticket'],
      ['Quenched', 'Quenched, 2 tickets'],
    ];
    for (const [name, label] of expected) {
      await expect(column(page, name)).toHaveAttribute('aria-label', label);
    }
    // Scrapped work is hidden until a person chooses to see it (see the Display menu tests).
    await expect(column(page, 'Scrapped')).toHaveCount(0);
    await expect(card(page, 'WEB-3')).toContainText('Checkout page is slow on mobile');
  });

  test('at a wide window every column is on screen, sharing the width', async ({ page }) => {
    await signInAs(page, 'owner');
    await openBoard(page);

    const layout = await page.evaluate(() => {
      const columns = Array.from(document.querySelectorAll('section[data-heat]')).map((section) => {
        const box = section.getBoundingClientRect();
        return { left: box.left, right: box.right, width: box.width };
      });
      return { columns, viewport: window.innerWidth };
    });
    expect(layout.columns).toHaveLength(6);
    for (const column of layout.columns) {
      expect(column.right, 'no column is cut off by the edge of the window').toBeLessThanOrEqual(
        layout.viewport,
      );
    }
    // They share the room: all alike, and none narrower than the 14rem (224px) minimum.
    const widths = layout.columns.map((column) => Math.round(column.width));
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(224);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  });

  test('each column carries the heat of its status', async ({ page }) => {
    await signInAs(page, 'owner');
    await openBoard(page);

    const heats: [string, string][] = [
      ['Cold Steel', 'cold'],
      ['Warming', 'warming'],
      ['In the Forge', 'forge'],
      ['Tempering', 'tempering'],
      ['Jammed', 'blocked'],
      ['Quenched', 'quenched'],
    ];
    for (const [name, heat] of heats) {
      await expect(column(page, name)).toHaveAttribute('data-heat', heat);
      // The status symbol in the column's header carries it too, as a shape as well as a colour.
      await expect(column(page, name).locator('header svg')).toHaveAttribute('data-heat', heat);
    }
  });

  test('a card shows its comment count and priority', async ({ page }) => {
    await signInAs(page, 'developer');
    const viewer = await viewerOf(page);
    const acme = viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
    const detail = async () =>
      (await (await page.request.get(`/api/v1/orgs/${acme}/tickets/WEB-5`)).json()) as {
        commentCount: number;
      };
    const before = (await detail()).commentCount;
    for (const body of ['First', 'Second']) {
      const posted = await page.request.post(`/api/v1/orgs/${acme}/tickets/WEB-5/comments`, {
        data: { body },
      });
      expect(posted.status()).toBe(201);
    }
    expect((await detail()).commentCount).toBe(before + 2);

    await openBoard(page);
    await expect(card(page, 'WEB-5').getByTitle(`${before + 2} comments`)).toBeVisible();
    // WEB-3 is Inferno; the name is there for a screen reader, next to the bars.
    await expect(card(page, 'WEB-3')).toContainText('Priority: Inferno');
    // A ticket nobody has commented on shows no count at all.
    await expect(card(page, 'WEB-12').getByTitle(/comments?$/)).toHaveCount(0);
  });

  test('awkward titles never widen a column or the page', async ({ page }) => {
    await signInAs(page, 'developer');
    const viewer = await viewerOf(page);
    const acme = viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
    const config = (await (
      await page.request.get(`/api/v1/orgs/${acme}/ticket-config`)
    ).json()) as {
      types: { id: string }[];
      priorities: { id: string }[];
    };

    const titles = [
      'W'.repeat(200),
      'مشكلة في صفحة الدفع على الهاتف المحمول',
      '🔥 Fix the forge 🔨 '.repeat(8).trim(),
    ];
    const keys: string[] = [];
    for (const title of titles) {
      const created = await page.request.post(`/api/v1/orgs/${acme}/projects/WEB/tickets`, {
        data: { title, typeId: config.types[0]!.id, priorityId: config.priorities[0]!.id },
      });
      expect(created.status()).toBe(201);
      keys.push(((await created.json()) as { key: string }).key);
    }

    await openBoard(page);
    for (const key of keys) {
      const target = card(page, key);
      await expect(target).toBeVisible();
      const fits = await target.evaluate((element) => element.scrollWidth <= element.clientWidth);
      expect(fits, `${key} stays inside its card`).toBe(true);
      // The title wraps inside the card instead of being cut off at its edge.
      const wraps = await target
        .locator('a')
        .first()
        .evaluate((link) => link.scrollWidth <= link.clientWidth);
      expect(wraps, `${key}'s title wraps instead of running off the card`).toBe(true);
    }
    const pageFits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(pageFits, 'the page does not scroll sideways').toBe(true);
  });

  test('a card dragged to another column stays there after a reload', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await expect(column(page, 'Tempering').locator('li[data-ticket="WEB-3"]')).toBeVisible();

    await dragCard(page, 'WEB-3', 'Jammed');
    await expect(column(page, 'Jammed').locator('li[data-ticket="WEB-3"]')).toBeVisible();
    await expect(column(page, 'Jammed')).toHaveAttribute('aria-label', 'Jammed, 2 tickets');
    await expect(column(page, 'Tempering')).toHaveAttribute('aria-label', 'Tempering, 0 tickets');

    await page.reload();
    await expect(column(page, 'Jammed').locator('li[data-ticket="WEB-3"]')).toBeVisible();

    // The ticket itself agrees, and its history says who moved it.
    await page.goto('/w/acme/tickets/WEB-3');
    await expect(page.getByLabel('Status').locator('option:checked')).toHaveText('Jammed');
    await expect(page.getByRole('region', { name: 'Activity' })).toContainText(
      'moved this from Tempering to Jammed',
    );
  });

  test('a card can be moved with the keyboard alone', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await expect(column(page, 'In the Forge').locator('li[data-ticket="WEB-1"]')).toBeVisible();

    // What a screen reader is told, step by step. Waiting for each announcement also gives the
    // drag time to get ready, which a person's pace does and a script's does not.
    const announcement = page.locator('[id^="DndLiveRegion"]');

    await page.getByRole('button', { name: 'Pick up WEB-1 to move it' }).focus();
    await page.keyboard.press('Space');
    await expect(announcement).toHaveText('WEB-1 is over In the Forge.');
    // The columns know which of them will take the card a moment after it is picked up; Cold Steel
    // being marked as refusing it shows they do. A person is slower than this.
    await expect(column(page, 'Cold Steel')).toHaveAttribute('title', /cannot move to Cold Steel/);
    // The next column to the right that will take it is Tempering.
    await page.keyboard.press('ArrowRight');
    await expect(announcement).toHaveText('WEB-1 is over Tempering.');
    await page.keyboard.press('Space');
    await expect(announcement).toHaveText('WEB-1 dropped on Tempering.');

    await expect(column(page, 'Tempering').locator('li[data-ticket="WEB-1"]')).toBeVisible();
    await page.reload();
    await expect(column(page, 'Tempering').locator('li[data-ticket="WEB-1"]')).toBeVisible();
  });

  test('"Move to" does the same without dragging, offering only allowed statuses', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    await actionsButton(page, 'WEB-2').click();
    await actionsMenu(page, 'WEB-2').getByRole('button', { name: 'Move to…' }).click();
    const menu = page.getByRole('group', { name: 'Move WEB-2 to' });
    await expect(menu.getByRole('button')).toHaveText([
      'Cold Steel',
      'In the Forge',
      'Jammed',
      'Scrapped',
    ]);
    await menu.getByRole('button', { name: 'In the Forge' }).click();

    await expect(column(page, 'In the Forge').locator('li[data-ticket="WEB-2"]')).toBeVisible();
  });

  test('a move the workflow does not allow is refused with a reason, and the card stays', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    await dragCard(page, 'WEB-3', 'Cold Steel'); // Tempering cannot go straight to Cold Steel
    await expect(page.getByText('WEB-3 cannot move from Tempering to Cold Steel.')).toBeVisible();
    await expect(column(page, 'Tempering').locator('li[data-ticket="WEB-3"]')).toBeVisible();
    await expect(column(page, 'Cold Steel')).toHaveAttribute('aria-label', 'Cold Steel, 2 tickets');

    await page.reload();
    await expect(column(page, 'Tempering').locator('li[data-ticket="WEB-3"]')).toBeVisible();
  });

  test('a card someone else already moved is put right instead of being overwritten', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    // Someone else moves WEB-3 first, behind this page's back.
    const viewer = await viewerOf(page);
    const acme = viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
    const project = await (await page.request.get(`/api/v1/orgs/${acme}/projects/WEB`)).json();
    const blocked = project.statuses.find((s: { key: string }) => s.key === 'blocked').id;
    const ticket = await (await page.request.get(`/api/v1/orgs/${acme}/tickets/WEB-3`)).json();
    const moved = await page.request.patch(`/api/v1/orgs/${acme}/tickets/WEB-3`, {
      data: { version: ticket.version, statusId: blocked },
    });
    expect(moved.status()).toBe(200);

    // This page still shows it in Tempering, and the drag uses that old version.
    await dragCard(page, 'WEB-3', 'In the Forge');
    await expect(page.getByText(/changed by someone else/)).toBeVisible();
    await expect(column(page, 'Jammed').locator('li[data-ticket="WEB-3"]')).toBeVisible();
    await expect(column(page, 'In the Forge').locator('li[data-ticket="WEB-3"]')).toHaveCount(0);
  });

  test('a read-only member can look but has nothing to grab', async ({ page }) => {
    await signInAs(page, 'readonly');
    await openBoard(page);

    await expect(card(page, 'WEB-3')).toBeVisible();
    await expect(page.getByRole('button', { name: /Pick up/ })).toHaveCount(0);
    // Nothing that changes a ticket: the card's menu holds only the copies.
    await actionsButton(page, 'WEB-3').click();
    await expect(actionsMenu(page, 'WEB-3').getByRole('button')).toHaveText([
      'Copy key',
      'Copy link',
    ]);
  });

  test('a filter narrows every column, and the status columns do not change', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/projects/WEB/board?assignee=me&label=bug');
    await hydrated(page);

    await expect(card(page, 'WEB-1')).toBeVisible();
    await expect(card(page, 'WEB-7')).toBeVisible();
    await expect(card(page, 'WEB-2')).toHaveCount(0);
    await expect(column(page, 'Cold Steel')).toHaveAttribute('aria-label', 'Cold Steel, 0 tickets');
    await expect(page.getByRole('button', { name: 'Remove filter Assignee: Me' })).toBeVisible();
  });

  test('switching identity never shows the previous identity’s tickets on Back', async ({
    page,
  }) => {
    await signInAs(page, 'owner');
    await openBoard(page);
    await expect(card(page, 'WEB-3')).toBeVisible();

    await switchTo(page, 'other-owner');
    await page.goBack();

    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByText('WEB-3')).toHaveCount(0);
    await expect(page.getByText('Checkout page')).toHaveCount(0);
  });
});

// What the Display menu changes is saved to the person's account, so each test waits for the save
// to finish before it reloads or switches person.
const saved = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/me/preferences') && response.request().method() === 'PATCH',
  );

async function openDisplay(page: Page) {
  await page.getByRole('button', { name: 'Display', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Due date' })).toBeVisible();
}

async function flip(page: Page, name: string) {
  await Promise.all([saved(page), page.getByRole('switch', { name }).click()]);
}

test.describe('the Display menu', () => {
  test('turning a field off removes it from every card and is remembered', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await expect(card(page, 'WEB-3')).toContainText('Tomorrow');

    await openDisplay(page);
    await flip(page, 'Due date');
    await expect(page.getByRole('switch', { name: 'Due date' })).not.toBeChecked();
    await expect(card(page, 'WEB-3')).not.toContainText('Tomorrow');
    await expect(card(page, 'WEB-1')).not.toContainText('overdue');

    await page.reload();
    await hydrated(page);
    await expect(card(page, 'WEB-3')).toBeVisible();
    await expect(card(page, 'WEB-3')).not.toContainText('Tomorrow');
  });

  test('settings belong to the person, not to the board', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await openDisplay(page);
    await flip(page, 'Due date');

    await switchTo(page, 'owner');
    await openBoard(page);
    await expect(card(page, 'WEB-3')).toContainText('Tomorrow');
  });

  test('a read-only member can use the Display menu', async ({ page }) => {
    await signInAs(page, 'readonly');
    await openBoard(page);
    await expect(card(page, 'WEB-3').locator('.label-chip').first()).toBeVisible();

    await openDisplay(page);
    await flip(page, 'Labels');
    await expect(card(page, 'WEB-3').locator('.label-chip')).toHaveCount(0);

    const stored = await (await page.request.get('/api/v1/me/preferences')).json();
    expect(stored).toEqual({ board: { fields: { labels: false } } });
  });

  test('compact density is applied on the first paint', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await openDisplay(page);
    await Promise.all([saved(page), page.getByText('Compact', { exact: true }).click()]);
    await expect(page.locator('[data-density="compact"]')).toBeVisible();

    // The server already knows: the very first HTML it sends carries the setting.
    const html = await (await page.request.get('/w/acme/projects/WEB/board')).text();
    expect(html).toContain('data-density="compact"');
    expect(html).not.toContain('data-density="comfortable"');
  });

  test('heat can be turned off, and the columns go neutral', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    const edge = () =>
      column(page, 'Tempering').evaluate((element) => getComputedStyle(element).borderTopColor);
    expect(await edge()).toBe('rgb(242, 193, 78)');

    await openDisplay(page);
    await flip(page, 'Heat colours on columns');
    await expect.poll(edge).toBe('rgba(0, 0, 0, 0)');
    // The status symbol and its name are still there.
    await expect(column(page, 'Tempering').locator('header svg')).toHaveAttribute(
      'data-heat',
      'tempering',
    );
  });

  test('"Reset to default" puts everything back', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await openDisplay(page);
    await flip(page, 'Due date');
    await flip(page, 'Heat colours on columns');
    await Promise.all([saved(page), page.getByText('Compact', { exact: true }).click()]);

    await Promise.all([
      saved(page),
      page.getByRole('button', { name: 'Reset to default' }).click(),
    ]);
    await expect(page.getByRole('switch', { name: 'Due date' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Heat colours on columns' })).toBeChecked();
    await expect(page.locator('[data-density="comfortable"]')).toBeVisible();

    await page.reload();
    await hydrated(page);
    await expect(card(page, 'WEB-3')).toContainText('Tomorrow');
  });
});

test.describe('board columns', () => {
  const headings = (page: Page) => page.locator('section[data-heat] h2');

  test('Scrapped is hidden by default and can be shown', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await expect(column(page, 'Scrapped')).toHaveCount(0);

    await openDisplay(page);
    await expect(page.getByRole('switch', { name: 'Show Scrapped' })).not.toBeChecked();
    await flip(page, 'Show Scrapped');
    await expect(column(page, 'Scrapped')).toHaveAttribute('aria-label', 'Scrapped, 1 ticket');
  });

  test('hiding a column removes it and is remembered after a reload', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await expect(column(page, 'Jammed')).toBeVisible();

    await openDisplay(page);
    await flip(page, 'Show Jammed');
    await expect(column(page, 'Jammed')).toHaveCount(0);

    await page.reload();
    await hydrated(page);
    await expect(column(page, 'Tempering')).toBeVisible();
    await expect(column(page, 'Jammed')).toHaveCount(0);
    await openDisplay(page);
    await expect(page.getByRole('switch', { name: 'Show Jammed' })).not.toBeChecked();
  });

  test('a column can be moved with the buttons and keeps its place after a reload', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    const normal = ['Cold Steel', 'Warming', 'In the Forge', 'Tempering', 'Jammed', 'Quenched'];
    await expect(headings(page)).toHaveText(normal);

    await openDisplay(page);
    await Promise.all([
      saved(page),
      page.getByRole('button', { name: 'Move Quenched up' }).click(),
    ]);
    const moved = ['Cold Steel', 'Warming', 'In the Forge', 'Tempering', 'Quenched', 'Jammed'];
    await expect(headings(page)).toHaveText(moved);

    await page.reload();
    await hydrated(page);
    await expect(headings(page)).toHaveText(moved);

    // The first one cannot go further up, and the last cannot go further down.
    await openDisplay(page);
    await expect(page.getByRole('button', { name: 'Move Cold Steel up' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Move Scrapped down' })).toBeDisabled();
  });

  test('column choices are separate for each project', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await openDisplay(page);
    await flip(page, 'Show Jammed');
    await expect(column(page, 'Jammed')).toHaveCount(0);

    await page.goto('/w/acme/projects/API/board');
    await expect(page.getByRole('heading', { name: 'Platform API', level: 1 })).toBeVisible();
    await hydrated(page);
    await expect(column(page, 'Jammed')).toBeVisible();
  });

  test('when every column is hidden the board says so, and the way back works', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await openDisplay(page);
    for (const name of [
      'Cold Steel',
      'Warming',
      'In the Forge',
      'Tempering',
      'Jammed',
      'Quenched',
    ]) {
      await flip(page, `Show ${name}`);
    }
    await expect(
      page.getByText('Every column is hidden. Open Display to show some.'),
    ).toBeVisible();
    await expect(page.locator('section[data-heat]')).toHaveCount(0);

    await flip(page, 'Show Warming');
    await expect(column(page, 'Warming')).toBeVisible();
    await expect(page.getByText('Every column is hidden.')).toHaveCount(0);
  });

  test('moving a ticket into a status that is hidden says where it went', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await openDisplay(page);
    await flip(page, 'Show Jammed');
    await page.keyboard.press('Escape');

    await actionsButton(page, 'WEB-2').click();
    await actionsMenu(page, 'WEB-2').getByRole('button', { name: 'Move to…' }).click();
    await page
      .getByRole('group', { name: 'Move WEB-2 to' })
      .getByRole('button', { name: 'Jammed' })
      .click();

    await expect(
      page.getByText('WEB-2 moved to Jammed, which is hidden on your board.'),
    ).toBeVisible();
    await expect(card(page, 'WEB-2')).toHaveCount(0);

    // Nothing is lost: the ticket is where the list says it is.
    await page.goto('/w/acme/projects/WEB/list');
    await expect(page.getByRole('row', { name: /WEB-2/ })).toContainText('Jammed');
  });

  test('dragging and the keyboard work with columns hidden, and skip them', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await openDisplay(page);
    await flip(page, 'Show Warming');
    await flip(page, 'Show Tempering');
    await page.keyboard.press('Escape');

    // With the mouse: WEB-1 goes from In the Forge straight to Jammed.
    await dragCard(page, 'WEB-1', 'Jammed');
    await expect(column(page, 'Jammed').locator('li[data-ticket="WEB-1"]')).toBeVisible();

    // With the keyboard: WEB-5 is in the Forge; Tempering is hidden, so the next column to the
    // right that takes it is Jammed.
    const announcement = page.locator('[id^="DndLiveRegion"]');
    const grip = page.getByRole('button', { name: 'Pick up WEB-5 to move it' });
    // Grips are switched off while the first move is being saved; wait for it to finish.
    await expect(grip).toBeEnabled();
    // ...and for the page refresh that follows a move, which would otherwise redraw mid-drag.
    await page.waitForLoadState('networkidle');
    await grip.focus();
    await page.keyboard.press('Space');
    await expect(announcement).toHaveText('WEB-5 is over In the Forge.');
    // The columns know which of them will take the card a moment after it is picked up: Cold
    // Steel refusing it (it is marked as such) shows they do. A person is slower than this.
    await expect(column(page, 'Cold Steel')).toHaveAttribute('title', /cannot move to Cold Steel/);
    await page.keyboard.press('ArrowRight');
    await expect(announcement).toHaveText('WEB-5 is over Jammed.');
    await page.keyboard.press('Space');
    await expect(announcement).toHaveText('WEB-5 dropped on Jammed.');
    await expect(column(page, 'Jammed').locator('li[data-ticket="WEB-5"]')).toBeVisible();
  });
});

const addButton = (page: Page, name: string) =>
  page.getByRole('button', { name: `Add a ticket to ${name}` });
const titleBox = (page: Page) => page.getByLabel('New ticket title');

async function ticketOf(page: Page, key: string) {
  const viewer = await viewerOf(page);
  const acme = viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
  const response = await page.request.get(`/api/v1/orgs/${acme}/tickets/${key}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    status: { name: string };
    type: { key: string };
    priority: { name: string };
    assignee: { displayName: string } | null;
    archivedAt: string | null;
  };
}

/** Records every request that tries to create a ticket. */
function watchCreates(page: Page) {
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/projects\/[^/]+\/tickets$/.test(request.url())) {
      posts.push(request.url());
    }
  });
  return posts;
}

test.describe('quick create in a column', () => {
  test('adds a ticket at the top of that column, in that status, and it survives a reload', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    await addButton(page, 'Tempering').click();
    await expect(titleBox(page)).toBeFocused();
    await page.keyboard.type('Check the quench tank');
    await page.keyboard.press('Enter');

    const tempering = column(page, 'Tempering');
    await expect(tempering).toHaveAttribute('aria-label', 'Tempering, 2 tickets');
    await expect(tempering.locator('li[data-ticket]').first()).toContainText(
      'Check the quench tank',
    );
    await expect(tempering.locator('li[data-ticket="WEB-13"]')).toBeVisible();
    await expect(page.getByText('Created WEB-13.')).toBeVisible();

    await page.reload();
    await expect(column(page, 'Tempering').locator('li[data-ticket="WEB-13"]')).toContainText(
      'Check the quench tank',
    );

    // Made the way a quick ticket is: Task, Flame, in the column's status.
    const made = await ticketOf(page, 'WEB-13');
    expect(made.status.name).toBe('Tempering');
    expect(made.type.key).toBe('task');
    expect(made.priority.name).toBe('Flame');
  });

  test('Escape closes the form without creating anything', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    const posts = watchCreates(page);

    await addButton(page, 'Tempering').click();
    await page.keyboard.type('Never mind');
    await page.keyboard.press('Escape');

    await expect(titleBox(page)).toHaveCount(0);
    await expect(addButton(page, 'Tempering')).toBeFocused();
    await expect(column(page, 'Tempering')).toHaveAttribute('aria-label', 'Tempering, 1 ticket');
    expect(posts).toHaveLength(0);
  });

  test('an empty title is not sent', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    const posts = watchCreates(page);

    await addButton(page, 'Tempering').click();
    await page.keyboard.type('   ');
    await page.keyboard.press('Enter');

    await expect(page.getByText('Give the ticket a title.')).toBeVisible();
    await expect(titleBox(page)).toBeFocused();
    expect(posts).toHaveLength(0);
    await expect(column(page, 'Tempering')).toHaveAttribute('aria-label', 'Tempering, 1 ticket');
  });

  test('someone who cannot create tickets gets no plus', async ({ page }) => {
    await signInAs(page, 'readonly');
    await openBoard(page);
    await expect(column(page, 'Tempering')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Add a ticket to / })).toHaveCount(0);
  });
});

test.describe('the card menu', () => {
  test('Priority changes the ticket and its bars', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await expect(card(page, 'WEB-3')).toContainText('Priority: Inferno');

    await actionsButton(page, 'WEB-3').click();
    await actionsMenu(page, 'WEB-3').getByRole('button', { name: 'Priority…' }).click();
    await page
      .getByRole('group', { name: 'Priority for WEB-3' })
      .getByRole('button', { name: 'Blaze', exact: true })
      .click();

    await expect(card(page, 'WEB-3')).toContainText('Priority: Blaze');
    expect((await ticketOf(page, 'WEB-3')).priority.name).toBe('Blaze');
  });

  test('Assign to me puts the person on the card, and Unassign takes them off', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page);
    await expect(card(page, 'WEB-4').getByTitle('Unassigned')).toBeVisible();

    await actionsButton(page, 'WEB-4').click();
    await actionsMenu(page, 'WEB-4').getByRole('button', { name: 'Assign to me' }).click();
    await expect(card(page, 'WEB-4').getByTitle('Dana Developer')).toBeVisible();
    expect((await ticketOf(page, 'WEB-4')).assignee?.displayName).toBe('Dana Developer');

    await actionsButton(page, 'WEB-4').click();
    await expect(
      actionsMenu(page, 'WEB-4').getByRole('button', { name: 'Assign to me' }),
    ).toHaveCount(0);
    await actionsMenu(page, 'WEB-4').getByRole('button', { name: 'Unassign' }).click();
    await expect(card(page, 'WEB-4').getByTitle('Unassigned')).toBeVisible();
  });

  test('Assign to… offers the workspace’s members', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    await actionsButton(page, 'WEB-4').click();
    await actionsMenu(page, 'WEB-4').getByRole('button', { name: 'Assign to…' }).click();
    await page
      .getByRole('group', { name: 'Assign WEB-4 to' })
      .getByRole('button', { name: /Adam Admin/ })
      .click();

    await expect(card(page, 'WEB-4').getByTitle('Adam Admin')).toBeVisible();
    expect((await ticketOf(page, 'WEB-4')).assignee?.displayName).toBe('Adam Admin');
  });

  test('Archive removes the card and says so', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    await actionsButton(page, 'WEB-3').click();
    await actionsMenu(page, 'WEB-3').getByRole('button', { name: 'Archive' }).click();

    await expect(page.getByText('Archived WEB-3.')).toBeVisible();
    await expect(card(page, 'WEB-3')).toHaveCount(0);
    await expect(column(page, 'Tempering')).toHaveAttribute('aria-label', 'Tempering, 0 tickets');
    expect((await ticketOf(page, 'WEB-3')).archivedAt).not.toBeNull();
  });

  test('Duplicate opens the copy', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    await actionsButton(page, 'WEB-3').click();
    await actionsMenu(page, 'WEB-3')
      .getByRole('button', { name: 'Duplicate', exact: true })
      .click();

    await expect(page).toHaveURL(/\/w\/acme\/tickets\/WEB-13$/);
    await expect(page.getByText('Created WEB-13, a copy of WEB-3.')).toBeVisible();
  });

  test('Copy key and Copy link use the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signInAs(page, 'developer');
    await openBoard(page);
    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

    await actionsButton(page, 'WEB-3').click();
    await actionsMenu(page, 'WEB-3').getByRole('button', { name: 'Copy key' }).click();
    await expect(page.getByText('Copied WEB-3.')).toBeVisible();
    expect(await clipboard()).toBe('WEB-3');

    await actionsButton(page, 'WEB-3').click();
    await actionsMenu(page, 'WEB-3').getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByText('Copied the link to WEB-3.')).toBeVisible();
    expect(await clipboard()).toBe(`${new URL(page.url()).origin}/w/acme/tickets/WEB-3`);
  });

  test('works from the keyboard, and Escape puts focus back on the button', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    await actionsButton(page, 'WEB-3').focus();
    await page.keyboard.press('Enter');
    await expect(actionsMenu(page, 'WEB-3')).toBeVisible();
    await expect(actionsMenu(page, 'WEB-3').getByRole('button').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(actionsMenu(page, 'WEB-3')).toHaveCount(0);
    await expect(actionsButton(page, 'WEB-3')).toBeFocused();
  });

  test('after Priority by keyboard alone, the focus is back on the card’s Actions button', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    await actionsButton(page, 'WEB-3').focus();
    await page.keyboard.press('Enter');
    await expect(actionsMenu(page, 'WEB-3').getByRole('button').first()).toBeFocused();
    await page.keyboard.press('Tab'); // Move to… -> Priority…
    await expect(
      actionsMenu(page, 'WEB-3').getByRole('button', { name: 'Priority…' }),
    ).toBeFocused();
    await page.keyboard.press('Enter');

    // The list opens on the priority in force (Inferno); Blaze is the next one down.
    const priorities = page.getByRole('group', { name: 'Priority for WEB-3' });
    await expect(priorities.getByRole('button', { name: 'Inferno' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(priorities.getByRole('button', { name: 'Blaze', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(card(page, 'WEB-3')).toContainText('Priority: Blaze');
    await expect(actionsButton(page, 'WEB-3')).toBeFocused();
    expect((await ticketOf(page, 'WEB-3')).priority.name).toBe('Blaze');
  });

  test('a list opens on the first choice when none is in force, and Back is reachable', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    await actionsButton(page, 'WEB-4').click();
    await actionsMenu(page, 'WEB-4').getByRole('button', { name: 'Assign to…' }).click();
    const people = page.getByRole('group', { name: 'Assign WEB-4 to' });
    await expect(people.getByRole('button').first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Back' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(actionsMenu(page, 'WEB-4')).toBeVisible();
  });

  test('after Move to… the focus follows the card to its new column', async ({ page }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    await actionsButton(page, 'WEB-2').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // Move to…
    await page
      .getByRole('group', { name: 'Move WEB-2 to' })
      .getByRole('button', { name: 'In the Forge' })
      .press('Enter');

    await expect(column(page, 'In the Forge').locator('li[data-ticket="WEB-2"]')).toBeVisible();
    await expect(actionsButton(page, 'WEB-2')).toBeFocused();
  });

  test('after Archive the focus goes to the column’s plus, never the top of the page', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openBoard(page);

    await actionsButton(page, 'WEB-3').focus();
    await page.keyboard.press('Enter');
    await actionsMenu(page, 'WEB-3').getByRole('button', { name: 'Archive' }).press('Enter');

    await expect(card(page, 'WEB-3')).toHaveCount(0);
    await expect(addButton(page, 'Tempering')).toBeFocused();
  });

  test('a read-only member is offered only the copies', async ({ page }) => {
    await signInAs(page, 'readonly');
    await openBoard(page);

    await actionsButton(page, 'WEB-3').click();
    await expect(actionsMenu(page, 'WEB-3').getByRole('button')).toHaveText([
      'Copy key',
      'Copy link',
    ]);
  });
});
