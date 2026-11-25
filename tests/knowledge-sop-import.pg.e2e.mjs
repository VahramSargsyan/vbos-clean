// Synthetic-only, disposable local PostgreSQL. No real SOP records or writer activation.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Client} from 'pg';
const address=process.env.TEST_DATABASE_URL;
if(!address||!['localhost','127.0.0.1'].includes(new URL(address).hostname))throw Error('SOP_S3_LOCAL_DISPOSABLE_ONLY');
const read=p=>readFileSync(new URL('../migrations/'+p,import.meta.url),'utf8');
const ddl=read('0038_legacy_sop_knowledge_CANDIDATE.sql')
 .replace(/^\s*(BEGIN|COMMIT);\s*$/gm,'')
 .replaceAll('public.mvp_knowledge_','pg_temp.mvp_knowledge_')
 .replaceAll('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE IF NOT EXISTS');
const importer=read('0038_legacy_sop_knowledge_IMPORT.sql').replaceAll('public.mvp_knowledge_','pg_temp.mvp_knowledge_');
const exporter=read('0038_legacy_sop_knowledge_EXPORT.sql').replace('app.knowledge_items','pg_temp.sop_s3_source').replace(/;\s*$/,'');
const cols='knowledge_id,created_at,updated_at,status,type,code,title,section_path,summary,full_text,tags,version,source_name,source_version,sort_order,priority,favorite,client_request_id';
const client=new Client({connectionString:address,ssl:false});
const check=async(sql)=>{const row=(await client.query(sql)).rows[0];for(const [key,val] of Object.entries(row))assert.equal(val,true,key);};
async function rejectsWithin(savepoint,error){
 await client.query('SAVEPOINT '+savepoint);
 try{
  await assert.rejects(client.query(importer),e=>e.message===error);
 }finally{await client.query('ROLLBACK TO SAVEPOINT '+savepoint);await client.query('RELEASE SAVEPOINT '+savepoint);}
}
try{
 await client.connect();
 await client.query('BEGIN');
 await client.query('SAVEPOINT sop_s3_rehearsal');
 await client.query(ddl);
 await client.query("CREATE TEMP TABLE sop_s3_source AS SELECT 'KNW-2026-'||lpad(i::text,4,'0') AS knowledge_id,'2026-08-13 07:38:03.430123+00'::timestamptz AS created_at,('2026-10-03 04:11:08.696469+00'::timestamptz + i*interval '1 microsecond') AS updated_at,'active'::text AS status, CASE WHEN i<=61 THEN 'SOP' WHEN i<=63 THEN 'REFERENCE' ELSE 'EXPERIENCE' END AS type, i::text AS code,'Синтетическая карточка '||i AS title,'Тест / раздел'::text AS section_path,'Сводка'::text AS summary,repeat('Синтетика; ''цитата'' '||chr(10), CASE WHEN i=1 THEN 1200 ELSE 10 END) AS full_text,'тест'::text AS tags,'v1'::text AS version,'Synthetic'::text AS source_name,'v0'::text AS source_version,(i::numeric/10)::numeric AS sort_order,'MEDIUM'::text AS priority,(i%2=0) AS favorite, CASE WHEN i=1 THEN 'synthetic-receipt' ELSE NULL::text END AS client_request_id FROM generate_series(1,64) i");
 await client.query('CREATE TEMP TABLE sop_s3_snapshot_input(snapshot jsonb NOT NULL,expected_sha256 text NOT NULL) ON COMMIT DROP');
 await client.query('INSERT INTO pg_temp.sop_s3_snapshot_input SELECT snapshot,snapshot->>\'sha256\' FROM ('+exporter+') x');
 await client.query("UPDATE pg_temp.sop_s3_snapshot_input SET expected_sha256=repeat('0',64)");
 await rejectsWithin('bad_hash','SOP_S3_BAD_COUNT_OR_DIGEST');
 await check('SELECT count(*)=0 AS failed_import_no_rows FROM pg_temp.mvp_knowledge_items');
 await client.query("UPDATE pg_temp.sop_s3_snapshot_input SET expected_sha256=snapshot->>'sha256'");
 await client.query(importer);
 await check("SELECT (SELECT count(*) FROM pg_temp.mvp_knowledge_items)=64 AS all_rows,(SELECT count(*) FROM pg_temp.mvp_knowledge_items WHERE client_request_id IS NULL)=63 AS null_preserved,(SELECT last_value FROM pg_temp.mvp_knowledge_sequences WHERE year=2026)=64 AS sequence_64,(SELECT phase='LEGACY' AND length(source_snapshot_hash)=64 FROM pg_temp.mvp_knowledge_authority WHERE id=1) AS writer_blocked,(SELECT count(*) FROM pg_temp.mvp_knowledge_requests)=0 AS no_requests, NOT EXISTS((SELECT "+cols+" FROM pg_temp.mvp_knowledge_items EXCEPT SELECT * FROM pg_temp.sop_s3_source) UNION ALL (SELECT * FROM pg_temp.sop_s3_source EXCEPT SELECT "+cols+" FROM pg_temp.mvp_knowledge_items)) AS all_18_fields_equal");
 await client.query('CREATE TEMP TABLE sop_s3_before_replay AS SELECT * FROM pg_temp.mvp_knowledge_authority');
 await client.query(importer);
 await check('SELECT (SELECT count(*) FROM pg_temp.mvp_knowledge_items)=64 AS replay_no_duplicate, NOT EXISTS(SELECT * FROM pg_temp.mvp_knowledge_authority EXCEPT SELECT * FROM pg_temp.sop_s3_before_replay) AS replay_no_authority_change');
 await client.query('SAVEPOINT sop_s3_tamper');
 await client.query("UPDATE pg_temp.mvp_knowledge_items SET title='synthetic changed' WHERE knowledge_id='KNW-2026-0001'");
 await rejectsWithin('bad_target','SOP_S3_TARGET_DIGEST_MISMATCH');
 await client.query('ROLLBACK TO SAVEPOINT sop_s3_tamper');
 await client.query(importer);
 await client.query('ROLLBACK TO SAVEPOINT sop_s3_rehearsal');
 await check("SELECT to_regclass('pg_temp.mvp_knowledge_items') IS NULL AND to_regclass('pg_temp.mvp_knowledge_authority') IS NULL AND to_regclass('pg_temp.sop_s3_source') IS NULL AND to_regclass('pg_temp.sop_s3_snapshot_input') IS NULL AS rollback_ok");
 await client.query('ROLLBACK');
 console.log('SOP_S3_64_ROWS_18_FIELDS_NULL_MICROSECONDS_SEQUENCE_FENCE_REPLAY_DIGEST_ROLLBACK_PASS');
}finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
