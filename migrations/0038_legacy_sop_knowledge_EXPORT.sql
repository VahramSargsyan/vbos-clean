-- Read-only Supabase export. Result contains PRIVATE business content: never commit or log it.
-- One statement = one consistent MVCC snapshot. UTC microseconds; numeric as exact decimal text; JSON null retained.
WITH canonical AS (
 SELECT k.knowledge_id, jsonb_build_object(
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
) AS item FROM app.knowledge_items k
), packed AS (
 SELECT count(*) AS row_count,coalesce(jsonb_agg(item ORDER BY knowledge_id COLLATE "C"),'[]'::jsonb) AS items FROM canonical
)
SELECT jsonb_build_object('format','VBOS_SOP_SUPABASE_V1','row_count',row_count,'sha256',encode(sha256(convert_to(items::text,'UTF8')),'hex'),'rows',items) AS snapshot FROM packed;
