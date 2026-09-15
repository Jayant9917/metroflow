import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { uuidv7 } from "uuidv7";

@Injectable()
export class JourneysService {
  private readonly pool = new Pool({
    connectionString: process.env.CORE_DATABASE_URL,
  });
  private select = `SELECT j.*, es.id entry_station_id, es.code entry_station_code, es.name entry_station_name, xs.id actual_exit_station_id, xs.code actual_exit_station_code, xs.name actual_exit_station_name FROM journeys j JOIN stations es ON es.id=j.entry_station_id LEFT JOIN stations xs ON xs.id=j.exit_station_id`;
  private shape(row: any) {
    return {
      id: row.id,
      ticketId: row.ticket_id,
      status: row.status,
      entryStation: {
        id: row.entry_station_id,
        code: row.entry_station_code,
        name: row.entry_station_name,
      },
      actualExitStation: row.actual_exit_station_id
        ? {
            id: row.actual_exit_station_id,
            code: row.actual_exit_station_code,
            name: row.actual_exit_station_name,
          }
        : null,
      entryGateId: row.entry_gate_id,
      exitGateId: row.exit_gate_id,
      enteredAt: row.entered_at,
      expiresAt: row.expires_at,
      exitedAt: row.exited_at,
      timedOutAt: row.timed_out_at,
    };
  }
  async list(userId: string, ticketId?: string, status?: string) {
    await this.expireOverdue(userId);
    const values: unknown[] = [userId];
    const where = ["j.user_id=$1"];
    if (ticketId) {
      values.push(ticketId);
      where.push(`j.ticket_id=$${values.length}`);
    }
    if (status) {
      values.push(status);
      where.push(`j.status=$${values.length}`);
    }
    const rows = (
      await this.pool.query(
        `${this.select} WHERE ${where.join(" AND ")} ORDER BY j.created_at DESC`,
        values,
      )
    ).rows;
    return {
      success: true,
      data: { journeys: rows.map((row) => this.shape(row)) },
      requestId: uuidv7(),
    };
  }
  async get(userId: string, id: string) {
    await this.expireOverdue(userId);
    const row = (
      await this.pool.query(`${this.select} WHERE j.id=$1 AND j.user_id=$2`, [
        id,
        userId,
      ])
    ).rows[0];
    if (!row)
      throw new HttpException(
        { code: "JOURNEY_NOT_FOUND", message: "Journey not found." },
        HttpStatus.NOT_FOUND,
      );
    return {
      success: true,
      data: { journey: this.shape(row) },
      requestId: uuidv7(),
    };
  }
  private async expireOverdue(userId: string) {
    await this.pool.query(
      `UPDATE journeys SET status='TIMED_OUT', timed_out_at=COALESCE(timed_out_at,NOW()), updated_at=NOW() WHERE user_id=$1 AND status='ACTIVE' AND expires_at <= NOW()`,
      [userId],
    );
  }
}
