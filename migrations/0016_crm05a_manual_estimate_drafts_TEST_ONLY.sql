-- VBOS Clean CRM-05A: additive INTERNAL draft estimates. TEST ONLY.
-- Source authority: existing Clean Leads; never mutate old clients, orders or finance.
-- Policy approved 2026-11-05: owner-entered unit prices in AMD, no VAT/discount,
-- no automated Order, no price guessing, no user-visible "accepted" status.
CREATE TABLE IF NOT EXISTS public.mvp_estimates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_lead_id uuid NOT NULL UNIQUE REFERENCES public.mvp_leads(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'draft' CHECK(status='draft'),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 currency text NOT NULL DEFAULT 'AMD' CHECK(currency='AMD'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mvp_estimate_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 estimate_id uuid NOT NULL REFERENCES public.mvp_estimates(id) ON DELETE RESTRICT,
 line_key uuid NOT NULL,
 estimate_revision integer NOT NULL CHECK(estimate_revision>=1),
 position smallint NOT NULL CHECK(position BETWEEN 1 AND 50),
 kind text NOT NULL CHECK(kind IN ('WORK','MATERIAL')),
 description text NOT NULL CHECK(length(description) BETWEEN 1 AND 240),
 quantity numeric(9,3) NOT NULL CHECK(quantity>0 AND quantity<=100000),
 unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 24),
 unit_price_amd numeric(13,0) CHECK(unit_price_amd>=0 AND unit_price_amd<=1000000000),
 price_source text NOT NULL CHECK(price_source IN ('OWNER_ENTERED','UNPRICED')),
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((price_source='UNPRICED' AND unit_price_amd IS NULL)
     OR (price_source='OWNER_ENTERED' AND unit_price_amd IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS mvp_estimate_active_line_position_idx
 ON public.mvp_estimate_lines(estimate_id,position) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mvp_estimate_active_line_key_idx
 ON public.mvp_estimate_lines(estimate_id,line_key) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS mvp_estimate_lines_revision_idx
 ON public.mvp_estimate_lines(estimate_id,estimate_revision,position);
CREATE TABLE IF NOT EXISTS public.mvp_estimate_versions (
 estimate_id uuid NOT NULL REFERENCES public.mvp_estimates(id) ON DELETE RESTRICT,
 revision integer NOT NULL CHECK(revision>=1),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (estimate_id,revision)
);
CREATE TABLE IF NOT EXISTS public.mvp_estimate_mutation_requests (
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action IN ('estimate_create','estimate_save')),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- All new relations have no PUBLIC grants and are accessed only behind
-- existing owner-session auth in the server. No legacy data migration.
