-- VBOS Clean / ORDER_CONTACT_JOURNAL_BATCH1 / 0033 / CANDIDATE ONLY.
-- Do not apply to working Neon/Render/PROD without independent TEST release gate.
-- No old Google/Client/Lead/Object interaction migration.
CREATE TABLE IF NOT EXISTS public.mvp_order_interactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_key uuid NOT NULL UNIQUE,
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 order_id uuid NOT NULL REFERENCES public.mvp_orders(id) ON DELETE RESTRICT,
 interaction_type text NOT NULL CHECK(interaction_type IN ('call','message','meeting','site_visit','note','other')),
 summary text NOT NULL CHECK(length(summary) BETWEEN 1 AND 1000),
 next_action text NOT NULL DEFAULT '' CHECK(length(next_action)<=500),
 -- Preserve datetime-local wall clock (Yerevan); no unapproved UTC conversion.
 next_action_at timestamp without time zone,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 status text NOT NULL DEFAULT 'active' CHECK(status='active'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(next_action_at IS NULL OR length(next_action)>0)
);
CREATE INDEX IF NOT EXISTS mvp_order_interactions_order_created_idx
 ON public.mvp_order_interactions(order_id,created_at DESC,id DESC);
