-- VBOS Clean CRM-01. Additive TEST candidate; not authorization for shared Neon or PROD.
-- Existing Clients, Objects, Leads, Orders, legacy provenance and statuses remain untouched.
-- One Lead -> one Client; multiple Leads -> the same Client for repeat business.
CREATE TABLE IF NOT EXISTS public.mvp_crm_lead_client_links(
 lead_id uuid PRIMARY KEY REFERENCES public.mvp_leads(id) ON DELETE RESTRICT,
 client_id uuid NOT NULL REFERENCES public.mvp_clients(id) ON DELETE RESTRICT,
 object_id uuid REFERENCES public.mvp_objects(id) ON DELETE RESTRICT,
 source_kind text NOT NULL DEFAULT 'CLEAN_NATIVE_CONVERSION'
   CHECK(source_kind='CLEAN_NATIVE_CONVERSION'),
 request_key uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mvp_crm_links_client_idx
 ON public.mvp_crm_lead_client_links(client_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.mvp_crm_conversion_requests(
 request_key uuid PRIMARY KEY,
 action text NOT NULL CHECK(action='lead_convert'),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Legacy-equivalent phone normalization. A 9-digit Armenian local 0XXXXXXXX
-- becomes 374XXXXXXXX; international 00... drops the initial access prefix.
CREATE OR REPLACE FUNCTION public.mvp_crm_phone_canonical(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $fn$
 SELECT CASE WHEN length(digits)=9 AND left(digits,1)='0'
             THEN '374'||substring(digits from 2) ELSE digits END
 FROM (
   SELECT CASE WHEN left(raw_digits,2)='00' AND length(raw_digits)>10
               THEN substring(raw_digits from 3) ELSE raw_digits END AS digits
   FROM (SELECT regexp_replace(value,'[^0-9]','','g') AS raw_digits) cleaned
 ) normalized
$fn$;
CREATE INDEX IF NOT EXISTS mvp_clients_crm_phone_lookup_idx
 ON public.mvp_clients(public.mvp_crm_phone_canonical(phone))
 WHERE phone<>'';
