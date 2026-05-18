import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const databaseUrl = process.env.OTC_API_DATABASE_URL;

if (!databaseUrl) {
  throw new Error('OTC_API_DATABASE_URL is required to run OTC API migrations');
}

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));
const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS otc_schema_migrations (
      migration_name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const alreadyApplied = await pool.query('SELECT 1 FROM otc_schema_migrations WHERE migration_name = $1', [file]);
    if (alreadyApplied.rowCount) {
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO otc_schema_migrations (migration_name) VALUES ($1)', [file]);
      await pool.query('COMMIT');
      console.log(JSON.stringify({ msg: 'otc migration applied', migration: file }));
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  await pool.end();
}
