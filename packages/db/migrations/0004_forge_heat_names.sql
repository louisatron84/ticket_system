-- Renames the default priorities after heat, and Blocked to Jammed. As with 0003, only a row whose
-- key and current name are still the old defaults is touched, so a name someone chose is kept, and
-- tickets' history keeps the names as they were when the change happened.
UPDATE "priorities" SET "name" = 'Heatless' WHERE "key" = 'lowest' AND "name" = 'Lowest';--> statement-breakpoint
UPDATE "priorities" SET "name" = 'Ember' WHERE "key" = 'low' AND "name" = 'Low';--> statement-breakpoint
UPDATE "priorities" SET "name" = 'Flame' WHERE "key" = 'normal' AND "name" = 'Normal';--> statement-breakpoint
UPDATE "priorities" SET "name" = 'Blaze' WHERE "key" = 'high' AND "name" = 'High';--> statement-breakpoint
UPDATE "priorities" SET "name" = 'Inferno' WHERE "key" = 'critical' AND "name" = 'Critical';--> statement-breakpoint
UPDATE "project_statuses" SET "name" = 'Jammed' WHERE "key" = 'blocked' AND "name" = 'Blocked';
