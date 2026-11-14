-- VBOS Clean TEST / FINANCE-HISTORY-OWNER-CORRECTIONS-V1.
-- Additive owner annotations only; never modify original FinanceTransactions,
-- immutable history.source_records, finance stage, control snapshots or legacy ID map.
-- Actual Neon TEST application requires a FRESH current backup/readback and authorization gate.

CREATE TABLE IF NOT EXISTS public.mvp_finance_history_corrections (
 source_kind text NOT NULL CHECK (source_kind IN
  ('FINANCE_TRANSACTION','BUSINESS_MONTHLY_GAIN','CAPITAL_FUND',
   'CAPITAL_ALLOCATION_BATCH','CAPITAL_FUND_TRANSACTION')),
 source_id text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 160),
 display_title text NULL CHECK (display_title IS NULL OR length(trim(display_title)) BETWEEN 1 AND 180),
 owner_note text NULL CHECK (owner_note IS NULL OR length(trim(owner_note)) BETWEEN 1 AND 1000),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 updated_by_login text NOT NULL CHECK (length(updated_by_login) BETWEEN 3 AND 48),
 last_request_key uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_kind,source_id)
);
CREATE TABLE IF NOT EXISTS public.mvp_finance_history_correction_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 request_key uuid NOT NULL UNIQUE,
 payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
 source_kind text NOT NULL,
 source_id text NOT NULL,
 source_snapshot_id text NOT NULL CHECK (length(source_snapshot_id) BETWEEN 1 AND 160),
 prior_title text NULL,
 next_title text NULL,
 prior_note text NULL,
 next_note text NULL,
 revision integer NOT NULL CHECK (revision > 0),
 actor_login text NOT NULL CHECK (length(actor_login) BETWEEN 3 AND 48),
 response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(source_kind,source_id)
  REFERENCES public.mvp_finance_history_corrections(source_kind,source_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS mvp_finance_history_corrections_updated
 ON public.mvp_finance_history_corrections(updated_at DESC);
CREATE INDEX IF NOT EXISTS mvp_finance_correction_events_source
 ON public.mvp_finance_history_correction_events(source_kind,source_id,event_id DESC);
REVOKE ALL ON public.mvp_finance_history_corrections FROM PUBLIC;
REVOKE ALL ON public.mvp_finance_history_correction_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.mvp_finance_history_correction_events_event_id_seq FROM PUBLIC;
ALTER TABLE public.mvp_finance_history_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mvp_finance_history_correction_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.mvp_finance_correction_events_immutable()
 RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
 RAISE EXCEPTION 'FINANCE_CORRECTION_AUDIT_APPEND_ONLY' USING ERRCODE='23514';
END;
$guard$;
DO $vbos$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='mvp_finance_correction_events_immutable'
  AND tgrelid='public.mvp_finance_history_correction_events'::regclass) THEN
  CREATE TRIGGER mvp_finance_correction_events_immutable
   BEFORE UPDATE OR DELETE ON public.mvp_finance_history_correction_events
   FOR EACH ROW EXECUTE FUNCTION public.mvp_finance_correction_events_immutable();
 END IF;
END;
$vbos$;
