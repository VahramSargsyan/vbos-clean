/**
 * B10 isolated Finance/Capital native writer — real temporary PostgreSQL.
 * Intentionally cannot run against shared Neon, Render or any remote host.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {postNativeFinanceCapital,NativeFinanceWriterError}
 from '../domains/finance/native-finance-writer.mjs';
const url=process.env.TEST_DATABASE_URL||'';
if(!url)throw Error('B10_DISPOSABLE_DATABASE_URL_REQUIRED');
const target=new URL(url);
if(!['localhost','127.0.0.1'].includes(target.hostname)||
   target.pathname!=='/vbos_mvp_ci')throw Error('B10_CI_DATABASE_ONLY');
process.env.FINANCE_B10_SYNTHETIC_ONLY='1';
const pool=new pg.Pool({connectionString:url,ssl:false,max:4});
const script=readFileSync(
 new URL('../migrations/0030_finance_native_cutover_CANDIDATE.sql',import.meta.url),'utf8');
const uuid=()=>randomUUID();
const snapshot='SYNTHETIC_B10_FREEZE_SNAPSHOT';
const date='2026-11-11',asOf='2026-11-10';
const funds=[
 {code:'OPERATING_RESERVE',group:'PROTECTIVE',opening:'950',target:'1000',weight:'0'},
 {code:'WARRANTY_RESERVE',group:'PROTECTIVE',opening:'950',target:'1000',weight:'0'},
 {code:'GROWTH_ALPHA',group:'GROWTH',opening:'60',target:'0',weight:'20'},
 {code:'GROWTH_BETA',group:'GROWTH',opening:'80',target:'0',weight:'30'},
 {code:'GROWTH_GAMMA',group:'GROWTH',opening:'100',target:'0',weight:'50'},
 {code:'GROWTH_UNUSED_A',group:'GROWTH',opening:'0',target:'0',weight:'0'},
 {code:'GROWTH_UNUSED_B',group:'GROWTH',opening:'0',target:'0',weight:'0'},
 {code:'GROWTH_UNUSED_C',group:'GROWTH',opening:'0',target:'0',weight:'0'}
].map(x=>({...x,id:uuid()}));
const byCode=Object.fromEntries(funds.map(f=>[f.code,f.id]));
const ctx={syntheticOwnerVerified:true};
const invoke=(action,payload,requestKey=uuid(),context=ctx)=>
 postNativeFinanceCapital(pool,{action,requestKey,payload,context});
const fCreate=(change={})=>({
 operationType:'INCOME',category:'bonus',amountOriginal:'600',
 transactionDate:date,currencyOriginal:'AMD',...change
});
const transfer=(change={})=>({
 fromFundId:byCode.GROWTH_GAMMA,toFundId:byCode.GROWTH_ALPHA,
 amountBase:'20',transactionDateKey:date,purpose:'Синтетический перевод',...change
});
const spend=(change={})=>({
 fromFundId:byCode.GROWTH_ALPHA,amountBase:'15',transactionDateKey:date,
 purpose:'Синтетический расход',...change
});
const snapshotCounts=async()=>{
 const r=await pool.query(
  'SELECT '+
  '(SELECT count(*)::int FROM mvp_finance_native.transactions) tx,'+
  '(SELECT count(*)::int FROM mvp_finance_native.fincap_batches) batches,'+
  '(SELECT count(*)::int FROM mvp_finance_native.fund_movements) movements,'+
  '(SELECT count(*)::int FROM mvp_finance_native.fund_effects) effects,'+
  '(SELECT count(*)::int FROM mvp_finance_native.request_receipts) receipts,'+
  '(SELECT count(*)::int FROM mvp_finance_native.audit_events) audits');
 return r.rows[0];
};
async function cash(){
 const r=await pool.query(
  'SELECT opening_cash_base::text,native_cash_delta_base::text,'+
  'current_cash_balance_base::text,opening_profit_base::text,'+
  'native_profit_delta_base::text FROM mvp_finance_native.v_cash_ledger');
 return r.rows[0];
}
async function fundBalance(code){
 const r=await pool.query(
  'SELECT opening_balance_base::text,native_delta_base::text,'+
  'current_balance_base::text FROM mvp_finance_native.v_fund_balances '+
  'WHERE fund_id=$1',[byCode[code]]);
 return r.rows[0];
}
function isError(code){
 return e=>e instanceof NativeFinanceWriterError&&e.code===code;
}
test('Finance B10: single synthetic native Finance + Capital writer on B9 schema',async t=>{
 try{
  const db=await pool.query('SELECT current_database() AS name');
  assert.equal(db.rows[0].name,'vbos_mvp_ci');
  await pool.query('DROP SCHEMA IF EXISTS mvp_finance_native CASCADE');
  await pool.query(script);
  await t.test('before activation all native finance writes and ownerless calls are refused',async()=>{
   await assert.rejects(invoke('FINANCE_CREATE',fCreate()),
    isError('B10_FINANCIAL_AUTHORITY_BLOCKED'));
   await assert.rejects(invoke('FINANCE_CREATE',fCreate(),uuid(),{}),
    isError('B10_TEST_OWNER_GATE_CLOSED'));
   // This must reject BEFORE making any network connection, even if an attacker
   // tries to pass a non-local pool while TEST_DATABASE_URL claims localhost.
   const remotePool={options:{connectionString:'postgresql://wrong:wrong@neon.invalid/vbos_mvp_ci'},
    connect(){throw Error('B10_UNEXPECTED_CONNECT');}};
   await assert.rejects(postNativeFinanceCapital(remotePool,{
    action:'FINANCE_CREATE',requestKey:uuid(),payload:fCreate(),context:ctx
   }),isError('B10_POOL_CONNECTION_MISMATCH'));
   assert.deepEqual(await snapshotCounts(),{
    tx:0,batches:0,movements:0,effects:0,receipts:0,audits:0});
  });
  await pool.query(
   'INSERT INTO mvp_finance_native.opening_snapshot('+
   'source_snapshot_id,manifest_sha256,as_of_date,'+
   'opening_cash_base,opening_profit_base,opening_worker_payable_base) '+
   'VALUES($1,$2,$3,$4,$5,$6)',
   [snapshot,'d'.repeat(64),asOf,'5000','1000','0']);
  for(const f of funds){
   await pool.query(
    'INSERT INTO mvp_finance_native.funds('+
    'fund_id,legacy_source_id,code,group_type,status,target_amount_base,'+
    'allocation_share_pct) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [f.id,'LEGACY_SYN_B10_'+f.code,f.code,f.group,'active',f.target,f.weight]);
   await pool.query(
    'INSERT INTO mvp_finance_native.fund_openings('+
    'fund_id,legacy_balance_source_id,source_snapshot_id,opening_balance_base) '+
    'VALUES($1,$2,$3,$4)',
    [f.id,'OPEN_B10_'+f.code,snapshot,f.opening]);
  }
  await pool.query(
   'UPDATE mvp_finance_native.cutover_control SET '+
   "phase='ACTIVE',financial_write_authority='POSTGRES',"+
   'cutover_date_key=$1,snapshot_id=$2,manifest_sha256=$3,crm_bridge_sha256=$4,'+
   'owner_identity_approved=true,google_frozen_confirmed=true WHERE id=1',
   [date,snapshot,'d'.repeat(64),'e'.repeat(64)]);
  await t.test('new income and expense use native opening+delta without rebooking history',async()=>{
   const first=await invoke('FINANCE_CREATE',fCreate());
   assert.equal(first.sourceSystem,'CLEAN_NATIVE_FINANCE');
   assert.equal(first.finCap,null);
   assert.equal(first.before.openingCashBase,'5000.000000');
   assert.equal(first.after.cashBase,'5600.000000');
   assert.equal(first.after.profitDeltaBase,'600.000000');
   const expense=await invoke('FINANCE_CREATE',fCreate({
    operationType:'EXPENSE',category:'other',amountOriginal:'100'
   }));
   assert.equal(expense.after.cashBase,'5500.000000');
   assert.equal(expense.after.profitDeltaBase,'500.000000');
   const ledger=await cash();
   assert.equal(Number(ledger.opening_cash_base),5000);
   assert.equal(Number(ledger.native_cash_delta_base),500);
   assert.equal(Number(ledger.current_cash_balance_base),5500);
   assert.equal(Number(ledger.opening_profit_base),1000);
  });
  let investment;
  await t.test('owner investment atomically creates Finance, deterministic FINCAP and target-aware 15/15/70 fund effects',async()=>{
   const prior=await snapshotCounts(),key=uuid();
   investment=await invoke('FINANCE_CREATE',{
    operationType:'OWNER_TRANSFER',ownerDirection:'investments',
    amountOriginal:'200',commissionOriginal:'5',transactionDate:date
   },key);
   assert.equal(investment.after.cashBase,'5295.000000');
   assert.equal(investment.after.profitDeltaBase,'495.000000');
   assert.equal(investment.finCap.clientRequestId,
    'FINCAP|'+investment.financeTransactionId);
   assert.equal(investment.finCap.totalAmountBase,'200.000000');
   const amounts=Object.fromEntries(investment.finCap.lines.map(line=>[
    funds.find(f=>f.id===line.fundId).code,line.amountBase]));
   assert.deepEqual(amounts,{
    OPERATING_RESERVE:'30.000000',WARRANTY_RESERVE:'30.000000',
    GROWTH_ALPHA:'28.000000',GROWTH_BETA:'42.000000',
    GROWTH_GAMMA:'70.000000'
   });
   assert.equal(Number((await fundBalance('OPERATING_RESERVE')).current_balance_base),980);
   assert.equal(Number((await fundBalance('GROWTH_GAMMA')).current_balance_base),170);
   const after=await snapshotCounts();
   assert.equal(after.tx,prior.tx+1);
   assert.equal(after.batches,prior.batches+1);
   assert.equal(after.movements,prior.movements+5);
   assert.equal(after.effects,prior.effects+5);
   assert.equal(after.receipts,prior.receipts+1);
   assert.equal(after.audits,prior.audits+1);
   const r=await pool.query(
    'SELECT client_request_id FROM mvp_finance_native.fincap_batches '+
    'WHERE finance_transaction_id=$1',[investment.financeTransactionId]);
   assert.equal(r.rows[0].client_request_id,investment.finCap.clientRequestId);
  });
  await t.test('concurrent request replay is durable; conflicting reuse is rejected',async()=>{
   const before=await snapshotCounts(),key=uuid();
   const payload=fCreate({amountOriginal:'30'});
   const [a,b]=await Promise.all([
    invoke('FINANCE_CREATE',payload,key),
    invoke('FINANCE_CREATE',{...payload},key)
   ]);
   assert.equal(a.financeTransactionId,b.financeTransactionId);
   assert.equal([a.replayed,b.replayed].filter(Boolean).length,1);
   const after=await snapshotCounts();
   assert.equal(after.tx,before.tx+1);
   assert.equal(after.receipts,before.receipts+1);
   assert.equal(after.audits,before.audits+1);
   await assert.rejects(invoke('FINANCE_CREATE',fCreate({amountOriginal:'31'}),key),
    isError('B10_IDEMPOTENCY_PAYLOAD_CONFLICT'));
   assert.deepEqual(await snapshotCounts(),after);
  });
  let sourceTransfer,sourceSpend;
  await t.test('capital TRANSFER, SPEND, and REVERSAL share the same receipt and audit contract',async()=>{
   const cashBefore=await cash();
   sourceTransfer=await invoke('CAPITAL_TRANSFER',transfer());
   assert.equal(sourceTransfer.movementType,'TRANSFER');
   assert.equal(Number((await fundBalance('GROWTH_ALPHA')).current_balance_base),108);
   assert.equal(Number((await fundBalance('GROWTH_GAMMA')).current_balance_base),150);
   sourceSpend=await invoke('CAPITAL_SPEND',spend());
   assert.equal(sourceSpend.movementType,'SPEND');
   assert.equal(Number((await fundBalance('GROWTH_ALPHA')).current_balance_base),93);
   const undone=await invoke('CAPITAL_REVERSE',{
    fundTransactionId:sourceSpend.movementId,
    transactionDateKey:date,reason:'Сторнировать тестовое списание'
   });
   assert.equal(undone.reversalOf,sourceSpend.movementId);
   assert.equal(Number((await fundBalance('GROWTH_ALPHA')).current_balance_base),108);
   await assert.rejects(invoke('CAPITAL_REVERSE',{
    fundTransactionId:sourceSpend.movementId,
    transactionDateKey:date,reason:'Повтор'
   }),/CAPITAL_B6_ORIGINAL_NOT_REVERSIBLE|CAPITAL_B6_REVERSAL_LOOKUP_UNVERIFIED/);
   const undoneTransfer=await invoke('CAPITAL_REVERSE',{
    fundTransactionId:sourceTransfer.movementId,
    transactionDateKey:date,reason:'Сторнировать перевод'
   });
   assert.equal(undoneTransfer.movementType,'REVERSAL');
   assert.equal(Number((await fundBalance('GROWTH_ALPHA')).current_balance_base),88);
   assert.equal(Number((await fundBalance('GROWTH_GAMMA')).current_balance_base),170);
   assert.deepEqual(await cash(),cashBefore);
  });
  await t.test('cannot reverse FINCAP allocation, make historic date or spoof caller financial effects',async()=>{
   const allocationId=investment.finCap.lines[0].movementId;
   await assert.rejects(invoke('CAPITAL_REVERSE',{
    fundTransactionId:allocationId,transactionDateKey:date,
    reason:'Обойти FINCAP'
   }),isError('B10_FINCAP_ALLOCATION_REVERSAL_FORBIDDEN'));
   await assert.rejects(invoke('FINANCE_CREATE',fCreate({
    transactionDate:'2026-11-10'
   })),isError('B10_BEFORE_CUTOVER_DATE'));
   await assert.rejects(invoke('FINANCE_CREATE',{
    ...fCreate(),cashEffectBase:'9999'
   }),isError('B10_UNEXPECTED_PAYLOAD_FIELD'));
   await assert.rejects(invoke('FINANCE_CREATE',fCreate({
    clientId:uuid()
   })),/FINANCE_CREATE_REFERENCE_NOT_FOUND_clients/);
   await assert.rejects(invoke('CAPITAL_SPEND',spend({
    amountBase:'1000000'
   })),/CAPITAL_B6_INSUFFICIENT_FUNDS/);
  });
  await t.test('insufficient cash cannot create partial native ledger or receipts',async()=>{
   const before=await snapshotCounts(),cashBefore=await cash();
   await assert.rejects(invoke('FINANCE_CREATE',fCreate({
    operationType:'OWNER_TRANSFER',ownerDirection:'investments',
    amountOriginal:'1000000'
   })),isError('B10_INSUFFICIENT_FINANCE_CASH'));
   assert.deepEqual(await snapshotCounts(),before);
   assert.deepEqual(await cash(),cashBefore);
  });
  await t.test('injected audit failure atomically rolls back finance+FINCAP+capital',async()=>{
   const count=await snapshotCounts(),balance=await cash();
   const beforeFund=await fundBalance('OPERATING_RESERVE');
   await pool.query(
    "CREATE FUNCTION mvp_finance_native.fail_b10_audit() RETURNS trigger "+
    "LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'B10_FORCED_AUDIT_FAILURE'; END$$");
   await pool.query(
    'CREATE TRIGGER b10_forced_audit BEFORE INSERT ON '+
    'mvp_finance_native.audit_events FOR EACH ROW '+
    'EXECUTE FUNCTION mvp_finance_native.fail_b10_audit()');
   try{
    await assert.rejects(invoke('FINANCE_CREATE',{
     operationType:'OWNER_TRANSFER',ownerDirection:'investments',
     amountOriginal:'40',transactionDate:date
    }),/B10_FORCED_AUDIT_FAILURE/);
   }finally{
    await pool.query('DROP TRIGGER b10_forced_audit ON mvp_finance_native.audit_events');
    await pool.query('DROP FUNCTION mvp_finance_native.fail_b10_audit()');
   }
   assert.deepEqual(await snapshotCounts(),count);
   assert.deepEqual(await cash(),balance);
   assert.deepEqual(await fundBalance('OPERATING_RESERVE'),beforeFund);
  });
  await t.test('P5 explicit linked allocation uses same cash debit, batch, effects and durable replay',async()=>{
   const prior=await snapshotCounts(),money=await cash(),key=uuid();
   const payload={operationType:'OWNER_TRANSFER',ownerDirection:'investments',currencyOriginal:'AMD',
    amountOriginal:'40',transactionDate:date,manualAllocations:[
     {fundId:byCode.GROWTH_ALPHA,amountBase:'17.000001'},
     {fundId:byCode.GROWTH_GAMMA,amountBase:'22.999999'}]};
   const [a,b]=await Promise.all([invoke('FINANCE_CREATE',payload,key),invoke('FINANCE_CREATE',payload,key)]);
   assert.equal(a.sourceId,b.sourceId);assert.equal(a.finCap.batchId,b.finCap.batchId);
   assert.equal([a.replayed,b.replayed].filter(Boolean).length,1);
   assert.equal(Number((await cash()).current_cash_balance_base),Number(money.current_cash_balance_base)-40);
   const actual=Object.fromEntries(a.finCap.lines.map(x=>[x.fundId,x.amountBase]));
   assert.deepEqual(actual,Object.fromEntries(payload.manualAllocations.map(x=>[x.fundId,x.amountBase])));
   const saved=await pool.query('SELECT m.to_fund_id::text AS fund_id,m.amount_base::text,e.balance_delta_base::text FROM mvp_finance_native.fund_movements m JOIN mvp_finance_native.fund_effects e USING(movement_id) WHERE m.allocation_batch_id=$1',[a.finCap.batchId]);
   assert.equal(saved.rows.length,2);
   for(const row of saved.rows){assert.equal(row.amount_base,actual[row.fund_id]);assert.equal(row.balance_delta_base,row.amount_base);}
   const after=await snapshotCounts();
   assert.deepEqual(after,{tx:prior.tx+1,batches:prior.batches+1,movements:prior.movements+2,effects:prior.effects+2,receipts:prior.receipts+1,audits:prior.audits+1});
   await assert.rejects(invoke('FINANCE_CREATE',{...payload,manualAllocations:[{fundId:byCode.GROWTH_GAMMA,amountBase:'40'}]},key),isError('B10_IDEMPOTENCY_PAYLOAD_CONFLICT'));
   await assert.rejects(invoke('FINANCE_CREATE',{...payload,manualAllocations:[payload.manualAllocations[0]]}),/CAPITAL_P5_SUM_NOT_EXACT/);
   await assert.rejects(invoke('FINANCE_CREATE',{...payload,manualAllocations:[payload.manualAllocations[0],payload.manualAllocations[0]]}),/CAPITAL_P5_ALLOCATION_LINE_INVALID/);
   await assert.rejects(invoke('FINANCE_CREATE',{...payload,manualAllocations:[{fundId:uuid(),amountBase:'40'}]}),/CAPITAL_P5_FUND_UNAVAILABLE/);
   await assert.rejects(invoke('FINANCE_CREATE',{...payload,ownerDirection:'home'}),/P5_MANUAL_INVESTMENT_ONLY/);
   await assert.rejects(invoke('CAPITAL_REVERSE',{fundTransactionId:a.finCap.lines[0].movementId,transactionDateKey:date,reason:'Запрещено'}),/B10_FINCAP_ALLOCATION_REVERSAL_FORBIDDEN/);
   assert.deepEqual(await snapshotCounts(),after);
  });
  await t.test('PAUSED keeps PostgreSQL authority but denies fresh money writes',async()=>{
   await pool.query(
    "UPDATE mvp_finance_native.cutover_control SET phase='PAUSED' WHERE id=1");
   await assert.rejects(invoke('FINANCE_CREATE',fCreate()),
    isError('B10_FINANCIAL_AUTHORITY_BLOCKED'));
   await assert.rejects(invoke('CAPITAL_TRANSFER',transfer()),
    isError('B10_FINANCIAL_AUTHORITY_BLOCKED'));
   const state=await pool.query(
    'SELECT phase,financial_write_authority FROM '+
    'mvp_finance_native.cutover_control WHERE id=1');
   assert.deepEqual(state.rows[0],
    {phase:'PAUSED',financial_write_authority:'POSTGRES'});
  });
 }finally{await pool.end();}
});
