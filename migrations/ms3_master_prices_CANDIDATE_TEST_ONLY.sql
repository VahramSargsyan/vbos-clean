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
