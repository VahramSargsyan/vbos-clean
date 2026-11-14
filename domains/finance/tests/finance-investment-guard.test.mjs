import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFinanceCreate} from '../finance-create-normalize.mjs';
import {financeSummaryDelta,financeSummaryFromRows,financeScopeFromRequest}
 from '../finance-summary-engine.mjs';
import {financeInvestmentRequestId,normalizeFinanceInvestmentUpdate,
 FinanceInvestmentGuardError} from '../finance-investment-guard.mjs';
import {normalizeFinanceLifecycle} from '../finance-lifecycle.mjs';

const id='FIN-2026-0100';
const key='FINCAP|'+id;
const rkey='61028380-d30a-4fc1-9c24-bdeb889dcddb';
const todayKey='2026-11-09';
const row=(overrides={})=>Object.freeze({
 ...normalizeFinanceCreate({
  operationType:'OWNER_TRANSFER',ownerDirection:'investments',
  amountOriginal:'100',transactionDate:'2026-11-01'
 },{todayKey,references:{}}),
 financeTransactionId:id,sourceSystem:'CLEAN_NATIVE_FINANCE',
 revision:7,createdAt:'2026-11-01T10:00:00.000Z',
 updatedAt:'2026-11-01T10:00:00.000Z',...overrides
});
const batch=(changes={})=>Object.freeze({
 allocationBatchId:'CAB-2026-0002',clientRequestId:key,
 status:'applied',sourceType:'OPERATING_PROFIT',
 transactionDateKey:'2026-11-01',totalAmountBase:100,...changes
});
const payload=(changes={})=>Object.freeze({
 financeTransactionId:id,expectedRevision:7,requestKey:rkey,...changes
});
const ctx=(changes={})=>Object.freeze({
 todayKey, references:{},sourceVerified:true,
 capitalLinkChecked:true,capitalLinkCount:1,linkedCapitalBatch:batch(),
 ...changes
});
const run=(p=payload(),r=row(),c=ctx())=>normalizeFinanceInvestmentUpdate(p,r,c);
const bad=(p,r,c,code)=>assert.throws(()=>run(p,r,c),
 e=>e instanceof FinanceInvestmentGuardError&&e.code===code);

test('deterministic FINCAP key mirrors original FinanceService.js',()=>{
 assert.equal(financeInvestmentRequestId(id),key);
 assert.equal(financeInvestmentRequestId(id),financeInvestmentRequestId(id));
 assert.throws(()=>financeInvestmentRequestId(''),/FINCAP_FINANCE_ID_INVALID/);
 assert.throws(()=>financeInvestmentRequestId('INVALID|NAME'),/FINCAP_FINANCE_ID_INVALID/);
});

test('exact linked investment metadata/notes edit preserves allocation identity',()=>{
 const p=run(payload({notes:'Сверено',counterparty:'Bank'}));
 assert.equal(p.before.amountBase,100);
 assert.equal(p.after.amountBase,100);
 assert.equal(p.after.ownerDirection,'investments');
 assert.equal(p.after.transactionDateKey,'2026-11-01');
 assert.equal(p.after.notes,'Сверено');
 assert.equal(p.investmentRequestId,key);
 assert.equal(p.linkedAllocationBatchId,'CAB-2026-0002');
 assert.equal(p.investmentLinkMode,'EXISTING_FINCAP_LINK_PRESERVED');
 assert.equal(p.capitalAllocationAction,'NONE_ON_EXISTING_EDIT');
 assert.equal(p.writerConnected,false);
 assert.equal(p.planningOnly,true);
 assert.equal(p.historicalSourcePreserved,true);
 assert.equal(Object.isFrozen(p),true);
 assert.equal(Object.isFrozen(p.after),true);
 assert.equal(row().notes,'');
});

test('linked record forbids amount, date, direction and operation-type mutation',()=>{
 // Even 0.01 AMD drift is forbidden. Legacy tolerated <= 0.01 but exact
 // cents protects native accounting, since the linked allocation is unchanged.
 bad(payload({amountOriginal:'100.01'}),row(),ctx(),'FINCAP_LINKED_CHANGE_FORBIDDEN');
 bad(payload({transactionDate:'2026-11-02'}),row(),ctx(),'FINCAP_LINKED_CHANGE_FORBIDDEN');
 bad(payload({ownerDirection:'home'}),row(),ctx(),'FINCAP_LINKED_CHANGE_FORBIDDEN');
 bad(payload({operationType:'EXPENSE',category:'transport'}),row(),ctx(),
  'FINCAP_LINKED_CHANGE_FORBIDDEN');
});

test('linked record already divergent cannot be silently fixed by a normal edit',()=>{
 bad(payload(),row({amountBase:101}),ctx(),'FINCAP_LINKED_SOURCE_DRIFT');
 bad(payload(),row({transactionDateKey:'2026-11-02'}),ctx(),
  'FINCAP_LINKED_SOURCE_DRIFT');
 bad(payload(),row({ownerDirection:'home'}),ctx(),'FINCAP_LINKED_SOURCE_DRIFT');
 bad(payload(),row({status:'archived'}),ctx(),'FINCAP_LINKED_SOURCE_DRIFT');
});

test('missing, ambiguous, wrong or unapplied Capital batches fail closed',()=>{
 bad(payload(),row(),ctx({capitalLinkChecked:false}),'FINCAP_CANONICAL_LINK_NOT_CHECKED');
 const missing={...ctx()};delete missing.linkedCapitalBatch;
 bad(payload(),row(),missing,'FINCAP_CANONICAL_LINK_NOT_CHECKED');
 bad(payload(),row(),ctx({capitalLinkCount:2}),'FINCAP_LINK_COUNT_INVALID');
 bad(payload(),row(),ctx({linkedCapitalBatch:null}),'FINCAP_LINK_COUNT_INVALID');
 bad(payload(),row(),ctx({linkedCapitalBatch:batch({clientRequestId:'FINCAP|FIN-2026-9999'})}),
  'FINCAP_LINKED_BATCH_INVALID');
 bad(payload(),row(),ctx({linkedCapitalBatch:batch({status:'pending'})}),
  'FINCAP_LINKED_BATCH_INVALID');
 bad(payload(),row(),ctx({linkedCapitalBatch:batch({sourceType:'OTHER'})}),
  'FINCAP_LINKED_BATCH_INVALID');
 bad(payload(),row(),ctx({linkedCapitalBatch:batch({allocationBatchId:'bad|id'})}),
  'FINCAP_LINKED_BATCH_INVALID');
 bad(payload(),row(),ctx({linkedCapitalBatch:batch({transactionDateKey:'2026-02-31'})}),
  'FINCAP_LINKED_BATCH_INVALID');
 bad(payload(),row(),ctx({linkedCapitalBatch:batch({totalAmountBase:'100.001'})}),
  'FINCAP_MONEY_INVALID_batchAmount');
});

test('historical Google ledger cannot be mutated regardless of supplied link',()=>{
 for(const source of ['LEGACY_GOOGLE','VERIFIED_LEGACY_FINANCE_CAPITAL_CLEAN_TEST','GOOGLE',undefined])
  bad(payload(),row({sourceSystem:source}),ctx(),'FINCAP_HISTORICAL_SOURCE_IMMUTABLE');
});

test('revision, request key and caller-supplied link fields are rejected',()=>{
 bad(payload({expectedRevision:6}),row(),ctx(),'FINCAP_STALE_REVISION');
 bad(payload(),row({revision:0}),ctx(),'FINCAP_STALE_REVISION');
 bad(payload({requestKey:'duplicate'}),row(),ctx(),'FINCAP_IDEMPOTENCY_KEY_INVALID');
 bad(payload({capitalAllocation:{bad:true}}),row(),ctx(),'FINCAP_INJECTED_LINK_FIELD');
 bad(payload({linkedCapitalBatch:batch()}),row(),ctx(),'FINCAP_INJECTED_LINK_FIELD');
 bad(payload({sourceSystem:'CLEAN_NATIVE_FINANCE'}),row(),ctx(),'FINCAP_INJECTED_LINK_FIELD');
 bad(payload(),row(),ctx({sourceVerified:false}),'FINCAP_SOURCE_NOT_VERIFIED');
 bad(payload({financeTransactionId:'FIN-2026-0004'}),row(),ctx(),'FINCAP_FINANCE_ID_MISMATCH');
 bad(null,row(),ctx(),'FINCAP_PAYLOAD_INVALID');
 bad(payload(),null,ctx(),'FINCAP_EXISTING_REQUIRED');
});

test('unlinked edit never creates a new allocation, even if moving into investments',()=>{
 const old=row({ownerDirection:'home'});
 const p=run(payload({ownerDirection:'investments',amountOriginal:150}),
  old,ctx({capitalLinkCount:0,linkedCapitalBatch:null}));
 assert.equal(p.linkedAllocationBatchId,null);
 assert.equal(p.investmentLinkMode,'EXISTING_UNLINKED_INVESTMENT_NO_AUTO_ALLOCATION');
 assert.equal(p.capitalAllocationAction,'NONE_ON_EXISTING_EDIT');
 assert.equal(p.after.amountBase,150);
 assert.equal(p.after.ownerDirection,'investments');
 assert.equal('capitalAllocation' in p,false);
 const same=run(payload(),row(),ctx({capitalLinkCount:0,linkedCapitalBatch:null}));
 assert.equal(same.investmentLinkMode,'EXISTING_UNLINKED_INVESTMENT_NO_AUTO_ALLOCATION');
});

test('linked amount-preserving commission update changes Finance only, not Capital allocation',()=>{
 const p=run(payload({commissionOriginal:'1.50'}));
 assert.equal(p.after.amountBase,100);
 assert.equal(p.after.commissionBase,1.5);
 assert.equal(p.after.cashEffectBase,-101.5);
 const scope=financeScopeFromRequest({});
 const balance=financeSummaryDelta(financeSummaryFromRows([p.before]),scope,p.before,p.after);
 assert.equal(balance.cashBalanceBase,'-101.500000');
 assert.equal(balance.profitBase,'-1.500000');
 assert.equal(p.capitalAllocationAction,'NONE_ON_EXISTING_EDIT');
});

test('archive path keeps separate B3 block for linked funds and prevents bypass',()=>{
 const old=row();
 assert.throws(()=>normalizeFinanceLifecycle({
  financeTransactionId:id,action:'archive',expectedRevision:7,requestKey:rkey
 },old,{
  sourceVerified:true,capitalLinkChecked:true,linkedCapitalBatch:batch(),
  timestampIso:'2026-11-09T16:30:00.000Z'
 }),/FINANCE_LIFECYCLE_LINKED_CAPITAL_BLOCKED/);
});

test('caller immutable inputs, preview output and no datastore side effects',()=>{
 const r=row(),p=payload({notes:'New'}),c=ctx();
 const plan=run(p,r,c);
 assert.equal(r.notes,'');
 assert.equal(p.notes,'New');
 assert.equal(c.linkedCapitalBatch.totalAmountBase,100);
 assert.equal(plan.before.financeTransactionId,id);
 assert.equal(plan.after.financeTransactionId,id);
 assert.ok(plan.requiredWriterChecks.includes('CANONICAL_SOURCE_AND_FINCAP_UNIQUE_LOOKUP_UNDER_LOCK'));
});
