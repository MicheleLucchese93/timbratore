import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { adminPool as pool } from '../src/lib/admin-db.js';
import { createLogger } from '../src/lib/logger.js';

const logger = createLogger('migrate');

async function main(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const dir = new URL('../supabase/migrations', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const exists = await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = $1`, [f]);
    if (exists.rowCount && exists.rowCount > 0) {
      logger.info({ file: f }, 'already applied');
      continue;
    }
    const sql = await readFile(join(dir.pathname, f), 'utf8');
    logger.info({ file: f }, 'applying');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query(`INSERT INTO schema_migrations(filename) VALUES ($1)`, [f]);
      await pool.query('COMMIT');
      logger.info({ file: f }, 'applied');
    } catch (err) {
      await pool.query('ROLLBACK');
      logger.error({ err, file: f }, 'failed');
      throw err;
    }
  }
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
