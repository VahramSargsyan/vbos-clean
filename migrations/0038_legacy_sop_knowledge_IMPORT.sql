-- SOP S3 transactional import; NOT a writer cutover. Execute only in caller-owned transaction.
-- Prerequisite: exact candidate DDL (0038) applied through approved migration runner.
-- Caller creates TEMP TABLE sop_s3_snapshot_input(snapshot jsonb NOT NULL,expected_sha256 text NOT NULL) ON COMMIT DROP;
-- insert one private snapshot and independently captured expected digest via bound parameters. No raw data in GitHub/logs.
DO $sop_import$
DECLARE doc jsonb; expected_hash text; actual_hash text; authority_phase text; saved_hash text; item_count bigint;
BEGIN
 SELECT snapshot,expected_sha256 INTO STRICT doc,expected_hash FROM pg_temp.sop_s3_snapshot_input;
 IF doc->>'format' IS DISTINCT FROM 'VBOS_SOP_SUPABASE_V1' OR doc->>'row_count' IS DISTINCT FROM '64'
 OR jsonb_typeof(doc->'rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'SOP_S3_BAD_SNAPSHOT'; END IF;
 IF jsonb_array_length(doc->'rows')<>64 OR expected_hash !~ '^[0-9a-f]{64}$'
 OR doc->>'sha256' IS DISTINCT FROM expected_hash OR encode(sha256(convert_to((doc->'rows')::text,'UTF8')),'hex') IS DISTINCT FROM expected_hash THEN
 RAISE EXCEPTION 'SOP_S3_BAD_COUNT_OR_DIGEST'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(doc->'rows') j(item)
 WHERE jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT (item ?& ARRAY['knowledge_id','created_at','updated_at','status','type','code','title','section_path','summary','full_text','tags','version','source_name','source_version','sort_order','priority','favorite','client_request_id'])
 OR (SELECT count(*) FROM jsonb_object_keys(item))<>18) THEN RAISE EXCEPTION 'SOP_S3_BAD_FIELDS'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(doc->'rows') j(item)
 WHERE item->>'knowledge_id' IS NULL OR item->>'knowledge_id' !~ '^KNW-[0-9]{4}-[0-9]{4,}$') THEN RAISE EXCEPTION 'SOP_S3_BAD_ID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(doc->'rows') j(item)
 WHERE substring(item->>'knowledge_id',5,4)::integer NOT BETWEEN 2020 AND 9999
 OR substring(item->>'knowledge_id',10)::numeric > 9223372036854775806) THEN RAISE EXCEPTION 'SOP_S3_BAD_SEQUENCE'; END IF;
 IF (SELECT count(DISTINCT item->>'knowledge_id') FROM jsonb_array_elements(doc->'rows') j(item))<>64 THEN RAISE EXCEPTION 'SOP_S3_DUPLICATE_ID'; END IF;
 LOCK TABLE public.mvp_knowledge_authority,public.mvp_knowledge_items,public.mvp_knowledge_sequences,public.mvp_knowledge_requests IN SHARE ROW EXCLUSIVE MODE;
 SELECT phase,source_snapshot_hash INTO STRICT authority_phase,saved_hash FROM public.mvp_knowledge_authority WHERE id=1 FOR UPDATE;
 IF authority_phase<>'LEGACY' OR EXISTS(SELECT 1 FROM public.mvp_knowledge_requests) THEN RAISE EXCEPTION 'SOP_S3_WRITER_OR_REQUESTS_PRESENT'; END IF;
 SELECT count(*) INTO item_count FROM public.mvp_knowledge_items;
 IF saved_hash='' THEN
  IF item_count<>0 OR EXISTS(SELECT 1 FROM public.mvp_knowledge_sequences) THEN RAISE EXCEPTION 'SOP_S3_DIRTY_TARGET'; END IF;
  INSERT INTO public.mvp_knowledge_items(knowledge_id,created_at,updated_at,status,type,code,title,section_path,summary,full_text,tags,version,source_name,source_version,sort_order,priority,favorite,client_request_id,source_system)
  SELECT knowledge_id,created_at,updated_at,status,type,code,title,section_path,summary,full_text,tags,version,source_name,source_version,sort_order,priority,favorite,client_request_id,'LEGACY_SUPABASE' FROM jsonb_populate_recordset(NULL::public.mvp_knowledge_items,doc->'rows');
  INSERT INTO public.mvp_knowledge_sequences(year,last_value) SELECT substring(knowledge_id,5,4)::integer AS year,max(substring(knowledge_id,10)::bigint) AS last_value FROM public.mvp_knowledge_items GROUP BY 1;
 ELSE
  IF saved_hash<>expected_hash OR item_count<>64 THEN RAISE EXCEPTION 'SOP_S3_REPLAY_MISMATCH'; END IF;
 END IF;
 IF (SELECT count(*) FROM public.mvp_knowledge_items)<>64 OR EXISTS(SELECT 1 FROM public.mvp_knowledge_items WHERE source_system<>'LEGACY_SUPABASE') THEN RAISE EXCEPTION 'SOP_S3_PROVENANCE_OR_COUNT'; END IF;
 SELECT encode(sha256(convert_to(coalesce(jsonb_agg(item ORDER BY knowledge_id COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') INTO actual_hash FROM (
 SELECT k.knowledge_id,jsonb_build_object(
 'knowledge_id',k.knowledge_id,
 'created_at',to_char(k.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'updated_at',to_char(k.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'status',k.status,
 'type',k.type,
 'code',k.code,
 'title',k.title,
 'section_path',k.section_path,
 'summary',k.summary,
 'full_text',k.full_text,
 'tags',k.tags,
 'version',k.version,
 'source_name',k.source_name,
 'source_version',k.source_version,
 'sort_order',trim_scale(k.sort_order)::text,
 'priority',k.priority,
 'favorite',k.favorite,
 'client_request_id',k.client_request_id
) AS item FROM public.mvp_knowledge_items k
) canonical;
 IF actual_hash IS DISTINCT FROM expected_hash THEN RAISE EXCEPTION 'SOP_S3_TARGET_DIGEST_MISMATCH'; END IF;
 IF EXISTS((SELECT year,last_value FROM public.mvp_knowledge_sequences EXCEPT SELECT substring(knowledge_id,5,4)::integer AS year,max(substring(knowledge_id,10)::bigint) AS last_value FROM public.mvp_knowledge_items GROUP BY 1) UNION ALL (SELECT substring(knowledge_id,5,4)::integer AS year,max(substring(knowledge_id,10)::bigint) AS last_value FROM public.mvp_knowledge_items GROUP BY 1 EXCEPT SELECT year,last_value FROM public.mvp_knowledge_sequences)) THEN RAISE EXCEPTION 'SOP_S3_SEQUENCE_MISMATCH'; END IF;
 IF saved_hash='' THEN UPDATE public.mvp_knowledge_authority SET source_snapshot_hash=expected_hash,updated_at=now() WHERE id=1 AND phase='LEGACY'; END IF;
 -- phase remains LEGACY; no runtime or legacy writer changed. Exact replay makes no changes.
END;
$sop_import$;
