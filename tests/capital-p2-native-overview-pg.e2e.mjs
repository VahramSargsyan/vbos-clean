/**
 * Capital P2 — genuine PostgreSQL 17 read E2E with synthetic money.
 * MUST run after finance-p1-native-summary-pg.e2e.mjs in the same ephemeral
 * localhost/vbos_mvp_ci database; uses its signed-shape source fixture.
 * Never run against Neon, Render or PROD.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {readNativeCapitalOverview,NativeCapitalOverviewError}
 from '../domains/finance/capital-native-overview-history.mjs';

const uri=process.env.TEST_DATABASE_URL||'';
let url;
try{url=new URL(uri);}catch{throw Error('CAPITAL_P2_DISPOSABLE_PG_REQUIRED');}
if(!['postgres:','postgresql:'].includes(url.protocol)||
  !['127.0.0.1','localhost'].includes(url.hostname)||
  url.pathname!=='/vbos_mvp_ci')
 throw Error('CAPITAL_P2_DISPOSABLE_PG_REQUIRED');
const pool=new pg.Pool({connectionString:uri,ssl:false,max:4});
const today='2026-11-23';
const q=(sql,args=[])=>pool.query(sql,args);
const params=o=>new URLSearchParams(o);
const run=o=>readNativeCapitalOverview(pool,params(o),{authorizeOwner:()=>true});
const mu=()=>randomUUID();
const counts={
 FINANCE_TRANSACTION:24,FINANCE_BALANCE:30,BUSINESS_MONTHLY_GAIN:3,
 CAPITAL_FUND:8,CAPITAL_ALLOCATION_BATCH:1,CAPITAL_FUND_TRANSACTION:6,
 CAPITAL_FUND_BALANCE:8
};
let a,b,c,allocationId,transferId,spendId,reversalId;
async function setup(){
 const name=(await q('SELECT current_database() name')).rows[0].name;
 assert.equal(name,'vbos_mvp_ci','destructive fixture can only target ephemeral CI database');
 const original=(await q('SELECT phase,financial_write_authority FROM mvp_finance_native.cutover_control WHERE id=1')).rows[0];
 assert.deepEqual(original,{phase:'ACTIVE',financial_write_authority:'POSTGRES'});
 assert.equal((await q('SELECT count(*)::int n FROM mvp_finance_native.fund_movements')).rows[0].n,0,
  'requires P1 synthetic clean fixture, not an occupied database');
 assert.equal((await q('SELECT count(*)::int n FROM mvp_finance_native.funds')).rows[0].n,8);
 assert.equal((await q("SELECT count(*)::int n FROM mvp_history.source_records WHERE source_kind='FINANCE_TRANSACTION'")).rows[0].n,24);
 const funds=(await q(
  'SELECT fund_id::text id,legacy_source_id FROM mvp_finance_native.funds ORDER BY legacy_source_id')).rows;
 a=funds[0].id;b=funds[1].id;c=funds[2].id;
 // P1 leaves real-shaped funds at schema defaults; add a synthetic target for P2 source readback.
 await q('UPDATE mvp_finance_native.funds SET target_amount_base=$1 WHERE fund_id=$2',
  ['2000000.000000',a]);
 const signed=(await q('SELECT google_manifest_sha256,crm_bridge_sha256 FROM mvp_finance_native.post_fence_attestations')).rows[0];
 assert.ok(signed?.google_manifest_sha256&&signed?.crm_bridge_sha256);
 Object.assign(process.env,{
  FINANCE_NATIVE_POSTING_ENABLE:'OWNER_APPROVED_CLEAN_TEST',
  RENDER_SERVICE_ID:'srv-dbkvfh2jnfac73a31nv0',
  FINANCE_NATIVE_FROZEN_MANIFEST_SHA256:signed.google_manifest_sha256,
  FINANCE_NATIVE_CRM_BRIDGE_SHA256:signed.crm_bridge_sha256,
  DATABASE_URL:uri
 });
 const income=(await q("SELECT finance_transaction_id::text id FROM mvp_finance_native.transactions WHERE operation_type='INCOME' ORDER BY finance_transaction_id LIMIT 1")).rows[0];
 assert.ok(income?.id,'P1 fixture must contain a synthetic INCOME for batch relationship');
 const batch=mu(),requestKey='FINCAP|'+income.id;
 await q('INSERT INTO mvp_finance_native.fincap_batches('+
  'batch_id,finance_transaction_id,client_request_id,source_type,total_amount_base,transaction_date_key)'+
  'VALUES($1,$2,$3,$4,$5,$6)',[batch,income.id,requestKey,'OPERATING_PROFIT','200',today]);
 const insert=async(type,{from=null,to=null,amount,reverse=null,at})=>{
  const id=mu();
  await q('INSERT INTO mvp_finance_native.fund_movements('+
    'movement_id,request_key,movement_type,transaction_date_key,from_fund_id,to_fund_id,'+
    'allocation_batch_id,reversal_of,amount_base,created_at) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz)',
    [id,mu(),type,today,from,to,type==='ALLOCATION'?batch:null,
     reverse,amount,at]);
  return id;
 };
 const effect=(id,fund,delta)=>q(
  'INSERT INTO mvp_finance_native.fund_effects(movement_id,fund_id,balance_delta_base) VALUES($1,$2,$3)',
  [id,fund,delta]);
 allocationId=await insert('ALLOCATION',{
  to:a,amount:'200',at:'2026-11-23 10:00:00.123455+00'});
 await effect(allocationId,a,'200');
 transferId=await insert('TRANSFER',{
  from:a,to:c,amount:'100',at:'2026-11-23 10:00:00.123456+00'});
 await effect(transferId,a,'-100');await effect(transferId,c,'100');
 spendId=await insert('SPEND',{
  from:c,amount:'40',at:'2026-11-23 10:00:00.123456+00'});
 await effect(spendId,c,'-40');
 // Original stays in the history but its status changes; both effects remain
 // immutable. The reversal gets compensating effects, not a balance overwrite.
 await q("UPDATE mvp_finance_native.fund_movements SET status='reversed' WHERE movement_id=$1",
  [transferId]);
 reversalId=await insert('REVERSAL',{
  amount:'100',reverse:transferId,at:'2026-11-23 10:00:00.123457+00'});
 await effect(reversalId,a,'100');await effect(reversalId,c,'-100');
}
test('Capital P2 real disposable PG17 exact eight fund opening/effects/history and safety',async t=>{
 try{
  await setup();
  await t.test('native 3-card totals: allocation +200, net transfer 0, expense -40',async()=>{
   const p=await run({});
   assert.equal(p.version,'CAPITAL_P2_NATIVE_OVERVIEW_V1');
   assert.equal(p.readonly,true);assert.equal(p.historicalIncluded,false);
   assert.equal(p.funds.length,8);
   assert.deepEqual(p.summary,{
    totalReservedBase:'10160.000000',protectiveBase:'3200.000000',
    growthBase:'6960.000000',openingBase:'10000.000000',
    nativeDeltaBase:'160.000000'
   });
   const fa=p.funds.find(x=>x.id===a),fc=p.funds.find(x=>x.id===c);
   assert.equal(fa.balanceBase,'1200.000000');
   assert.equal(fa.allocatedBase,'200.000000');
   assert.equal(fa.transferredOutBase,'100.000000');
   assert.equal(fa.reversalNetBase,'100.000000');
   assert.equal(fc.balanceBase,'1960.000000');
   assert.equal(fc.transferredInBase,'100.000000');
   assert.equal(fc.spentBase,'40.000000');
   assert.equal(fc.reversalNetBase,'-100.000000');
   assert.equal(fa.targetBase,'2000000.000000');
   assert.equal(p.funds.find(x=>x.id===b).balanceBase,'2000.000000');
  });
  await t.test('full native history keyset across same-microsecond timestamps',async()=>{
   const seen=new Set();let cursor=null,rows=[];
   do{
    const p=await run({limit:'1',...(cursor?{cursor}:{})});
    assert.ok(p.items.length<=1);
    for(const x of p.items){
     assert.equal(seen.has(x.id),false,'keyset duplicate');
     seen.add(x.id);rows.push(x);
     assert.ok(x.effects.length>=1);
    }
    cursor=p.nextCursor;
    assert.ok(seen.size<=4);
   }while(cursor);
   assert.equal(seen.size,4);
   assert.deepEqual(new Set(rows.map(r=>r.type)),new Set(['ALLOCATION','TRANSFER','SPEND','REVERSAL']));
   assert.equal(rows.find(x=>x.id===transferId).status,'reversed');
   assert.equal(rows.find(x=>x.id===reversalId).reversalOf,transferId);
  });
  await t.test('scope fund via real effect relation, including original and reversal',async()=>{
   const protect=await run({fundId:a,limit:'50'});
   assert.equal(protect.items.length,3);
   assert.ok(!protect.items.some(x=>x.id===spendId));
   const grow=await run({fundId:c,limit:'50'});
   assert.equal(grow.items.length,3);
   assert.ok(!grow.items.some(x=>x.id===allocationId));
   const second=await run({fundId:b});
   assert.equal(second.items.length,0);
   assert.equal(second.summary.totalReservedBase,'10160.000000',
    'history scope must never alter global current fund totals');
  });
  await t.test('type, status, date filters only history; status reversed original visible',async()=>{
   const p=await run({movementType:'TRANSFER',status:'reversed'});
   assert.equal(p.items.length,1);
   assert.equal(p.items[0].id,transferId);
   assert.equal(p.summary.protectiveBase,'3200.000000');
   const later=await run({dateFrom:'2026-11-24'});
   assert.equal(later.items.length,0);
   assert.equal(later.summary.totalReservedBase,'10160.000000');
   const spent=await run({movementType:'SPEND'});
   assert.equal(spent.items[0].amountBase,'40.000000');
  });
  await t.test('owner reject, legacy fund reject, cross-scope cursor replay reject',async()=>{
   await assert.rejects(readNativeCapitalOverview(pool,params(),{authorizeOwner:()=>false}),
    e=>e instanceof NativeCapitalOverviewError&&e.status===401);
   await assert.rejects(run({fundId:'FND-2026-0001'}),
    e=>e instanceof NativeCapitalOverviewError&&e.status===400);
   const p=await run({fundId:a,limit:'1'});
   await assert.rejects(run({fundId:c,limit:'1',cursor:p.nextCursor}),
    e=>e instanceof NativeCapitalOverviewError&&e.status===400);
  });
  await t.test('concurrent read-only GET cannot mutate capital fund balances',async()=>{
   const before=(await q('SELECT count(*)::int n FROM mvp_finance_native.fund_movements')).rows[0].n;
   await Promise.all([run({}),run({fundId:a}),run({status:'active'})]);
   const after=(await q('SELECT count(*)::int n FROM mvp_finance_native.fund_movements')).rows[0].n;
   assert.equal(before,4);assert.equal(after,before);
  });
  console.log('CAPITAL_P2_REAL_DISPOSABLE_PG17_TOTALS_EFFECTS_KEYSET_OWNER_PASS');
 }finally{await pool.end();}
});
