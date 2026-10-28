import { expect, test, type Page } from '@playwright/test';
import { hydrated, reseed, signInAs } from './helpers';

// The demo data: WEB-1 has a goal, a formatted description that mentions API-2, and three
// acceptance criteria of which the first is ticked.

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

async function openTicket(page: Page, key: string) {
  await page.goto(`/w/acme/tickets/${key}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await hydrated(page);
}

const criteria = (page: Page) => page.getByRole('list', { name: 'Acceptance criteria' });

test.describe('ticket parts', () => {
  test('shows the goal, the criteria count and formatted description', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-1');
    const goal = page.getByRole('region', { name: 'Goal' });
    await expect(goal).toContainText('get back to what they were doing');
    await expect(
      page.getByRole('heading', { name: /Acceptance criteria\s*1 of 3 met/ }),
    ).toBeVisible();

    const description = page.getByRole('region', { name: 'Description' });
    await expect(description.locator('strong', { hasText: 'Steps' })).toBeVisible();
    await expect(description.locator('ol > li')).toHaveCount(3);
    await expect(description.locator('code', { hasText: 'returnTo' })).toBeVisible();
    // A key of this workspace becomes a link to that ticket.
    await expect(description.getByRole('link', { name: 'API-2' })).toHaveAttribute(
      'href',
      '/w/acme/tickets/API-2',
    );
  });

  test('ticking, adding, editing, reordering and removing criteria', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-1');

    await criteria(page)
      .getByRole('checkbox', { name: 'No redirect loop when the cookie is missing' })
      .check();
    await expect(page.getByRole('heading', { name: /2 of 3 met/ })).toBeVisible();

    await page.getByLabel('New acceptance criterion').fill('Works in **every** browser');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(criteria(page).getByRole('listitem')).toHaveCount(4);
    await expect(criteria(page).locator('strong', { hasText: 'every' })).toBeVisible();

    await page.getByRole('button', { name: 'Move "Works in **every** browser" up' }).click();
    await expect(criteria(page).getByRole('listitem').nth(2)).toContainText(
      'Works in every browser',
    );

    await page.getByRole('button', { name: 'Edit "Works in **every** browser"' }).click();
    await page.getByLabel('Criterion', { exact: true }).fill('Works in Edge and Firefox');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(criteria(page)).toContainText('Works in Edge and Firefox');

    await page.getByRole('button', { name: 'Remove "Works in Edge and Firefox"' }).click();
    await expect(criteria(page).getByRole('listitem')).toHaveCount(3);

    await page.reload();
    await expect(page.getByRole('heading', { name: /2 of 3 met/ })).toBeVisible();
    const activity = page.getByRole('region', { name: 'Activity' });
    await expect(activity).toContainText('ticked "No redirect loop when the cookie is missing"');
    await expect(activity).toContainText('reordered the acceptance criteria');
  });

  test('editing the goal', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-2');
    await page.getByRole('button', { name: 'Add goal' }).click();
    await page.getByRole('textbox', { name: 'Goal' }).fill('Night owls can read comfortably');
    await page.getByRole('button', { name: 'Save goal' }).click();
    await expect(page.getByRole('region', { name: 'Goal' })).toContainText('Night owls');
  });

  test('a read-only member sees the parts but cannot change them', async ({ page }) => {
    await signInAs(page, 'readonly');
    await openTicket(page, 'WEB-1');
    await expect(criteria(page).getByRole('checkbox').first()).toBeDisabled();
    await expect(page.getByLabel('New acceptance criterion')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /goal/i })).toHaveCount(0);
  });

  test('a new ticket can start with a goal and criteria', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/tickets/new?project=WEB');
    await hydrated(page);
    await page.getByLabel('Title').fill('Monthly export');
    await page.getByLabel('Goal').fill('Finance can reconcile without asking us');
    await page.getByLabel('Acceptance criteria').fill('Exports as CSV\n\nTotals match the ledger');
    await page.getByRole('button', { name: 'Create ticket' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Monthly export');
    await expect(page.getByRole('heading', { name: /0 of 2 met/ })).toBeVisible();
    await expect(criteria(page)).toContainText('Totals match the ledger');
  });

  test('the board card shows criteria met, and the Display menu can hide it', async ({ page }) => {
    await signInAs(page, 'developer');
    await page.goto('/w/acme/projects/WEB/board');
    await hydrated(page);
    const card = page.locator('li[data-ticket="WEB-1"]');
    await expect(card).toContainText('1/3');
    await page.getByRole('button', { name: 'Display', exact: true }).click();
    await page.getByRole('switch', { name: 'Acceptance criteria' }).click();
    await expect(card).not.toContainText('1/3');
  });
});

test.describe('formatting', () => {
  test('preview formats, and markup stays text', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-2');
    await page
      .getByRole('region', { name: 'Description' })
      .getByRole('button', { name: 'Edit' })
      .click();
    const text =
      '## Plan\n- **bold** and [docs](https://forge.dev)\n<img src=x onerror="window.__hacked=1"> [x](javascript:alert(1))';
    await page.getByRole('textbox', { name: 'Description' }).fill(text);
    await page
      .getByRole('region', { name: 'Description' })
      .getByRole('tab', { name: 'Preview' })
      .click();
    const description = page.getByRole('region', { name: 'Description' });
    await expect(description.getByRole('heading', { name: 'Plan' })).toBeVisible();
    await expect(description.getByRole('link', { name: 'docs' })).toHaveAttribute(
      'rel',
      'noopener noreferrer nofollow',
    );
    await expect(description.getByRole('link', { name: 'x' })).toHaveCount(0);
    await expect(description.locator('img')).toHaveCount(0);
    await expect(description).toContainText('<img src=x onerror=');

    await page.getByRole('button', { name: 'Save description' }).click();
    await page.reload();
    await expect(description.getByRole('heading', { name: 'Plan' })).toBeVisible();
    expect(await page.evaluate(() => (window as { __hacked?: number }).__hacked)).toBeUndefined();
  });

  test('typing @ suggests members, and the mention shows their name', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-2');
    const box = page.getByLabel('Add a comment');
    await box.click();
    await box.pressSequentially('Thanks @rile');
    await expect(
      page
        .getByRole('listbox', { name: 'People to mention' })
        .getByRole('option', { name: /Riley Reviewer/ }),
    ).toBeVisible();
    await box.press('Enter');
    await expect(box).toHaveValue(/Thanks @\[Riley Reviewer\]\(user:[0-9a-f-]{36}\) $/);
    await box.pressSequentially('see WEB-1');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    const comment = page.getByRole('article', { name: 'Comment by Dana Developer' }).last();
    await expect(comment).toContainText('Thanks @Riley Reviewer see WEB-1');
    await expect(comment.getByRole('link', { name: 'WEB-1' })).toBeVisible();

    await openTicket(page, 'WEB-1');
    await expect(page.getByRole('region', { name: 'Mentioned in' })).toContainText('WEB-2');
  });
});

test.describe('attachments and reactions', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  test('attaching a file lists it and it downloads; a disguised file is refused', async ({
    page,
  }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-2');
    await page.getByLabel('Attach files').setInputFiles({
      name: 'dot.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    const files = page.getByRole('region', { name: /Attachments/ });
    await expect(files.getByRole('link', { name: 'dot.png' })).toBeVisible();

    const download = await page.request.get(
      (await files.getByRole('link', { name: 'dot.png' }).getAttribute('href'))!,
    );
    expect(download.status()).toBe(200);
    expect(download.headers()['content-disposition']).toMatch(/^attachment;/);
    expect(download.headers()['x-content-type-options']).toBe('nosniff');

    await page.getByLabel('Attach files').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    });
    await expect(page.getByText(/logo\.png: Forge accepts PNG/)).toBeVisible();
    await expect(files.getByRole('link', { name: 'logo.png' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Remove dot.png' }).click();
    await expect(files.getByRole('link', { name: 'dot.png' })).toHaveCount(0);
  });

  test('reacting to a comment and taking it back', async ({ page }) => {
    await signInAs(page, 'developer');
    await openTicket(page, 'WEB-2');
    await page.getByLabel('Add a comment').fill('Looks good');
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    const comment = page.getByRole('article', { name: 'Comment by Dana Developer' }).last();
    await comment.getByRole('button', { name: 'Add a reaction' }).click();
    await comment.getByRole('menuitem', { name: 'React with 🎉' }).click();
    const chip = comment.getByRole('button', { name: /🎉 1, from Dana Developer/ });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(chip).toHaveCount(0);
  });
});
