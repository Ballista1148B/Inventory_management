# Inventory & Warehouse DB + API

## 1. Database
```bash
createdb warehouse
psql -d warehouse -v ON_ERROR_STOP=1 -f schema.sql      # DEV ONLY: drops and recreates every table
pip install -r requirements.txt
python seed_grocery.py --csv Grocery_Inventory_and_Sales_Dataset.csv \
    --warehouse "Main Grocery Warehouse" --dsn "dbname=warehouse user=YOUR_USER"
```
Expected: 990 processed, 494 imported, 496 rejected (EXPIRY_BEFORE_RECEIVED), 3 warnings.
Re-running the seed ADDS another copy of the stock (duplicate-import detection comes with the real importer).

## 2. API
```bash
export DATABASE_URL="dbname=warehouse user=YOUR_USER"
python app.py                       # http://localhost:5000  (PORT=... to change)
pytest -q test_api.py               # needs the seeded grocery data; use a throwaway DB
```
CORS allows http://localhost:5173 (Vite) by default; override with CORS_ORIGINS.

| Method | Path | Notes |
|---|---|---|
| GET | /api/health | |
| GET, POST | /api/industries | new industry = one row, no schema change |
| GET | /api/categories, /api/suppliers?q= | suppliers paginated |
| GET, POST | /api/warehouses | POST: name, industry, location? |
| GET, POST | /api/products | GET: q, category_id, industry, page, per_page. POST: product_name, industry, category_id?, attributes{} |
| GET, PATCH | /api/products/<id> | detail includes batches + per-warehouse stock |
| POST | /api/batches | goods-in: creates batch + stock row atomically |
| GET | /api/inventory | warehouse_id, batch_id, product_id, category_id, q, low_stock=true, expiring_before=YYYY-MM-DD |
| GET, POST | /api/transfers | POST: batch_id, from_warehouse_id, to_warehouse_id, quantity |
| GET | /api/imports, /api/imports/<id>/issues?severity= | import report + quarantine |

Errors are `{"error": "..."}`: 400 bad request, 404 missing, 409 conflict (duplicate, insufficient stock,
industry mismatch), 422 invalid value / DB constraint, 503 concurrent conflict (retry).
