# Stock Predictor

Inventory tracker + restock prediction tool for a multi-store phone retailer.

## Documentation

See [docs/](docs/README.md): [User Guide](docs/USER_GUIDE.md), [Architecture / UML](docs/ARCHITECTURE.md), [Data flow](docs/DATAFLOW.md), [ERD](docs/ERD.md), [API](docs/API.md), [Dependencies](docs/DEPENDENCIES.md). The user guide is also in the app under the **Guide** tab.

## Run it

```
npm run install:all   # installs server + client dependencies (first time only)
npm run dev            # runs server (http://localhost:4000) and client (http://localhost:5173) together
```

Open http://localhost:5173.

### Run it with Docker

```
docker compose up --build
```

Open http://localhost — the client is served by nginx and proxies `/api` to the server container.
The SQLite database persists in the `server_data` Docker volume, so data survives container restarts.
Override the exposed ports with `SERVER_PORT` / `CLIENT_PORT` env vars if 4000/80 are taken.

## How it works

1. **Upload** — upload your inventory CSV (updates each store's on-hand stock — overwrites, doesn't add) and your sales-per-serialno CSV (one week at a time; the week is detected automatically from the dates, Sunday–Saturday). Both go through a preview → map columns → confirm flow, so any CSV header names work. The column mapping is remembered per file format for next time.
2. **Stock View** — pick a store to see its current on-hand stock.
3. **Sales** — sell-out per product, summed across stores, by week. Click **Generate Prediction** to see the restock health score per device (Healthy / Moderate / Critical), with and without planned CPFR.
4. **CPFR** — plan weekly CPFR quantities per device; see the suggested amount needed to stay Healthy, log actual delivery orders (DO), and see Total CPFR.
5. **Balance** — track monthly balance against CPFR commitments; Unserved carries forward month to month.
6. **Product Order (PO)** — Unserved (from Balance) plus Hold and Replace quantities roll up into Total for PO.
7. **RSI** — mark which store(s) are top performers for the month; any RSI store stocking a Critical-level device is flagged.

Sample CSVs for trying it out are in `server/sample-*.csv`.

## Formulas

- `avg2wk` = average sell-out over the last 2 weeks for a device (summed across all stores/variants)
- `estimatedSellout` = `avg2wk * 2`
- `estimatedOnHand` = `onHand - estimatedSellout` (or `onHand + totalCPFR - estimatedSellout` for the CPFR-adjusted view)
- `score` = `estimatedOnHand / avg2wk`
- Status: flagship devices are Healthy at `score >= 4`, Critical below; other devices are Healthy above `8`, Critical at `4` or below, Moderate in between.
- CPFR Suggestion = smallest additional quantity needed to bring the score up to the Healthy cutoff.
- Balance Unserved carries forward: `Unserved[month] = Unserved[prev month] + TotalCPFR[month] - Balance[month]`.
- PO Total = `Unserved + Hold + Replace`.

See `server/src/lib/predictions.js` and `server/src/lib/balance.js` for the reference implementation and their `.test.js` files for worked examples.

## Tests

```
npm test
```

Runs the prediction/balance formula unit tests (Node's built-in test runner).
