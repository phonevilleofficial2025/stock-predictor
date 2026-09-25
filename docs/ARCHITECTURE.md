# Architecture (UML)

## 1. Component diagram

```mermaid
flowchart LR
  subgraph Browser
    SPA["React SPA<br/>(Vite + Tailwind + react-router)"]
  end
  subgraph Docker["Docker Compose"]
    NGINX["client container<br/>nginx: static files + /api proxy"]
    API["server container<br/>Express 4 (Node 22+)"]
    VOL[("server_data volume<br/>/app/data/app.db<br/>SQLite via node:sqlite")]
  end
  SPA -- "HTTP :80" --> NGINX
  NGINX -- "/api/* to server:4000" --> API
  API --> VOL
```

## 2. Deployment diagram

```mermaid
flowchart TB
  user(("User")) --> host["Host machine<br/>port 80 (CLIENT_PORT)<br/>port 4000 (SERVER_PORT)"]
  host --> c1["client container<br/>nginx:alpine, client_max_body_size 25m"]
  host --> c2["server container<br/>node, PORT=4000"]
  c2 --- v[("named volume: server_data")]
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
    DatabaseSync db
    schema and migrations
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
  class deviceMetrics {
    getDeviceMetrics()
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
  }
  class itemDesc {
    getItemDescMaps()
  }
  class uploadsRoute
  class stockRoute
  class salesRoute
  class predictionsRoute
  class cpfrRoute
  class balanceRoute
  class poRoute
  class rsiRoute
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
  authRoute --> authLib
  uploadsRoute --> csvLib
  uploadsRoute --> db
  stockRoute --> deviceMetrics
  stockRoute --> predictionsLib
  salesRoute --> deviceMetrics
  predictionsRoute --> deviceMetrics
  predictionsRoute --> predictionsLib
  cpfrRoute --> deviceMetrics
  cpfrRoute --> predictionsLib
  cpfrRoute --> itemDesc
  balanceRoute --> balanceTable
  poRoute --> balanceTable
  balanceTable --> balanceLib
  balanceTable --> deviceMetrics
  rsiRoute --> deviceMetrics
  rsiRoute --> predictionsLib
  deviceMetrics --> db
  authLib --> db
```

## 4. Client structure

```mermaid
flowchart TB
  main["main.jsx"] --> App["App.jsx<br/>auth gate + nav + routes"]
  App --> Login
  App --> ConfirmProvider
  App --> ProfileMenu["ProfileMenu<br/>theme toggle, settings, sign out"]
  ConfirmProvider --> Pages
  subgraph Pages
    Dashboard
    Upload
    StockView
    Sales
    Cpfr
    Balance
    ProductOrder
    Rsi
    Guide
    Settings
  end
  Pages --> hooks["hooks/useFilteredTable"]
  Pages --> comps["components: TableToolbar, Pagination,<br/>TableFrame/ZoomArea, ConfirmDialog, Card,<br/>PageHeader, StatusBadge, Badge"]
  Pages --> api["api.js<br/>fetch wrapper, 401 handling"]
  Pages --> utils["utils/csv.js, utils/week.js"]
```

## 5. Sequence: login

```mermaid
sequenceDiagram
  actor U as User
  participant C as React client
  participant S as Express
  participant D as SQLite
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

## 6. Sequence: sales upload (preview, then commit)

```mermaid
sequenceDiagram
  actor U as User
  participant C as Upload page
  participant S as uploads route
  participant M as pendingUploads (memory)
  participant D as SQLite
  U->>C: choose CSV, type = sales
  C->>S: POST /api/uploads/preview (multipart)
  S->>S: parseCsvBuffer, autoMapping or saved template
  S->>M: store rows under uploadId
  S-->>C: headers, previewRows, suggestedMapping
  U->>C: adjust mapping, click Import
  C->>U: confirm dialog
  C->>S: POST /api/uploads/sales/commit
  S->>S: detectCadence (must be weekly)
  S->>S: retailWeekInfo gives weekNumber = year*100+week
  S->>D: BEGIN, upsert stores/products/sales_weekly/store_sales_monthly, COMMIT
  S->>D: save import template
  S-->>C: weekLabel, productsUpdated
```

## 7. Sequence: prediction

```mermaid
sequenceDiagram
  participant C as Sales / Dashboard
  participant R as predictions route
  participant M as deviceMetrics
  participant P as predictions lib
  C->>R: GET /api/predictions
  R->>M: getDeviceMetrics()
  M-->>R: per device onHand, avg2wk, isFlagship
  R->>P: computeScore, classifyStatus, computeSuggestion
  R-->>C: predictions (score, status, with-CPFR, suggestion, variant split)
```

## 8. State diagram: device status

```mermaid
stateDiagram-v2
  [*] --> NoData: avg2wk = 0
  [*] --> Scored: avg2wk > 0
  Scored --> Healthy: flagship score >= 4, other score > 8
  Scored --> Moderate: other device, 4 < score <= 8
  Scored --> Critical: flagship score < 4, other score <= 4
```
