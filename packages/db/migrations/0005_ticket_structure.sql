CREATE TABLE "ticket_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"source_ticket_id" uuid NOT NULL,
	"target_ticket_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_links_pair_kind_unique" UNIQUE("source_ticket_id","target_ticket_id","kind"),
	CONSTRAINT "ticket_links_not_self" CHECK ("ticket_links"."source_ticket_id" <> "ticket_links"."target_ticket_id"),
	CONSTRAINT "ticket_links_kind_check" CHECK ("ticket_links"."kind" in ('blocks', 'relates_to', 'duplicates'))
);
--> statement-breakpoint
ALTER TABLE "project_statuses" ADD COLUMN "is_cancellation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "blockers_stop_completion" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "status_before_jam_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "origin" text DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_source_fk" FOREIGN KEY ("organisation_id","source_ticket_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_target_fk" FOREIGN KEY ("organisation_id","target_ticket_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_links_source_idx" ON "ticket_links" USING btree ("source_ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_links_target_idx" ON "ticket_links" USING btree ("target_ticket_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_parent_fk" FOREIGN KEY ("organisation_id","parent_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_before_jam_fk" FOREIGN KEY ("organisation_id","project_id","status_before_jam_id") REFERENCES "public"."project_statuses"("organisation_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_parent_idx" ON "tickets" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_origin_check" CHECK ("tickets"."origin" in ('person', 'scan'));--> statement-breakpoint
-- Scrapped (key `cancelled`) is the one default status that means "won't do", so blockers never stop it.
UPDATE "project_statuses" SET "is_cancellation" = true WHERE "key" = 'cancelled';
