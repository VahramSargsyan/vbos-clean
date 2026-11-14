-- CRM-06A: append-only Lead/Client interactions; additive, TEST ONLY.
-- Does not change legacy CRM, existing Lead notes, status, Client relations or Finance.
CREATE TABLE IF NOT EXISTS public.mvp_crm_interactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_key uuid NOT NULL UNIQUE,
 request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 entity_type text NOT NULL CHECK(entity_type IN ('Lead','Client')),
 lead_id uuid REFERENCES public.mvp_leads(id) ON DELETE RESTRICT,
 client_id uuid REFERENCES public.mvp_clients(id) ON DELETE RESTRICT,
 interaction_type text NOT NULL CHECK(interaction_type IN ('call','message','meeting','site_visit','note','other')),
 contact_on date NOT NULL,
 summary text NOT NULL CHECK(length(summary) BETWEEN 1 AND 1000),
 next_action text NOT NULL DEFAULT '' CHECK(length(next_action) <= 500),
 next_action_on date,
 notes text NOT NULL DEFAULT '' CHECK(length(notes) <= 5000),
 status text NOT NULL DEFAULT 'active' CHECK(status = 'active'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((entity_type='Lead' AND lead_id IS NOT NULL AND client_id IS NULL)
    OR (entity_type='Client' AND client_id IS NOT NULL AND lead_id IS NULL)),
 CHECK (next_action_on IS NULL OR length(next_action)>0)
);
CREATE INDEX IF NOT EXISTS mvp_crm_interactions_lead_time_idx
 ON public.mvp_crm_interactions(lead_id,created_at DESC,id DESC)
 WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS mvp_crm_interactions_client_time_idx
 ON public.mvp_crm_interactions(client_id,created_at DESC,id DESC)
 WHERE client_id IS NOT NULL;
-- Zero grants to PUBLIC. Access only via existing authenticated owner API.
