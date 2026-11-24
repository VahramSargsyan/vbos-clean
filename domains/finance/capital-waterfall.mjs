/** Finance B5/P5: verified new investment preparation; pure planner shared with UI. */
import {financeInvestmentRequestId} from './finance-investment-guard.mjs';
import {CapitalWaterfallError,planCapitalWaterfall,planManualCapitalAllocation} from './capital-waterfall-plan.mjs';
export {CapitalWaterfallError,planCapitalWaterfall,planManualCapitalAllocation};
const fail=code=>{throw new CapitalWaterfallError(code);};
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
 !Number.isNaN(Date.parse(v+'T00:00:00.000Z'))&&
 new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)===v;
/**
 * The ONLY FinCap creation intent this preview can prepare is an already
 * verified, newly-posted native investment, inside the future ONE DB
 * transaction. Editing an existing unlinked investment must not call this.
 * Duplicate/ambiguous FINCAP keys require a separate recovery workflow.
 */
export function prepareNewFinanceInvestmentAllocation(financeRecord,funds,balances,context={}){
 if(!obj(financeRecord))fail('CAPITAL_B5_FINANCE_RECORD_REQUIRED');
 if(financeRecord.sourceSystem!=='CLEAN_NATIVE_FINANCE')
  fail('CAPITAL_B5_LEGACY_FINANCE_IMMUTABLE');
 if(context.newFinancePostVerified!==true||context.sourceSnapshotVerified!==true||
    context.finCapLookupVerified!==true)
  fail('CAPITAL_B5_AUTHORITATIVE_CREATION_PROOF_REQUIRED');
 if(context.existingFinCapBatchCount!==0)
  fail('CAPITAL_B5_FINCAP_BATCH_EXISTS_OR_UNKNOWN');
 if(financeRecord.operationType!=='OWNER_TRANSFER'||
    financeRecord.ownerDirection!=='investments'||financeRecord.status!=='active'||
    !date(financeRecord.transactionDateKey)||financeRecord.transactionDate!==financeRecord.transactionDateKey)
  fail('CAPITAL_B5_NOT_NEW_ACTIVE_INVESTMENT');
 const requestId=financeInvestmentRequestId(financeRecord.financeTransactionId);
 const plan=Object.hasOwn(context,'manualAllocations')?
  planManualCapitalAllocation(financeRecord.amountBase,funds,balances,context.manualAllocations,{sourceSnapshotVerified:true}):
  planCapitalWaterfall(financeRecord.amountBase,funds,balances,{sourceSnapshotVerified:true});
 return Object.freeze({
  ...plan,source:'NEW_FINCAP_ALLOCATION_PREPARATION',sourceType:'OPERATING_PROFIT',
  transactionDateKey:financeRecord.transactionDateKey,
  sourcePeriodKey:financeRecord.transactionDateKey.slice(0,7),
  clientRequestId:requestId,
  movementRequestKeys:Object.freeze(plan.allocations.map(line=>requestId+'|ALLOC|'+line.fundId)),
  historicalSourcePreserved:true,
  requiredWriterChecks:Object.freeze([
   'OWNER_AUTH_AND_CSRF','NATIVE_FINANCE_NEW_POST_WITH_CANONICAL_LOCK',
   'UNIQUE_FINCAP_KEY_AND_DURABLE_DEDUP','FUND_BALANCES_AND_TARGETS_LOCKED',
   'ATOMIC_FINANCE_CAPITAL_LINES_BALANCES_AUDIT','COMMIT_READBACK_AND_ROLLBACK'
  ])
 });
}
