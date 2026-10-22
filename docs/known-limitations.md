# Known limitations

Honest status at **Stage 1**. If it is not listed as working in the README, assume it does not
exist yet.

## Not built yet

- **Any way to sign in outside development.** Only the development account switcher exists. The
  session layer is built so a real login method can be added, but which one (email and password,
  GitHub OAuth, magic link) is still to be decided and built. Until then the sign-in page says
  "Sign-in isn't configured for this environment yet" wherever development sign-in is off.
- **Product features.** No projects, tickets, GitHub integration, code review, workflows, search,
  notifications or audit viewer. The workspace has an overview, members and a profile page.
- **Invitations, removing members, creating workspaces, editing roles.** Members and their roles are
  seeded; role changes between existing roles work. Role editing and invitations are Stage 6.
- **Navigation.** The sidebar shows only pages that exist and that your role may see. The other nine
  product areas are listed in `apps/web/src/lib/nav.ts` as `planned` and are not rendered, so no
  link is dead.
- **Background worker.** There is no `apps/worker` and no job table yet; both arrive with the first
  feature that needs a durable job (GitHub webhooks, Stage 3).
- **Light theme.** Colours are CSS variables so one can be added, but only the dark theme exists.

## Security gaps (see also [security](security.md))

- No rate limiting or lockout on any route (Stage 7).
- No security response headers such as CSP or HSTS from the web app (Stage 7).
- Sessions have an absolute lifetime only: no idle timeout, no list of sessions, no "sign out
  everywhere". Expired and revoked sessions stay in the `sessions` table; nothing purges them yet.
- The audit trail is written (workspace rename, role changes including denied attempts, development
  sign-ins) but there is no screen to read it.
- Tenant-isolation tests cover the entities that exist today. Each later entity must add its own.

## Constrained or unverified

- **Docker Compose is untested.** `docker-compose.yml` was written but never run because Docker is
  not installed on the development machine. The `npm run db:start` path is the verified one.
- **Embedded PostgreSQL is development-only.** It is a 100 MB+ binary package intended for local use.
  There is no production database setup, backup or recovery procedure yet (Stage 7).
- **No production build for the API.** Internal packages are consumed as TypeScript source and the
  API runs through `tsx`. The web app does have a working `next build`.
- **No CI.** Checks run locally with `npm run check` and `npm run test:e2e`.
- **Mobile navigation drawer** does not trap focus or restore it on close. Escape and the backdrop
  close it, and it is keyboard operable, but it is not a full modal dialog. The account menu and
  workspace menu close on Escape and outside clicks but are disclosure panels, not full ARIA menus.
- **`db:reseed` and the "Reset demo data" button delete every table's contents** in the development
  database. That is the point of them, but it will also delete anything you create there by hand
  once later stages add real data.
- **A development session cookie is shared by every port on `localhost`.** Running two stacks on
  different ports in one browser shows a sign-in page on the stack whose database does not know the
  cookie.
- **Dev-mode Next.js badge** is moved to the bottom-right so it does not cover the sidebar toggle;
  it can still sit over a toast in the corner on very narrow screens.
- **`npm audit`** reports 4 moderate advisories from an old `esbuild` bundled by `drizzle-kit`
  (development-only CLI; the advisory concerns esbuild's dev server, which is never started). The
  automatic fix is a breaking downgrade of `drizzle-kit`, so it is not applied. Revisit when
  `drizzle-kit` publishes a release that drops the dependency.
- **Browsers tested:** Microsoft Edge (Chromium) only.
- **The web and API servers bind to loopback** and are not intended to be exposed.
