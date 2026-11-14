-- CRM-16A accepted Estimate -> one native Clean WorkOrder, TEST ONLY.
-- Reuse exact CRM05 manual AMD versions and accepted legacy EstimatorWorkOrderHandoff_v1_7_24 semantics.
-- Only owner confirmation; no payment, invoice, VAT, discount, scheduling or Google/PROD authority.
ALTER TABLE public.mvp_estimates
 DROP CONSTRAINT IF EXISTS mvp_estimates_status_check;
ALTER TABLE public.mvp_estimates
 ADD CONSTRAINT mvp_estimates_status_check CHECK(status IN ('draft','accepted'));
ALTER TABLE public.mvp_estimates
 ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
 ADD COLUMN IF NOT EXISTS accepted_revision integer CHECK(accepted_revision>=1),
 ADD COLUMN IF NOT EXISTS accepted_total_amd numeric(20,3) CHECK(accepted_total_amd>=0),
 ADD COLUMN IF NOT EXISTS work_order_id uuid REFERENCES public.mvp_orders(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS mvp_estimates_one_order_idx
 ON public.mvp_estimates(work_order_id) WHERE work_order_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.mvp_estimate_handoff_requests(
 request_key uuid PRIMARY KEY,
 estimate_id uuid NOT NULL REFERENCES public.mvp_estimates(id) ON DELETE RESTRICT,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 response jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mvp_estimate_handoff_estimate_idx ON public.mvp_estimate_handoff_requests(estimate_id);
-- No historical estimate/Client/Order status backfill, no writes to mvp_legacy_import_map.
