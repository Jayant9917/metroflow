ALTER TABLE "otp_codes" ADD COLUMN "code_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;