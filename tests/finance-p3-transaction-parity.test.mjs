import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {financeP3ValidDetail,financeP3MutationFor,financeP3EditorHtml}
 from '../domains/finance/finance-p3-transaction-editor-view.mjs';
import {readNativeFinanceTransactionDetail,NativeFinanceTransactionDetailError}
 from '../domains/finance/finance-p3-transaction-detail.mjs';
import {financeLegacyNativeCreateAction,financeLegacyFormHtml}
 from '../domains/finance/finance-capital-view.mjs';
import {normalizeFinanceCreate} from '../domains/finance/finance-create-normalize.mjs';
import {financeLegacyActiveOrder} from '../domains/finance/finance-capital-view.mjs';

const id='00000000-0000-4000-8000-000000000071';
const order='00000000-0000-4000-8000-000000000072';
const worker='00000000-0000-4000-8000-000000000073';
const base={id,revision:2,date:'2026-11-23',status:'active',operationType:'INCOME',
 category:'current_work',incomeRecognition:'EARNED_AND_RECEIVED',ownerDirection:'',
 currencyOriginal:'AMD',amountOriginal:'200.00',amountBase:'200.000000',
 fxRate:'1',fxRateDate:'2026-11-23',commissionOriginal:'0',
 counterparty:'',notes:'original',workOrderId:order,objectId:'',clientId:'',
 workerId:'',linkedFinCap:false,editable:true,cancellable:true,restorable:false};
const detail=(record=base)=>({
 version:'FINANCE_P3_NATIVE_DETAIL_V1',source:'CLEAN_NATIVE_FINANCE_ONLY',
 readonly:true,historicalIncluded:false,postingEnabled:true,record
});
const values=(changes={})=>({
 transactionDate:'2026-11-23',amountOriginal:'250.25',currencyOriginal:'AMD',
 commissionOriginal:'0',counterparty:'Проверка',notes:'Примечание',
 category:'current_work',incomeRecognition:'EARNED_AND_RECEIVED',ownerDirection:'home',...changes
});
test('Finance P3 complete edit keeps native ID, revision and current writer action',()=>{
 const x=financeP3MutationFor(detail(),values(),'EDIT','2026-11-23');
 assert.equal(x.action,'FINANCE_EDIT');
 assert.deepEqual([x.payload.financeTransactionId,x.payload.expectedRevision],[id,2]);
 assert.equal(x.payload.patch.amountOriginal,'250.25');
 assert.equal(x.payload.patch.category,'current_work');
 assert.equal(x.payload.patch.transactionDate,'2026-11-23');
 assert.equal(x.payload.patch.workOrderId,undefined,'canonical links inherited, not rewritten');
 assert.equal(x.payload.patch.operationType,undefined,'type remains canonical');
});
test('P3 client money transit categories and EUR FX remain distinct',()=>{
 const income=financeP3MutationFor(detail(),values({
  category:'client_material_funds',incomeRecognition:'RECEIVED_ONLY',
  currencyOriginal:'EUR',amountOriginal:'125.5',fxRate:'425.25',fxRateDate:'2026-11-20'
 }),'EDIT','2026-11-23');
 assert.equal(income.payload.patch.category,'client_material_funds');
 assert.equal(income.payload.patch.incomeRecognition,'RECEIVED_ONLY');
 assert.equal(income.payload.patch.fxRate,'425.25');
 assert.throws(()=>financeP3MutationFor(detail(),values({
  category:'client_material_funds',incomeRecognition:'EARNED_AND_RECEIVED'
 }),'EDIT','2026-11-23'),/CLIENT_MATERIAL_RECOGNITION/);
 const expense=detail({...base,operationType:'EXPENSE',category:'materials',incomeRecognition:''});
 assert.equal(financeP3MutationFor(expense,values({category:'client_material_purchase'}),'EDIT','2026-11-23')
  .payload.patch.category,'client_material_purchase');
 assert.throws(()=>financeP3MutationFor(
  detail({...expense.record,workOrderId:''}),values({category:'client_material_purchase'}),
  'EDIT','2026-11-23'),/ORDER_REQUIRED/);
});
test('P3 allows known workers and non-investment owner operations without new allocation',()=>{
 for(const operationType of ['WORKER_ACCRUAL','WORKER_PAYMENT','WORKER_ACCRUAL_PAYMENT']){
  const d=detail({...base,operationType,workerId:worker,category:'worker'});
  assert.equal(financeP3MutationFor(d,values(),'EDIT','2026-11-23').action,'FINANCE_EDIT');
 }
 const owner=detail({...base,operationType:'OWNER_TRANSFER',ownerDirection:'home',
   workOrderId:'',category:'owner_transfer'});
 assert.equal(financeP3MutationFor(owner,values({ownerDirection:'wife'}),'EDIT','2026-11-23')
   .payload.patch.ownerDirection,'wife');
 assert.throws(()=>financeP3MutationFor(owner,values({ownerDirection:'investments'}),
  'EDIT','2026-11-23'),/OWNER_DIRECTION_INVALID/);
 const capital=detail({...owner.record,ownerDirection:'investments',
  linkedFinCap:true,editable:false,cancellable:false,restorable:false});
 assert.equal(financeP3EditorHtml(capital).includes('Сохранить изменение'),false);
 assert.throws(()=>financeP3MutationFor(capital,values(),'EDIT','2026-11-23'),/EDIT_FORBIDDEN/);
});
test('P3 lifecycle actions keep revision contract, no archive implicit edit',()=>{
 assert.deepEqual(financeP3MutationFor(detail(),{},'CANCEL','2026-11-23'),{
  action:'FINANCE_CANCEL',payload:{financeTransactionId:id,expectedRevision:2}
 });
 assert.throws(()=>financeP3MutationFor(detail(),{},'RESTORE','2026-11-23'),
  /STATUS_CHANGE_FORBIDDEN/);
 const archived=detail({...base,status:'archived',editable:false,cancellable:false,restorable:true});
 assert.equal(financeP3MutationFor(archived,{},'RESTORE','2026-11-23').action,'FINANCE_RESTORE');
 assert.throws(()=>financeP3MutationFor(archived,values(),'EDIT','2026-11-23'),/EDIT_FORBIDDEN/);
});
test('P3 fail closed on spoofed sources, stale dates, commission and XSS',()=>{
 assert.throws(()=>financeP3ValidDetail({...detail(),historicalIncluded:true}),/UNVERIFIED/);
 assert.throws(()=>financeP3ValidDetail(detail({...base,id:'FIN-OLD-001'})),/UNVERIFIED/);
 assert.throws(()=>financeP3ValidDetail(detail({...base,status:'archived'})),/STATUS_FLAGS/);
 for(const bad of [{transactionDate:'2026-09-30'},{transactionDate:'2026-11-31'},
   {amountOriginal:'-100'},{commissionOriginal:'-5'}, {amountOriginal:'0'},
   {currencyOriginal:'GBP'},{currencyOriginal:'USD',fxRate:''}]){
  assert.throws(()=>financeP3MutationFor(detail(),values(bad),'EDIT','2026-11-23'));
 }
 const html=financeP3EditorHtml(detail({...base,notes:'<img src=x onerror=alert(1)>',
  counterparty:'<script>alert(1)</script>'}),{today:'2026-11-23'});
 assert.doesNotMatch(html,/<script>|<img src=x/);
 assert.match(html,/&lt;img/);
});
test('P3 read endpoint refuses non-owner and legacy/invalid source UUID before SQL',async()=>{
 await assert.rejects(readNativeFinanceTransactionDetail(null,id,{authorizeOwner:()=>false}),
  e=>e instanceof NativeFinanceTransactionDetailError&&e.status===401);
 await assert.rejects(readNativeFinanceTransactionDetail(null,'FIN-2026-001',{authorizeOwner:()=>true}),
  e=>e instanceof NativeFinanceTransactionDetailError&&e.status===400);
});
test('P3 B22 create adds both client-material categories with canonical link requirement',()=>{
 const refs={orders:[{id:order,title:'Native',object_id:''}],objects:[],workers:[]};
 const common={transactionDate:'2026-11-23',amountOriginal:'50',currencyOriginal:'AMD',
  commissionOriginal:'0',notes:'',counterparty:'',workOrderId:order,objectId:''};
 const i=financeLegacyNativeCreateAction({...common,legacyAction:'INCOME',
  category:'client_material_funds',incomeRecognition:'RECEIVED_ONLY'},
  {today:'2026-11-23',refs});
 assert.equal(i.payload.category,'client_material_funds');
 const e=financeLegacyNativeCreateAction({...common,legacyAction:'EXPENSE',
  category:'client_material_purchase'}, {today:'2026-11-23',refs});
 assert.equal(e.payload.category,'client_material_purchase');
 assert.throws(()=>financeLegacyNativeCreateAction({...common,workOrderId:'',
  legacyAction:'INCOME',category:'client_material_funds',incomeRecognition:'RECEIVED_ONLY'},
  {today:'2026-11-23',refs}),/нужен заказ/);
 assert.throws(()=>financeLegacyNativeCreateAction({...common,workOrderId:'',
  legacyAction:'EXPENSE',category:'client_material_purchase'},
  {today:'2026-11-23',refs}),/нужен заказ/);
 assert.match(financeLegacyFormHtml('INCOME',{today:'2026-11-23',refs}),/client_material_funds/);
 assert.match(financeLegacyFormHtml('EXPENSE',{today:'2026-11-23',refs}),/client_material_purchase/);
});
test('P3 mounted only as native GET; P1 action remains in paginated history',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const parity=readFileSync(new URL('../domains/finance/finance-native-summary-view.mjs',import.meta.url),'utf8');
 assert.match(server,/pathname==='\/api\/finance\/native-transaction-detail'&&req.method==='GET'/);
 assert.match(server,/authorizeOwner:\(\)=>sessionValid\(req\)/);
 assert.match(app,/onEditTransaction:id=>/);
 assert.match(app,/postAction:payload=>financeNativePostAction\(payload\)/);
 assert.match(parity,/data-finance-p1-open-edit/);
});

test('P3 client-material transit never becomes economic profit in canonical normalizer',()=>{
 const obj='00000000-0000-4000-8000-000000000074';
 const client='00000000-0000-4000-8000-000000000075';
 const refs={
  workOrders:{[order]:{workOrderId:order,objectId:obj,clientId:client}},
  objects:{[obj]:{objectId:obj,clientId:client}},clients:{[client]:{clientId:client}}
 };
 const common={transactionDate:'2026-11-23',workOrderId:order,
  currencyOriginal:'AMD',commissionOriginal:'0'};
 const incoming=normalizeFinanceCreate({...common,operationType:'INCOME',
  category:'client_material_funds',amountOriginal:'50',
  incomeRecognition:'RECEIVED_ONLY'},{todayKey:'2026-11-23',references:refs});
 assert.equal(incoming.cashEffectBase,50);
 assert.equal(incoming.profitEffectBase,0);
 const purchase=normalizeFinanceCreate({...common,operationType:'EXPENSE',
  category:'client_material_purchase',amountOriginal:'30'},
  {todayKey:'2026-11-23',references:refs});
 assert.equal(purchase.cashEffectBase,-30);
 assert.equal(purchase.profitEffectBase,0);
});
test('P3 reuses only verified active work-order prefill, never planned or stale session',()=>{
 const snap={currentSession:{ended_at:null,day_date:'2026-11-23',order_id:order},
  contextOrder:{id:order,object_id:'00000000-0000-4000-8000-000000000074',
   status:'active',title:'Native order'}};
 assert.equal(financeLegacyActiveOrder(snap,'2026-11-23').id,order);
 assert.equal(financeLegacyActiveOrder(snap,'2026-11-24'),null);
 assert.equal(financeLegacyActiveOrder({...snap,currentSession:{
  ...snap.currentSession,ended_at:'2026-11-23T12:00:00Z'}},'2026-11-23'),null);
 assert.equal(financeLegacyActiveOrder({...snap,contextOrder:{
  ...snap.contextOrder,status:'planned'}},'2026-11-23'),null);
});
