import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {historicalCrmArchivePage} from '../crm-historical-archive.mjs';

const URL_LOCAL=process.env.TEST_DATABASE_URL||'';
const batch='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const counts={LEAD:33,CLIENT:17,OBJECT:19,WORKER:2,WORK_ORDER:22,CLIENT_ASSESSMENT:13,WORKER_ASSIGNMENT:1,FINANCE_TRANSACTION:24};
const sourceId='LEGACY_TEST_LEAD_002';
test('CRM H27: real PG17 readonly query, hash and stable keyset; rollback fake fixtures',async t=>{
 if(!URL_LOCAL){t.skip('TEST_DATABASE_URL required');return;}
 const u=new URL(URL_LOCAL);
 if(!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!=='/vbos_mvp_ci')
  throw Error('CRM_H27_DISPOSABLE_POSTGRES_REQUIRED');
 const client=new Client({connectionString:URL_LOCAL,ssl:false});
 await client.connect();
 try{
  await client.query('BEGIN');
  await client.query('CREATE SCHEMA IF NOT EXISTS mvp_history');
  await client.query('CREATE TABLE mvp_history.import_batches(batch_id text primary key,expected_counts jsonb,evidence_manifest_sha256 text)');
  await client.query('CREATE TABLE mvp_history.batch_receipts(batch_id text,receipt_kind text,verified_manifest_sha256 text,reconciled_counts jsonb)');
  await client.query('CREATE TABLE mvp_history.source_records(import_batch_id text,source_kind text,source_id text,source_system text,original_status text,client_source_id text,object_source_id text,lead_source_id text,source_payload jsonb,payload_sha256 text)');
  await client.query('CREATE TABLE public.mvp_legacy_import_map(source_system text,source_entity text,source_id text,target_id uuid)');
  const manifest='a'.repeat(64);
  await client.query('INSERT INTO mvp_history.import_batches VALUES ($1,$2,$3)',[batch,counts,manifest]);
  await client.query('INSERT INTO mvp_history.batch_receipts VALUES ($1,$2,$3,$4)',
   [batch,'RECONCILED_IN_ISOLATED_TEST',manifest,counts]);
  for(const [id,name] of [['LEGACY_TEST_LEAD_001','Первый'],[sourceId,'Второй']]){
   const payload={leadId:id,name,status:'new',phone:'010000000',needSummary:'Ремонт'};
   await client.query(`INSERT INTO mvp_history.source_records
    (import_batch_id,source_kind,source_id,source_system,original_status,source_payload,payload_sha256)
    VALUES ($1,'LEAD',$2,'LEGACY_GOOGLE','new',$3,
     encode(sha256(convert_to($3::jsonb::text,'UTF8')),'hex'))`,
    [batch,id,JSON.stringify(payload)]);
  }
  const auth=()=>true;
  const one=await historicalCrmArchivePage(client,new URL('http://localhost/api/history/crm?type=leads&limit=1'),
   {authorizeOwner:auth,batchId:batch});
  assert.equal(one.items.length,1);
  assert.equal(one.items[0].legacy_id,sourceId);
  assert.equal(one.items[0].native_link_verified,false);
  assert.equal(one.hasMore,true);
  assert.equal(one.nextCursor,sourceId);
  const two=await historicalCrmArchivePage(client,new URL('http://localhost/api/history/crm?type=leads&limit=1&cursor='+sourceId),
   {authorizeOwner:auth,batchId:batch});
  assert.equal(two.items[0].legacy_id,'LEGACY_TEST_LEAD_001');
  assert.equal(two.hasMore,false);
  const search=await historicalCrmArchivePage(client,new URL('http://localhost/api/history/crm?type=leads&q='+encodeURIComponent('Второй')),
   {authorizeOwner:auth,batchId:batch});
  assert.equal(search.items.length,1);
  assert.equal(search.items[0].title,'Второй');
  await client.query("UPDATE mvp_history.source_records SET payload_sha256=$1 WHERE source_id=$2",
   ['0'.repeat(64),sourceId]);
  await assert.rejects(
   historicalCrmArchivePage(client,new URL('http://localhost/api/history/crm?type=leads&limit=20'),
    {authorizeOwner:auth,batchId:batch}),
   err=>err.status===503);
 }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
});
