-- FINANCE_NATIVE_SYNTHETIC_POSTING_PILOT_V1: isolated database ONLY.
-- Never apply to public / shared Clean TEST / Google / PROD.
-- Production schemas and historical finance authority remain untouched.
CREATE SCHEMA IF NOT EXISTS finance_pilot;
CREATE TABLE IF NOT EXISTS finance_pilot.clients(
  id text PRIMARY KEY, status text NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS finance_pilot.objects(
  id text PRIMARY KEY, client_id text NOT NULL REFERENCES finance_pilot.clients(id),
  status text NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS finance_pilot.orders(
  id text PRIMARY KEY, object_id text NOT NULL REFERENCES finance_pilot.objects(id),
  client_id text NOT NULL REFERENCES finance_pilot.clients(id), status text NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS finance_pilot.workers(
  id text PRIMARY KEY, status text NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS finance_pilot.transactions(
  id uuid PRIMARY KEY, request_key uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK(status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
  normalized jsonb NOT NULL,
  cash_base numeric(24,6) NOT NULL, profit_base numeric(24,6) NOT NULL,
  worker_payable_base numeric(24,6) NOT NULL, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS finance_pilot.funds(
  id text PRIMARY KEY, code text NOT NULL UNIQUE,
  group_type text NOT NULL CHECK(group_type IN ('PROTECTIVE','GROWTH')),
  status text NOT NULL CHECK(status IN ('active','paused','archived')),
  target_amount_base numeric(24,6) NOT NULL DEFAULT 0,
  allocation_share_pct numeric(9,6) NOT NULL DEFAULT 0,
  balance_base numeric(24,6) NOT NULL DEFAULT 0 CHECK(balance_base>=0),
  allocated_base numeric(24,6) NOT NULL DEFAULT 0 CHECK(allocated_base>=0),
  transferred_in_base numeric(24,6) NOT NULL DEFAULT 0 CHECK(transferred_in_base>=0),
  transferred_out_base numeric(24,6) NOT NULL DEFAULT 0 CHECK(transferred_out_base>=0),
  spent_base numeric(24,6) NOT NULL DEFAULT 0 CHECK(spent_base>=0),
  transaction_count integer NOT NULL DEFAULT 0 CHECK(transaction_count>=0)
);
CREATE TABLE IF NOT EXISTS finance_pilot.allocation_batches(
  id uuid PRIMARY KEY,
  finance_transaction_id uuid NOT NULL UNIQUE REFERENCES finance_pilot.transactions(id),
  client_request_id text NOT NULL UNIQUE CHECK(client_request_id LIKE 'FINCAP|%'),
  status text NOT NULL CHECK(status='applied'),
  source_type text NOT NULL CHECK(source_type='OPERATING_PROFIT'),
  transaction_date_key date NOT NULL,
  total_amount_base numeric(24,6) NOT NULL CHECK(total_amount_base>0),
  allocations jsonb NOT NULL CHECK(jsonb_typeof(allocations)='array'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS finance_pilot.fund_movements(
  id uuid PRIMARY KEY, request_key uuid NOT NULL,
  movement_type text NOT NULL CHECK(movement_type IN ('ALLOCATION','TRANSFER','SPEND','REVERSAL')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','reversed')),
  from_fund_id text REFERENCES finance_pilot.funds(id),
  to_fund_id text REFERENCES finance_pilot.funds(id),
  amount_base numeric(24,6) NOT NULL,
  reversal_of uuid REFERENCES finance_pilot.fund_movements(id),
  batch_id uuid REFERENCES finance_pilot.allocation_batches(id),
  line_request_key text UNIQUE,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS finance_pilot.receipts(
  request_key uuid PRIMARY KEY,
  payload_sha256 char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS finance_pilot.audit(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_key uuid NOT NULL,
  action text NOT NULL,
  before_snapshot jsonb, after_snapshot jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_pilot_transactions_status_idx
  ON finance_pilot.transactions(status);
CREATE INDEX IF NOT EXISTS finance_pilot_fund_movements_request_idx
  ON finance_pilot.fund_movements(request_key);
REVOKE ALL ON SCHEMA finance_pilot FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA finance_pilot FROM PUBLIC;
