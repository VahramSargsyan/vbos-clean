/**
 * Finance B21 — DISPOSABLE PostgreSQL 17 TEST only.
 * Synthetic archive records and owner receipt; NEVER Neon / Render / PROD.
 * Run standalone in a clean vbos_mvp_ci database.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {hostedFinancePostingReadiness} from '../domains/finance/native-finance-writer.mjs';

const uri=process.env.TEST_DATABASE_URL||'';
let url;
try{url=new URL(uri);}catch{throw Error('B21_LOCAL_DISPOSABLE_PG_REQUIRED');}
if(!['postgres:','postgresql:'].includes(url.protocol)||
   !['localhost','127.0.0.1'].includes(url.hostname)||
   url.pathname!=='/vbos_mvp_ci')
 throw Error('B21_LOCAL_DISPOSABLE_PG_REQUIRED');
const pool=new pg.Pool({connectionString:uri,ssl:false,max:1});
const migration=readFileSync(
 new URL('../migrations/0037_finance_postfence_attestation_CANDIDATE_TEST_ONLY.sql',import.meta.url),
 'utf8');
const openingId='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const openingSha='8bdfd30faa9e45785f928c2861d7e3645a9dd168bb6d678004c0df730a04871d';
const googleId='13LRWLgHJQb24WXOsPLCIP2W8ZIaSX9AI3sfXJgF2-y8';
const copyId='1jN8nuyFOCozJ3rEeOhIMOVLrbRhkfY8VGkPSiFsvhH0';
const modified='2026-11-22T16:39:20.917Z';
const captured='2026-11-22T17:04:23.012Z';
const counts={
 FINANCE_TRANSACTION:24,FINANCE_BALANCE:30,BUSINESS_MONTHLY_GAIN:3,
 CAPITAL_FUND:8,CAPITAL_ALLOCATION_BATCH:1,CAPITAL_FUND_TRANSACTION:6,
 CAPITAL_FUND_BALANCE:8
};
const q=sql=>pool.query(sql);
const columns='snapshot_id,original_snapshot_id,original_manifest_sha256,'+
 'google_manifest_sha256,crm_bridge_sha256,google_spreadsheet_id,source_copy_id,'+
 'google_modified_at,captured_at,google_prod_version,source_record_count,'+
 'expected_counts,legacy_link_policy,owner_identity_approved,'+
 'owner_attestation_ref,signed_at';
async function buildReceipt(snapshot='SYNTHETIC_B21_POST_FENCE_R1'){
 const sha=(await pool.query(
  'SELECT mvp_finance_native.post_fence_archived_source_sha256($1,$2,$3,$4,$5) AS sha',
  [googleId,copyId,modified,captured,93])).rows[0].sha;
 const bridge=(await q(
  'SELECT mvp_finance_native.post_fence_archive_only_bridge_sha256() AS sha')).rows[0].sha;
 return [snapshot,openingId,openingSha,sha,bridge,googleId,copyId,modified,captured,
  93,80,JSON.stringify(counts),'ARCHIVE_ONLY_NO_UUID_BRIDGE',true,
  'SYNTHETIC_TEST_ONLY_OWNER_ATTESTATION_NOT_REAL','2026-11-22T17:10:00.000Z'];
}
const insert=vals=>pool.query(
 'INSERT INTO mvp_finance_native.post_fence_attestations('+columns+') '+
 'VALUES('+Array.from({length:16},(_,i)=>'$'+(i+1)).join(',')+')',vals);

test('Finance B21 source-verified post-fence attestation is separate from historical archive',async t=>{
 try{
  // Only the disposable vbos_mvp_ci DB; no drop or external database access.
  await q('CREATE SCHEMA mvp_history');
  await q('CREATE SCHEMA mvp_finance_stage');
  await q('CREATE SCHEMA mvp_finance_native');
  await q('CREATE TABLE mvp_history.source_records(source_kind text NOT NULL,source_id text NOT NULL,source_payload jsonb NOT NULL)');
  await q('CREATE TABLE mvp_finance_stage.source_facts(source_kind text NOT NULL,source_id text NOT NULL,source_payload jsonb NOT NULL)');
  await q('CREATE TABLE mvp_finance_stage.control_snapshots(source_kind text NOT NULL,source_id text NOT NULL,source_payload jsonb NOT NULL)');
  await q("CREATE TABLE mvp_finance_stage.freeze_manifests("+
   "snapshot_id text PRIMARY KEY,google_manifest_sha256 text NOT NULL,"+
   "owner_identity_approved boolean NOT NULL DEFAULT false CHECK(owner_identity_approved=false),"+
   "financial_write_authority text NOT NULL DEFAULT 'GOOGLE' CHECK(financial_write_authority='GOOGLE'),"+
   "source_system text NOT NULL DEFAULT 'LEGACY_GOOGLE' CHECK(source_system='LEGACY_GOOGLE'))");
  await pool.query('INSERT INTO mvp_finance_stage.freeze_manifests(snapshot_id,google_manifest_sha256) VALUES($1,$2)',
   [openingId,openingSha]);
  for(const [table,kind,count] of [
    ['mvp_history.source_records','FINANCE_TRANSACTION',24],
    ['mvp_finance_stage.source_facts','BUSINESS_MONTHLY_GAIN',3],
    ['mvp_finance_stage.source_facts','CAPITAL_FUND',8],
    ['mvp_finance_stage.source_facts','CAPITAL_ALLOCATION_BATCH',1],
    ['mvp_finance_stage.source_facts','CAPITAL_FUND_TRANSACTION',6],
    ['mvp_finance_stage.control_snapshots','FINANCE_BALANCE',30],
    ['mvp_finance_stage.control_snapshots','CAPITAL_FUND_BALANCE',8]]){
    for(let i=0;i<count;i++){
      await pool.query('INSERT INTO '+table+'(source_kind,source_id,source_payload) VALUES($1,$2,$3::jsonb)',
       [kind,kind+'_'+(i+1),JSON.stringify({synthetic:true,amount:i+1,currency:'AMD'})]);
    }
  }
  await t.test('migration additive and repeatable; no receipt inserted automatically',async()=>{
   await pool.query(migration);await pool.query(migration);
   assert.equal((await q('SELECT count(*)::int n FROM mvp_finance_native.post_fence_attestations')).rows[0].n,0);
   const archived=(await q('SELECT owner_identity_approved,financial_write_authority FROM mvp_finance_stage.freeze_manifests')).rows[0];
   assert.deepEqual(archived,{owner_identity_approved:false,financial_write_authority:'GOOGLE'});
  });
  await t.test('forged source/bridge checksum and missing owner approval rejected',async()=>{
   const vals=await buildReceipt();
   const bad=[...vals];bad[3]='f'.repeat(64);
   await assert.rejects(insert(bad),/B21_FROZEN_SOURCE_OR_BRIDGE_SHA_MISMATCH/);
   const denied=[...vals];denied[13]=false;
   await assert.rejects(insert(denied),/owner_identity_approved/);
   const forged=[...vals];forged[4]='0'.repeat(64);
   await assert.rejects(insert(forged),/B21_FROZEN_SOURCE_OR_BRIDGE_SHA_MISMATCH/);
   assert.equal((await q('SELECT count(*)::int n FROM mvp_finance_native.post_fence_attestations')).rows[0].n,0);
  });
  await t.test('synthetic approved receipt immutable, historical archive approval still blocked',async()=>{
   const vals=await buildReceipt();
   await insert(vals);
   const r=(await q('SELECT snapshot_id,google_manifest_sha256,crm_bridge_sha256 FROM mvp_finance_native.post_fence_attestations')).rows[0];
   assert.equal(r.snapshot_id,vals[0]);assert.equal(r.google_manifest_sha256,vals[3]);
   assert.equal(r.crm_bridge_sha256,vals[4]);
   await assert.rejects(q('UPDATE mvp_finance_native.post_fence_attestations SET source_record_count=79'),
    /B21_RECEIPT_IMMUTABLE/);
   await assert.rejects(q('DELETE FROM mvp_finance_native.post_fence_attestations'),
    /B21_RECEIPT_IMMUTABLE/);
   await assert.rejects(q('UPDATE mvp_finance_stage.freeze_manifests SET owner_identity_approved=true'),
    /owner_identity_approved/);
  });
  await t.test('hosted B17 readiness requires this signed receipt and original opening; still no writes',async()=>{
   // Exact archived values are synthetic test fixtures here; no Neon access.
   await q('CREATE TABLE mvp_finance_native.opening_snapshot('+
    'as_of_date date,opening_cash_base numeric(24,6),opening_profit_base numeric(24,6),'+
    'opening_worker_payable_base numeric(24,6))');
   await q("INSERT INTO mvp_finance_native.opening_snapshot VALUES("+
    "'2026-09-30',203000.000000,588000.000000,0.000000)");
   await q('CREATE TABLE mvp_finance_native.fund_openings(opening_balance_base numeric(24,6))');
   await q("INSERT INTO mvp_finance_native.fund_openings SELECT 1250.000000 FROM generate_series(1,8)");
   const receipt=await buildReceipt();
   const g={
    phase:'ACTIVE',financial_write_authority:'POSTGRES',
    owner_identity_approved:true,google_frozen_confirmed:true,
    cutover_date_key:'2026-10-01',expected_fund_count:8,
    snapshot_id:openingId,manifest_sha256:openingSha,
    crm_bridge_sha256:receipt[4]
   };
   const old={};
   for(const key of ['FINANCE_NATIVE_POSTING_ENABLE','RENDER_SERVICE_ID',
     'FINANCE_NATIVE_FROZEN_MANIFEST_SHA256','FINANCE_NATIVE_CRM_BRIDGE_SHA256',
     'DATABASE_URL'])old[key]=process.env[key];
   Object.assign(process.env,{
    FINANCE_NATIVE_POSTING_ENABLE:'OWNER_APPROVED_CLEAN_TEST',
    RENDER_SERVICE_ID:'srv-dbkvfh2jnfac73a31nv0',
    FINANCE_NATIVE_FROZEN_MANIFEST_SHA256:receipt[3],
    FINANCE_NATIVE_CRM_BRIDGE_SHA256:receipt[4],
    DATABASE_URL:uri
   });
   const c=await pool.connect();
   try {
    const positive=await hostedFinancePostingReadiness(pool,c,g);
    assert.deepEqual(positive,{ready:true,reason:'SIGNED_SINGLE_WRITER_READY'});
    const wrongOwner=await hostedFinancePostingReadiness(pool,c,{...g,owner_identity_approved:false});
    assert.deepEqual(wrongOwner,{ready:false,reason:'B17_SOURCE_AUTHORITY_NOT_APPROVED'});
    const disabled=await hostedFinancePostingReadiness(pool,c,{...g,google_frozen_confirmed:false});
    assert.deepEqual(disabled,{ready:false,reason:'B17_SOURCE_AUTHORITY_NOT_APPROVED'});
    process.env.FINANCE_NATIVE_FROZEN_MANIFEST_SHA256='0'.repeat(64);
    const wrongSource=await hostedFinancePostingReadiness(pool,c,g);
    assert.deepEqual(wrongSource,{ready:false,reason:'B17_POST_FENCE_SNAPSHOT_NOT_OWNER_ACCEPTED'});
   }finally{
    c.release();
    for(const [key,value] of Object.entries(old)){
     if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
   }
  });
  await t.test('new archive row after freeze is not accepted even if hash recomputed',async()=>{
   await pool.query('INSERT INTO mvp_finance_stage.source_facts VALUES($1,$2,$3::jsonb)',
    ['CAPITAL_FUND','EXTRA_SYNTHETIC',JSON.stringify({synthetic:true})]);
   const vals=await buildReceipt('SYNTHETIC_B21_AFTER_SOURCE_DRIFT');
   await assert.rejects(insert(vals),/B21_FROZEN_SOURCE_OR_BRIDGE_SHA_MISMATCH/);
   assert.equal((await q('SELECT count(*)::int n FROM mvp_finance_native.post_fence_attestations')).rows[0].n,1);
  });
 }finally{await pool.end();}
});
