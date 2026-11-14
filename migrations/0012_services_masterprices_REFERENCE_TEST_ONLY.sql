-- VBOS Clean V12 TEST-CANDIDATE ONLY. Never apply directly to Google/PROD, and never
-- execute on canonical Clean Neon without separately approved backup/import gate.
-- Shadow/snapshot reference, NOT price authority and NOT payroll.
CREATE TABLE IF NOT EXISTS public.mvp_service_reference_batches(
 batch_id text PRIMARY KEY CHECK (batch_id ~ '^[A-Za-z0-9_:-]{8,160}$'),
 source_system text NOT NULL CHECK(source_system='LEGACY_GOOGLE_VBOS'),
 source_modified_at timestamptz NOT NULL,
 services_count integer NOT NULL CHECK(services_count BETWEEN 1 AND 100000),
 prices_count integer NOT NULL CHECK(prices_count BETWEEN 0 AND 100000),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
 verified_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'VERIFIED' CHECK(status='VERIFIED')
);
CREATE TABLE IF NOT EXISTS public.mvp_services_reference(
 batch_id text NOT NULL REFERENCES public.mvp_service_reference_batches(batch_id) ON DELETE RESTRICT,
 service_id text NOT NULL CHECK(service_id ~ '^[A-Za-z0-9_-]{3,128}$'),
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 status text NOT NULL CHECK(length(status) BETWEEN 1 AND 32),
 category text NOT NULL CHECK(length(category) BETWEEN 1 AND 180),
 service_name text NOT NULL CHECK(length(service_name) BETWEEN 1 AND 180),
 default_unit text NOT NULL CHECK(length(default_unit) BETWEEN 1 AND 50),
 notes text NOT NULL DEFAULT '',
 client_request_id text,
 action_code text CHECK(action_code IS NULL OR action_code IN ('MOUNT','INSTALL','DISMANTLE','CONNECT','REPAIR','DIAGNOSE','PREPARE','CLEANUP','LOGISTICS','OTHER')),
 PRIMARY KEY(batch_id,service_id)
);
CREATE TABLE IF NOT EXISTS public.mvp_master_prices_reference(
 batch_id text NOT NULL REFERENCES public.mvp_service_reference_batches(batch_id) ON DELETE RESTRICT,
 master_price_id text NOT NULL CHECK(master_price_id ~ '^[A-Za-z0-9_-]{3,128}$'),
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 status text NOT NULL CHECK(length(status) BETWEEN 1 AND 32),
 master_id text NOT NULL CHECK(master_id ~ '^[A-Za-z0-9_-]{3,128}$'),
 service_id text NOT NULL,
 price_type text NOT NULL CHECK(length(price_type) BETWEEN 1 AND 40),
 price_from numeric(20,4) NOT NULL CHECK(price_from >= 0),
 price_to numeric(20,4) CHECK(price_to IS NULL OR price_to>=price_from),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 50),
 valid_from date,
 notes text NOT NULL DEFAULT '',
 client_request_id text,
 PRIMARY KEY(batch_id,master_price_id),
 FOREIGN KEY(batch_id,service_id) REFERENCES public.mvp_services_reference(batch_id,service_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS mvp_service_reference_category_idx ON public.mvp_services_reference(batch_id,status,category,service_id);
CREATE INDEX IF NOT EXISTS mvp_master_price_reference_service_idx ON public.mvp_master_prices_reference(batch_id,service_id,status);
-- Snapshots are append-only: later updates require a *new* verified batch.
CREATE OR REPLACE FUNCTION public.mvp_reference_snapshot_immutable()
RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
 RAISE EXCEPTION 'VBOS_REFERENCE_SNAPSHOT_IMMUTABLE' USING ERRCODE='55000';
END $guard$;
DO $triggers$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.mvp_service_reference_batches'::regclass AND tgname='mvp_ref_batches_immutable') THEN
  CREATE TRIGGER mvp_ref_batches_immutable BEFORE UPDATE OR DELETE ON public.mvp_service_reference_batches
  FOR EACH ROW EXECUTE FUNCTION public.mvp_reference_snapshot_immutable();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.mvp_services_reference'::regclass AND tgname='mvp_ref_services_immutable') THEN
  CREATE TRIGGER mvp_ref_services_immutable BEFORE UPDATE OR DELETE ON public.mvp_services_reference
  FOR EACH ROW EXECUTE FUNCTION public.mvp_reference_snapshot_immutable();
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.mvp_master_prices_reference'::regclass AND tgname='mvp_ref_prices_immutable') THEN
  CREATE TRIGGER mvp_ref_prices_immutable BEFORE UPDATE OR DELETE ON public.mvp_master_prices_reference
  FOR EACH ROW EXECUTE FUNCTION public.mvp_reference_snapshot_immutable();
 END IF;
END $triggers$;
ALTER TABLE public.mvp_service_reference_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mvp_services_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mvp_master_prices_reference ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mvp_service_reference_batches,public.mvp_services_reference,public.mvp_master_prices_reference FROM PUBLIC;
-- No anon or authenticated policies: owner-side PostgreSQL server role only.
