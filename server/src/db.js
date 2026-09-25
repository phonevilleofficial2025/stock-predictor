import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'app.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    code TEXT
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL,
    device_model TEXT NOT NULL,
    variant_name TEXT,
    is_flagship INTEGER DEFAULT 0,
    category TEXT,
    brand TEXT
  );

  CREATE TABLE IF NOT EXISTS store_stock (
    store_id INTEGER NOT NULL REFERENCES stores(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (store_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS sales_weekly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    week_number INTEGER NOT NULL,
    week_start TEXT,
    week_end TEXT,
    total_qty INTEGER DEFAULT 0,
    UNIQUE(product_id, week_number)
  );

  CREATE TABLE IF NOT EXISTS store_sales_monthly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    month TEXT NOT NULL,
    total_qty INTEGER DEFAULT 0,
    UNIQUE(store_id, month)
  );

  CREATE TABLE IF NOT EXISTS cpfr (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_model TEXT NOT NULL,
    week_number INTEGER NOT NULL,
    weekly_cpfr INTEGER DEFAULT 0,
    actual_do INTEGER DEFAULT 0,
    UNIQUE(device_model, week_number)
  );

  CREATE TABLE IF NOT EXISTS balance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_model TEXT NOT NULL,
    month TEXT NOT NULL,
    month_balance INTEGER DEFAULT 0,
    UNIQUE(device_model, month)
  );

  CREATE TABLE IF NOT EXISTS product_order (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_model TEXT NOT NULL,
    month TEXT NOT NULL,
    hold INTEGER DEFAULT 0,
    replace_qty INTEGER DEFAULT 0,
    UNIQUE(device_model, month)
  );

  CREATE TABLE IF NOT EXISTS rsi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id INTEGER NOT NULL REFERENCES stores(id),
    month TEXT NOT NULL,
    is_rsi INTEGER DEFAULT 0,
    UNIQUE(store_id, month)
  );

  CREATE TABLE IF NOT EXISTS import_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_type TEXT UNIQUE NOT NULL,
    column_mapping TEXT NOT NULL,
    headers_signature TEXT
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT,
    file_type TEXT,
    uploaded_at TEXT,
    row_count INTEGER,
    week_number INTEGER
  );

  CREATE TABLE IF NOT EXISTS months (
    month TEXT PRIMARY KEY,
    label TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`);

// Sessions used to key on username directly; migrate any pre-existing table (from
// before account settings let you rename yourself) to key on user_id instead, so a
// username change doesn't strand or misidentify an already-logged-in session.
const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all().map((c) => c.name);
if (!sessionColumns.includes('user_id')) {
  db.exec(`
    DROP TABLE sessions;
    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
}

// Patch an already-existing products table (from before category/brand tracking existed).
const productColumns = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
if (!productColumns.includes('category')) {
  db.exec('ALTER TABLE products ADD COLUMN category TEXT');
}
if (!productColumns.includes('brand')) {
  db.exec('ALTER TABLE products ADD COLUMN brand TEXT');
}
