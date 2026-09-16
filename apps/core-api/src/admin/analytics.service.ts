import { Injectable } from "@nestjs/common";
import { Pool } from "pg";

@Injectable()
export class AdminAnalyticsService {
  private readonly pool = new Pool({ connectionString: process.env.CORE_DATABASE_URL });
  async summary() {
    const queries = await Promise.all([
      this.pool.query("SELECT status, count(*)::int AS count FROM tickets GROUP BY status"),
      this.pool.query("SELECT status, count(*)::int AS count FROM purchases GROUP BY status"),
      this.pool.query("SELECT status, count(*)::int AS count FROM journeys GROUP BY status"),
      this.pool.query("SELECT event_type, count(*)::int AS count FROM gate_events GROUP BY event_type"),
      this.pool.query("SELECT count(*)::int AS count FROM stations WHERE is_active=TRUE"),
    ]);
    const map = (rows: { status?: string; event_type?: string; count: number }[]) => Object.fromEntries(rows.map((row) => [row.status ?? row.event_type, row.count]));
    return { tickets: map(queries[0].rows), purchases: map(queries[1].rows), journeys: map(queries[2].rows), gateEvents: map(queries[3].rows), activeStations: queries[4].rows[0]?.count ?? 0 };
  }
}
