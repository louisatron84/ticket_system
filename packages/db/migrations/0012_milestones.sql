CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"target_date" date,
	"health" text DEFAULT 'on_track' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestones_scope_unique" UNIQUE("organisation_id","project_id","id"),
	CONSTRAINT "milestones_name_length" CHECK (char_length("milestones"."name") between 1 and 80),
	CONSTRAINT "milestones_description_length" CHECK (char_length("milestones"."description") <= 2000),
	CONSTRAINT "milestones_health_check" CHECK ("milestones"."health" in ('on_track', 'at_risk', 'off_track'))
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "milestone_id" uuid;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_fk" FOREIGN KEY ("organisation_id","project_id") REFERENCES "public"."projects"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "milestones_project_name_unique" ON "milestones" USING btree ("project_id",lower("name"));--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_milestone_fk" FOREIGN KEY ("organisation_id","project_id","milestone_id") REFERENCES "public"."milestones"("organisation_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_milestone_idx" ON "tickets" USING btree ("milestone_id");