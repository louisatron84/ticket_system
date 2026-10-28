ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_member_fk";
--> statement-breakpoint
ALTER TABLE "cli_logins" DROP CONSTRAINT "cli_logins_member_fk";
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_member_fk" FOREIGN KEY ("organisation_id","user_id") REFERENCES "public"."organisation_memberships"("organisation_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_logins" ADD CONSTRAINT "cli_logins_member_fk" FOREIGN KEY ("organisation_id","approved_by") REFERENCES "public"."organisation_memberships"("organisation_id","user_id") ON DELETE cascade ON UPDATE no action;