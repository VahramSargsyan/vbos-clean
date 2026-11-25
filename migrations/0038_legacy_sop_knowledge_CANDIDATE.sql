-- VBOS CLEAN SOP / KnowledgeItems faithful copy candidate.
-- NEVER run against PROD or occupied Neon TEST from a chat.
-- Original source and authority remain in legacy Google (or its separately approved
-- old VBOS authority) until an explicit migration/cutover with verified snapshot.
-- No existing Clean tables are altered and NO legacy seed cards are inserted.
BEGIN;
CREATE TABLE IF NOT EXISTS public.mvp_knowledge_authority(
 id smallint PRIMARY KEY CHECK(id=1),
 phase text NOT NULL DEFAULT 'LEGACY' CHECK(phase IN ('LEGACY','CLEAN')),
 source_snapshot_hash text NOT NULL DEFAULT '' CHECK(
  source_snapshot_hash='' OR source_snapshot_hash ~ '^[a-f0-9]{64}$'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.mvp_knowledge_authority(id,phase,source_snapshot_hash)
 VALUES(1,'LEGACY','') ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mvp_knowledge_items(
 knowledge_id text PRIMARY KEY CHECK(knowledge_id ~ '^KNW-[0-9]{4}-[0-9]{4,}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','draft','archived')),
 type text NOT NULL DEFAULT 'REFERENCE'
  CHECK(type IN ('SOP','CHECKLIST','RULE','STANDARD','EXPERIENCE','REFERENCE')),
 code text NOT NULL DEFAULT '' CHECK(length(code)<=80),
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300),
 section_path text NOT NULL DEFAULT '' CHECK(length(section_path)<=300),
 summary text NOT NULL DEFAULT '' CHECK(length(summary)<=2000),
 full_text text NOT NULL DEFAULT '' CHECK(length(full_text)<=49000),
 tags text NOT NULL DEFAULT '' CHECK(length(tags)<=1000),
 version text NOT NULL DEFAULT '' CHECK(length(version)<=60),
 source_name text NOT NULL DEFAULT '' CHECK(length(source_name)<=300),
 source_version text NOT NULL DEFAULT '' CHECK(length(source_version)<=80),
 sort_order numeric NOT NULL DEFAULT 0,
 priority text NOT NULL DEFAULT 'MEDIUM' CHECK(priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
 favorite boolean NOT NULL DEFAULT false,
 client_request_id text DEFAULT '',
 source_system text NOT NULL DEFAULT 'CLEAN_NATIVE' CHECK(source_system IN ('LEGACY_GOOGLE','LEGACY_SUPABASE','CLEAN_NATIVE')),
 CHECK(source_system <> 'CLEAN_NATIVE' OR client_request_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS mvp_knowledge_status_type_idx
 ON public.mvp_knowledge_items(status,type);
CREATE TABLE IF NOT EXISTS public.mvp_knowledge_sequences(
 year integer PRIMARY KEY CHECK(year BETWEEN 2020 AND 9999),
 last_value bigint NOT NULL CHECK(last_value>=0)
);
CREATE TABLE IF NOT EXISTS public.mvp_knowledge_requests(
 request_key uuid PRIMARY KEY,
 operation text NOT NULL CHECK(operation IN ('create_knowledge_item','update_knowledge_item')),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 response jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Owner HTTP session gate only, no GRANT to public/anonymous.
COMMIT;
