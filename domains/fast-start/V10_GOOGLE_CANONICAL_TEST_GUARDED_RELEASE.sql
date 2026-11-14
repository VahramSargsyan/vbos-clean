-- VBOS Clean V10 Fast Start - CANONICAL CLEAN TEST ONLY; NEVER PROD.
-- Guarded release requires owner approved manifest, exact source and backup.
-- DO NOT include private IDs/PII here. Target using official Neon branch_id.
-- Function cannot itself attest physical Neon branch. Shadow and old terminal orders excluded.
CREATE SCHEMA IF NOT EXISTS v10_faststart;
REVOKE ALL ON SCHEMA v10_faststart FROM PUBLIC;

CREATE TABLE IF NOT EXISTS v10_faststart.source_rows (
 source_system text NOT NULL CHECK (source_system='GOOGLE_PROD'),
 entity_kind text NOT NULL CHECK (entity_kind IN ('WorkOrder','Worker')),
 legacy_id text NOT NULL CHECK (length(legacy_id) BETWEEN 1 AND 200),
 source_snapshot text NOT NULL,
 source_status text NOT NULL,
 raw_json text NOT NULL,
 source_sha256 text NOT NULL CHECK (
  source_sha256 ~ '^[0-9a-f]{64}$'
  AND source_sha256=encode(sha256(convert_to(raw_json,'UTF8')),'hex')
 ),
 PRIMARY KEY(source_system,entity_kind,legacy_id),
 CHECK (raw_json::jsonb->>'status'=source_status)
);
CREATE TABLE IF NOT EXISTS v10_faststart.identity_pairs (
 entity_kind text NOT NULL CHECK (entity_kind IN ('Client','Object')),
 legacy_id text NOT NULL,
 target_uuid uuid NOT NULL,
 legacy_parent_id text NOT NULL DEFAULT '',
 clean_parent_uuid uuid,
 approval_state text NOT NULL CHECK (approval_state IN ('EXACT_PAIR_REVIEW_PENDING','EXACT_PAIR_APPROVED')),
 source_snapshot text NOT NULL,
 pair_core_json text NOT NULL,
 pair_sha256 text NOT NULL CHECK(
  pair_sha256 ~ '^[0-9a-f]{64}$'
  AND pair_sha256=encode(sha256(convert_to(pair_core_json,'UTF8')),'hex')
 ),
 PRIMARY KEY(entity_kind,legacy_id),
 UNIQUE(entity_kind,target_uuid)
);
CREATE TABLE IF NOT EXISTS v10_faststart.release_guard (
 id smallint PRIMARY KEY CHECK(id=1),
 neon_branch_id text NOT NULL,
 source_snapshot text NOT NULL,
 source_manifest_sha256 text NOT NULL CHECK(source_manifest_sha256~'^[0-9a-f]{64}$'),
 map_manifest_sha256 text NOT NULL CHECK(map_manifest_sha256~'^[0-9a-f]{64}$'),
 mode text NOT NULL CHECK(mode='CANONICAL_TEST_APPROVED'),
 owner_map_control_sha256 text NOT NULL CHECK(owner_map_control_sha256 ~ '^[0-9a-f]{64}$'),
 owner_approval text NOT NULL CHECK(owner_approval='OWNER_CONFIRMED_35_PAIRS_20261104'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS v10_faststart.import_receipts (
 source_system text NOT NULL DEFAULT 'GOOGLE_PROD' CHECK(source_system='GOOGLE_PROD'),
 entity_kind text NOT NULL CHECK(entity_kind IN ('WorkOrder','Worker')),
 legacy_id text NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256~'^[0-9a-f]{64}$'),
 original_status text NOT NULL,
 clean_status text NOT NULL,
 target_uuid uuid NOT NULL UNIQUE,
 target_sha256 text NOT NULL CHECK(target_sha256~'^[0-9a-f]{64}$'),
 imported_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_system,entity_kind,legacy_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA v10_faststart FROM PUBLIC;

CREATE OR REPLACE FUNCTION v10_faststart.run_google_release(
 p_branch_id text,p_source_snapshot text,p_source_manifest_sha256 text,p_map_manifest_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $v10$
DECLARE
 v_guard v10_faststart.release_guard%ROWTYPE;
 v_source_hash text;
 v_map_hash text;
 v_source_counts record;
 v_map_counts record;
 v_prior int;
 v_row record;
 v_json jsonb;
 v_target uuid;
 v_obj uuid;
 v_client uuid;
 v_actual_hash text;
 v_receipt v10_faststart.import_receipts%ROWTYPE;
 v_count_orders int:=0;
 v_count_workers int:=0;
 v_count_schedules int:=0;
 v_source_entity text;
BEGIN
 -- A separate human-controlled disposable branch must have its own guard row.
 SELECT * INTO v_guard FROM v10_faststart.release_guard WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR v_guard.mode<>'CANONICAL_TEST_APPROVED' OR v_guard.neon_branch_id<>p_branch_id
    OR p_branch_id<>'br-crimson-hat-b9kwg7n6'
    OR v_guard.owner_map_control_sha256<>'0332089b28feb43f19a83eb7ddb274c7177c57d33ba7fa73b6a1e83e174a5a2b'
    OR v_guard.owner_approval<>'OWNER_CONFIRMED_35_PAIRS_20261104'
    OR v_guard.source_snapshot<>p_source_snapshot
    OR v_guard.source_manifest_sha256<>p_source_manifest_sha256
    OR v_guard.map_manifest_sha256<>p_map_manifest_sha256 THEN
  RAISE EXCEPTION 'V10_CANONICAL_EXPLICIT_BRANCH_AND_SNAPSHOT_GATE';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('VBOS_CLEAN_V10_GOOGLE_FAST_START'));

 SELECT encode(sha256(convert_to(coalesce(string_agg(
   entity_kind||'|'||legacy_id||'|'||source_sha256,E'\n'
   ORDER BY entity_kind,legacy_id),''),'UTF8')),'hex')
 INTO v_source_hash FROM v10_faststart.source_rows;
 SELECT encode(sha256(convert_to(coalesce(string_agg(
   entity_kind||'|'||legacy_id||'|'||pair_sha256,E'\n'
   ORDER BY entity_kind,legacy_id),''),'UTF8')),'hex')
 INTO v_map_hash FROM v10_faststart.identity_pairs;
 IF v_source_hash<>p_source_manifest_sha256 OR v_map_hash<>p_map_manifest_sha256 THEN
  RAISE EXCEPTION 'V10_FROZEN_SOURCE_OR_MAP_MANIFEST_DRIFT';
 END IF;
 IF EXISTS (SELECT 1 FROM v10_faststart.source_rows WHERE source_snapshot<>p_source_snapshot)
 OR EXISTS (SELECT 1 FROM v10_faststart.identity_pairs WHERE source_snapshot<>p_source_snapshot) THEN
  RAISE EXCEPTION 'V10_SOURCE_SNAPSHOT_NOT_UNIFORM';
 END IF;
 SELECT
  count(*) FILTER(WHERE entity_kind='WorkOrder')::int AS orders,
  count(*) FILTER(WHERE entity_kind='Worker')::int AS workers,
  count(*) FILTER(WHERE entity_kind='WorkOrder' AND source_status='planned')::int AS planned,
  count(*) FILTER(WHERE entity_kind='WorkOrder' AND source_status='active')::int AS active,
  count(*) FILTER(WHERE entity_kind='WorkOrder' AND source_status='completed')::int AS completed,
  count(*) FILTER(WHERE entity_kind='WorkOrder' AND source_status='archived')::int AS archived,
  count(*) FILTER(WHERE entity_kind='Worker' AND source_status='active')::int AS active_workers
 INTO v_source_counts FROM v10_faststart.source_rows;
 IF v_source_counts.orders<>21 OR v_source_counts.workers<>2
  OR v_source_counts.planned<>2 OR v_source_counts.active<>2
  OR v_source_counts.completed<>13 OR v_source_counts.archived<>4
  OR v_source_counts.active_workers<>2 THEN
  RAISE EXCEPTION 'V10_INCOMPLETE_OR_CHANGED_GOOGLE_SOURCE_UNIVERSE';
 END IF;
 SELECT count(*) FILTER(WHERE entity_kind='Client')::int AS clients,
        count(*) FILTER(WHERE entity_kind='Object')::int AS objects
 INTO v_map_counts FROM v10_faststart.identity_pairs;
 IF v_map_counts.clients<>17 OR v_map_counts.objects<>18
  OR (SELECT count(*) FROM public.mvp_clients)<>17
  OR (SELECT count(*) FROM public.mvp_objects)<>18 THEN
  RAISE EXCEPTION 'V10_CLIENT_OBJECT_IDENTITY_COUNTS_MISMATCH';
 END IF;
 -- Each restricted pair must agree with the pre-existing imported original-ID map
 -- and the actual Clean parent FK. Never match by display name alone here.
 IF EXISTS (
  SELECT 1 FROM v10_faststart.identity_pairs p
  LEFT JOIN public.mvp_legacy_import_map old
   ON old.source_system='Working IP APP / M8C cutover baseline'
   AND old.source_entity=CASE p.entity_kind WHEN 'Client' THEN 'Clients' ELSE 'Objects' END
   AND old.source_id=p.legacy_id AND old.target_id=p.target_uuid
  LEFT JOIN public.mvp_clients c ON p.entity_kind='Client' AND c.id=p.target_uuid
  LEFT JOIN public.mvp_objects o ON p.entity_kind='Object' AND o.id=p.target_uuid
  LEFT JOIN v10_faststart.identity_pairs parent
   ON p.entity_kind='Object' AND parent.entity_kind='Client' AND parent.legacy_id=p.legacy_parent_id
  WHERE old.target_id IS NULL
    OR (p.entity_kind='Client' AND c.id IS NULL)
    OR (p.entity_kind='Object' AND
      (o.id IS NULL OR parent.target_uuid IS NULL OR o.client_id<>parent.target_uuid
       OR p.clean_parent_uuid IS DISTINCT FROM parent.target_uuid))
 ) THEN
  RAISE EXCEPTION 'V10_PRIVATE_PAIRS_DIVERGE_FROM_EXISTING_CANONICAL_ID_MAP';
 END IF;
 SELECT count(*) INTO v_prior FROM v10_faststart.import_receipts;
 IF v_prior NOT IN (0,6) THEN RAISE EXCEPTION 'V10_PARTIAL_RECEIPT_STATE'; END IF;
 IF v_prior=0 AND (
  EXISTS(SELECT 1 FROM public.mvp_workers)
  OR EXISTS(SELECT 1 FROM public.mvp_orders)
  OR (SELECT count(*) FROM public.mvp_legacy_import_map)<>35
 ) THEN RAISE EXCEPTION 'V10_NONEMPTY_DESTINATION_NO_PRIOR_RECEIPTS'; END IF;
 IF v_prior=6 AND (
  (SELECT count(*) FROM public.mvp_workers)<>2 OR
  (SELECT count(*) FROM public.mvp_orders)<>4 OR
  (SELECT count(*) FROM public.mvp_legacy_import_map)<>41
 ) THEN RAISE EXCEPTION 'V10_POSTIMPORT_COUNTS_DRIFT'; END IF;

 FOR v_row IN
  SELECT * FROM v10_faststart.source_rows
  WHERE entity_kind='Worker'
  ORDER BY legacy_id
 LOOP
  v_json:=v_row.raw_json::jsonb;
  IF length(btrim(coalesce(v_json->>'name',''))) NOT BETWEEN 1 AND 160
   OR length(coalesce(v_json->>'phone',''))>60
   OR (coalesce(v_json->>'phone','')<>'' AND
       (coalesce(v_json->>'phone','') !~ '^\+?[0-9 ()\.\-]+$' OR
        length(regexp_replace(v_json->>'phone','[^0-9]','','g')) NOT BETWEEN 7 AND 20))
   OR length(coalesce(v_json->>'roleTitle',''))>160
   OR length(coalesce(v_json->>'notes',''))>5000 THEN
   RAISE EXCEPTION 'V10_INVALID_WORKER_SOURCE_FIELDS';
  END IF;
  IF v_prior=0 THEN
   INSERT INTO public.mvp_workers(
    name,phone,phone_key,role_title,notes,status,created_at,updated_at
   ) VALUES (
    btrim(v_json->>'name'),btrim(coalesce(v_json->>'phone','')),
    regexp_replace(btrim(coalesce(v_json->>'phone','')),'[^0-9]','','g'),
    btrim(coalesce(v_json->>'roleTitle','')),coalesce(v_json->>'notes',''),
    'active',(v_json->>'createdAt')::timestamptz,(v_json->>'updatedAt')::timestamptz
   ) RETURNING id INTO v_target;
   INSERT INTO public.mvp_legacy_import_map(
    source_system,source_entity,source_id,target_id,source_updated_at,source_payload
   ) VALUES (
    'Working IP APP / M8C cutover baseline','Workers',
    v_row.legacy_id,v_target,coalesce(v_json->>'updatedAt',''),v_json
   );
   SELECT encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex')
   INTO v_actual_hash FROM public.mvp_workers w WHERE w.id=v_target;
   INSERT INTO v10_faststart.import_receipts(
    source_system,entity_kind,legacy_id,source_sha256,original_status,
    clean_status,target_uuid,target_sha256
   ) VALUES ('GOOGLE_PROD','Worker',v_row.legacy_id,v_row.source_sha256,
             'active','active',v_target,v_actual_hash);
   v_count_workers:=v_count_workers+1;
  ELSE
   SELECT * INTO v_receipt FROM v10_faststart.import_receipts
   WHERE source_system='GOOGLE_PROD' AND entity_kind='Worker' AND legacy_id=v_row.legacy_id;
   IF NOT FOUND OR v_receipt.source_sha256<>v_row.source_sha256
    OR v_receipt.original_status<>'active' OR v_receipt.clean_status<>'active'
    OR NOT EXISTS(
     SELECT 1 FROM public.mvp_legacy_import_map m
     WHERE m.source_system='Working IP APP / M8C cutover baseline'
       AND m.source_entity='Workers' AND m.source_id=v_row.legacy_id
       AND m.target_id=v_receipt.target_uuid AND m.source_payload=v_json
    ) THEN RAISE EXCEPTION 'V10_WORKER_SOURCE_RECEIPT_DRIFT'; END IF;
   SELECT encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex')
   INTO v_actual_hash FROM public.mvp_workers w WHERE w.id=v_receipt.target_uuid;
   IF v_actual_hash IS DISTINCT FROM v_receipt.target_sha256 THEN
    RAISE EXCEPTION 'V10_WORKER_TARGET_EDIT_OR_MISSING'; END IF;
  END IF;
 END LOOP;

 FOR v_row IN
  SELECT * FROM v10_faststart.source_rows
  WHERE entity_kind='WorkOrder' AND source_status IN ('active','planned')
  ORDER BY legacy_id
 LOOP
  v_json:=v_row.raw_json::jsonb;
  SELECT o.id,c.id INTO v_obj,v_client
  FROM v10_faststart.identity_pairs m
  JOIN public.mvp_objects o ON o.id=m.target_uuid
  JOIN v10_faststart.identity_pairs mc ON mc.entity_kind='Client'
     AND mc.legacy_id=v_json->>'clientId' AND mc.target_uuid=o.client_id
  JOIN public.mvp_clients c ON c.id=mc.target_uuid
  WHERE m.entity_kind='Object' AND m.legacy_id=v_json->>'objectId';
  IF v_obj IS NULL OR v_client IS NULL
   OR length(btrim(coalesce(v_json->>'title',''))) NOT BETWEEN 1 AND 180
   OR length(coalesce(v_json->>'notes',''))>5000
   OR (coalesce(v_json->>'plannedStartDate','')<>''
       AND (v_json->>'plannedStartDate') !~ '^\d{4}-\d{2}-\d{2}$') THEN
   RAISE EXCEPTION 'V10_INVALID_ORDER_SOURCE_FIELDS_OR_PARENT';
  END IF;
  IF v_prior=0 THEN
   INSERT INTO public.mvp_orders(request_key,object_id,lead_id,title,status,
      planned_on,notes,created_at,updated_at)
   VALUES(gen_random_uuid(),v_obj,NULL,btrim(v_json->>'title'),
     CASE WHEN v_row.source_status='planned' THEN 'open' ELSE 'active' END,
     nullif(v_json->>'plannedStartDate','')::date,coalesce(v_json->>'notes',''),
     (v_json->>'createdAt')::timestamptz,(v_json->>'updatedAt')::timestamptz)
   RETURNING id INTO v_target;
   INSERT INTO public.mvp_legacy_import_map(
     source_system,source_entity,source_id,target_id,source_updated_at,source_payload
   ) VALUES (
     'Working IP APP / M8C cutover baseline','WorkOrders',
     v_row.legacy_id,v_target,coalesce(v_json->>'updatedAt',''),v_json
   );
   IF nullif(v_json->>'plannedStartDate','') IS NOT NULL THEN
    INSERT INTO public.mvp_schedule_order_items(
      status,start_at,end_at,schedule_date,object_id,order_id,auto_source_key,item_type,title
    ) VALUES (
      'planned',((v_json->>'plannedStartDate')||'T09:00:00+04:00')::timestamptz,
      ((v_json->>'plannedStartDate')||'T10:00:00+04:00')::timestamptz,
      (v_json->>'plannedStartDate')::date,v_obj,v_target,'WORKORDER|'||v_target::text,
      'Работа',btrim(v_json->>'title')
    );
    v_count_schedules:=v_count_schedules+1;
   END IF;
   SELECT encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex')
   INTO v_actual_hash FROM public.mvp_orders o WHERE o.id=v_target;
   INSERT INTO v10_faststart.import_receipts(
    source_system,entity_kind,legacy_id,source_sha256,original_status,
    clean_status,target_uuid,target_sha256
   ) VALUES (
    'GOOGLE_PROD','WorkOrder',v_row.legacy_id,v_row.source_sha256,v_row.source_status,
    CASE WHEN v_row.source_status='planned' THEN 'open' ELSE 'active' END,
    v_target,v_actual_hash
   );
   v_count_orders:=v_count_orders+1;
  ELSE
   SELECT * INTO v_receipt FROM v10_faststart.import_receipts
    WHERE source_system='GOOGLE_PROD' AND entity_kind='WorkOrder' AND legacy_id=v_row.legacy_id;
   IF NOT FOUND OR v_receipt.source_sha256<>v_row.source_sha256
    OR v_receipt.original_status<>v_row.source_status
    OR v_receipt.clean_status<>(CASE WHEN v_row.source_status='planned' THEN 'open' ELSE 'active' END)
    OR NOT EXISTS (
     SELECT 1 FROM public.mvp_legacy_import_map m
     WHERE m.source_system='Working IP APP / M8C cutover baseline'
      AND m.source_entity='WorkOrders' AND m.source_id=v_row.legacy_id
      AND m.target_id=v_receipt.target_uuid AND m.source_payload=v_json
    ) THEN RAISE EXCEPTION 'V10_ORDER_SOURCE_RECEIPT_DRIFT'; END IF;
   SELECT encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex')
   INTO v_actual_hash FROM public.mvp_orders o WHERE o.id=v_receipt.target_uuid;
   IF v_actual_hash IS DISTINCT FROM v_receipt.target_sha256 THEN
     RAISE EXCEPTION 'V10_ORDER_TARGET_EDIT_OR_MISSING'; END IF;
   IF (nullif(v_json->>'plannedStartDate','') IS NOT NULL)<>EXISTS (
      SELECT 1 FROM public.mvp_schedule_order_items s WHERE s.order_id=v_receipt.target_uuid
   ) THEN RAISE EXCEPTION 'V10_ORDER_SCHEDULE_MISSING_OR_UNEXPECTED'; END IF;
  END IF;
 END LOOP;
 IF v_prior=0 AND (v_count_orders<>4 OR v_count_workers<>2) THEN
  RAISE EXCEPTION 'V10_PARTIAL_INITIAL_INSERT';
 END IF;
 IF (SELECT count(*) FROM v10_faststart.import_receipts)<>6 THEN
  RAISE EXCEPTION 'V10_RECEIPT_CARDINALITY_VIOLATION'; END IF;
 RETURN jsonb_build_object(
  'mode','CANONICAL_TEST_RELEASE',
  'outcome',CASE WHEN v_prior=0 THEN 'IMPORTED' ELSE 'IDEMPOTENT_REPLAY' END,
  'googleOperationalOrders',4,'googleWorkers',2,
  'historicalOrdersNotActivated',17,
  'newOrders',v_count_orders,'newWorkers',v_count_workers,
  'newAutoPlans',v_count_schedules,
  'identityPairs',35,'sourceSnapshot',p_source_snapshot,
  'ownerExactPairApproval','OWNER_APPROVED_MANIFEST_20261104',
  'canonicalNeonTestDataChanged',v_prior=0
 );
END;
$v10$;
REVOKE ALL ON FUNCTION v10_faststart.run_google_release(text,text,text,text) FROM PUBLIC;
