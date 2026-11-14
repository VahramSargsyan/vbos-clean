/** Native Finance/Capital pilot: only disposable PostgreSQL with synthetic fixtures. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import pg from 'pg';
import {installIsolatedPilot,seedSyntheticRelations,pilotFinanceAction,pilotCapitalAction,pilotBalances} from '../domains/finance/native-pg-pilot.mjs';

const url=process.env.TEST_DATABASE_URL||'';
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname))
 throw Error('FINANCE_PILOT_PG_TEST_DISPOSABLE_LOCAL_ONLY');
process.env.FINANCE_PILOT_SYNTHETIC_ONLY='1';
const pool=new pg.Pool({connectionString:url,ssl:false,max:4});
const key=()=>randomUUID();
const finance=(action,payload={},extra={})=>pilotFinanceAction(pool,{action,payload,requestKey:key(),...extra});
const capital=(action,amountBase,extra={})=>pilotCapitalAction(pool,{action,amountBase,requestKey:key(),...extra});
const money=s=>Number(s);
const equalsDelta=(before,after,{cash=0,profit=0,payable=0})=>{
 assert.equal(Number((money(after.cashBalanceBase)-money(before.cashBalanceBase)).toFixed(6)),cash,'cash delta');
 assert.equal(Number((money(after.earnedProfitBase)-money(before.earnedProfitBase)).toFixed(6)),profit,'economic profit delta');
 assert.equal(Number((money(after.workerPayableBase)-money(before.workerPayableBase)).toFixed(6)),payable,'worker payable delta');
};
const source={workOrderId:'ORDER-PILOT-1',objectId:'OBJECT-PILOT-1',clientId:'CLIENT-PILOT-1'};
const income=(amount,extra={})=>({operationType:'INCOME',category:'current_work',
 incomeRecognition:'EARNED_AND_RECEIVED',amountOriginal:amount,commissionOriginal:'0',
 currencyOriginal:'AMD',transactionDate:'2026-11-06',...source,...extra});
const worker=(type,amount,extra={})=>({operationType:type,amountOriginal:amount,
 commissionOriginal:'0',workerId:'WORKER-PILOT-1',transactionDate:'2026-11-06',...source,...extra});
const noData=async()=>{
 const r=await pool.query('SELECT count(*)::int n FROM finance_pilot.transactions');
 return r.rows[0].n;
};
test('FINANCE_NATIVE_POSTING_PILOT_V1 PostgreSQL: source parity, atomic money, exact replay',async t=>{
 try{
  await installIsolatedPilot(pool);
  await seedSyntheticRelations(pool,{
   clients:['CLIENT-PILOT-1','CLIENT-PILOT-2'],
   objects:[{id:'OBJECT-PILOT-1',clientId:'CLIENT-PILOT-1'}],
   orders:[{id:'ORDER-PILOT-1',objectId:'OBJECT-PILOT-1',clientId:'CLIENT-PILOT-1'}],
   workers:[{id:'WORKER-PILOT-1'}, {id:'WORKER-ARCHIVED',status:'archived'}],
   funds:[
    {id:'F-OPER',code:'OPERATING_RESERVE',groupType:'PROTECTIVE',targetAmountBase:160},
    {id:'F-WARR',code:'WARRANTY_RESERVE',groupType:'PROTECTIVE',targetAmountBase:175},
    {id:'F-GROW',code:'MARKETING_SALES',groupType:'GROWTH',allocationSharePct:100}
   ]
  });
  await t.test('no ambient writer: explicit flag is mandatory',async()=>{
   const saved=process.env.FINANCE_PILOT_SYNTHETIC_ONLY;
   delete process.env.FINANCE_PILOT_SYNTHETIC_ONLY;
   await assert.rejects(pilotBalances(pool),/FINANCE_WRITER_DISABLED/);
   process.env.FINANCE_PILOT_SYNTHETIC_ONLY=saved;
  });
  let first;
  await t.test('current work income posts cash and earned profit',async()=>{
   first=await finance('CREATE',income('10000',{commissionOriginal:'100'}));
   assert.equal(first.normalized.cashEffectBase,9900);
   assert.equal(first.normalized.profitEffectBase,9900);
   equalsDelta(first.before,first.after,{cash:9900,profit:9900});
   assert.equal(first.normalized.clientId,source.clientId);
   assert.equal(first.normalized.objectId,source.objectId);
   assert.equal(first.normalized.workOrderId,source.workOrderId);
   assert.equal(first.after.scopes.workOrderId[source.workOrderId].cashBalanceBase,'9900.000000');
   assert.equal(first.after.scopes.clientId[source.clientId].earnedProfitBase,'9900.000000');
  });
  await t.test('same request key is idempotent; changed payload is rejected',async()=>{
   const requestKey=key(),payload=income('250');
   const [a,b]=await Promise.all([
    pilotFinanceAction(pool,{requestKey,action:'CREATE',payload}),
    pilotFinanceAction(pool,{requestKey,action:'CREATE',payload})]);
   assert.equal(a.id,b.id);assert.equal(a.replayed===true||b.replayed===true,true);
   await assert.rejects(pilotFinanceAction(pool,{requestKey,action:'CREATE',payload:income('251')}),/IDEMPOTENCY_KEY_PAYLOAD_CONFLICT/);
   const {rows}=await pool.query('SELECT count(*)::int n FROM finance_pilot.transactions WHERE request_key=$1',[requestKey]);
   assert.equal(rows[0].n,1);
  });
  await t.test('advance and client materials are cash transit, not profit',async()=>{
   const a=await finance('CREATE',income('3000',{category:'advance',incomeRecognition:'RECEIVED_ONLY'}));
   equalsDelta(a.before,a.after,{cash:3000,profit:0});
   const m=await finance('CREATE',income('1500',{category:'client_material_funds',incomeRecognition:'EARNED_AND_RECEIVED'}));
   assert.equal(m.normalized.incomeRecognition,'RECEIVED_ONLY');
   equalsDelta(m.before,m.after,{cash:1500,profit:0});
   const p=await finance('CREATE',{operationType:'EXPENSE',category:'client_material_purchase',
    amountOriginal:'1200',commissionOriginal:'0',currencyOriginal:'AMD',transactionDate:'2026-11-06',...source});
   equalsDelta(p.before,p.after,{cash:-1200,profit:0});
  });
  await t.test('normal expense reduces both cash and profit',async()=>{
   const p=await finance('CREATE',{operationType:'EXPENSE',category:'other',
    amountOriginal:'400',commissionOriginal:'10',currencyOriginal:'AMD',transactionDate:'2026-11-06'});
   equalsDelta(p.before,p.after,{cash:-410,profit:-410});
  });
  await t.test('worker payable: accrual, partial payment and final settlement',async()=>{
   const a=await finance('CREATE',worker('WORKER_ACCRUAL','2000'));
   equalsDelta(a.before,a.after,{cash:0,profit:-2000,payable:2000});
   const p=await finance('CREATE',worker('WORKER_PAYMENT','750'));
   equalsDelta(p.before,p.after,{cash:-750,profit:0,payable:-750});
   const f=await finance('CREATE',worker('WORKER_PAYMENT','1250'));
   equalsDelta(f.before,f.after,{cash:-1250,profit:0,payable:-1250});
   assert.equal(f.after.workerPayableBase,'0.000000');
   assert.equal(f.after.scopes.workerId['WORKER-PILOT-1'].workerPayableBase,'0.000000');
   const both=await finance('CREATE',worker('WORKER_ACCRUAL_PAYMENT','200'));
   equalsDelta(both.before,both.after,{cash:-200,profit:-200,payable:0});
  });
  await t.test('owner transfer is cash-only; earned-only is profit-only',async()=>{
   const a=await finance('CREATE',{operationType:'OWNER_TRANSFER',ownerDirection:'self',
    amountOriginal:'1000',commissionOriginal:'0',currencyOriginal:'AMD',transactionDate:'2026-11-06'});
   equalsDelta(a.before,a.after,{cash:-1000,profit:0});
   const e=await finance('CREATE',income('500',{incomeRecognition:'EARNED_ONLY'}));
   equalsDelta(e.before,e.after,{cash:0,profit:500});
  });
  await t.test('source USD/AMD FX and micro precision retain base effects',async()=>{
   const p=await finance('CREATE',income('1.234567',{currencyOriginal:'USD',fxRate:'400',
    fxRateDate:'2026-11-06',fxRateSource:'manual'}));
   assert.equal(p.normalized.currencyOriginal,'USD');
   assert.equal(p.normalized.amountBase,493.8268);
   equalsDelta(p.before,p.after,{cash:493.8268,profit:493.8268});
   const q=await finance('CREATE',{operationType:'EXPENSE',category:'other',
    amountOriginal:'1.234567',commissionOriginal:'0.000001',
    currencyOriginal:'AMD',transactionDate:'2026-11-06'});
   assert.equal(q.normalized.cashEffectBase,-1.234568);
   assert.ok(Math.abs((money(q.after.cashBalanceBase)-money(q.before.cashBalanceBase))+1.234568)<0.00000001);
  });
  await t.test('unknown refs, mismatched order/client, invalid money/currency/status blocked',async()=>{
   const before=await noData();
   await assert.rejects(finance('CREATE',income('5',{workOrderId:'MISSING'})));
   await assert.rejects(finance('CREATE',income('5',{clientId:'CLIENT-PILOT-2'})),/ORDER_CLIENT_MISMATCH/);
   await assert.rejects(finance('CREATE',income('5',{currencyOriginal:'BTC'})));
   await assert.rejects(finance('CREATE',{operationType:'OWNER_TRANSFER',ownerDirection:'investments',amountOriginal:'5',currencyOriginal:'AMD',transactionDate:'2026-11-06'}),/LINKED_OWNER_INVESTMENT_REQUIRES_ATOMIC/);
   await assert.rejects(finance('CREATE',income('5',{amountOriginal:'1.0000001'})),/INVALID_MONEY/);
   await assert.rejects(finance('CREATE',income('5',{status:'archived'})),/CANNOT_CREATE_ARCHIVED/);
   await assert.rejects(finance('CREATE',worker('WORKER_ACCRUAL','5',{workerId:'WORKER-ARCHIVED'})));
   await assert.rejects(finance('CREATE',worker('WORKER_ACCRUAL','5',{commissionOriginal:'2'})));
   assert.equal(await noData(),before);
  });
  await t.test('correction and archive yield original before/after economic deltas',async()=>{
   const corrected=await finance('CORRECT',{amountOriginal:'11000'},{transactionId:first.id});
   equalsDelta(corrected.before,corrected.after,{cash:1000,profit:1000});
   assert.equal(corrected.revision,2);
   const archived=await finance('ARCHIVE',{}, {transactionId:first.id});
   equalsDelta(archived.before,archived.after,{cash:-10900,profit:-10900});
   assert.equal(archived.status,'archived');
   await assert.rejects(finance('CORRECT',{amountOriginal:'12'},{transactionId:first.id}),/ARCHIVED_FINANCE_IMMUTABLE/);
  });
  let allocation,transfer;
  await t.test('15/15/70 capital waterfall and fund transfer without new finance income',async()=>{
   const original=await pilotBalances(pool);
   allocation=await capital('ALLOCATE','1000');
   assert.equal(allocation.after.funds.OPERATING_RESERVE.balanceBase,'150.000000');
   assert.equal(allocation.after.funds.WARRANTY_RESERVE.balanceBase,'150.000000');
   assert.equal(allocation.after.funds.MARKETING_SALES.balanceBase,'700.000000');
   assert.equal(allocation.after.cashBalanceBase,original.cashBalanceBase);
   assert.equal(allocation.after.earnedProfitBase,original.earnedProfitBase);
   transfer=await capital('TRANSFER','100',{fromFundId:'F-GROW',toFundId:'F-OPER'});
   assert.equal(transfer.after.funds.OPERATING_RESERVE.balanceBase,'250.000000');
   assert.equal(transfer.after.funds.MARKETING_SALES.balanceBase,'600.000000');
   await assert.rejects(capital('TRANSFER','1000',{fromFundId:'F-GROW',toFundId:'F-OPER'}),/CAPITAL_NEGATIVE/);
  });
  await t.test('capital transfer reversal and original reversal guard',async()=>{
   const reversal=await capital('REVERSE',undefined,{movementId:transfer.movementIds[0]});
   assert.equal(reversal.after.funds.OPERATING_RESERVE.balanceBase,'150.000000');
   assert.equal(reversal.after.funds.MARKETING_SALES.balanceBase,'700.000000');
   await assert.rejects(capital('REVERSE',undefined,{movementId:transfer.movementIds[0]}),/CAPITAL_REVERSAL_FORBIDDEN/);
   await assert.rejects(capital('REVERSE',undefined,{movementId:reversal.movementIds[0]}),/CAPITAL_REVERSAL_FORBIDDEN/);
  });
  await t.test('two competing spend requests serialize; target-capped reserve shares flow to growth',async()=>{
   const tries=await Promise.allSettled([
    capital('SPEND','600',{fromFundId:'F-GROW'}),
    capital('SPEND','600',{fromFundId:'F-GROW'})
   ]);
   assert.equal(tries.filter(x=>x.status==='fulfilled').length,1);
   assert.equal(tries.filter(x=>x.status==='rejected').length,1);
   assert.match(String(tries.find(x=>x.status==='rejected').reason),/CAPITAL_NEGATIVE/);
   const now=await pilotBalances(pool);
   assert.equal(now.funds.MARKETING_SALES.balanceBase,'100.000000');
   const next=await capital('ALLOCATE','1000');
   assert.equal(next.after.funds.OPERATING_RESERVE.balanceBase,'160.000000');
   assert.equal(next.after.funds.WARRANTY_RESERVE.balanceBase,'175.000000');
   assert.equal(next.after.funds.MARKETING_SALES.balanceBase,'1065.000000');
   assert.equal(next.after.cashBalanceBase,now.cashBalanceBase);
   assert.equal(next.after.earnedProfitBase,now.earnedProfitBase);
  });
  await t.test('audit failure rolls back ledger, effects and receipt atomically',async()=>{
   const start=await noData(),old=await pilotBalances(pool),requestKey=key();
   await pool.query("CREATE OR REPLACE FUNCTION finance_pilot.fail_audit_ci() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='FINANCE_CREATE' THEN RAISE EXCEPTION 'PILOT_AUDIT_INJECTED_FAILURE';END IF;RETURN NEW;END$$");
   await pool.query('CREATE TRIGGER fail_audit_ci BEFORE INSERT ON finance_pilot.audit FOR EACH ROW EXECUTE FUNCTION finance_pilot.fail_audit_ci()');
   try{
    await assert.rejects(pilotFinanceAction(pool,{requestKey,action:'CREATE',payload:income('99')}),/PILOT_AUDIT_INJECTED_FAILURE/);
   }finally{
    await pool.query('DROP TRIGGER fail_audit_ci ON finance_pilot.audit');
    await pool.query('DROP FUNCTION finance_pilot.fail_audit_ci()');
   }
   assert.equal(await noData(),start);
   assert.deepEqual(await pilotBalances(pool),old);
   assert.equal((await pool.query('SELECT count(*)::int n FROM finance_pilot.receipts WHERE request_key=$1',[requestKey])).rows[0].n,0);
  });
  const {rows}=await pool.query('SELECT count(*)::int n FROM finance_pilot.audit');
  assert.ok(rows[0].n>=10,'durable synthetic audit events');
 }finally{await pool.end();}
});
