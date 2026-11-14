-- VBOS Clean / Finance history owner-review overlay v1.
-- TEST CANDIDATE ONLY: apply only after exact current Neon backup + migration gate.
-- Canonical historic Finance/Capital facts remain immutable and remain in original schemas.
-- No Google writes, no current Finance writer, no ledger balance effect.

CREATE TABLE IF NOT EXISTS public.mvp_finance_history_review (
 source_kind text NOT NULL CHECK(source_kind IN
  ('FINANCE_TRANSACTION','BUSINESS_MONTHLY_GAIN','CAPITAL_FUND',
   'CAPITAL_ALLOCATION_BATCH','CAPITAL_FUND_TRANSACTION')),
 source_id text NOT NULL CHECK(length(source_id) BETWEEN 1 AND 160),
 review_state text NOT NULL CHECK(review_state IN ('UNREVIEWED','REVIEWED','ARCHIVED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_by_login text NOT NULL CHECK(length(updated_by_login) BETWEEN 3 AND 48),
 last_request_key uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_kind,source_id)
);
CREATE TABLE IF NOT EXISTS public.mvp_finance_history_review_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 request_key uuid NOT NULL UNIQUE,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 source_kind text NOT NULL,
 source_id text NOT NULL,
 source_snapshot_id text NOT NULL CHECK(length(source_snapshot_id) BETWEEN 1 AND 160),
 prior_state text NOT NULL CHECK(prior_state IN ('UNREVIEWED','REVIEWED','ARCHIVED')),
 next_state text NOT NULL CHECK(next_state IN ('UNREVIEWED','REVIEWED','ARCHIVED')),
 revision integer NOT NULL CHECK(revision>0),
 actor_login text NOT NULL CHECK(length(actor_login) BETWEEN 3 AND 48),
 response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(source_kind,source_id)
  REFERENCES public.mvp_finance_history_review(source_kind,source_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS mvp_finance_review_events_source
 ON public.mvp_finance_history_review_events(source_kind,source_id,event_id DESC);
CREATE INDEX IF NOT EXISTS mvp_finance_review_state_recent
 ON public.mvp_finance_history_review(review_state,updated_at DESC);

-- No public REST / PostgREST access, and no side-door public grants.
REVOKE ALL ON public.mvp_finance_history_review FROM PUBLIC;
REVOKE ALL ON public.mvp_finance_history_review_events FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.mvp_finance_history_review_events_event_id_seq FROM PUBLIC;
ALTER TABLE public.mvp_finance_history_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mvp_finance_history_review_events ENABLE ROW LEVEL SECURITY;

-- This guard is for audit receipts only; review state itself remains owner-reversible.
CREATE OR REPLACE FUNCTION public.mvp_finance_history_events_immutable()
 RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'FINANCE_REVIEW_AUDIT_APPEND_ONLY' USING ERRCODE='23514';
END;
$$;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='mvp_finance_review_events_immutable'
  AND tgrelid='public.mvp_finance_history_review_events'::regclass) THEN
  CREATE TRIGGER mvp_finance_review_events_immutable
   BEFORE UPDATE OR DELETE ON public.mvp_finance_history_review_events
   FOR EACH ROW EXECUTE FUNCTION public.mvp_finance_history_events_immutable();
 END IF;
END;
$$;
