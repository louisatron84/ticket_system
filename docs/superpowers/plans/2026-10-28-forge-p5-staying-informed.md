# P5: Staying informed (plan)

Design: [2026-10-28-p5-staying-informed-design.md](../specs/2026-10-28-p5-staying-informed-design.md).
Executed inline (owner: quickest path), one final review. No commits until the owner asks.

1. **Data**: migration `0009_staying_informed`: `ticket_watchers` (+ `unwatched` flag),
   `notifications`, `projects.triage_enabled`, `tickets.triage_state` + `triage_snoozed_until`,
   `triage_proposals`, `triage_rules`, `triage_rota`. Schema tests.
2. **Shared**: notification kinds, schemas and wording; triage schemas and history events;
   notification preferences.
3. **Notification core** (API): `notify()` inside the writing transaction, recipients, dedupe,
   preferences, never the actor; the in-process hub published after commit; `GET /me/events` (SSE);
   list, mark read, mark all; unread count.
4. **Watching**: automatic watching on create, assign, mention, comment; watch/unwatch routes;
   notifications for assigned, mentioned, commented, moved.
5. **Due job**: hourly due-soon and overdue, and snooze wake-up; once per day per person.
6. **Triage API**: intake on create, send to triage, propose, approve, reject, snooze, queue
   routes, arrival rules and rota, history, outcome notifications; boards and the default list
   leave triage tickets out.
7. **Web**: bell + live count, panel, inbox page, notification settings; watch button; My work
   page and sidebar link; Assigned-to-me toggle and the M shortcut; triage tab, queue, proposal
   banner and actions; triage settings (switch, rules, rota).
8. **CLI**: `forge inbox`.
9. **Tests and docs**: API integration tests, web logic, browser tests, docs; full check; final
   review.
