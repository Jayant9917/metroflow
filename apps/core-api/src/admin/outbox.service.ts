import { Injectable } from "@nestjs/common";
import { Pool } from "pg";

@Injectable()
export class AdminOutboxService {
  private readonly pool = new Pool({ connectionString: process.env.CORE_DATABASE_URL });
  async list() {
    return (await this.pool.query(`SELECT id, event_type, topic, status, attempts, last_error, created_at, published_at FROM outbox_events ORDER BY created_at DESC LIMIT 200`)).rows;
  }
}
