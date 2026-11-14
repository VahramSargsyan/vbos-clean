import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyOrderFinanceSummary,legacyObjectFinanceSummary,FinanceOrderResultError} from '../finance-order-result.mjs';
import {financeObjectOptionsRead,financeObjectResultRead,FinanceObjectResultError} from '../finance-object-result.mjs';
import {financeObjectResultHtml} from '../finance-object-result-view.mjs';

const OBJ='OBJ-2026-0005';
const defaultTx=(fields={})=>({
 objectId:OBJ,workOrderId:'WO-2026-0006',status:'active',
 operationType:'INCOME',category:'current_work',incomeRecognition:'EARNED_AND_RECEIVED',
 amountBase:'100',commissionBase:'0',cashEffectBase:'100',profitEffectBase:'100',
 workerPayableEffectBase:'0',...fields
});
const keys=['earnedBase','receivedBase','economicExpenseBase','cashOutBase','ownerTransferBase',
 'workerAccruedBase','workerPaidBase','workerPayableBase','profitBase','cashBalanceBase','transactionCount'];
const control=(data={})=>({
 scopeKey:'OBJECT|'+OBJ,scopeType:'OBJECT',scopeId:OBJ,
 ...Object.fromEntries(keys.map(k=>[k,0])),...data
});
const view=(summary,title='Объект',extra={})=>({
 source:'VERIFIED_FROZEN_LEGACY_OBJECT_FINANCE',readonly:true,currentOperationalFinance:false,
 financialWriter:'GOOGLE',currency:'AMD',objectId:OBJ,objectTitle:title,
 sourceModifiedAt:'2026-11-06',...summary,hasOperations:summary.transactionCount>0,
 relatedOrderCount:1,...extra
});

test('original archived OBJ-2026-0005 matches client material receipt and purchase',()=>{
 const tx=[
  defaultTx({category:'client_material_funds',incomeRecognition:'RECEIVED_ONLY',
   amountBase:'300000',cashEffectBase:'300000',profitEffectBase:'0'}),
  defaultTx({operationType:'EXPENSE',category:'client_material_purchase',incomeRecognition:'',
   amountBase:'295000',cashEffectBase:'-295000',profitEffectBase:'0'})
 ];
 const result=legacyObjectFinanceSummary(OBJ,tx,control({
  earnedBase:0,receivedBase:300000,economicExpenseBase:0,cashOutBase:295000,
  cashBalanceBase:5000,profitBase:0,transactionCount:2
 }));
 assert.equal(result.profitBase,'0.000000');
 assert.equal(result.receivedBase,'300000.000000');
 assert.equal(result.cashBalanceBase,'5000.000000');
 assert.equal(result.economicExpenseBase,'0.000000');
 assert.equal(result.transactionCount,2);
});
test('one Object with two WorkOrders receives each linked transaction once',()=>{
 const tx=[
  defaultTx({workOrderId:'WO-2026-0001',amountBase:'250',cashEffectBase:'250',profitEffectBase:'250'}),
  defaultTx({workOrderId:'WO-2026-0002',operationType:'EXPENSE',category:'tools',
   amountBase:'40',cashEffectBase:'-40',profitEffectBase:'-40'}),
  defaultTx({objectId:'OBJ-DIFFERENT',workOrderId:'WO-2026-0002',amountBase:'900'})
 ];
 // The query is scoped by objectId; unrelated transactions cannot enter the aggregation.
 assert.throws(()=>legacyObjectFinanceSummary(OBJ,tx,null),/FINANCE_OBJECT_ROW_INVALID/);
 const summary=legacyObjectFinanceSummary(OBJ,tx.slice(0,2),control({
  earnedBase:250,receivedBase:250,economicExpenseBase:40,cashOutBase:40,
  profitBase:210,cashBalanceBase:210,transactionCount:2
 }));
 assert.equal(summary.profitBase,'210.000000');
 assert.equal(summary.transactionCount,2);
 assert.equal(legacyOrderFinanceSummary('WO-2026-0001',[tx[0]],{
  scopeKey:'WORK_ORDER|WO-2026-0001',scopeType:'WORK_ORDER',scopeId:'WO-2026-0001',
  earnedBase:250,receivedBase:250,economicExpenseBase:0,cashOutBase:0,
  ownerTransferBase:0,workerAccruedBase:0,workerPaidBase:0,workerPayableBase:0,
  profitBase:250,cashBalanceBase:250,transactionCount:1
 }).profitBase,'250.000000');
});
test('worker debt, commissions, archived rows and 6-digit exact decimals',()=>{
 const tx=[
  defaultTx({operationType:'WORKER_ACCRUAL',category:'worker',amountBase:'10.000001',
   cashEffectBase:'0',profitEffectBase:'-10.000001',workerPayableEffectBase:'10.000001'}),
  defaultTx({operationType:'WORKER_PAYMENT',category:'worker',amountBase:'5',
   commissionBase:'0.5',cashEffectBase:'-5.5',profitEffectBase:'-0.5',
   workerPayableEffectBase:'-5'}),
  defaultTx({status:'archived',amountBase:'99999',profitEffectBase:'99999'})
 ];
 const r=legacyObjectFinanceSummary(OBJ,tx,control({
  economicExpenseBase:'10.500001',cashOutBase:'5.5',workerAccruedBase:'10.000001',
  workerPaidBase:5,workerPayableBase:'5.000001',profitBase:'-10.500001',
  cashBalanceBase:'-5.5',transactionCount:2
 }));
 assert.equal(r.workerPayableBase,'5.000001');
 assert.equal(r.profitBase,'-10.500001');
 assert.equal(r.transactionCount,2);
});
test('missing scope control and broken immutable snapshot fail closed',()=>{
 assert.throws(()=>legacyObjectFinanceSummary(OBJ,[defaultTx()],null),
  /FINANCE_OBJECT_BALANCE_MISSING/);
 assert.throws(()=>legacyObjectFinanceSummary(OBJ,[defaultTx()],control({profitBase:1})),
  /FINANCE_OBJECT_BALANCE_PARITY_earnedBase/);
 assert.throws(()=>legacyObjectFinanceSummary(OBJ,[defaultTx({objectId:'OBJ-OTHER'})],null),
  /FINANCE_OBJECT_ROW_INVALID/);
 assert.throws(()=>legacyObjectFinanceSummary('invalid id',[],null),
  /FINANCE_OBJECT_SOURCE_INVALID/);
 assert.throws(()=>legacyObjectFinanceSummary(OBJ,[defaultTx({amountBase:'NaN'})],null),
  /FINANCE_ORDER_INVALID_MONEY_amountBase/);
});
test('empty Object archive never implies realized profit zero, and titles are escaped',()=>{
 const empty=legacyObjectFinanceSummary(OBJ,[],null);
 const noData=financeObjectResultHtml(view(empty,'<script>alert(1)</script>',{relatedOrderCount:0}));
 assert.match(noData,/Результат неизвестен/);
 assert.match(noData,/&lt;script&gt;/);
 assert.doesNotMatch(noData,/<script>/);
 assert.doesNotMatch(noData,/Прибыль объекта/);
 const valid=legacyObjectFinanceSummary(OBJ,[defaultTx()],control({
  earnedBase:100,receivedBase:100,profitBase:100,cashBalanceBase:100,transactionCount:1
 }));
 const html=financeObjectResultHtml(view(valid,'<img src=x onerror=alert(1)>'));
 assert.match(html,/Прибыль объекта/);
 assert.match(html,/&lt;img/);
 assert.doesNotMatch(html,/<img/);
 assert.match(html,/Не текущий баланс/);
 assert.throws(()=>financeObjectResultHtml({...view(valid),source:'LIVE'}),
  /FINANCE_OBJECT_VIEW_SOURCE_UNVERIFIED/);
});
test('owner-only endpoints reject before any archive reads; invalid ID blocked',async()=>{
 let reads=0;
 const db={query:async()=>{reads++;throw Error('SHOULD_NOT_READ');}};
 await assert.rejects(()=>financeObjectOptionsRead(db,{authorizeOwner:()=>false}),
  e=>e instanceof FinanceObjectResultError&&e.status===401);
 await assert.rejects(()=>financeObjectResultRead(db,OBJ,{authorizeOwner:()=>false}),
  e=>e instanceof FinanceObjectResultError&&e.status===401);
 await assert.rejects(()=>financeObjectResultRead(db,'wrong id',{authorizeOwner:()=>true}),
  e=>e instanceof FinanceObjectResultError&&e.status===400);
 assert.equal(reads,0);
});
