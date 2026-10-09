"""
Inventory & Warehouse Management System - Flask REST API.

Run:   DATABASE_URL="dbname=warehouse" python app.py
Notes: no auth yet (that is a later step). All SQL is parameterized; the only strings
       interpolated into SQL are constants defined in this file, never user input.
"""
import os
from datetime import date, datetime
from decimal import Decimal

from flask import Blueprint, Flask, current_app, jsonify, request
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
from psycopg import errors as pgerr
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool
from werkzeug.exceptions import HTTPException

INT_MAX = 2_147_483_647
api = Blueprint("api", __name__, url_prefix="/api")


# --------------------------------------------------------------------- plumbing
class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def _json_default(o):
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return float(o)
    return DefaultJSONProvider.default(o)


class JsonProvider(DefaultJSONProvider):
    default = staticmethod(_json_default)
    sort_keys = False


def db():
    """Connection from the pool. Commits on clean exit, rolls back on any exception."""
    return current_app.extensions["pool"].connection()


def body_json():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError(400, "Request body must be a JSON object")
    return data


def req_int(d, key, minimum=None, optional=False, default=None):
    if key not in d or d[key] is None:
        if optional:
            return default
        raise ApiError(422, f"{key} is required")
    v = d[key]
    if isinstance(v, bool) or not isinstance(v, int):
        raise ApiError(422, f"{key} must be an integer")
    if v > INT_MAX or (minimum is not None and v < minimum):
        raise ApiError(422, f"{key} must be between {minimum if minimum is not None else 'min'} and {INT_MAX}")
    return v


def req_str(d, key, max_len, optional=False):
    v = d.get(key)
    if v is None and optional:
        return None
    if not isinstance(v, str) or not v.strip():
        raise ApiError(422, f"{key} is required and must be a non-empty string")
    v = v.strip()
    if len(v) > max_len:
        raise ApiError(422, f"{key} must be at most {max_len} characters")
    return v


def req_number(d, key, minimum=0):
    v = d.get(key)
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ApiError(422, f"{key} must be a number")
    if v < minimum or v > 99_999_999:
        raise ApiError(422, f"{key} out of range")
    return round(v, 2)


def req_date(d, key, optional=False):
    v = d.get(key)
    if v is None and optional:
        return None
    try:
        return date.fromisoformat(v)
    except (TypeError, ValueError):
        raise ApiError(422, f"{key} must be an ISO date (YYYY-MM-DD)")


def arg_int(name):
    v = request.args.get(name)
    if v is None or v == "":
        return None
    try:
        return int(v)
    except ValueError:
        raise ApiError(400, f"{name} must be an integer")


def arg_date(name):
    v = request.args.get(name)
    if not v:
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise ApiError(400, f"{name} must be an ISO date (YYYY-MM-DD)")


def paged(cur, select, from_where, params, order):
    try:
        page = int(request.args.get("page", 1))
        per = int(request.args.get("per_page", 25))
    except ValueError:
        raise ApiError(400, "page and per_page must be integers")
    if page < 1 or not 1 <= per <= 100:
        raise ApiError(400, "page must be >= 1 and per_page between 1 and 100")
    cur.execute(f"SELECT count(*) AS n FROM {from_where}", params)
    total = cur.fetchone()["n"]
    cur.execute(f"SELECT {select} FROM {from_where} ORDER BY {order} LIMIT %s OFFSET %s",
                [*params, per, (page - 1) * per])
    return {"items": cur.fetchall(), "page": page, "per_page": per, "total": total}


def where(conds):
    return (" WHERE " + " AND ".join(conds)) if conds else ""


# ------------------------------------------------------------------ meta / lookups
@api.get("/health")
def health():
    with db() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


@api.get("/industries")
def list_industries():
    with db() as conn:
        rows = conn.execute(
            "SELECT it.industry_type_id, it.name, "
            "(SELECT count(*) FROM warehouse w WHERE w.industry_type_id = it.industry_type_id) AS warehouses, "
            "(SELECT count(*) FROM product p WHERE p.industry_type_id = it.industry_type_id) AS products "
            "FROM industry_type it ORDER BY it.name").fetchall()
    return {"items": rows}


@api.post("/industries")
def create_industry():
    name = req_str(body_json(), "name", 50).lower()
    with db() as conn:
        row = conn.execute("INSERT INTO industry_type(name) VALUES (%s) RETURNING industry_type_id, name",
                           (name,)).fetchone()
    return row, 201


@api.get("/categories")
def list_categories():
    with db() as conn:
        rows = conn.execute(
            "SELECT c.category_id, c.category_name, count(p.product_id) AS products "
            "FROM category c LEFT JOIN product p USING (category_id) "
            "GROUP BY c.category_id ORDER BY c.category_name").fetchall()
    return {"items": rows}


@api.get("/suppliers")
def list_suppliers():
    conds, params = [], []
    q = request.args.get("q", "").strip()
    if q:
        conds.append("s.supplier_name ILIKE %s")
        params.append(f"%{q}%")
    with db() as conn:
        return paged(conn.cursor(),
                     "s.supplier_id, s.supplier_name, "
                     "(SELECT count(*) FROM inventory_batch b WHERE b.supplier_id = s.supplier_id) AS batches",
                     "supplier s" + where(conds), params, "s.supplier_name, s.supplier_id")


# --------------------------------------------------------------------- warehouses
@api.get("/warehouses")
def list_warehouses():
    with db() as conn:
        rows = conn.execute(
            "SELECT w.warehouse_id, w.name, w.location, it.name AS industry, w.created_at, "
            "COALESCE(st.batches, 0) AS batch_count, COALESCE(st.units, 0) AS total_units "
            "FROM warehouse w JOIN industry_type it USING (industry_type_id) "
            "LEFT JOIN (SELECT warehouse_id, count(*) AS batches, sum(quantity) AS units "
            "           FROM inventory GROUP BY warehouse_id) st ON st.warehouse_id = w.warehouse_id "
            "ORDER BY w.warehouse_id").fetchall()
    return {"items": rows}


@api.post("/warehouses")
def create_warehouse():
    d = body_json()
    name = req_str(d, "name", 150)
    industry = req_str(d, "industry", 50).lower()
    location = req_str(d, "location", 200, optional=True)
    with db() as conn:
        ind = conn.execute("SELECT industry_type_id FROM industry_type WHERE name = %s", (industry,)).fetchone()
        if not ind:
            raise ApiError(422, f"Unknown industry {industry!r}; create it first via POST /api/industries")
        row = conn.execute(
            "INSERT INTO warehouse(name, industry_type_id, location) VALUES (%s, %s, %s) "
            "RETURNING warehouse_id, name, location, created_at",
            (name, ind["industry_type_id"], location)).fetchone()
    row["industry"] = industry
    return row, 201


# ----------------------------------------------------------------------- products
PRODUCT_SELECT = (
    "p.product_id, p.product_name, p.category_id, c.category_name, it.name AS industry, p.attributes, "
    "(SELECT count(*) FROM inventory_batch b WHERE b.product_id = p.product_id) AS batch_count, "
    "(SELECT COALESCE(SUM(i.quantity), 0) FROM inventory_batch b JOIN inventory i USING (batch_id) "
    " WHERE b.product_id = p.product_id) AS total_stock"
)
PRODUCT_FROM = ("product p LEFT JOIN category c USING (category_id) "
                "JOIN industry_type it USING (industry_type_id)")


@api.get("/products")
def list_products():
    conds, params = [], []
    q = request.args.get("q", "").strip()
    if q:
        conds.append("p.product_name ILIKE %s")
        params.append(f"%{q}%")
    cat = arg_int("category_id")
    if cat is not None:
        conds.append("p.category_id = %s")
        params.append(cat)
    industry = request.args.get("industry", "").strip().lower()
    if industry:
        conds.append("it.name = %s")
        params.append(industry)
    with db() as conn:
        return paged(conn.cursor(), PRODUCT_SELECT, PRODUCT_FROM + where(conds), params,
                     "p.product_name, p.product_id")


def fetch_product(conn, product_id):
    p = conn.execute(f"SELECT {PRODUCT_SELECT} FROM {PRODUCT_FROM} WHERE p.product_id = %s",
                     (product_id,)).fetchone()
    if not p:
        raise ApiError(404, f"Product {product_id} not found")
    return p


@api.get("/products/<int:product_id>")
def get_product(product_id):
    with db() as conn:
        p = fetch_product(conn, product_id)
        batches = conn.execute(
            "SELECT b.batch_id, b.received_date, b.expiration_date, b.unit_price, b.received_quantity, "
            "b.reorder_level, b.reorder_quantity, b.sales_volume, s.supplier_id, s.supplier_name "
            "FROM inventory_batch b JOIN supplier s USING (supplier_id) "
            "WHERE b.product_id = %s ORDER BY b.received_date DESC, b.batch_id LIMIT 200",
            (product_id,)).fetchall()
        stock = conn.execute(
            "SELECT i.batch_id, i.warehouse_id, w.name AS warehouse, i.quantity "
            "FROM inventory i JOIN warehouse w USING (warehouse_id) WHERE i.batch_id = ANY(%s) "
            "ORDER BY i.batch_id, i.warehouse_id", ([b["batch_id"] for b in batches],)).fetchall()
    by_batch = {}
    for s in stock:
        by_batch.setdefault(s["batch_id"], []).append(
            {"warehouse_id": s["warehouse_id"], "warehouse": s["warehouse"], "quantity": s["quantity"]})
    for b in batches:
        b["stock"] = by_batch.get(b["batch_id"], [])
    p["batches"] = batches
    return p


@api.post("/products")
def create_product():
    d = body_json()
    name = req_str(d, "product_name", 150)
    industry = req_str(d, "industry", 50).lower()
    category_id = req_int(d, "category_id", minimum=1, optional=True)
    attrs = d.get("attributes", {})
    if not isinstance(attrs, dict):
        raise ApiError(422, "attributes must be a JSON object")
    with db() as conn:
        ind = conn.execute("SELECT industry_type_id FROM industry_type WHERE name = %s", (industry,)).fetchone()
        if not ind:
            raise ApiError(422, f"Unknown industry {industry!r}")
        pid = conn.execute(
            "INSERT INTO product(product_name, category_id, industry_type_id, attributes) "
            "VALUES (%s, %s, %s, %s) RETURNING product_id",
            (name, category_id, ind["industry_type_id"], Jsonb(attrs))).fetchone()["product_id"]
        return fetch_product(conn, pid), 201


@api.patch("/products/<int:product_id>")
def update_product(product_id):
    d = body_json()
    sets, params = [], []
    if "product_name" in d:
        sets.append("product_name = %s")
        params.append(req_str(d, "product_name", 150))
    if "category_id" in d:
        sets.append("category_id = %s")
        params.append(req_int(d, "category_id", minimum=1, optional=True))
    if "attributes" in d:
        if not isinstance(d["attributes"], dict):
            raise ApiError(422, "attributes must be a JSON object")
        sets.append("attributes = %s")
        params.append(Jsonb(d["attributes"]))
    if not sets:
        raise ApiError(400, "Nothing to update (allowed: product_name, category_id, attributes)")
    with db() as conn:
        n = conn.execute(f"UPDATE product SET {', '.join(sets)} WHERE product_id = %s",
                         [*params, product_id]).rowcount
        if not n:
            raise ApiError(404, f"Product {product_id} not found")
        return fetch_product(conn, product_id)


# --------------------------------------------------------------- batches (goods in)
@api.post("/batches")
def receive_batch():
    """Goods-in: creates the batch and its stock row in the given warehouse, atomically."""
    d = body_json()
    product_id = req_int(d, "product_id", minimum=1)
    supplier_id = req_int(d, "supplier_id", minimum=1)
    warehouse_id = req_int(d, "warehouse_id", minimum=1)
    qty = req_int(d, "quantity", minimum=0)
    received = req_date(d, "received_date")
    expiry = req_date(d, "expiration_date", optional=True)
    price = req_number(d, "unit_price")
    rl = req_int(d, "reorder_level", minimum=0, optional=True, default=0)
    rq = req_int(d, "reorder_quantity", minimum=0, optional=True, default=0)
    with db() as conn:
        chk = conn.execute(
            "SELECT w.industry_type_id = p.industry_type_id AS compatible "
            "FROM product p, warehouse w WHERE p.product_id = %s AND w.warehouse_id = %s",
            (product_id, warehouse_id)).fetchone()
        if not chk:
            raise ApiError(404, "Product or warehouse not found")
        if not chk["compatible"]:
            raise ApiError(409, "Product and warehouse belong to different industries")
        batch = conn.execute(
            "INSERT INTO inventory_batch(product_id, supplier_id, received_date, expiration_date, unit_price, "
            "received_quantity, reorder_level, reorder_quantity) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
            "RETURNING batch_id", (product_id, supplier_id, received, expiry, price, qty, rl, rq)).fetchone()
        conn.execute("INSERT INTO inventory(batch_id, warehouse_id, quantity) VALUES (%s, %s, %s)",
                     (batch["batch_id"], warehouse_id, qty))
    return {"batch_id": batch["batch_id"], "warehouse_id": warehouse_id, "quantity": qty}, 201


# ---------------------------------------------------------------------- inventory
INV_FROM = ("inventory i JOIN inventory_batch b USING (batch_id) JOIN product p USING (product_id) "
            "LEFT JOIN category c USING (category_id) JOIN supplier s USING (supplier_id) "
            "JOIN warehouse w ON w.warehouse_id = i.warehouse_id")
INV_SELECT = ("i.batch_id, i.warehouse_id, w.name AS warehouse, p.product_id, p.product_name, "
              "c.category_name, s.supplier_name, i.quantity, b.reorder_level, b.reorder_quantity, "
              "b.unit_price, b.received_date, b.expiration_date, (i.quantity <= b.reorder_level) AS low_stock")


@api.get("/inventory")
def list_inventory():
    conds, params = [], []
    for arg, col in (("warehouse_id", "i.warehouse_id"), ("batch_id", "i.batch_id"),
                     ("product_id", "p.product_id"), ("category_id", "p.category_id")):
        v = arg_int(arg)
        if v is not None:
            conds.append(f"{col} = %s")
            params.append(v)
    q = request.args.get("q", "").strip()
    if q:
        conds.append("p.product_name ILIKE %s")
        params.append(f"%{q}%")
    if request.args.get("low_stock", "").lower() in ("1", "true", "yes"):
        conds.append("i.quantity <= b.reorder_level")
    before = arg_date("expiring_before")
    if before:
        conds.append("b.expiration_date IS NOT NULL AND b.expiration_date <= %s")
        params.append(before)
    with db() as conn:
        return paged(conn.cursor(), INV_SELECT, INV_FROM + where(conds), params,
                     "p.product_name, i.batch_id, i.warehouse_id")


# --------------------------------------------------------------------- transfers
@api.get("/transfers")
def list_transfers():
    with db() as conn:
        return paged(conn.cursor(),
                     "t.transfer_id, t.batch_id, p.product_name, t.from_warehouse_id, wf.name AS from_warehouse, "
                     "t.to_warehouse_id, wt.name AS to_warehouse, t.quantity, t.transferred_at",
                     "stock_transfer t JOIN inventory_batch b USING (batch_id) JOIN product p USING (product_id) "
                     "JOIN warehouse wf ON wf.warehouse_id = t.from_warehouse_id "
                     "JOIN warehouse wt ON wt.warehouse_id = t.to_warehouse_id",
                     [], "t.transfer_id DESC")


@api.post("/transfers")
def create_transfer():
    """
    Move stock of one batch between warehouses as ONE transaction.

    Concurrency: both inventory rows are locked up front with FOR UPDATE, in a fixed
    (warehouse_id) order. Without that ordering, A->B and B->A transfers of the same batch
    each lock their own source row first and then wait on the other's: a classic deadlock.
    """
    d = body_json()
    batch_id = req_int(d, "batch_id", minimum=1)
    src = req_int(d, "from_warehouse_id", minimum=1)
    dst = req_int(d, "to_warehouse_id", minimum=1)
    qty = req_int(d, "quantity", minimum=1)
    if src == dst:
        raise ApiError(422, "from_warehouse_id and to_warehouse_id must differ")

    with db() as conn:
        chk = conn.execute(
            "SELECT w.industry_type_id = p.industry_type_id AS compatible "
            "FROM inventory_batch b JOIN product p USING (product_id), warehouse w "
            "WHERE b.batch_id = %s AND w.warehouse_id = %s", (batch_id, dst)).fetchone()
        if not chk:
            raise ApiError(404, "Batch or destination warehouse not found")
        if not chk["compatible"]:
            raise ApiError(409, "Destination warehouse belongs to a different industry than this product")

        locked = {r["warehouse_id"]: r["quantity"] for r in conn.execute(
            "SELECT warehouse_id, quantity FROM inventory "
            "WHERE batch_id = %s AND warehouse_id IN (%s, %s) ORDER BY warehouse_id FOR UPDATE",
            (batch_id, src, dst)).fetchall()}
        if src not in locked:
            raise ApiError(404, "This batch is not stocked in the source warehouse")
        if locked[src] < qty:
            raise ApiError(409, f"Insufficient stock: source holds {locked[src]}, requested {qty}")

        conn.execute("UPDATE inventory SET quantity = quantity - %s, updated_at = now() "
                     "WHERE batch_id = %s AND warehouse_id = %s", (qty, batch_id, src))
        conn.execute("INSERT INTO inventory(batch_id, warehouse_id, quantity) VALUES (%s, %s, %s) "
                     "ON CONFLICT (batch_id, warehouse_id) "
                     "DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity, updated_at = now()",
                     (batch_id, dst, qty))
        row = conn.execute(
            "INSERT INTO stock_transfer(batch_id, from_warehouse_id, to_warehouse_id, quantity) "
            "VALUES (%s, %s, %s, %s) RETURNING transfer_id, batch_id, from_warehouse_id, "
            "to_warehouse_id, quantity, transferred_at", (batch_id, src, dst, qty)).fetchone()
    return row, 201


# ------------------------------------------------------------------------ imports
@api.get("/imports")
def list_imports():
    with db() as conn:
        return paged(conn.cursor(),
                     "r.import_run_id, r.filename, w.name AS warehouse, r.records_processed, r.records_imported, "
                     "r.warning_count, r.error_count, r.started_at, r.finished_at",
                     "import_run r JOIN warehouse w USING (warehouse_id)", [], "r.import_run_id DESC")


@api.get("/imports/<int:run_id>/issues")
def list_import_issues(run_id):
    conds, params = ["import_run_id = %s"], [run_id]
    sev = request.args.get("severity", "").lower()
    if sev:
        if sev not in ("error", "warning"):
            raise ApiError(400, "severity must be 'error' or 'warning'")
        conds.append("severity = %s")
        params.append(sev)
    with db() as conn:
        if not conn.execute("SELECT 1 FROM import_run WHERE import_run_id = %s", (run_id,)).fetchone():
            raise ApiError(404, f"Import run {run_id} not found")
        return paged(conn.cursor(), "issue_id, row_number, severity, rule_code, column_name, message, raw_row",
                     "import_issue" + where(conds), params, "row_number, issue_id")


# ------------------------------------------------------------------------ factory
def create_app(dsn=None):
    app = Flask(__name__)
    app.json = JsonProvider(app)
    CORS(app, resources={r"/api/*": {
        "origins": os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")}})

    pool = ConnectionPool(dsn or os.environ.get("DATABASE_URL", "dbname=warehouse"),
                          min_size=1, max_size=int(os.environ.get("DB_POOL_MAX", "10")),
                          kwargs={"row_factory": dict_row}, open=False)
    pool.open(wait=True, timeout=10)
    app.extensions["pool"] = pool
    app.register_blueprint(api)

    def err(status, message):
        return jsonify({"error": message}), status

    @app.errorhandler(ApiError)
    def _api_error(e):
        return err(e.status, e.message)

    @app.errorhandler(HTTPException)
    def _http_error(e):
        return err(e.code, e.description)

    @app.errorhandler(pgerr.UniqueViolation)
    def _unique(e):
        return err(409, f"Already exists ({e.diag.constraint_name})")

    @app.errorhandler(pgerr.CheckViolation)
    def _check(e):
        return err(422, f"Violates rule {e.diag.constraint_name}")

    @app.errorhandler(pgerr.ForeignKeyViolation)
    def _fk(e):
        return err(422, f"Referenced record does not exist ({e.diag.constraint_name})")

    @app.errorhandler(pgerr.DataError)
    def _data(e):
        return err(422, "Invalid value")

    @app.errorhandler(pgerr.DeadlockDetected)
    @app.errorhandler(pgerr.SerializationFailure)
    def _retry(e):
        return err(503, "Concurrent update conflict; please retry")

    @app.errorhandler(Exception)
    def _unexpected(e):
        app.logger.exception("Unhandled error")
        return err(500, "Internal server error")

    return app


if __name__ == "__main__":
    create_app().run(port=int(os.environ.get("PORT", "5000")), debug=os.environ.get("FLASK_DEBUG") == "1")
