# Warehouse manager: React frontend

React 19 + Vite + Tailwind CSS v4 + React Router. Talks to the Flask API in `../warehouse-db`.

```bash
npm install
npm run dev          # http://localhost:5173
```

`/api` is proxied to the Flask server (default http://localhost:5000), so there is no CORS setup in dev.
Different API address:  `VITE_PROXY_TARGET=http://localhost:5055 npm run dev`
Built app talking to a remote API directly: set `VITE_API_URL` at build time (that API must allow your origin via CORS_ORIGINS).

Start the backend first (see the API README): Postgres running, schema loaded, `python app.py`.

## Screens
| Route | What it does |
|---|---|
| `/` | Warehouses with totals, low-stock count, latest import summary |
| `/inventory` | Filter by warehouse, search, expiry date, low stock (filters live in the URL). Stock gauge shows quantity against the reorder level. Receive stock; transfer stock between warehouses |
| `/products`, `/products/:id` | Search, create with industry-specific JSON details, detail with batches and per-warehouse stock, edit |
| `/transfers` | Transfer history |
| `/warehouses` | Create warehouses; add an industry (one row, no schema change) |
| `/imports` | Import runs; rejected rows and warnings with the original CSV row |
