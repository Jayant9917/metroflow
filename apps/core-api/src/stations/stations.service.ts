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
}
