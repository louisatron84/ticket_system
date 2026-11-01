CREATE TABLE "cycle_scope_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"change" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_scope_changes_change_check" CHECK ("cycle_scope_changes"."change" in ('added', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "cycles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"capacity" integer,
	"state" text DEFAULT 'planned' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"planned_tickets" integer,
	"planned_estimate" integer,
	"done_tickets" integer,
	"done_estimate" integer,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycles_scope_unique" UNIQUE("organisation_id","project_id","id"),
	CONSTRAINT "cycles_project_number_unique" UNIQUE("project_id","number"),
	CONSTRAINT "cycles_name_length" CHECK (char_length("cycles"."name") between 1 and 80),
	CONSTRAINT "cycles_dates_order" CHECK ("cycles"."ends_on" > "cycles"."starts_on"),
	CONSTRAINT "cycles_state_check" CHECK ("cycles"."state" in ('planned', 'active', 'completed')),
	CONSTRAINT "cycles_capacity_check" CHECK ("cycles"."capacity" is null or "cycles"."capacity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cycles_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "cycle_length_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "cycle_scope_changes" ADD CONSTRAINT "cycle_scope_changes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_scope_changes" ADD CONSTRAINT "cycle_scope_changes_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_scope_changes" ADD CONSTRAINT "cycle_scope_changes_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_project_fk" FOREIGN KEY ("organisation_id","project_id") REFERENCES "public"."projects"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cycle_scope_changes_cycle_idx" ON "cycle_scope_changes" USING btree ("cycle_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "cycles_one_active" ON "cycles" USING btree ("project_id") WHERE "cycles"."state" = 'active';--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_cycle_fk" FOREIGN KEY ("organisation_id","project_id","cycle_id") REFERENCES "public"."cycles"("organisation_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_cycle_idx" ON "tickets" USING btree ("cycle_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_cycle_length_check" CHECK ("projects"."cycle_length_days" between 7 and 28);