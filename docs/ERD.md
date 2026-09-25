# Entity-Relationship Diagram

Database: SQLite (`node:sqlite`), file `app.db`, created and migrated in [`server/src/db.js`](../server/src/db.js).

```mermaid
erDiagram
  stores ||--o{ store_stock : holds
  products ||--o{ store_stock : "stocked as"
  products ||--o{ sales_weekly : sells
  stores ||--o{ store_sales_monthly : sells
  stores ||--o{ rsi : "flagged per month"
  users ||--o{ sessions : has

  stores {
    INTEGER id PK
    TEXT name UK
    TEXT code
  }
  products {
    INTEGER id PK
    TEXT sku UK
    TEXT device_model
    TEXT variant_name
    INTEGER is_flagship
    TEXT category
    TEXT brand
  }
  store_stock {
    INTEGER store_id PK
    INTEGER product_id PK
    INTEGER quantity
    TEXT updated_at
  }
  sales_weekly {
    INTEGER id PK
    INTEGER product_id FK
    INTEGER week_number
    TEXT week_start
    TEXT week_end
    INTEGER total_qty
  }
  store_sales_monthly {
    INTEGER id PK
    INTEGER store_id FK
    TEXT month
    INTEGER total_qty
  }
  rsi {
    INTEGER id PK
    INTEGER store_id FK
    TEXT month
    INTEGER is_rsi
  }
  users {
    INTEGER id PK
    TEXT username UK
    TEXT password_hash
    TEXT created_at
  }
  sessions {
    TEXT token PK
    INTEGER user_id FK
    TEXT created_at
    TEXT expires_at
  }
```

Tables keyed by **device model**. They have no foreign key: `device_model` is matched by value to `products.device_model`.

```mermaid
erDiagram
  cpfr {
    INTEGER id PK
    TEXT device_model
    INTEGER week_number
    INTEGER weekly_cpfr
    INTEGER actual_do
  }
  balance {
    INTEGER id PK
    TEXT device_model
    TEXT month
    INTEGER month_balance
  }
  product_order {
    INTEGER id PK
    TEXT device_model
    TEXT month
    INTEGER hold
    INTEGER replace_qty
  }
  months {
    TEXT month PK
    TEXT label
  }
  import_templates {
    INTEGER id PK
    TEXT file_type UK
    TEXT column_mapping
    TEXT headers_signature
  }
  uploads {
    INTEGER id PK
    TEXT filename
    TEXT file_type
    TEXT uploaded_at
    INTEGER row_count
    INTEGER week_number
  }
```

## Table dictionary

| Table | Purpose | Unique key |
|---|---|---|
| `stores` | Retail stores, created automatically on upload | `name` |
| `products` | One row per SKU (variant). `device_model` groups variants into a device; `is_flagship` is set from Stock View | `sku` |
| `store_stock` | On-hand quantity per store per SKU; overwritten by each inventory upload | `(store_id, product_id)` |
| `sales_weekly` | Units sold per SKU per retail week | `(product_id, week_number)` |
| `store_sales_monthly` | Units sold per store per month (drives RSI ranking) | `(store_id, month)` |
| `cpfr` | Planned weekly CPFR and actual delivery orders (DO) per device | `(device_model, week_number)` |
| `balance` | Monthly balance per device (Balance page) | `(device_model, month)` |
| `product_order` | Hold and Replace quantities per device per month | `(device_model, month)` |
| `rsi` | Which stores are marked RSI for a month | `(store_id, month)` |
| `months` | Months the user has added for Balance / PO | `month` |
| `import_templates` | Remembered CSV column mappings (JSON) per file type | `file_type` |
| `uploads` | Upload history log | none |
| `users` / `sessions` | Login accounts (scrypt hash) and cookie sessions | `username` / `token` |

**Week numbers** are `retailYear*100 + retailWeek` (e.g. `202637` = 2026-W37). Retail weeks run Sunday–Saturday; week 1 starts on the Sunday on or before 1 January. `month` values are `YYYY-MM`.
