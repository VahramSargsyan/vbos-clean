/**
 * P4 genuine disposable PG17 cross-check against P1's CURRENT native financial scope.
 * Runs after P1, P2, P3 tests, all on localhost /vbos_mvp_ci only. READ ONLY.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readNativeFinanceEntityResults,NativeFinanceEntityResultsError}
 from '../domains/finance/finance-p4-native-entity-results.mjs';
import {readNativeFinanceHistory}
 from '../domains/finance/finance-native-summary-history.mjs';

const uri=process.env.TEST_DATABASE_URL||'';
let url;
try{url=new URL(uri);}catch{throw Error('FINANCE_P4_DISPOSABLE_PG17_REQUIRED');}
if(!['postgres:','postgresql:'].includes(url.protocol)||
 !['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/vbos_mvp_ci')
 throw Error('FINANCE_P4_DISPOSABLE_PG17_REQUIRED');
const pool=new pg.Pool({connectionString:uri,ssl:false,max:4});
const run=(args={})=>readNativeFinanceEntityResults(pool,new URLSearchParams(args),{
 authorizeOwner:()=>true});
test('Finance P4 REAL disposable PG17: exact P1 object/worker sums, no Google joins or money writes',async t=>{
 try{
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name,'vbos_mvp_ci');
  assert.equal((await pool.query('SELECT count(*)::int n FROM mvp_finance_native.funds')).rows[0].n,8);
  assert.equal((await pool.query('SELECT count(*)::int n FROM mvp_history.source_records '+
   "WHERE source_kind='FINANCE_TRANSACTION'")).rows[0].n,24);
  const signed=(await pool.query('SELECT google_manifest_sha256,crm_bridge_sha256 '+
   'FROM mvp_finance_native.post_fence_attestations')).rows[0];
  assert.ok(signed?.google_manifest_sha256&&signed?.crm_bridge_sha256);
  Object.assign(process.env,{
   FINANCE_NATIVE_POSTING_ENABLE:'OWNER_APPROVED_CLEAN_TEST',
   RENDER_SERVICE_ID:'srv-dbkvfh2jnfac73a31nv0',
   FINANCE_NATIVE_FROZEN_MANIFEST_SHA256:signed.google_manifest_sha256,
   FINANCE_NATIVE_CRM_BRIDGE_SHA256:signed.crm_bridge_sha256,
   DATABASE_URL:uri
  });
  const before=(await pool.query('SELECT count(*)::int n FROM mvp_finance_native.transactions')).rows[0].n;
  await t.test('object group includes two orders and archived count, source values match P1',async()=>{
   const result=await run({kind:'objects'});
   assert.equal(result.source,'CLEAN_NATIVE_FINANCE_ONLY');
   assert.equal(result.historicalIncluded,false);assert.equal(result.readonly,true);
   assert.equal(result.items.length,1);
   const o=result.items[0];assert.equal(o.label,'P1_SYNTHETIC_OBJECT');
   assert.equal(o.totalCount,9);assert.equal(o.activeCount,8);assert.equal(o.archivedCount,1);
   const p1=await readNativeFinanceHistory(pool,new URLSearchParams({objectId:o.id}),{
    authorizeOwner:()=>true});
   assert.equal(p1.scopeLabel,'OBJECT');
   for(const key of ['earnedBase','receivedBase','economicExpenseBase','profitBase',
    'cashBalanceBase','workerPaidBase','workerPayableBase','ownerTransferBase']){
    assert.equal(o.metrics[key],p1.summary[key],key);
   }
   assert.equal(o.metrics.receivedBase,'1279.000000');
   assert.equal(o.metrics.profitBase,'1153.000000');
   assert.equal(o.metrics.cashBalanceBase,'1178.000000');
   assert.equal(o.metrics.workerAccruedBase,'30.000000');
   assert.equal(result.hasMore,false);assert.equal(result.nextCursor,null);
  });
  await t.test('worker reflects accrual/payment/debt, not all-business sales or Google history',async()=>{
   const result=await run({kind:'workers'});
   assert.equal(result.items.length,1);
   const w=result.items[0];assert.equal(w.label,'P1_SYNTHETIC_WORKER');
   assert.equal(w.totalCount,2);assert.equal(w.activeCount,2);assert.equal(w.archivedCount,0);
   assert.equal(w.metrics.workerAccruedBase,'30.000000');
   assert.equal(w.metrics.workerPaidBase,'15.000000');
   assert.equal(w.metrics.workerPayableBase,'15.000000');
   const p1=await readNativeFinanceHistory(pool,new URLSearchParams({workerId:w.id}),{
    authorizeOwner:()=>true});
   for(const key of ['workerPaidBase','workerPayableBase','economicExpenseBase'])
    assert.equal(w.metrics[key],p1.summary[key],key);
  });
  await t.test('case-insensitive name search works; nonexistent name produces no wrong matches',async()=>{
   const yes=await run({kind:'objects',q:'synthetic_object',limit:'1'});
   assert.equal(yes.items.length,1);
   const none=await run({kind:'objects',q:'unrelated-record'});
   assert.equal(none.items.length,0);
   const worker=await run({kind:'workers',q:'synthetic_worker'});
   assert.equal(worker.items.length,1);
  });
  await t.test('owner and invalid query refuse before reads and current ledger remains unchanged',async()=>{
   await assert.rejects(readNativeFinanceEntityResults(pool,new URLSearchParams({kind:'workers'}),
    {authorizeOwner:()=>false}),
    e=>e instanceof NativeFinanceEntityResultsError&&e.status===401);
   await assert.rejects(run({kind:'LEGACY_GOOGLE'}),/INVALID_KIND/);
   await assert.rejects(run({kind:'objects',q:'a'}),/INVALID_SEARCH/);
   const after=(await pool.query('SELECT count(*)::int n FROM mvp_finance_native.transactions')).rows[0].n;
   assert.equal(after,before);
   assert.equal((await pool.query('SELECT count(*)::int n FROM mvp_history.source_records '+
    "WHERE source_kind='FINANCE_TRANSACTION'")).rows[0].n,24);
  });
  console.log('FINANCE_P4_DISPOSABLE_PG17_OBJECT_WORKER_NATIVE_AGGREGATION_P1_PARITY_PASS');
 }finally{await pool.end();}
});
