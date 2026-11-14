-- CRM-12A: feature-local append-only observations, additive TEST-only SQL.
-- No backfill and no change to canonical Lead/Interaction/Calendar rows.
CREATE TABLE IF NOT EXISTS public.mvp_crm_score_history_meta (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton = true),
 schema_version text NOT NULL CHECK(schema_version = 'CRM_SCORE_HISTORY_V1'),
 tracking_since timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.mvp_crm_score_history_meta(singleton,schema_version)
VALUES(true,'CRM_SCORE_HISTORY_V1')
ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mvp_lead_score_snapshots (
 snapshot_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 lead_id uuid NOT NULL REFERENCES public.mvp_leads(id) ON DELETE RESTRICT,
 captured_at timestamptz NOT NULL DEFAULT now(),
 capture_source text NOT NULL CHECK(capture_source IN (
  'crm_signal_save','crm_reminder_save','crm_interaction_add','lead_status','lead_convert')),
 score_model_version text NOT NULL CHECK(score_model_version='CRM_WIN_SCORE_V1_100'),
 signal_signature text NOT NULL CHECK(signal_signature ~ '^[0-9a-f]{64}$'),
 lead_revision integer NOT NULL CHECK(lead_revision>=1),
 lead_status text NOT NULL CHECK(lead_status IN ('new','contacted','qualified','won','lost')),
 score integer CHECK(score BETWEEN 0 AND 100),
 band text,
 agreement_stage text,
 source_channel text,
 has_need_summary boolean NOT NULL,
 has_business_contact boolean NOT NULL,
 interaction_coverage text NOT NULL,
 last_contact_at timestamptz,
 has_next_action boolean NOT NULL,
 has_reminder boolean NOT NULL,
 next_action_at timestamptz,
 previous_score integer CHECK(previous_score BETWEEN 0 AND 100),
 score_delta integer CHECK(score_delta BETWEEN -100 AND 100),
 CONSTRAINT mvp_score_delta_consistency CHECK (
  (score_delta IS NULL) OR
  (score IS NOT NULL AND previous_score IS NOT NULL AND score_delta = score-previous_score)
 )
);
CREATE INDEX IF NOT EXISTS mvp_lead_score_snapshots_latest_idx
 ON public.mvp_lead_score_snapshots(lead_id,snapshot_id DESC);
