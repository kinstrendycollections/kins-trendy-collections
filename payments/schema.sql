-- Reference copy only. The Worker creates these tables by itself on first use
-- (see ensureSchema in src/worker.js), so you do NOT need to run this.

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  mpesa_phone TEXT NOT NULL,
  county TEXT NOT NULL,
  area TEXT NOT NULL,
  address TEXT NOT NULL,
  notes TEXT,
  payment_method TEXT NOT NULL,          -- mpesa | cod
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER,                  -- NULL until the owner quotes it
  status TEXT NOT NULL DEFAULT 'new',    -- new | confirmed | delivered | cancelled
  payment_status TEXT NOT NULL,          -- unpaid | pending | paid | failed | review | cod | cod_paid
  mpesa_receipt TEXT,
  paid_amount INTEGER,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  unit_price INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  size TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  checkout_request_id TEXT NOT NULL UNIQUE,
  merchant_request_id TEXT,
  amount INTEGER NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | success | failed
  result_code INTEGER,
  result_desc TEXT,
  receipt TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  queried_at TEXT
);
