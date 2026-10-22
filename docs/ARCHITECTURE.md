# Architecture (UML)

## 1. Component diagram

```mermaid
flowchart LR
  subgraph Browser
    SPA["React SPA<br/>(Vite + Tailwind + react-router)<br/>+ embedded spreadsheet engine"]
  end
  subgraph Docker["Docker Compose"]
    NGINX["client container<br/>nginx: static files + /api proxy"]
    API["server container<br/>Express 4 (Node 22+)"]
    PG[("postgres container<br/>PostgreSQL 16<br/>postgres_data volume")]
    VOL[("server_data volume<br/>legacy app.db backup,<br/>read by the one-off migration script only")]
  end
  SPA -- "HTTP :80" --> NGINX
  NGINX -- "/api/* to server:4000" --> API
  API -- "DATABASE_URL" --> PG
  API -. "migrate-sqlite-to-postgres.js<br/>(one-off, not at runtime)" .-> VOL
```

## 2. Deployment diagram

```mermaid
flowchart TB
  user(("User")) --> host["Host machine<br/>port 80 (CLIENT_PORT)<br/>port 4000 (SERVER_PORT)"]
  host --> c1["client container<br/>nginx:alpine, client_max_body_size 25m"]
  host --> c2["server container<br/>node, PORT=4000<br/>depends_on postgres: service_healthy"]
  host --> c3["postgres container<br/>postgres:16-alpine, internal port 5432 only"]
  c2 -- "DATABASE_URL" --> c3
  c3 --- v1[("named volume: postgres_data")]
  c2 --- v2[("named volume: server_data (legacy backup)")]
```

## 3. Server module diagram (class-style)

```mermaid
classDiagram
  class index {
    cors, cookieParser, json
    /api/health
    /api/auth
    requireAuth
    feature routers
  }
  class db {
    pg.Pool pool
    initSchema() (async)
  }
  class authLib {
    hashPassword()
    verifyPassword()
    ensureAdminAccount()
    createSession()
    getSession()
    requireAuth()
    updateAccount()
  }
  class alias {
    aliasKey()
  }
  class deviceMetrics {
    getDeviceMetrics()
  }
  class aliasMetrics {
    getAliasMetrics()
  }
  class predictionsLib {
    computeScore()
    classifyStatus()
    computeSuggestion()
    splitSuggestionByVariant()
  }
  class balanceLib {
    computeUnservedSeries()
  }
  class balanceTable {
    computeBalanceTable()
  }
  class csvLib {
    parseCsvBuffer()
    detectCadence()
    retailWeekInfo()
    fullYearWeeks()
  }
  class uploadsRoute
  class stockRoute
  class salesRoute
  class predictionsRoute
  class cpfrRoute
  class balanceRoute
  class poRoute
  class rsiRoute
  class deviceMasterRoute
  class authRoute

  index --> authRoute
  index --> uploadsRoute
  index --> stockRoute
  index --> salesRoute
  index --> predictionsRoute
  index --> cpfrRoute
  index --> balanceRoute
  index --> poRoute
  index --> rsiRoute
  index --> deviceMasterRoute
  authRoute --> authLib
  uploadsRoute --> csvLib
  uploadsRoute --> alias
  uploadsRoute --> db
  stockRoute --> deviceMetrics
  stockRoute --> predictionsLib
  salesRoute --> alias
  salesRoute --> aliasMetrics
  salesRoute --> csvLib
  predictionsRoute --> deviceMetrics
  predictionsRoute --> alias
  predictionsRoute --> predictionsLib
  cpfrRoute --> aliasMetrics
  cpfrRoute --> predictionsLib
  cpfrRoute --> csvLib
  balanceRoute --> balanceTable
  poRoute --> balanceTable
  deviceMasterRoute --> aliasMetrics
  balanceTable --> balanceLib
  balanceTable --> aliasMetrics
  aliasMetrics --> deviceMetrics
  aliasMetrics --> alias
  deviceMetrics --> db
  authLib --> db
```

## 4. Client structure

```mermaid
flowchart TB
  main["main.jsx"] --> App["App.jsx<br/>auth gate + nav + routes<br/>legacy /sales,/balance,/po,/simulation redirect to /cpfr"]
  App --> Login
  App --> ConfirmProvider
  App --> ProfileMenu["ProfileMenu<br/>theme toggle, settings, sign out"]
  ConfirmProvider --> Pages
  subgraph Pages
    Dashboard
    Upload["Upload<br/>(inventory / sales / cpfr cards)"]
    StockView["StockView<br/>(+ client-side Alias View)"]
    Cpfr["Cpfr<br/>(one spreadsheet: Sales+CPFR+Balance+PO)"]
    Rsi
    Guide
    Settings
  end
  Cpfr --> cpfrWorkbook["utils/cpfrWorkbook.js<br/>builds workbook cells/formulas"]
  cpfrWorkbook --> ExcelSheet["components/excel/ExcelSheet.jsx"]
  ExcelSheet --> engine["components/excel/engine.js<br/>formula parser/evaluator, grid rendering,<br/>frozen panes, scrollable windows, zoom/fullscreen"]
  Pages --> hooks["hooks/useFilteredTable"]
  Pages --> comps["components: TableToolbar, Pagination,<br/>TableFrame/ZoomArea, ConfirmDialog, Card,<br/>PageHeader, StatusBadge, Badge"]
  Pages --> api["api.js<br/>fetch wrapper, 401 handling"]
  Pages --> utils["utils/csv.js, utils/week.js, utils/formulas.js"]
```

## 5. Sequence: login

```mermaid
sequenceDiagram
  actor U as User
  participant C as React client
  participant S as Express
  participant D as Postgres
  U->>C: username + password
  C->>S: POST /api/auth/login
  S->>D: SELECT user, scrypt verify
  S->>D: INSERT session (token, user_id, expires +30d)
  S-->>C: 200 + httpOnly cookie session_token
  C->>S: GET /api/... (cookie)
  S->>D: requireAuth looks up session
  S-->>C: data
  Note over C,S: any 401 fires auth:unauthorized and shows the login screen
```

## 6. Sequence: upload (preview, then commit)

```mermaid
sequenceDiagram
  actor U as User
  participant C as Upload page
  participant S as uploads route
  participant M as pendingUploads (memory)
  participant D as Postgres
  U->>C: choose CSV, type = inventory | sales | cpfr
  C->>S: POST /api/uploads/preview (multipart)
  S->>S: parseCsvBuffer, autoMapping or saved template
  S->>M: store rows under uploadId
  S-->>C: headers, previewRows, suggestedMapping
  U->>C: adjust mapping (+ pick a date, for cpfr)
  C->>U: confirm dialog
  C->>S: POST /api/uploads/{inventory|sales|cpfr}/commit
  alt inventory
    S->>D: BEGIN, upsert stores/products, OVERWRITE store_stock,<br/>zero anything this upload doesn't mention, COMMIT
  else sales
    S->>S: detectCadence (must be weekly), retailWeekInfo -> weekNumber
    S->>D: BEGIN, upsert sales_weekly/store_sales_monthly, COMMIT
  else cpfr
    S->>S: resolve week from the picked date, sum rows by aliasKey()
    S->>D: BEGIN, add onto existing weekly_cpfr per alias/week, COMMIT
  end
  S->>D: save import template + uploads log
  S-->>C: result (rowsUpdated / weekLabel+productsUpdated / weekLabel+aliasesUpdated)
```

## 7. Sequence: CPFR sheet load and edit

```mermaid
sequenceDiagram
  participant C as Cpfr page
  participant S as Express routes
  participant AM as aliasMetrics/deviceMetrics
  participant D as Postgres
  C->>S: GET /cpfr, /sales, /balance, /po/all, /device-master (parallel)
  S->>AM: getAliasMetrics() (sums per-device onHand/avg2wk to alias level)
  AM->>D: query products/store_stock/sales_weekly
  S-->>C: per-endpoint alias rows
  C->>C: mergeRows() joins all five responses by alias
  C->>C: buildCpfrWorkbook() lays out one sheet (cells + formulas)
  C->>C: ExcelSheet mounts engine.js, formulas evaluate client-side
  Note over C: user edits a shaded (editable) cell
  C->>S: PUT /cpfr | /balance | /po | /device-master (field-specific)
  S->>D: upsert row
  S-->>C: new value
  C->>C: patch React state; engine recalculates dependent formula cells
```

## 8. Sequence: prediction (Dashboard)

```mermaid
sequenceDiagram
  participant C as Dashboard
  participant R as predictions route
  participant M as deviceMetrics
  participant P as predictions lib
  C->>R: GET /api/predictions
  R->>M: getDeviceMetrics()
  M-->>R: per device onHand, avg2wk, isFlagship
  R->>R: loadCpfrByDevice(): alias-level CPFR split back down per device,<br/>proportional to each device's avg2wk share
  R->>P: computeScore, classifyStatus, computeSuggestion, splitSuggestionByVariant
  R-->>C: predictions (score, status, with-CPFR, suggestion, variant split)
```

## 9. State diagram: device status

```mermaid
stateDiagram-v2
  [*] --> NoData: avg2wk = 0
  [*] --> Scored: avg2wk > 0
  Scored --> Healthy: flagship score >= 4, other score > 8
  Scored --> Moderate: other device, 4 < score <= 8
  Scored --> Critical: flagship score < 4, other score <= 4
```
