-- Renames the default statuses after the heat of the work. Only a status whose key and current
-- name are still the old defaults is touched, so a name someone chose is never overwritten.
-- Tickets' history is not rewritten: it keeps the names as they were when the change happened.
UPDATE "project_statuses" SET "name" = 'Cold Steel' WHERE "key" = 'backlog' AND "name" = 'Backlog';--> statement-breakpoint
UPDATE "project_statuses" SET "name" = 'Warming' WHERE "key" = 'open' AND "name" = 'Open';--> statement-breakpoint
UPDATE "project_statuses" SET "name" = 'In the Forge' WHERE "key" = 'in_progress' AND "name" = 'In Progress';--> statement-breakpoint
UPDATE "project_statuses" SET "name" = 'Tempering' WHERE "key" = 'in_review' AND "name" = 'In Review';--> statement-breakpoint
UPDATE "project_statuses" SET "name" = 'Quenched' WHERE "key" = 'done' AND "name" = 'Done';--> statement-breakpoint
UPDATE "project_statuses" SET "name" = 'Scrapped' WHERE "key" = 'cancelled' AND "name" = 'Cancelled';
