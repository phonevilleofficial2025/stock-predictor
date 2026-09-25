# User Guide

The same guide is available inside the app under the **Guide** tab (next to RSI).

## Getting started
1. Start the app: `docker compose up -d --build`, then open **http://localhost/**.
2. Sign in as `admin` with the password from your `.env` file (`ADMIN_PASSWORD`).
3. Use the profile icon (top right) to switch **dark/light mode**, open **Account Settings** (change username/password) or **Sign out**.

**Recommended order:** Upload inventory → Upload sales (one week at a time) → mark flagship devices in Stock View → review Dashboard → plan CPFR → Balance → Product Order → RSI.

## Common table tools
Every table page (Stock View, Sales, CPFR, Balance, Product Order, Dashboard, RSI) has:
- **Search**, plus filters (min/max on-hand, category, brand, flagship only) where relevant.
- **Show** – rows per page (10, 20, 50, ...). Pagination sits under the table.
- **Zoom − / + and full screen** – only the table scales; the controls stay fixed.
- **Export CSV** – exports the currently filtered rows (not on RSI). You are asked to confirm.
Saving, uploading and exporting always ask for confirmation first.

## Upload
1. Use the **Inventory Upload** or **Sales-per-Serial-No Upload** card and select a CSV file (max 20 MB).
2. A **preview** shows all rows (scrollable, searchable, zoomable). Check the column mapping; columns are auto-matched and remembered for the next file with the same headers.
3. Click import and confirm.

- **Inventory** fields: Store, Product/SKU, Device Model, Quantity (required); Variant Name, Category, Brand (optional). Importing **overwrites** each store's on-hand quantity for those SKUs. New stores and products are created automatically.
- **Sales** fields: Product/SKU, Device Model, Store, Sale Date (required); Serial No (optional). Each row is one unit sold. The file must cover **one week**; the week is detected automatically from the dates using retail weeks (**Sunday–Saturday**, e.g. Sep 6 – Sep 12). Re-uploading the same week replaces it.

## Stock View
- Pick a store, or **All Stores** for the overall summary.
- Columns: Device Model, Variant, SKU, Category, Brand, On Hand, **Flagship** (checkbox), **Status**, Last Updated.
- Tick **Flagship** for devices that use the lower Healthy threshold. This is saved immediately (after confirmation).
- Status is Healthy / Moderate / Critical (see Formulas). It appears once at least one week of sales exists.

## Sales
Total sell-out per device per week, across all stores. Click **Generate Prediction** for the full prediction table: average 2-week sell-out, estimated sell-out, estimated on-hand, score and status, with and without planned CPFR, the suggested order per device and a suggested split per variant.

## CPFR
Plan weekly CPFR per device. Pick the week, enter **Weekly CPFR** and **Actual DO** (delivery orders received). **Total CPFR = Weekly CPFR − Actual DO**. The **Suggestion** column shows the quantity needed to reach Healthy.

## Balance
Add months, then enter each device's **Month Balance**. **Unserved** carries forward: `Unserved[month] = Unserved[previous] + Total CPFR[month] − Balance[month]`.

## Product Order
Choose a month. **Total for PO = Unserved + Hold + Replace**. Enter Hold and Replace quantities per device.

## RSI
Choose a month. Stores are ranked by that month's sales. Tick the stores that are **RSI** (top performers). Below, **Critical warnings** list Critical devices stocked in RSI stores; filter by store (or Overall), search, and choose how many rows to show.

## Dashboard
Overview of devices needing attention (Critical/Moderate) with search, status, brand and row-count filters and an **Export CSV** (includes Score and Suggested Order), plus the RSI warnings with store filter.

## Formulas
| Value | Formula |
|---|---|
| avg2wk | average sell-out of the last two weeks (all stores and variants) |
| Estimated sell-out | avg2wk × 2 |
| Estimated on-hand | on-hand (+ CPFR) − estimated sell-out |
| Score | estimated on-hand ÷ avg2wk |
| Status (flagship) | Healthy at score ≥ 4, otherwise Critical |
| Status (other) | Healthy above 8, Critical at 4 or below, Moderate between |
| PO total | Unserved + Hold + Replace |

## Troubleshooting
- **Request failed 413** – file exceeds the upload limit (25 MB nginx / 20 MB server).
- **"Only weekly files accepted"** – the sales file must span a single 7-day week; check that Sale Date is mapped correctly.
- **Session expired** – sign in again.
- **Lost the admin password** – the admin account is only created when no users exist; reset by deleting the `users` rows in the database volume and restarting with a new `ADMIN_PASSWORD`.
