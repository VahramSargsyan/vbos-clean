-- CRM-23A CANDIDATE ONLY; no live execution. Private historical Interactions archive; no raw PII in GitHub.
-- Requires existing frozen 131-row mvp_history.source_records remains unchanged.
CREATE TABLE IF NOT EXISTS mvp_history.crm_legacy_interaction_receipts(
  receipt_id text PRIMARY KEY,
  history_batch_id text NOT NULL REFERENCES mvp_history.import_batches(batch_id),
  source_spreadsheet_id text NOT NULL,
  source_sheet text NOT NULL DEFAULT 'Interactions' CHECK(source_sheet='Interactions'),
  snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  count_all integer NOT NULL CHECK(count_all=30),
  count_activity integer NOT NULL CHECK(count_activity=15),
  count_relation_final integer NOT NULL CHECK(count_relation_final=5),
  count_relation_pending integer NOT NULL CHECK(count_relation_pending=10),
  created_at timestamptz NOT NULL DEFAULT now(),
  source_system text NOT NULL DEFAULT 'LEGACY_GOOGLE' CHECK(source_system='LEGACY_GOOGLE'),
  status text NOT NULL DEFAULT 'VERIFIED' CHECK(status='VERIFIED'),
  UNIQUE(history_batch_id,source_spreadsheet_id,source_sheet)
);
CREATE TABLE IF NOT EXISTS mvp_history.crm_legacy_interactions(
  source_id text PRIMARY KEY CHECK(length(source_id) BETWEEN 3 AND 128),
  receipt_id text NOT NULL REFERENCES mvp_history.crm_legacy_interaction_receipts(receipt_id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK(entity_type IN('Lead','Client')),
  entity_id text NOT NULL CHECK(length(entity_id) BETWEEN 3 AND 128),
  record_kind text NOT NULL CHECK(record_kind IN('ACTIVITY','RELATION_FINAL','RELATION_PENDING')),
  interaction_type text NOT NULL CHECK(interaction_type IN('call','message','meeting','site_visit','note','other')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  original_status text NOT NULL CHECK(original_status IN('active','archived')),
  summary text NOT NULL CHECK(length(summary)<=1000),
  next_action text NOT NULL DEFAULT '' CHECK(length(next_action)<=500),
  next_action_at text NOT NULL DEFAULT '' CHECK(length(next_action_at)<=50),
  notes text NOT NULL DEFAULT '' CHECK(length(notes)<=5000),
  client_request_id text NOT NULL CHECK(length(client_request_id)<=160),
  row_sha256 text NOT NULL CHECK(row_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK(record_kind='ACTIVITY' OR
    (entity_type='Lead' AND
     ((record_kind='RELATION_FINAL' AND client_request_id LIKE 'REL|LeadClient|%') OR
      (record_kind='RELATION_PENDING' AND client_request_id LIKE 'REL|LeadClientPending|%'))))
);
CREATE INDEX IF NOT EXISTS crm_legacy_interactions_source_entity_idx
 ON mvp_history.crm_legacy_interactions(entity_type,entity_id,created_at DESC,source_id);
CREATE INDEX IF NOT EXISTS crm_legacy_interactions_relation_idx
 ON mvp_history.crm_legacy_interactions(client_request_id)
 WHERE record_kind='RELATION_FINAL';
