ALTER TABLE "projects" ADD COLUMN "estimation" text DEFAULT 'time' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "estimate_points" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "rank" text COLLATE "C";--> statement-breakpoint
-- Existing tickets get backlog ranks per project, most urgent first, then oldest first. A rank is
-- 'c' and three base-62 digits (see rankBetween in @forge/shared), room for 238,327 per project.
WITH ordered AS (
	SELECT t.id, row_number() OVER (PARTITION BY t.project_id ORDER BY p.rank DESC, t.created_at, t.id) AS n
	FROM tickets t JOIN priorities p ON p.id = t.priority_id
)
UPDATE tickets SET rank = 'c'
	|| substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (o.n / 3844 % 62)::int + 1, 1)
	|| substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (o.n / 62 % 62)::int + 1, 1)
	|| substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', (o.n % 62)::int + 1, 1)
FROM ordered o WHERE o.id = tickets.id;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "rank" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "tickets_project_rank_idx" ON "tickets" USING btree ("project_id","rank");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_estimation_check" CHECK ("projects"."estimation" in ('time', 'points'));--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_estimate_points_check" CHECK ("tickets"."estimate_points" is null or "tickets"."estimate_points" in (0, 1, 2, 3, 5, 8, 13, 21));--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_rank_length" CHECK (char_length("tickets"."rank") between 1 and 128);