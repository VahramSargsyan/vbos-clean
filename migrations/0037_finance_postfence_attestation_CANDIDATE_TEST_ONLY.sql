-- Finance B21 — TEST CANDIDATE ONLY; NOT an activation command.
-- CAPABILITY: preserve historical Google mvp_finance_stage.freeze_manifests
-- unchanged (it intentionally CHECKs owner_identity_approved=false and authority=GOOGLE).
-- Stores a distinct, owner-approved, immutable post-fence source receipt in a NEW
-- native table. No current finance writer, balance, fund, CRM or archive rows edited.
-- DO NOT apply to occupied Neon TEST until owner-approved migration backup and
-- disposable PostgreSQL 17 rehearsal are completed. Never run in PROD.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS mvp_finance_native.post_fence_attestations (
  snapshot_id text PRIMARY KEY
    CHECK (length(snapshot_id) BETWEEN 12 AND 160),
  original_snapshot_id text NOT NULL
    REFERENCES mvp_finance_stage.freeze_manifests(snapshot_id) ON DELETE RESTRICT,
  original_manifest_sha256 text NOT NULL
    CHECK (original_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  google_manifest_sha256 text NOT NULL UNIQUE
    CHECK (google_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  crm_bridge_sha256 text NOT NULL
    CHECK (crm_bridge_sha256 ~ '^[0-9a-f]{64}$'),
  google_spreadsheet_id text NOT NULL
    CHECK (length(google_spreadsheet_id) BETWEEN 20 AND 160),
  source_copy_id text NOT NULL
    CHECK (length(source_copy_id) BETWEEN 20 AND 160),
  google_modified_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL
    CHECK (captured_at >= google_modified_at AND
           captured_at > timestamptz '2026-11-08T10:59:32.797Z'),
  google_prod_version integer NOT NULL CHECK (google_prod_version >= 93),
  source_record_count integer NOT NULL CHECK (source_record_count = 80),
  expected_counts jsonb NOT NULL
    CHECK (expected_counts = '{"FINANCE_TRANSACTION":24,"FINANCE_BALANCE":30,
      "BUSINESS_MONTHLY_GAIN":3,"CAPITAL_FUND":8,
      "CAPITAL_ALLOCATION_BATCH":1,"CAPITAL_FUND_TRANSACTION":6,
      "CAPITAL_FUND_BALANCE":8}'::jsonb),
  legacy_link_policy text NOT NULL CHECK (legacy_link_policy='ARCHIVE_ONLY_NO_UUID_BRIDGE'),
  owner_identity_approved boolean NOT NULL CHECK (owner_identity_approved = true),
  owner_attestation_ref text NOT NULL CHECK (length(owner_attestation_ref) BETWEEN 24 AND 512),
  signed_at timestamptz NOT NULL CHECK (signed_at >= captured_at),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT b21_distinct_source_snapshots
   CHECK(google_manifest_sha256<>original_manifest_sha256),
  CONSTRAINT b21_post_fence_original_date
   CHECK (google_modified_at > timestamptz '2026-11-08T10:59:32.797Z')
);

-- Recalculate post-fence hash from the 80 original typed archived source rows.
-- A Google evidence copy was independently compared field-by-field against
-- these 80 original entries; source_copy_id links the external evidence.
-- No historical row is copied or reclassified as a native financial posting.
CREATE OR REPLACE FUNCTION mvp_finance_native.post_fence_archived_source_sha256(
  p_spreadsheet_id text,
  p_copy_id text,
  p_modified_at timestamptz,
  p_captured_at timestamptz,
  p_google_version integer
) RETURNS text LANGUAGE sql STABLE AS $b21sha$
  WITH frozen_rows AS (
    SELECT source_kind, source_id, source_payload
      FROM mvp_history.source_records
     WHERE source_kind='FINANCE_TRANSACTION'
    UNION ALL
    SELECT source_kind, source_id, source_payload
      FROM mvp_finance_stage.source_facts
    UNION ALL
    SELECT source_kind, source_id, source_payload
      FROM mvp_finance_stage.control_snapshots
  )
  SELECT encode(sha256(convert_to(
    jsonb_build_object(
      'contract','VBOS_FINANCE_POST_FENCE_7_TAB_V1',
      'googleSpreadsheetId',p_spreadsheet_id,
      'sourceCopyId',p_copy_id,
      'googleModifiedAt',to_char(p_modified_at AT TIME ZONE 'UTC',
                                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'copyCapturedAt',to_char(p_captured_at AT TIME ZONE 'UTC',
                                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'googleAppsScriptProdVersion',p_google_version,
      'rows',jsonb_agg(jsonb_build_object('kind',source_kind,
                'id',source_id,'payload',source_payload)
                ORDER BY source_kind,source_id)
    )::text,'UTF8')),'hex') FROM frozen_rows;
$b21sha$;

-- No legacy-to-native Order ID mappings are fabricated. Historical links remain
-- legacy strings in read-only archive. New postings use actual CRM UUID Orders.
CREATE OR REPLACE FUNCTION mvp_finance_native.post_fence_archive_only_bridge_sha256()
RETURNS text LANGUAGE sql IMMUTABLE AS $b21bridge$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'contract','VBOS_FINANCE_ARCHIVE_ONLY_CRM_BRIDGE_V1',
    'effectiveDate','2026-10-01',
    'legacyTransactions','HISTORICAL_ONLY',
    'legacyOrderLinks','PRESERVE_ORIGINAL_TEXT_NO_NATIVE_UUID',
    'nativeOrderLinks','VERIFIED_PUBLIC_MVP_ORDERS_UUID_ONLY',
    'legacyIdToNativeIdMappings','[]'::jsonb
  )::text,'UTF8')),'hex');
$b21bridge$;

-- A signed post-fence record must be evidence-consistent AT INSERT time.
-- It cannot make a second writable ledger, or falsely approve a changed archive.
CREATE OR REPLACE FUNCTION mvp_finance_native.validate_post_fence_receipt()
RETURNS trigger LANGUAGE plpgsql AS $b21receipt$
DECLARE historical mvp_finance_stage.freeze_manifests%ROWTYPE;
        n bigint;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'B21_RECEIPT_IMMUTABLE';
  END IF;
  SELECT * INTO historical FROM mvp_finance_stage.freeze_manifests
    WHERE snapshot_id=NEW.original_snapshot_id;
  IF NOT FOUND OR
     historical.google_manifest_sha256<>NEW.original_manifest_sha256 OR
     historical.owner_identity_approved OR
     historical.financial_write_authority<>'GOOGLE' OR
     historical.source_system<>'LEGACY_GOOGLE' THEN
    RAISE EXCEPTION 'B21_ORIGINAL_ARCHIVE_CHANGED';
  END IF;
  SELECT count(*) INTO n FROM (
    SELECT source_id FROM mvp_history.source_records WHERE source_kind='FINANCE_TRANSACTION'
    UNION ALL SELECT source_id FROM mvp_finance_stage.source_facts
    UNION ALL SELECT source_id FROM mvp_finance_stage.control_snapshots
  ) all_rows;
  IF n<>80 OR
     NEW.google_manifest_sha256<>
       mvp_finance_native.post_fence_archived_source_sha256(
        NEW.google_spreadsheet_id,NEW.source_copy_id,
        NEW.google_modified_at,NEW.captured_at,NEW.google_prod_version) OR
     NEW.crm_bridge_sha256<>
       mvp_finance_native.post_fence_archive_only_bridge_sha256() THEN
    RAISE EXCEPTION 'B21_FROZEN_SOURCE_OR_BRIDGE_SHA_MISMATCH';
  END IF;
  RETURN NEW;
END;
$b21receipt$;

DROP TRIGGER IF EXISTS b21_signed_receipt_gate
  ON mvp_finance_native.post_fence_attestations;
CREATE TRIGGER b21_signed_receipt_gate
BEFORE INSERT OR UPDATE OR DELETE ON mvp_finance_native.post_fence_attestations
FOR EACH ROW EXECUTE FUNCTION mvp_finance_native.validate_post_fence_receipt();

-- Explicitly NO INSERT into post_fence_attestations here: its receipt may be
-- signed ONLY after owner accepts the actual post-fence source evidence.
-- Explicitly NO UPDATE to cutover_control or env vars. Fail closed by default.
COMMIT;
