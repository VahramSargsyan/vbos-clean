import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFinanceCreate} from '../finance-create-normalize.mjs';
import {normalizeFinanceUpdate,FinanceUpdateNormalizeError} from '../finance-update-normalize.mjs';
import {financeSummaryFromRows,financeSummaryDelta,financeScopeFromRequest}
 from '../finance-summary-engine.mjs';

const refs={
 clients:{'CLI-2026-0001':{clientId:'CLI-2026-0001'},'CLI-2026-0002':{clientId:'CLI-2026-0002'}},
 objects:{'OBJ-2026-0001':{objectId:'OBJ-2026-0001',clientId:'CLI-2026-0001'},
  'OBJ-2026-0002':{objectId:'OBJ-2026-0002',clientId:'CLI-2026-0002'}},
 workOrders:{'WO-2026-0001':{workOrderId:'WO-2026-0001',objectId:'OBJ-2026-0001',clientId:'CLI-2026-0001'},
  'WO-2026-0002':{workOrderId:'WO-2026-0002',objectId:'OBJ-2026-0002',clientId:'CLI-2026-0002'}},
 workers:{'WRK-2026-0001':{workerId:'WRK-2026-0001',status:'active'},
  'WRK-2026-0002':{workerId:'WRK-2026-0002',status:'active'}}
};
const ctx={todayKey:'2026-11-09',references:refs};
const create=(payload={})=>Object.freeze({
 financeTransactionId:'FIN-2026-0001',createdAt:'2026-11-01T10:00:00Z',
 ...normalizeFinanceCreate({category:'bonus',amountOriginal:100,...payload},ctx)
});
const edit=(old,patch={})=>normalizeFinanceUpdate({financeTransactionId:old.financeTransactionId,...patch},old,ctx);
const bad=(old,patch,code)=>assert.throws(()=>edit(old,patch),e=>e instanceof FinanceUpdateNormalizeError&&e.code===code);
const scope=p=>financeScopeFromRequest(p);
const metric=(row,field)=>financeSummaryFromRows([row])[field];

test('partial edit preserves immutable id, creation time, omitted fields and original legacy relation',()=>{
 const old=create({workOrderId:'WO-2026-0001',category:'advance',amountOriginal:100});
 const result=edit(old,{amountOriginal:120});
 assert.equal(result.financeTransactionId,old.financeTransactionId);
 assert.equal(result.after.createdAt,old.createdAt);
 assert.equal(result.after.workOrderId,'WO-2026-0001');
 assert.equal(result.after.objectId,'OBJ-2026-0001');
 assert.equal(result.after.clientId,'CLI-2026-0001');
 assert.equal(result.after.transactionDate,old.transactionDate);
 assert.equal(result.before.amountBase,100);
 assert.equal(result.after.amountBase,120);
 assert.equal(result.after.incomeRecognition,'RECEIVED_ONLY');
 assert.equal(result.after.profitEffectBase,0);
 assert.equal(result.affectedScopes.length,3);
 assert.equal(old.amountBase,100);
});

test('Global summary delta subtracts prior contribution and adds replacement, not double counting',()=>{
 const old=create({category:'bonus',amountOriginal:100,commissionOriginal:5});
 const result=edit(old,{amountOriginal:180,commissionOriginal:10});
 const prior=financeSummaryFromRows([old]);
 const after=financeSummaryDelta(prior,scope({}),result.before,result.after);
 assert.equal(after.profitBase,'170.000000');
 assert.equal(after.cashBalanceBase,'170.000000');
 assert.equal(after.transactionCount,1);
 assert.equal(result.before.profitEffectBase,95);
 assert.equal(result.after.profitEffectBase,170);
});

test('changing WorkOrder with stale inherited Object/Client fails, explicit clear moves all scopes',()=>{
 const old=create({category:'advance',workOrderId:'WO-2026-0001'});
 assert.throws(()=>edit(old,{workOrderId:'WO-2026-0002'}),/FINANCE_CREATE_ORDER_OBJECT_MISMATCH/);
 const result=edit(old,{workOrderId:'WO-2026-0002',objectId:'',clientId:'',
  clearObjectRelation:true,clearClientRelation:true});
 assert.equal(result.after.workOrderId,'WO-2026-0002');
 assert.equal(result.after.objectId,'OBJ-2026-0002');
 assert.equal(result.after.clientId,'CLI-2026-0002');
 assert.deepEqual(result.affectedScopes.map(s=>s.scopeKey),[
  'GLOBAL|ALL','OBJECT|OBJ-2026-0001','WORK_ORDER|WO-2026-0001',
  'OBJECT|OBJ-2026-0002','WORK_ORDER|WO-2026-0002']);
 const oldOrder=scope({workOrderId:'WO-2026-0001'});
 const newOrder=scope({workOrderId:'WO-2026-0002'});
 assert.equal(financeSummaryDelta(financeSummaryFromRows([old],oldOrder),oldOrder,result.before,result.after).transactionCount,0);
 assert.equal(financeSummaryDelta(financeSummaryFromRows([],newOrder),newOrder,result.before,result.after).transactionCount,1);
});

test('old relation is retained if blank without clear flag; clear with flag is honored',()=>{
 const old=create({operationType:'WORKER_PAYMENT',workerId:'WRK-2026-0001'});
 assert.equal(edit(old,{workerId:''}).after.workerId,'WRK-2026-0001');
 assert.throws(()=>edit(old,{workerId:'',clearWorkerRelation:true}),/FINANCE_CREATE_WORKER_REQUIRED/);
 const moved=edit(old,{workerId:'WRK-2026-0002'});
 assert.deepEqual(moved.affectedScopes.map(s=>s.scopeKey),[
  'GLOBAL|ALL','WORKER|WRK-2026-0001','WORKER|WRK-2026-0002']);
 assert.equal(moved.after.workerPayableEffectBase,-100);
});

test('client-funded materials stay cash-positive and profit-neutral after edit',()=>{
 const old=create({category:'client_material_funds',amountOriginal:300000,workOrderId:'WO-2026-0001'});
 const next=edit(old,{amountOriginal:320000,incomeRecognition:'EARNED_ONLY'}).after;
 assert.equal(next.incomeRecognition,'RECEIVED_ONLY');
 assert.equal(metric(next,'profitBase'),'0.000000');
 assert.equal(metric(next,'cashBalanceBase'),'320000.000000');
 const purchase=create({operationType:'EXPENSE',category:'client_material_purchase',
  workOrderId:'WO-2026-0001',amountOriginal:295000,commissionOriginal:10});
 const changed=edit(purchase,{amountOriginal:310000}).after;
 assert.equal(changed.profitEffectBase,-10);
 assert.equal(changed.cashEffectBase,-310010);
});

test('edit recalculates USD foreign exchange, commission and date accurately',()=>{
 const old=create({currencyOriginal:'USD',fxRate:400,amountOriginal:'10.25',
  commissionOriginal:'0.25',transactionDate:'2026-11-01'});
 const next=edit(old,{fxRate:410,fxRateDate:'2026-11-08'}).after;
 assert.equal(next.amountBase,4202.5);
 assert.equal(next.commissionBase,102.5);
 assert.equal(next.profitEffectBase,4100);
 assert.equal(next.fxRateDate,'2026-11-08');
 assert.equal(next.transactionDate,'2026-11-01');
});

test('operation type switch normalizes stale worker relation and preserves exact profit semantics',()=>{
 const old=create({operationType:'WORKER_ACCRUAL',workOrderId:'WO-2026-0001',
  workerId:'WRK-2026-0001',amountOriginal:200});
 const result=edit(old,{operationType:'EXPENSE',category:'transport',commissionOriginal:5});
 assert.equal(result.after.workerId,'');
 assert.equal(result.after.profitEffectBase,-205);
 assert.equal(result.after.workerPayableEffectBase,0);
 assert.equal(result.after.cashEffectBase,-205);
 assert.equal(result.before.workerPayableEffectBase,200);
});

test('OWNER_TRANSFER edit clears relations, but never creates or assumes Capital batch',()=>{
 const old=create({operationType:'OWNER_TRANSFER',ownerDirection:'other',amountOriginal:100});
 const after=edit(old,{ownerDirection:'investments',amountOriginal:180}).after;
 assert.equal(after.ownerDirection,'investments');
 assert.equal(after.profitEffectBase,0);
 assert.equal(after.cashEffectBase,-180);
 assert.equal('capitalAllocation' in after,false);
});

test('reject nonexistent, mismatched, archived and status-changing records',()=>{
 const old=create();
 bad(old,{financeTransactionId:'FIN-2026-9999'},'FINANCE_UPDATE_ID_MISMATCH');
 bad({...old,status:'archived'}, {},'FINANCE_UPDATE_ARCHIVED_NOT_EDITABLE');
 bad(old,{status:'archived'},'FINANCE_UPDATE_STATUS_TRANSITION_OUT_OF_SCOPE');
 bad(old,{status:'cancelled'},'FINANCE_UPDATE_STATUS_TRANSITION_OUT_OF_SCOPE');
 assert.throws(()=>normalizeFinanceUpdate({},old,ctx),/FINANCE_UPDATE_ID_MISMATCH/);
 assert.throws(()=>normalizeFinanceUpdate(null,old,ctx),/FINANCE_UPDATE_PAYLOAD_INVALID/);
 assert.throws(()=>normalizeFinanceUpdate({financeTransactionId:old.financeTransactionId},null,ctx),/FINANCE_UPDATE_EXISTING_REQUIRED/);
});

test('normalizer and delta do not change caller objects and never perform DB I/O',()=>{
 const old=create({category:'bonus',amountOriginal:100});
 const patch=Object.freeze({financeTransactionId:old.financeTransactionId,amountOriginal:200});
 const result=normalizeFinanceUpdate(patch,old,ctx);
 assert.equal(old.amountOriginal,100);
 assert.equal(patch.amountOriginal,200);
 assert.equal(Object.isFrozen(result),true);
 assert.equal(Object.isFrozen(result.after),true);
 assert.equal(result.after.amountOriginal,200);
 assert.equal('updatedAt' in result.after,false);
});
