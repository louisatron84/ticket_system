# P3: Rich content, files and the first CLI commands (design)

Phase P3 of the [ticket-system roadmap](2026-10-23-ticket-system-roadmap.md#p3-rich-content-and-files-about-10-tasks-includes-part-b3),
widened by the owner on 2026-10-28 to bring the CLI's move commands forward. Two parts, built in
order: **P3a** (ticket parts, formatting, mentions, attachments, reactions) and **P3b** (CLI tokens,
sign-in and moves).

Decisions marked **(owner)** were made by the owner; **(my call)** can be overridden.

## Why

The owner writes every ticket as **a goal, acceptance criteria and a description (owner)**. Today a
ticket has one plain-text box, so that shape lives in habit and the reviewer has to dig for what
"done" means. P3 makes the shape part of the ticket, lets text carry formatting, people, ticket
references and files, and gives the first command-line way to move work.

## Non-goals

- Acceptance criteria as a gate. Ticking every item is **not** needed to reach Quenched **(owner)**;
  blockers stay the only completion rule.
- Reviewer verdicts (met / not met) on criteria **(owner chose plain ticks)**.
- Real sign-in (passwords, MFA, SSO). Needed before Forge leaves localhost; its own phase.
- The hardening beyond industry standard **(owner)**: rotating refresh tokens, OS keychain storage,
  IP allow-lists, a tamper-evident audit log, new-IP notices, auto-revoke on leak.
- CLI commands other than sign-in and moves (`strike`, `cat`, `inspect`, `claim`, `rate`,
  `rekindle` come later).
- Notifications for mentions (P5).
- Cloud storage for files (the driver interface is built; only local disk is implemented).

## P3a

### Ticket parts (owner picked: three separate parts)

- **Goal**: one short text, up to 500 characters, single paragraph with line breaks allowed. Shown
  first on the ticket page, under the title.
- **Acceptance criteria**: an ordered list, at most 50 items, each one line of up to 300
  characters. Add, edit, reorder (drag or move up/down by keyboard), tick, untick, delete.
- **Description**: the existing field, now formatted text (below).
- **Ticking (owner):** anyone with `tickets.edit` may tick or untick; each tick and untick is a
  history line naming who and when ("ticked 'Exports as CSV'"). Adding, editing, reordering and
  removing items are history lines too (reorder as one line).
- Criteria are their own rows (`ticket_criteria`), not part of the ticket version, so ticking while
  someone edits the description does not cause a conflict. **(my call)**
- **Counts:** the summary carries `criteria: { done, total }`. The card shows `☑ 3/5` when total > 0;
  a new Display card field **Criteria**, on by default. The ticket page shows "3 of 5 met".
- Existing tickets keep their text as the Description; Goal and criteria start empty. The create
  form gains Goal and criteria (one per line).
- Archived tickets refuse criteria changes, as with other edits. (A ticket in an archived project
  follows the same rule as its other fields: today only the ticket's own archive is checked.)

### Formatting

- One parser in `packages/shared` turns text into a small tree of allowed nodes: paragraphs,
  headings (`#` to `###`), bold, italic, inline code, fenced code blocks, bullet and numbered lists
  (one level of nesting), quotes, links, line breaks, mentions and ticket references.
- The web renders that tree with React elements only. There is no HTML string anywhere and no
  `dangerouslySetInnerHTML`; anything that is not a node is shown as the text it is. **(my call:
  our own parser instead of a library, so nothing outside a reviewed allow-list can ever render
  and no new dependency enters the supply chain)**
- Links: `[text](url)` and bare `https://…`. Only `http:`, `https:` and `mailto:` are links;
  anything else (`javascript:`, `data:`) stays plain text. Links open with
  `rel="noopener noreferrer nofollow"`.
- Used for the description, comments, and (inline only) the goal and criteria items.
- The editor has **Write** and **Preview** tabs and a short "Formatting help" line.

### Mentions and ticket references

- Typing `@` suggests workspace members; the choice is stored as `@[Display Name](user:<uuid>)`.
  Shown as the member's *current* name; a removed member shows as the stored name, greyed.
- A key like `WEB-12` (word boundary, project key pattern) becomes a link when that ticket exists in
  this workspace; the server resolves keys, so a key from another workspace stays plain text.
- **Mentioned in:** saving a description, goal, criterion or comment records which tickets it
  references (`ticket_mentions`: source ticket, target ticket). The target's page lists "Mentioned
  in WEB-3, API-7". A reference to itself is ignored.

### Attachments

- Upload by picking a file, dragging onto the ticket, or pasting an image into any editor. Body is
  the raw file (`application/octet-stream`) with the name in a header, so no multipart parser is
  added. 10 MB each; at most 100 per ticket. **(my call)**
- **Allowed by content signature, not by name:** PNG, JPEG, GIF, WebP, PDF, ZIP, and text (`.txt`,
  `.md`, `.csv`, `.json`, `.log`: valid UTF-8, no NUL bytes). SVG, HTML and anything else are
  refused, whatever the file is called. The stored type is the detected one.
- Stored under a random 32-byte key in a storage driver (`LocalDiskStorage`, folder from
  `ATTACHMENTS_DIR`, default `./data/attachments`). The file name is metadata only, never a path.
- **Download:** `GET …/attachments/:id/file` checks the caller may see the ticket every time. Sent
  with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: sandbox; default-src 'none'`, the detected type. Raster images may be
  asked for `?inline=1` for thumbnails; nothing else is ever inline.
- Who: `tickets.edit` uploads; the uploader or `tickets.edit` deletes; `tickets.view` downloads.
  Upload and delete are history lines. Deleting removes the file from storage after the row.
- Pasted images are inserted into the text as `![name](attachment:<id>)` and render as the
  thumbnail; the attachment list shows every file with size, uploader and date.

### Reactions

- On comments only, the fixed set 👍 👎 🎉 👀 ❤️ **(owner kept all four extras)**. Click to add or
  remove yours (`tickets.comment`); the chip shows the count and, on hover, who. Not history lines.
  **(my call)**

## P3b

### Tokens

- Table `api_tokens`: user, workspace, name, scope (`read` | `write`), token hash (SHA-256), a short
  visible prefix for recognition, created, expires (required, default 30 days, max 365), last used
  at and IP, revoked at.
- Format `forge_pat_` + 32 random bytes base64url. Shown once; only the hash is stored.
- A token may only do ticket work (`tickets.view`, `create`, `edit`, `assign`, `comment`); every
  other permission is refused even if the owner's role has it.
- `Authorization: Bearer forge_pat_…` is accepted **only** on `/api/v1/orgs/:orgId/…` routes of the
  token's own workspace and on `/api/v1/cli/*`. A token can never create tokens, change
  preferences, switch accounts or manage the workspace. **(my call)**
- `read` tokens may use safe methods only. A token is capped by its user's role at the moment of
  each request.
- Bearer requests carry no cookie, so the Origin check (which protects cookies from cross-site
  requests) does not apply to them; a request carrying both a cookie and a bearer token is refused.
- Tokens page under the account menu: create (name, scope, workspace, expiry), list (prefix, scope,
  last used, expiry), revoke. Revoking takes effect on the next request.
- Audit log rows: `token.created`, `token.revoked`, `token.first_used`.

### Sign-in from the browser (device style)

- `POST /api/v1/cli/login` (no auth, rate limited per IP) returns a device code (secret, 32 bytes),
  a user code (`XXXX-XXXX` from an unambiguous alphabet), a verification URL and an interval.
  Lifetime 10 minutes; only hashes are stored.
- The person opens `/cli/approve`, signs in as usual, types or confirms the code, sees the machine
  name and IP the CLI reported, picks the workspace and scope, and clicks Allow (or Deny).
  Approving needs a session cookie and passes the usual Origin check.
- The CLI polls `POST /api/v1/cli/token` with the device code; after approval it receives the token
  once, and the request is spent. Wrong user codes are rate limited (5 per minute per session).
- The token never appears in a URL or a log line.

### The CLI

- New workspace `apps/cli` (Node; its only dependency is `tsx`, already used by the repo, so it
  runs from source without a build), bin `forge`, installed with
  `npm link -w @forge/cli`.
- `forge login [--server URL] [--token]`: browser flow by default, `--token` reads a pasted token
  without echo. `forge logout` revokes on the server, then deletes the local file. `forge whoami`.
- Config at `~/.forge/config.json`, created owner-only (`0600`; on Windows the file's inherited ACL
  is removed and only the current user is granted access).
- Refuses `http://` to anything but `localhost` and `127.0.0.1`.
- **Moves (owner's words):** `forge cold|warm|hammer|temper|jammed|jam|quench|scrap <KEY>`, key
  case-insensitive. Each word maps to a status key (`backlog`, `open`, `in_progress`, `in_review`,
  `blocked`, `done`, `cancelled`) and uses the same PATCH as the board, so the workflow and the
  blocker rule apply with the same messages. A project without that status: "WEB has no Tempering
  column." Exit code 0 on success, 1 on a refusal, 2 on a usage error.

## Testing

- Shared: the parser against an exhaustive table, including every hostile input from the security
  doc (script tags, `javascript:` links, nested brackets, very long input in linear time).
- API: criteria rules and history, mentions resolved within a workspace only, attachment signature
  checks (an SVG named `.png`, HTML named `.txt`, a 10 MB + 1 byte body), download headers,
  permission matrix, reactions; tokens (scope, workspace, revoked, expired, cookie + bearer refused,
  route allow-list), device flow (expiry, spent, wrong code limit, deny).
- Web logic: card counts, editor helpers, CLI word mapping.
- Browser: writing a ticket with all three parts, ticking, formatting preview, a mention, uploading
  and pasting, reactions, creating and revoking a token, approving a CLI login.
- CLI: an integration test that runs the real `forge` binary against the test API.
