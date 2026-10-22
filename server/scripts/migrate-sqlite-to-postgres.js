// One-off migration: copies every row out of the old node:sqlite file (app.db) into
// the new Postgres database, preserving explicit ids, then resyncs each table's
// identity sequence so the next INSERT continues from the right number.
//
// Run once, after the server (and its Postgres schema via initSchema()) is already
// up: `docker compose exec server node scripts/migrate-sqlite-to-postgres.js`.
// Safe to re-run — every insert uses ON CONFLICT (...) DO NOTHING on the table's
// natural key, so rows already migrated are simply skipped the second time.
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const SQLITE_PATH = process.env.SQLITE_PATH || '/app/data/app.db';

// Order matters only for readability/logging here — none of these are real foreign
// keys enforced across the alias-keyed tables, but this still follows the same
// "accounts, then catalog, then history, then plans" order the app itself builds
// data in, so row counts read sensibly top to bottom.
// `users` gets special handling: ensureAdminAccount() (server/src/lib/auth.js) runs
// on every boot, including the very first boot against an empty Postgres database —
// so by the time this script runs, a placeholder "admin" row (from ADMIN_PASSWORD in
// .env, with a fresh id) already exists. The historical row from SQLite — the real
// password the user actually set, and the id every migrated `sessions` row points at
// — must win, not be silently skipped. `DO UPDATE` (not `DO NOTHING`) on the
// username conflict overwrites that placeholder's id/password_hash/created_at with
// the authoritative migrated values.
const TABLES = [
  { name: 'users', columns: ['id', 'username', 'password_hash', 'created_at'], conflict: ['username'], onConflictUpdate: ['id', 'password_hash', 'created_at'], idColumn: 'id' },
  { name: 'sessions', columns: ['token', 'user_id', 'created_at', 'expires_at'], conflict: ['token'], idColumn: null },
  { name: 'import_templates', columns: ['id', 'file_type', 'column_mapping', 'headers_signature'], conflict: ['file_type'], idColumn: 'id' },
  { name: 'stores', columns: ['id', 'name', 'code'], conflict: ['name'], idColumn: 'id' },
  { name: 'products', columns: ['id', 'sku', 'device_model', 'variant_name', 'is_flagship', 'category', 'brand'], conflict: ['sku'], idColumn: 'id' },
  { name: 'store_stock', columns: ['store_id', 'product_id', 'quantity', 'updated_at'], conflict: ['store_id', 'product_id'], idColumn: null },
  { name: 'sales_weekly', columns: ['id', 'product_id', 'week_number', 'week_start', 'week_end', 'total_qty'], conflict: ['product_id', 'week_number'], idColumn: 'id' },
  { name: 'store_sales_monthly', columns: ['id', 'store_id', 'month', 'total_qty'], conflict: ['store_id', 'month'], idColumn: 'id' },
  { name: 'device_master', columns: ['alias', 'regular_srp', 'promo_srp', 'cost', 'promo_text', 'sw', 'sa_score_ses', 'sa_score_mb', 'stocks_snapshot', 'system_qty', 'unserved_qty', 'actual_do_cumulative'], conflict: ['alias'], idColumn: null },
  { name: 'cpfr', columns: ['id', 'alias', 'week_number', 'weekly_cpfr', 'actual_do'], conflict: ['alias', 'week_number'], idColumn: 'id' },
  { name: 'balance', columns: ['id', 'alias', 'month', 'month_balance'], conflict: ['alias', 'month'], idColumn: 'id' },
  { name: 'product_order', columns: ['id', 'alias', 'month', 'hold', 'replace_qty', 'replace2_qty', 'replace4_qty'], conflict: ['alias', 'month'], idColumn: 'id' },
  { name: 'rsi', columns: ['id', 'store_id', 'month', 'is_rsi'], conflict: ['store_id', 'month'], idColumn: 'id' },
  { name: 'months', columns: ['month', 'label'], conflict: ['month'], idColumn: null },
  { name: 'uploads', columns: ['id', 'filename', 'file_type', 'uploaded_at', 'row_count', 'week_number'], conflict: ['id'], idColumn: 'id' },
];

async function copyTable(sqlite, client, table) {
  const { name, columns, conflict, onConflictUpdate, idColumn } = table;
  const rows = sqlite.prepare(`SELECT ${columns.join(', ')} FROM ${name}`).all();

  const colList = columns.join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const onConflict = onConflictUpdate
    ? `ON CONFLICT (${conflict.join(', ')}) DO UPDATE SET ${onConflictUpdate.map((c) => `${c} = excluded.${c}`).join(', ')}`
    : `ON CONFLICT (${conflict.join(', ')}) DO NOTHING`;

  for (const row of rows) {
    const values = columns.map((c) => row[c]);
    await client.query(`INSERT INTO ${name} (${colList}) VALUES (${placeholders}) ${onConflict}`, values);
  }

  if (idColumn) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${idColumn}) FROM ${name}), 1))`,
      [name, idColumn]
    );
  }

  console.log(`  ${name}: ${rows.length} row(s) migrated`);
}

async function main() {
  const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  console.log(`Migrating ${SQLITE_PATH} -> Postgres...`);
  try {
    await client.query('BEGIN');
    for (const table of TABLES) {
      await copyTable(sqlite, client, table);
    }
    await client.query('COMMIT');
    console.log('Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main();
