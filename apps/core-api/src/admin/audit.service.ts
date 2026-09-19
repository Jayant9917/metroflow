import { Injectable } from "@nestjs/common";
import { Pool } from "pg";
@Injectable()
export class AdminAuditService {
  private readonly pool = new Pool({ connectionString: process.env.CORE_DATABASE_URL });
  async list() { return (await this.pool.query(`SELECT a.id, a.action, a.outcome, a.metadata, a.created_at, u.email, u.role FROM auth_audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 200`)).rows; }
}
