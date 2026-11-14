/** B8 Finance -> FINCAP: strictly synthetic disposable PostgreSQL only. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {installIsolatedPilot,pilotBalances,pilotLinkedInvestmentAction,
 pilotFinanceAction,pilotCapitalAction} from '../domains/finance/native-pg-pilot.mjs';

const url=process.env.TEST_DATABASE_URL||'';
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname)||
 new URL(url).pathname!=='/vbos_mvp_ci')
 throw Error('FINANCE_B8_DISPOSABLE_POSTGRES_ONLY');
process.env.FINANCE_PILOT_SYNTHETIC_ONLY='1';
const pool=new pg.Pool({connectionString:url,ssl:false,max:4});
const uuid=()=>randomUUID();
const amount=x=>Number(x);
const investment=(money='300',fee='5')=>({
 operationType:'OWNER_TRANSFER',ownerDirection:'investments',
 amountOriginal:money,commissionOriginal:fee,
 currencyOriginal:'AMD',transactionDate:'2026-11-06'
});
async function counts(){
 const r=await pool.query(
  'SELECT (SELECT count(*)::int FROM finance_pilot.transactions) tx,'+
  '(SELECT count(*)::int FROM finance_pilot.allocation_batches) batches,'+
  '(SELECT count(*)::int FROM finance_pilot.fund_movements) lines,'+
  '(SELECT count(*)::int FROM finance_pilot.receipts) receipts,'+
  '(SELECT count(*)::int FROM finance_pilot.audit) audits');
 return r.rows[0];
}

test('B8 synthetic Finance/FINCAP PostgreSQL atomic posting + rollback',async t=>{
 try{
  await installIsolatedPilot(pool);
  const starting=await pilotBalances(pool);
  assert.ok(amount(starting.cashBalanceBase)>305,
   'Earlier independent synthetic pilot must have created spendable native cash');
  const requestKey=uuid();
  let first;
  await t.test('Finance cash, unique FINCAP batch, fund lines, counters and audit commit together',async()=>{
   const prior=await counts();
   first=await pilotLinkedInvestmentAction(pool,{requestKey,payload:investment()});
   assert.equal(first.action,'LINKED_INVESTMENT');
   assert.equal(first.clientRequestId,'FINCAP|'+first.financeTransactionId);
   assert.equal(first.financialWriter,'SYNTHETIC_ONLY');
   assert.equal(first.historicalSourcePreserved,true);
   assert.equal(first.allocationLines.length,1,
    'previous synthetic pilot filled protective reserves');
   assert.equal(first.allocationLines[0].fundId,'F-GROW');
   assert.equal(first.allocationLines[0].amountBase,'300.000000');
   assert.equal(
    Number((amount(first.after.cashBalanceBase)-amount(first.before.cashBalanceBase)).toFixed(6)),-305);
   assert.equal(
    Number((amount(first.after.earnedProfitBase)-amount(first.before.earnedProfitBase)).toFixed(6)),-5);
   assert.equal(
    Number((amount(first.after.funds.MARKETING_SALES.balanceBase)-
      amount(first.before.funds.MARKETING_SALES.balanceBase)).toFixed(6)),300);
   const after=await counts();
   assert.equal(after.tx,prior.tx+1);
   assert.equal(after.batches,prior.batches+1);
   assert.equal(after.lines,prior.lines+1);
   assert.equal(after.receipts,prior.receipts+1);
   assert.equal(after.audits,prior.audits+1);
   const r=await pool.query(
    'SELECT b.client_request_id,b.total_amount_base::text amount,'+
    't.status,t.cash_base::text cash,t.profit_base::text profit '+
    'FROM finance_pilot.allocation_batches b JOIN finance_pilot.transactions t '+
    'ON t.id=b.finance_transaction_id WHERE b.id=$1',[first.allocationBatchId]);
   assert.equal(r.rows.length,1);
   assert.equal(r.rows[0].client_request_id,first.clientRequestId);
   assert.equal(Number(r.rows[0].amount),300);
   assert.equal(Number(r.rows[0].cash),-305);
   assert.equal(Number(r.rows[0].profit),-5);
   const count=await pool.query(
    'SELECT allocated_base::text allocated, transaction_count '+
    'FROM finance_pilot.funds WHERE id=$1',['F-GROW']);
   assert.ok(Number(count.rows[0].allocated)>=300);
   assert.ok(Number(count.rows[0].transaction_count)>=1);
  });
  await t.test('duplicate concurrent request replays the same Finance and FINCAP identity',async()=>{
   const before=await counts();
   const [a,b]=await Promise.all([
    pilotLinkedInvestmentAction(pool,{requestKey,payload:investment()}),
    pilotLinkedInvestmentAction(pool,{requestKey,payload:investment()})
   ]);
   assert.equal(a.financeTransactionId,first.financeTransactionId);
   assert.equal(b.financeTransactionId,first.financeTransactionId);
   assert.equal(a.replayed,true);
   assert.equal(b.replayed,true);
   assert.deepEqual(await counts(),before);
   await assert.rejects(pilotLinkedInvestmentAction(pool,{
    requestKey,payload:investment('301')}),/IDEMPOTENCY_KEY_PAYLOAD_CONFLICT/);
  });
  await t.test('existing linked Finance and its allocation line cannot be unilaterally changed',async()=>{
   await assert.rejects(pilotFinanceAction(pool,{requestKey:uuid(),
    action:'ARCHIVE',transactionId:first.financeTransactionId,
    expectedRevision:1,payload:{}}),/FINCAP_LINKED_FINANCE_CHANGE_REQUIRES_ATOMIC_GATE/);
   await assert.rejects(pilotFinanceAction(pool,{requestKey:uuid(),
    action:'CORRECT',transactionId:first.financeTransactionId,
    expectedRevision:1,payload:{amountOriginal:'200'}}),
    /FINCAP_LINKED_FINANCE_CHANGE_REQUIRES_ATOMIC_GATE/);
   await assert.rejects(pilotCapitalAction(pool,{requestKey:uuid(),
    action:'REVERSE',movementId:first.movementIds[0]}),
    /CAPITAL_ALLOCATION_REVERSAL_REQUIRES_FINCAP_GATE/);
   const r=await pool.query('SELECT status FROM finance_pilot.transactions WHERE id=$1',
    [first.financeTransactionId]);
   assert.equal(r.rows[0].status,'active');
  });
  await t.test('lack of native cash fails before any FINCAP or fund write',async()=>{
   const before=await counts(),money=await pilotBalances(pool);
   await assert.rejects(pilotLinkedInvestmentAction(pool,{
    requestKey:uuid(),payload:investment('100000000')}),
    /FINCAP_NOT_ENOUGH_NATIVE_CASH/);
   assert.deepEqual(await counts(),before);
   assert.deepEqual(await pilotBalances(pool),money);
  });
  await t.test('audit trigger failure atomically undoes Finance, FINCAP and fund effects',async()=>{
   const before=await counts(),money=await pilotBalances(pool);
   await pool.query("CREATE OR REPLACE FUNCTION finance_pilot.block_linked_audit_b8() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='FINANCE_LINKED_INVESTMENT' THEN RAISE EXCEPTION 'B8_AUDIT_INJECTED_FAILURE'; END IF; RETURN NEW; END$$");
   await pool.query('CREATE TRIGGER block_linked_audit_b8 BEFORE INSERT ON finance_pilot.audit FOR EACH ROW EXECUTE FUNCTION finance_pilot.block_linked_audit_b8()');
   try{
    await assert.rejects(pilotLinkedInvestmentAction(pool,{
     requestKey:uuid(),payload:investment('40','0')}),/B8_AUDIT_INJECTED_FAILURE/);
   }finally{
    await pool.query('DROP TRIGGER block_linked_audit_b8 ON finance_pilot.audit');
    await pool.query('DROP FUNCTION finance_pilot.block_linked_audit_b8()');
   }
   assert.deepEqual(await counts(),before);
   assert.deepEqual(await pilotBalances(pool),money);
  });
 }finally{await pool.end();}
});
