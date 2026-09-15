ALTER TABLE "stations" ADD COLUMN "line_order" integer;--> statement-breakpoint
WITH ordered_stations AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS position
  FROM "stations"
)
UPDATE "stations"
SET "line_order" = ordered_stations.position
FROM ordered_stations
WHERE "stations"."id" = ordered_stations."id";--> statement-breakpoint
ALTER TABLE "stations" ALTER COLUMN "line_order" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_stations_line_order" ON "stations" USING btree ("line_order");
