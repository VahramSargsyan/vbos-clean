-- VBOS Clean V11H: owner-approved canonical Clean TEST history-only migration, 2026-11-05.
-- Source-derived schema: Finance isolated DDL Git blob ef58a18b0ad589ce6a996ab46a9ce84ad6330c61.
-- Run ONLY via official Neon tool, exact project proud-hat-90291191, branch br-crimson-hat-b9kwg7n6, DB vbos_mvp_clean.
-- First: fresh pre-import snapshot snap-old-paper-b9l0vg23 with successful independent RESTORE readback.
-- No PROD, no Legacy Google/Supabase changes, no live mvp_orders write, no mapping from old source IDs to operational UUIDs.
-- The source data load is an independent guarded transactional second phase in the same official Neon transaction.
-- One-shot ADDITIVE migration. Before any re-execution inspect versioned receipt and migration schema.
-- Rollback is snapshot recovery of exact pre-import Clean TEST, *never* delete/upsert existing orders.

BEGIN;
SELECT pg_advisory_xact_lock(112011, 20261105);
DO $v11h_shared_clean_test_gate$
BEGIN
 IF current_database()<>'vbos_mvp_clean'
    OR to_regclass('mvp_history.source_records') IS NOT NULL
    OR to_regclass('mvp_history.import_batches') IS NOT NULL
    OR (SELECT count(*) FROM public.mvp_clients)<>17
    OR (SELECT count(*) FROM public.mvp_objects)<>18
    OR (SELECT count(*) FROM public.mvp_orders)<>4
    OR (SELECT count(*) FROM public.mvp_workers)<>2
    OR (SELECT count(*) FROM public.mvp_work_logs)<>1
    OR (SELECT count(*) FROM public.mvp_benchmark_proposals)<>22
    OR (SELECT count(*) FROM public.mvp_benchmark_approvals)<>0
 THEN RAISE EXCEPTION 'V11H_CANONICAL_CLEAN_TEST_PREFLIGHT_CHANGED_ABORT';
 END IF;
END $v11h_shared_clean_test_gate$;

CREATE SCHEMA IF NOT EXISTS mvp_history;
REVOKE ALL ON SCHEMA mvp_history FROM PUBLIC;

CREATE TABLE mvp_history.import_batches (
  batch_id text PRIMARY KEY CHECK (length(batch_id) BETWEEN 8 AND 180),
  source_snapshot_id text NOT NULL CHECK (length(source_snapshot_id)>0),
  google_modified_at timestamptz NOT NULL,
  shadow_read_at timestamptz NOT NULL,
  expected_counts jsonb NOT NULL CHECK (jsonb_typeof(expected_counts)='object'),
  evidence_manifest_sha256 text NOT NULL CHECK (evidence_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'STAGED'
    CHECK (state IN ('STAGED','RECONCILED','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The ledger is evidence only. PII may reside in payload, so no public grants.
-- source_id keeps exact immutable legacy IDs, never substituted Clean UUIDs.
-- parent links are source IDs, not foreign keys to operational public tables.
CREATE TABLE mvp_history.source_records (
  source_kind text NOT NULL CHECK (source_kind IN
    ('CLIENT','OBJECT','LEAD','WORK_ORDER','CLIENT_ASSESSMENT',
     'WORKER_ASSIGNMENT','WORKER','FINANCE_TRANSACTION')),
  source_id text NOT NULL CHECK (length(source_id)>0),
  source_system text NOT NULL CHECK (source_system IN
    ('LEGACY_GOOGLE','OFFICIAL_SHADOW_EXTRA')),
  import_batch_id text NOT NULL REFERENCES mvp_history.import_batches(batch_id),
  client_source_id text,
  object_source_id text,
  lead_source_id text,
  original_status text NOT NULL DEFAULT '',
  source_payload jsonb NOT NULL CHECK (jsonb_typeof(source_payload)='object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (payload_sha256 = encode(sha256(convert_to(source_payload::text,'UTF8')),'hex')),
  owner_confirmed_shadow_exception boolean NOT NULL DEFAULT false,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_kind,source_id),
  CHECK (original_status=coalesce(source_payload->>'status','')),
  CHECK (source_id=source_payload->>(
    CASE source_kind
      WHEN 'CLIENT' THEN CASE WHEN source_system='LEGACY_GOOGLE' THEN 'clientId' ELSE 'client_id' END
      WHEN 'OBJECT' THEN CASE WHEN source_system='LEGACY_GOOGLE' THEN 'objectId' ELSE 'object_id' END
      WHEN 'LEAD' THEN CASE WHEN source_system='LEGACY_GOOGLE' THEN 'leadId' ELSE 'lead_id' END
      WHEN 'WORK_ORDER' THEN CASE WHEN source_system='LEGACY_GOOGLE' THEN 'workOrderId' ELSE 'work_order_id' END
      WHEN 'CLIENT_ASSESSMENT' THEN 'clientAssessmentId'
      WHEN 'WORKER_ASSIGNMENT' THEN 'assignmentId'
      WHEN 'WORKER' THEN 'workerId'
      WHEN 'FINANCE_TRANSACTION' THEN 'financeTransactionId'
    END
  )),
  CHECK (source_kind <> 'WORK_ORDER' OR
    (client_source_id IS NOT NULL AND length(client_source_id)>0
     AND object_source_id IS NOT NULL AND length(object_source_id)>0)),
  CHECK (source_kind <> 'OBJECT' OR
    (client_source_id IS NOT NULL AND length(client_source_id)>0)),
  CHECK (source_system <> 'OFFICIAL_SHADOW_EXTRA'
    OR owner_confirmed_shadow_exception),
  CHECK (source_system <> 'LEGACY_GOOGLE'
    OR NOT owner_confirmed_shadow_exception)
);
CREATE INDEX history_by_batch ON mvp_history.source_records(import_batch_id,source_kind);
CREATE INDEX history_by_client ON mvp_history.source_records(client_source_id,source_kind);
CREATE INDEX history_by_object ON mvp_history.source_records(object_source_id,source_kind);
CREATE INDEX history_by_status ON mvp_history.source_records(source_kind,original_status,source_id);

-- Preserve alternate Shadow versions for common IDs only as audit evidence;
-- no automatic overwrite of canonical Google facts from later Shadow tests.
CREATE TABLE mvp_history.source_variants (
  source_kind text NOT NULL,
  source_id text NOT NULL,
  variant_system text NOT NULL CHECK (variant_system='OFFICIAL_SHADOW_COMPARISON'),
  source_payload jsonb NOT NULL CHECK (jsonb_typeof(source_payload)='object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (payload_sha256 = encode(sha256(convert_to(source_payload::text,'UTF8')),'hex')),
  review_state text NOT NULL DEFAULT 'SOURCE_DIFFERENCE_UNDECIDED'
    CHECK (review_state='SOURCE_DIFFERENCE_UNDECIDED'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_kind,source_id,variant_system),
  FOREIGN KEY (source_kind,source_id)
    REFERENCES mvp_history.source_records(source_kind,source_id)
      ON DELETE RESTRICT
);

-- Immutable reconciliation receipt, never UPDATE a staged batch.
CREATE TABLE mvp_history.batch_receipts (
  batch_id text NOT NULL REFERENCES mvp_history.import_batches(batch_id),
  receipt_kind text NOT NULL CHECK (receipt_kind='RECONCILED_IN_ISOLATED_TEST'),
  reconciled_counts jsonb NOT NULL CHECK (jsonb_typeof(reconciled_counts)='object'),
  verified_manifest_sha256 text NOT NULL CHECK (verified_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id,receipt_kind)
);

-- Append-only hard stop, including for accidental admin updates.
CREATE FUNCTION mvp_history.reject_existing_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  RAISE EXCEPTION 'VBOS historical evidence is append-only; no UPDATE or DELETE'
    USING ERRCODE='check_violation';
END; $$;
REVOKE ALL ON FUNCTION mvp_history.reject_existing_evidence_mutation() FROM PUBLIC;

CREATE TRIGGER history_records_immutable
  BEFORE UPDATE OR DELETE ON mvp_history.source_records
  FOR EACH ROW EXECUTE FUNCTION mvp_history.reject_existing_evidence_mutation();
CREATE TRIGGER history_variants_immutable
  BEFORE UPDATE OR DELETE ON mvp_history.source_variants
  FOR EACH ROW EXECUTE FUNCTION mvp_history.reject_existing_evidence_mutation();
CREATE TRIGGER history_receipts_immutable
  BEFORE UPDATE OR DELETE ON mvp_history.batch_receipts
  FOR EACH ROW EXECUTE FUNCTION mvp_history.reject_existing_evidence_mutation();
CREATE TRIGGER history_batches_immutable
  BEFORE UPDATE OR DELETE ON mvp_history.import_batches
  FOR EACH ROW EXECUTE FUNCTION mvp_history.reject_existing_evidence_mutation();

-- Require a separate role/access design for actual UI; frontend has no access.
ALTER TABLE mvp_history.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE mvp_history.source_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE mvp_history.source_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE mvp_history.batch_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA mvp_history FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mvp_history FROM PUBLIC;
COMMIT;
