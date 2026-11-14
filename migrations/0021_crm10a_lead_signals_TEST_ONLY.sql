-- CRM-10A TEST-only canonical Lead business signals. Strictly additive.
-- NULL agreement_stage/source_channel = unknown; no fabricated historical defaults.
ALTER TABLE public.mvp_leads ADD COLUMN IF NOT EXISTS agreement_stage text;
ALTER TABLE public.mvp_leads ADD COLUMN IF NOT EXISTS source_channel text;
ALTER TABLE public.mvp_leads ADD COLUMN IF NOT EXISTS need_summary text NOT NULL DEFAULT '';
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.mvp_leads'::regclass AND conname='mvp_leads_signal_stage_allowed') THEN
  ALTER TABLE public.mvp_leads ADD CONSTRAINT mvp_leads_signal_stage_allowed
   CHECK(agreement_stage IS NULL OR agreement_stage IN ('new_contact','needs_discussion','estimate_required','estimate_sent','negotiation','approved','rejected'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.mvp_leads'::regclass AND conname='mvp_leads_signal_source_allowed') THEN
  ALTER TABLE public.mvp_leads ADD CONSTRAINT mvp_leads_signal_source_allowed
   CHECK(source_channel IS NULL OR source_channel IN ('repeat_client','referral','partner','facebook','instagram','google','whatsapp','signboard','other'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.mvp_leads'::regclass AND conname='mvp_leads_need_summary_bounded') THEN
  ALTER TABLE public.mvp_leads ADD CONSTRAINT mvp_leads_need_summary_bounded
   CHECK(length(need_summary)<=1000);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.mvp_crm_signal_requests(
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action='crm_signal_save'),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 lead_id uuid NOT NULL REFERENCES public.mvp_leads(id) ON DELETE RESTRICT,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
