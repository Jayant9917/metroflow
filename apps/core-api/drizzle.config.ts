import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../.env') });
export default defineConfig({ schema: './src/database/schema/*.ts', out: './src/database/migrations', dialect: 'postgresql', dbCredentials: { url: process.env.CORE_DATABASE_URL ?? '' } });
