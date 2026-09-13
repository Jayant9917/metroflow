import { config } from "dotenv";
import { resolve } from "node:path";
import { Pool } from "pg";
config({ path: resolve(__dirname, "../../../../.env") });
const retentionDays = Number(process.env.SESSION_RETENTION_DAYS ?? 30);
const connectionString = process.env.CORE_DATABASE_URL;
if (!connectionString) throw new Error("CORE_DATABASE_URL is required");
const pool = new Pool({ connectionString });
async function main() {
  const result = await pool.query(
    `DELETE FROM sessions WHERE status IN ('REVOKED', 'EXPIRED') AND COALESCE(revoked_at, expires_at) < NOW() - ($1 * INTERVAL '1 day')`,
    [retentionDays],
  );
  console.log(
    `Removed ${result.rowCount ?? 0} sessions older than ${retentionDays} days.`,
  );
  await pool.end();
}
main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
