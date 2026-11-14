/**
 * FINANCE-B4-01 — FINCAP-linked FinanceTransaction update guard (pure preview).
 *
 * FinanceService.js parity: financeInvestmentCapitalRequestId_,
 * financeLinkedCapitalBatch_, financeAssertLinkedInvestmentUpdateSafe_,
 * saveFinanceTransactionService_ (existing edit never auto-allocates Capital).
 *
 * Never use this as a money writer. Callers must lock/read the canonical
 * FinanceTransaction and all FINCAP-linked CapitalAllocationBatches inside
 * ONE future PostgreSQL transaction and prove uniqueness, source authority,
 * owner permission, revision and idempotency before committing balances.
 *
 * Historical LEGACY_GOOGLE Finance/Capital sources are immutable.
 */
import {normalizeFinanceUpdate} from './finance-update-normalize.mjs';

export class FinanceInvestmentGuardError extends Error {
 constructor(code){super(code);this.name='FinanceInvestmentGuardError';this.code=code;}
}
const fail=code=>{throw new FinanceInvestmentGuardError(code);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY=/^\d{4}-\d\d-\d\d$/;
const day=v=>typeof v==='string'&&DAY.test(v)&&
 !Number.isNaN(Date.parse(v+'T00:00:00.000Z'))&&
 new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)===v;
const cents=(value,label)=>{
 const text=String(value??'');
 if(!/^(0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(text))
  fail('FINCAP_MONEY_INVALID_'+label);
 const [whole,frac='']=text.split('.');
 return BigInt(whole)*100n+BigInt(frac.padEnd(2,'0'));
};
export function financeInvestmentRequestId(financeTransactionId){
 if(typeof financeTransactionId!=='string'||!ID.test(financeTransactionId)||
    financeTransactionId.length>100)fail('FINCAP_FINANCE_ID_INVALID');
 return 'FINCAP|'+financeTransactionId;
}
function validateLinkedBatch(batch,expectedKey){
 if(!object(batch)||
    typeof batch.allocationBatchId!=='string'||!ID.test(batch.allocationBatchId)||
    batch.clientRequestId!==expectedKey||
    batch.status!=='applied'||batch.sourceType!=='OPERATING_PROFIT'||
    !day(batch.transactionDateKey))
   fail('FINCAP_LINKED_BATCH_INVALID');
 cents(batch.totalAmountBase,'batchAmount');
}
function verifyLinkedSide(row,batch,isBefore){
 const prefix=isBefore?'FINCAP_LINKED_SOURCE_DRIFT':'FINCAP_LINKED_CHANGE_FORBIDDEN';
 if(row.status!=='active'||row.operationType!=='OWNER_TRANSFER'||
    row.ownerDirection!=='investments'||!day(row.transactionDateKey))
  fail(prefix);
 if(cents(row.amountBase,isBefore?'beforeAmount':'afterAmount')!==
    cents(batch.totalAmountBase,'batchAmount')||
    row.transactionDateKey!==batch.transactionDateKey)fail(prefix);
}
/**
 * Context is injected server-side. sourceVerified/capitalLinkChecked are NOT
 * proof of authority: only the future locked DB read can establish them.
 * Caller must verify exact match count 0 or 1, never take a browser-supplied
 * linkedCapitalBatch. New allocations are a distinct atomic create workflow.
 */
export function normalizeFinanceInvestmentUpdate(payload,existing,context={}){
 if(!object(payload))fail('FINCAP_PAYLOAD_INVALID');
 if(!object(existing))fail('FINCAP_EXISTING_REQUIRED');
 if(existing.sourceSystem!=='CLEAN_NATIVE_FINANCE')
  fail('FINCAP_HISTORICAL_SOURCE_IMMUTABLE');
 const id=existing.financeTransactionId,key=financeInvestmentRequestId(id);
 if(payload.financeTransactionId!==id)fail('FINCAP_FINANCE_ID_MISMATCH');
 if(payload.linkedCapitalBatch!==undefined||payload.capitalAllocation!==undefined||
    payload.sourceSystem!==undefined)fail('FINCAP_INJECTED_LINK_FIELD');
 if(context.sourceVerified!==true)fail('FINCAP_SOURCE_NOT_VERIFIED');
 if(context.capitalLinkChecked!==true||
    !Object.prototype.hasOwnProperty.call(context,'linkedCapitalBatch')||
    context.linkedCapitalBatch===undefined)fail('FINCAP_CANONICAL_LINK_NOT_CHECKED');
 const batch=context.linkedCapitalBatch;
 if(!Number.isSafeInteger(context.capitalLinkCount)||context.capitalLinkCount!==(batch===null?0:1))
  fail('FINCAP_LINK_COUNT_INVALID');
 if(!Number.isSafeInteger(existing.revision)||existing.revision<1||
    !Number.isSafeInteger(payload.expectedRevision)||
    payload.expectedRevision!==existing.revision)fail('FINCAP_STALE_REVISION');
 if(!UUID.test(payload.requestKey??''))fail('FINCAP_IDEMPOTENCY_KEY_INVALID');
 if(batch!==null){
  validateLinkedBatch(batch,key);
  // Do not allow an already-divergent source to be "repaired" by a casual edit.
  verifyLinkedSide(existing,batch,true);
 }
 // This is the existing pure arithmetic normalizer, NOT a persistence route.
 const preview=normalizeFinanceUpdate(payload,existing,context);
 if(batch!==null)verifyLinkedSide(preview.after,batch,false);
 const linked=batch!==null;
 return Object.freeze({
  ...preview,
  investmentRequestId:key,
  investmentLinkMode:linked?'EXISTING_FINCAP_LINK_PRESERVED':
   (existing.operationType==='OWNER_TRANSFER'&&existing.ownerDirection==='investments'||
    preview.after.operationType==='OWNER_TRANSFER'&&preview.after.ownerDirection==='investments'
     ?'EXISTING_UNLINKED_INVESTMENT_NO_AUTO_ALLOCATION':'NO_FINCAP_LINK'),
  linkedAllocationBatchId:linked?batch.allocationBatchId:null,
  capitalAllocationAction:'NONE_ON_EXISTING_EDIT',
  historicalSourcePreserved:true,sourceSystem:'CLEAN_NATIVE_FINANCE',
  planningOnly:true,writerConnected:false,
  requiredWriterChecks:Object.freeze([
   'OWNER_AUTH_AND_CSRF','CANONICAL_SOURCE_AND_FINCAP_UNIQUE_LOOKUP_UNDER_LOCK',
   'SOURCE_REVISION_AND_DURABLE_REQUEST_DEDUP',
   'ATOMIC_FINANCE_AND_SCOPED_BALANCES_WITH_AUDIT','COMMIT_READBACK'
  ])
 });
}
