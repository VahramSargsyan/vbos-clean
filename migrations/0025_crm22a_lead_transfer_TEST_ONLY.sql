-- CRM-22A — TEST ONLY. Apply atomically after fresh independent Neon TEST backup.
-- Preserves every existing permissible Lead status; only adds 'transferred'.
-- A manual recipient name is source-backed legacy fallback; no Masters/Workers FK.
ALTER TABLE public.mvp_leads
  DROP CONSTRAINT IF EXISTS mvp_leads_status_check;
ALTER TABLE public.mvp_leads
  ADD CONSTRAINT mvp_leads_status_check CHECK
  (status IN ('new','contacted','qualified','won','lost','transferred'));

CREATE TABLE IF NOT EXISTS public.mvp_crm_lead_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES public.mvp_leads(id) ON DELETE RESTRICT,
  request_key uuid NOT NULL UNIQUE,
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  recipient_name text NOT NULL CHECK(length(btrim(recipient_name)) BETWEEN 1 AND 300),
  reason text NOT NULL CHECK(reason IN
    ('no_time','not_my_specialty','budget_mismatch','too_far',
     'different_specialist_needed','do_not_want_order','other')),
  comment text NOT NULL DEFAULT '' CHECK(length(comment)<=5000),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  source_system text NOT NULL DEFAULT 'CLEAN_NATIVE'
    CHECK(source_system='CLEAN_NATIVE'),
  transferred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mvp_crm_lead_transfers_date_idx
  ON public.mvp_crm_lead_transfers(transferred_at DESC,id DESC);
