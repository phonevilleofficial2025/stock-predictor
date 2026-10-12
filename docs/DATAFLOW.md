# Data-Flow Diagrams

## Level 0 – context

```mermaid
flowchart LR
  User(("Retail planner")) -- "inventory CSV, sales CSV, CPFR cycle CSV,<br/>CPFR sheet edits, flagship and RSI flags" --> SP["Stock Predictor"]
  SP -- "stock levels, health status,<br/>suggested orders, CPFR / Balance / PO sheet,<br/>CSV exports" --> User
```

## Level 1 – main processes

```mermaid
flowchart TB
  inv[/"Inventory CSV"/] --> P1["1. Upload and map columns<br/>preview, then commit"]
  sal[/"Sales-per-serial CSV"/] --> P1
  cpfrCsv[/"CPFR cycle CSV<br/>(e.g. BSD Alias export)"/] --> P1
  P1 --> D1[("products / stores / store_stock")]
  P1 --> D2[("sales_weekly / store_sales_monthly")]
  P1 --> D3[("cpfr (seeded per alias/week)")]
  P1 --> D9[("import_templates / uploads")]

  D1 --> P2["2. Device metrics<br/>onHand, avg2wk"]
  D2 --> P2
  P2 --> P2b["2b. Alias metrics<br/>sum onHand/avg2wk to alias level"]
  P2b --> P3["3. Prediction engine<br/>score, status, suggestion"]
  P3 --> Dash["Dashboard status<br/>(alias CPFR split back to per-device)"]

  P2b --> P4["4. CPFR sheet<br/>one spreadsheet per alias"]
  user1(("User")) -- "edit Weekly CPFR / Actual DO<br/>(amber cells, save on Enter)" --> P4
  P4 --> D3

  D3 --> P5["5. Balance<br/>Unserved carry-forward, every month at once"]
  user1 -- "edit month Balance" --> P5
  P5 --> D4[("balance")]

  P5 --> P6["6. Product Order<br/>Unserved + Hold + Replace + Replace2 + Replace4"]
  user1 -- "edit Hold / Replace / Replace 2 / Replace 4" --> P6
  P6 --> D5[("product_order")]

  P2b --> P7["7. Device master<br/>pricing, cost, promo, SW, SA scores,<br/>system/unserved split, cumulative Actual DO"]
  user1 -- "edit directly on the sheet<br/>(no upload source)" --> P7
  P7 --> D6[("device_master")]

  user1 -- "mark RSI stores" --> D7[("rsi")]
  D2 --> P8["8. RSI ranking and warnings"]
  D7 --> P8
  P3 --> P8
  D1 --> P8
  P8 --> Dash

  P4 --> Sheet["The CPFR sheet<br/>(merges 4,5,6,7 + sales into one view)"]
  P5 --> Sheet
  P6 --> Sheet
  P7 --> Sheet
```

## Upload pipeline (detail)

```mermaid
flowchart LR
  A["CSV file"] --> B["POST /uploads/preview<br/>parse, auto-map or saved template"]
  B --> C["pendingUploads (memory)<br/>uploadId"]
  C --> D["User confirms mapping<br/>(+ picks a date, for cpfr files)"]
  D --> E{"file type"}
  E -- inventory --> F["upsert store and product<br/>(category, brand)<br/>OVERWRITE store_stock<br/>zero anything this upload omits"]
  E -- sales --> G["detectCadence must be weekly<br/>derive retail week number<br/>rows per SKU to sales_weekly<br/>rows per store/month to store_sales_monthly"]
  E -- cpfr --> H2["resolve week from the picked date<br/>re-normalize alias via aliasKey()<br/>sum rows per alias<br/>ADD onto existing weekly_cpfr"]
  F --> H["save template + uploads log"]
  G --> H
  H2 --> H
```

## Alias grouping

Every device-level metric (on-hand, 2-week average sell-out) is computed per individual `device_model` first (`deviceMetrics.js`, one batched query per metric rather than a per-device loop), then folded up to the **alias** level (`aliasMetrics.js`) before CPFR, Balance, Product Order or device-master data ever sees it — CPFR plans one number per family, not per color/SKU.

```mermaid
flowchart LR
  PM["products.device_model"] --> AK["aliasKey()<br/>cut right after the first RAM/storage<br/>spec token; else trim trailing colors"]
  AK --> ALIAS["alias (e.g. 'GALAXY A07 LTE (4+128GB)')"]
  ALIAS --> CPFR_T[("cpfr")]
  ALIAS --> BAL_T[("balance")]
  ALIAS --> PO_T[("product_order")]
  ALIAS --> DM_T[("device_master")]
  Dash["Dashboard predictions (per device)"] -. "alias CPFR split back down,<br/>proportional to avg2wk share" .- CPFR_T
```

## Calculation flow

```mermaid
flowchart LR
  S["sales_weekly<br/>last 2 weeks"] --> AVG["avg2wk"]
  ST["store_stock"] --> OH["onHand"]
  AVG --> ES["estimatedSellout = avg2wk x 2"]
  OH --> EO["estimatedOnHand = onHand + totalCPFR - estimatedSellout"]
  ES --> EO
  EO --> SC["score = estimatedOnHand / avg2wk"]
  AVG --> SC
  SC --> STAT["status<br/>flagship: score >= 4 Healthy<br/>other: > 8 Healthy, <= 4 Critical"]
  SC --> SUG["suggestion = qty needed to reach Healthy"]
  CP["cpfr: weekly - actualDo, summed per month"] --> EO
  CP --> UN["Unserved[m] = Unserved[m-1] + TotalCPFR[m] - Balance[m]"]
  UN --> PO["Total for PO = Unserved + Hold + Replace + Replace2 + Replace4"]
```
