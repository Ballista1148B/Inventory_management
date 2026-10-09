#!/usr/bin/env python3
"""
One-off loader: Grocery_Inventory_and_Sales_Dataset.csv -> normalized PostgreSQL.

Deliberately hardcoded for THIS dataset. The generalized, config-driven importer
comes later; this exists so the API has real rows to sit on.

Rules:
  ERROR   -> row is NOT loaded; it is quarantined in import_issue
  WARNING -> row IS loaded; the oddity is recorded in import_issue
Nothing is silently fixed. Everything is one transaction: any crash = full rollback.

Usage:
  python seed_grocery.py --csv Grocery_Inventory_and_Sales_Dataset.csv \
      --warehouse "Main Grocery Warehouse" [--dsn "host=/tmp dbname=warehouse user=postgres"]
"""
import argparse
import csv
from collections import Counter
import os
import sys
from datetime import datetime

import psycopg
from psycopg.types.json import Jsonb

INDUSTRY = "grocery"
UNCATEGORIZED = "Uncategorized"

# The dashed dates never have a component > 12, so the data cannot say whether they
# are MM-DD-YYYY or DD-MM-YYYY. Slash dates are provably month-first. Assumption below.
DASH_FORMATS = {"MDY": "%m-%d-%Y", "DMY": "%d-%m-%Y"}


def parse_date(raw, dash_fmt):
    v = (raw or "").strip()
    if not v:
        raise ValueError("empty")
    return datetime.strptime(v, "%m/%d/%Y" if "/" in v else dash_fmt).date()


def parse_price(raw):
    v = (raw or "").replace("$", "").replace(",", "").strip()
    if not v:
        raise ValueError("empty")
    return round(float(v), 2)


def parse_int(raw):
    v = (raw or "").strip()
    if not v:
        raise ValueError("empty")
    f = float(v)
    if f != int(f):
        raise ValueError("not a whole number")
    return int(f)


class Issues:
    def __init__(self):
        self.items = []  # (row_number, severity, rule, column, message, raw)

    def add(self, row_no, severity, rule, column, message, raw):
        self.items.append((row_no, severity, rule, column, message, raw))

    def count(self, severity):
        return sum(1 for i in self.items if i[1] == severity)

    def error_rows(self):
        return {i[0] for i in self.items if i[1] == "error"}


def validate_row(row_no, raw, dash_fmt, seen_product_ids, issues):
    """Return a clean dict, or None if the row has at least one error."""
    errs_before = len(issues.items)
    clean = {}

    def err(rule, col, msg):
        issues.add(row_no, "error", rule, col, msg, raw)

    for col, key in (("Product_Name", "product_name"), ("Supplier_Name", "supplier_name")):
        v = (raw.get(col) or "").strip()
        if not v:
            err("MISSING_REQUIRED", col, f"{col} is empty")
        clean[key] = v

    for col, key in (("Date_Received", "received"), ("Last_Order_Date", "last_order"),
                     ("Expiration_Date", "expiration")):
        try:
            clean[key] = parse_date(raw.get(col), dash_fmt)
        except ValueError as e:
            err("INVALID_DATE", col, f"{col}={raw.get(col)!r}: {e}")

    try:
        clean["price"] = parse_price(raw.get("Unit_Price"))
        if clean["price"] < 0:
            err("NEGATIVE_VALUE", "Unit_Price", "Unit_Price is negative")
    except ValueError as e:
        err("INVALID_NUMBER", "Unit_Price", f"Unit_Price={raw.get('Unit_Price')!r}: {e}")

    for col, key in (("Stock_Quantity", "qty"), ("Reorder_Level", "reorder_level"),
                     ("Reorder_Quantity", "reorder_qty"), ("Sales_Volume", "sales")):
        try:
            clean[key] = parse_int(raw.get(col))
            if clean[key] < 0:
                err("NEGATIVE_VALUE", col, f"{col} is negative ({clean[key]})")
        except ValueError as e:
            err("INVALID_NUMBER", col, f"{col}={raw.get(col)!r}: {e}")

    pid = (raw.get("Product_ID") or "").strip()
    if pid and pid in seen_product_ids:
        err("DUPLICATE_ID", "Product_ID", f"Product_ID {pid} already appeared on row {seen_product_ids[pid]}")
    elif pid:
        seen_product_ids[pid] = row_no

    if "received" in clean and "expiration" in clean and clean["expiration"] < clean["received"]:
        err("EXPIRY_BEFORE_RECEIVED", "Expiration_Date",
            f"expires {clean['expiration']} before received {clean['received']}")

    return None if len(issues.items) > errs_before else clean


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--warehouse", default="Main Grocery Warehouse")
    ap.add_argument("--dsn", default=os.environ.get("DATABASE_URL", "host=/tmp dbname=warehouse user=postgres"))
    ap.add_argument("--dash-dates", choices=DASH_FORMATS, default="MDY",
                    help="interpretation of dashed dates (data cannot disambiguate). default MDY")
    args = ap.parse_args()
    dash_fmt = DASH_FORMATS[args.dash_dates]

    with open(args.csv, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    issues = Issues()
    seen_pids = {}
    valid = []
    for i, raw in enumerate(rows, start=1):
        clean = validate_row(i, raw, dash_fmt, seen_pids, issues)
        if clean:
            clean["_row"], clean["_raw"] = i, raw
            valid.append(clean)

    # Run-level notes (row_number 0 = about the whole file, not one row)
    issues.add(0, "warning", "DATE_FORMAT_ASSUMED", "Date_*",
               f"Dashed dates cannot be disambiguated from the data; interpreted as {args.dash_dates}. "
               "Slash dates are unambiguously month-first.", {})
    issues.add(0, "warning", "COLUMN_IGNORED", "Inventory_Turnover_Rate",
               "Not stored: uncorrelated with Sales_Volume/Stock_Quantity (r~0.003), so not a real derived metric.", {})

    with psycopg.connect(args.dsn) as conn:
        cur = conn.cursor()

        cur.execute("INSERT INTO industry_type(name) VALUES (%s) ON CONFLICT (name) DO UPDATE "
                    "SET name = EXCLUDED.name RETURNING industry_type_id", (INDUSTRY,))
        industry_id = cur.fetchone()[0]
        cur.execute("INSERT INTO warehouse(name, industry_type_id) VALUES (%s, %s) "
                    "ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING warehouse_id",
                    (args.warehouse, industry_id))
        wh_id = cur.fetchone()[0]
        cur.execute("INSERT INTO import_run(warehouse_id, filename) VALUES (%s, %s) RETURNING import_run_id",
                    (wh_id, os.path.basename(args.csv)))
        run_id = cur.fetchone()[0]

        categories, suppliers, products = {}, {}, {}   # caches: key -> id
        cat_casefold, sup_casefold = {}, {}            # casefold -> first-seen spelling
        imported = 0

        # A product has ONE category. Where rows disagree, majority vote across ALL rows
        # with a non-empty category (ties -> first seen). Every disagreeing row is warned.
        votes = {}
        for r in rows:
            c = (r.get("Catagory") or "").strip()
            if c:
                votes.setdefault((r.get("Product_Name") or "").strip(), Counter())[c] += 1
        canonical = {}
        for pn, cnt in votes.items():
            winner, n = cnt.most_common(1)[0]
            canonical[pn] = (winner, f"{n} of {sum(cnt.values())} rows")

        def get_category(name, row_no, raw):
            folded = name.casefold()
            if folded in cat_casefold and cat_casefold[folded] != name:
                issues.add(row_no, "warning", "CATEGORY_NAME_VARIANT", "Catagory",
                           f"{name!r} differs only by case/spacing from {cat_casefold[folded]!r}; reused the first", raw)
                name = cat_casefold[folded]
            cat_casefold.setdefault(folded, name)
            if name not in categories:
                cur.execute("INSERT INTO category(category_name) VALUES (%s) ON CONFLICT (category_name) DO UPDATE "
                            "SET category_name = EXCLUDED.category_name RETURNING category_id", (name,))
                categories[name] = cur.fetchone()[0]
            return name, categories[name]

        for v in valid:
            raw, row_no = v["_raw"], v["_row"]

            pname = v["product_name"]
            cat_raw = (raw.get("Catagory") or "").strip()   # sic: header typo in source file
            canon, tally = canonical.get(pname, (UNCATEGORIZED, "no category on any row"))
            if not cat_raw:
                issues.add(row_no, "warning", "MISSING_CATEGORY", "Catagory",
                           f"empty on this row; product category is {canon!r} ({tally})", raw)
            elif cat_raw != canon:
                issues.add(row_no, "warning", "CATEGORY_CONFLICT", "Catagory",
                           f"row says {cat_raw!r}; product category set to majority {canon!r} ({tally})", raw)
            cat_name, _ = get_category(canon, row_no, raw)
            if pname not in products:
                cur.execute("INSERT INTO product(product_name, category_id, industry_type_id) "
                            "VALUES (%s, %s, %s) ON CONFLICT (product_name, industry_type_id) DO UPDATE "
                            "SET product_name = EXCLUDED.product_name RETURNING product_id",
                            (pname, categories[cat_name], industry_id))
                products[pname] = cur.fetchone()[0]

            sname = v["supplier_name"]
            folded = sname.casefold()
            if folded in sup_casefold and sup_casefold[folded] != sname:
                issues.add(row_no, "warning", "SUPPLIER_NAME_VARIANT", "Supplier_Name",
                           f"{sname!r} differs only by case/spacing from {sup_casefold[folded]!r}; reused the first", raw)
                sname = sup_casefold[folded]
            sup_casefold.setdefault(folded, sname)
            if sname not in suppliers:
                cur.execute("INSERT INTO supplier(supplier_name) VALUES (%s) ON CONFLICT (supplier_name) DO UPDATE "
                            "SET supplier_name = EXCLUDED.supplier_name RETURNING supplier_id", (sname,))
                suppliers[sname] = cur.fetchone()[0]

            cur.execute(
                "INSERT INTO inventory_batch(product_id, supplier_id, received_date, last_order_date, "
                "expiration_date, unit_price, received_quantity, reorder_level, reorder_quantity, sales_volume, "
                "source_product_id, source_supplier_id, import_run_id) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING batch_id",
                (products[pname], suppliers[sname], v["received"], v["last_order"], v["expiration"],
                 v["price"], v["qty"], v["reorder_level"], v["reorder_qty"], v["sales"],
                 raw.get("Product_ID"), raw.get("Supplier_ID"), run_id))
            batch_id = cur.fetchone()[0]
            cur.execute("INSERT INTO inventory(batch_id, warehouse_id, quantity) VALUES (%s,%s,%s)",
                        (batch_id, wh_id, v["qty"]))
            imported += 1

        with cur.copy("COPY import_issue(import_run_id, row_number, severity, rule_code, column_name, message, raw_row) "
                      "FROM STDIN") as cp:
            for (rn, sev, rule, col, msg, raw) in issues.items:
                cp.write_row((run_id, rn, sev, rule, col, msg, Jsonb(raw)))

        cur.execute("UPDATE import_run SET records_processed=%s, records_imported=%s, warning_count=%s, "
                    "error_count=%s, finished_at=now() WHERE import_run_id=%s",
                    (len(rows), imported, issues.count("warning"), len(issues.error_rows()), run_id))
        conn.commit()

    print(f"Import run #{run_id} -> warehouse {args.warehouse!r} (dash dates as {args.dash_dates})")
    print(f"  Records processed : {len(rows)}")
    print(f"  Successfully imported: {imported}")
    print(f"  Rows rejected (errors): {len(issues.error_rows())}")
    print(f"  Warnings logged   : {issues.count('warning')}")
    print(f"  Distinct products : {len(products)}  suppliers: {len(suppliers)}  categories: {len(categories)}")


if __name__ == "__main__":
    sys.exit(main())
