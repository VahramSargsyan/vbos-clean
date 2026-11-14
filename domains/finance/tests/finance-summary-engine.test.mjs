import test from 'node:test';
import assert from 'node:assert/strict';
import {
 FINANCE_BALANCE_FIELDS,FinanceSummaryEngineError,financeScopeFromRequest,
 financeScopesForRecord,financeSummaryFromRows,financeSummaryDelta,financeAffectedScopes
} from '../finance-summary-engine.mjs';
import {legacyOrderFinanceSummary,legacyObjectFinanceSummary,
 legacyWorkerFinanceSummary} from '../finance-order-result.mjs';

const order='WO-2026-0006',object='OBJ-2026-0005',worker='WRK-2026-0001';
const globalScope=financeScopeFromRequest();
const row=(o={})=>({
 status:'active',operationType:'INCOME',category:'current_work',
 incomeRecognition:'EARNED_AND_RECEIVED',amountBase:'100',commissionBase:'0',
 cashEffectBase:'100',profitEffectBase:'100',workerPayableEffectBase:'0',
 workOrderId:order,objectId:object,workerId:worker,...o
});
const orderScope=financeScopeFromRequest({workOrderId:order});
const workerScope=financeScopeFromRequest({workerId:worker});
const objectScope=financeScopeFromRequest({objectId:object});
const zero='0.000000';

test('GLOBAL|ALL is the default; original selector priority: order > worker > object',()=>{
 assert.deepEqual(globalScope,{scopeKey:'GLOBAL|ALL',scopeType:'GLOBAL',scopeId:'ALL'});
 assert.equal(financeScopeFromRequest({objectId:object}).scopeKey,'OBJECT|'+object);
 assert.equal(financeScopeFromRequest({workerId:worker,objectId:object}).scopeKey,'WORKER|'+worker);
 assert.equal(financeScopeFromRequest({workOrderId:order,workerId:worker,objectId:object}).scopeKey,'WORK_ORDER|'+order);
 assert.throws(()=>financeScopeFromRequest({workOrderId:'hello world'}),/FINANCE_SUMMARY_SCOPE_INVALID/);
 assert.throws(()=>financeScopeFromRequest('bad'),/FINANCE_SUMMARY_REQUEST_INVALID/);
});

test('one multiscoped transaction contributes once to GLOBAL and each of its three matching scopes',()=>{
 const data=[row({}),row({workOrderId:'WO-2026-0013',objectId:object,workerId:worker,
  amountBase:'40',cashEffectBase:'40',profitEffectBase:'40'})];
 const g=financeSummaryFromRows(data);
 assert.equal(g.transactionCount,2);
 assert.equal(g.earnedBase,'140.000000');
 assert.equal(financeSummaryFromRows(data,orderScope).transactionCount,1);
 assert.equal(financeSummaryFromRows(data,objectScope).transactionCount,2);
 assert.equal(financeSummaryFromRows(data,workerScope).transactionCount,2);
 assert.equal(financeSummaryFromRows(data,orderScope).profitBase,'100.000000');
 assert.equal(financeSummaryFromRows(data,objectScope).profitBase,'140.000000');
});

test('legacy expense, commission, accrual, cash receipt, material transit, archived exclusion',()=>{
 const tx=[
  row({amountBase:'1000',commissionBase:'5',cashEffectBase:'995',profitEffectBase:'995'}),
  row({operationType:'WORKER_ACCRUAL',category:'worker',amountBase:'300',
   cashEffectBase:'0',profitEffectBase:'-300',workerPayableEffectBase:'300'}),
  row({operationType:'WORKER_PAYMENT',category:'worker',amountBase:'200',
   commissionBase:'2',cashEffectBase:'-202',profitEffectBase:'-2',
   workerPayableEffectBase:'-200'}),
  row({operationType:'EXPENSE',category:'other',amountBase:'100',
   cashEffectBase:'-100',profitEffectBase:'-100'}),
  row({category:'client_material_funds',incomeRecognition:'RECEIVED_ONLY',
   amountBase:'300000',cashEffectBase:'300000',profitEffectBase:'0'}),
  row({operationType:'EXPENSE',category:'client_material_purchase',amountBase:'295000',
   cashEffectBase:'-295000',profitEffectBase:'0'}),
  row({status:'archived',amountBase:'999999999',cashEffectBase:'999999999',
   profitEffectBase:'999999999'})
 ];
 const g=financeSummaryFromRows(tx);
 assert.equal(g.transactionCount,6);
 assert.deepEqual(Object.fromEntries(Object.entries(g).filter(([k])=>FINANCE_BALANCE_FIELDS.includes(k))),{
  earnedBase:'1000.000000',receivedBase:'301000.000000',
  economicExpenseBase:'407.000000',cashOutBase:'295302.000000',
  ownerTransferBase:zero,workerAccruedBase:'300.000000',
  workerPaidBase:'200.000000',workerPayableBase:'100.000000',
  profitBase:'593.000000',cashBalanceBase:'5693.000000',transactionCount:6
 });
 // These are original normalized 11 fields, NOT automatic profitability of material principal.
 assert.equal(g.profitBase,'593.000000');
 assert.equal(g.cashBalanceBase,'5693.000000');
});

test('income recognition modes, owner transfer, worker accrual payment and exact micros',()=>{
 const data=[
  row({incomeRecognition:'EARNED_ONLY',amountBase:'0.000001',
   cashEffectBase:'0',profitEffectBase:'0.000001'}),
  row({incomeRecognition:'RECEIVED_ONLY',amountBase:'0.000002',
   cashEffectBase:'0.000002',profitEffectBase:'0'}),
  row({operationType:'OWNER_TRANSFER',amountBase:'20',
   cashEffectBase:'-20',profitEffectBase:'0'}),
  row({operationType:'WORKER_ACCRUAL_PAYMENT',amountBase:'10.000005',
   cashEffectBase:'-10.000005',profitEffectBase:'-10.000005',workerPayableEffectBase:'0'})
 ];
 const g=financeSummaryFromRows(data);
 assert.equal(g.earnedBase,'0.000001');
 assert.equal(g.receivedBase,'0.000002');
 assert.equal(g.ownerTransferBase,'20.000000');
 assert.equal(g.workerAccruedBase,'10.000005');
 assert.equal(g.workerPaidBase,'10.000005');
 assert.equal(g.economicExpenseBase,'10.000005');
 assert.equal(g.cashOutBase,'30.000005');
 assert.equal(g.profitBase,'-10.000004');
 assert.equal(g.transactionCount,4);
});

test('no rows is a mathematical zero only; function makes no completeness assertion',()=>{
 const g=financeSummaryFromRows([]);
 assert.equal(g.transactionCount,0);
 assert.equal(g.profitBase,zero);
 assert.equal(g.scopeKey,'GLOBAL|ALL');
 assert.equal(g.sourceComplete,undefined);
 assert.ok(Object.isFrozen(g));
});

test('exact original Order/Object/Worker isolated parity with existing archive calculation',()=>{
 const rows=[
  row({operationType:'WORKER_ACCRUAL_PAYMENT',category:'worker',amountBase:'20000',
   cashEffectBase:'-20000',profitEffectBase:'-20000',workerPayableEffectBase:'0'}),
  row({status:'archived',amountBase:'150'})
 ];
 for(const [scope,legacy] of [
  [orderScope,legacyOrderFinanceSummary],
  [objectScope,legacyObjectFinanceSummary],
  [workerScope,legacyWorkerFinanceSummary]
 ]){
  const calc=financeSummaryFromRows(rows,scope);
  const legacyControl={...calc};
  const original=legacy(scope.scopeId,rows,legacyControl);
  for(const field of FINANCE_BALANCE_FIELDS)assert.equal(calc[field],original[field],field);
 }
});

test('incremental create, edit, archive and restore matches full recalculation',()=>{
 const original=row({amountBase:'100',cashEffectBase:'100',profitEffectBase:'100'});
 const updated=row({amountBase:'110',cashEffectBase:'90',profitEffectBase:'80'});
 const archived={...updated,status:'archived'};
 const start=financeSummaryFromRows([]);
 const created=financeSummaryDelta(start,globalScope,null,original);
 assert.deepEqual(created,financeSummaryFromRows([original]));
 const edited=financeSummaryDelta(created,globalScope,original,updated);
 assert.deepEqual(edited,financeSummaryFromRows([updated]));
 const removed=financeSummaryDelta(edited,globalScope,updated,archived);
 assert.deepEqual(removed,financeSummaryFromRows([archived]));
 const restored=financeSummaryDelta(removed,globalScope,archived,original);
 assert.deepEqual(restored,created);
});

test('changing relations updates only relevant scopes, never double-counts GLOBAL',()=>{
 const before=row({workOrderId:order,objectId:object,workerId:worker});
 const after=row({workOrderId:'WO-2026-0014',objectId:object,workerId:worker,
  amountBase:'150',cashEffectBase:'150',profitEffectBase:'150'});
 const affected=financeAffectedScopes(before,after);
 assert.deepEqual(affected.map(s=>s.scopeKey),[
  'GLOBAL|ALL','OBJECT|'+object,'WORK_ORDER|'+order,'WORKER|'+worker,
  'WORK_ORDER|WO-2026-0014'
 ]);
 const g1=financeSummaryFromRows([before]);
 assert.deepEqual(financeSummaryDelta(g1,globalScope,before,after),financeSummaryFromRows([after]));
 const o1=financeSummaryFromRows([before],orderScope);
 assert.deepEqual(financeSummaryDelta(o1,orderScope,before,after),financeSummaryFromRows([after],orderScope));
 const newOrder=financeScopeFromRequest({workOrderId:'WO-2026-0014'});
 assert.deepEqual(financeSummaryDelta(null,newOrder,before,after),
  financeSummaryFromRows([after],newOrder));
});

test('bad inputs, negative money, nonfinite and invalid status are rejected',()=>{
 for(const v of ['NaN','Infinity','1e3','-0.1','1.2345678','1,23','']){
  assert.throws(()=>financeSummaryFromRows([row({amountBase:v})]),
   e=>e instanceof FinanceSummaryEngineError,v);
 }
 assert.throws(()=>financeSummaryFromRows([row({status:'paid'})]),
  /FINANCE_SUMMARY_STATUS_INVALID/);
 assert.throws(()=>financeSummaryFromRows([row({operationType:'INVALID'})]),
  /FINANCE_SUMMARY_OPERATION_INVALID/);
 assert.throws(()=>financeSummaryFromRows([row({commissionBase:'-1'})]),
  /FINANCE_SUMMARY_NEGATIVE_commissionBase/);
 assert.throws(()=>financeSummaryFromRows(new Array(10001).fill(row())),
  /FINANCE_SUMMARY_INPUT_BOUND/);
 assert.throws(()=>financeSummaryFromRows([row()],{scopeType:'WORKER',scopeId:'bad id'}),
  /FINANCE_SUMMARY_SCOPE_INVALID/);
});

test('delta rejects invalid previous balance, wrong scope, and negative transaction count',()=>{
 const one=row();
 const current=financeSummaryFromRows([one]);
 assert.throws(()=>financeSummaryDelta(current,orderScope,one,null),
  /FINANCE_SUMMARY_BALANCE_SCOPE_MISMATCH/);
 assert.throws(()=>financeSummaryDelta({...current,transactionCount:-1},globalScope,one,null),
  /FINANCE_SUMMARY_BALANCE_COUNT_INVALID/);
 assert.throws(()=>financeSummaryDelta(null,globalScope,one,null),
  /FINANCE_SUMMARY_NEGATIVE_COUNT/);
});

test('engine has no data access or mutable identity mapping in its public contract',()=>{
 const result=financeSummaryFromRows([row()]);
 assert.equal(Object.keys(result).length,14); // scopeKey/type/id + 11 numeric fields
 assert.ok(!('sourceId' in result));assert.ok(!('database' in result));
 assert.equal(typeof financeSummaryFromRows,'function');
});
