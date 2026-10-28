import { expect, test, type Page } from '@playwright/test';
import { hydrated, reseed, signInAs, switchTo, viewerOf } from './helpers';

test.beforeEach(async ({ request }) => {
  await reseed(request);
});

async function visit(page: Page, path: string) {
  await page.goto(path);
  await hydrated(page);
}

const membersTable = (page: Page) =>
  page.getByRole('table', { name: 'Members of this workspace and their roles' });
const rowFor = (page: Page, name: string) =>
  membersTable(page).getByRole('row', { name: new RegExp(name) });
const roleSelect = (page: Page, name: string) =>
  rowFor(page, name).getByRole('combobox', { name: `Role for ${name}` });

type Role = { id: string; key: string };
type Member = { user: { id: string; displayName: string }; role: Role };

/** Ids the UI never shows, read through the API as the current identity. */
async function acmeFacts(page: Page) {
  const viewer = await viewerOf(page);
  const acmeId = viewer.memberships.find((m) => m.organisation.slug === 'acme')!.organisation.id;
  const members = (await (
    await page.request.get(`/api/v1/orgs/${acmeId}/members`)
  ).json()) as Member[];
  const roles = (await (await page.request.get(`/api/v1/orgs/${acmeId}/roles`)).json()) as Role[];
  const userId = (name: string) => members.find((m) => m.user.displayName === name)!.user.id;
  const roleId = (key: string) => roles.find((r) => r.key === key)!.id;
  return { acmeId, userId, roleId };
}

test.describe('what each role sees', () => {
  test('an owner can edit everyone except themselves', async ({ page }) => {
    await signInAs(page, 'owner');
    await visit(page, '/w/acme/members');

    await expect(roleSelect(page, 'Dana Developer')).toBeVisible();
    await expect(roleSelect(page, 'Adam Admin')).toBeVisible();
    await expect(roleSelect(page, 'Olivia Owner')).toHaveCount(0);
    await expect(rowFor(page, 'Olivia Owner')).toContainText('You');
  });

  test('a read-only member sees the list with no editing controls at all', async ({ page }) => {
    await signInAs(page, 'readonly');
    await visit(page, '/w/acme/members');

    await expect(rowFor(page, 'Dana Developer')).toContainText('Developer');
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  });

  test('a restricted member is told why there is nothing for them, and sees no navigation', async ({
    page,
  }) => {
    await signInAs(page, 'restricted');
    await expect(
      page.getByRole('heading', { name: "You don't have access to this workspace" }),
    ).toBeVisible();
    await expect(page.getByText('Restricted', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link')).toHaveCount(
      0,
    );

    await visit(page, '/w/acme/members');
    await expect(
      page.getByRole('heading', { name: "You don't have access to the member list" }),
    ).toBeVisible();
  });

  test('navigation follows the role as the identity changes', async ({ page }) => {
    await signInAs(page, 'owner');
    const links = page.getByRole('navigation', { name: 'Primary' }).getByRole('link');
    await expect(links).toHaveText(['Overview', 'Projects', 'Tickets', 'Members']);

    await switchTo(page, 'restricted');
    await expect(links).toHaveCount(0);

    await switchTo(page, 'developer');
    await expect(links).toHaveText(['Overview', 'Projects', 'Tickets', 'Members']);
  });

  test('the overview lists the permissions of the current role', async ({ page }) => {
    await signInAs(page, 'readonly');
    const list = page.getByRole('region', { name: 'What your role allows here' });
    await expect(list.getByRole('listitem')).toHaveText([
      'See the workspace',
      'See who the members are',
      'See tickets and boards',
    ]);
  });
});

test.describe('the server decides, not the page', () => {
  test('a restricted member cannot change a role even by calling the API directly', async ({
    page,
  }) => {
    await signInAs(page, 'owner');
    const facts = await acmeFacts(page);

    await switchTo(page, 'restricted');
    const attempt = await page.request.patch(
      `/api/v1/orgs/${facts.acmeId}/members/${facts.userId('Dana Developer')}`,
      { data: { roleId: facts.roleId('owner') } },
    );
    expect(attempt.status()).toBe(403);
    expect((await attempt.json()).error.code).toBe('forbidden');

    await switchTo(page, 'owner');
    await visit(page, '/w/acme/members');
    await expect(roleSelect(page, 'Dana Developer')).toHaveValue(facts.roleId('developer'));
  });

  test('a developer cannot rename the workspace by calling the API directly', async ({ page }) => {
    await signInAs(page, 'owner');
    const { acmeId } = await acmeFacts(page);

    await switchTo(page, 'developer');
    const attempt = await page.request.patch(`/api/v1/orgs/${acmeId}`, {
      data: { name: 'Mine now' },
    });
    expect(attempt.status()).toBe(403);

    await switchTo(page, 'owner');
    await expect(page.getByRole('heading', { name: 'Acme Robotics', level: 1 })).toBeVisible();
  });

  test('an administrator is not offered the owner role, and the API refuses it too', async ({
    page,
  }) => {
    await signInAs(page, 'owner');
    const facts = await acmeFacts(page);

    await switchTo(page, 'admin');
    await visit(page, '/w/acme/members');
    const options = roleSelect(page, 'Dana Developer').getByRole('option');
    // System roles by name, then custom ones: the order the API returns them in.
    await expect(options).toHaveText([
      'Administrator',
      'Developer',
      'Read-only',
      'Reviewer',
      'Restricted',
    ]);
    await expect(options.filter({ hasText: 'Owner' })).toHaveCount(0);

    // The owner's own row offers no choices to an administrator.
    await expect(roleSelect(page, 'Olivia Owner')).toHaveCount(0);

    const attempt = await page.request.patch(
      `/api/v1/orgs/${facts.acmeId}/members/${facts.userId('Dana Developer')}`,
      { data: { roleId: facts.roleId('owner') } },
    );
    expect(attempt.status()).toBe(403);
  });

  test('nobody can change their own role through the API', async ({ page }) => {
    await signInAs(page, 'owner');
    const facts = await acmeFacts(page);
    const attempt = await page.request.patch(
      `/api/v1/orgs/${facts.acmeId}/members/${facts.userId('Olivia Owner')}`,
      { data: { roleId: facts.roleId('developer') } },
    );
    expect(attempt.status()).toBe(403);
    expect((await attempt.json()).error.message).toMatch(/own role/i);
  });
});

test.describe('changing a role is visible to the person it happens to', () => {
  test('an owner makes Dana a reviewer, and Dana then sees that role', async ({ page }) => {
    await signInAs(page, 'owner');
    await visit(page, '/w/acme/members');

    await roleSelect(page, 'Dana Developer').selectOption({ label: 'Reviewer' });
    await rowFor(page, 'Dana Developer').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText("Changed Dana Developer's role to Reviewer.")).toBeVisible();
    await expect(roleSelect(page, 'Dana Developer')).toHaveValue(
      await roleSelect(page, 'Dana Developer').inputValue(),
    );

    await switchTo(page, 'developer');
    await expect(page.getByText('Your role: Reviewer')).toBeVisible();
    const permissions = page.getByRole('region', { name: 'What your role allows here' });
    await expect(permissions).toContainText('Approve changes');
    await expect(permissions).not.toContainText('Change, move and archive tickets');
  });
});
