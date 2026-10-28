CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_via" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_tokens_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_tokens_scope_check" CHECK ("api_tokens"."scope" in ('read', 'write')),
	CONSTRAINT "api_tokens_via_check" CHECK ("api_tokens"."created_via" in ('page', 'login')),
	CONSTRAINT "api_tokens_name_length" CHECK (char_length("api_tokens"."name") between 1 and 60),
	CONSTRAINT "api_tokens_expiry_check" CHECK ("api_tokens"."expires_at" > "api_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "cli_logins" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"device_code_hash" text NOT NULL,
	"user_code_hash" text NOT NULL,
	"machine" text NOT NULL,
	"request_ip" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_polled_at" timestamp with time zone,
	"approved_by" uuid,
	"organisation_id" uuid,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cli_logins_device_unique" UNIQUE("device_code_hash"),
	CONSTRAINT "cli_logins_user_code_unique" UNIQUE("user_code_hash"),
	CONSTRAINT "cli_logins_status_check" CHECK ("cli_logins"."status" in ('pending', 'approved', 'denied', 'collected')),
	CONSTRAINT "cli_logins_scope_check" CHECK ("cli_logins"."scope" is null or "cli_logins"."scope" in ('read', 'write')),
	CONSTRAINT "cli_logins_approval_check" CHECK (("cli_logins"."status" in ('approved', 'collected')) = ("cli_logins"."approved_by" is not null)),
	CONSTRAINT "cli_logins_machine_length" CHECK (char_length("cli_logins"."machine") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_member_fk" FOREIGN KEY ("organisation_id","user_id") REFERENCES "public"."organisation_memberships"("organisation_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_logins" ADD CONSTRAINT "cli_logins_member_fk" FOREIGN KEY ("organisation_id","approved_by") REFERENCES "public"."organisation_memberships"("organisation_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");