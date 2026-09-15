import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { uuidv7 } from "uuidv7";

@Injectable()
export class TicketsService {
  private readonly pool = new Pool({ connectionString: process.env.CORE_DATABASE_URL });

  private shape(row: any) {
    return { id: row.id, identifier: row.id, purchaseId: row.purchase_id, userId: row.user_id, originStation: { id: row.origin_id, code: row.origin_code, name: row.origin_name }, destinationStation: { id: row.destination_id, code: row.destination_code, name: row.destination_name }, paidAmount: row.paid_amount, currency: row.currency, status: row.status, issuedAt: row.issued_at, expiresAt: row.expires_at };
  }

  async issueForPurchase(purchaseId: string, paymentId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = (await client.query("SELECT * FROM tickets WHERE purchase_id = $1 FOR UPDATE", [purchaseId])).rows[0];
      if (existing) { await client.query("UPDATE purchases SET status = 'TICKET_ISSUED', updated_at = NOW() WHERE id = $1", [purchaseId]); await client.query("COMMIT"); return this.shape(existing); }
      const purchase = (await client.query(`SELECT p.*, o.id origin_id, o.code origin_code, o.name origin_name, d.id destination_id, d.code destination_code, d.name destination_name FROM purchases p JOIN stations o ON o.id = p.origin_station_id JOIN stations d ON d.id = p.destination_station_id WHERE p.id = $1 AND p.status IN ('PAID', 'TICKET_ISSUED') FOR UPDATE`, [purchaseId])).rows[0];
      if (!purchase) throw new HttpException({ code: "PURCHASE_NOT_PAID", message: "The purchase is not ready for ticket issuance." }, HttpStatus.CONFLICT);
      const ticket = (await client.query(`INSERT INTO tickets (id, purchase_id, user_id, payment_id, origin_station_id, destination_station_id, paid_amount, currency, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW() + INTERVAL '2 hours') RETURNING *`, [uuidv7(), purchase.id, purchase.user_id, paymentId, purchase.origin_station_id, purchase.destination_station_id, purchase.amount, purchase.currency])).rows[0];
      await client.query("UPDATE purchases SET status = 'TICKET_ISSUED', updated_at = NOW() WHERE id = $1", [purchaseId]);
      await client.query("COMMIT");
      return this.shape({ ...ticket, origin_id: purchase.origin_id, origin_code: purchase.origin_code, origin_name: purchase.origin_name, destination_id: purchase.destination_id, destination_code: purchase.destination_code, destination_name: purchase.destination_name });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async list(userId: string) { const rows = (await this.pool.query(`SELECT t.*, o.id origin_id, o.code origin_code, o.name origin_name, d.id destination_id, d.code destination_code, d.name destination_name FROM tickets t JOIN stations o ON o.id=t.origin_station_id JOIN stations d ON d.id=t.destination_station_id WHERE t.user_id=$1 ORDER BY t.created_at DESC`, [userId])).rows; return { success: true, data: { tickets: rows.map((row) => this.shape(row)) }, requestId: uuidv7() }; }
  async get(userId: string, id: string) { const row = (await this.pool.query(`SELECT t.*, o.id origin_id, o.code origin_code, o.name origin_name, d.id destination_id, d.code destination_code, d.name destination_name FROM tickets t JOIN stations o ON o.id=t.origin_station_id JOIN stations d ON d.id=t.destination_station_id WHERE t.id=$1 AND t.user_id=$2`, [id, userId])).rows[0]; if (!row) throw new HttpException({ code: "TICKET_NOT_FOUND", message: "Ticket not found." }, HttpStatus.NOT_FOUND); return { success: true, data: { ticket: this.shape(row) }, requestId: uuidv7() }; }
}
