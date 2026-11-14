-- CRM-08A canonical current Lead next action + managed CRM calendar projection.
-- TEST only. Additive: no legacy/PROD/Finance, no data backfill or existing row rewrite.
ALTER TABLE public.mvp_leads
 ADD COLUMN IF NOT EXISTS next_action text NOT NULL DEFAULT '';
ALTER TABLE public.mvp_leads
 ADD COLUMN IF NOT EXISTS next_action_at timestamptz;
DO $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname='mvp_leads_next_action_contract'
   AND conrelid='public.mvp_leads'::regclass
 ) THEN
  ALTER TABLE public.mvp_leads ADD CONSTRAINT mvp_leads_next_action_contract
   CHECK (length(next_action)<=500 AND
          (next_action_at IS NULL OR length(trim(next_action))>0));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.mvp_schedule_lead_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_kind text NOT NULL DEFAULT 'crm' CHECK(source_kind='crm'),
 auto_source_key text NOT NULL UNIQUE CHECK(length(auto_source_key)=41),
 lead_id uuid NOT NULL UNIQUE REFERENCES public.mvp_leads(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','archived')),
 start_at timestamptz NOT NULL,
 end_at timestamptz NOT NULL,
 schedule_date date NOT NULL,
 object_id uuid CHECK(object_id IS NULL),
 order_id uuid CHECK(order_id IS NULL),
 item_type text NOT NULL DEFAULT 'CRM' CHECK(item_type='CRM'),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 300),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mvp_crm_auto_key CHECK(auto_source_key='LEAD|'||lead_id::text),
 CONSTRAINT mvp_crm_auto_duration CHECK(end_at=start_at+interval '30 minutes'),
 CONSTRAINT mvp_crm_auto_local_date CHECK((start_at AT TIME ZONE 'Asia/Yerevan')::date=schedule_date),
 CONSTRAINT mvp_crm_auto_archive_state CHECK((status='archived')=(archived_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mvp_crm_auto_period_idx
 ON public.mvp_schedule_lead_items(schedule_date,start_at,id) WHERE status<>'archived';
CREATE TABLE IF NOT EXISTS public.mvp_crm_reminder_requests (
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action='crm_reminder_save'),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Never automatically infer/backfill a reminder from CRM06 interactions or CRM04 notes.
