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
