# User Guide

The same guide is available inside the app under the **Guide** tab.

## Getting started
1. Start the app: `docker compose up -d --build`, then open **http://localhost/**.
2. Sign in as `admin` with the password from your `.env` file (`ADMIN_PASSWORD`).
3. Use the profile icon (top right) to switch **dark/light mode**, open **Account Settings** (change username/password) or **Sign out**.

**Recommended order:** Upload inventory → Upload sales (one week at a time) → mark flagship devices in Stock View → review Dashboard → plan CPFR, Balance and Product Order on the CPFR sheet → mark RSI stores.

## Common table tools
Every table page (Stock View, CPFR, Dashboard, RSI) has:
- **Search**, plus filters (min/max on-hand, category, brand, flagship only) where relevant.
- **Show** – rows per page (10, 20, 50, ...). Pagination sits under the table. (The CPFR sheet scrolls instead, like a real spreadsheet.)
- **Zoom − / + and full screen** – only the table scales; the controls stay fixed.
- **Export CSV** – exports the currently filtered rows (not on RSI).
Uploading, Stock View and RSI edits always ask for confirmation first. Editing a cell on the CPFR sheet (any shaded/amber cell — Weekly CPFR, Actual DO, Balance, Hold, Replace) saves instantly in the background instead — a small dot shows on the cell while it saves, and turns red (briefly) if the save failed.

## Upload
1. Use the **Inventory Upload** or **Sales-per-Serial-No Upload** card and select a CSV file (max 20 MB).
2. A **preview** shows all rows (scrollable, searchable, zoomable). Check the column mapping; columns are auto-matched and remembered for the next file with the same headers.
3. Click import and confirm.

- **Inventory** fields: Store, Product/SKU, Device Model, Quantity (required); Variant Name, Category, Brand (optional). Importing **overwrites** each store's on-hand quantity for those SKUs. New stores and products are created automatically.
- **Sales** fields: Product/SKU, Device Model, Store, Sale Date (required); Serial No (optional). Each row is one unit sold. The file must cover **one week**; the week is detected automatically from the dates using retail weeks (**Sunday–Saturday**, e.g. Sep 6 – Sep 12). Re-uploading the same week replaces it.

## Stock View
- Pick a store, or **All Stores** for the overall summary.
- Columns: Device Model, Variant, SKU, Category, Brand, On Hand, **Flagship** (checkbox), **Status**, Last Updated.
- Tick **Flagship** for devices that use the lower Healthy threshold — this drives the Status columns on the CPFR sheet. Saved immediately (after confirmation).
- Status is Healthy / Moderate / Critical (see Formulas). It appears once at least one week of sales exists.

## CPFR
A real spreadsheet — name box, formula bar, click-to-select cells, live formula recalculation, not just a table styled to look like one — combining what used to be separate Sales, CPFR, Balance and Product Order pages.

Plans by **alias**, not by individual color/SKU: every color and storage-identical variant sharing a Device Model prefix (e.g. every color of "Galaxy A07 LTE (4+128GB)") is combined into one row, On Hand and sell-out summed across them — the same unit the source CPFR workbook plans in. The alias is derived from the Device Model text (scan for the first RAM/storage token — `256GB`, `4+128GB`, `(12GB+256GB)` — everything up to and including it must match exactly, so different generations/configs never merge; everything after it, like color, is folded together). Stock View's own Alias View uses the same rule.

Weekly Sell-Out and CPFR span week 1 through the current year's last week automatically — no week selector, no manual setup; scroll right (or zoom out, or use full screen) to see more weeks at once. Balance and Product Order show every month of the year side by side — no month picker either.

Alias, On Hand, weekly sell-out history (one column per week of the year, summarized automatically from your sales uploads across every variant sharing the alias — 0 until that week's upload arrives), Avg 2-Wk (averages the two most recent weeks), the no-CPFR prediction (Est. Sellout / Est. On Hand / Score / Status), **Suggestion** (quantity needed to reach Healthy), a cumulative **Actual DO** column, one editable **CPFR** column per week plus a **TOTAL CPFR** (sum of every week's CPFR − Actual DO), and one Total CPFR / **Balance** / Unserved / **Hold** / **Replace** / **Replace 2** / **Replace 4** / Total for PO column group per month (Unserved is a live formula that carries forward: `Unserved[month] = Unserved[previous] + Total CPFR[month] − Balance[month]`; Total for PO = Unserved + Hold + Replace + Replace 2 + Replace 4). Cells with a green corner are computed formulas; shaded (amber) cells are editable — select one, type a value into the formula bar, press Enter.

Dashboard's CPFR-adjusted prediction is still per individual device — an alias's planned CPFR quantity is split back across its member devices proportional to each one's recent sell-out share (an even split if none has sell-out history yet).

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
