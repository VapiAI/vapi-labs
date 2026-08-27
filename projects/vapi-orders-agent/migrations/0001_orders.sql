CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_code TEXT NOT NULL UNIQUE,
  call_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  items_json TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  status TEXT NOT NULL CHECK (status IN ('confirmed')),
  created_at TEXT NOT NULL,
  UNIQUE (call_id, request_hash)
);

CREATE INDEX orders_call_id_idx ON orders (call_id);
