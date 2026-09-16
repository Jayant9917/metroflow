import { Injectable } from "@nestjs/common";
import { Pool } from "pg";

@Injectable()
export class AdminInconsistenciesService {
  private readonly pool = new Pool({ connectionString: process.env.CORE_DATABASE_URL });
  async list() {
    const checks = [
      ["PAID_PURCHASE_WITHOUT_TICKET", `SELECT p.id, 'Paid purchase has no ticket' message FROM purchases p LEFT JOIN tickets t ON t.purchase_id=p.id WHERE p.status IN ('PAID','TICKET_ISSUED') AND t.id IS NULL LIMIT 100`],
      ["ACTIVE_TICKET_WITHOUT_JOURNEY", `SELECT t.id, 'In-journey ticket has no active journey' message FROM tickets t LEFT JOIN journeys j ON j.ticket_id=t.id AND j.status='ACTIVE' WHERE t.status='IN_JOURNEY' AND j.id IS NULL LIMIT 100`],
      ["COMPLETED_JOURNEY_TICKET_MISMATCH", `SELECT j.id, 'Completed journey ticket is not completed' message FROM journeys j JOIN tickets t ON t.id=j.ticket_id WHERE j.status='COMPLETED' AND t.status <> 'COMPLETED' LIMIT 100`],
    ] as const;
    const issues: Array<{ type: string; id: string; message: string }> = [];
    for (const [type, sql] of checks) for (const row of (await this.pool.query(sql)).rows) issues.push({ type, id: row.id, message: row.message });
    return issues;
  }
}
