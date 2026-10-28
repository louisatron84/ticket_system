# Development accounts

Forge has eight seeded test identities so you can check what each kind of person sees and may do,
and switch between them instantly without signing out. This exists **only in development**.

## Turn it on

In your `.env`:

```bash
FORGE_DEV_AUTH=1
```

Restart the API (`npm run dev`). Then seed the database once:

```bash
npm run db:seed        # seeds only if the database has no organisations yet
npm run db:reseed      # wipes EVERY table in the dev database, then seeds again
```

Open <http://localhost:3000>. You are sent to `/login`, which lists the eight identities under a
"Development sign-in" banner.

If `/login` instead says "Sign-in isn't configured for this environment yet", the API was started
without `FORGE_DEV_AUTH=1`.

## The identities

All emails use the reserved `.test` domain, so they can never be a real address.

| Key           | Name             | Email                  | Role in Acme Robotics | What it is for                                                              |
| ------------- | ---------------- | ---------------------- | --------------------- | --------------------------------------------------------------------------- |
| `owner`       | Olivia Owner     | `owner@acme.test`      | Owner                 | Full administration, including who else is an owner                         |
| `admin`       | Adam Admin       | `admin@acme.test`      | Administrator         | Configuration and member management; cannot touch owners                    |
| `developer`   | Dana Developer   | `developer@acme.test`  | Developer             | Ticket work, branches. Also a **read-only** member of Northwind Traders     |
| `reviewer`    | Riley Reviewer   | `reviewer@acme.test`   | Reviewer              | Review, approve and merge                                                   |
| `readonly`    | Remy Read-only   | `readonly@acme.test`   | Read-only             | Visibility testing: can look, cannot change                                 |
| `restricted`  | Casey Restricted | `restricted@acme.test` | Restricted (custom)   | A member with **no permissions**, for testing denied actions                |
| `reporter`    | Rowan Reporter   | `reporter@acme.test`   | Reporter (custom)     | Files and comments on tickets, cannot change them; WEB tickets go to triage |
| `other-owner` | Nora Northwind   | `owner@northwind.test` | none (owns Northwind) | Tenant isolation: must never see anything in Acme                           |

Two workspaces exist: **Acme Robotics** (`acme`) and **Northwind Traders** (`northwind`).

### Demo projects and tickets

The seed also creates tickets so the list and the board have something to show:

| Workspace | Project            | Tickets | Notes                                                                  |
| --------- | ------------------ | ------- | ---------------------------------------------------------------------- |
| Acme      | `WEB` Web App      | 12      | Every status used, a few overdue, with labels, components and comments |
| Acme      | `API` Platform API | 8       |                                                                        |
| Northwind | `OPS` Operations   | 4       | Visible only to Northwind members (use Nora to check isolation)        |

### What each identity can do with tickets

| Identity      | Look                                               | Create tickets | Edit and assign | Comment      | Create projects and shared views |
| ------------- | -------------------------------------------------- | -------------- | --------------- | ------------ | -------------------------------- |
| `owner`       | yes                                                | yes            | yes             | yes          | yes                              |
| `admin`       | yes                                                | yes            | yes             | yes          | yes                              |
| `developer`   | yes                                                | yes            | yes             | yes          | no (and read-only in Northwind)  |
| `reviewer`    | yes                                                | no             | no              | yes          | no                               |
| `readonly`    | yes                                                | no             | no              | no           | no                               |
| `restricted`  | no: "You don't have access to projects"            | no             | no              | no           | no                               |
| `other-owner` | Northwind only; Acme looks as if it does not exist | in Northwind   | in Northwind    | in Northwind | in Northwind                     |

## Switching

Open the account menu (top right) and use **Development only: switch test account**. The current
identity is marked, and you land on that identity's workspace. Every switch ends the session you
were using and starts a new one, and ends with a full page load, so nothing the previous identity
could see is left in the browser.

**Reset demo data** in the same menu asks for confirmation, then deletes every record in the
development database (including projects and tickets you made) and recreates the eight accounts and
the demo tickets. It signs you out.

## Why it cannot reach production

- `loadConfig` refuses to start the API with `FORGE_DEV_AUTH` on when `NODE_ENV=production`
  (exit code 1, naming the variable). `buildApp` refuses the same combination.
- With the flag off, the three routes (`/api/dev/identities`, `/api/dev/session`,
  `/api/dev/reset`) are not registered at all, so they are an ordinary `404`.
- Sign-in accepts a seeded identity **key**, never a user id or email. A body containing anything
  else is rejected with `422` and no cookie.
- The routes refuse any request whose `Host` or `X-Forwarded-Host` is not `localhost`,
  `127.0.0.1` or `[::1]`, and the web proxy forwards them only under those names (DNS rebinding).
- The web app hides the switcher unless the API says development sign-in is on.
- Sessions are real server-side sessions, not a front-end variable. Each switch writes an audit
  event with source `dev`.

## Good to know

- The session cookie is `forge_session` and cookies are shared across ports on `localhost`. If you
  run the dev stack (port 3000) and the end-to-end stack (port 3100) in the same browser they use
  different databases, so a cookie from one is simply rejected by the other.
- End-to-end tests use their own database (`forge_e2e`) and reseed it themselves; they never touch
  `forge`.
