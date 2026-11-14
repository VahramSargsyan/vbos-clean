-- V10 fast-start verification — execute ONLY against a previously staged disposable
-- Neon branch, after V10_GUARDED_GOOGLE_REHEARSAL_ONLY.sql was loaded and tested.
-- NEVER run against the canonical Clean TEST / PROD. No source payload is included.
-- One statement: nested exception blocks automatically roll back simulated changes.
DO $v10_qa$
DECLARE
 g v10_faststart.rehearsal_guard%ROWTYPE;
 r jsonb;
 got boolean;
 n integer;
BEGIN
 SELECT * INTO STRICT g FROM v10_faststart.rehearsal_guard WHERE id=1;
 IF g.mode<>'REHEARSAL_ONLY' OR g.neon_branch_id='br-crimson-hat-b9kwg7n6'
    OR g.neon_branch_id='' THEN
  RAISE EXCEPTION 'V10_QA_WRONG_TARGET';
 END IF;
 IF (SELECT count(*) FROM v10_faststart.source_rows)<>23
  OR (SELECT count(*) FROM v10_faststart.identity_pairs)<>35
  OR (SELECT count(*) FROM v10_faststart.import_receipts)<>6
  OR (SELECT count(*) FROM public.mvp_legacy_import_map)<>41
  OR (SELECT count(*) FROM public.mvp_clients)<>17
  OR (SELECT count(*) FROM public.mvp_objects)<>18
  OR (SELECT count(*) FROM public.mvp_orders)<>4
  OR (SELECT count(*) FROM public.mvp_workers)<>2
  OR (SELECT count(*) FROM public.mvp_work_logs)<>0
  OR (SELECT count(*) FROM public.mvp_worker_days)<>0
  OR (SELECT count(*) FROM public.mvp_schedule_items)<>1
  OR (SELECT count(*) FROM v10_faststart.identity_pairs WHERE approval_state='EXACT_PAIR_REVIEW_PENDING')<>35 THEN
   RAISE EXCEPTION 'V10_QA_CARDINALITY_FAILURE';
 END IF;
 SELECT count(*) INTO n FROM v10_faststart.source_rows
 WHERE entity_kind='WorkOrder' AND source_status IN ('archived','completed');
 IF n<>17 THEN RAISE EXCEPTION 'V10_QA_HISTORICAL_STATUS_LOSS'; END IF;
 SELECT count(*) INTO n
 FROM v10_faststart.import_receipts rr
 JOIN public.mvp_orders o ON o.id=rr.target_uuid
 JOIN v10_faststart.source_rows ss
  ON ss.entity_kind='WorkOrder' AND ss.legacy_id=rr.legacy_id
 JOIN public.mvp_legacy_import_map m
  ON m.source_entity='WorkOrders' AND m.source_id=rr.legacy_id
  AND m.target_id=o.id AND m.source_payload=ss.raw_json::jsonb
 JOIN v10_faststart.identity_pairs p
  ON p.entity_kind='Object' AND p.target_uuid=o.object_id AND p.legacy_id=ss.raw_json::jsonb->>'objectId'
 WHERE rr.entity_kind='WorkOrder'
  AND o.title=ss.raw_json::jsonb->>'title'
  AND o.notes=coalesce(ss.raw_json::jsonb->>'notes','')
  AND o.status=CASE ss.source_status WHEN 'planned' THEN 'open' ELSE 'active' END
  AND o.lead_id IS NULL
  AND rr.source_sha256=ss.source_sha256
  AND rr.original_status=ss.source_status
  AND rr.target_sha256=encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex');
 IF n<>4 THEN RAISE EXCEPTION 'V10_QA_ORDER_FIDELITY'; END IF;
 SELECT count(*) INTO n
 FROM v10_faststart.import_receipts rr
 JOIN public.mvp_workers w ON w.id=rr.target_uuid
 JOIN v10_faststart.source_rows ss
  ON ss.entity_kind='Worker' AND ss.legacy_id=rr.legacy_id
 JOIN public.mvp_legacy_import_map m
  ON m.source_entity='Workers' AND m.source_id=rr.legacy_id
  AND m.target_id=w.id AND m.source_payload=ss.raw_json::jsonb
 WHERE rr.entity_kind='Worker'
  AND w.name=ss.raw_json::jsonb->>'name'
  AND w.role_title=coalesce(ss.raw_json::jsonb->>'roleTitle','')
  AND w.status='active'
  AND w.notes=coalesce(ss.raw_json::jsonb->>'notes','')
  AND rr.target_sha256=encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex');
 IF n<>2 THEN RAISE EXCEPTION 'V10_QA_WORKER_FIDELITY'; END IF;
 SELECT v10_faststart.run_google_rehearsal(g.neon_branch_id,
  g.source_snapshot,g.source_manifest_sha256,g.map_manifest_sha256) INTO r;
 IF r->>'outcome'<>'IDEMPOTENT_REPLAY'
 OR (r->>'newOrders')::int<>0 OR (r->>'newWorkers')::int<>0
 OR (r->>'historicalOrdersNotActivated')::int<>17 THEN
  RAISE EXCEPTION 'V10_QA_IDEMPOTENT_REPLAY_FAIL';
 END IF;

 -- A changed source byte with recomputed own SHA must conflict with the
 -- previously frozen batch/manifest. The nested block rolls back the change.
 got:=false;
 BEGIN
  UPDATE v10_faststart.source_rows
   SET raw_json=raw_json||' ',
       source_sha256=encode(sha256(convert_to(raw_json||' ','UTF8')),'hex')
   WHERE entity_kind='WorkOrder' AND legacy_id=(
    SELECT legacy_id FROM v10_faststart.source_rows
    WHERE entity_kind='WorkOrder' AND source_status='active' ORDER BY legacy_id LIMIT 1);
  PERFORM v10_faststart.run_google_rehearsal(g.neon_branch_id,
    g.source_snapshot,g.source_manifest_sha256,g.map_manifest_sha256);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='V10_FROZEN_SOURCE_OR_MAP_MANIFEST_DRIFT' THEN got:=true;
  ELSE RAISE; END IF;
 END;
 IF NOT got THEN RAISE EXCEPTION 'V10_QA_UNDETECTED_SOURCE_DRIFT'; END IF;

 -- A tampered explicit legacy→Clean target ID must be denied and rolled back.
 got:=false;
 BEGIN
  UPDATE v10_faststart.identity_pairs SET target_uuid=gen_random_uuid()
  WHERE entity_kind='Object' AND legacy_id=(
    SELECT legacy_id FROM v10_faststart.identity_pairs
    WHERE entity_kind='Object' ORDER BY legacy_id LIMIT 1);
  PERFORM v10_faststart.run_google_rehearsal(g.neon_branch_id,
    g.source_snapshot,g.source_manifest_sha256,g.map_manifest_sha256);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='V10_PRIVATE_PAIRS_DIVERGE_FROM_EXISTING_CANONICAL_ID_MAP' THEN got:=true;
  ELSE RAISE; END IF;
 END;
 IF NOT got THEN RAISE EXCEPTION 'V10_QA_UNDETECTED_IDENTITY_TAMPER'; END IF;

 -- An unauthorized edit to an imported operational order must not be silently
 -- overwritten on retry; the mutation is automatically rolled back in the test.
 got:=false;
 BEGIN
  UPDATE public.mvp_orders SET notes=notes||' [unsafe edit]',revision=revision+1
  WHERE id=(SELECT target_uuid FROM v10_faststart.import_receipts
            WHERE entity_kind='WorkOrder' ORDER BY legacy_id LIMIT 1);
  PERFORM v10_faststart.run_google_rehearsal(g.neon_branch_id,
    g.source_snapshot,g.source_manifest_sha256,g.map_manifest_sha256);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='V10_ORDER_TARGET_EDIT_OR_MISSING' THEN got:=true;
  ELSE RAISE; END IF;
 END;
 IF NOT got THEN RAISE EXCEPTION 'V10_QA_UNDETECTED_TARGET_EDIT'; END IF;

 -- The caller must not be able to point this rehearsal at canonical TEST.
 got:=false;
 BEGIN
  PERFORM v10_faststart.run_google_rehearsal(
   'br-crimson-hat-b9kwg7n6',g.source_snapshot,
   g.source_manifest_sha256,g.map_manifest_sha256);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='V10_REHEARSAL_ONLY_EXPLICIT_BRANCH_AND_SNAPSHOT_GATE' THEN got:=true;
  ELSE RAISE; END IF;
 END;
 IF NOT got THEN RAISE EXCEPTION 'V10_QA_UNDETECTED_CANONICAL_BRANCH_ARGUMENT'; END IF;
 IF EXISTS(SELECT 1 FROM v10_faststart.source_rows WHERE right(raw_json,1)=' ')
  OR EXISTS(SELECT 1 FROM public.mvp_orders WHERE notes LIKE '%[unsafe edit]%')
  OR (SELECT count(*) FROM v10_faststart.import_receipts)<>6 THEN
  RAISE EXCEPTION 'V10_QA_ROLLBACK_LEAK';
 END IF;
 RAISE NOTICE 'V10_GOOGLE_GUARDED_REHEARSAL_QA_PASS';
END;
$v10_qa$;