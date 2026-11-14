/**
 * FINANCE-BATCH3-01 — pure FinanceTransaction archive/restore preview.
 *
 * Legacy parity:
 * - FinanceService.archiveFinanceTransactionService_ changes status to archived;
 * - FinanceService.financeContribution_ counts active rows only;
 * - legacy update(status='active') restores an archived row and clears archivedAt;
 * - FINCAP-linked investments cannot be archived separately from Capital.
 *
 * This is a migration-preparation helper, NOT a money writer, HTTP route or
 * permission to edit the immutable LEGACY_GOOGLE financial snapshot. Future
 * PostgreSQL writer must load/lock current row + FINCAP relation, authorize
 * owner, enforce revision/idempotency, and atomically persist ledger + balances.
 */
import {financeAffectedScopes,financeSummaryFromRows} from './finance-summary-engine.mjs';

export class FinanceLifecycleError extends Error {
 constructor(code){super(code);this.name='FinanceLifecycleError';this.code=code;}
}
const fail=code=>{throw new FinanceLifecycleError(code);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const idOk=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(x);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const isoOk=s=>typeof s==='string'&&ISO.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString()===s;
const allowed=new Set(['financeTransactionId','action','expectedRevision','requestKey']);
/**
 * All payload fields are explicit; no implicit money edits or status changes.
 * The caller's sourceVerified/capitalLinkChecked flags are NOT authorization:
 * a future writer must establish them from canonical, locked DB facts.
 */
export function normalizeFinanceLifecycle(payload,existing,context={}){
 if(!object(payload))fail('FINANCE_LIFECYCLE_PAYLOAD_INVALID');
 if(Object.keys(payload).some(k=>!allowed.has(k)))fail('FINANCE_LIFECYCLE_FIELDS_FORBIDDEN');
 if(!object(existing))fail('FINANCE_LIFECYCLE_EXISTING_REQUIRED');
 const id=existing.financeTransactionId;
 if(!idOk(id)||payload.financeTransactionId!==id)fail('FINANCE_LIFECYCLE_ID_MISMATCH');
 if(existing.sourceSystem!=='CLEAN_NATIVE_FINANCE')fail('FINANCE_LIFECYCLE_HISTORICAL_IMMUTABLE');
 if(context.sourceVerified!==true)fail('FINANCE_LIFECYCLE_SOURCE_UNVERIFIED');
 if(context.capitalLinkChecked!==true||
    !Object.prototype.hasOwnProperty.call(context,'linkedCapitalBatch')||
    context.linkedCapitalBatch===undefined)
   fail('FINANCE_LIFECYCLE_CAPITAL_LINK_UNCHECKED');
 // Any linked batch must be handled by an independently authorized, atomic
 // Finance+Capital transaction; never invalidate an allocation in this helper.
 if(context.linkedCapitalBatch!==null)fail('FINANCE_LIFECYCLE_LINKED_CAPITAL_BLOCKED');
 if(!['archive','restore'].includes(payload.action))fail('FINANCE_LIFECYCLE_ACTION_INVALID');
 if(!Number.isSafeInteger(existing.revision)||existing.revision<1||
    !Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision!==existing.revision)
   fail('FINANCE_LIFECYCLE_REVISION_CONFLICT');
 if(!UUID.test(payload.requestKey??''))fail('FINANCE_LIFECYCLE_REQUEST_KEY_INVALID');
 if(!isoOk(context.timestampIso))fail('FINANCE_LIFECYCLE_TIMESTAMP_INVALID');
 const expected=payload.action==='archive'?'active':'archived';
 if(existing.status!==expected)fail('FINANCE_LIFECYCLE_STATUS_CONFLICT');
 if(existing.status==='active'&&existing.archivedAt!=='')
   fail('FINANCE_LIFECYCLE_ACTIVE_ARCHIVE_MARKER_INVALID');
 if(existing.status==='archived'&&!isoOk(existing.archivedAt))
   fail('FINANCE_LIFECYCLE_ARCHIVED_AT_INVALID');
 // Validate the numeric contribution even when the stored row is archived;
 // financeSummaryFromRows skips archived contributions by design.
 financeSummaryFromRows([{...existing,status:'active'}]);
 const before=Object.freeze({...existing});
 const after=Object.freeze({...existing,
  status:payload.action==='archive'?'archived':'active',
  archivedAt:payload.action==='archive'?context.timestampIso:'',
  updatedAt:context.timestampIso,revision:existing.revision+1});
 financeSummaryFromRows([after.status==='active'?after:{...after,status:'active'}]);
 return Object.freeze({
  financeTransactionId:id,action:payload.action,requestKey:payload.requestKey,
  expectedRevision:payload.expectedRevision,nextRevision:after.revision,
  before,after,affectedScopes:financeAffectedScopes(before,after),
  sourceSystem:'CLEAN_NATIVE_FINANCE',
  historicalSourcePreserved:true,
  planningOnly:true,writerConnected:false,
  requiredWriterChecks:Object.freeze([
   'OWNER_AUTH_AND_CSRF','CANONICAL_ROW_AND_CAPITAL_LINK_LOCK',
   'REVISION_COMPARE_AND_DURABLE_IDEMPOTENCY',
   'ATOMIC_TRANSACTION_AND_SCOPE_BALANCES','AUDIT_AND_READBACK'
  ])
 });
}
