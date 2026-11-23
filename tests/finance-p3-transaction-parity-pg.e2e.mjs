/**
 * Finance P3 genuine PostgreSQL 17 E2E, synthetic IDs only, after Finance P1 + Capital P2
 * E2E have populated the disposable /vbos_mvp_ci fixture. Never use occupied Neon.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {readNativeFinanceTransactionDetail,NativeFinanceTransactionDetailError}
 from '../domains/finance/finance-p3-transaction-detail.mjs';
import {postNativeFinanceCapital} from '../domains/finance/native-finance-writer.mjs';

const uri=process.env.TEST_DATABASE_URL||'';
let url;
try{url=new URL(uri);}catch{throw Error('FINANCE_P3_DISPOSABLE_PG17_REQUIRED');}
if(!['postgres:','postgresql:'].includes(url.protocol)||
 !['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/vbos_mvp_ci')
 throw Error('FINANCE_P3_DISPOSABLE_PG17_REQUIRED');
const pool=new pg.Pool({connectionString:uri,ssl:false,max:4});
const read=id=>readNativeFinanceTransactionDetail(pool,id,{authorizeOwner:()=>true});
const post=(action,payload)=>postNativeFinanceCapital(pool,{
 action,requestKey:randomUUID(),payload,context:{syntheticOwnerVerified:true}
});
test('Finance P3 actual disposable PG17 detail + B14 edit/cancel/restore parity',async t=>{
 try{
  assert.equal((await pool.query('SELECT current_database() db')).rows[0].db,'vbos_mvp_ci');
  assert.equal((await pool.query('SELECT count(*)::int n FROM mvp_finance_native.funds')).rows[0].n,8);
  assert.equal((await pool.query('SELECT count(*)::int n FROM mvp_history.source_records WHERE source_kind=$1',
   ['FINANCE_TRANSACTION'])).rows[0].n,24);
  assert.equal((await pool.query('SELECT phase FROM mvp_finance_native.cutover_control WHERE id=1')).rows[0].phase,'ACTIVE');
  // P1/P2 E2E run in separate Node processes. Re-establish the signed
  // synthetic-only source configuration from disposable PostgreSQL evidence.
  const signed=(await pool.query('SELECT google_manifest_sha256,crm_bridge_sha256 FROM '+
   'mvp_finance_native.post_fence_attestations')).rows[0];
  assert.ok(signed?.google_manifest_sha256&&signed?.crm_bridge_sha256);
  Object.assign(process.env,{
   FINANCE_NATIVE_POSTING_ENABLE:'OWNER_APPROVED_CLEAN_TEST',
   RENDER_SERVICE_ID:'srv-dbkvfh2jnfac73a31nv0',
   FINANCE_NATIVE_FROZEN_MANIFEST_SHA256:signed.google_manifest_sha256,
   FINANCE_NATIVE_CRM_BRIDGE_SHA256:signed.crm_bridge_sha256,
   DATABASE_URL:uri,FINANCE_B10_SYNTHETIC_ONLY:'1'
  });
  const original=(await pool.query("SELECT finance_transaction_id::text id,revision FROM mvp_finance_native.transactions "+
   "WHERE operation_type='INCOME' AND status='active' AND normalized->>'category'='current_work' " +
   "AND NOT EXISTS(SELECT 1 FROM mvp_finance_native.fincap_batches b " +
   "WHERE b.finance_transaction_id=mvp_finance_native.transactions.finance_transaction_id) " +
   "ORDER BY finance_transaction_id LIMIT 1")).rows[0];
  assert.ok(original?.id,'requires P1 native synthetic income fixture');
  await t.test('signed owner native detail and canonical relations are ready',async()=>{
   const d=await read(original.id);
   assert.equal(d.version,'FINANCE_P3_NATIVE_DETAIL_V1');
   assert.equal(d.historicalIncluded,false);assert.equal(d.readonly,true);
   assert.equal(d.record.id,original.id);
   assert.equal(d.record.editable,true);
   assert.equal(d.record.operationType,'INCOME');
   assert.ok(d.record.workOrderId);
   await assert.rejects(readNativeFinanceTransactionDetail(pool,original.id,{authorizeOwner:()=>false}),
    e=>e instanceof NativeFinanceTransactionDetailError&&e.status===401);
   await assert.rejects(read('LEGACY_FINANCE_1'),
    e=>e instanceof NativeFinanceTransactionDetailError&&e.status===400);
  });
  await t.test('FINANCE_EDIT reuses B14 writer revision and preserves UUID',async()=>{
   const r=await post('FINANCE_EDIT',{financeTransactionId:original.id,
    expectedRevision:original.revision,patch:{transactionDate:'2026-11-23',notes:'P3_SYNTHETIC_AMEND'}});
   assert.equal(r.synthetic,true);assert.equal(r.action,'FINANCE_EDIT');
   assert.equal(r.revisionAfter,original.revision+1);
   const d=await read(original.id);
   assert.equal(d.record.revision,original.revision+1);
   assert.equal(d.record.notes,'P3_SYNTHETIC_AMEND');
   assert.equal(d.record.workOrderId.length,36);
   await assert.rejects(post('FINANCE_EDIT',{financeTransactionId:original.id,
    expectedRevision:original.revision,patch:{transactionDate:'2026-11-23',notes:'STALE'}}),
    /B14_REVISION_CONFLICT/);
  });
  await t.test('FINANCE_CANCEL and FINANCE_RESTORE preserve the original source',async()=>{
   let d=await read(original.id);
   const canceled=await post('FINANCE_CANCEL',{financeTransactionId:original.id,
    expectedRevision:d.record.revision});
   assert.equal(canceled.statusAfter,'archived');assert.equal(canceled.synthetic,true);
   d=await read(original.id);
   assert.equal(d.record.restorable,true);
   const restored=await post('FINANCE_RESTORE',{financeTransactionId:original.id,
    expectedRevision:d.record.revision});
   assert.equal(restored.statusAfter,'active');
   d=await read(original.id);
   assert.equal(d.record.editable,true);
   assert.equal(d.record.revision,original.revision+3);
   assert.equal(d.record.notes,'P3_SYNTHETIC_AMEND');
  });
  await t.test('archive and linked fund fixture remained isolated',async()=>{
   const archived=(await pool.query("SELECT count(*)::int n FROM mvp_history.source_records WHERE source_kind='FINANCE_TRANSACTION'")).rows[0].n;
   const funds=(await pool.query('SELECT count(*)::int n FROM mvp_finance_native.funds')).rows[0].n;
   const transfers=(await pool.query('SELECT count(*)::int n FROM mvp_finance_native.fund_movements')).rows[0].n;
   assert.equal(archived,24);assert.equal(funds,8);assert.equal(transfers,4);
  });
  console.log('FINANCE_P3_REAL_DISPOSABLE_PG17_DETAIL_EDIT_CANCEL_RESTORE_OWNER_SOURCE_PASS');
 }finally{await pool.end();}
});
