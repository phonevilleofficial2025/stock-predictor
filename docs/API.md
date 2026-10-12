# REST API

Base URL: `/api` (nginx proxies to the server on port 4000). JSON everywhere except the upload preview (multipart).

**Auth:** all endpoints except `/api/health` and `/api/auth/login|logout|me` require the `session_token` httpOnly cookie (set by login, valid 30 days). Missing or expired session returns `401`. Errors are `{ "error": "message" }`.

**Alias:** CPFR, Balance, Product Order and device-master data all plan by **alias** — every color/SKU sharing a Device Model prefix, combined (see [ERD.md](ERD.md)) — not by individual product. Their payloads carry `alias`, not `deviceModel`/`itemDesc`.

## Health
| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{ ok: true }` |

## Auth
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/login` | `{username, password}` | `{ok, username}` + cookie. 400 missing fields, 401 invalid |
| POST | `/auth/logout` | none | `{ok}` |
| GET | `/auth/me` | none | `{ok, username}` or 401 (`needsSetup: true` if no admin account exists yet) |
| PUT | `/auth/account` | `{currentPassword, newUsername?, newPassword?}` | `{ok, username}`. 400 (new password under 8 chars), 403 wrong current password, 409 username taken. Changing the password signs out other sessions |

## Uploads
| Method | Path | Description |
|---|---|---|
| GET | `/uploads/fields/:fileType` | Mappable fields for `inventory`, `sales`, or `cpfr` |
| POST | `/uploads/preview` | multipart: `file` (CSV, max 20 MB), `fileType` (`inventory`\|`sales`\|`cpfr`). Returns `{uploadId, filename, headers, previewRows, rowCount, fields, suggestedMapping, autoApplied}` |
| POST | `/uploads/inventory/commit` | `{uploadId, mapping, saveAsTemplate?}` returns `{ok, rowsUpdated, rowsZeroed}`. Overwrites store stock; any product a store carried before that isn't in this file is zeroed out |
| POST | `/uploads/sales/commit` | `{uploadId, mapping, saveAsTemplate?}` returns `{ok, weekNumber, weekLabel, retailYear, retailWeek, weekStart, weekEnd, productsUpdated}`. 400 if the file is not a single week |
| POST | `/uploads/cpfr/commit` | `{uploadId, mapping, date, saveAsTemplate?}` returns `{ok, weekNumber, weekLabel, aliasesUpdated, skippedCount}`. `date` (any date within the target week) is required — the file carries no date column of its own. Rows sharing an alias are summed and **added** on top of that week's existing `weeklyCpfr` |
| GET | `/uploads/history` | Last 50 uploads |

**Inventory fields:** `store`\*, `sku`\*, `deviceModel`\*, `quantity`\*, `variantName`, `category`, `brand` (\* required).
**Sales fields:** `sku`\*, `deviceModel`\*, `store`\*, `saleDate`\*, `serialNo`.
**CPFR fields:** `alias`\*, `quantity`\* — one planning quantity per alias per upload, no date/week column (picked at commit time instead).
`mapping` is `{ fieldKey: "CSV header name" }`. An uploadId expires when the server restarts.

## Stock
| Method | Path | Description |
|---|---|---|
| GET | `/stores` | `[{id, name, code}]` |
| GET | `/stock?storeId=` | Rows for one store: `{productId, sku, deviceModel, variantName, isFlagship, category, brand, quantity, updatedAt, status}` |
| GET | `/stock/summary` | Same shape aggregated over all stores, plus `storeCount` |
| PUT | `/products/:productId/flagship` | `{isFlagship: boolean}` returns `{ok, productId, isFlagship}`; 404 unknown product |
| GET | `/devices` | `[{deviceModel, isFlagship, variantCount}]` |

## Sales and predictions
| Method | Path | Description |
|---|---|---|
| GET | `/sales` | Alias-pivoted, for the CPFR sheet's Weekly Sell-Out columns: `{weeks: number[], table: [{alias, onHand, isFlagship, category, weeks: {week: qty}}]}`. `weeks` spans the current year's week 1 through its last week (plus any out-of-range week with real data) |
| GET | `/predictions` | Still per individual device (not alias) — powers Dashboard: `{latestWeek, priorWeek, predictions: [{deviceModel, isFlagship, brand, onHand, avg2wk, totalCpfr, estimatedSellout, estimatedOnHand, score, status, estimatedOnHandWithCpfr, scoreWithCpfr, statusWithCpfr, suggestion, variantSplit[]}]}`. `totalCpfr` is the device's alias-level CPFR split back down proportional to recent sell-out share |

## CPFR
| Method | Path | Description |
|---|---|---|
| GET | `/cpfr` | `{weeks, latestDataWeek, rows: [{alias, variantCount, isFlagship, category, onHand, avg2wk, suggestion, cpfrByWeek: {week: {weeklyCpfr, actualDo, totalCpfr}}}]}`. `weeks` spans the current year's week 1 through its last week (plus any out-of-range week with data); `latestDataWeek` is the most recent week with a sales upload or CPFR entry (the sheet opens scrolled to it) |
| PUT | `/cpfr` | `{alias, week, weeklyCpfr?, actualDo?}` returns `{ok, alias, week, weeklyCpfr, actualDo, totalCpfr}` |

## Balance and Product Order
| Method | Path | Description |
|---|---|---|
| GET | `/months` | `[{month, label}]` — explicitly-recorded months only; every month of the current year is always included by `/balance` and `/po*` even without a row here |
| POST | `/months` | `{month: "YYYY-MM", label?}` |
| GET | `/balance` | `{months: [{month, label}], table: [{alias, onHand, isFlagship, category, months: [{month, label, totalCpfr, monthBalance, unserved}]}]}`. Every tracked month at once (no month picker); `unserved` carries forward across the array |
| PUT | `/balance` | `{alias, month, monthBalance}` |
| GET | `/po?month=` | One month's Product Order block: `{month, availableMonths, rows: [{alias, onHand, isFlagship, category, month, unserved, hold, replaceQty, replace2Qty, replace4Qty, totalForPo}]}`. `month` defaults to the latest tracked month |
| GET | `/po/all` | Every tracked month's Product Order block at once (mirrors `/balance`): `{months: string[], rows: [{alias, onHand, isFlagship, category, months: [{month, label, unserved, hold, replaceQty, replace2Qty, replace4Qty, totalForPo}]}]}` |
| PUT | `/po` | `{alias, month, hold?, replaceQty?, replace2Qty?, replace4Qty?}` returns `{ok, hold, replaceQty, replace2Qty, replace4Qty}` |

`totalForPo = unserved + hold + replaceQty + replace2Qty + replace4Qty`.

## Device master (pricing / reference data)
Per-alias fields the CPFR sheet tracks that no upload feed populates — pricing, cost, promo copy, sell-through target, the on-hand "system vs. unserved" split, a cumulative Actual DO, and two placeholder SA scores. Plain editable cells on the sheet, backed by the `device_master` table.

| Method | Path | Description |
|---|---|---|
| GET | `/device-master` | `{rows: [{alias, regularSrp, promoSrp, cost, promoText, sw, saScoreSes, saScoreMb, stocksSnapshot, systemQty, unservedQty, actualDoCumulative}]}`. One row per known alias, defaulted to zero/empty if never edited |
| PUT | `/device-master` | `{alias, field, value}` — `field` is one of the camelCase keys above (an allow-list; unknown fields 400). Returns `{ok, alias, field, value}` |

## RSI
| Method | Path | Description |
|---|---|---|
| GET | `/rsi?month=` | `{month, stores: [{storeId, storeName, totalQty, isRsi}]}` sorted by monthly sales. `month` (`YYYY-MM`) is required |
| PUT | `/rsi` | `{storeId, month, isRsi}` |
| GET | `/rsi/warnings?month=` | `{month, warnings: [{storeId, storeName, deviceModel, quantity}]}`: Critical devices (per-device status, no CPFR applied) stocked in RSI stores |

## Example

```bash
curl -c cookies.txt -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<your password>"}'

curl -b cookies.txt http://localhost/api/cpfr
```
