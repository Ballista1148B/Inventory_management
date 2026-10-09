"""
API tests. Requirements: schema.sql applied and seed_grocery.py run (needs real grocery rows).
Point DATABASE_URL at a throwaway DB; tests create their own warehouses/batches but do not clean up.

    DATABASE_URL="dbname=warehouse" pytest -q test_api.py
"""
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from app import create_app


@pytest.fixture(scope="module")
def app():
    return create_app()


@pytest.fixture()
def client(app):
    return app.test_client()


def uid():
    return uuid.uuid4().hex[:8]


def make_warehouse(client, industry="grocery"):
    r = client.post("/api/warehouses", json={"name": f"test-{uid()}", "industry": industry})
    assert r.status_code == 201, r.get_json()
    return r.get_json()["warehouse_id"]


@pytest.fixture()
def stocked(client):
    """Fresh grocery warehouse W1 holding one new batch of 20 units, plus an empty W2."""
    product = client.get("/api/products?industry=grocery&per_page=1").get_json()["items"][0]
    supplier = client.get("/api/suppliers?per_page=1").get_json()["items"][0]
    w1, w2 = make_warehouse(client), make_warehouse(client)
    r = client.post("/api/batches", json={
        "product_id": product["product_id"], "supplier_id": supplier["supplier_id"], "warehouse_id": w1,
        "quantity": 20, "received_date": "2026-01-01", "expiration_date": "2026-12-31", "unit_price": 3.5})
    assert r.status_code == 201, r.get_json()
    return {"batch": r.get_json()["batch_id"], "w1": w1, "w2": w2, "product": product}


def qty(client, batch, wh):
    items = client.get(f"/api/inventory?batch_id={batch}&warehouse_id={wh}").get_json()["items"]
    return items[0]["quantity"] if items else 0


# ------------------------------------------------------------------- basics
def test_health(client):
    assert client.get("/api/health").get_json() == {"status": "ok"}


def test_unknown_route_is_json_404(client):
    r = client.get("/api/nope")
    assert r.status_code == 404 and "error" in r.get_json()


def test_products_pagination_and_search(client):
    r = client.get("/api/products?per_page=5").get_json()
    assert len(r["items"]) == 5 and r["total"] >= 100 and r["page"] == 1
    hit = client.get("/api/products?q=cauliflower").get_json()["items"]
    assert len(hit) == 1 and hit[0]["category_name"] == "Fruits & Vegetables"


@pytest.mark.parametrize("qs", ["per_page=1000", "per_page=0", "page=0", "page=abc"])
def test_bad_pagination_is_400(client, qs):
    assert client.get(f"/api/products?{qs}").status_code == 400


def test_product_detail_has_batches_and_stock(client):
    pid = client.get("/api/products?per_page=1").get_json()["items"][0]["product_id"]
    p = client.get(f"/api/products/{pid}").get_json()
    assert p["batches"] and "stock" in p["batches"][0]
    assert client.get("/api/products/99999999").status_code == 404


def test_inventory_filters(client):
    low = client.get("/api/inventory?low_stock=true&per_page=100").get_json()["items"]
    assert low and all(i["low_stock"] for i in low)
    exp = client.get("/api/inventory?expiring_before=2024-06-01&per_page=100").get_json()["items"]
    assert all(i["expiration_date"] <= "2024-06-01" for i in exp)
    assert client.get("/api/inventory?expiring_before=junk").status_code == 400


def test_import_report_and_issues(client):
    run = client.get("/api/imports").get_json()["items"][0]
    assert run["records_processed"] == run["records_imported"] + run["error_count"]
    errs = client.get(f"/api/imports/{run['import_run_id']}/issues?severity=error&per_page=5").get_json()
    assert errs["total"] == run["error_count"]
    assert client.get("/api/imports/999999/issues").status_code == 404


# ------------------------------------------- multi-industry: new industry = new row
def test_new_industry_needs_no_schema_change(client):
    ind = f"winery-{uid()}"
    assert client.post("/api/industries", json={"name": ind}).status_code == 201
    assert client.post("/api/industries", json={"name": ind}).status_code == 409
    r = client.post("/api/products", json={
        "product_name": f"Merlot {uid()}", "industry": ind,
        "attributes": {"vintage_year": 2019, "grape_variety": "Merlot", "abv": 13.5, "bottle_ml": 750}})
    assert r.status_code == 201
    assert r.get_json()["attributes"]["vintage_year"] == 2019


# --------------------------------------------------------------- validation
def test_validation_errors(client):
    assert client.post("/api/products", data="not json", content_type="application/json").status_code == 400
    assert client.post("/api/products", json={"industry": "grocery"}).status_code == 422
    assert client.post("/api/products", json={"product_name": "x", "industry": "nonexistent"}).status_code == 422
    assert client.post("/api/products", json={"product_name": "x", "industry": "grocery",
                                              "attributes": [1]}).status_code == 422
    assert client.post("/api/products", json={"product_name": "x", "industry": "grocery",
                                              "category_id": 999999}).status_code == 422
    name = f"dupe-{uid()}"
    assert client.post("/api/products", json={"product_name": name, "industry": "grocery"}).status_code == 201
    assert client.post("/api/products", json={"product_name": name, "industry": "grocery"}).status_code == 409


def test_db_constraint_surfaces_as_422(client, stocked):
    r = client.post("/api/batches", json={
        "product_id": stocked["product"]["product_id"], "supplier_id": 1, "warehouse_id": stocked["w1"],
        "quantity": 1, "received_date": "2026-05-01", "expiration_date": "2026-04-01", "unit_price": 1})
    assert r.status_code == 422 and "ck_expiry_after_received" in r.get_json()["error"]


def test_patch_product(client):
    pid = client.post("/api/products", json={"product_name": f"p-{uid()}", "industry": "grocery"}).get_json()["product_id"]
    r = client.patch(f"/api/products/{pid}", json={"attributes": {"weight_g": 500}})
    assert r.status_code == 200 and r.get_json()["attributes"] == {"weight_g": 500}
    assert client.patch(f"/api/products/{pid}", json={}).status_code == 400
    assert client.patch("/api/products/99999999", json={"product_name": "z"}).status_code == 404


# ---------------------------------------------------------------- transfers
def test_transfer_happy_path_and_rules(client, stocked):
    b, w1, w2 = stocked["batch"], stocked["w1"], stocked["w2"]
    t = lambda **kw: client.post("/api/transfers", json={"batch_id": b, "from_warehouse_id": w1,
                                                         "to_warehouse_id": w2, "quantity": 5, **kw})
    assert t().status_code == 201
    assert (qty(client, b, w1), qty(client, b, w2)) == (15, 5)
    assert t(quantity=999).status_code == 409                       # insufficient stock
    assert t(to_warehouse_id=w1).status_code == 422                 # same warehouse
    assert t(quantity=0).status_code == 422
    assert t(batch_id=99999999).status_code == 404
    assert client.post("/api/transfers", json={"batch_id": b, "from_warehouse_id": w2,
                                               "to_warehouse_id": w1, "quantity": 5}).status_code == 201
    other = make_warehouse(client)
    assert t(from_warehouse_id=other).status_code == 404            # batch not stocked there
    assert (qty(client, b, w1), qty(client, b, w2)) == (20, 0)      # conserved after round trip


def test_transfer_blocked_across_industries(client, stocked):
    ind = f"electronics-{uid()}"
    client.post("/api/industries", json={"name": ind})
    foreign = make_warehouse(client, industry=ind)
    r = client.post("/api/transfers", json={"batch_id": stocked["batch"], "from_warehouse_id": stocked["w1"],
                                            "to_warehouse_id": foreign, "quantity": 1})
    assert r.status_code == 409 and qty(client, stocked["batch"], stocked["w1"]) == 20


# -------------------------------------------------------------- concurrency
def test_concurrent_oversell_is_impossible(app, client, stocked):
    """40 simultaneous requests for 1 unit each against 20 units: exactly 20 may win."""
    b, w1, w2 = stocked["batch"], stocked["w1"], stocked["w2"]

    def go(_):
        return app.test_client().post("/api/transfers", json={
            "batch_id": b, "from_warehouse_id": w1, "to_warehouse_id": w2, "quantity": 1}).status_code

    with ThreadPoolExecutor(max_workers=16) as ex:
        codes = list(ex.map(go, range(40)))
    assert codes.count(201) == 20 and codes.count(409) == 20, codes
    assert (qty(client, b, w1), qty(client, b, w2)) == (0, 20)


def test_opposing_transfers_never_deadlock_and_conserve_stock(app, client, stocked):
    """Interleave A->B and B->A on the same batch. Fixed lock order means no 503/deadlock."""
    b, w1, w2 = stocked["batch"], stocked["w1"], stocked["w2"]
    assert client.post("/api/transfers", json={"batch_id": b, "from_warehouse_id": w1,
                                               "to_warehouse_id": w2, "quantity": 10}).status_code == 201

    def go(i):
        src, dst = (w1, w2) if i % 2 == 0 else (w2, w1)
        return app.test_client().post("/api/transfers", json={
            "batch_id": b, "from_warehouse_id": src, "to_warehouse_id": dst, "quantity": 1}).status_code

    with ThreadPoolExecutor(max_workers=16) as ex:
        codes = list(ex.map(go, range(80)))
    assert set(codes) <= {201, 409}, f"unexpected statuses: {sorted(set(codes))}"
    a, c = qty(client, b, w1), qty(client, b, w2)
    assert a >= 0 and c >= 0 and a + c == 20
