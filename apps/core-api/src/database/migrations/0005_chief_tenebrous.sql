CREATE TYPE "public"."gate_status_type" AS ENUM('ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."gate_type" AS ENUM('ENTRY', 'EXIT');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fare_rules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"origin_station_id" uuid NOT NULL,
	"destination_station_id" uuid NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"station_id" uuid NOT NULL,
	"code" text NOT NULL,
	"type" "gate_type" NOT NULL,
	"status" "gate_status_type" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fare_rules" ADD CONSTRAINT "fare_rules_origin_station_id_stations_id_fk" FOREIGN KEY ("origin_station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fare_rules" ADD CONSTRAINT "fare_rules_destination_station_id_stations_id_fk" FOREIGN KEY ("destination_station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gates" ADD CONSTRAINT "gates_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fare_rules_origin" ON "fare_rules" USING btree ("origin_station_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_fare_rules_destination" ON "fare_rules" USING btree ("destination_station_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_gates_station_code" ON "gates" USING btree ("station_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gates_station_id" ON "gates" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_gates_status" ON "gates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_stations_code" ON "stations" USING btree ("code");