-- CRM-25A CANDIDATE ONLY: never apply to working Neon without an explicit approved
-- release, fresh independently restorable backup, source receipt and migration readback.
-- CRM23 reserves 0027; verify numbering again during the release bundle integration.
CREATE SCHEMA IF NOT EXISTS mvp_history;
CREATE TABLE IF NOT EXISTS mvp_history.crm_legacy_master_receipts (
 receipt_id text PRIMARY KEY,
 source_spreadsheet_id text NOT NULL,
 source_sheet text NOT NULL DEFAULT 'Masters' CHECK(source_sheet='Masters'),
 source_modified_at timestamptz NOT NULL,
 source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
 row_count integer NOT NULL CHECK(row_count=5),
 imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_spreadsheet_id,source_sheet)
);
CREATE TABLE IF NOT EXISTS public.mvp_crm_masters (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_key uuid UNIQUE,
 payload_sha256 text CHECK(payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$'),
 source_system text NOT NULL DEFAULT 'CLEAN_NATIVE'
   CHECK (source_system IN ('CLEAN_NATIVE','LEGACY_GOOGLE')),
 source_master_id text UNIQUE
   CHECK (source_master_id IS NULL OR length(btrim(source_master_id)) BETWEEN 1 AND 100),
 legacy_receipt_id text REFERENCES mvp_history.crm_legacy_master_receipts(receipt_id) ON DELETE RESTRICT,
 source_created_at text NOT NULL DEFAULT '' CHECK (length(source_created_at)<=80),
 source_updated_at text NOT NULL DEFAULT '' CHECK (length(source_updated_at)<=80),
 source_client_request_id text NOT NULL DEFAULT '' CHECK (length(source_client_request_id)<=160),
 row_sha256 text CHECK(row_sha256 IS NULL OR row_sha256 ~ '^[0-9a-f]{64}$'),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 300),
 phone text NOT NULL DEFAULT '' CHECK(length(phone)<=100),
 email text NOT NULL DEFAULT '' CHECK(length(email)<=200),
 service_area text NOT NULL DEFAULT '' CHECK(length(service_area)<=500),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
 status text NOT NULL DEFAULT 'active'
   CHECK(status IN ('active','unavailable','archived')),
 quality_tier text NOT NULL DEFAULT ''
   CHECK(quality_tier IN ('','good','normal','problematic')),
 messenger_type text NOT NULL DEFAULT 'none'
   CHECK(messenger_type IN ('whatsapp','viber','telegram','other','none')),
 messenger_contact text NOT NULL DEFAULT '' CHECK(length(messenger_contact)<=300),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mvp_crm_masters_source_contract CHECK (
  (source_system='CLEAN_NATIVE' AND request_key IS NOT NULL
   AND payload_sha256 IS NOT NULL AND source_master_id IS NULL)
  OR
  (source_system='LEGACY_GOOGLE' AND source_master_id IS NOT NULL
   AND request_key IS NULL AND payload_sha256 IS NULL)
 )
);
CREATE INDEX IF NOT EXISTS mvp_crm_masters_status_sort_idx
 ON public.mvp_crm_masters(status,created_at DESC,id DESC);
ALTER TABLE public.mvp_crm_lead_transfers
 ADD COLUMN IF NOT EXISTS master_id uuid REFERENCES public.mvp_crm_masters(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS mvp_crm_lead_transfers_master_idx
 ON public.mvp_crm_lead_transfers(master_id) WHERE master_id IS NOT NULL;
