# Known limitations

Honest status at **Stage 0**. If it is not listed as working in the README, assume it does not
exist yet.

## Not built yet

- **Everything product-facing.** No authentication, organisations, projects, tickets, GitHub
  integration, code review, workflows, search, notifications or audit log. Only the shell and the
  system-status page exist.
- **Navigation.** The sidebar shows only routes that exist (Overview). The other nine product areas
  are listed in `apps/web/src/lib/nav.ts` as `planned` and are not rendered, so no link is dead.
- **Background worker.** There is no `apps/worker` and no job table yet; both arrive with the first
  feature that needs a durable job (GitHub webhooks, Stage 3).
- **Light theme.** Colours are CSS variables so one can be added, but only the dark theme exists.

## Constrained or unverified

- **Docker Compose is untested.** `docker-compose.yml` was written but never run because Docker is not
  installed on the development machine. The `npm run db:start` path is the verified one.
- **Embedded PostgreSQL is development-only.** It is a 100 MB+ binary package intended for local use.
  There is no production database setup, backup or recovery procedure yet (Stage 7).
- **No production build for the API.** Internal packages are consumed as TypeScript source and the
  API runs through `tsx`. The web app does have a working `next build`.
- **No CI.** Checks run locally with `npm run check`.
- **Mobile navigation drawer** does not trap focus or restore it on close. Escape and the backdrop
  close it, and it is keyboard operable, but it is not a full modal dialog.
- **First paint of the sidebar** is always expanded; a stored "collapsed" preference applies right
  after hydration, so a collapsed sidebar can flash expanded for a moment on load.
- **`npm audit`** reports 4 moderate advisories from an old `esbuild` bundled by `drizzle-kit`
  (development-only CLI; the advisory concerns esbuild's dev server, which is never started). The
  automatic fix is a breaking downgrade of `drizzle-kit`, so it is not applied. Revisit when
  `drizzle-kit` publishes a release that drops the dependency.
- **End-to-end tests run against a live stack** that you start yourself (or let Playwright start),
  and assume the database is migrated.
- **Browsers tested:** Microsoft Edge (Chromium) only.
- **No security headers or rate limiting** yet (Stage 7). The API and web servers bind to loopback
  and are not intended to be exposed.
