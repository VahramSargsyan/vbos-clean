import {test} from 'node:test';
import assert from 'node:assert/strict';
import {financeCapitalArchiveHtml,mountFinanceCapitalArchivePanel,financeLegacyFormHtml,validateFinanceLegacyPreview,financeLegacyActiveOrder,financeLegacySearchResult} from '../finance-capital-view.mjs';
const data={
 source:'VERIFIED_LEGACY_FINANCE_CAPITAL_CLEAN_TEST',readonly:true,financialWriter:'GOOGLE',currentOperationalFinance:false,
 sourceModifiedAt:'2026-11-03T19:06:09.263Z',
 counts:{financeTransactions:24,monthlyGains:3,funds:8,fundMovements:6},
 finance:{cashBalanceBase:'203000.000000',profitBase:'588000.000000',earnedBase:'600000.000000',
  receivedBase:'203000.000000',workerPayableBase:'0.000000',currency:'AMD',
  economicExpenseBase:'20000.000000',workerPaidBase:'6000.000000',ownerTransferBase:'5000.000000'},
 months:[{monthKey:'2026-08',status:'active',totalBusinessGainsBase:'191300.000000',
  referralCommissionBase:'3000.000000',purchaseCommissionBase:'84300.000000',
  organizationMarginBase:'100000.000000',taxOptimizationSavingsBase:'4000.000000',
  otherBusinessIncomeBase:'0.000000'}],
 capital:{allocatedBase:'10000.000000',allocationLines:6,
  funds:[{fundId:'FND-1',name:'Фонд <script>alert(1)</script>',code:'SAVINGS',
   groupType:'GROWTH',status:'active',targetAmountBase:'100000.000000',balanceBase:'1000.000000'}],
  movements:[{fundTransactionId:'MOVE-1',toFundId:'FND-1',movementType:'ALLOCATION',amountBase:'1000.000000',status:'active'}]}
};
test('Finance tab labels frozen history and does not promise live money or edits',()=>{
 const html=financeCapitalArchiveHtml(data,'finance');
 assert.match(html,/АРХИВ/);assert.match(html,/Google/);
 assert.match(html,/203[\s\u00a0\u202f]*000/);
 assert.match(html,/588[\s\u00a0\u202f]*000/);
 assert.match(html,/191[\s\u00a0\u202f]*300/);
 assert.doesNotMatch(html,/<form|type="submit"|data-act=/);
 for(const name of ['Заработано','Получено','Расходы','Прибыль','Остаток денег',
  'Долг рабочим','Выплачено рабочим','Выведено владельцем'])assert.match(html,new RegExp(name));
 assert.match(html,/data-finance-legacy-draft="INCOME"/);
 assert.match(html,/data-finance-legacy-draft="EXPENSE"/);
 assert.match(html,/БЕЗ сохранения денег/);
});
test('Capital tab renders funds, movements and escapes source HTML',()=>{
 const html=financeCapitalArchiveHtml(data,'capital');
 assert.match(html,/Фонды капитала/);
 assert.match(html,/SAVINGS/);
 assert.match(html,/10[\s\u00a0\u202f]*000/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<form/);
});
test('fail closed when payload source/readonly/authority is wrong',()=>{
 for(const wrong of [{...data,readonly:false},{...data,financialWriter:'CLEAN'},
  {...data,source:'UNVERIFIED'},{...data,currentOperationalFinance:true}]){
  assert.throws(()=>financeCapitalArchiveHtml(wrong,'finance'));
 }
});
test('mount performs only the authenticated same-origin archive GET; unmount prevents stale render',async()=>{
 const handlers={};
 const root={innerHTML:'',addEventListener(type,cb){handlers[type]=cb;},
  removeEventListener(type,cb){if(handlers[type]===cb)delete handlers[type];}};
 let calls=0;
 const panel=mountFinanceCapitalArchivePanel(root,{mode:'capital',fetchPage:async url=>{
  calls++;assert.equal(url,'/api/finance/archive');return data;
 }});
 await Promise.resolve();await Promise.resolve();
 assert.equal(calls,1);assert.match(root.innerHTML,/Фонды капитала/);
 panel.unmount();assert.equal(handlers.click,undefined);
 let finish;const pending=new Promise(resolve=>{finish=resolve;});
 const late=mountFinanceCapitalArchivePanel(root,{mode:'finance',fetchPage:()=>pending});
 late.unmount();const before=root.innerHTML;finish(data);
 await Promise.resolve();await Promise.resolve();
 assert.equal(root.innerHTML,before);
});

test('quick action routes an income draft without financial write',async()=>{
 const handlers={};const routed=[];
 const root={innerHTML:'',addEventListener(type,cb){handlers[type]=cb;},
  removeEventListener(type){delete handlers[type];}};
 const panel=mountFinanceCapitalArchivePanel(root,{mode:'finance',
  fetchPage:async()=>data,onDraft:type=>routed.push(type)});
 await Promise.resolve();await Promise.resolve();
 handlers.click({target:{closest:s=>s==='[data-finance-legacy-draft]'?
  {getAttribute:()=> 'INCOME'}:null}});
 assert.deepEqual(routed,['INCOME']);panel.unmount();
});
test('missing financial value fails closed rather than displaying zero',()=>{
 const wrong={...data,finance:{...data.finance}};
 delete wrong.finance.workerPaidBase;
 assert.throws(()=>financeCapitalArchiveHtml(wrong,'finance'),/неполна/);
});

const refs={
 orders:[{id:'ord-1',title:'Кухня <script>alert(1)</script>',object_id:'obj-1'}],
 objects:[{id:'obj-1',name:'Дом №1'}],
 workers:[{id:'wrk-1',name:'Мастер <img src=x onerror=alert(1)>'}]
};
const rawIncome=()=>({
 legacyAction:'INCOME',operationType:'INCOME',transactionDate:'2026-11-13',
 category:'current_work',incomeRecognition:'EARNED_AND_RECEIVED',amountOriginal:'15000',
 currencyOriginal:'AMD',commissionOriginal:'0',workOrderId:'ord-1',objectId:'obj-1',
 counterparty:'Клиент',notes:'Старый интерфейс'
});
test('all five original operations offer matching conditional fields but never a Save action',()=>{
 for(const type of ['INCOME','EXPENSE','WORKER','OWNER_TRANSFER','INVEST']){
  const html=financeLegacyFormHtml(type,{today:'2026-11-13',refs});
  for(const field of ['transactionDate','amountOriginal','currencyOriginal',
   'commissionOriginal','counterparty','notes'])assert.match(html,new RegExp('name="'+field+'"'));
  assert.match(html,/ТОЛЬКО ПРОВЕРКА ФОРМЫ/);
  assert.match(html,/Сохранить · недоступно/);
  assert.doesNotMatch(html,/<button[^>]*type="submit"[^>]*>Сохранить/);
  assert.doesNotMatch(html,/<script>|<img|<[^>]+onerror=|fetch\(/);
 }
 const income=financeLegacyFormHtml('INCOME',{refs});
 assert.match(income,/name="incomeRecognition"/);
 assert.match(income,/Оплата текущей работы/);
 assert.match(income,/name="workOrderId"/);
 const expense=financeLegacyFormHtml('EXPENSE',{refs});
 assert.match(expense,/Транспорт/);
 const worker=financeLegacyFormHtml('WORKER',{refs});
 assert.match(worker,/Начисление и выплата/);
 assert.match(worker,/name="workerId"/);
 const owner=financeLegacyFormHtml('OWNER_TRANSFER',{refs});
 assert.match(owner,/Куда выведены деньги/);
 assert.doesNotMatch(owner,/name="workOrderId"/);
 const invest=financeLegacyFormHtml('INVEST',{refs});
 assert.match(invest,/15% \/ 15% \/ 70%/);
 assert.match(invest,/value="investments"/);
 assert.doesNotMatch(invest,/name="workOrderId"/);
});
test('legacy preview validates income/order/worker/payment/owner/investment without posting money',()=>{
 const income=validateFinanceLegacyPreview(rawIncome(),{refs});
 assert.equal(income.operationType,'INCOME');
 assert.equal(income.workOrderId,'ord-1');
 assert.equal(income.previewOnly,true);assert.equal(income.saved,false);
 const expense=validateFinanceLegacyPreview({...rawIncome(),legacyAction:'EXPENSE',
  operationType:'EXPENSE',category:'transport',workOrderId:''},{refs});
 assert.equal(expense.category,'transport');
 const worker=validateFinanceLegacyPreview({...rawIncome(),legacyAction:'WORKER',
  operationType:'WORKER_PAYMENT',workerId:'wrk-1',workOrderId:'',objectId:''},{refs});
 assert.equal(worker.operationType,'WORKER_PAYMENT');
 const owner=validateFinanceLegacyPreview({...rawIncome(),legacyAction:'OWNER_TRANSFER',
  operationType:'OWNER_TRANSFER',ownerDirection:'home'},{refs});
 assert.equal(owner.ownerDirection,'home');assert.equal(owner.workOrderId,'');
 const invest=validateFinanceLegacyPreview({...rawIncome(),legacyAction:'INVEST',
  ownerDirection:'home'},{refs});
 assert.equal(invest.ownerDirection,'investments');
 assert.equal(invest.operationType,'OWNER_TRANSFER');
 assert.equal(invest.workOrderId,'');
});
test('legacy preview rejects missing/forged links, invalid money and FX, stale category',()=>{
 const rejects=[
  {...rawIncome(),workOrderId:''},
  {...rawIncome(),workOrderId:'foreign-order'},
  {...rawIncome(),objectId:'foreign-object'},
  {...rawIncome(),objectId:'obj-2'},
  {...rawIncome(),amountOriginal:'0'},
  {...rawIncome(),amountOriginal:'-1'},
  {...rawIncome(),amountOriginal:'Infinity'},
  {...rawIncome(),currencyOriginal:'USD',fxRate:'0'},
  {...rawIncome(),currencyOriginal:'DOGE'},
  {...rawIncome(),category:'client_material_purchase'},
  {...rawIncome(),incomeRecognition:'EARNED_ONLY',commissionOriginal:'50'},
  {...rawIncome(),transactionDate:'2026-02-30'},
  {...rawIncome(),legacyAction:'WORKER',operationType:'WORKER_PAYMENT',workerId:''},
  {...rawIncome(),legacyAction:'WORKER',operationType:'WORKER_ACCRUAL',
   workerId:'wrk-1',commissionOriginal:'3'},
  {...rawIncome(),legacyAction:'OWNER_TRANSFER',ownerDirection:'surprise'}
 ];
 for(const raw of rejects)assert.throws(()=>validateFinanceLegacyPreview(raw,{refs}));
});
test('quick buttons open a complete UI-only modal; no implicit B15 call or financial POST',async()=>{
 const handlers={},host={innerHTML:'',
  querySelector(selector){if(selector==='[data-finance-legacy-dialog]')
   return {showModal(){},open:true};return null;}};
 const root={innerHTML:'',addEventListener(type,cb){handlers[type]=cb;},
  removeEventListener(type){delete handlers[type];},
  querySelector(selector){return selector==='[data-finance-legacy-form-host]'?host:null;}};
 let calls=0,dryRun=0;
 const panel=mountFinanceCapitalArchivePanel(root,{mode:'finance',refs,
  fetchPage:async url=>{calls++;assert.equal(url,'/api/finance/archive');return data;},
  onDraft:()=>dryRun++});
 await Promise.resolve();await Promise.resolve();
 for(const type of ['INCOME','EXPENSE','WORKER','OWNER_TRANSFER','INVEST']){
  handlers.click({target:{getAttribute:()=>type,closest:s=>
   s==='[data-finance-legacy-draft]'?{getAttribute:()=>type}:null}});
  assert.match(host.innerHTML,new RegExp('value="'+type+'"'));
  assert.match(host.innerHTML,/Сохранить · недоступно/);
 }
 assert.equal(calls,1);assert.equal(dryRun,0);
 panel.unmount();
 assert.equal(handlers.click,undefined);
});

test('verified active session preselects only its exact order and object; inactive/stale do not',()=>{
 const state={
  currentSession:{order_id:'ord-current',day_date:'2026-11-13',ended_at:null},
  contextOrder:{id:'ord-current',object_id:'obj-current',title:'Заказ сейчас',
   object_name:'Склад',status:'active'}
 };
 assert.deepEqual(financeLegacyActiveOrder(state,'2026-11-13'),{
  id:'ord-current',title:'Заказ сейчас',object_id:'obj-current',
  objectName:'Склад',objectId:'obj-current'
 });
 for(const invalid of [
  {...state,currentSession:{...state.currentSession,ended_at:'2026-11-13T11:00Z'}},
  {...state,currentSession:{...state.currentSession,day_date:'2026-11-12'}},
  {...state,contextOrder:{...state.contextOrder,id:'other'}},
  {...state,contextOrder:{...state.contextOrder,status:'closed'}},
  {...state,currentSession:null},
  {selectedOrderId:'ord-current',contextOrder:state.contextOrder}
 ])assert.equal(financeLegacyActiveOrder(invalid,'2026-11-13'),null);
});
test('owner-only search results validate source, exact query, cursor and preserve HTML escaping',()=>{
 const payload={entity:'orders',q:'Кухня',items:[{
  id:'another-order',title:'Кухня <img src=x onerror=alert(1)>',
  object_id:'another-object',status:'active'
 }],hasMore:false,nextCursor:null};
 const q=financeLegacySearchResult('orders',payload,'Кухня');
 assert.equal(q.items[0].title,payload.items[0].title);
 const html=financeLegacyFormHtml('INCOME',{refs:{orders:q.items}});
 assert.match(html,/&lt;img/);
 assert.doesNotMatch(html,/<img/);
 for(const wrong of [
  {...payload,entity:'objects'}, {...payload,q:'Other'},
  {...payload,hasMore:true,nextCursor:null},
  {...payload,items:[{id:'foreign',title:'Order'}]},
  {...payload,items:[payload.items[0],payload.items[0]]}
 ])assert.throws(()=>financeLegacySearchResult('orders',wrong,'Кухня'));
 const worker={source:'CLEAN_TEST_NATIVE_WORKER_DIRECTORY',readonly:true,
  financeMappingVerified:false,q:'Иван',items:[{id:'worker-id',name:'Иван',status:'active'}],
  hasMore:true,nextCursor:'abc'};
 assert.equal(financeLegacySearchResult('workers',worker,'Иван').items.length,1);
 assert.throws(()=>financeLegacySearchResult('workers',{...worker,financeMappingVerified:true},'Иван'));
});
test('legacy form exposes full reference search and an explicit current order status for non-owners',()=>{
 const form=financeLegacyFormHtml('WORKER',{today:'2026-11-13',refs});
 assert.match(form,/data-finance-legacy-current-order-status/);
 assert.match(form,/data-finance-legacy-search-kind/);
 assert.match(form,/data-finance-legacy-search-more/);
 assert.match(form,/value="workers"/);
 assert.doesNotMatch(financeLegacyFormHtml('INVEST',{refs}),/data-finance-legacy-search-kind/);
});
test('close prevents pending active-session data from changing a later dialog',async()=>{
 let finish;const deferred=new Promise(resolve=>{finish=resolve;});
 const events={},host={innerHTML:'',
  querySelector(selector){
   if(selector==='[data-finance-legacy-dialog]')return {showModal(){},open:true};
   return null;
  }};
 const root={innerHTML:'',addEventListener(k,cb){events[k]=cb;},
  removeEventListener(k){delete events[k];},
  querySelector(selector){return selector==='[data-finance-legacy-form-host]'?host:null}};
 const panel=mountFinanceCapitalArchivePanel(root,{mode:'finance',refs,
  fetchPage:async()=>data,fetchCurrentContext:()=>deferred});
 await Promise.resolve();await Promise.resolve();
 events.click({target:{closest:k=>k==='[data-finance-legacy-draft]'?{getAttribute:()=> 'INCOME'}:null}});
 events.click({target:{closest:k=>k==='[data-finance-legacy-close]'?{}:null}});
 const after=host.innerHTML;
 finish({currentSession:{order_id:'ord-1',day_date:'2026-11-13',ended_at:null},
  contextOrder:{id:'ord-1',object_id:'obj-1',title:'Order',status:'active'}});
 await Promise.resolve();await Promise.resolve();
 assert.equal(host.innerHTML,after);
 panel.unmount();
});
