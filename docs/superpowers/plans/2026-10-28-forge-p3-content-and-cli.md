# P3: content, files and CLI moves (plan)

Design: [2026-10-28-p3-content-and-cli-design.md](../specs/2026-10-28-p3-content-and-cli-design.md).
Executed inline (owner: quickest path), one final review. No commits until the owner asks.
Ledger: `.superpowers/sdd/2026-10-28-forge-p3/progress.md`.

Each task: tests first where the logic is pure or server-side, then code, then `npm run check`
for the touched workspaces. Browser tests run at the end of each part on the isolated e2e stack.

## P3a

1. **Data**: migration `0006_ticket_content.sql`: `tickets.goal`; tables `ticket_criteria`,
   `ticket_mentions`, `ticket_attachments`, `comment_reactions` (composite org foreign keys as the
   rest of the schema; checks on lengths, reaction set). Schema, schema tests, seed (goals and
   criteria on a few WEB tickets, one reaction).
2. **Formatting parser** (`packages/shared/src/rich-text.ts`): text to nodes; mention and reference
   extraction; link scheme allow-list; table tests including hostile input and a linear-time check.
3. **Goal and criteria API**: `goal` on create and PATCH (versioned with the ticket); criteria
   routes (add, edit, tick, reorder, delete) with history events and wording; `criteria` counts on
   summary, detail, board; archived refusals; permission matrix.
4. **Mentions API**: on every save of description, goal, criterion or comment, resolve keys within
   the workspace and rewrite `ticket_mentions` for that source; `mentionedIn` and resolved
   `references` (key to title/status) on the detail; comments carry the keys they reference.
5. **Attachments API**: storage driver, signature sniffing, upload/list/download/delete routes,
   headers, limits, history events, permission matrix, config `ATTACHMENTS_DIR`.
6. **Reactions API**: toggle route, reactions on timeline comments.
7. **Web**: rich text renderer and editor (Write/Preview, `@` suggestions, paste/drag upload);
   goal, criteria and attachment sections on the ticket page; comments formatted with reactions;
   create form fields; card criteria chip and Display field; docs.
8. **Browser tests** for P3a.

## P3b

9. **Tokens**: migration `0007_api_tokens.sql` (tokens, device logins); token create/list/revoke
   routes (session only); bearer resolution in the auth plugin with the route allow-list, scope and
   workspace checks, cookie+bearer refusal; audit rows; tests.
10. **Device sign-in**: start, approve/deny, poll routes with expiry, single use and rate limits;
    the `/cli/approve` page and the Tokens page; tests.
11. **CLI** (`apps/cli`): config file, login (browser and token), logout, whoami, the move words;
    integration test running the binary against the API.
12. **Docs and browser tests** for P3b; full check; final review.
