-- VBOS Clean V9H — immutable verified legacy benchmark proposals and explicit owner approvals.
-- ADDITIVE TEST ONLY. Historical text/value rows seeded through separate guarded TEST import,
-- never embedded in Git, never inferred from current Clean WorkLogs.
CREATE TABLE IF NOT EXISTS public.mvp_benchmark_proposals (
 benchmark_id text PRIMARY KEY CHECK(length(benchmark_id) BETWEEN 3 AND 80),
 benchmark_key text NOT NULL UNIQUE CHECK(length(benchmark_key) BETWEEN 3 AND 500),
 work_type text NOT NULL CHECK(length(trim(work_type)) BETWEEN 1 AND 200),
 result_unit text NOT NULL CHECK(length(trim(result_unit)) BETWEEN 1 AND 100),
 source_status text NOT NULL DEFAULT 'PROVISIONAL' CHECK(source_status='PROVISIONAL'),
 source_tag text NOT NULL CHECK(length(source_tag) BETWEEN 5 AND 180),
 observed_rate numeric(18,3) NOT NULL CHECK(observed_rate>0),
 best_observed numeric(18,3) NOT NULL CHECK(best_observed>0),
 sample_count integer NOT NULL CHECK(sample_count>0),
 total_result numeric(18,3) NOT NULL CHECK(total_result>0),
 total_minutes numeric(18,3) NOT NULL CHECK(total_minutes>0),
 source_updated_at timestamptz,
 imported_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mvp_benchmark_proposal_source_mean CHECK(abs(observed_rate - ROUND(total_result*60/total_minutes,3))<=0.001)
);
CREATE TABLE IF NOT EXISTS public.mvp_benchmark_approvals (
 benchmark_id text PRIMARY KEY REFERENCES public.mvp_benchmark_proposals(benchmark_id) ON DELETE RESTRICT,
 status text NOT NULL CHECK(status IN ('APPROVED','REVOKED')),
 approved_rate numeric(18,3) NOT NULL CHECK(approved_rate>0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 approved_at timestamptz NOT NULL,
 revoked_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mvp_benchmark_approval_status_timestamps CHECK((status='APPROVED' AND revoked_at IS NULL) OR (status='REVOKED' AND revoked_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.mvp_benchmark_approval_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 benchmark_id text NOT NULL REFERENCES public.mvp_benchmark_proposals(benchmark_id) ON DELETE RESTRICT,
 request_key uuid NOT NULL UNIQUE,
 payload_sha256 text NOT NULL CHECK(payload_sha256~'^[0-9a-f]{64}$'),
 action text NOT NULL CHECK(action IN ('benchmark_approve','benchmark_revoke')),
 revision integer NOT NULL CHECK(revision>0),
 approved_rate numeric(18,3) NOT NULL CHECK(approved_rate>0),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 response jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mvp_benchmark_approvals_status_idx ON public.mvp_benchmark_approvals(status);
CREATE INDEX IF NOT EXISTS mvp_benchmark_events_source_idx ON public.mvp_benchmark_approval_events(benchmark_id,event_id DESC);
