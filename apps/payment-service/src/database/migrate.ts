import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

config({ path: resolve(__dirname, "../../../../.env") });

async function main() {
  const connectionString = process.env.PAYMENT_DATABASE_URL;
  if (!connectionString) throw new Error("PAYMENT_DATABASE_URL is required");
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const version = "0001_payment_foundation";
    const existing = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
    if (existing.rowCount) {
      console.log("Payment migrations already applied.");
      return;
    }
    const sql = await readFile(resolve(__dirname, "migrations/0001_payment_foundation.sql"), "utf8");
    await pool.query("BEGIN");
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
    await pool.query("COMMIT");
    console.log("Payment migrations applied successfully.");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Payment migration failed:", error);
  process.exitCode = 1;
});
