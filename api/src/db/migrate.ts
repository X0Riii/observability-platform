import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pkg from 'pg';
const { Pool } = pkg;
import * as schema from './schema.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const connectionString = process.env.DATABASE_URL || 'postgres://obs:obspass@localhost:5432/observability';

const pool = new Pool({ connectionString });
const db = drizzle(pool, { schema });

async function runMigrations() {
  console.log('[Drizzle] Starting migrations...');
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('[Drizzle] Drizzle migrations completed');
  } catch (err) {
    console.error('[Drizzle] Migration failed:', err);
    process.exit(1);
  }
}

async function runPostMigration() {
  try {
    const sqlPath = join(__dirname, 'post-migration.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    await pool.query(sql);
    console.log('[DB] Post-migration SQL (indexes, hypertables, retention) applied');
  } catch (err: any) {
    if (err.message?.includes('already exists') || err.message?.includes('already a hypertable')) {
      console.log('[DB] Post-migration: some objects already exist, skipping...');
    } else {
      console.error('[DB] Post-migration SQL error:', err);
    }
  }
}

async function main() {
  await runMigrations();
  await runPostMigration();
  await pool.end();
  console.log('[DB] All migrations complete.');
}

main();
