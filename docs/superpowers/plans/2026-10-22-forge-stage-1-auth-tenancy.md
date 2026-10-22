# Forge Stage 1 — Authentication, Tenancy and the Dev Account Switcher

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multiple seeded test identities can sign in, switch instantly without signing out, and see different things — with every permission and tenant boundary enforced by the API, not the UI.

**Architecture:** Server-side sessions (opaque token in an HttpOnly cookie, SHA-256 hash stored in Postgres). Organisations own roles; a membership links a user to an organisation through one role; a role is a set of permission keys defined in code. Every organisation-scoped API route goes through one guard that resolves the caller's membership and required permission. The dev switcher is a set of API routes that exist only when `FORGE_DEV_AUTH` is on, and the API refuses to boot with it on in production. The web app proxies `/api/*` to the API so cookies stay same-origin and server components forward them.

**Tech Stack:** As Stage 0, plus `@fastify/cookie`. Postgres 18 `uuidv7()` for primary keys.

**Spec:** Product spec Part V (§8 development accounts, §8.3 switcher security, §8.4 multiple organisations), Part VI §14 (permissions), Part IX §22–23, Part XI Stage 1. Stage 0 plan: `2026-10-22-forge-stage-0-foundation.md`.

## Decisions made here (the spec leaves them open)

- **Sign-in in this stage is development-only.** The session architecture is production-capable (any future login method just calls `createSession`), but no production login method (email+password, GitHub OAuth, magic link) is built. The login page says so when dev auth is off. This is called out in known-limitations.
- **Workspace URLs are path-based: `/w/<slug>/...`.** Deep links, shareable URLs and per-workspace cache isolation beat a hidden "active workspace" cookie. `/` redirects to the first workspace the user can open.
- **Permissions are code, roles are data.** Permission keys live in `@forge/shared`; roles store arrays of keys per organisation. System roles are created with each organisation; editing roles is Stage 6.
- **A foreign organisation looks like a missing one.** A caller who is not a member of `:orgId` gets `404 not_found`, same as a non-existent id. Inside an organisation, a missing permission is `403 forbidden`.
- **Nobody changes their own role.** Self-escalation is impossible by construction; another admin must do it.
- **User preferences live on the server** (`user_preferences`), replacing Stage 0's localStorage sidebar preference. That also removes the first-paint flash listed in known-limitations.
- **Dev data reset truncates every table in the `public` schema** (discovered from the catalog, so later stages cannot forget a table), then reseeds.
- **E2E tests are isolated** from your dev stack: their own database `forge_e2e`, API on 4100, web on 3100, `.next-e2e` build dir.

## Global Constraints

- Everything from the Stage 0 plan still applies (strict TS, no dead controls, errors share `apiErrorSchema`, no secrets in logs, loopback binding, Windows-safe scripts, no commits unless asked).
- "Never let a browser-supplied user ID bypass authentication." Dev sign-in accepts only a seeded identity **key**.
- "Disable it in production builds and production runtime configuration." `loadConfig` throws if `NODE_ENV=production` and dev auth is on.
- "Frontend visibility is not a security boundary." Every guarded behaviour has an API-level test that does not go through the UI.
- "Use explicit tenant scoping in backend queries." Tenant-owned queries take the organisation id from the guard, never from the request body.
- Never store session tokens in plaintext; never log cookies or tokens.
- Dev identities use the reserved `.test` TLD and are only ever created by the seed.

## Review Focus

1. **Tampered, expired, revoked or garbage session cookie** → `401 unauthenticated`, never `500`; a logged-out cookie must stop working server-side. (Task 4)
2. **`:orgId` that is a valid UUID of another organisation, a non-existent UUID, or not a UUID at all** → identical `404` for all three. (Task 6)
3. **Role-change body containing a `roleId` from another organisation, an unknown id, or extra fields such as `role: "owner"` / `userId`** → rejected without touching data. (Task 6)
4. **Two simultaneous demotions of the only two owners** → at least one owner remains. (Task 6)
5. **Forged `Host` / `X-Forwarded-Host` (DNS rebinding) or foreign `Origin` against the switcher and any mutation** → refused. (Tasks 4–5)
6. **Switching identity must not show the previous identity's data** (browser back/forward, HTTP caches). (Tasks 4, 9)

---

## File Structure

```
packages/shared/src/permissions.ts      permission keys, system roles, hasPermission
packages/shared/src/role-rules.ts       decideRoleChange (pure escalation / last-owner rules)
packages/shared/src/api.ts              response/request schemas for Stage 1 endpoints
packages/db/src/schema.ts               + users, organisations, roles, memberships, sessions,
                                          user_preferences, development_fixtures, audit_events
packages/db/src/organisations.ts        createOrganisationWithSystemRoles
packages/db/src/seed.ts                 DEV_IDENTITIES, seed / reseed, CLI wiring
apps/api/src/auth/                      sessions.ts, plugin.ts, guards.ts, origin.ts, host.ts
apps/api/src/audit.ts                   recordAudit
apps/api/src/routes/                    me.ts, auth.ts, dev.ts, orgs.ts
apps/web/src/lib/server/                api.ts (server fetch with forwarded cookie), viewer.ts
apps/web/src/app/login/                 sign-in page
apps/web/src/app/(app)/                 authenticated layout; w/[slug]/...; settings/profile
apps/web/src/components/                account-menu, dev-switcher, members-table, workspace-guard
tests/e2e/                              global-setup.ts, auth.spec.ts (+ updated shell.spec.ts)
docs/                                   development-accounts, data-model, security (new); others updated
```

---

### Task 1: Permissions, system roles and role-change rules (`@forge/shared`)

**Files:**
- Create: `packages/shared/src/permissions.ts`, `packages/shared/src/role-rules.ts`, `packages/shared/src/api.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/permissions.test.ts`, `packages/shared/src/role-rules.test.ts`, `packages/shared/src/api.test.ts`

**Interfaces — Produces:**
- `PERMISSIONS` (as-const tuple), `type Permission`, `permissionSchema`. Keys: `workspace.view`, `workspace.manage`, `members.view`, `members.manage`, `roles.manage`, `audit.view`, `tickets.view`, `tickets.create`, `tickets.edit`, `tickets.assign`, `fields.manage`, `workflows.configure`, `repositories.connect`, `branches.create`, `reviews.submit`, `reviews.approve`, `pullRequests.merge`.
- `SYSTEM_ROLE_KEYS = ['owner','admin','developer','reviewer','readonly']`, `type RoleDefinition = { key: string; name: string; description: string; permissions: readonly Permission[] }`, `SYSTEM_ROLES: Record<SystemRoleKey, RoleDefinition>`.
  - owner and admin: every permission. developer: `workspace.view, members.view, tickets.view, tickets.create, tickets.edit, tickets.assign, branches.create, reviews.submit`. reviewer: `workspace.view, members.view, tickets.view, reviews.submit, reviews.approve, pullRequests.merge`. readonly: `workspace.view, members.view, tickets.view`.
- `hasPermission(held: readonly string[], needed: Permission): boolean`
- `decideRoleChange(change: MemberRoleChange): RoleChangeDecision` where `MemberRoleChange = { actor: { userId: string; roleKey: string; permissions: readonly string[] }; target: { userId: string; roleKey: string }; newRole: { key: string; permissions: readonly string[] }; ownerCount: number }` and `RoleChangeDecision = { allowed: true } | { allowed: false; reason: 'missing_permission' | 'cannot_change_own_role' | 'owner_required' | 'exceeds_own_permissions' | 'last_owner' }`. Checks run in that order.
- API schemas: `preferencesSchema` (`{ sidebarCollapsed?: boolean }`, strict), `organisationSummarySchema` (`{id,slug,name}`), `roleSummarySchema` (`{id,key,name}`), `membershipSchema` (`{organisation, role, permissions: Permission[]}`), `viewerSchema` (`{ user:{id,email,displayName}, memberships: Membership[], preferences }`), `memberSchema` (`{ user:{id,email,displayName}, role: RoleSummary, joinedAt: string }`), `roleDetailSchema` (`RoleSummary + description + permissions`), `updateMemberRoleBodySchema` (`{ roleId: uuid }`, strict), `renameOrganisationBodySchema` (`{ name: string trimmed 1–80 }`, strict), `devIdentitySchema` (`{ key, label, description, email, displayName }`), `devSessionBodySchema` (`{ key: string }`, strict).

- [ ] **Step 1: Write failing tests.**
  - `permissions.test.ts`: every system role's permissions are a subset of `PERMISSIONS` with no duplicates; owner and admin hold all; readonly holds exactly three; `hasPermission(['tickets.view'],'tickets.view')` true and `hasPermission([], 'tickets.view')` false; `hasPermission(['tickets.view'], 'tickets.edit')` false.
  - `role-rules.test.ts` (table-driven; actor owner `o1`, admin `a1`, developer `d1`, target default `d2`, ownerCount 2): developer changing anyone → `missing_permission`; admin changing own role → `cannot_change_own_role`; owner changing own role → `cannot_change_own_role`; admin promoting developer to owner → `owner_required`; admin demoting an owner → `owner_required`; owner promoting developer to owner → allowed; admin changing developer→reviewer → allowed; a custom actor with `members.manage` but not `pullRequests.merge` assigning a role containing `pullRequests.merge` → `exceeds_own_permissions`; owner demoting the sole other owner when `ownerCount` is 1 → `last_owner`; same with `ownerCount` 2 → allowed. Missing-permission wins over every other denial.
  - `api.test.ts`: `updateMemberRoleBodySchema` rejects `{roleId:'x'}`, `{roleId:<uuid>, role:'owner'}` and `{}`; accepts a valid uuid. `renameOrganisationBodySchema` trims and rejects empty / 81 chars. `preferencesSchema` rejects unknown keys.
- [ ] **Step 2: Run** `npm test -w @forge/shared`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the three modules and re-export from `index.ts`.
- [ ] **Step 4: Run** `npm test -w @forge/shared` and `npm run typecheck -w @forge/shared`. Expected: PASS.

---

### Task 2: Identity and tenancy schema

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/package.json` (depend on `@forge/shared`), `scripts/dev-db.mjs` (add `forge_e2e` to `DATABASES`), `scripts/docker-init-test-db.sql`, `.env.example`
- Create: `packages/db/migrations/0001_*.sql` (generated), `packages/db/src/organisations.ts`
- Test: `packages/db/src/schema.test.ts`

**Interfaces — Produces** (all ids `uuid primary key default uuidv7()`, timestamps `timestamptz` UTC):
- `users`: `email` (unique index on `lower(email)`), `displayName`, `createdAt`.
- `organisations`: `slug` (unique, check `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`), `name`, `createdAt`.
- `roles`: `organisationId` FK, `key`, `name`, `description`, `permissions text[] not null default '{}'`, `isSystem boolean`; unique `(organisationId, key)` and unique `(organisationId, id)`.
- `organisationMemberships`: primary key `(organisationId, userId)`, `roleId`, `createdAt`; **composite FK `(organisationId, roleId) → roles(organisationId, id)`** so a membership can never point at another organisation's role; FK to users.
- `sessions`: `userId` FK, `tokenHash text unique not null`, `createdAt`, `expiresAt`, `lastSeenAt`, `revokedAt null`, `createdVia text not null`; index on `userId`.
- `userPreferences`: `userId` primary key FK, `data jsonb not null default '{}'`, `updatedAt`.
- `developmentFixtures`: `key text primary key`, `userId` unique FK, `label`, `description`, `sortOrder int`.
- `auditEvents`: `organisationId` nullable FK, `actorUserId` nullable FK, `action text`, `targetType text`, `targetId text`, `before jsonb`, `after jsonb`, `requestId text`, `source text` (`user|dev|system`), `outcome text` (`success|denied|failed`), `createdAt`. No update/delete in application code.
- All foreign keys `ON DELETE RESTRICT` (audit history and tenant data must not vanish by cascade).
- `createOrganisationWithSystemRoles(tx: Db, input: { slug: string; name: string }): Promise<{ organisationId: string; roleIds: Record<SystemRoleKey, string> }>` inserts the organisation and one role row per `SYSTEM_ROLES` entry (`isSystem: true`).

- [ ] **Step 1: Write failing tests** (`TEST_DATABASE_URL`; each test starts from `truncate … cascade` of these tables): duplicate emails differing only by case are rejected; slug `Bad Slug!` and `a` are rejected, `acme` accepted; a membership whose `roleId` belongs to a different organisation is rejected by the composite FK (the cross-tenant guard); deleting a user that has a membership or a session fails (RESTRICT); `sessions.tokenHash` uniqueness; `createOrganisationWithSystemRoles` yields five roles whose stored `permissions` equal `SYSTEM_ROLES`; `organisation_memberships` rejects a second row for the same `(organisation, user)`.
- [ ] **Step 2: Run** `npm test -w @forge/db`. Expected: FAIL.
- [ ] **Step 3: Implement** schema + helper; run `npm run db:generate`; review the SQL by eye (check constraint, composite FK, `uuidv7()` defaults, `lower(email)` index); run `npm run db:migrate`; create `forge_e2e` by restarting nothing — the running dev database gets it via a one-off `createdb` call documented in setup (new data directories get it automatically).
- [ ] **Step 4: Run** `npm test -w @forge/db` (the Stage 0 migration tests change to `{expected: 2}` / `{applied: 2}`). Expected: PASS.

---

### Task 3: Development seed and reset

**Files:**
- Create: `packages/db/src/seed.ts`, `packages/db/src/seed-cli.ts`
- Modify: `packages/db/src/index.ts`, `packages/db/package.json` (scripts `seed`, `reseed`), root `package.json` (`db:seed`, `db:reseed`)
- Test: `packages/db/src/seed.test.ts`

**Interfaces — Produces:**
- `type DevIdentityDefinition = { key: string; email: string; displayName: string; label: string; description: string; memberships: { organisationSlug: string; roleKey: string }[] }`
- `DEV_IDENTITIES: readonly DevIdentityDefinition[]` in display order: `owner` (Olivia Owner, acme: owner), `admin` (Adam Admin, acme: admin), `developer` (Dana Developer, acme: developer + northwind: readonly), `reviewer` (Riley Reviewer, acme: reviewer), `readonly` (Remy Read-only, acme: readonly), `restricted` (Casey Restricted, acme: **restricted**), `other-owner` (Nora Northwind, northwind: owner). Emails `<key>@acme.test` except `other-owner@northwind.test`.
- Organisations: `acme` "Acme Robotics", `northwind` "Northwind Traders". The `restricted` role exists only in `acme`: `isSystem: false`, empty permissions.
- `reseedDevelopmentData(db: Db): Promise<void>` — refuses when `NODE_ENV === 'production'`; in one transaction truncates **every table in the `public` schema found in `pg_tables`** (`CASCADE`) then inserts the fixtures, including `development_fixtures` rows.
- `seedDevelopmentDataIfEmpty(db: Db): Promise<boolean>` — seeds only when `organisations` is empty; returns whether it did.
- CLI: `npm run db:seed` (if empty) and `npm run db:reseed` against `DATABASE_URL`; both refuse under `NODE_ENV=production`.

- [ ] **Step 1: Write failing tests:** after `reseedDevelopmentData`, there are 2 organisations and 7 users; each identity has exactly its listed roles; the northwind organisation has no `restricted` role; `developer` holds two memberships; running it twice gives the same counts; an extra user and organisation inserted beforehand are gone afterwards (full reset); a table created ad hoc in `public` is truncated too (proves discovery rather than a hard-coded list; drop it afterwards); with `NODE_ENV=production` it rejects with a message naming the guard and changes nothing; `seedDevelopmentDataIfEmpty` returns `true` then `false` and does not duplicate.
- [ ] **Step 2: Run** `npm test -w @forge/db`. Expected: FAIL.
- [ ] **Step 3: Implement.** Fixtures reference system roles by key through `createOrganisationWithSystemRoles`.
- [ ] **Step 4: Run** `npm test -w @forge/db`; then `npm run db:reseed` against the dev database. Expected: tests PASS; reseed prints the counts.

---

### Task 4: API sessions, cookie auth, origin check, `/me` and logout

**Files:**
- Modify: `apps/api/src/config.ts`, `apps/api/src/app.ts`, `apps/api/src/main.ts`, `apps/api/src/test-utils.ts`, `apps/api/package.json` (`@fastify/cookie`), existing API tests (pass a `db`)
- Create: `apps/api/src/auth/sessions.ts`, `apps/api/src/auth/plugin.ts`, `apps/api/src/auth/guards.ts`, `apps/api/src/auth/origin.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/routes/auth.ts`
- Test: `apps/api/src/config.test.ts` (extended), `apps/api/src/auth/sessions.test.ts`, `apps/api/src/auth/origin.test.ts`, `apps/api/src/routes/me.test.ts`

**Interfaces — Produces:**
- `AppConfig` gains `devAuth: boolean`, `webOrigins: string[]`, `sessionTtlHours: number`. Env: `FORGE_DEV_AUTH` (`1|true|0|false`, default off), `WEB_ORIGIN` (comma list; default `http://localhost:3000,http://127.0.0.1:3000`), `SESSION_TTL_HOURS` (default 168, 1–720). **`loadConfig` throws a `ConfigError` naming `FORGE_DEV_AUTH` when it is on and `NODE_ENV=production`.**
- `AppDeps` gains `db: Db`. `testDb(): Db` in test-utils (a lazily connecting pool that is never queried by unit tests).
- `SESSION_COOKIE = 'forge_session'`; `hashSessionToken(token: string): string` (sha-256 hex); `createSession(db, input: { userId: string; ttlHours: number; createdVia: 'dev' }): Promise<{ token: string; sessionId: string; expiresAt: Date }>` (32 random bytes, base64url); `resolveSession(db, token: string): Promise<{ sessionId: string; user: { id: string; email: string; displayName: string } } | null>` — `null` for unknown, expired or revoked; touches `lastSeenAt` at most once per minute; `revokeSession(db, sessionId: string): Promise<void>`.
- `request.auth: ResolvedSession | null` (Fastify decoration, set by the plugin from the cookie); `requireUser` preHandler → `AppError('unauthenticated','Sign in to continue.',401)`.
- `assertAllowedOrigin(origin: string | undefined, allowed: string[]): boolean` — absent origin allowed (non-browser clients), present origin must match exactly; applied by an `onRequest` hook to every non-`GET/HEAD/OPTIONS` request, failing with `403 forbidden`.
- Cookie attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age = ttl`, `Secure` only when `nodeEnv==='production'`.
- Every response under `/api/` carries `Cache-Control: no-store` (unless the route set its own).
- `GET /api/v1/me` → `viewerSchema` (memberships ordered by organisation name, each with the role's permission array; preferences default `{}`); `POST /api/v1/auth/logout` → `204`, revokes the session, clears the cookie.

- [ ] **Step 1: Write failing tests.**
  - `config.test.ts`: `FORGE_DEV_AUTH=1` with `NODE_ENV=production` throws a `ConfigError` naming `FORGE_DEV_AUTH`; `FORGE_DEV_AUTH=true` in development → `devAuth: true`; unset → `false`; `FORGE_DEV_AUTH=maybe` → error naming it; `WEB_ORIGIN` list is split and trimmed; `SESSION_TTL_HOURS=0` and `9999` rejected.
  - `sessions.test.ts` (real DB): token is 43 base64url chars and the stored `tokenHash` is not the token; `resolveSession` returns the user for a fresh token; returns `null` for a random string, for the right token with one character changed, for an expired session, and for a revoked one; `lastSeenAt` is not rewritten twice within a minute; two sessions for one user are independent.
  - `origin.test.ts`: absent → allowed; exact match → allowed; `http://evil.test` → refused; `http://localhost:3000.evil.test` → refused; `null` origin string → refused.
  - `me.test.ts` (real DB, seeded): no cookie → `401` with the shared error shape; garbage cookie → `401`; valid owner cookie → `200` and `viewerSchema` parses, with the acme owner role's permissions; `developer` shows two memberships (acme, northwind); logout returns `204`, then the same cookie → `401`; a `POST` with `Origin: http://evil.test` → `403` even with a valid cookie; the cookie set at sign-in is `HttpOnly; SameSite=Lax` and not `Secure` in development but `Secure` when `nodeEnv: 'production'`; `/api/v1/me` has `Cache-Control: no-store`.
- [ ] **Step 2: Run** `npm test -w @forge/api`. Expected: FAIL.
- [ ] **Step 3: Implement** the modules; update `main.ts` to pass `db` and log whether dev auth is on (a prominent warning line when it is). Update existing tests to build the app with `testDb()`.
- [ ] **Step 4: Run** `npm test -w @forge/api`, `npm run typecheck -w @forge/api`. Expected: PASS.

---

### Task 5: Dev account switcher API

**Files:**
- Create: `apps/api/src/auth/host.ts`, `apps/api/src/routes/dev.ts`
- Modify: `apps/api/src/app.ts` (register dev routes only when `config.devAuth`), `apps/api/src/audit.ts` (create here: `recordAudit`)
- Test: `apps/api/src/auth/host.test.ts`, `apps/api/src/routes/dev.test.ts`

**Interfaces — Produces:**
- `isLoopbackHost(value: string | undefined): boolean` — true for `localhost`, `127.0.0.1`, `[::1]` with optional port; false for anything else, including `localhost.evil.test`, `127.0.0.1.evil.test`, and an absent header.
- `recordAudit(db: Db, event: { organisationId?: string; actorUserId?: string; action: string; targetType: string; targetId?: string; before?: unknown; after?: unknown; requestId: string; source: 'user'|'dev'|'system'; outcome: 'success'|'denied'|'failed' }): Promise<void>`
- Routes (registered **only** when `config.devAuth`; otherwise the standard `404`): `GET /api/dev/identities` → `devIdentitySchema[]` in seed order; `POST /api/dev/session` body `{ key }` → sets the cookie for the seeded identity with that key, revokes the session presented with the request (if any), writes an audit event (`source: 'dev'`), returns `{ identity }`; `POST /api/dev/reset` → `reseedDevelopmentData`, clears the cookie, returns `204`. All three require `isLoopbackHost` for both `Host` and (when present) `X-Forwarded-Host`, else `403`.

- [ ] **Step 1: Write failing tests.**
  - `host.test.ts`: the cases above, plus uppercase `LOCALHOST:3000`.
  - `dev.test.ts` (real DB, seeded): with `devAuth` **off** all three routes are `404` and no `Set-Cookie` is ever sent; with it **on**: identities list has 7 entries in order and no ids; `POST /api/dev/session {key:'admin'}` → `200`, cookie works against `/api/v1/me` as Adam Admin; an unknown key → `404`; `{ userId: '<uuid>' }`, `{ key:'admin', userId:'<uuid>' }` and `{ email: 'owner@acme.test' }` → `422`/`400` and no cookie; switching while holding the owner's cookie: the old cookie then returns `401` and the new one works (no two live sessions from one switch); `Host: evil.test`, `Host: localhost.evil.test`, and `X-Forwarded-Host: evil.test` each → `403` with no cookie; `Origin: http://evil.test` → `403`; an audit row exists for a switch with `source='dev'` and the actor; `POST /api/dev/reset` removes a user inserted beforehand and invalidates the old cookie; **building the app with `nodeEnv:'production'` and `devAuth:true` is impossible via `loadConfig`**, and `buildApp` itself additionally throws if given that combination.
- [ ] **Step 2: Run** `npm test -w @forge/api`. Expected: FAIL.
- [ ] **Step 3: Implement.** Zod `.strict()` bodies, shared with the web app from `@forge/shared`.
- [ ] **Step 4: Run** `npm test -w @forge/api`. Expected: PASS.

---

### Task 6: Organisation guard, workspace, members and roles endpoints

**Files:**
- Modify: `apps/api/src/auth/guards.ts`, `apps/api/src/app.ts`
- Create: `apps/api/src/routes/orgs.ts`
- Test: `apps/api/src/routes/orgs.test.ts`, `apps/api/src/routes/orgs.concurrency.test.ts`

**Interfaces — Produces:**
- `orgAccess(permission: Permission): preHandler` — requires a session (`401`), validates `:orgId` as a UUID, loads the caller's membership + role for that organisation; **no membership, an invalid UUID and an unknown organisation all yield the same `404 not_found`**; a membership without `permission` yields `403 forbidden`. Sets `request.org = { organisationId: string; membershipUserId: string; role: { id: string; key: string; name: string }; permissions: string[] }`. Every query below takes the organisation id from `request.org`.
- `GET /api/v1/orgs/:orgId` (`workspace.view`) → `{ organisation: {id,slug,name}, memberCount: number, role: RoleSummary }`
- `PATCH /api/v1/orgs/:orgId` (`workspace.manage`, body `renameOrganisationBodySchema`) → updated summary; audit event with before/after name.
- `GET /api/v1/orgs/:orgId/members` (`members.view`) → `memberSchema[]` ordered by display name.
- `GET /api/v1/orgs/:orgId/roles` (`members.view`) → `roleDetailSchema[]`.
- `PATCH /api/v1/orgs/:orgId/members/:userId` (`members.manage`, body `updateMemberRoleBodySchema`) → updated `memberSchema`. In one transaction: lock the organisation row `FOR UPDATE`, **re-read the actor's own membership and role inside the lock** (the guard's copy may be stale if a concurrent request just demoted them), load target membership, load the new role **scoped to `request.org.organisationId`** (not found → `422 validation_failed` "Unknown role"), count owners, call `decideRoleChange`; denial `last_owner` → `409 conflict`, every other denial → `403 forbidden`; success writes membership + audit event (before/after role keys, `source:'user'`). Unknown/foreign target user → `404`.

- [ ] **Step 1: Write failing tests** (real DB, seeded; sign in by creating sessions through the service, not the dev endpoint).
  - **Permission matrix** (`it.each` over identity × endpoint, asserting the exact status): owner, admin → `200` on get/members/roles; developer, reviewer, readonly → `200` on get/members/roles and `403` on `PATCH` org and `PATCH` member; **restricted → `403` on every endpoint**; unauthenticated → `401`; `other-owner` (Northwind) → `404` on every acme endpoint including `PATCH`; `developer` is a read-only member of Northwind, so a Northwind `PATCH` → `403` (a member lacking the permission), while acme reads → `200`. Assert that responses to the `404` cases are byte-identical for: another org's real id, a random uuid, and `not-a-uuid`.
  - **Tenant data:** the members list for acme never contains Nora Northwind; the roles list contains only acme role ids; `memberCount` is 6 for acme.
  - **Escalation and mass assignment:** admin → owner role on developer → `403`; admin demoting the owner → `403`; developer PATCH on self → `403` (no permission); owner PATCH on self → `403`; body `{ roleId, role: 'owner' }` → `422`/`400` and the DB row is unchanged; `roleId` of a Northwind role against acme → `422` and unchanged; non-existent role uuid → `422`; target user from Northwind via the acme URL → `404`.
  - **Success path:** owner changes developer→reviewer → `200`, `GET /members` reflects it, an audit row has `before`/`after` and the owner as actor; admin changes developer→reviewer → allowed.
  - **Last owner:** the `last_owner` denial cannot be reached through the API (actor and target would both have to be owners while only one exists, and self-change is already refused), so it stays as defence in depth, covered by the Task 1 rules test. Through the API assert the reachable cases: an admin cannot demote the only owner (`403`), and after promoting the admin to owner the original owner can demote them (`200`) leaving one owner.
  - `orgs.concurrency.test.ts`: promote the admin to owner, then fire two simultaneous requests — owner A demotes owner B and owner B demotes owner A. Exactly one must succeed (`200`); the other must be refused (`403`, because the re-read actor is no longer an owner), never `500`; afterwards **exactly one owner remains**. Run it 20 times in a loop inside the test.
  - Rename: owner renames → `200` and persisted; blank, 81-char and extra-field bodies rejected; developer → `403`.
- [ ] **Step 2: Run** `npm test -w @forge/api`. Expected: FAIL.
- [ ] **Step 3: Implement.** The 404/403 split lives only in `orgAccess`; handlers never re-check membership.
- [ ] **Step 4: Run** `npm test -w @forge/api`. Expected: PASS (repeat the concurrency test 20 times locally; it must never fail).

---

### Task 7: Preferences endpoints

**Files:** Create `apps/api/src/routes/preferences.ts`; Test `apps/api/src/routes/preferences.test.ts`.

**Interfaces — Produces:** `GET /api/v1/me/preferences` → `Preferences` (`{}` when none stored); `PATCH /api/v1/me/preferences` body `preferencesSchema` → merged `Preferences`; both `requireUser`.

- [ ] **Step 1: Write failing tests:** unauthenticated `401`; first `GET` returns `{}`; `PATCH {sidebarCollapsed:true}` returns it and `/me` now reports it; a later `PATCH {}` keeps the stored value; unknown key and wrong type → `422`; two users' preferences never mix (owner sets true, admin still sees `{}`).
- [ ] **Step 2–4:** Run (FAIL) → implement (upsert into `user_preferences`) → run (PASS).

---

### Task 8: Web — API plumbing, sign-in, shell with identity, switcher

**Files:**
- Modify: `apps/web/next.config.ts` (rewrite `/api/:path*` → `${API_INTERNAL_URL}/api/:path*`; `distDir` from `NEXT_DIST_DIR`), `apps/web/src/app/layout.tsx` (html/body/fonts only), `apps/web/src/lib/nav.ts`, `apps/web/src/lib/nav.test.ts`, `apps/web/src/components/shell/{app-shell,sidebar,topbar}.tsx`, `.gitignore` (`.next-e2e`)
- Move: `apps/web/src/app/{page,loading,error,not-found}.tsx` into `apps/web/src/app/(app)/` (not-found stays at the root as well)
- Create: `apps/web/src/lib/server/api.ts`, `apps/web/src/lib/server/viewer.ts`, `apps/web/src/lib/api-client.ts`, `apps/web/src/app/login/page.tsx`, `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/components/shell/account-menu.tsx`, `apps/web/src/components/shell/dev-switcher.tsx`, `apps/web/src/components/login/dev-sign-in.tsx`
- Delete: `apps/web/src/lib/preferences.ts`, `use-sidebar-collapsed.ts` and their tests (replaced by server preferences)
- Test: `apps/web/src/lib/nav.test.ts`, `apps/web/src/lib/server/viewer.test.ts`

**Interfaces — Produces:**
- `NavItem` gains `requires?: Permission` and `path: string` (workspace-relative, e.g. `''`, `'/members'`); `visibleNavItems(items: NavItem[], ctx: { slug: string; permissions: readonly string[] }): { id: string; label: string; href: string; icon: LucideIcon }[]` — only `available` items whose `requires` the viewer holds, with `href = /w/${slug}${path}`. Items: Overview (`workspace.view`), Members (`members.view`); the rest stay `planned`.
- `getViewer(): Promise<Viewer | null>` (server only): forwards the incoming cookie to `GET /api/v1/me`, validates with `viewerSchema`, `null` on `401`, throws on any other failure (so `error.tsx` shows). `serverFetch(path: string, init?): Promise<Response>` adds the cookie and `cache: 'no-store'`.
- `apiFetch<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T>` (client): same-origin, JSON in/out, throws `ApiRequestError { status, code, message }` from the shared error shape.
- `(app)/layout.tsx`: `getViewer()`; `null` → `redirect('/login')`; passes the viewer and `initialSidebarCollapsed` (from preferences) to `<AppShell>`.
- `/login`: signed-in viewers are redirected to `/`; otherwise `GET /api/dev/identities` — `200` renders the dev picker (a list with display name, role summary and a "Sign in" button per identity, under a clearly marked "Development sign-in — not available in production" banner); `404` renders "Sign-in is not configured for this environment yet." with no controls.
- `<DevSwitcher>` (account menu, only when the identities call succeeded): lists identities, marks the current one, and on selection posts `/api/dev/session` then performs a **full navigation** (`window.location.assign('/')`) so no client cache survives; a "Reset demo data" action behind a confirmation dialog posts `/api/dev/reset` then navigates to `/login`.
- `<AccountMenu>`: shows display name, email and the role in the current workspace; links to Profile; "Sign out" posts `/api/v1/auth/logout` then navigates to `/login`. The top bar keeps a `development` badge when `NODE_ENV !== 'production'`.
- Sidebar collapse: local state initialised from the server preference; toggling updates state immediately and `PATCH`es `/api/v1/me/preferences`; a failed save shows a toast "Couldn't save your sidebar preference" and keeps the local state.

- [ ] **Step 1: Write failing tests.** `nav.test.ts`: `visibleNavItems` for permissions `[]` → `[]`; for `['workspace.view']` → Overview only with `href '/w/acme'`; adding `members.view` adds Members at `/w/acme/members`; planned items never appear even with every permission; slug is encoded into every href. `viewer.test.ts` (fake fetch): `200` valid body → viewer; `401` → `null`; `500` or invalid body → throws; the cookie header is forwarded and `cache: 'no-store'` set.
- [ ] **Step 2: Run** `npm test -w @forge/web`. Expected: FAIL.
- [ ] **Step 3: Implement** the files above. Follow the Next 16 docs in `node_modules/next/dist/docs/` for async `cookies()`/`params`; use `redirect()`/`notFound()` rather than proxy/middleware. Invoke the `frontend-design` skill's guidance only to keep the existing visual language (tokens in `globals.css`); do not redesign.
- [ ] **Step 4: Run** `npm test -w @forge/web`, `npm run typecheck -w @forge/web`, `npm run build -w @forge/web`. Expected: PASS.
- [ ] **Step 5: Browser check** against the running stack: `/` redirects to `/login`; signing in as Admin lands on a workspace; the account menu names the identity; switching to Developer and then Read-only changes the visible navigation without any sign-out; "Sign out" returns to `/login`; the back button after sign-out does not reveal workspace content.

---

### Task 9: Web — workspace overview, members, profile, access states

**Files:**
- Create: `apps/web/src/app/(app)/w/[slug]/layout.tsx`, `.../page.tsx`, `.../members/page.tsx`, `apps/web/src/app/(app)/settings/profile/page.tsx`, `apps/web/src/components/members/members-table.tsx`, `apps/web/src/components/workspace/no-access.tsx`
- Modify: `apps/web/src/app/(app)/page.tsx` (redirect), `apps/web/src/components/shell/sidebar.tsx` (workspace name header and, for viewers with several memberships, a workspace switcher), `apps/web/src/lib/nav.ts` (breadcrumbs from the new routes)
- Test: `apps/web/src/lib/workspaces.test.ts`

**Interfaces — Produces:**
- `pickDefaultWorkspace(memberships: Membership[]): Membership | null` — the first membership (by organisation name) whose permissions include `workspace.view`, else the first membership, else `null`.
- `(app)/page.tsx`: `redirect('/w/<slug>')` for the default workspace; with no memberships, a "You don't belong to any workspace yet" page.
- `w/[slug]/layout.tsx` (`params` is a Promise): slug not among the viewer's memberships → `notFound()` (same page as a non-existent workspace).
- Overview page: viewers without `workspace.view` get `<NoAccess>` (explains that their role has no access to this workspace and names the role; no data fetched). Otherwise the workspace name as the `h1`, "Your role: <role>", member count, and the Stage 0 System status panel beneath.
- Members page: viewers without `members.view` get `<NoAccess>`. Otherwise a table (name, email, role, joined). Rows show a role `<select>` plus "Save" only when the viewer holds `members.manage` **and** the row is not the viewer; the select lists only roles the viewer may assign (computed with `decideRoleChange` against each role for UX only — the API remains authoritative). API refusals show the API's message in a toast and leave the row unchanged.
- Profile page: display name and email (read-only), a "Collapse the sidebar by default" switch bound to the preference, and the list of workspaces with the viewer's role in each.

- [ ] **Step 1: Write failing tests** for `pickDefaultWorkspace` (empty → null; skips a restricted membership when another is viewable; ties by name).
- [ ] **Step 2: Run** (FAIL) → **Step 3: Implement** → **Step 4: Run** `npm test -w @forge/web`, typecheck, build (PASS).

---

### Task 10: End-to-end tests (isolated stack)

**Files:**
- Modify: `playwright.config.ts`, `tests/e2e/shell.spec.ts`, `package.json` (script `test:e2e` unchanged), `.env.example`
- Create: `tests/e2e/global-setup.ts`, `tests/e2e/helpers.ts`, `tests/e2e/auth.spec.ts`, `tests/e2e/permissions.spec.ts`, `tests/e2e/tenancy.spec.ts`

**Interfaces — Produces:** Playwright runs its own stack: `webServer` entries for the API (`API_PORT=4100`, `DATABASE_URL=…/forge_e2e`, `FORGE_DEV_AUTH=1`, `WEB_ORIGIN=http://localhost:3100,http://127.0.0.1:3100`) and the web app (`next dev -H 127.0.0.1 -p 3100`, `API_INTERNAL_URL=http://127.0.0.1:4100`, `NEXT_DIST_DIR=.next-e2e`); `workers: 1`; `baseURL` `http://localhost:3100`. `global-setup.ts` runs migrations on `forge_e2e` and `reseedDevelopmentData` before the tests. `helpers.ts`: `signInAs(page, key: string)` (UI click through the login page) and `reseed()`.

- [ ] **Step 1: Write the tests** (they fail until Tasks 8–9 are wired up in the browser):
  - `auth.spec.ts`: unauthenticated `/` → `/login` and `/w/acme` → `/login`; signing in as Owner shows Olivia Owner in the account menu; **switching** Owner → Developer → Read-only → Restricted through the dev switcher without signing out, each time the account menu shows the new identity; sign-out then Back does not show workspace content; the login page shows the development banner; clearing cookies mid-session redirects to `/login`.
  - `permissions.spec.ts`: Owner sees Members with role selects for others but not for self; Read-only sees the member list with no selects; Restricted sees the no-access explanation on the overview and no nav items besides what its permissions allow; **a direct API call as Restricted** (`page.request` with the session cookie) to `PATCH /api/v1/orgs/<acme>/members/<user>` returns `403` and the role is unchanged (the UI cannot be the only barrier); Admin cannot grant Owner (select lacks it, and a crafted API call returns `403`); Owner changes Developer to Reviewer, switches to Developer → the Members page header shows the new role.
  - `tenancy.spec.ts`: as Nora Northwind, `/w/acme` renders the same not-found page as `/w/nope`; her API call to `/api/v1/orgs/<acme id>/members` returns `404`; as Dana Developer (member of both) the sidebar offers both workspaces and `/w/northwind` shows her read-only role; **no leakage on switch**: load `/w/acme/members` as Owner, switch to Nora, press Back → the page is the login/not-found state, never Acme's members.
  - `shell.spec.ts` updated: sidebar persistence now goes through the server (collapse, reload, still collapsed; collapse as Owner and Admin still expanded); the Stage 0 localStorage tests are replaced by "preference survives clearing localStorage"; keyboard, phone drawer and 404 tests run after signing in.
- [ ] **Step 2: Run** `npm run test:e2e`. Expected: all pass, with the dev stack on :3000/:4000 untouched.
- [ ] **Step 3: Flake check:** run the suite three times in a row; all green.

---

### Task 11: Documentation and Stage 1 verification

**Files:** Create `docs/development-accounts.md`, `docs/data-model.md`, `docs/security.md`; Modify `README.md`, `docs/setup.md`, `docs/architecture.md`, `docs/testing.md`, `docs/known-limitations.md`, `.env.example`.

- [ ] **Step 1: Write docs describing only what exists.** `development-accounts.md`: the seven identities (key, email, role, purpose), how to switch, how to reset, why it cannot exist in production (config refusal, routes not registered, web hides it), the `.test` TLD, and a warning that reset wipes the dev database. `data-model.md`: tables, key constraints (composite tenant FK, RESTRICT), id strategy, which entities are authoritative. `security.md`: session design (hash at rest, cookie flags, expiry), origin check, host check, 404-vs-403 policy, escalation rules, audit coverage, and an honest list of what is **not** covered yet. `known-limitations.md`: no production login method; no idle timeout or session list UI; no rate limiting; role editing UI is Stage 6; audit viewer is Stage 6; tenant-isolation tests cover only the entities that exist.
- [ ] **Step 2: Clean-room run:** fresh copy → `npm install`, `.env`, `db:start`, `db:migrate`, `db:seed`, `npm run dev`, sign in through the browser as each identity.
- [ ] **Step 3: Full gate:** `npm run check` (exit code read), `npm run test:e2e` ×3.
- [ ] **Step 4: Production-config check:** start the API with `NODE_ENV=production FORGE_DEV_AUTH=1` — it must exit `1` naming `FORGE_DEV_AUTH`; with `NODE_ENV=production` and the flag off, `/api/dev/identities` is `404`; a production build of the web app shows the login page without any identity picker.
- [ ] **Step 5: Stage 1 delivery report** (what was built, files, migrations, exact test results, how to run, limitations, what remains).

---

## Self-Review

- **Spec coverage (Stage 1 tasks):** local dev authentication (T4–5, 8), organisations and membership (T2, 6), role/permission enforcement (T1, 6), seeded identities (T3), switcher (T5, 8), organisation isolation (T2 composite FK, T6 guard, T10), basic preferences (T7, 9). Acceptance: switching without sign-out (T10 auth), current identity displayed (T8 account menu), permissions change on switch (T10 permissions), restricted actions fail on the server (T6 matrix + T10 direct API calls), cross-organisation denied (T6, T10), switcher disabled in production config (T4 config test, T5, T11 step 4). Spec §8.3 items: obvious dev indicator (badge + banner), no browser-supplied user id (T5 tests), no cache leak (T4 `no-store`, T8 hard navigation, T10 back-button test).
- **Not in Stage 1 by design:** production login method, invitations, role editor UI, audit viewer, project-level roles, tenant tests for entities that do not exist yet (tickets, attachments, repositories, workflows, comments).
- **Type consistency:** `Permission`, `SYSTEM_ROLES`, `decideRoleChange` (T1) are used by the seed (T3), the API (T6) and the web (T8–9); `viewerSchema` (T1) is produced by `/me` (T4) and consumed by `getViewer` (T8); `orgAccess`/`request.org` (T6) feed the members route in the same task; `recordAudit` is created in T5 and reused in T6.
- **Task order risk:** T4 changes `AppDeps` (adds `db`), so every existing API test is touched in T4; that is deliberate and listed there.
- **Proportion:** tests are listed with exact inputs because those inputs are the decisions; implementation bodies are left to the implementer.
