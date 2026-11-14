-- CRM-26A / CANDIDATE ONLY / not authorized for live Neon.
-- Immutable old Google LeadTransfers archive, kept separate from Clean CRM22.
-- 0027 reserved CRM23, 0028 reserved CRM25; recheck numbering on release.
CREATE SCHEMA IF NOT EXISTS mvp_history;

CREATE TABLE IF NOT EXISTS mvp_history.crm_legacy_transfer_batches (
  batch_id text PRIMARY KEY CHECK (length(btrim(batch_id)) BETWEEN 4 AND 128),
  source_spreadsheet_id text NOT NULL CHECK (length(source_spreadsheet_id) BETWEEN 10 AND 200),
  source_sheet text NOT NULL DEFAULT 'LeadTransfers' CHECK (source_sheet='LeadTransfers'),
  source_modified_at timestamptz NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer NOT NULL CHECK (row_count BETWEEN 0 AND 5000),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mvp_history.crm_legacy_lead_transfers (
  source_transfer_id text PRIMARY KEY CHECK (length(btrim(source_transfer_id)) BETWEEN 1 AND 100),
  source_lead_id text NOT NULL CHECK (length(btrim(source_lead_id)) BETWEEN 1 AND 100),
  source_master_id text NOT NULL DEFAULT '' CHECK (length(source_master_id)<=100),
  source_client_request_id text NOT NULL DEFAULT '' CHECK (length(source_client_request_id)<=100),
  recipient_name text NOT NULL CHECK (length(btrim(recipient_name)) BETWEEN 1 AND 300),
  reason text NOT NULL CHECK (reason IN
    ('no_time','not_my_specialty','budget_mismatch','too_far',
     'different_specialist_needed','do_not_want_order','other')),
  comment text NOT NULL DEFAULT '' CHECK (length(comment)<=5000),
  source_status text NOT NULL CHECK (source_status IN ('active','archived')),
  created_at_source text NOT NULL CHECK (length(created_at_source)<=80),
  updated_at_source text NOT NULL CHECK (length(updated_at_source)<=80),
  transferred_at_source text NOT NULL CHECK (length(transferred_at_source)<=80),
  transferred_at timestamptz NOT NULL,
  row_sha256 text NOT NULL CHECK (row_sha256 ~ '^[0-9a-f]{64}$'),
  batch_id text NOT NULL REFERENCES mvp_history.crm_legacy_transfer_batches(batch_id) ON DELETE RESTRICT,
  imported_at timestamptz NOT NULL DEFAULT now()
  -- NO native lead_id/master_id UUID: legacy identifiers cannot be guessed.
);
CREATE INDEX IF NOT EXISTS crm_legacy_transfer_date_idx
  ON mvp_history.crm_legacy_lead_transfers(transferred_at DESC,source_transfer_id DESC);
CREATE INDEX IF NOT EXISTS crm_legacy_transfer_source_lead_idx
  ON mvp_history.crm_legacy_lead_transfers(source_lead_id,transferred_at DESC);
