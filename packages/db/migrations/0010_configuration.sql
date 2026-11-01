CREATE TABLE "custom_field_options" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_fields_organisation_id_unique" UNIQUE("organisation_id","id"),
	CONSTRAINT "custom_fields_kind_check" CHECK ("custom_fields"."kind" in ('text', 'long_text', 'number', 'boolean', 'select', 'multi_select', 'date', 'url', 'person'))
);
--> statement-breakpoint
CREATE TABLE "ticket_field_values" (
	"organisation_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"text_value" text,
	"number_value" double precision,
	"date_value" date,
	"boolean_value" boolean,
	"user_id" uuid,
	"option_ids" uuid[],
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_field_values_pk" PRIMARY KEY("ticket_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title_prefix" text DEFAULT '' NOT NULL,
	"type_id" uuid,
	"priority_id" uuid,
	"component_id" uuid,
	"label_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"criteria" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "components" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "components" ADD COLUMN "default_assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "components" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "workflow_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "status_transitions" ADD COLUMN "rules" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_field_options" ADD CONSTRAINT "custom_field_options_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_options" ADD CONSTRAINT "custom_field_options_field_fk" FOREIGN KEY ("organisation_id","field_id") REFERENCES "public"."custom_fields"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_field_values" ADD CONSTRAINT "ticket_field_values_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_field_values" ADD CONSTRAINT "ticket_field_values_ticket_fk" FOREIGN KEY ("organisation_id","ticket_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_field_values" ADD CONSTRAINT "ticket_field_values_field_fk" FOREIGN KEY ("organisation_id","field_id") REFERENCES "public"."custom_fields"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_field_values" ADD CONSTRAINT "ticket_field_values_user_member_fk" FOREIGN KEY ("organisation_id","user_id") REFERENCES "public"."organisation_memberships"("organisation_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_templates" ADD CONSTRAINT "ticket_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_templates" ADD CONSTRAINT "ticket_templates_project_fk" FOREIGN KEY ("organisation_id","project_id") REFERENCES "public"."projects"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_templates" ADD CONSTRAINT "ticket_templates_type_fk" FOREIGN KEY ("organisation_id","type_id") REFERENCES "public"."ticket_types"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_templates" ADD CONSTRAINT "ticket_templates_priority_fk" FOREIGN KEY ("organisation_id","priority_id") REFERENCES "public"."priorities"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_templates" ADD CONSTRAINT "ticket_templates_component_fk" FOREIGN KEY ("organisation_id","project_id","component_id") REFERENCES "public"."components"("organisation_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_options_field_name_unique" ON "custom_field_options" USING btree ("field_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_organisation_name_unique" ON "custom_fields" USING btree ("organisation_id",lower("name"));--> statement-breakpoint
CREATE INDEX "ticket_field_values_field_idx" ON "ticket_field_values" USING btree ("field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_templates_project_name_unique" ON "ticket_templates" USING btree ("project_id",lower("name"));--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_lead_member_fk" FOREIGN KEY ("organisation_id","lead_id") REFERENCES "public"."organisation_memberships"("organisation_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_default_assignee_member_fk" FOREIGN KEY ("organisation_id","default_assignee_id") REFERENCES "public"."organisation_memberships"("organisation_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_transitions" ADD CONSTRAINT "status_transitions_rules_check" CHECK ("status_transitions"."rules" <@ array['needs_assignee', 'needs_estimate', 'needs_comment', 'no_open_blockers']::text[]);