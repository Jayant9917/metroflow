CREATE TYPE "public"."gate_event_type" AS ENUM('ENTRY_ACCEPTED', 'ENTRY_REJECTED', 'EXIT_ACCEPTED', 'EXIT_REJECTED');--> statement-breakpoint
CREATE TYPE "public"."gate_rejection_reason_type" AS ENUM('TICKET_NOT_FOUND', 'TICKET_EXPIRED', 'TICKET_COMPLETED', 'TICKET_ALREADY_IN_JOURNEY', 'WRONG_ORIGIN', 'WRONG_DESTINATION', 'NO_ACTIVE_JOURNEY', 'JOURNEY_TIMED_OUT', 'GATE_INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."journey_status_type" AS ENUM('ACTIVE', 'COMPLETED', 'TIMED_OUT');--> statement-breakpoint
CREATE TYPE "public"."outbox_status_type" AS ENUM('PENDING', 'PUBLISHED', 'DEAD');--> statement-breakpoint
CREATE TYPE "public"."purchase_status_type" AS ENUM('CREATED', 'PAYMENT_PENDING', 'PAID', 'TICKET_ISSUED');--> statement-breakpoint
CREATE TYPE "public"."ticket_status_type" AS ENUM('ISSUED', 'IN_JOURNEY', 'COMPLETED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fare_quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"origin_station_id" uuid NOT NULL,
	"destination_station_id" uuid NOT NULL,
	"fare_rule_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_fare_quotes_different_stations" CHECK ("fare_quotes"."origin_station_id" <> "fare_quotes"."destination_station_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gate_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gate_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"ticket_id" uuid,
	"event_type" "gate_event_type" NOT NULL,
	"rejection_reason" "gate_rejection_reason_type",
	"request_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journeys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_station_id" uuid NOT NULL,
	"exit_station_id" uuid,
	"entry_gate_id" uuid NOT NULL,
	"exit_gate_id" uuid,
	"status" "journey_status_type" DEFAULT 'ACTIVE' NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"exited_at" timestamp with time zone,
	"timed_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_journeys_expires_after_entry" CHECK ("journeys"."expires_at" > "journeys"."entered_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status_type" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempted_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_outbox_attempts_non_negative" CHECK ("outbox_events"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"fare_quote_id" uuid NOT NULL,
	"origin_station_id" uuid NOT NULL,
	"destination_station_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "purchase_status_type" DEFAULT 'CREATED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_purchases_different_stations" CHECK ("purchases"."origin_station_id" <> "purchases"."destination_station_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purchase_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"origin_station_id" uuid NOT NULL,
	"destination_station_id" uuid NOT NULL,
	"paid_amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "ticket_status_type" DEFAULT 'ISSUED' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_tickets_expiry_after_issue" CHECK ("tickets"."expires_at" > "tickets"."issued_at")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fare_quotes" ADD CONSTRAINT "fare_quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fare_quotes" ADD CONSTRAINT "fare_quotes_origin_station_id_stations_id_fk" FOREIGN KEY ("origin_station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fare_quotes" ADD CONSTRAINT "fare_quotes_destination_station_id_stations_id_fk" FOREIGN KEY ("destination_station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fare_quotes" ADD CONSTRAINT "fare_quotes_fare_rule_id_fare_rules_id_fk" FOREIGN KEY ("fare_rule_id") REFERENCES "public"."fare_rules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_gate_id_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."gates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_entry_station_id_stations_id_fk" FOREIGN KEY ("entry_station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_exit_station_id_stations_id_fk" FOREIGN KEY ("exit_station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_entry_gate_id_gates_id_fk" FOREIGN KEY ("entry_gate_id") REFERENCES "public"."gates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "journeys" ADD CONSTRAINT "journeys_exit_gate_id_gates_id_fk" FOREIGN KEY ("exit_gate_id") REFERENCES "public"."gates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchases" ADD CONSTRAINT "purchases_fare_quote_id_fare_quotes_id_fk" FOREIGN KEY ("fare_quote_id") REFERENCES "public"."fare_quotes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchases" ADD CONSTRAINT "purchases_origin_station_id_stations_id_fk" FOREIGN KEY ("origin_station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchases" ADD CONSTRAINT "purchases_destination_station_id_stations_id_fk" FOREIGN KEY ("destination_station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_origin_station_id_stations_id_fk" FOREIGN KEY ("origin_station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tickets" ADD CONSTRAINT "tickets_destination_station_id_stations_id_fk" FOREIGN KEY ("destination_station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fare_quotes_user_id" ON "fare_quotes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fare_quotes_expires_at" ON "fare_quotes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gate_events_gate_id" ON "gate_events" USING btree ("gate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gate_events_occurred_at" ON "gate_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gate_events_ticket_id" ON "gate_events" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_gate_events_request_id" ON "gate_events" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_journeys_ticket_id" ON "journeys" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_journeys_user_id" ON "journeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_journeys_status" ON "journeys" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_journeys_entry_station" ON "journeys" USING btree ("entry_station_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_journeys_active_expires" ON "journeys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_outbox_pending" ON "outbox_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_outbox_dead" ON "outbox_events" USING btree ("attempts");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_purchases_fare_quote_id" ON "purchases" USING btree ("fare_quote_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_purchases_user_id" ON "purchases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_purchases_status" ON "purchases" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tickets_payment_id" ON "tickets" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tickets_purchase_id" ON "tickets" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_user_id" ON "tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_status" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tickets_expires_at" ON "tickets" USING btree ("expires_at");