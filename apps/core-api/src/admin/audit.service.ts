import { Injectable } from "@nestjs/common";
import { Pool } from "pg";
@Injectable()
export class AdminAuditService {
  private readonly pool = new Pool({ connectionString: process.env.CORE_DATABASE_URL });
  async list(page = 1, pageSize = 25, action?: string) { const rows = (await this.pool.query(`SELECT a.id, a.action, a.outcome, a.metadata, a.created_at, u.email, u.role, COUNT(*) OVER()::integer total_count FROM auth_audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE ($3::text IS NULL OR a.action=$3) ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`, [pageSize, (page - 1) * pageSize, action ?? null])).rows; const totalItems = rows[0]?.total_count ?? 0; return { events: rows, pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) } }; }
}
