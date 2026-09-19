import { Injectable } from "@nestjs/common";
import { Pool } from "pg";

@Injectable()
export class StationsService {
  private readonly pool = new Pool({
    connectionString: process.env.CORE_DATABASE_URL,
  });

  async listActive() {
    const result = await this.pool.query(
      'SELECT id, code, name, line_order AS "lineOrder" FROM stations WHERE is_active = TRUE ORDER BY line_order ASC',
    );
    return result.rows;
  }

  async listForOperations() {
    const result = await this.pool.query(`
      SELECT s.id, s.code, s.name, s.line_order AS "lineOrder", s.is_active AS "isActive",
        COALESCE(json_agg(json_build_object('id', g.id, 'code', g.code, 'type', g.type, 'status', g.status) ORDER BY g.type, g.code) FILTER (WHERE g.id IS NOT NULL), '[]') AS gates
      FROM stations s LEFT JOIN gates g ON g.station_id = s.id
      GROUP BY s.id ORDER BY s.line_order ASC
    `);
    return result.rows;
  }
  async setStationStatus(id: string, isActive: boolean, actorId: string) {
    const row = (await this.pool.query("UPDATE stations SET is_active=$2, updated_at=NOW() WHERE id=$1 RETURNING id, code, name, is_active AS \"isActive\"", [id, isActive])).rows[0];
    if (!row) throw new Error("Station not found.");
    await this.pool.query("INSERT INTO auth_audit_logs (id,user_id,action,outcome,metadata) VALUES (gen_random_uuid(),$1,'STATION_STATUS_CHANGED','SUCCESS',$2)", [actorId, JSON.stringify({ stationId: id, isActive })]);
    return row;
  }
  async setGateStatus(id: string, status: "ACTIVE" | "INACTIVE", actorId: string) {
    const row = (await this.pool.query("UPDATE gates SET status=$2, updated_at=NOW() WHERE id=$1 RETURNING id, station_id, code, type, status", [id, status])).rows[0];
    if (!row) throw new Error("Gate not found.");
    await this.pool.query("INSERT INTO auth_audit_logs (id,user_id,action,outcome,metadata) VALUES (gen_random_uuid(),$1,'GATE_STATUS_CHANGED','SUCCESS',$2)", [actorId, JSON.stringify({ gateId: id, status })]);
    return row;
  }
}
