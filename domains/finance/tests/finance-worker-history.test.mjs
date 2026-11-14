import {test} from 'node:test';
import assert from 'node:assert/strict';
import {legacyWorkerFinanceSummary,legacyOrderFinanceSummary} from '../finance-order-result.mjs';
import {financeWorkerHistoryRead,financeWorkerOptionsRead,FinanceWorkerHistoryError} from '../finance-worker-history.mjs';
import {financeWorkerHistoryHtml,mountFinanceWorkerHistoryPanel} from '../finance-worker-history-view.mjs';

const WORKER='WRK-2026-0001',ORDER='WO-2026-0012';
const financialFields=['earnedBase','receivedBase','economicExpenseBase','cashOutBase',
 'ownerTransferBase','workerAccruedBase','workerPaidBase','workerPayableBase',
 'profitBase','cashBalanceBase','transactionCount'];
const control=(id,fields={})=>({
 scopeKey:'WORKER|'+id,scopeType:'WORKER',scopeId:id,
 ...Object.fromEntries(financialFields.map(x=>[x,0])),...fields
});
const tx=(more={})=>({
 workerId:WORKER,workOrderId:ORDER,status:'active',operationType:'WORKER_ACCRUAL_PAYMENT',
 category:'worker',amountBase:'20000',commissionBase:'0',
 cashEffectBase:'-20000',profitEffectBase:'-20000',
 workerPayableEffectBase:'0',incomeRecognition:'',...more
});
const workerView=(metrics,more={})=>({
 source:'VERIFIED_FROZEN_LEGACY_WORKER_FINANCE',readonly:true,financialWriter:'GOOGLE',
 currentOperationalFinance:false,workerId:WORKER,workerName:'Работник',
 sourceModifiedAt:'2026-11-06T00:00:00Z',currency:'AMD',
 ...metrics,hasOperations:metrics.transactionCount>0,...more
});
test('frozen worker WORKER|WRK-2026-0001 original 11-field control parity',()=>{
 const m=legacyWorkerFinanceSummary(WORKER,[tx()],control(WORKER,{
  earnedBase:0,receivedBase:0,economicExpenseBase:20000,cashOutBase:20000,
  workerAccruedBase:20000,workerPaidBase:20000,workerPayableBase:0,
  profitBase:-20000,cashBalanceBase:-20000,transactionCount:1
 }));
 assert.equal(m.transactionCount,1);
 assert.equal(m.workerAccruedBase,'20000.000000');
 assert.equal(m.workerPaidBase,'20000.000000');
 assert.equal(m.workerPayableBase,'0.000000');
 assert.equal(m.profitBase,'-20000.000000');
 assert.equal(m.cashBalanceBase,'-20000.000000');
 const html=financeWorkerHistoryHtml(workerView(m));
 assert.match(html,/Влияние на прибыль бизнеса/);
 assert.match(html,/Не зарплата работника/);
 assert.doesNotMatch(html,/Прибыль работника/);
});
test('worker result does not alter original WorkOrder scope semantics',()=>{
 const row=tx();
 const orderControl={...control(WORKER,{economicExpenseBase:20000,cashOutBase:20000,
  workerAccruedBase:20000,workerPaidBase:20000,profitBase:-20000,
  cashBalanceBase:-20000,transactionCount:1}),
  scopeType:'WORK_ORDER',scopeKey:'WORK_ORDER|'+ORDER,scopeId:ORDER};
 const w=legacyWorkerFinanceSummary(WORKER,[row],control(WORKER,{
  economicExpenseBase:20000,cashOutBase:20000,workerAccruedBase:20000,workerPaidBase:20000,
  profitBase:-20000,cashBalanceBase:-20000,transactionCount:1
 }));
 const o=legacyOrderFinanceSummary(ORDER,[row],orderControl);
 assert.equal(w.profitBase,o.profitBase);
 assert.equal(w.workerPaidBase,o.workerPaidBase);
});
test('archived entries excluded, unrelated worker rejected, missing control fails closed',()=>{
 const row=tx();
 assert.throws(()=>legacyWorkerFinanceSummary(WORKER,[row],null),/FINANCE_WORKER_BALANCE_MISSING/);
 assert.throws(()=>legacyWorkerFinanceSummary(WORKER,[tx({workerId:'WRK-OTHER'})],null),
  /FINANCE_WORKER_ROW_INVALID/);
 assert.throws(()=>legacyWorkerFinanceSummary(WORKER,[row],control(WORKER)),
  /FINANCE_WORKER_BALANCE_PARITY/);
 const empty=legacyWorkerFinanceSummary('WRK-2026-0002',[],null);
 assert.equal(empty.transactionCount,0);
 const html=financeWorkerHistoryHtml(workerView(empty,{workerId:'WRK-2026-0002'}));
 assert.match(html,/неизвестен/);
 assert.doesNotMatch(html,/Начислено по операциям/);
 const archived=legacyWorkerFinanceSummary(WORKER,[tx({status:'archived'})],null);
 assert.equal(archived.transactionCount,0);
});
test('owner gate and invalid Worker ID reject without DB reads',async()=>{
 let sql=0;
 const db={query:async()=>{sql++;throw Error('SQL_SHOULD_NOT_RUN');}};
 await assert.rejects(financeWorkerOptionsRead(db,{authorizeOwner:()=>false}),
  e=>e instanceof FinanceWorkerHistoryError&&e.status===401);
 await assert.rejects(financeWorkerHistoryRead(db,WORKER,{authorizeOwner:()=>false}),
  e=>e instanceof FinanceWorkerHistoryError&&e.status===401);
 await assert.rejects(financeWorkerHistoryRead(db,'bad id',{authorizeOwner:()=>true}),
  e=>e instanceof FinanceWorkerHistoryError&&e.status===400);
 assert.equal(sql,0);
});
test('worker name and identity escaped; wrong source rejected',()=>{
 const empty=legacyWorkerFinanceSummary('WRK-2026-0002',[],null);
 const html=financeWorkerHistoryHtml(workerView(empty,{workerId:'WRK-2026-0002',
  workerName:'<img src=x onerror=alert(1)>'}));
 assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
 assert.throws(()=>financeWorkerHistoryHtml({...workerView(empty),source:'LIVE'}));
 assert.throws(()=>financeWorkerHistoryHtml({...workerView(empty),currentOperationalFinance:true}));
});
test('worker selector fetches verified source options and one selected result',async()=>{
 const handlers=new Map(),calls=[];
 const root={innerHTML:'',addEventListener:(k,fn)=>handlers.set(k,fn),
  removeEventListener:(k,fn)=>{if(handlers.get(k)===fn)handlers.delete(k)}};
 const metrics=legacyWorkerFinanceSummary(WORKER,[tx()],control(WORKER,{
  economicExpenseBase:20000,cashOutBase:20000,workerAccruedBase:20000,
  workerPaidBase:20000,profitBase:-20000,cashBalanceBase:-20000,transactionCount:1
 }));
 const fetchPage=async path=>{
  calls.push(path);
  if(path==='/api/finance/worker-options')
   return {source:'VERIFIED_FROZEN_LEGACY_WORKER_OPTIONS',readonly:true,
    currentOperationalFinance:false,workers:[
     {workerId:WORKER,workerName:'Worker1'},
     {workerId:'WRK-2026-0002',workerName:'Worker2'}]};
  return workerView(metrics);
 };
 const ui=mountFinanceWorkerHistoryPanel(root,{fetchPage});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(root.innerHTML,/Worker1/);
 handlers.get('change')({target:{matches:s=>s==='[data-worker-finance-select]',value:WORKER}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,2);
 assert.match(calls[1],/workerId=WRK-2026-0001/);
 assert.match(root.innerHTML,/Влияние на прибыль бизнеса/);
 ui.unmount();assert.equal(handlers.size,0);
});
