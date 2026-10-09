-- =====================================================================
-- Inventory & Warehouse Management System : PostgreSQL schema
-- Re-runnable: drops everything first (DEV ONLY).
-- =====================================================================
BEGIN;

DROP TABLE IF EXISTS import_issue    CASCADE;
DROP TABLE IF EXISTS stock_transfer  CASCADE;
DROP TABLE IF EXISTS inventory       CASCADE;
DROP TABLE IF EXISTS inventory_batch CASCADE;
DROP TABLE IF EXISTS import_run      CASCADE;
DROP TABLE IF EXISTS product         CASCADE;
DROP TABLE IF EXISTS supplier        CASCADE;
DROP TABLE IF EXISTS warehouse       CASCADE;
DROP TABLE IF EXISTS industry_type   CASCADE;
DROP TABLE IF EXISTS category        CASCADE;

-- ---------------------------------------------------------------------
-- Lookup / master tables
-- ---------------------------------------------------------------------
CREATE TABLE category (
    category_id    SERIAL       PRIMARY KEY,
    category_name  VARCHAR(100) NOT NULL,
    CONSTRAINT uq_category_name UNIQUE (category_name)
);

CREATE TABLE industry_type (
    industry_type_id SERIAL      PRIMARY KEY,
    name             VARCHAR(50) NOT NULL,   -- 'grocery', 'winery', ...
    CONSTRAINT uq_industry_name UNIQUE (name)
);

CREATE TABLE warehouse (
    warehouse_id     SERIAL       PRIMARY KEY,
    name             VARCHAR(150) NOT NULL,
    industry_type_id INTEGER      NOT NULL REFERENCES industry_type(industry_type_id),
    location         VARCHAR(200),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_warehouse_name UNIQUE (name)
);

CREATE TABLE supplier (
    supplier_id    SERIAL       PRIMARY KEY,
    supplier_name  VARCHAR(150) NOT NULL,
    CONSTRAINT uq_supplier_name UNIQUE (supplier_name)
);

CREATE TABLE product (
    product_id       SERIAL       PRIMARY KEY,
    product_name     VARCHAR(150) NOT NULL,
    category_id      INTEGER      REFERENCES category(category_id),
    industry_type_id INTEGER      NOT NULL REFERENCES industry_type(industry_type_id),
    attributes       JSONB        NOT NULL DEFAULT '{}'::jsonb,  -- industry-specific extras
    CONSTRAINT uq_product_name_industry UNIQUE (product_name, industry_type_id),
    CONSTRAINT ck_attributes_is_object  CHECK (jsonb_typeof(attributes) = 'object')
);

-- ---------------------------------------------------------------------
-- Import bookkeeping (created before batch so batch can reference it)
-- ---------------------------------------------------------------------
CREATE TABLE import_run (
    import_run_id     BIGSERIAL    PRIMARY KEY,
    warehouse_id      INTEGER      NOT NULL REFERENCES warehouse(warehouse_id),
    filename          VARCHAR(255) NOT NULL,
    records_processed INTEGER      NOT NULL DEFAULT 0 CHECK (records_processed >= 0),
    records_imported  INTEGER      NOT NULL DEFAULT 0 CHECK (records_imported  >= 0),
    warning_count     INTEGER      NOT NULL DEFAULT 0 CHECK (warning_count     >= 0),
    error_count       INTEGER      NOT NULL DEFAULT 0 CHECK (error_count       >= 0),
    started_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ,
    CONSTRAINT ck_import_counts CHECK (records_imported <= records_processed)
);

-- ---------------------------------------------------------------------
-- A batch = one receipt of one product from one supplier.
-- It describes the delivery itself, NOT where the stock currently sits.
-- ---------------------------------------------------------------------
CREATE TABLE inventory_batch (
    batch_id          BIGSERIAL     PRIMARY KEY,
    product_id        INTEGER       NOT NULL REFERENCES product(product_id),
    supplier_id       INTEGER       NOT NULL REFERENCES supplier(supplier_id),
    received_date     DATE          NOT NULL,
    last_order_date   DATE,
    expiration_date   DATE,
    unit_price        NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    received_quantity INTEGER       NOT NULL CHECK (received_quantity >= 0),
    reorder_level     INTEGER       NOT NULL CHECK (reorder_level     >= 0),
    reorder_quantity  INTEGER       NOT NULL CHECK (reorder_quantity  >= 0),
    sales_volume      INTEGER       NOT NULL DEFAULT 0 CHECK (sales_volume >= 0),
    -- provenance: what the source CSV called this row, kept for traceability
    source_product_id  VARCHAR(50),
    source_supplier_id VARCHAR(50),
    import_run_id      BIGINT REFERENCES import_run(import_run_id),
    CONSTRAINT ck_expiry_after_received
        CHECK (expiration_date IS NULL OR expiration_date >= received_date)
);

-- ---------------------------------------------------------------------
-- Where a batch's stock currently lives. M:N between batch and warehouse.
-- This is the table concurrency demos (FOR UPDATE, lost update) will hit.
-- ---------------------------------------------------------------------
CREATE TABLE inventory (
    batch_id     BIGINT      NOT NULL REFERENCES inventory_batch(batch_id),
    warehouse_id INTEGER     NOT NULL REFERENCES warehouse(warehouse_id),
    quantity     INTEGER     NOT NULL CHECK (quantity >= 0),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (batch_id, warehouse_id)
);

-- A transfer can only move stock from a (batch, warehouse) pair that exists:
-- the composite FK enforces that at the database level.
CREATE TABLE stock_transfer (
    transfer_id       BIGSERIAL   PRIMARY KEY,
    batch_id          BIGINT      NOT NULL,
    from_warehouse_id INTEGER     NOT NULL,
    to_warehouse_id   INTEGER     NOT NULL REFERENCES warehouse(warehouse_id),
    quantity          INTEGER     NOT NULL CHECK (quantity > 0),
    transferred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (batch_id, from_warehouse_id)
        REFERENCES inventory (batch_id, warehouse_id),
    CONSTRAINT ck_transfer_distinct_warehouses CHECK (from_warehouse_id <> to_warehouse_id)
);

-- Quarantine for rows the importer refused or flagged.
CREATE TABLE import_issue (
    issue_id      BIGSERIAL   PRIMARY KEY,
    import_run_id BIGINT      NOT NULL REFERENCES import_run(import_run_id) ON DELETE CASCADE,
    row_number    INTEGER     NOT NULL,                  -- 1-based data row in the CSV
    severity      VARCHAR(7)  NOT NULL CHECK (severity IN ('error', 'warning')),
    rule_code     VARCHAR(60) NOT NULL,                  -- e.g. EXPIRY_BEFORE_RECEIVED
    column_name   VARCHAR(100),
    message       TEXT        NOT NULL,
    raw_row       JSONB       NOT NULL
);

-- ---------------------------------------------------------------------
-- Indexes (FK columns are NOT auto-indexed in PostgreSQL)
-- ---------------------------------------------------------------------
CREATE INDEX idx_product_category      ON product(category_id);
CREATE INDEX idx_product_attributes    ON product USING GIN (attributes);
CREATE INDEX idx_batch_product         ON inventory_batch(product_id);
CREATE INDEX idx_batch_supplier        ON inventory_batch(supplier_id);
CREATE INDEX idx_batch_expiration      ON inventory_batch(expiration_date)
                                        WHERE expiration_date IS NOT NULL;
CREATE INDEX idx_inventory_warehouse   ON inventory(warehouse_id);
CREATE INDEX idx_issue_run_severity    ON import_issue(import_run_id, severity);

COMMIT;
