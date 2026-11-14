-- B9 / CANDIDATE ONLY / TEST PREPARATION / NEVER APPLY AUTOMATICALLY.
-- Separate NEW native Finance and Capital from immutable LEGACY_GOOGLE history.
-- Shared Clean TEST and PROD MUST NOT receive this SQL without source readback,
-- backup, isolated rehearsal, owner mapping, accepted cutover date and release.
-- PostgreSQL 16. Intended initial deployment creates an EMPTY, BLOCKED schema.
CREATE SCHEMA IF NOT EXISTS mvp_finance_native;

CREATE TABLE IF NOT EXISTS mvp_finance_native.cutover_control (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  phase text NOT NULL DEFAULT 'BLOCKED' CHECK(phase IN ('BLOCKED','ACTIVE','PAUSED')),
  financial_write_authority text NOT NULL DEFAULT 'GOOGLE'
    CHECK(financial_write_authority IN ('GOOGLE','POSTGRES')),
  cutover_date_key date,
  snapshot_id text CHECK(snapshot_id IS NULL OR length(snapshot_id) BETWEEN 8 AND 160),
  manifest_sha256 text CHECK(manifest_sha256 IS NULL OR manifest_sha256 ~ '^[0-9a-f]{64}$'),
  crm_bridge_sha256 text CHECK(crm_bridge_sha256 IS NULL OR crm_bridge_sha256 ~ '^[0-9a-f]{64}$'),
  owner_identity_approved boolean NOT NULL DEFAULT false,
  google_frozen_confirmed boolean NOT NULL DEFAULT false,
  expected_fund_count integer NOT NULL DEFAULT 8 CHECK(expected_fund_count BETWEEN 1 AND 50),
  activated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mvp_native_authority_phase CHECK (
    (phase='BLOCKED' AND financial_write_authority='GOOGLE') OR
    (phase IN ('ACTIVE','PAUSED') AND financial_write_authority='POSTGRES')
  )
);
INSERT INTO mvp_finance_native.cutover_control(id) VALUES (1) ON CONFLICT DO NOTHING;

-- Opening values are a balance bridge, not transactions, income or profit.
CREATE TABLE IF NOT EXISTS mvp_finance_native.opening_snapshot (
  id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),
  source_snapshot_id text NOT NULL CHECK(length(source_snapshot_id) BETWEEN 8 AND 160),
  manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
  as_of_date date NOT NULL,
  opening_cash_base numeric(24,6) NOT NULL,
  opening_profit_base numeric(24,6) NOT NULL,
  opening_worker_payable_base numeric(24,6) NOT NULL CHECK(opening_worker_payable_base>=0),
  opening_note text NOT NULL DEFAULT '' CHECK(length(opening_note)<=1500),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mvp_finance_native.funds (
  fund_id uuid PRIMARY KEY,
  legacy_source_id text NOT NULL UNIQUE CHECK(length(legacy_source_id) BETWEEN 3 AND 128),
  code text NOT NULL UNIQUE CHECK(length(code) BETWEEN 2 AND 100),
  group_type text NOT NULL CHECK(group_type IN ('PROTECTIVE','GROWTH')),
  status text NOT NULL CHECK(status IN ('active','paused','archived')),
  target_amount_base numeric(24,6) NOT NULL DEFAULT 0 CHECK(target_amount_base>=0),
  allocation_share_pct numeric(9,6) NOT NULL DEFAULT 0 CHECK(allocation_share_pct BETWEEN 0 AND 100)
);
CREATE TABLE IF NOT EXISTS mvp_finance_native.fund_openings (
  fund_id uuid PRIMARY KEY REFERENCES mvp_finance_native.funds(fund_id) ON DELETE RESTRICT,
  legacy_balance_source_id text NOT NULL UNIQUE
    CHECK(length(legacy_balance_source_id) BETWEEN 3 AND 128),
  source_snapshot_id text NOT NULL CHECK(length(source_snapshot_id) BETWEEN 8 AND 160),
  opening_balance_base numeric(24,6) NOT NULL CHECK(opening_balance_base>=0),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- Native finance uses actual CRM UUID foreign keys; legacy text IDs are never
-- implicitly converted or matched by customer name/phone.
CREATE TABLE IF NOT EXISTS mvp_finance_native.transactions (
  finance_transaction_id uuid PRIMARY KEY,
  request_key uuid NOT NULL UNIQUE,
  source_system text NOT NULL DEFAULT 'CLEAN_NATIVE_FINANCE'
    CHECK(source_system='CLEAN_NATIVE_FINANCE'),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
  transaction_date_key date NOT NULL,
  operation_type text NOT NULL CHECK(operation_type IN (
    'INCOME','EXPENSE','WORKER_ACCRUAL','WORKER_PAYMENT',
    'WORKER_ACCRUAL_PAYMENT','OWNER_TRANSFER')),
  client_id uuid REFERENCES public.mvp_clients(id) ON DELETE RESTRICT,
  object_id uuid REFERENCES public.mvp_objects(id) ON DELETE RESTRICT,
  work_order_id uuid REFERENCES public.mvp_orders(id) ON DELETE RESTRICT,
  worker_id uuid REFERENCES public.mvp_workers(id) ON DELETE RESTRICT,
  amount_base numeric(24,6) NOT NULL CHECK(amount_base>0),
  commission_base numeric(24,6) NOT NULL DEFAULT 0 CHECK(commission_base>=0),
  cash_effect_base numeric(24,6) NOT NULL,
  profit_effect_base numeric(24,6) NOT NULL,
  worker_payable_effect_base numeric(24,6) NOT NULL,
  normalized jsonb NOT NULL CHECK(jsonb_typeof(normalized)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE TABLE IF NOT EXISTS mvp_finance_native.fincap_batches (
  batch_id uuid PRIMARY KEY,
  finance_transaction_id uuid NOT NULL UNIQUE
    REFERENCES mvp_finance_native.transactions(finance_transaction_id) ON DELETE RESTRICT,
  client_request_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'applied' CHECK(status='applied'),
  source_type text NOT NULL DEFAULT 'OPERATING_PROFIT' CHECK(source_type='OPERATING_PROFIT'),
  total_amount_base numeric(24,6) NOT NULL CHECK(total_amount_base>0),
  transaction_date_key date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fincap_deterministic_key CHECK(
    client_request_id='FINCAP|' || finance_transaction_id::text)
);
CREATE TABLE IF NOT EXISTS mvp_finance_native.fund_movements (
  movement_id uuid PRIMARY KEY,
  request_key uuid NOT NULL,
  movement_type text NOT NULL
    CHECK(movement_type IN ('ALLOCATION','TRANSFER','SPEND','REVERSAL')),
  transaction_date_key date NOT NULL,
  from_fund_id uuid REFERENCES mvp_finance_native.funds(fund_id) ON DELETE RESTRICT,
  to_fund_id uuid REFERENCES mvp_finance_native.funds(fund_id) ON DELETE RESTRICT,
  allocation_batch_id uuid
    REFERENCES mvp_finance_native.fincap_batches(batch_id) ON DELETE RESTRICT,
  reversal_of uuid UNIQUE
    REFERENCES mvp_finance_native.fund_movements(movement_id) ON DELETE RESTRICT,
  amount_base numeric(24,6) NOT NULL CHECK(amount_base>0),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','reversed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT native_movement_shape CHECK (
    (movement_type='ALLOCATION' AND from_fund_id IS NULL AND to_fund_id IS NOT NULL
      AND allocation_batch_id IS NOT NULL AND reversal_of IS NULL) OR
    (movement_type='TRANSFER' AND from_fund_id IS NOT NULL AND to_fund_id IS NOT NULL
      AND from_fund_id<>to_fund_id AND allocation_batch_id IS NULL AND reversal_of IS NULL) OR
    (movement_type='SPEND' AND from_fund_id IS NOT NULL AND to_fund_id IS NULL
      AND allocation_batch_id IS NULL AND reversal_of IS NULL) OR
    (movement_type='REVERSAL' AND reversal_of IS NOT NULL AND allocation_batch_id IS NULL)
  )
);
-- Materialized effects remain append-only; current funds are opening+effects.
CREATE TABLE IF NOT EXISTS mvp_finance_native.fund_effects (
  movement_id uuid NOT NULL
    REFERENCES mvp_finance_native.fund_movements(movement_id) ON DELETE RESTRICT,
  fund_id uuid NOT NULL REFERENCES mvp_finance_native.funds(fund_id) ON DELETE RESTRICT,
  balance_delta_base numeric(24,6) NOT NULL CHECK(balance_delta_base<>0),
  PRIMARY KEY(movement_id,fund_id)
);
CREATE TABLE IF NOT EXISTS mvp_finance_native.request_receipts (
  request_key uuid PRIMARY KEY,
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  action text NOT NULL CHECK(length(action) BETWEEN 3 AND 100),
  response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mvp_finance_native.audit_events (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_key uuid NOT NULL,
  event_type text NOT NULL CHECK(length(event_type) BETWEEN 3 AND 100),
  source_kind text NOT NULL,
  source_id text NOT NULL,
  details jsonb NOT NULL CHECK(jsonb_typeof(details)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS native_finance_tx_date_idx
 ON mvp_finance_native.transactions(transaction_date_key,status);
CREATE INDEX IF NOT EXISTS native_capital_fund_effect_idx
 ON mvp_finance_native.fund_effects(fund_id);

-- Never activate on a partial or unapproved opening: this checks structural
-- proof, NOT the authenticity of a real Google export or owner signature.
CREATE OR REPLACE FUNCTION mvp_finance_native.validate_cutover() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE opening mvp_finance_native.opening_snapshot%ROWTYPE;
        n_funds integer; n_openings integer;
BEGIN
 IF TG_OP='UPDATE' AND OLD.phase IN ('ACTIVE','PAUSED') AND NEW.phase='BLOCKED' THEN
   RAISE EXCEPTION 'FINANCE_B9_CANNOT_REVERT_AUTHORITY_TO_GOOGLE';
 END IF;
 IF NEW.phase='ACTIVE' THEN
   IF NEW.financial_write_authority<>'POSTGRES' OR
      NEW.cutover_date_key IS NULL OR NOT NEW.owner_identity_approved OR
      NOT NEW.google_frozen_confirmed OR NEW.snapshot_id IS NULL OR
      NEW.manifest_sha256 IS NULL OR NEW.crm_bridge_sha256 IS NULL THEN
     RAISE EXCEPTION 'FINANCE_B9_ACTIVATION_APPROVAL_REQUIRED';
   END IF;
   SELECT * INTO opening FROM mvp_finance_native.opening_snapshot WHERE id=1;
   IF NOT FOUND OR opening.source_snapshot_id<>NEW.snapshot_id OR
      opening.manifest_sha256<>NEW.manifest_sha256 OR
      opening.as_of_date<>NEW.cutover_date_key-1 THEN
     RAISE EXCEPTION 'FINANCE_B9_OPENING_RECONCILIATION_REQUIRED';
   END IF;
   SELECT count(*) INTO n_funds FROM mvp_finance_native.funds;
   SELECT count(*) INTO n_openings FROM mvp_finance_native.fund_openings fo
      JOIN mvp_finance_native.funds f ON f.fund_id=fo.fund_id
      WHERE fo.source_snapshot_id=NEW.snapshot_id;
   IF n_funds<>NEW.expected_fund_count OR n_openings<>NEW.expected_fund_count THEN
     RAISE EXCEPTION 'FINANCE_B9_FUND_OPENINGS_INCOMPLETE';
   END IF;
   IF NEW.activated_at IS NULL THEN NEW.activated_at=now(); END IF;
 END IF;
 NEW.updated_at=now();
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION mvp_finance_native.assert_writer_gate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE g mvp_finance_native.cutover_control%ROWTYPE;
BEGIN
 SELECT * INTO g FROM mvp_finance_native.cutover_control WHERE id=1;
 IF NOT FOUND OR g.phase<>'ACTIVE' OR g.financial_write_authority<>'POSTGRES' THEN
   RAISE EXCEPTION 'FINANCE_B9_NATIVE_WRITER_GATE_CLOSED';
 END IF;
 -- fund_effects has no date column; do not access NEW.transaction_date_key
 -- until the trigger is known to be running against a dated ledger table.
 IF TG_TABLE_NAME IN ('transactions','fund_movements') THEN
   IF NEW.transaction_date_key<g.cutover_date_key THEN
     RAISE EXCEPTION 'FINANCE_B9_BEFORE_CUTOVER_DATE';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION mvp_finance_native.protect_opening() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT phase FROM mvp_finance_native.cutover_control WHERE id=1)<>'BLOCKED' THEN
   RAISE EXCEPTION 'FINANCE_B9_OPENING_IMMUTABLE_AFTER_ACTIVATION';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION mvp_finance_native.protect_fund_effect() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE balance_now numeric(24,6);
BEGIN
 -- Lock the fund row before reading sum; serializes concurrent spends.
 PERFORM 1 FROM mvp_finance_native.funds WHERE fund_id=NEW.fund_id FOR UPDATE;
 SELECT fo.opening_balance_base+COALESCE(sum(e.balance_delta_base),0)
   INTO balance_now FROM mvp_finance_native.fund_openings fo
     LEFT JOIN mvp_finance_native.fund_effects e ON e.fund_id=fo.fund_id
   WHERE fo.fund_id=NEW.fund_id GROUP BY fo.opening_balance_base;
 IF balance_now IS NULL THEN
   RAISE EXCEPTION 'FINANCE_B9_FUND_OPENING_NOT_FOUND';
 END IF;
 IF balance_now+NEW.balance_delta_base<0 THEN
   RAISE EXCEPTION 'FINANCE_B9_INSUFFICIENT_FUND_BALANCE';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION mvp_finance_native.deny_effect_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FINANCE_B9_EFFECTS_APPEND_ONLY'; END $$;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='b9_validate_cutover'
   AND tgrelid='mvp_finance_native.cutover_control'::regclass) THEN
  CREATE TRIGGER b9_validate_cutover BEFORE UPDATE ON mvp_finance_native.cutover_control
   FOR EACH ROW EXECUTE FUNCTION mvp_finance_native.validate_cutover();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='b9_opening_immutable'
   AND tgrelid='mvp_finance_native.opening_snapshot'::regclass) THEN
  CREATE TRIGGER b9_opening_immutable BEFORE INSERT OR UPDATE OR DELETE
   ON mvp_finance_native.opening_snapshot FOR EACH ROW
   EXECUTE FUNCTION mvp_finance_native.protect_opening();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='b9_fund_opening_immutable'
   AND tgrelid='mvp_finance_native.fund_openings'::regclass) THEN
  CREATE TRIGGER b9_fund_opening_immutable BEFORE INSERT OR UPDATE OR DELETE
   ON mvp_finance_native.fund_openings FOR EACH ROW
   EXECUTE FUNCTION mvp_finance_native.protect_opening();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='b9_transactions_gate'
   AND tgrelid='mvp_finance_native.transactions'::regclass) THEN
  CREATE TRIGGER b9_transactions_gate BEFORE INSERT OR UPDATE
   ON mvp_finance_native.transactions FOR EACH ROW
   EXECUTE FUNCTION mvp_finance_native.assert_writer_gate();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='b9_movement_gate'
   AND tgrelid='mvp_finance_native.fund_movements'::regclass) THEN
  CREATE TRIGGER b9_movement_gate BEFORE INSERT OR UPDATE
   ON mvp_finance_native.fund_movements FOR EACH ROW
   EXECUTE FUNCTION mvp_finance_native.assert_writer_gate();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='b9_effect_gate'
   AND tgrelid='mvp_finance_native.fund_effects'::regclass) THEN
  CREATE TRIGGER b9_effect_gate BEFORE INSERT ON mvp_finance_native.fund_effects
   FOR EACH ROW EXECUTE FUNCTION mvp_finance_native.assert_writer_gate();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='b9_effect_nonnegative'
   AND tgrelid='mvp_finance_native.fund_effects'::regclass) THEN
  CREATE TRIGGER b9_effect_nonnegative BEFORE INSERT ON mvp_finance_native.fund_effects
   FOR EACH ROW EXECUTE FUNCTION mvp_finance_native.protect_fund_effect();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='b9_effect_append_only'
   AND tgrelid='mvp_finance_native.fund_effects'::regclass) THEN
  CREATE TRIGGER b9_effect_append_only BEFORE UPDATE OR DELETE
   ON mvp_finance_native.fund_effects FOR EACH ROW
   EXECUTE FUNCTION mvp_finance_native.deny_effect_mutation();
 END IF;
END $$;

-- Keep separate source-provenance columns. NEVER UNION opening balances with
-- historic FinanceTransactions as if opening balance were new business income.
CREATE OR REPLACE VIEW mvp_finance_native.v_cash_ledger AS
 SELECT o.source_snapshot_id,o.opening_cash_base,
   COALESCE(sum(CASE WHEN t.status='active' THEN t.cash_effect_base ELSE 0 END),0)::numeric(24,6)
    AS native_cash_delta_base,
   (o.opening_cash_base+
     COALESCE(sum(CASE WHEN t.status='active' THEN t.cash_effect_base ELSE 0 END),0))::numeric(24,6)
    AS current_cash_balance_base,
   o.opening_profit_base,
   COALESCE(sum(CASE WHEN t.status='active' THEN t.profit_effect_base ELSE 0 END),0)::numeric(24,6)
    AS native_profit_delta_base,
   o.opening_worker_payable_base,
   COALESCE(sum(CASE WHEN t.status='active' THEN t.worker_payable_effect_base ELSE 0 END),0)::numeric(24,6)
    AS native_worker_payable_delta_base
 FROM mvp_finance_native.opening_snapshot o
 LEFT JOIN mvp_finance_native.transactions t ON true
 GROUP BY o.source_snapshot_id,o.opening_cash_base,o.opening_profit_base,
   o.opening_worker_payable_base;

CREATE OR REPLACE VIEW mvp_finance_native.v_fund_balances AS
 SELECT f.fund_id,f.legacy_source_id,f.code,f.status,
  fo.source_snapshot_id,fo.opening_balance_base,
  COALESCE(sum(e.balance_delta_base),0)::numeric(24,6) AS native_delta_base,
  (fo.opening_balance_base+COALESCE(sum(e.balance_delta_base),0))::numeric(24,6)
    AS current_balance_base
 FROM mvp_finance_native.funds f
 JOIN mvp_finance_native.fund_openings fo ON fo.fund_id=f.fund_id
 LEFT JOIN mvp_finance_native.fund_effects e ON e.fund_id=f.fund_id
 GROUP BY f.fund_id,f.legacy_source_id,f.code,f.status,
   fo.source_snapshot_id,fo.opening_balance_base;

REVOKE ALL ON SCHEMA mvp_finance_native FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA mvp_finance_native FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mvp_finance_native FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mvp_finance_native FROM PUBLIC;
