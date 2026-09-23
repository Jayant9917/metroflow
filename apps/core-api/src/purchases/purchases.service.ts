import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";
import { CreatePurchaseDto } from "./create-purchase.dto";

type PurchaseRow = {
  id: string;
  origin_id: string;
  origin_code: string;
  origin_name: string;
  destination_id: string;
  destination_code: string;
  destination_name: string;
  amount: string;
  currency: string;
  status: string;
  created_at: Date;
};

@Injectable()
export class PurchasesService {
  private readonly pool = new Pool({
    connectionString: process.env.CORE_DATABASE_URL,
  });

  private notFound() {
    return new HttpException(
      { code: "PURCHASE_NOT_FOUND", message: "Purchase not found." },
      HttpStatus.NOT_FOUND,
    );
  }

  private toPurchase(row: PurchaseRow) {
    return {
      id: row.id,
      originStation: {
        id: row.origin_id,
        code: row.origin_code,
        name: row.origin_name,
      },
      destinationStation: {
        id: row.destination_id,
        code: row.destination_code,
        name: row.destination_name,
      },
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  private async findById(
    client: Pool | PoolClient,
    userId: string,
    purchaseId: string,
  ) {
    return (
      await client.query<PurchaseRow>(
        `SELECT p.id, origin.id AS origin_id, origin.code AS origin_code,
                origin.name AS origin_name, destination.id AS destination_id,
                destination.code AS destination_code, destination.name AS destination_name,
                p.amount, p.currency, p.status, p.created_at
           FROM purchases p
           JOIN stations origin ON origin.id = p.origin_station_id
           JOIN stations destination ON destination.id = p.destination_station_id
          WHERE p.id = $1 AND p.user_id = $2`,
        [purchaseId, userId],
      )
    ).rows[0];
  }

  async create(userId: string, dto: CreatePurchaseDto) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const quote = (
        await client.query<{
          id: string;
          user_id: string;
          origin_station_id: string;
          destination_station_id: string;
          amount: string;
          currency: string;
          expires_at: Date;
          used_at: Date | null;
        }>(
          `SELECT id, user_id, origin_station_id, destination_station_id,
                  amount, currency, expires_at, used_at
             FROM fare_quotes
            WHERE id = $1 AND user_id = $2
            FOR UPDATE`,
          [dto.fareQuoteId, userId],
        )
      ).rows[0];

      if (!quote) throw new HttpException(
        { code: "FARE_QUOTE_NOT_FOUND", message: "Fare quote not found." },
        HttpStatus.NOT_FOUND,
      );
      if (quote.used_at) throw new HttpException(
        { code: "FARE_QUOTE_ALREADY_USED", message: "This fare quote has already been used to create a purchase." },
        HttpStatus.CONFLICT,
      );
      if (new Date(quote.expires_at).getTime() <= Date.now()) throw new HttpException(
        { code: "FARE_QUOTE_EXPIRED", message: "This fare quote has expired. Please select your journey again." },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

      const purchaseId = uuidv7();
      await client.query(
        `INSERT INTO purchases
          (id, user_id, fare_quote_id, origin_station_id, destination_station_id, amount, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          purchaseId,
          userId,
          quote.id,
          quote.origin_station_id,
          quote.destination_station_id,
          quote.amount,
          quote.currency,
        ],
      );
      await client.query("UPDATE fare_quotes SET used_at = NOW() WHERE id = $1", [quote.id]);

      const purchase = await this.findById(client, userId, purchaseId);
      await client.query("COMMIT");
      return {
        success: true,
        data: { purchase: this.toPurchase(purchase!) },
        requestId: uuidv7(),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async get(userId: string, purchaseId: string) {
    const purchase = await this.findById(this.pool, userId, purchaseId);
    if (!purchase) throw this.notFound();
    return { success: true, data: { purchase: this.toPurchase(purchase) }, requestId: uuidv7() };
  }

  async list(userId: string) {
    const rows = (
      await this.pool.query<PurchaseRow>(
        `SELECT p.id, origin.id AS origin_id, origin.code AS origin_code,
                origin.name AS origin_name, destination.id AS destination_id,
                destination.code AS destination_code, destination.name AS destination_name,
                p.amount, p.currency, p.status, p.created_at
           FROM purchases p
           JOIN stations origin ON origin.id = p.origin_station_id
           JOIN stations destination ON destination.id = p.destination_station_id
          WHERE p.user_id = $1 ORDER BY p.created_at DESC`,
        [userId],
      )
    ).rows;
    return {
      success: true,
      data: { purchases: rows.map((row) => this.toPurchase(row)) },
      requestId: uuidv7(),
    };
  }
  async listForOperations(page = 1, pageSize = 25, status?: string, search?: string, sortBy = "createdAt", sortDirection = "desc") {
    const columns: Record<string,string> = { createdAt: "p.created_at", amount: "p.amount", status: "p.status", email: "u.email" };
    const order = `${columns[sortBy] ?? columns.createdAt} ${sortDirection === "asc" ? "ASC" : "DESC"}`;
    const rows = (await this.pool.query(`SELECT p.id, u.email, origin.id origin_id, origin.code origin_code, origin.name origin_name, destination.id destination_id, destination.code destination_code, destination.name destination_name, p.amount, p.currency, p.status, p.created_at, COUNT(*) OVER()::integer total_count FROM purchases p JOIN users u ON u.id=p.user_id JOIN stations origin ON origin.id=p.origin_station_id JOIN stations destination ON destination.id=p.destination_station_id WHERE ($3::text IS NULL OR p.status=$3) AND ($4::text IS NULL OR u.email ILIKE $4 OR CAST(p.id AS text) ILIKE $4) ORDER BY ${order} LIMIT $1 OFFSET $2`, [pageSize, (page - 1) * pageSize, status ?? null, search ? `%${search}%` : null])).rows;
    const totalItems = rows[0]?.total_count ?? 0;
    return { purchases: rows.map((row) => ({ ...this.toPurchase(row), email: row.email })), pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) } };
  }
}
