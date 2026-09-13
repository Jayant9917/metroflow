import { config } from 'dotenv'; import { resolve } from 'node:path'; import { drizzle } from 'drizzle-orm/node-postgres'; import { migrate } from 'drizzle-orm/node-postgres/migrator'; import { Pool } from 'pg';
config({ path: resolve(__dirname, '../../../../.env') });
async function main() {
  const connectionString = process.env.CORE_DATABASE_URL;
  if (!connectionString) throw new Error('CORE_DATABASE_URL is required');
  const target = new URL(connectionString);
  console.log(`Migration target: ${target.hostname}:${target.port}${target.pathname}`);
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: resolve(__dirname, 'migrations') });
    console.log('Core migrations applied successfully.');
  } finally { await pool.end(); }
}
main().catch((error) => { console.error('Migration failed:', error.code ?? error.name); process.exitCode = 1; });
