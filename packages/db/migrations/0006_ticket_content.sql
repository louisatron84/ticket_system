CREATE TABLE "comment_reactions" (
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reactions_comment_id_user_id_reaction_pk" PRIMARY KEY("comment_id","user_id","reaction"),
	CONSTRAINT "comment_reactions_reaction_check" CHECK ("comment_reactions"."reaction" in ('thumbs_up', 'thumbs_down', 'tada', 'eyes', 'heart'))
);
--> statement-breakpoint
CREATE TABLE "ticket_attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_attachments_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "ticket_attachments_name_length" CHECK (char_length("ticket_attachments"."file_name") between 1 and 255),
	CONSTRAINT "ticket_attachments_size_check" CHECK ("ticket_attachments"."size_bytes" between 1 and 10485760)
);
--> statement-breakpoint
CREATE TABLE "ticket_criteria" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_criteria_text_length" CHECK (char_length("ticket_criteria"."text") between 1 and 300),
	CONSTRAINT "ticket_criteria_position_check" CHECK ("ticket_criteria"."position" >= 0),
	CONSTRAINT "ticket_criteria_done_pair" CHECK (("ticket_criteria"."done_at" is null) = ("ticket_criteria"."done_by" is null))
);
--> statement-breakpoint
CREATE TABLE "ticket_mentions" (
	"organisation_id" uuid NOT NULL,
	"source_ticket_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"target_ticket_id" uuid NOT NULL,
	CONSTRAINT "ticket_mentions_source_kind_source_id_target_ticket_id_pk" PRIMARY KEY("source_kind","source_id","target_ticket_id"),
	CONSTRAINT "ticket_mentions_kind_check" CHECK ("ticket_mentions"."source_kind" in ('description', 'goal', 'criterion', 'comment')),
	CONSTRAINT "ticket_mentions_not_self" CHECK ("ticket_mentions"."source_ticket_id" <> "ticket_mentions"."target_ticket_id")
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "goal" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_id_ticket_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."ticket_comments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_fk" FOREIGN KEY ("organisation_id","ticket_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_criteria" ADD CONSTRAINT "ticket_criteria_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_criteria" ADD CONSTRAINT "ticket_criteria_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_criteria" ADD CONSTRAINT "ticket_criteria_ticket_fk" FOREIGN KEY ("organisation_id","ticket_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_mentions" ADD CONSTRAINT "ticket_mentions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_mentions" ADD CONSTRAINT "ticket_mentions_source_fk" FOREIGN KEY ("organisation_id","source_ticket_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_mentions" ADD CONSTRAINT "ticket_mentions_target_fk" FOREIGN KEY ("organisation_id","target_ticket_id") REFERENCES "public"."tickets"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_attachments_ticket_idx" ON "ticket_attachments" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_criteria_ticket_idx" ON "ticket_criteria" USING btree ("ticket_id","position");--> statement-breakpoint
CREATE INDEX "ticket_mentions_target_idx" ON "ticket_mentions" USING btree ("target_ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_mentions_source_ticket_idx" ON "ticket_mentions" USING btree ("source_ticket_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_goal_length" CHECK (char_length("tickets"."goal") <= 500);