CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ticket_id" uuid NOT NULL,
	"actor_id" uuid,
	"text" text NOT NULL,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_kind_check" CHECK ("notifications"."kind" in ('assigned', 'mentioned', 'commented', 'moved', 'due_soon', 'overdue', 'triage_arrival', 'triage_approval', 'triage_outcome')),
	CONSTRAINT "notifications_text_length" CHECK (char_length("notifications"."text") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "ticket_watchers" (
	"organisation_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"watching" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_watchers_ticket_id_user_id_pk" PRIMARY KEY("ticket_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "triage_proposals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"action" text NOT NULL,
	"details" jsonb NOT NULL,
	"proposed_by" uuid NOT NULL,
	"decided_by" uuid,
	"decision" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "triage_proposals_action_check" CHECK ("triage_proposals"."action" in ('accept', 'accept_warming', 'duplicate', 'decline')),
	CONSTRAINT "triage_proposals_decision_check" CHECK ("triage_proposals"."decision" is null or "triage_proposals"."decision" in ('approved', 'rejected')),
	CONSTRAINT "triage_proposals_decided_check" CHECK (("triage_proposals"."decision" is null) = ("triage_proposals"."decided_at" is null) and ("triage_proposals"."decision" is null) = ("triage_proposals"."decided_by" is null)),
	CONSTRAINT "triage_proposals_four_eyes" CHECK ("triage_proposals"."decided_by" is null or "triage_proposals"."decided_by" <> "triage_proposals"."proposed_by")
);
--> statement-breakpoint
CREATE TABLE "triage_rota" (
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "triage_rota_project_id_position_pk" PRIMARY KEY("project_id","position"),
	CONSTRAINT "triage_rota_project_user_unique" UNIQUE("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "triage_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "triage_rules_name_length" CHECK (char_length("triage_rules"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "triage_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "triage_state" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "triage_snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_ticket_fk" FOREIGN KEY ("organisation_id","ticket_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_member_fk" FOREIGN KEY ("organisation_id","recipient_id") REFERENCES "public"."organisation_memberships"("organisation_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_ticket_fk" FOREIGN KEY ("organisation_id","ticket_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_watchers" ADD CONSTRAINT "ticket_watchers_member_fk" FOREIGN KEY ("organisation_id","user_id") REFERENCES "public"."organisation_memberships"("organisation_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_proposals" ADD CONSTRAINT "triage_proposals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_proposals" ADD CONSTRAINT "triage_proposals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_proposals" ADD CONSTRAINT "triage_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_proposals" ADD CONSTRAINT "triage_proposals_ticket_fk" FOREIGN KEY ("organisation_id","ticket_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_rota" ADD CONSTRAINT "triage_rota_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_rota" ADD CONSTRAINT "triage_rota_project_fk" FOREIGN KEY ("organisation_id","project_id") REFERENCES "public"."projects"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_rota" ADD CONSTRAINT "triage_rota_member_fk" FOREIGN KEY ("organisation_id","user_id") REFERENCES "public"."organisation_memberships"("organisation_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_rules" ADD CONSTRAINT "triage_rules_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_rules" ADD CONSTRAINT "triage_rules_project_fk" FOREIGN KEY ("organisation_id","project_id") REFERENCES "public"."projects"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_unique" ON "notifications" USING btree ("recipient_id","ticket_id","kind","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ticket_watchers_user_idx" ON "ticket_watchers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "triage_proposals_open_unique" ON "triage_proposals" USING btree ("ticket_id") WHERE "triage_proposals"."decided_at" is null;--> statement-breakpoint
CREATE INDEX "triage_rules_project_idx" ON "triage_rules" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "tickets_triage_idx" ON "tickets" USING btree ("organisation_id","triage_state");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_triage_state_check" CHECK ("tickets"."triage_state" is null or "tickets"."triage_state" in ('waiting', 'proposed', 'snoozed'));--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_triage_snooze_check" CHECK (("tickets"."triage_state" = 'snoozed') = ("tickets"."triage_snoozed_until" is not null));