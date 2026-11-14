-- FINANCE B9.1 / 0031: exact owner-affirmed opening STOCK for isolated or approved shared Clean TEST.
-- Reviewed business as-of: 2026-09-30; new accounting cutoff 2026-10-01.
-- NO native Finance/Capital money events, NO dual writer, NO POSTGRES activation, NO PROD.
-- Source archive was captured 2026-11-06; it is NOT a same-day Sep30 signature or
-- proof that the old Google writer is disabled. The owner separately attested that
-- there were no missing Sep24–30 transactions or liabilities (2026-11-10, PR #1256).
-- Requires existing installed B9 private schema, exact immutable source manifest,
-- source ledger parity, and an unchanged BLOCKED/GOOGLE authority gate.
-- Run in one database transaction on an isolated branch before any shared TEST apply.
-- Do not retry blind after timeout: SELECT opening_snapshot, funds, fund_openings, audit_events.
DO $b91$
DECLARE
  v_snapshot CONSTANT text := 'FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
  v_manifest CONSTANT text := '8bdfd30faa9e45785f928c2861d7e3645a9dd168bb6d678004c0df730a04871d';
  v_asof CONSTANT date := DATE '2026-09-30';
  v_audit_key CONSTANT uuid := 'c035aa6c-58e8-55f4-af18-8e323be981b8';
  v_funds CONSTANT jsonb := '[{"legacy_id":"FND-2026-0001","fund_id":"c8e79653-4c81-5a29-ae6f-e4081d1b5bd3","code":"OPERATING_RESERVE","balance":"1000"},{"legacy_id":"FND-2026-0002","fund_id":"0592faeb-08f8-53db-b6bd-1e525928c93c","code":"WARRANTY_RESERVE","balance":"2000"},{"legacy_id":"FND-2026-0003","fund_id":"c37bce0d-a472-5802-b606-ed766c992d71","code":"MARKETING_SALES","balance":"2000"},{"legacy_id":"FND-2026-0004","fund_id":"ed136ceb-88e3-5a7a-91a1-64b14ec59461","code":"PEOPLE_TRAINING","balance":"2500"},{"legacy_id":"FND-2026-0005","fund_id":"dfe5f9fa-8d57-5de5-96dc-903c7a4a1ac7","code":"TOOLS_CREW_KITS","balance":"0"},{"legacy_id":"FND-2026-0006","fund_id":"250b3e38-844c-5c92-9d55-eeb6195875f6","code":"RND_MATERIALS","balance":"1500"},{"legacy_id":"FND-2026-0007","fund_id":"e68120e9-9d30-57ee-bd28-da746bc92648","code":"DIGITAL_AI_VBOS","balance":"0"},{"legacy_id":"FND-2026-0008","fund_id":"595648d8-e2c6-55cf-b1ad-0546f4322efe","code":"INFRASTRUCTURE","balance":"1000"}]'::jsonb;
  v_gate mvp_finance_native.cutover_control%ROWTYPE;
  v_open mvp_finance_native.opening_snapshot%ROWTYPE;
  v_source mvp_finance_stage.freeze_manifests%ROWTYPE;
  v_item jsonb;
  v_fund jsonb;
  v_bal jsonb;
  v_legacy text;
  v_code text;
  v_fid uuid;
  v_amount numeric(24,6);
  v_count integer;
  v_bad integer;
  v_cash numeric(24,6);
  v_profit numeric(24,6);
  v_payable numeric(24,6);
  v_control jsonb;
  v_details jsonb;
BEGIN
  SELECT * INTO v_gate FROM mvp_finance_native.cutover_control WHERE id=1 FOR UPDATE;
  IF NOT FOUND OR v_gate.phase<>'BLOCKED'
     OR v_gate.financial_write_authority<>'GOOGLE'
     OR v_gate.cutover_date_key IS NOT NULL OR v_gate.activated_at IS NOT NULL
     OR v_gate.owner_identity_approved OR v_gate.google_frozen_confirmed
     OR v_gate.snapshot_id IS NOT NULL OR v_gate.manifest_sha256 IS NOT NULL
     OR v_gate.crm_bridge_sha256 IS NOT NULL OR v_gate.expected_fund_count<>8
  THEN RAISE EXCEPTION 'B91_NOT_BLOCKED_CLEAN_TEST_GATE'; END IF;
  IF EXISTS (SELECT 1 FROM mvp_finance_native.transactions)
     OR EXISTS (SELECT 1 FROM mvp_finance_native.fund_movements)
     OR EXISTS (SELECT 1 FROM mvp_finance_native.fund_effects)
     OR EXISTS (SELECT 1 FROM mvp_finance_native.fincap_batches)
     OR EXISTS (SELECT 1 FROM mvp_finance_native.request_receipts)
  THEN RAISE EXCEPTION 'B91_NATIVE_WRITER_ALREADY_USED'; END IF;
  SELECT * INTO v_source FROM mvp_finance_stage.freeze_manifests
   WHERE snapshot_id=v_snapshot;
  IF NOT FOUND OR v_source.google_manifest_sha256<>v_manifest
      OR v_source.source_system<>'LEGACY_GOOGLE'
      OR v_source.owner_identity_approved
      OR v_source.financial_write_authority<>'GOOGLE'
      OR v_source.expected_counts->>'FINANCE_TRANSACTION'<>'24'
      OR v_source.expected_counts->>'CAPITAL_FUND'<>'8'
      OR v_source.expected_counts->>'CAPITAL_FUND_BALANCE'<>'8'
      OR v_source.expected_counts->>'FINANCE_BALANCE'<>'30'
  THEN RAISE EXCEPTION 'B91_IMMUTABLE_ARCHIVE_MANIFEST_MISMATCH'; END IF;
  SELECT count(*)::integer,
     COALESCE(sum((source_payload->>'cashEffectBase')::numeric),0),
     COALESCE(sum((source_payload->>'profitEffectBase')::numeric),0),
     COALESCE(sum((source_payload->>'workerPayableEffectBase')::numeric),0),
     count(*) FILTER (WHERE source_payload->>'status'<>'active'
       OR (CASE WHEN source_payload->>'transactionDateKey' ~ '^[0-9]{5}$'
                THEN date '1899-12-30'+(source_payload->>'transactionDateKey')::integer
                ELSE (source_payload->>'transactionDateKey')::date END)>v_asof)
    INTO v_count,v_cash,v_profit,v_payable,v_bad
  FROM mvp_history.source_records WHERE source_kind='FINANCE_TRANSACTION';
  IF v_count<>24 OR v_bad<>0 OR v_cash<>203000 OR v_profit<>588000 OR v_payable<>0
  THEN RAISE EXCEPTION 'B91_LEDGER_NOT_EXACT_APPROVED_STOCK'; END IF;
  SELECT source_payload INTO v_control FROM mvp_finance_stage.control_snapshots
   WHERE source_kind='FINANCE_BALANCE' AND source_id='GLOBAL|ALL';
  IF v_control IS NULL OR (v_control->>'cashBalanceBase')::numeric<>v_cash
     OR (v_control->>'profitBase')::numeric<>v_profit
     OR (v_control->>'workerPayableBase')::numeric<>v_payable
     OR (v_control->>'transactionCount')::integer<>24
  THEN RAISE EXCEPTION 'B91_GLOBAL_SNAPSHOT_MISMATCH'; END IF;
  IF (SELECT count(*) FROM mvp_finance_stage.source_facts
        WHERE source_kind='CAPITAL_FUND')<>8
     OR (SELECT count(*) FROM mvp_finance_stage.control_snapshots
        WHERE source_kind='CAPITAL_FUND_BALANCE')<>8
     OR (SELECT count(*) FROM mvp_finance_stage.source_facts
        WHERE source_kind='CAPITAL_FUND_TRANSACTION')<>6
     OR (SELECT count(*) FROM mvp_finance_stage.source_facts
        WHERE source_kind='CAPITAL_ALLOCATION_BATCH')<>1
  THEN RAISE EXCEPTION 'B91_CAPITAL_SOURCE_COUNT_MISMATCH'; END IF;
  IF (SELECT COALESCE(sum((source_payload->>'amountBase')::numeric),0)
      FROM mvp_finance_stage.source_facts
      WHERE source_kind='CAPITAL_FUND_TRANSACTION')<>10000
  THEN RAISE EXCEPTION 'B91_CAPITAL_ALLOCATION_SUM_MISMATCH'; END IF;

  -- This singleton can be safely re-run only with the same date, origin and figures.
  INSERT INTO mvp_finance_native.opening_snapshot
    (id,source_snapshot_id,manifest_sha256,as_of_date,opening_cash_base,
     opening_profit_base,opening_worker_payable_base,opening_note)
  VALUES (1,v_snapshot,v_manifest,v_asof,203000,588000,0,
    'Owner confirmed as-of 2026-09-30 on 2026-11-10; Google captured Nov 6; Sep 24-30 completeness owner-attested; separate source freeze/authority switch NOT verified.')
  ON CONFLICT(id) DO NOTHING;
  SELECT * INTO v_open FROM mvp_finance_native.opening_snapshot WHERE id=1;
  IF v_open.source_snapshot_id<>v_snapshot OR v_open.manifest_sha256<>v_manifest
     OR v_open.as_of_date<>v_asof OR v_open.opening_cash_base<>v_cash
     OR v_open.opening_profit_base<>v_profit
     OR v_open.opening_worker_payable_base<>v_payable
  THEN RAISE EXCEPTION 'B91_OPENING_CONFLICT_NO_OVERWRITE'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_funds) AS x(value)
  LOOP
    v_legacy := v_item->>'legacy_id';
    v_code := v_item->>'code';
    v_fid := (v_item->>'fund_id')::uuid;
    v_amount := (v_item->>'balance')::numeric;
    SELECT source_payload INTO v_fund FROM mvp_finance_stage.source_facts
      WHERE source_kind='CAPITAL_FUND' AND source_id=v_legacy;
    SELECT source_payload INTO v_bal FROM mvp_finance_stage.control_snapshots
      WHERE source_kind='CAPITAL_FUND_BALANCE' AND source_id=v_legacy;
    IF v_fund IS NULL OR v_bal IS NULL OR v_fund->>'code'<>v_code
       OR v_fund->>'fundId'<>v_legacy
       OR v_bal->>'fundId'<>v_legacy
       OR v_fund->>'status'<>'active'
       OR (v_bal->>'balanceBase')::numeric<>v_amount
    THEN RAISE EXCEPTION 'B91_FUND_SOURCE_MISMATCH: %',v_legacy; END IF;
    INSERT INTO mvp_finance_native.funds
     (fund_id,legacy_source_id,code,group_type,status,target_amount_base,allocation_share_pct)
    VALUES (v_fid,v_legacy,v_code,v_fund->>'groupType',v_fund->>'status',
      (v_fund->>'targetAmountBase')::numeric,(v_fund->>'allocationSharePct')::numeric)
    ON CONFLICT(fund_id) DO NOTHING;
    IF NOT EXISTS (
      SELECT 1 FROM mvp_finance_native.funds f WHERE
       f.fund_id=v_fid AND f.legacy_source_id=v_legacy
       AND f.code=v_code AND f.group_type=v_fund->>'groupType'
       AND f.status=v_fund->>'status'
       AND f.target_amount_base=(v_fund->>'targetAmountBase')::numeric
       AND f.allocation_share_pct=(v_fund->>'allocationSharePct')::numeric
    ) THEN RAISE EXCEPTION 'B91_FUND_IDENTITY_CONFLICT: %',v_legacy; END IF;
    INSERT INTO mvp_finance_native.fund_openings
      (fund_id,legacy_balance_source_id,source_snapshot_id,opening_balance_base)
    VALUES(v_fid,v_legacy,v_snapshot,v_amount)
    ON CONFLICT(fund_id) DO NOTHING;
    IF NOT EXISTS (
      SELECT 1 FROM mvp_finance_native.fund_openings fo
      WHERE fo.fund_id=v_fid AND fo.legacy_balance_source_id=v_legacy
        AND fo.source_snapshot_id=v_snapshot AND fo.opening_balance_base=v_amount
    ) THEN RAISE EXCEPTION 'B91_FUND_OPENING_CONFLICT: %',v_legacy; END IF;
  END LOOP;
  IF (SELECT count(*) FROM mvp_finance_native.funds)<>8
     OR (SELECT count(*) FROM mvp_finance_native.fund_openings)<>8
     OR (SELECT COALESCE(sum(opening_balance_base),0)
         FROM mvp_finance_native.fund_openings)<>10000
  THEN RAISE EXCEPTION 'B91_OPENING_SET_INCOMPLETE'; END IF;
  v_details := jsonb_build_object(
    'asOfDate','2026-09-30','cutoverProposed','2026-10-01',
    'sourceSnapshot',v_snapshot,'sourceManifestSha256',v_manifest,
    'ownerApprovedNumbers',true,'ownerAttestedDate','2026-11-10',
    'sourceWriterFrozen',false,'nativeWriterActivated',false,
    'openingCashAMD',203000,'openingProfitAMD',588000,'workerPayableAMD',0,
    'fundCount',8,'fundOpeningsTotalAMD',10000,
    'unmappedLegacyWorkOrdersNotImported',12,
    'historicalLedgerRemaindsReadOnly',true
  );
  INSERT INTO mvp_finance_native.audit_events
    (request_key,event_type,source_kind,source_id,details)
  SELECT v_audit_key,'OPENING_STOCK_OWNER_ATTESTED','LEGACY_GOOGLE',v_snapshot,v_details
  WHERE NOT EXISTS(SELECT 1 FROM mvp_finance_native.audit_events
                   WHERE request_key=v_audit_key);
  IF (SELECT count(*) FROM mvp_finance_native.audit_events
      WHERE request_key=v_audit_key
        AND event_type='OPENING_STOCK_OWNER_ATTESTED'
        AND source_kind='LEGACY_GOOGLE'
        AND source_id=v_snapshot AND details=v_details)<>1
  THEN RAISE EXCEPTION 'B91_AUDIT_REPLAY_CONFLICT'; END IF;
END $b91$;
