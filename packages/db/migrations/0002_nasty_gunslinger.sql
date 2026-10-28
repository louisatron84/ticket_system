-- Trigram matching powers substring search on ticket titles (see tickets_title_trgm_idx below).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "components" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "components_organisation_project_id_unique" UNIQUE("organisation_id","project_id","id")
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	CONSTRAINT "labels_organisation_id_unique" UNIQUE("organisation_id","id"),
	CONSTRAINT "labels_color_check" CHECK ("labels"."color" in ('slate', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'violet'))
);
--> statement-breakpoint
CREATE TABLE "priorities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"rank" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "priorities_organisation_key_unique" UNIQUE("organisation_id","key"),
	CONSTRAINT "priorities_organisation_id_unique" UNIQUE("organisation_id","id")
);
--> statement-breakpoint
CREATE TABLE "project_statuses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_initial" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "project_statuses_project_key_unique" UNIQUE("project_id","key"),
	CONSTRAINT "project_statuses_organisation_project_id_unique" UNIQUE("organisation_id","project_id","id"),
	CONSTRAINT "project_statuses_category_check" CHECK ("project_statuses"."category" in ('not_started', 'in_progress', 'completed'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"next_ticket_number" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_organisation_key_unique" UNIQUE("organisation_id","key"),
	CONSTRAINT "projects_organisation_id_unique" UNIQUE("organisation_id","id"),
	CONSTRAINT "projects_key_format" CHECK ("projects"."key" ~ '^[A-Z][A-Z0-9]{1,9}$'),
	CONSTRAINT "projects_next_number_positive" CHECK ("projects"."next_ticket_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_views_scope_check" CHECK ("saved_views"."scope" in ('personal', 'shared'))
);
--> statement-breakpoint
CREATE TABLE "status_transitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"from_status_id" uuid NOT NULL,
	"to_status_id" uuid NOT NULL,
	CONSTRAINT "status_transitions_pair_unique" UNIQUE("project_id","from_status_id","to_status_id"),
	CONSTRAINT "status_transitions_not_self" CHECK ("status_transitions"."from_status_id" <> "status_transitions"."to_status_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_events_source_check" CHECK ("ticket_events"."source" in ('user', 'system'))
);
--> statement-breakpoint
CREATE TABLE "ticket_labels" (
	"organisation_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "ticket_labels_ticket_id_label_id_pk" PRIMARY KEY("ticket_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ticket_types_organisation_key_unique" UNIQUE("organisation_id","key"),
	CONSTRAINT "ticket_types_organisation_id_unique" UNIQUE("organisation_id","id")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type_id" uuid NOT NULL,
	"status_id" uuid NOT NULL,
	"priority_id" uuid NOT NULL,
	"assignee_id" uuid,
	"reporter_id" uuid NOT NULL,
	"component_id" uuid,
	"due_date" date,
	"estimate_minutes" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_organisation_key_unique" UNIQUE("organisation_id","key"),
	CONSTRAINT "tickets_project_number_unique" UNIQUE("project_id","number"),
	CONSTRAINT "tickets_organisation_id_unique" UNIQUE("organisation_id","id"),
	CONSTRAINT "tickets_title_length" CHECK (char_length("tickets"."title") between 1 and 200),
	CONSTRAINT "tickets_version_positive" CHECK ("tickets"."version" >= 1),
	CONSTRAINT "tickets_number_positive" CHECK ("tickets"."number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_project_fk" FOREIGN KEY ("organisation_id","project_id") REFERENCES "public"."projects"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "priorities" ADD CONSTRAINT "priorities_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_statuses" ADD CONSTRAINT "project_statuses_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_statuses" ADD CONSTRAINT "project_statuses_project_fk" FOREIGN KEY ("organisation_id","project_id") REFERENCES "public"."projects"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_transitions" ADD CONSTRAINT "status_transitions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_transitions" ADD CONSTRAINT "status_transitions_from_fk" FOREIGN KEY ("organisation_id","project_id","from_status_id") REFERENCES "public"."project_statuses"("organisation_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_transitions" ADD CONSTRAINT "status_transitions_to_fk" FOREIGN KEY ("organisation_id","project_id","to_status_id") REFERENCES "public"."project_statuses"("organisation_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_fk" FOREIGN KEY ("organisation_id","ticket_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_fk" FOREIGN KEY ("organisation_id","ticket_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_ticket_fk" FOREIGN KEY ("organisation_id","ticket_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_labels" ADD CONSTRAINT "ticket_labels_label_fk" FOREIGN KEY ("organisation_id","label_id") REFERENCES "public"."labels"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_fk" FOREIGN KEY ("organisation_id","project_id") REFERENCES "public"."projects"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_status_fk" FOREIGN KEY ("organisation_id","project_id","status_id") REFERENCES "public"."project_statuses"("organisation_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_type_fk" FOREIGN KEY ("organisation_id","type_id") REFERENCES "public"."ticket_types"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_priority_fk" FOREIGN KEY ("organisation_id","priority_id") REFERENCES "public"."priorities"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_member_fk" FOREIGN KEY ("organisation_id","assignee_id") REFERENCES "public"."organisation_memberships"("organisation_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_reporter_member_fk" FOREIGN KEY ("organisation_id","reporter_id") REFERENCES "public"."organisation_memberships"("organisation_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_component_fk" FOREIGN KEY ("organisation_id","project_id","component_id") REFERENCES "public"."components"("organisation_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "components_project_name_unique" ON "components" USING btree ("project_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "labels_organisation_name_unique" ON "labels" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "project_statuses_one_initial" ON "project_statuses" USING btree ("project_id") WHERE "project_statuses"."is_initial";--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_personal_name_unique" ON "saved_views" USING btree ("organisation_id","owner_user_id",lower("name")) WHERE "saved_views"."scope" = 'personal';--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_shared_name_unique" ON "saved_views" USING btree ("organisation_id",lower("name")) WHERE "saved_views"."scope" = 'shared';--> statement-breakpoint
CREATE INDEX "ticket_comments_ticket_idx" ON "ticket_comments" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_idx" ON "ticket_events" USING btree ("ticket_id","created_at","id");--> statement-breakpoint
CREATE INDEX "ticket_labels_label_idx" ON "ticket_labels" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "tickets_organisation_project_status_idx" ON "tickets" USING btree ("organisation_id","project_id","status_id");--> statement-breakpoint
CREATE INDEX "tickets_organisation_assignee_idx" ON "tickets" USING btree ("organisation_id","assignee_id");--> statement-breakpoint
CREATE INDEX "tickets_organisation_updated_idx" ON "tickets" USING btree ("organisation_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_organisation_due_idx" ON "tickets" USING btree ("organisation_id","due_date");--> statement-breakpoint
CREATE INDEX "tickets_title_trgm_idx" ON "tickets" USING gin (lower("title") gin_trgm_ops);