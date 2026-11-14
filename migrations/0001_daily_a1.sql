-- VBOS Clean MVP A1 V6. Additive / dedicated TEST database only.
-- REQUIRE DB: proud-hat-90291191 / vbos_mvp_clean; never execute in legacy or PROD.
-- Rehearse on disposable PostgreSQL before applying. No existing tables or rows changed.
CREATE TABLE IF NOT EXISTS public.mvp_daily_a1(
 id text PRIMARY KEY CHECK(id ~ '^DA1-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 day_date date NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed')),
 goal text NOT NULL CHECK(length(goal) BETWEEN 1 AND 1000),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 outcome text NOT NULL DEFAULT '' CHECK(outcome IN ('','COMPLETED','PARTIAL','NOT_COMPLETED')),
 outcome_note text NOT NULL DEFAULT '' CHECK(length(outcome_note)<=3000),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mvp_daily_a1_status_outcome CHECK(
  (status='open' AND outcome='' AND outcome_note='') OR
  (status='completed' AND outcome IN ('COMPLETED','PARTIAL','NOT_COMPLETED'))
 )
);
CREATE TABLE IF NOT EXISTS public.mvp_a1_requests(
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action IN ('a1_save','a1_complete','a1_reopen')),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
