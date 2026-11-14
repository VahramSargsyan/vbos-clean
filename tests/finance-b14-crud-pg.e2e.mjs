/**
 * B14: REAL PostgreSQL 16 E2E of finance CREATE / EDIT / CANCEL / RESTORE,
 * using synthetic money and IDs in disposable localhost/vbos_mvp_ci ONLY.
 * This fixture must never run against Neon or a persistent database.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {postNativeFinanceCapital,NativeFinanceWriterError}
 from '../domains/finance/native-finance-writer.mjs';

const url=process.env.TEST_DATABASE_URL||'';
if(!url)throw Error('B14_DISPOSABLE_DATABASE_URL_REQUIRED');
const dbURL=new URL(url);
if(!['localhost','127.0.0.1'].includes(dbURL.hostname)||
 dbURL.pathname!=='/vbos_mvp_ci')throw Error('B14_ONLY_DISPOSABLE_POSTGRES');
process.env.FINANCE_B10_SYNTHETIC_ONLY='1';
const pool=new pg.Pool({connectionString:url,ssl:false,max:4});
const script=readFileSync(
 new URL('../migrations/0030_finance_native_cutover_CANDIDATE.sql',import.meta.url),'utf8');
const uuid=()=>randomUUID();
const snapshot='SYNTHETIC_B14_FREEZE';
const hash='e'.repeat(64);
const day='2026-10-10',asOf='2026-09-30';
const funds=['OPERATING_RESERVE','WARRANTY_RESERVE','GROWTH_A','GROWTH_B',
 'GROWTH_C','GROWTH_D','GROWTH_E','GROWTH_F'].map((code,i)=>({
 id:uuid(),code,group:i<2?'PROTECTIVE':'GROWTH',opening:'100',
 target:i<2?'1000':'0',weight:[0,0,20,30,50,0,0,0][i]
}));
const call=(action,payload,key=uuid(),context={syntheticOwnerVerified:true})=>
 postNativeFinanceCapital(pool,{action,payload,requestKey:key,context});
const income=(amount='200')=>({
 operationType:'INCOME',category:'bonus',transactionDate:day,
 amountOriginal:amount,currencyOriginal:'AMD'
});
const expense=(amount='50')=>({
 operationType:'EXPENSE',category:'other',transactionDate:day,
 amountOriginal:amount,currencyOriginal:'AMD'
});
const count=async()=> (await pool.query(
 'SELECT (SELECT count(*)::int FROM mvp_finance_native.transactions) tx,'+
 '(SELECT count(*)::int FROM mvp_finance_native.request_receipts) receipts,'+
 '(SELECT count(*)::int FROM mvp_finance_native.audit_events) audit,'+
 '(SELECT count(*)::int FROM mvp_history.source_records WHERE source_kind=$1) archive',
 ['FINANCE_TRANSACTION'])).rows[0];
const ledger=async()=> (await pool.query(
 'SELECT current_cash_balance_base::text as cash,'+
 'opening_cash_base::text as opening,native_cash_delta_base::text as delta,'+
 'native_profit_delta_base::text as "profitDelta",'+
 'native_worker_payable_delta_base::text as "workerDelta" FROM mvp_finance_native.v_cash_ledger')).rows[0];
const row=async id=>(await pool.query(
 'SELECT status,revision,archived_at,amount_base::text AS amount,'+
 'cash_effect_base::text AS cash FROM mvp_finance_native.transactions '+
 'WHERE finance_transaction_id=$1',[id])).rows[0];
const error=code=>e=>e instanceof NativeFinanceWriterError&&e.code===code;
test('Finance B14 synthetic PostgreSQL writer: idempotent CRUD, atomic balance and archive protection',async t=>{
 try{
  assert.equal((await pool.query('SELECT current_database() AS db')).rows[0].db,'vbos_mvp_ci');
  await pool.query('DROP SCHEMA IF EXISTS mvp_finance_native CASCADE');
  await pool.query(script);
  await t.test('BLOCKED authority rejects all synthetic posting',async()=>{
   await assert.rejects(call('FINANCE_CREATE',income()),error('B10_FINANCIAL_AUTHORITY_BLOCKED'));
   await assert.rejects(call('FINANCE_EDIT',{financeTransactionId:uuid(),expectedRevision:1,
    patch:{transactionDate:day,amountOriginal:'100'}}),
    error('B10_FINANCIAL_AUTHORITY_BLOCKED'));
   assert.equal((await count()).tx,0);
  });
  await pool.query(
   'INSERT INTO mvp_finance_native.opening_snapshot('+
   'source_snapshot_id,manifest_sha256,as_of_date,opening_cash_base,'+
   'opening_profit_base,opening_worker_payable_base) VALUES($1,$2,$3,$4,$5,$6)',
   [snapshot,hash,asOf,'5000','1000','0']);
  for(const f of funds){
   await pool.query(
    'INSERT INTO mvp_finance_native.funds('+
    'fund_id,legacy_source_id,code,group_type,status,target_amount_base,allocation_share_pct) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7)',
    [f.id,'LEGACY_SYN_B14_'+f.code,f.code,f.group,'active',f.target,f.weight]);
   await pool.query(
    'INSERT INTO mvp_finance_native.fund_openings('+
    'fund_id,legacy_balance_source_id,source_snapshot_id,opening_balance_base) '+
    'VALUES($1,$2,$3,$4)',
    [f.id,'OPEN_B14_'+f.code,snapshot,f.opening]);
  }
  // Synthetic only; no owner identity is created, no real source is frozen.
  await pool.query(
   'UPDATE mvp_finance_native.cutover_control SET '+
   "phase='ACTIVE',financial_write_authority='POSTGRES',"+
   'cutover_date_key=$1,snapshot_id=$2,manifest_sha256=$3,crm_bridge_sha256=$4,'+
   'owner_identity_approved=true,google_frozen_confirmed=true WHERE id=1',
   ['2026-10-01',snapshot,hash,'a'.repeat(64)]);
  let firstId,expenseId;
  await t.test('create then EDIT changes only delta; historical opening never doubles',async()=>{
   const a=await call('FINANCE_CREATE',income());
   firstId=a.financeTransactionId;
   const b=await call('FINANCE_CREATE',expense());
   expenseId=b.financeTransactionId;
   assert.equal(Number((await ledger()).cash),5150);
   assert.equal(Number((await ledger()).opening),5000);
   const key=uuid(),payload={financeTransactionId:firstId,expectedRevision:1,
    patch:{transactionDate:day,amountOriginal:'250'}};
   const out=await call('FINANCE_EDIT',payload,key);
   assert.equal(out.revisionBefore,1);assert.equal(out.revisionAfter,2);
   assert.equal(out.effects.cashDifference,'50.000000');
   assert.equal(out.effects.profitDifference,'50.000000');
   assert.equal(Number((await ledger()).cash),5200);
   assert.equal(Number((await ledger()).profitDelta),200);
   assert.equal((await row(firstId)).revision,2);
   const before=await count();
   const replay=await call('FINANCE_EDIT',payload,key);
   assert.equal(replay.replayed,true);
   assert.deepEqual(await count(),before);
   await assert.rejects(call('FINANCE_EDIT',{...payload,patch:{
    transactionDate:day,amountOriginal:'251'}},key),
    error('B10_IDEMPOTENCY_PAYLOAD_CONFLICT'));
   await assert.rejects(call('FINANCE_EDIT',payload),
    error('B14_REVISION_CONFLICT'));
   assert.equal(Number((await ledger()).cash),5200);
  });
  await t.test('invalid mutation, overspend and linked investment abort transaction',async()=>{
   const before=await count(),cash=(await ledger()).cash;
   await assert.rejects(call('FINANCE_EDIT',{
    financeTransactionId:expenseId,expectedRevision:1,
    patch:{transactionDate:day,cashEffectBase:'100'} }),
    error('B14_PATCH_FIELDS_INVALID'));
   await assert.rejects(call('FINANCE_EDIT',{
    financeTransactionId:expenseId,expectedRevision:1,
    patch:{transactionDate:day,amountOriginal:'5300'} }),
    error('B14_NEGATIVE_CASH_AFTER_AMENDMENT'));
   await assert.rejects(call('FINANCE_CANCEL',{financeTransactionId:uuid(),expectedRevision:1}),
    error('B14_NATIVE_ROW_NOT_FOUND'));
   await assert.rejects(call('FINANCE_EDIT',{
    financeTransactionId:firstId,expectedRevision:2,
    patch:{transactionDate:asOf,amountOriginal:'250'} }),
    error('B10_BEFORE_CUTOVER_DATE'));
   const invest=await call('FINANCE_CREATE',{
    operationType:'OWNER_TRANSFER',ownerDirection:'investments',
    amountOriginal:'5',transactionDate:day
   });
   await assert.rejects(call('FINANCE_CANCEL',{
    financeTransactionId:invest.financeTransactionId,expectedRevision:1}),
    error('B14_LINKED_FINCAP_AMENDMENT_BLOCKED'));
   await assert.rejects(call('FINANCE_EDIT',{
    financeTransactionId:invest.financeTransactionId,expectedRevision:1,
    patch:{transactionDate:day,amountOriginal:'6'}}),
    error('B14_LINKED_FINCAP_AMENDMENT_BLOCKED'));
   assert.equal((await row(expenseId)).revision,1);
   assert.equal(Number((await ledger()).cash),Number(cash)-5);
   const after=await count();
   assert.equal(after.tx,before.tx+1); // investment was the only committed new transaction
   assert.equal(after.receipts,before.receipts+1);
  });
  await t.test('CANCEL preserves row, reverses its contribution, RESTORE returns exactly one effect',async()=>{
   const id=firstId,before=await ledger(),n=await count();
   const key=uuid(),p={financeTransactionId:id,expectedRevision:2};
   const out=await call('FINANCE_CANCEL',p,key);
   assert.equal(out.statusAfter,'archived');
   assert.equal((await row(id)).revision,3);
   assert.ok((await row(id)).archived_at);
   assert.equal(Number((await ledger()).cash),Number(before.cash)-250);
   assert.equal((await count()).tx,n.tx);
   const replay=await call('FINANCE_CANCEL',p,key);
   assert.equal(replay.replayed,true);
   await assert.rejects(call('FINANCE_EDIT',{
    financeTransactionId:id,expectedRevision:3,
    patch:{transactionDate:day,amountOriginal:'260'}}),
    error('B14_ARCHIVED_NOT_EDITABLE'));
   await assert.rejects(call('FINANCE_CANCEL',{
    financeTransactionId:id,expectedRevision:3}),
    /FINANCE_LIFECYCLE_STATUS_CONFLICT/);
   const restored=await call('FINANCE_RESTORE',{
    financeTransactionId:id,expectedRevision:3
   });
   assert.equal(restored.revisionAfter,4);
   assert.equal(restored.statusAfter,'active');
   assert.equal(Number((await ledger()).cash),Number(before.cash));
   assert.equal((await row(id)).archived_at,null);
   assert.equal((await count()).tx,n.tx);
  });
  await t.test('two competing edits on stale revision: one wins, other fails',async()=>{
   const before=await ledger();
   const p={financeTransactionId:firstId,expectedRevision:4,
    patch:{transactionDate:day,amountOriginal:'275'}};
   const q={financeTransactionId:firstId,expectedRevision:4,
    patch:{transactionDate:day,amountOriginal:'300'}};
   const res=await Promise.allSettled([call('FINANCE_EDIT',p),call('FINANCE_EDIT',q)]);
   assert.equal(res.filter(x=>x.status==='fulfilled').length,1);
   assert.equal(res.filter(x=>x.status==='rejected'&&error('B14_REVISION_CONFLICT')(x.reason)).length,1);
   const amount=Number((await row(firstId)).amount);
   assert.ok([275,300].includes(amount));
   assert.equal(Number((await ledger()).cash),Number(before.cash)+amount-250);
  });
  await t.test('backdated October transactions posted out of date order preserve cash and source dates',async()=>{
   const start=await ledger();
   const late=await call('FINANCE_CREATE',{...income('10'),transactionDate:'2026-10-10'});
   const early=await call('FINANCE_CREATE',{...expense('3'),transactionDate:'2026-10-03'});
   const dates=await pool.query(
    'SELECT finance_transaction_id,transaction_date_key::text AS day FROM mvp_finance_native.transactions WHERE finance_transaction_id IN ($1,$2)',
    [late.financeTransactionId,early.financeTransactionId]);
   const byId=new Map(dates.rows.map(x=>[x.finance_transaction_id,x.day]));
   assert.equal(byId.get(late.financeTransactionId),'2026-10-10');
   assert.equal(byId.get(early.financeTransactionId),'2026-10-03');
   assert.equal(Number((await ledger()).cash),Number(start.cash)+7);
   await call('FINANCE_CANCEL',{financeTransactionId:early.financeTransactionId,expectedRevision:1});
   await call('FINANCE_CANCEL',{financeTransactionId:late.financeTransactionId,expectedRevision:1});
   assert.equal(Number((await ledger()).cash),Number(start.cash));
  });
  await t.test('PAUSED authority blocks all new changes; audit/receipt and legacy archive stay intact',async()=>{
   await pool.query("UPDATE mvp_finance_native.cutover_control SET phase='PAUSED' WHERE id=1");
   const before=await count();
   await assert.rejects(call('FINANCE_CANCEL',{
    financeTransactionId:expenseId,expectedRevision:1}),
    error('B10_FINANCIAL_AUTHORITY_BLOCKED'));
   assert.deepEqual(await count(),before);
   const audit=await pool.query(
    'SELECT event_type,details FROM mvp_finance_native.audit_events '+
    "WHERE event_type LIKE 'FINANCE_%' ORDER BY audit_id DESC LIMIT 20");
   assert.ok(audit.rows.some(x=>x.event_type==='FINANCE_EDIT'));
   assert.ok(audit.rows.some(x=>x.event_type==='FINANCE_CANCEL'));
   assert.ok(audit.rows.some(x=>x.event_type==='FINANCE_RESTORE'));
   assert.ok(audit.rows.filter(x=>['FINANCE_EDIT','FINANCE_CANCEL','FINANCE_RESTORE']
    .includes(x.event_type)).every(x=>Number(x.details.revisionAfter)>Number(x.details.revisionBefore)));
   assert.equal((await count()).archive,0);
   assert.equal((await ledger()).opening,'5000.000000');
  });
 }finally{await pool.end();}
});
