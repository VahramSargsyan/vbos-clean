-- Candidate only. Depends on MS1-MS3/MS5 and SQL0016/0035.
-- Explicit isolated TEST installation only, never auto-apply.
ALTER TABLE public.mvp_estimates ADD COLUMN IF NOT EXISTS calculation_batches jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.mvp_estimate_lines ADD COLUMN IF NOT EXISTS calculation_context jsonb,
 ADD COLUMN IF NOT EXISTS service_id text REFERENCES public.mvp_services_catalog(service_id) ON DELETE RESTRICT,
 ADD COLUMN IF NOT EXISTS action_code text,
 ADD COLUMN IF NOT EXISTS service_snapshot jsonb;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='mvp_estimate_batches_array' AND conrelid='public.mvp_estimates'::regclass) THEN
  ALTER TABLE public.mvp_estimates ADD CONSTRAINT mvp_estimate_batches_array CHECK(jsonb_typeof(calculation_batches)='array');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='mvp_estimate_line_context_valid' AND conrelid='public.mvp_estimate_lines'::regclass) THEN
  ALTER TABLE public.mvp_estimate_lines ADD CONSTRAINT mvp_estimate_line_context_valid CHECK(
   (calculation_context IS NULL OR jsonb_typeof(calculation_context)='object') AND
   (action_code IS NULL OR (kind='WORK' AND calculation_context IS NOT NULL AND action_code IN ('INSTALL','CONNECT'))) AND
   ((service_id IS NULL AND service_snapshot IS NULL) OR
    (service_id IS NOT NULL AND service_snapshot IS NOT NULL AND jsonb_typeof(service_snapshot)='object'
     AND calculation_context IS NOT NULL AND kind='WORK' AND action_code IS NOT NULL)));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.mvp_estimator_service_bridges(
 bridge_id text PRIMARY KEY CHECK(length(bridge_id) BETWEEN 1 AND 100),
 card_key text NOT NULL CHECK(length(card_key) BETWEEN 1 AND 80),
 action_type text NOT NULL CHECK(action_type IN ('FIXTURE_INSTALL','WATER','SEWER')),
 service_id text NOT NULL REFERENCES public.mvp_services_catalog(service_id) ON DELETE RESTRICT,
 quantity_rule text NOT NULL,
 status text NOT NULL CHECK(status IN ('active','archived')),
 source_system text NOT NULL CHECK(source_system IN ('LEGACY_RECONCILED','CLEAN_NATIVE')),
 source_snapshot jsonb,
 source_manifest_sha256 text,
 created_at timestamptz NOT NULL DEFAULT now(),
 archived_at timestamptz,
 CHECK((action_type='FIXTURE_INSTALL' AND quantity_rule='ITEM_QUANTITY') OR
       (action_type='WATER' AND quantity_rule='WATER_POINT_TOTAL') OR
       (action_type='SEWER' AND quantity_rule='SEWER_POINT_COUNT')),
 CHECK((source_system='LEGACY_RECONCILED' AND source_snapshot IS NOT NULL AND jsonb_typeof(source_snapshot)='object'
       AND source_manifest_sha256 IS NOT NULL AND source_manifest_sha256 ~ '^[a-f0-9]{64}$') OR
       (source_system='CLEAN_NATIVE' AND source_snapshot IS NULL AND source_manifest_sha256 IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS mvp_estimator_bridge_active_relation ON public.mvp_estimator_service_bridges(card_key,action_type) WHERE status='active';
CREATE TABLE IF NOT EXISTS public.mvp_estimator_bridge_requests(
 request_key uuid PRIMARY KEY,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 response jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- No seed, phase change, grant, legacy mutation, historical rewriting or auto-apply.
