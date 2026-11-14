import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyOrderFinanceSummary,financeOrderResultRead,FinanceOrderResultError} from '../finance-order-result.mjs';
import {financeOrderResultHtml} from '../finance-order-result-view.mjs';

const order='WO-2026-0006';
const base=(changes={})=>({
 workOrderId:order,status:'active',operationType:'INCOME',category:'current_work',
 incomeRecognition:'EARNED_AND_RECEIVED',amountBase:'100',commissionBase:'0',
 cashEffectBase:'100',profitEffectBase:'100',workerPayableEffectBase:'0',...changes
});
const control=(id,fields)=>({scopeKey:'WORK_ORDER|'+id,scopeType:'WORK_ORDER',scopeId:id,...fields});

test('exact archived work order fixture: client material principal is profit-neutral (WO-2026-0006)',()=>{
 const transactions=[
  base({category:'client_material_funds',incomeRecognition:'RECEIVED_ONLY',amountBase:'300000',cashEffectBase:'300000',profitEffectBase:'0'}),
  base({operationType:'EXPENSE',category:'client_material_purchase',incomeRecognition:'',amountBase:'295000',cashEffectBase:'-295000',profitEffectBase:'0'})
 ];
 const c=control(order,{earnedBase:0,receivedBase:300000,economicExpenseBase:0,cashOutBase:295000,
  ownerTransferBase:0,workerAccruedBase:0,workerPaidBase:0,workerPayableBase:0,
  profitBase:0,cashBalanceBase:5000,transactionCount:2});
 const result=legacyOrderFinanceSummary(order,transactions,c);
 assert.equal(result.profitBase,'0.000000');
 assert.equal(result.earnedBase,'0.000000');
 assert.equal(result.receivedBase,'300000.000000');
 assert.equal(result.economicExpenseBase,'0.000000');
 assert.equal(result.cashBalanceBase,'5000.000000');
 assert.equal(result.transactionCount,2);
});
test('parity of earned / received / worker debt / expense / commission / cash effects',()=>{
 const transactions=[
  base({amountBase:'1000',commissionBase:'5',cashEffectBase:'995',profitEffectBase:'995'}),
  base({operationType:'WORKER_ACCRUAL',category:'worker',amountBase:'300',cashEffectBase:'0',profitEffectBase:'-300',workerPayableEffectBase:'300'}),
  base({operationType:'WORKER_PAYMENT',category:'worker',amountBase:'200',commissionBase:'2',cashEffectBase:'-202',profitEffectBase:'-2',workerPayableEffectBase:'-200'}),
  base({operationType:'EXPENSE',category:'other',amountBase:'100',cashEffectBase:'-100',profitEffectBase:'-100'}),
  base({status:'archived',amountBase:'999999',profitEffectBase:'999999',cashEffectBase:'999999'})
 ];
 const c=control(order,{earnedBase:1000,receivedBase:1000,economicExpenseBase:407,cashOutBase:302,
 ownerTransferBase:0,workerAccruedBase:300,workerPaidBase:200,workerPayableBase:100,
 profitBase:593,cashBalanceBase:693,transactionCount:4});
 const r=legacyOrderFinanceSummary(order,transactions,c);
 assert.equal(r.profitBase,'593.000000');
 assert.equal(r.workerPayableBase,'100.000000');
 assert.equal(r.economicExpenseBase,'407.000000');
 assert.equal(r.cashOutBase,'302.000000');
 assert.equal(r.transactionCount,4);
});
test('exact decimal micro precision and archived contributions excluded',()=>{
 const r=legacyOrderFinanceSummary(order,[base({amountBase:'0.000001',cashEffectBase:'0.000001',profitEffectBase:'0.000001'})],
  control(order,{earnedBase:'0.000001',receivedBase:'0.000001',economicExpenseBase:0,cashOutBase:0,
   ownerTransferBase:0,workerAccruedBase:0,workerPaidBase:0,workerPayableBase:0,
   profitBase:'0.000001',cashBalanceBase:'0.000001',transactionCount:1}));
 assert.equal(r.profitBase,'0.000001');
 assert.equal(r.transactionCount,1);
});
test('fail closed when control missing or any stored summary differs from source',()=>{
 assert.throws(()=>legacyOrderFinanceSummary(order,[base()],null),/FINANCE_ORDER_BALANCE_MISSING/);
 const c=control(order,{earnedBase:0});
 assert.throws(()=>legacyOrderFinanceSummary(order,[base()],c),/FINANCE_ORDER_BALANCE_PARITY_earnedBase/);
 assert.throws(()=>legacyOrderFinanceSummary(order,[base({workOrderId:'WO-OTHER'})],null),/FINANCE_ORDER_ROW_INVALID/);
 assert.throws(()=>legacyOrderFinanceSummary(order,[base({amountBase:'NaN'})],null),/FINANCE_ORDER_INVALID_MONEY_amountBase/);
 assert.throws(()=>legacyOrderFinanceSummary('BAD ID',[base()],null),/FINANCE_ORDER_SOURCE_INVALID/);
});
test('zero source transactions are not represented as proof of zero real profit',()=>{
 const r=legacyOrderFinanceSummary(order,[],null);
 const text=financeOrderResultHtml({source:'VERIFIED_FROZEN_LEGACY_ORDER_FINANCE',readonly:true,
  currentOperationalFinance:false,financialWriter:'GOOGLE',currency:'AMD',
  orderId:order,orderTitle:'One order',transactionCount:r.transactionCount,
  hasOperations:false,sourceModifiedAt:'2026-11-06',...r});
 assert.match(text,/результат неизвестен/);
 assert.doesNotMatch(text,/Прибыль заказа/);
});
test('UI escapes archival order labels, does not leak raw markup or imply current money',()=>{
 const r=legacyOrderFinanceSummary(order,[base()],control(order,{earnedBase:100,receivedBase:100,
  economicExpenseBase:0,cashOutBase:0,ownerTransferBase:0,workerAccruedBase:0,
  workerPaidBase:0,workerPayableBase:0,profitBase:100,cashBalanceBase:100,transactionCount:1}));
 const html=financeOrderResultHtml({source:'VERIFIED_FROZEN_LEGACY_ORDER_FINANCE',readonly:true,
  currentOperationalFinance:false,financialWriter:'GOOGLE',currency:'AMD',
  orderId:order,orderTitle:'<img onerror=alert(1)>',transactionCount:r.transactionCount,
  hasOperations:true,sourceModifiedAt:'2026-11-06',...r});
 assert.match(html,/&lt;img/);
 assert.doesNotMatch(html,/<img/);
 assert.match(html,/100 AMD/);
 assert.match(html,/Не текущий баланс/);
 assert.throws(()=>financeOrderResultHtml({source:'LIVE',readonly:true}),/SOURCE_UNVERIFIED/);
});
test('owner gate rejects unauthenticated requests before even reading database',async()=>{
 let called=false;
 const db={query:async()=>{called=true;throw Error('DB_READ_SHOULD_NOT_HAPPEN');}};
 await assert.rejects(()=>financeOrderResultRead(db,order,{authorizeOwner:()=>false}),
  e=>e instanceof FinanceOrderResultError&&e.status===401);
 assert.equal(called,false);
 await assert.rejects(()=>financeOrderResultRead(db,'bad id',{authorizeOwner:()=>true}),
  e=>e instanceof FinanceOrderResultError&&e.status===400);
 assert.equal(called,false);
});
