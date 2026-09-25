# REST API

Base URL: `/api` (nginx proxies to the server on port 4000). JSON everywhere except the upload preview (multipart).

**Auth:** all endpoints except `/api/health` and `/api/auth/login|logout|me` require the `session_token` httpOnly cookie (set by login, valid 30 days). Missing or expired session returns `401`. Errors are `{ "error": "message" }`.

## Health
| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{ ok: true }` |

## Auth
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/login` | `{username, password}` | `{ok, username}` + cookie. 400 missing fields, 401 invalid |
| POST | `/auth/logout` | none | `{ok}` |
| GET | `/auth/me` | none | `{ok, username}` or 401 |
| PUT | `/auth/account` | `{currentPassword, newUsername?, newPassword?}` | `{ok, username}`. 400 (new password under 8 chars), 403 wrong current password, 409 username taken. Changing the password signs out other sessions |

## Uploads
| Method | Path | Description |
|---|---|---|
| GET | `/uploads/fields/:fileType` | Mappable fields for `inventory` or `sales` |
| POST | `/uploads/preview` | multipart: `file` (CSV, max 20 MB), `fileType`. Returns `{uploadId, filename, headers, previewRows, rowCount, fields, suggestedMapping, autoApplied}` |
| POST | `/uploads/inventory/commit` | `{uploadId, mapping, saveAsTemplate?}` returns `{ok, rowsUpdated}`. Overwrites store stock |
| POST | `/uploads/sales/commit` | `{uploadId, mapping, saveAsTemplate?}` returns `{ok, weekNumber, weekLabel, retailYear, retailWeek, weekStart, weekEnd, productsUpdated}`. 400 if the file is not a single week |
| GET | `/uploads/history` | Last 50 uploads |

**Inventory fields:** `store`\*, `sku`\*, `deviceModel`\*, `quantity`\*, `variantName`, `category`, `brand` (\* required).
**Sales fields:** `sku`\*, `deviceModel`\*, `store`\*, `saleDate`\*, `serialNo`.
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
| GET | `/sales` | `{weeks: number[], table: [{deviceModel, onHand, isFlagship, category, brand, weeks: {week: qty}}]}` |
| GET | `/predictions` | `{latestWeek, priorWeek, predictions: [{deviceModel, isFlagship, brand, onHand, avg2wk, totalCpfr, estimatedSellout, estimatedOnHand, score, status, estimatedOnHandWithCpfr, scoreWithCpfr, statusWithCpfr, suggestion, variantSplit[]}]}` |

## CPFR
| Method | Path | Description |
|---|---|---|
| GET | `/cpfr?week=` | `{week, rows: [{itemDesc, isFlagship, category, onHand, avg2wk, weeklyCpfr, suggestion, actualDo, totalCpfr}]}`. `week` defaults to the latest sales week |
| PUT | `/cpfr` | `{itemDesc, week, weeklyCpfr?, actualDo?}` returns `{ok, itemDesc, week, weeklyCpfr, actualDo, totalCpfr}` |

## Balance and Product Order
| Method | Path | Description |
|---|---|---|
| GET | `/months` | `[{month, label}]` |
| POST | `/months` | `{month: "YYYY-MM", label?}` |
| GET | `/balance` | Balance table with cumulative Unserved per device and month |
| PUT | `/balance` | `{itemDesc, month, monthBalance}` |
| GET | `/po?month=` | `{month, availableMonths, rows: [{itemDesc, onHand, isFlagship, category, unserved, hold, replaceQty, totalForPo}]}` |
| PUT | `/po` | `{itemDesc, month, hold?, replaceQty?}` |

`itemDesc` is the device's display name (the variant name from inventory, when available); the server translates it back to the device model.

## RSI
| Method | Path | Description |
|---|---|---|
| GET | `/rsi?month=` | `{month, stores: [{storeId, storeName, totalQty, isRsi}]}` sorted by monthly sales. `month` (`YYYY-MM`) is required |
| PUT | `/rsi` | `{storeId, month, isRsi}` |
| GET | `/rsi/warnings?month=` | `{month, warnings: [{storeId, storeName, deviceModel, quantity}]}`: Critical devices stocked in RSI stores |

## Example

```bash
curl -c cookies.txt -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<your password>"}'

curl -b cookies.txt http://localhost/api/predictions
```
