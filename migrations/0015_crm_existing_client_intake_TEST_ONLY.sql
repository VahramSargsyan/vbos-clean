-- VBOS Clean CRM-02: explicit existing-client selection when a new lead is CREATED.
-- Independent from CRM-01 conversion: intake is an open lead, NOT won/converted.
-- All previous data/IDs/source provenance are preserved; no rewrites.
CREATE TABLE IF NOT EXISTS public.mvp_crm_lead_intakes (
 lead_id uuid PRIMARY KEY REFERENCES public.mvp_leads(id) ON DELETE RESTRICT,
 client_id uuid NOT NULL REFERENCES public.mvp_clients(id) ON DELETE RESTRICT,
 request_key uuid NOT NULL UNIQUE,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 source_kind text NOT NULL DEFAULT 'EXISTING_CLIENT_SELECTED_AT_INTAKE'
   CHECK(source_kind = 'EXISTING_CLIENT_SELECTED_AT_INTAKE'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mvp_crm_lead_intakes_client_idx
 ON public.mvp_crm_lead_intakes(client_id,created_at DESC);
