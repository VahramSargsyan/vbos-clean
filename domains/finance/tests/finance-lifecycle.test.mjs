import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFinanceLifecycle,FinanceLifecycleError} from '../finance-lifecycle.mjs';
import {financeSummaryFromRows,financeSummaryDelta,financeScopeFromRequest}
 from '../finance-summary-engine.mjs';

const timestampIso='2026-11-09T16:30:00.000Z';
const row=(other={})=>Object.freeze({
 financeTransactionId:'FIN-2026-0100',sourceSystem:'CLEAN_NATIVE_FINANCE',
 status:'active',revision:3,createdAt:'2026-11-02T10:00:00.000Z',
 updatedAt:'2026-11-05T11:00:00.000Z',archivedAt:'',
 operationType:'INCOME',category:'current_work',
 incomeRecognition:'EARNED_AND_RECEIVED',amountBase:20000,
 commissionBase:0,cashEffectBase:20000,profitEffectBase:20000,
 workerPayableEffectBase:0,objectId:'OBJ-2026-0001',
 workOrderId:'WO-2026-0001',clientId:'CL-2026-0001',
 workerId:'',...other
});
const payload=(x={})=>({
 financeTransactionId:'FIN-2026-0100',action:'archive',expectedRevision:3,
 requestKey:'61028380-d30a-4fc1-9c24-bdeb889dcddb',...x
});
const context=(x={})=>({
 sourceVerified:true,capitalLinkChecked:true,linkedCapitalBatch:null,timestampIso,...x
});
const run=(p=payload(),r=row(),c=context())=>normalizeFinanceLifecycle(p,r,c);
const bad=(p,r,c,code)=>assert.throws(()=>run(p,r,c),
 e=>e instanceof FinanceLifecycleError&&e.code===code);

test('archiving an unlinked native financial operation removes its scope contribution',()=>{
 const old=row(),result=run();
 assert.equal(result.after.status,'archived');
 assert.equal(result.after.archivedAt,timestampIso);
 assert.equal(result.after.revision,4);
 assert.equal(result.after.createdAt,old.createdAt);
 assert.equal(result.after.financeTransactionId,old.financeTransactionId);
 assert.equal(result.after.amountBase,old.amountBase);
 assert.equal(result.after.cashEffectBase,old.cashEffectBase);
 assert.equal(old.status,'active');
 assert.deepEqual(result.affectedScopes.map(x=>x.scopeKey),[
  'GLOBAL|ALL','OBJECT|OBJ-2026-0001','WORK_ORDER|WO-2026-0001']);
 const scope=financeScopeFromRequest({});
 const before=financeSummaryFromRows([old],scope);
 const after=financeSummaryDelta(before,scope,result.before,result.after);
 assert.equal(after.cashBalanceBase,'0.000000');
 assert.equal(after.profitBase,'0.000000');
 assert.equal(after.transactionCount,0);
 assert.equal(result.historicalSourcePreserved,true);
 assert.equal(result.writerConnected,false);
 assert.equal(result.planningOnly,true);
});

test('restoring archived native row returns exactly the same cash, profit and order count',()=>{
 const old=row(),archived=run().after;
 const result=run(payload({action:'restore',expectedRevision:4,
  requestKey:'8df1ade5-d321-4eb4-8a66-c42cac33fd3d'}),archived,
  context({timestampIso:'2026-11-10T10:00:00.000Z'}));
 assert.equal(result.after.status,'active');
 assert.equal(result.after.archivedAt,'');
 assert.equal(result.after.revision,5);
 assert.equal(result.after.amountBase,old.amountBase);
 const scope=financeScopeFromRequest({workOrderId:old.workOrderId});
 const prior=financeSummaryFromRows([archived],scope);
 const restored=financeSummaryDelta(prior,scope,result.before,result.after);
 assert.equal(restored.cashBalanceBase,'20000.000000');
 assert.equal(restored.profitBase,'20000.000000');
 assert.equal(restored.transactionCount,1);
 assert.equal(result.after.financeTransactionId,old.financeTransactionId);
});

test('immutable Google history and frozen snapshot records are never eligible',()=>{
 for(const source of ['LEGACY_GOOGLE','VERIFIED_LEGACY_FINANCE_CAPITAL_CLEAN_TEST','GOOGLE',undefined]){
  bad(payload(),row({sourceSystem:source}),context(),'FINANCE_LIFECYCLE_HISTORICAL_IMMUTABLE');
 }
});

test('FINCAP-linked capital blocks both transitions even if amount/date unchanged',()=>{
 const linked={allocationBatchId:'CAB-2026-0042',totalAmountBase:20000,
  transactionDateKey:'2026-11-05'};
 bad(payload(),row({operationType:'OWNER_TRANSFER',ownerDirection:'investments'}),
  context({linkedCapitalBatch:linked}),'FINANCE_LIFECYCLE_LINKED_CAPITAL_BLOCKED');
 const archived=row({status:'archived',archivedAt:'2026-11-06T10:00:00.000Z'});
 bad(payload({action:'restore'}),archived,context({linkedCapitalBatch:linked}),
  'FINANCE_LIFECYCLE_LINKED_CAPITAL_BLOCKED');
});

test('cannot infer missing capital link state or trust unverified canonical source',()=>{
 bad(payload(),row(),context({sourceVerified:false}),'FINANCE_LIFECYCLE_SOURCE_UNVERIFIED');
 bad(payload(),row(),context({capitalLinkChecked:false}),'FINANCE_LIFECYCLE_CAPITAL_LINK_UNCHECKED');
 const absent=context();delete absent.linkedCapitalBatch;
 bad(payload(),row(),absent,'FINANCE_LIFECYCLE_CAPITAL_LINK_UNCHECKED');
 bad(payload(),row(),context({linkedCapitalBatch:undefined}),'FINANCE_LIFECYCLE_CAPITAL_LINK_UNCHECKED');
});

test('rejects stale/duplicate status transitions and inconsistent archive timestamps',()=>{
 bad(payload({expectedRevision:2}),row(),context(),'FINANCE_LIFECYCLE_REVISION_CONFLICT');
 bad(payload(),row({revision:0}),context(),'FINANCE_LIFECYCLE_REVISION_CONFLICT');
 bad(payload({action:'restore'}),row(),context(),'FINANCE_LIFECYCLE_STATUS_CONFLICT');
 bad(payload(),row({status:'archived',archivedAt:timestampIso}),context(),'FINANCE_LIFECYCLE_STATUS_CONFLICT');
 bad(payload(),row({archivedAt:timestampIso}),context(),'FINANCE_LIFECYCLE_ACTIVE_ARCHIVE_MARKER_INVALID');
 bad(payload({action:'restore'}),row({status:'archived',archivedAt:''}),
  context(),'FINANCE_LIFECYCLE_ARCHIVED_AT_INVALID');
});

test('status-only API rejects money mutation, invalid request keys and timestamps',()=>{
 bad(payload({amountOriginal:1}),row(),context(),'FINANCE_LIFECYCLE_FIELDS_FORBIDDEN');
 bad(payload({status:'archived'}),row(),context(),'FINANCE_LIFECYCLE_FIELDS_FORBIDDEN');
 bad(payload({action:'delete'}),row(),context(),'FINANCE_LIFECYCLE_ACTION_INVALID');
 bad(payload({requestKey:'reuse'}),row(),context(),'FINANCE_LIFECYCLE_REQUEST_KEY_INVALID');
 bad(payload(),row(),context({timestampIso:'2026-11-09'}),'FINANCE_LIFECYCLE_TIMESTAMP_INVALID');
 bad(payload({financeTransactionId:'FIN-2026-0007'}),row(),context(),'FINANCE_LIFECYCLE_ID_MISMATCH');
 bad(null,row(),context(),'FINANCE_LIFECYCLE_PAYLOAD_INVALID');
 bad(payload(),null,context(),'FINANCE_LIFECYCLE_EXISTING_REQUIRED');
});

test('corrupt active contribution fails closed before any migration write',()=>{
 const broken=row({cashEffectBase:'bad-money'});
 assert.throws(()=>run(payload(),broken,context()),/FINANCE_SUMMARY_INVALID_MONEY_cashEffectBase/);
});

test('frozen inputs and plan are not mutated and no I/O is made',()=>{
 const old=row(),p=Object.freeze(payload()),ctx=Object.freeze(context());
 const preview=run(p,old,ctx);
 assert.equal(Object.isFrozen(preview),true);
 assert.equal(Object.isFrozen(preview.before),true);
 assert.equal(Object.isFrozen(preview.after),true);
 assert.notEqual(preview.before,old);
 assert.equal(old.revision,3);
 assert.equal(old.archivedAt,'');
 assert.deepEqual(preview.requiredWriterChecks,[
  'OWNER_AUTH_AND_CSRF','CANONICAL_ROW_AND_CAPITAL_LINK_LOCK',
  'REVISION_COMPARE_AND_DURABLE_IDEMPOTENCY',
  'ATOMIC_TRANSACTION_AND_SCOPE_BALANCES','AUDIT_AND_READBACK'
 ]);
});
