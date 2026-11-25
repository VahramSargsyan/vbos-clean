-- MS5 versioned promotion CANDIDATE 0039, NOT automatic, NOT yet runtime qualified.
-- Base 525c2d3343b7d9b6252be40cd9606166b5c17dd7. Retains the three CI-tested
-- unnumbered SQL bodies verbatim as source fixtures; do not apply both versions.
-- Requires fresh three-source receipts/counter parity, protected backup and independent
-- restore + isolated exact SQL rehearsal, correct TEST binding and no concurrent lane.
-- If source IDs/fields/receipts or reservations drift, STOP and requalify the candidate.
-- No legacy fence, no CLEAN activation, no existing table data changes.
-- Run as ONE transaction in a dedicated session, stop on any error. Rollback rehearsal
-- substitutes terminal COMMIT with ROLLBACK only; full restore/commit test is separate.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL TIME ZONE 'UTC';
SELECT pg_advisory_xact_lock(39820261125::bigint);
LOCK TABLE public.mvp_crm_masters,public.mvp_service_reference_batches,public.mvp_services_reference,public.mvp_master_prices_reference IN SHARE MODE;
DO $ms5_preflight$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['mvp_masters_services_authority','mvp_services_catalog','mvp_services_catalog_requests','mvp_services_catalog_sequences','mvp_master_prices_catalog','mvp_master_prices_catalog_requests','mvp_master_prices_catalog_sequences','mvp_master_prices_catalog_history']
 LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN RAISE EXCEPTION 'MS5_ALREADY_OR_PARTIALLY_INSTALLED: %',t; END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.mvp_crm_masters)<>5 OR
    (SELECT count(*) FROM public.mvp_crm_masters WHERE source_system='LEGACY_GOOGLE' AND source_master_id IS NOT NULL)<>5 OR
    (SELECT count(DISTINCT source_master_id) FROM public.mvp_crm_masters WHERE source_system='LEGACY_GOOGLE')<>5 THEN
  RAISE EXCEPTION 'MS5_MASTER_SOURCE_DRIFT';
 END IF;
 IF EXISTS (SELECT 1 FROM public.mvp_master_prices_reference WHERE batch_id='SERVICES_MASTERPRICES_V12_TEST_20261105_R1' AND
 ((price_from IS NOT NULL AND price_from<>round(price_from,4)) OR (price_to IS NOT NULL AND price_to<>round(price_to,4)))) THEN
  RAISE EXCEPTION 'MS5_PRICE_PRECISION_LOSS';
 END IF;
END $ms5_preflight$;

-- UNNUMBERED TEST-ONLY CANDIDATE. Not part of schema.sql or automatic migration.
-- Assign release number only after MS2/MS3 dependencies and owner acceptance.
-- Fresh scoped backup / exact TEST qualification / separate activation required.
-- No existing master, price, service, lead, provenance, UUID or relation is modified.
CREATE TABLE public.mvp_masters_services_authority (
 id integer PRIMARY KEY CHECK (id=1),
 phase text NOT NULL DEFAULT 'LEGACY' CHECK (phase IN ('LEGACY','CLEAN')),
 master_snapshot_hash text CHECK(master_snapshot_hash ~ '^[a-f0-9]{64}$'),
 dependency_receipt_hash text CHECK(dependency_receipt_hash ~ '^[a-f0-9]{64}$'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (phase<>'CLEAN' OR (master_snapshot_hash IS NOT NULL AND dependency_receipt_hash IS NOT NULL))
);
INSERT INTO public.mvp_masters_services_authority(id,phase) VALUES(1,'LEGACY');
-- No CLEAN activation statement in this candidate.
-- Before business writes, rollback to previous exact runtime; drop candidate control
-- only after its users are removed and explicit rollback authorization.


-- TEST-only candidate; run atomically in authorized disposable DB, never auto-apply.
-- Depends on MS1 shared control candidate and V12 verified snapshot.
CREATE TABLE public.mvp_services_catalog (
 service_id text PRIMARY KEY CHECK(service_id ~ '^SRV-[0-9]{4}-[0-9]{4,}$'),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL CHECK(status IN ('active','archived')),
 category text NOT NULL CHECK(length(btrim(category)) BETWEEN 1 AND 200),
 service_name text NOT NULL CHECK(length(btrim(service_name)) BETWEEN 1 AND 300),
 default_unit text NOT NULL CHECK(default_unit IN ('job','item','point','meter','square_meter','hour','day','visit','other')),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 action_code text CHECK(action_code IS NULL OR action_code IN ('MOUNT','INSTALL','DISMANTLE','CONNECT','REPAIR','DIAGNOSE','PREPARE','CLEANUP','LOGISTICS','OTHER')),
 client_request_id text,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 source_system text NOT NULL DEFAULT 'CLEAN_NATIVE' CHECK(source_system IN ('LEGACY_GOOGLE_VBOS','CLEAN_NATIVE')),
 source_batch_id text,source_client_request_id text,source_created_at timestamptz,source_updated_at timestamptz,
 FOREIGN KEY(source_batch_id,service_id) REFERENCES public.mvp_services_reference(batch_id,service_id) ON DELETE RESTRICT,
 CHECK ((source_system='LEGACY_GOOGLE_VBOS' AND source_batch_id IS NOT NULL AND source_created_at IS NOT NULL AND source_updated_at IS NOT NULL)
 OR (source_system='CLEAN_NATIVE' AND source_batch_id IS NULL AND source_client_request_id IS NULL AND source_created_at IS NULL AND source_updated_at IS NULL))
);
CREATE INDEX mvp_services_catalog_status_id_idx ON public.mvp_services_catalog(status,service_id);
-- Existing active duplicate names are legitimate historical distinct IDs; retain them.
-- New collisions are blocked by the serialized writer, not a destructive uniqueness migration.
CREATE INDEX mvp_services_catalog_active_name_idx ON public.mvp_services_catalog(lower(regexp_replace(btrim(category),'[[:space:]]+',' ','g')),lower(regexp_replace(btrim(service_name),'[[:space:]]+',' ','g'))) WHERE status='active';
CREATE TABLE public.mvp_services_catalog_requests(request_key uuid PRIMARY KEY,payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),response jsonb NOT NULL);
CREATE TABLE public.mvp_services_catalog_sequences(year integer PRIMARY KEY CHECK(year BETWEEN 2000 AND 9999),last_value bigint NOT NULL CHECK(last_value>=0));
DO $seed$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.mvp_masters_services_authority WHERE id=1 AND phase='LEGACY') THEN RAISE EXCEPTION 'MS2_AUTHORITY_NOT_LEGACY'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mvp_service_reference_batches b WHERE b.batch_id='SERVICES_MASTERPRICES_V12_TEST_20261105_R1' AND b.status='VERIFIED' AND b.source_system='LEGACY_GOOGLE_VBOS' AND b.manifest_sha256='fc85e0e51751b50c689fceaba8d6c273706a25e577e798df3e886deef3a8d674' AND b.source_modified_at='2026-11-03T19:06:09.263Z'::timestamptz AND b.services_count=37 AND b.prices_count=1 AND (SELECT count(*) FROM public.mvp_services_reference s WHERE s.batch_id=b.batch_id)=37 AND (SELECT count(*) FROM public.mvp_master_prices_reference p WHERE p.batch_id=b.batch_id)=1) THEN RAISE EXCEPTION 'MS2_SNAPSHOT_NOT_VERIFIED'; END IF;
 INSERT INTO public.mvp_services_catalog(service_id,created_at,updated_at,status,category,service_name,default_unit,notes,action_code,client_request_id,source_system,source_batch_id,source_client_request_id,source_created_at,source_updated_at)
 SELECT service_id,created_at,updated_at,status,category,service_name,default_unit,notes,action_code,client_request_id,'LEGACY_GOOGLE_VBOS',batch_id,client_request_id,created_at,updated_at FROM public.mvp_services_reference WHERE batch_id='SERVICES_MASTERPRICES_V12_TEST_20261105_R1';
 IF (SELECT count(*) FROM public.mvp_services_catalog)<>37 THEN RAISE EXCEPTION 'MS2_SEED_COUNT'; END IF;
 INSERT INTO public.mvp_services_catalog_sequences(year,last_value) SELECT split_part(service_id,'-',2)::integer,max(split_part(service_id,'-',3)::bigint) FROM public.mvp_services_catalog GROUP BY 1;
END $seed$;
-- Reconcile current source digest, original request IDs/timestamps and actual legacy
-- sequence high-water (including reserved IDs) before any future activation.
-- No authority activation, no mutation of V12 reference.
-- Rollback before writes: remove dependent code first, then explicitly remove only
-- these three new tables; after writes freeze and reconcile, no shared DB restore.
REVOKE ALL ON public.mvp_services_catalog,public.mvp_services_catalog_requests,public.mvp_services_catalog_sequences FROM PUBLIC;


-- MS3 unnumbered TEST-only migration; apply atomically only in authorized isolated DB.
-- Depends on MS1 shared control, MS2 canonical services and CRM25 master import.
CREATE TABLE public.mvp_master_prices_catalog(
 master_price_id text PRIMARY KEY CHECK(master_price_id ~ '^MPR-[0-9]{4}-[0-9]{4,}$'),
 master_id uuid NOT NULL REFERENCES public.mvp_crm_masters(id) ON DELETE RESTRICT,
 service_id text NOT NULL REFERENCES public.mvp_services_catalog(service_id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL CHECK(status IN ('active','inactive','archived')),
 price_type text NOT NULL CHECK(price_type IN ('fixed','from','range','per_unit','estimate')),
 price_from numeric(20,4) CHECK(price_from>=0),price_to numeric(20,4) CHECK(price_to>=0),
 currency text NOT NULL CHECK(currency IN ('AMD','USD','EUR')),
 unit text NOT NULL CHECK(unit IN ('job','item','point','meter','square_meter','hour','day','visit','other')),
 valid_from date,notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),client_request_id text,
 source_system text NOT NULL DEFAULT 'CLEAN_NATIVE' CHECK(source_system IN ('LEGACY_GOOGLE_VBOS','CLEAN_NATIVE')),
 source_batch_id text,source_master_id text,source_client_request_id text,source_created_at timestamptz,source_updated_at timestamptz,
 FOREIGN KEY(source_batch_id,master_price_id) REFERENCES public.mvp_master_prices_reference(batch_id,master_price_id) ON DELETE RESTRICT,
 CHECK((source_system='LEGACY_GOOGLE_VBOS' AND source_batch_id IS NOT NULL AND source_master_id IS NOT NULL AND source_created_at IS NOT NULL AND source_updated_at IS NOT NULL) OR (source_system='CLEAN_NATIVE' AND source_batch_id IS NULL AND source_master_id IS NULL AND source_client_request_id IS NULL AND source_created_at IS NULL AND source_updated_at IS NULL)),
 CHECK(price_type='estimate' OR (price_type='range' AND price_from IS NOT NULL AND price_to IS NOT NULL AND price_to>=price_from) OR (price_type IN ('fixed','from','per_unit') AND price_from IS NOT NULL AND price_to IS NULL))
);
CREATE INDEX mvp_master_prices_catalog_master_idx ON public.mvp_master_prices_catalog(master_id,service_id,status,valid_from);
CREATE INDEX mvp_master_prices_catalog_service_idx ON public.mvp_master_prices_catalog(service_id,status,master_id,valid_from);
CREATE TABLE public.mvp_master_prices_catalog_requests(request_key uuid PRIMARY KEY,payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),response jsonb NOT NULL);
CREATE TABLE public.mvp_master_prices_catalog_sequences(year integer PRIMARY KEY CHECK(year BETWEEN 2000 AND 9999),last_value bigint NOT NULL CHECK(last_value>=0));
CREATE TABLE public.mvp_master_prices_catalog_history(
 master_price_id text NOT NULL REFERENCES public.mvp_master_prices_catalog(master_price_id) ON DELETE RESTRICT,
 revision integer NOT NULL CHECK(revision>0),recorded_at timestamptz NOT NULL DEFAULT now(),previous_row jsonb NOT NULL,
 PRIMARY KEY(master_price_id,revision)
);
DO $seed$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.mvp_masters_services_authority WHERE id=1 AND phase='LEGACY') THEN RAISE EXCEPTION 'MS3_AUTHORITY_NOT_LEGACY'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mvp_service_reference_batches b WHERE b.batch_id='SERVICES_MASTERPRICES_V12_TEST_20261105_R1' AND b.status='VERIFIED' AND b.source_system='LEGACY_GOOGLE_VBOS' AND b.manifest_sha256='fc85e0e51751b50c689fceaba8d6c273706a25e577e798df3e886deef3a8d674' AND b.source_modified_at='2026-11-03T19:06:09.263Z'::timestamptz AND b.services_count=37 AND b.prices_count=1 AND (SELECT count(*) FROM public.mvp_services_reference s WHERE s.batch_id=b.batch_id)=37 AND (SELECT count(*) FROM public.mvp_master_prices_reference p WHERE p.batch_id=b.batch_id)=1) THEN RAISE EXCEPTION 'MS3_SNAPSHOT_NOT_VERIFIED'; END IF;
 INSERT INTO public.mvp_master_prices_catalog(master_price_id,master_id,service_id,created_at,updated_at,status,price_type,price_from,price_to,currency,unit,valid_from,notes,client_request_id,source_system,source_batch_id,source_master_id,source_client_request_id,source_created_at,source_updated_at)
 SELECT p.master_price_id,m.id,p.service_id,p.created_at,p.updated_at,p.status,p.price_type,p.price_from,p.price_to,p.currency,p.unit,p.valid_from,p.notes,p.client_request_id,'LEGACY_GOOGLE_VBOS',p.batch_id,p.master_id,p.client_request_id,p.created_at,p.updated_at
 FROM public.mvp_master_prices_reference p JOIN public.mvp_crm_masters m ON m.source_system='LEGACY_GOOGLE' AND m.source_master_id=p.master_id
 JOIN public.mvp_services_catalog s ON s.service_id=p.service_id
 WHERE p.batch_id='SERVICES_MASTERPRICES_V12_TEST_20261105_R1';
 IF (SELECT count(*) FROM public.mvp_master_prices_catalog)<>1 THEN RAISE EXCEPTION 'MS3_SEED_COUNT_OR_MAPPING'; END IF;
 INSERT INTO public.mvp_master_prices_catalog_sequences(year,last_value) SELECT split_part(master_price_id,'-',2)::integer,max(split_part(master_price_id,'-',3)::bigint) FROM public.mvp_master_prices_catalog GROUP BY 1;
END $seed$;
-- Actual legacy counters, full source parity, null representation and receipts must be
-- reconciled before live installation; do not infer sequence authority from snapshot max.
-- No activation, no old snapshot changes. Rollback before new writes: remove MS3 code
-- and these four tables in reverse FK order only with authorization; no shared DB restore.
REVOKE ALL ON public.mvp_master_prices_catalog,public.mvp_master_prices_catalog_requests,public.mvp_master_prices_catalog_sequences,public.mvp_master_prices_catalog_history FROM PUBLIC;


-- Independently observed Google IdSequences 2026 Service=60, MasterPrice=24.
-- Current Supabase ops.id_counters has no corresponding rows; stored maxima 60 and 1.
-- Floors MUST be revalidated with actual allocators immediately before apply and MS6.
-- Do not overwrite existing sequence maxima; do not allocate legacy MST aliases:
-- native master UUIDs are canonical, legacy aliases remain unchanged (Master floor 24).
INSERT INTO public.mvp_services_catalog_sequences(year,last_value) VALUES (2026,60)
 ON CONFLICT(year) DO UPDATE SET last_value=greatest(mvp_services_catalog_sequences.last_value,EXCLUDED.last_value);
INSERT INTO public.mvp_master_prices_catalog_sequences(year,last_value) VALUES (2026,24)
 ON CONFLICT(year) DO UPDATE SET last_value=greatest(mvp_master_prices_catalog_sequences.last_value,EXCLUDED.last_value);

DO $ms5_postflight$
BEGIN
 IF (SELECT count(*) FROM public.mvp_masters_services_authority)<>1 OR
 NOT EXISTS (SELECT 1 FROM public.mvp_masters_services_authority WHERE id=1 AND phase='LEGACY' AND master_snapshot_hash IS NULL AND dependency_receipt_hash IS NULL) THEN
  RAISE EXCEPTION 'MS5_AUTHORITY_NOT_READ_ONLY';
 END IF;
 IF (SELECT count(*) FROM public.mvp_services_catalog)<>37 OR (SELECT count(*) FROM public.mvp_master_prices_catalog)<>1 THEN
  RAISE EXCEPTION 'MS5_CATALOG_COUNT';
 END IF;
 IF EXISTS (
  SELECT 1 FROM public.mvp_services_reference r
  LEFT JOIN public.mvp_services_catalog c ON c.service_id=r.service_id
  WHERE r.batch_id='SERVICES_MASTERPRICES_V12_TEST_20261105_R1' AND
  (c.service_id IS NULL OR ROW(c.created_at,c.updated_at,c.status,c.category,c.service_name,c.default_unit,c.notes,c.action_code,c.client_request_id,c.revision,c.source_system,c.source_batch_id,c.source_client_request_id,c.source_created_at,c.source_updated_at)
   IS DISTINCT FROM ROW(r.created_at,r.updated_at,r.status,r.category,r.service_name,r.default_unit,r.notes,r.action_code,r.client_request_id,1,'LEGACY_GOOGLE_VBOS'::text,r.batch_id,r.client_request_id,r.created_at,r.updated_at))
 ) THEN RAISE EXCEPTION 'MS5_SERVICE_FIELD_OR_ID_PARITY'; END IF;
 IF EXISTS (
  SELECT 1 FROM public.mvp_master_prices_reference r
  LEFT JOIN public.mvp_crm_masters m ON m.source_system='LEGACY_GOOGLE' AND m.source_master_id=r.master_id
  LEFT JOIN public.mvp_master_prices_catalog c ON c.master_price_id=r.master_price_id
  WHERE r.batch_id='SERVICES_MASTERPRICES_V12_TEST_20261105_R1' AND
  (m.id IS NULL OR c.master_price_id IS NULL OR ROW(c.master_id,c.service_id,c.created_at,c.updated_at,c.status,c.price_type,c.price_from,c.price_to,c.currency,c.unit,c.valid_from,c.notes,c.client_request_id,c.revision,c.source_system,c.source_batch_id,c.source_master_id,c.source_client_request_id,c.source_created_at,c.source_updated_at)
   IS DISTINCT FROM ROW(m.id,r.service_id,r.created_at,r.updated_at,r.status,r.price_type,r.price_from,r.price_to,r.currency,r.unit,r.valid_from,r.notes,r.client_request_id,1,'LEGACY_GOOGLE_VBOS'::text,r.batch_id,r.master_id,r.client_request_id,r.created_at,r.updated_at))
 ) THEN RAISE EXCEPTION 'MS5_PRICE_FIELD_OR_ID_PARITY'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.mvp_services_catalog_sequences WHERE year=2026 AND last_value>=60) OR
    NOT EXISTS(SELECT 1 FROM public.mvp_master_prices_catalog_sequences WHERE year=2026 AND last_value>=24) THEN
  RAISE EXCEPTION 'MS5_RESERVATION_FLOOR';
 END IF;
 IF EXISTS(SELECT 1 FROM public.mvp_services_catalog_requests) OR
    EXISTS(SELECT 1 FROM public.mvp_master_prices_catalog_requests) OR
    EXISTS(SELECT 1 FROM public.mvp_master_prices_catalog_history) THEN
  RAISE EXCEPTION 'MS5_UNEXPECTED_REQUEST_OR_HISTORY_ROWS';
 END IF;
END $ms5_postflight$;
COMMIT;
