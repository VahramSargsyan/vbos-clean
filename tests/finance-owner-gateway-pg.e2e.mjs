/**
 * B11 owner session/Origin/CSRF gateway and provenance-safe native/history
 * overview — HTTP + disposable PostgreSQL 16. This is a SYNTHETIC harness:
 * the test cookie is NOT a real VBOS owner-session credential.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {financeB11OwnerGateway,readFinanceB11Ledger}
 from '../domains/finance/finance-owner-gateway.mjs';

const conn=process.env.TEST_DATABASE_URL||'';
if(!conn)throw Error('B11_DB_URL_REQUIRED');
const target=new URL(conn);
if(!['localhost','127.0.0.1'].includes(target.hostname)||
  target.pathname!=='/vbos_mvp_ci')throw Error('B11_DISPOSABLE_CI_DATABASE_ONLY');
const pool=new pg.Pool({connectionString:conn,ssl:false,max:6});
const sql=readFileSync(
 new URL('../migrations/0030_finance_native_cutover_CANDIDATE.sql',import.meta.url),'utf8');
const SNAP='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1',
 SHA='c'.repeat(64),BRIDGE_SHA='d'.repeat(64);
const beforeDay='2026-11-10',cutover='2026-11-11';
const uuid=()=>randomUUID();
let asOfVerified=false,sourceStale=false;
const fundRows=Array.from({length:8},(_,i)=>({
 id:uuid(),legacySourceId:'LEGACY-FUND-'+(i+1),
 code:i===0?'OPERATING_RESERVE':i===1?'WARRANTY_RESERVE':'GROWTH_'+i,
 group:i<2?'PROTECTIVE':'GROWTH',opening:i===0?'50.000000':'0.000000'
}));
const legacy=async()=>({
 source:'VERIFIED_LEGACY_FINANCE_CAPITAL_CLEAN_TEST',readonly:true,
 counts:{financeTransactions:24,monthlyGains:3,funds:8,
  allocationBatches:1,fundMovements:6,controlSnapshots:38},
 finance:{currency:'AMD',cashBalanceBase:sourceStale?'5100.000000':'5000.000000',
  profitBase:'2000.000000',workerPayableBase:'0.000000'},
 capital:{funds:fundRows.map(f=>({fundId:f.legacySourceId,code:f.code,
  balanceBase:f.opening}))},
 ...(asOfVerified?{attestedAsOfDate:beforeDay,attestedManifestSha256:SHA}:{})
});
async function counts(){
 const r=await pool.query(
  'SELECT (SELECT count(*)::int FROM mvp_finance_native.transactions) tx,'+
  '(SELECT count(*)::int FROM mvp_finance_native.fincap_batches) batches,'+
  '(SELECT count(*)::int FROM mvp_finance_native.fund_movements) movements,'+
  '(SELECT count(*)::int FROM mvp_finance_native.request_receipts) receipts,'+
  '(SELECT count(*)::int FROM mvp_finance_native.audit_events) audit');
 return r.rows[0];
}
test('Finance B11: owner gateway + immutable historical/native overview',async t=>{
 let server,base;
 try{
  await pool.query('DROP SCHEMA IF EXISTS mvp_finance_native CASCADE');
  const currentDb=await pool.query('SELECT current_database() AS db');
  assert.equal(currentDb.rows[0].db,'vbos_mvp_ci');
  server=createServer(async(req,res)=>{
   let body;
   if(req.method==='POST'){
    let text='';
    for await(const part of req)text+=part;
    try{body=JSON.parse(text);}catch{body=null;}
   }
   const result=await financeB11OwnerGateway({
    method:req.method,path:new URL(req.url,base).pathname,
    body,db:pool,readLegacy:legacy,
    authorizeOwner:async()=>req.headers.cookie==='vbos_sid=synthetic-owner-only',
    verifyOrigin:async()=>req.headers.origin===base,
    verifyCsrf:async()=>req.headers['x-finance-csrf']==='synthetic-csrf',
   });
   res.writeHead(result.status,{
    'Content-Type':'application/json;charset=utf-8',...result.headers});
   res.end(JSON.stringify(result.body));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+server.address().port;
  const get=async(path,{owner=true}={})=>{
   const r=await fetch(base+path,{
    headers:owner?{Cookie:'vbos_sid=synthetic-owner-only'}:{}});
   return {status:r.status,body:await r.json(),headers:r.headers};
  };
  const post=async(payload,{owner=true,origin=true,csrf=true}={})=>{
   const r=await fetch(base+'/api/finance/native-action-preview',{
    method:'POST',headers:{
     'Content-Type':'application/json',
     ...(owner?{Cookie:'vbos_sid=synthetic-owner-only'}:{}),
     ...(origin?{Origin:base}:{}),
     ...(csrf?{'X-Finance-CSRF':'synthetic-csrf'}:{})
    },body:JSON.stringify(payload)});
   return {status:r.status,body:await r.json()};
  };
  const finCreate=(amount='300')=>({
   action:'FINANCE_CREATE',requestKey:uuid(),
   payload:{operationType:'INCOME',category:'bonus',amountOriginal:amount,
    transactionDate:cutover}
  });
  await t.test('no owner session denies both history and money without DB mutation',async()=>{
   const unknown=await get('/api/finance/native-ledger-preview',{owner:false});
   assert.equal(unknown.status,401);
   assert.equal(unknown.body.error,'B11_OWNER_SESSION_REQUIRED');
   const attempt=await post(finCreate(),{owner:false});
   assert.equal(attempt.status,401);
   assert.equal(attempt.body.error,'B11_OWNER_SESSION_REQUIRED');
  });
  await t.test('no native schema: history is separate, read-only and never double counted',async()=>{
   const preview=await get('/api/finance/native-ledger-preview');
   assert.equal(preview.status,200);
   assert.equal(preview.headers.get('cache-control'),'no-store');
   assert.equal(preview.body.phase,'HISTORY_ONLY');
   assert.equal(preview.body.history.cashBalanceBase,'5000.000000');
   assert.equal(preview.body.history.counts.financeTransactions,24);
   assert.equal(preview.body.neverSumLegacyAndNativeOpening,true);
   assert.equal(preview.body.native,null);
   assert.equal(preview.body.combined,null);
   assert.equal(preview.body.reason,'NATIVE_SCHEMA_NOT_INSTALLED');
   assert.ok(!JSON.stringify(preview.body).includes('source_payload'));
  });
  await t.test('Origin and dedicated CSRF are mandatory; synthetic writer disabled by default',async()=>{
   assert.deepEqual(await post(finCreate(),{origin:false}),
    {status:403,body:{error:'B11_ORIGIN_REQUIRED'}});
   assert.deepEqual(await post(finCreate(),{csrf:false}),
    {status:403,body:{error:'B11_CSRF_REQUIRED'}});
   delete process.env.FINANCE_B11_SYNTHETIC_ONLY;
   assert.deepEqual(await post(finCreate()),
    {status:503,body:{error:'B11_LIVE_FINANCIAL_WRITER_DISABLED'}});
   process.env.FINANCE_B11_SYNTHETIC_ONLY='1';
   assert.deepEqual(await post({...finCreate(),context:{syntheticOwnerVerified:true}}),
    {status:400,body:{error:'B11_PAYLOAD_INVALID'}});
  });
  await pool.query(sql);
  await t.test('B9 remains BLOCKED and previews verified old history only',async()=>{
   const preview=await get('/api/finance/native-ledger-preview');
   assert.equal(preview.status,200);
   assert.equal(preview.body.phase,'HISTORY_ONLY');
   assert.equal(preview.body.reason,'NATIVE_WRITER_NOT_ACTIVATED');
   assert.equal(preview.body.combined,null);
   const refused=await post(finCreate());
   assert.equal(refused.status,503);
   assert.equal(refused.body.error,'B11_BACKEND_OPERATION_REJECTED');
   assert.deepEqual(await counts(),{
    tx:0,batches:0,movements:0,receipts:0,audit:0});
  });
  await pool.query(
   'INSERT INTO mvp_finance_native.opening_snapshot('+
   'source_snapshot_id,manifest_sha256,as_of_date,opening_cash_base,'+
   'opening_profit_base,opening_worker_payable_base) VALUES($1,$2,$3,$4,$5,$6)',
   [SNAP,SHA,beforeDay,'5000','2000','0']);
  for(const f of fundRows){
   await pool.query(
    'INSERT INTO mvp_finance_native.funds(fund_id,legacy_source_id,code,'+
    'group_type,status,target_amount_base,allocation_share_pct)'+
    " VALUES($1,$2,$3,$4,'active',0,$5)",
    [f.id,f.legacySourceId,f.code,f.group,f.group==='PROTECTIVE'?0:20]);
   await pool.query(
    'INSERT INTO mvp_finance_native.fund_openings('+
    'fund_id,legacy_balance_source_id,source_snapshot_id,opening_balance_base)'+
    ' VALUES($1,$2,$3,$4)',
    [f.id,'OPEN-'+f.legacySourceId,SNAP,f.opening]);
  }
  await pool.query(
   'UPDATE mvp_finance_native.cutover_control SET phase=$1,'+
   'financial_write_authority=$2,cutover_date_key=$3,snapshot_id=$4,'+
   'manifest_sha256=$5,crm_bridge_sha256=$6,'+
   'owner_identity_approved=true,google_frozen_confirmed=true WHERE id=1',
   ['ACTIVE','POSTGRES',cutover,SNAP,SHA,BRIDGE_SHA]);
  await t.test('simulated ACTIVE without certified historical as-of refuses combined totals',async()=>{
   const r=await get('/api/finance/native-ledger-preview');
   assert.equal(r.status,200);
   assert.equal(r.body.phase,'UNRECONCILED');
   assert.equal(r.body.reason,'CUTOVER_BRIDGE_NOT_VERIFIED');
   assert.ok(r.body.reconciliationIssues.includes('SOURCE_CHECKSUM'));
   assert.ok(r.body.reconciliationIssues.includes('AS_OF_CUTOVER'));
   assert.equal(r.body.combined,null);
   assert.equal(r.body.native.openingCashBase,'5000.000000');
   assert.equal(r.body.history.cashBalanceBase,'5000.000000');
  });
  await t.test('gateway synthetic Finance POST produces native movements, owner-only history stays intact',async()=>{
   process.env.FINANCE_B10_SYNTHETIC_ONLY='1';
   const before=await counts();
   const payload=finCreate();
   const first=await post(payload);
   assert.equal(first.status,200,JSON.stringify(first.body));
   assert.equal(first.body.after.cashBase,'5300.000000');
   assert.equal(first.body.writer,'B10_ISOLATED_PG');
   const second=await post(payload);
   assert.equal(second.status,200);
   assert.equal(second.body.financeTransactionId,first.body.financeTransactionId);
   assert.equal(second.body.replayed,true);
   const after=await counts();
   assert.equal(after.tx,before.tx+1);
   assert.equal(after.receipts,before.receipts+1);
   assert.equal(after.audit,before.audit+1);
   const p=await get('/api/finance/native-ledger-preview');
   assert.equal(p.body.history.cashBalanceBase,'5000.000000');
   assert.equal(p.body.native.openingCashBase,'5000.000000');
   assert.equal(p.body.native.cashDeltaBase,'300.000000');
   assert.equal(p.body.native.currentCashBase,'5300.000000');
   assert.equal(p.body.combined,null,'unverified source cannot produce combined');
  });
  await t.test('trusted synthetic bridge combines opening ONCE; never 2x historical cash',async()=>{
   asOfVerified=true;
   const p=await get('/api/finance/native-ledger-preview');
   assert.equal(p.status,200);
   assert.equal(p.body.phase,'RECONCILED');
   assert.equal(p.body.combined.cashBalanceBase,'5300.000000');
   assert.equal(p.body.combined.profitBase,'2300.000000');
   assert.equal(p.body.combined.workerPayableBase,'0.000000');
   assert.notEqual(p.body.combined.cashBalanceBase,'10300.000000');
   assert.equal(p.body.combined.source,'VERIFIED_NATIVE_OPENING_PLUS_POST_CUTOVER_ONLY');
   assert.equal(p.body.history.cashBalanceBase,'5000.000000');
  });
  await t.test('even trusted date/hash cannot reconcile a stale historical cash figure',async()=>{
   sourceStale=true;
   const p=await get('/api/finance/native-ledger-preview');
   assert.equal(p.status,200);
   assert.equal(p.body.phase,'UNRECONCILED');
   assert.equal(p.body.combined,null);
   assert.ok(p.body.reconciliationIssues.includes('OPENING_CASH'));
   sourceStale=false;
  });
  await t.test('untrusted routes never leak SQL details, history or financial writes',async()=>{
   const noWriteBefore=await counts();
   assert.deepEqual(await post(finCreate('INVALID_MONEY')),
    {status:503,body:{error:'B11_BACKEND_OPERATION_REJECTED'}});
   assert.deepEqual(await counts(),noWriteBefore,
    'rejected malformed money cannot add Finance rows, audit or receipts');
   const other=await get('/api/finance/native-ledger-preview',{owner:false});
   assert.equal(other.status,401);
   const wrong=await get('/api/finance/typo');
   assert.equal(wrong.status,404);
   await pool.query(
    "UPDATE mvp_finance_native.cutover_control SET phase='PAUSED' WHERE id=1");
   assert.deepEqual(await post(finCreate()),
    {status:503,body:{error:'B11_BACKEND_OPERATION_REJECTED'}});
  });
 }finally{
  delete process.env.FINANCE_B10_SYNTHETIC_ONLY;
  delete process.env.FINANCE_B11_SYNTHETIC_ONLY;
  if(server)await new Promise(resolve=>server.close(resolve));
  await pool.end();
 }
});
