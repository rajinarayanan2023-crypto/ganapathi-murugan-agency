-- =============================================================================
-- Fuel Pump Manager — Backend Database Schema (PostgreSQL)
--
-- Generated from the app's current in-memory data model (DataContext.jsx,
-- utils/fuelCalc.js, data/mockData.js) — no UI concerns, this is table and
-- column structure only, ready to run against a fresh database.
--
-- Single-station: there is exactly one business here, never a second
-- location, so nothing below carries a station_id.
--
-- No table holds business-profile data (name, GSTIN, address, logo, ...).
-- Today that's all read-only display copy with no edit screen anywhere in
-- the app — same category as a hardcoded constant, so it stays frontend
-- config until an actual "Edit Business Profile" screen writes to it. The
-- one field that WAS genuinely mutable (audit_contact_email, set from the
-- Audit modal) has no home for now either — add it back as a one-row table
-- the moment that value needs to persist server-side.
--
-- Tables are created in dependency order so every FOREIGN KEY resolves on
-- first pass (no forward references, no ALTER TABLE ... ADD CONSTRAINT pass
-- needed afterwards).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- =============================================================================
-- 1. FOUNDATIONAL — config/reference data, not tied to a station
-- =============================================================================

CREATE TABLE fuel_rates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fuel_type     TEXT NOT NULL UNIQUE CHECK (fuel_type IN ('petrol', 'diesel', 'oil')),
    rate          NUMERIC(10,3) NOT NULL, -- ₹ per litre — today's default for new readings
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- All five figures (three per-litre, two per-piece) are revised together as
-- one OMC agreement change, so they're versioned as a single dated snapshot
-- rather than five separate per-fuel history tables — the same "latest
-- effective_from <= date wins" pattern as employee_salary_history and
-- lubricant_price_history. The Dashboard's profit trend looks up the row in
-- force on EACH day it totals, so revising today's rate never reshapes a
-- past month's numbers.
CREATE TABLE commission_rate_history (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    effective_from   DATE NOT NULL UNIQUE,
    petrol           NUMERIC(10,3) NOT NULL, -- ₹ per litre
    diesel           NUMERIC(10,3) NOT NULL, -- ₹ per litre
    oil              NUMERIC(10,3) NOT NULL, -- ₹ per litre — 2T oil sold through the machine/nozzle
    oil_packet       NUMERIC(10,3) NOT NULL, -- ₹ per piece — 2T oil sold by the packet
    oil_cane         NUMERIC(10,3) NOT NULL, -- ₹ per piece — Servo oil sold by the can
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No screen creates these today — seed directly, e.g. via a setup script.
CREATE TABLE users (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT NOT NULL,
    email            TEXT NOT NULL UNIQUE,
    password_hash    TEXT NOT NULL,
    role             TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'manager', 'staff')),
    active           BOOLEAN NOT NULL DEFAULT true,
    last_login_at    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 2. EMPLOYEES
-- =============================================================================

CREATE TABLE employees (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    father_name   TEXT,
    role          TEXT,
    phone         TEXT,
    join_date     DATE NOT NULL,
    active        BOOLEAN NOT NULL DEFAULT true,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pay in force on any date = latest row with effective_from <= that date.
CREATE TABLE employee_salary_history (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    amount           NUMERIC(10,2) NOT NULL, -- ₹ per month
    effective_from   DATE NOT NULL,
    UNIQUE (employee_id, effective_from)
);
CREATE INDEX idx_salary_history_employee ON employee_salary_history(employee_id, effective_from);

-- =============================================================================
-- 3. ATTENDANCE
-- =============================================================================

CREATE TABLE attendance_records (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date          DATE NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('one_shift', 'double_shift', 'absent', 'leave', 'duty_off')),
    start_time    TIME, -- only set for one_shift / double_shift
    UNIQUE (employee_id, date)
);
CREATE INDEX idx_attendance_employee_date ON attendance_records(employee_id, date);

-- =============================================================================
-- 4. LUBRICANTS
-- =============================================================================

CREATE TABLE lubricant_products (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    unit          TEXT NOT NULL DEFAULT 'Pcs',
    packaging     TEXT NOT NULL CHECK (packaging IN ('packet', 'cane')),
    stock         INT NOT NULL DEFAULT 0, -- current on-hand count
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sale rate in force on any date = latest row with effective_from <= that date.
CREATE TABLE lubricant_price_history (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id       UUID NOT NULL REFERENCES lubricant_products(id) ON DELETE CASCADE,
    rate             NUMERIC(10,2) NOT NULL,
    effective_from   DATE NOT NULL,
    UNIQUE (product_id, effective_from)
);
CREATE INDEX idx_lubricant_price_history_product ON lubricant_price_history(product_id, effective_from);

-- Every restock — acquisition cost, separate from the sale rate above.
CREATE TABLE lubricant_purchase_history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id    UUID NOT NULL REFERENCES lubricant_products(id) ON DELETE CASCADE,
    date          DATE NOT NULL,
    qty           INT NOT NULL,
    cost          NUMERIC(10,2) NOT NULL -- ₹ paid per unit
);
CREATE INDEX idx_lubricant_purchase_history_product ON lubricant_purchase_history(product_id, date);

-- =============================================================================
-- 5. CREDIT CUSTOMERS
-- =============================================================================

CREATE TABLE credit_customers (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name               TEXT NOT NULL,
    phone              TEXT,
    opening_balance    NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 6. FUEL ENTRY — the core transactional table set
--    One row in fuel_entries = one employee, one pump, one shift, one day.
-- =============================================================================

CREATE TABLE fuel_entries (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date              DATE NOT NULL,
    pump_key          TEXT NOT NULL CHECK (pump_key IN ('pump1', 'pump2')),
    shift_number      SMALLINT NOT NULL CHECK (shift_number IN (1, 2, 3)),
    internal_only     BOOLEAN NOT NULL DEFAULT false, -- true only for shift 3; excluded from attendance
    employee_id       UUID REFERENCES employees(id) ON DELETE SET NULL,
    status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
    cane_oil_offer    NUMERIC(10,2) NOT NULL DEFAULT 0, -- flat discount on cane/Servo-oil rows
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (date, pump_key, shift_number)
);
CREATE INDEX idx_fuel_entries_date ON fuel_entries(date);
CREATE INDEX idx_fuel_entries_pump_date ON fuel_entries(pump_key, date);
CREATE INDEX idx_fuel_entries_employee ON fuel_entries(employee_id);

-- Up to 6 rows per entry: {petrol,diesel,oil} x {nozzle1,nozzle2}. oil only
-- applies to pump2 — enforce that in application code or a CHECK trigger.
CREATE TABLE fuel_readings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fuel_entry_id    UUID NOT NULL REFERENCES fuel_entries(id) ON DELETE CASCADE,
    fuel_type        TEXT NOT NULL CHECK (fuel_type IN ('petrol', 'diesel', 'oil')),
    nozzle           TEXT NOT NULL CHECK (nozzle IN ('nozzle1', 'nozzle2')),
    opening          NUMERIC(12,3) NOT NULL DEFAULT 0, -- carried from the previous shift's closing
    closing          NUMERIC(12,3) NOT NULL DEFAULT 0,
    testing          NUMERIC(10,3) NOT NULL DEFAULT 0, -- litres pulled for a test, not sold
    rate             NUMERIC(10,3) NOT NULL DEFAULT 0, -- ₹/L snapshot at save time
    UNIQUE (fuel_entry_id, fuel_type, nozzle)
);
CREATE INDEX idx_fuel_readings_entry ON fuel_readings(fuel_entry_id);

-- Pump 2 only — sachet/can oil sold by count, not through a nozzle.
CREATE TABLE fuel_entry_oil_rows (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fuel_entry_id    UUID NOT NULL REFERENCES fuel_entries(id) ON DELETE CASCADE,
    row_type         TEXT NOT NULL CHECK (row_type IN ('pocket', 'cane')),
    product_id       UUID REFERENCES lubricant_products(id) ON DELETE SET NULL,
    stock_count      INT NOT NULL DEFAULT 0,
    stock_rate       NUMERIC(10,2) NOT NULL DEFAULT 0 -- snapshotted at sale time
);
CREATE INDEX idx_fuel_entry_oil_rows_entry ON fuel_entry_oil_rows(fuel_entry_id);
CREATE INDEX idx_fuel_entry_oil_rows_product ON fuel_entry_oil_rows(product_id);

-- How the shift's takings were collected: cash, card, QR, a customer credit,
-- or an advance against an employee's pay.
CREATE TABLE payment_lines (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fuel_entry_id    UUID NOT NULL REFERENCES fuel_entries(id) ON DELETE CASCADE,
    label            TEXT NOT NULL, -- "Cash", "Card (Petrol)", "QR (Diesel)", ...
    amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
    type             TEXT NOT NULL DEFAULT 'cash' CHECK (type IN ('cash', 'credit', 'employee_credit')),
    customer_id      UUID REFERENCES credit_customers(id) ON DELETE SET NULL, -- set when type = credit
    employee_id      UUID REFERENCES employees(id) ON DELETE SET NULL,        -- set when type = employee_credit
    note             TEXT
);
CREATE INDEX idx_payment_lines_entry ON payment_lines(fuel_entry_id);
CREATE INDEX idx_payment_lines_customer ON payment_lines(customer_id);
CREATE INDEX idx_payment_lines_employee ON payment_lines(employee_id);

-- Photo/scan attachments — at least one required before an entry can go final.
CREATE TABLE fuel_entry_bills (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fuel_entry_id    UUID NOT NULL REFERENCES fuel_entries(id) ON DELETE CASCADE,
    file_name        TEXT NOT NULL,
    file_url         TEXT NOT NULL, -- object-storage URL, not a base64 blob
    uploaded_date    DATE NOT NULL DEFAULT CURRENT_DATE
);
CREATE INDEX idx_fuel_entry_bills_entry ON fuel_entry_bills(fuel_entry_id);

-- =============================================================================
-- 7. DOWNSTREAM EFFECTS OF A FINAL FUEL ENTRY
--    (created after fuel_entries so source_fuel_entry_id can resolve)
-- =============================================================================

-- Advance taken by an employee at the pump, owed back against future pay.
CREATE TABLE employee_credits (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id            UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date                   DATE NOT NULL,
    amount                 NUMERIC(10,2) NOT NULL,
    note                   TEXT,
    source_fuel_entry_id   UUID REFERENCES fuel_entries(id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_employee_credits_employee ON employee_credits(employee_id, date);

-- Closing balance for a customer = opening_balance + SUM(credit) - SUM(payment).
CREATE TABLE credit_ledger_entries (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id            UUID NOT NULL REFERENCES credit_customers(id) ON DELETE CASCADE,
    date                   DATE NOT NULL,
    type                   TEXT NOT NULL CHECK (type IN ('credit', 'payment')),
    fuel_type              TEXT CHECK (fuel_type IN ('petrol', 'diesel', 'oil')), -- set for a credit row
    litres                 NUMERIC(10,3),                                        -- set for a credit row
    rate                   NUMERIC(10,3),                                        -- set for a credit row
    amount                 NUMERIC(12,2) NOT NULL,
    mode                   TEXT,                                                 -- set for a payment row
    note                   TEXT,
    source_fuel_entry_id   UUID REFERENCES fuel_entries(id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_credit_ledger_entries_customer ON credit_ledger_entries(customer_id, date);

-- =============================================================================
-- 8. EXPENSES
-- =============================================================================

CREATE TABLE expense_days (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date          DATE NOT NULL UNIQUE
);

CREATE TABLE expense_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_day_id    UUID NOT NULL REFERENCES expense_days(id) ON DELETE CASCADE,
    label             TEXT NOT NULL, -- free-typed: "Tea", "Cleaning", "Delivery boy"
    amount            NUMERIC(10,2) NOT NULL
);
CREATE INDEX idx_expense_items_day ON expense_items(expense_day_id);

-- =============================================================================
-- 9. OFFERS
--    The recipient list is credit_customers, reused as-is — these two tables
--    only record the send event itself, so "Recently Sent" survives a
--    refresh instead of living in React state.
-- =============================================================================

CREATE TABLE offer_sends (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message       TEXT NOT NULL,
    sent_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE offer_send_recipients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_send_id   UUID NOT NULL REFERENCES offer_sends(id) ON DELETE CASCADE,
    customer_id     UUID NOT NULL REFERENCES credit_customers(id) ON DELETE CASCADE,
    UNIQUE (offer_send_id, customer_id)
);
CREATE INDEX idx_offer_send_recipients_send ON offer_send_recipients(offer_send_id);
CREATE INDEX idx_offer_send_recipients_customer ON offer_send_recipients(customer_id);

-- =============================================================================
-- End of schema — 20 tables total, single-station.
-- Dashboard and Salary have no tables of their own: both are computed at
-- query time from the tables above (fuel_entries + commission_rate_history +
-- expense_days for Dashboard, priced day-by-day at whichever commission_rate_
-- history row was in force that day; employee_salary_history +
-- attendance_records + employee_credits for Salary).
-- =============================================================================
