/**
 * Finance B14 — update / archive / restore of NEW native finance transactions.
 * Disposable CI ONLY. Call solely inside B10's verified transactional adapter.
 *
 * Do not mount as hosted API. No Google, Render, Neon or shared TEST writes.
 * Existing FINCAP-linked transactions must not be edited or archived without
 * a separately approved atomic investment-reversal policy.
 */
import {normalizeFinanceUpdate} from './finance-update-normalize.mjs';
import {normalizeFinanceLifecycle} from './finance-lifecycle.mjs';

export async function financeAmendSynthetic(c,g,action,requestKey,payload,helpers){
 const {requireActive,readLedger,refs,micro,dec,day,fail}=helpers;
 // Hosted permission is internal to the B17 server-side verified transaction.
 // Existing direct B14 sandbox entrypoint remains local/disposable ONLY.
 if(helpers.verifiedHostedMode!==true && (
    process.env.FINANCE_B10_SYNTHETIC_ONLY!=='1'||
    !process.env.TEST_DATABASE_URL||
    !['localhost','127.0.0.1'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)||
    new URL(process.env.TEST_DATABASE_URL).pathname!=='/vbos_mvp_ci'))
  fail('B14_DISPOSABLE_DATABASE_REQUIRED');
 if(!['FINANCE_EDIT','FINANCE_CANCEL','FINANCE_RESTORE'].includes(action))
  fail('B14_ACTION_INVALID');
 const id=payload.financeTransactionId;
 const r=await c.query(
  'SELECT * FROM mvp_finance_native.transactions '+
  'WHERE finance_transaction_id=$1 FOR UPDATE',[id]);
 if(r.rows.length!==1)fail('B14_NATIVE_ROW_NOT_FOUND');
 const row=r.rows[0],original=row.normalized;
 if(row.source_system!=='CLEAN_NATIVE_FINANCE'||!original||
    typeof original!=='object'||Array.isArray(original))
  fail('B14_SOURCE_NOT_NATIVE');
 const sqlDate=day(row.transaction_date_key);
 if(original.transactionDateKey!==sqlDate||
    original.operationType!==row.operation_type||
    micro(original.amountBase,'source_amount')!==micro(row.amount_base,'db_amount')||
    micro(original.commissionBase,'source_commission')!==micro(row.commission_base,'db_commission')||
    micro(original.cashEffectBase,'source_cash')!==micro(row.cash_effect_base,'db_cash')||
    micro(original.profitEffectBase,'source_profit')!==micro(row.profit_effect_base,'db_profit')||
    micro(original.workerPayableEffectBase,'source_payable')!==micro(row.worker_payable_effect_base,'db_payable')||
    (original.clientId||null)!==(row.client_id||null)||
    (original.objectId||null)!==(row.object_id||null)||
    (original.workOrderId||null)!==(row.work_order_id||null)||
    (original.workerId||null)!==(row.worker_id||null))
  fail('B14_SOURCE_PAYLOAD_DRIFT');
 requireActive(g,sqlDate);
 if(row.revision!==payload.expectedRevision)fail('B14_REVISION_CONFLICT');
 if(row.revision>=2147483647)fail('B14_REVISION_EXHAUSTED');
 const linked=await c.query(
  'SELECT batch_id FROM mvp_finance_native.fincap_batches '+
  'WHERE finance_transaction_id=$1',[id]);
 if(linked.rows.length>0||
    (original.operationType==='OWNER_TRANSFER'&&original.ownerDirection==='investments'))
  fail('B14_LINKED_FINCAP_AMENDMENT_BLOCKED');
 const existing={
  ...original,financeTransactionId:id,sourceSystem:'CLEAN_NATIVE_FINANCE',
  status:row.status,revision:row.revision,
  archivedAt:row.archived_at instanceof Date?row.archived_at.toISOString():'',
  createdAt:row.created_at instanceof Date?row.created_at.toISOString():null
 };
 let next,archivedAt=null;
 if(action==='FINANCE_EDIT'){
  if(row.status!=='active')fail('B14_ARCHIVED_NOT_EDITABLE');
  const patch=payload.patch;
  requireActive(g,patch.transactionDate);
  const merged={...original,...patch};
  const result=normalizeFinanceUpdate({financeTransactionId:id,...patch},existing,{
   todayKey:patch.transactionDate,references:await refs(c,merged)
  });
  next=result.canonicalPatch;
  if(next.operationType==='OWNER_TRANSFER'&&next.ownerDirection==='investments')
   fail('B14_LINKED_FINCAP_AMENDMENT_BLOCKED');
 }else{
  const result=normalizeFinanceLifecycle({
   financeTransactionId:id,expectedRevision:payload.expectedRevision,
   action:action==='FINANCE_CANCEL'?'archive':'restore',requestKey
  },existing,{
   sourceVerified:true,capitalLinkChecked:true,linkedCapitalBatch:null,
   timestampIso:new Date().toISOString()
  });
  next=result.after;
  archivedAt=action==='FINANCE_CANCEL'?result.after.archivedAt:null;
 }
 const oldCash=micro(row.cash_effect_base,'old_cash');
 const oldProfit=micro(row.profit_effect_base,'old_profit');
 const oldPayable=micro(row.worker_payable_effect_base,'old_payable');
 const oldOn=row.status==='active'?1n:0n;
 const newOn=action==='FINANCE_CANCEL'?0n:1n;
 const nextCash=micro(next.cashEffectBase,'next_cash');
 const nextPayable=micro(next.workerPayableEffectBase,'next_payable');
 const cashChange=newOn*nextCash-oldOn*oldCash;
 const payChange=newOn*nextPayable-oldOn*oldPayable;
 const before=await readLedger(c);
 if(micro(before.cashBase,'cash_balance')+cashChange<0n)
  fail('B14_NEGATIVE_CASH_AFTER_AMENDMENT');
 if(micro(before.payableBase,'payable_balance')+payChange<0n)
  fail('B14_NEGATIVE_WORKER_PAYABLE_AFTER_AMENDMENT');
 const nextStatus=action==='FINANCE_CANCEL'?'archived':'active';
 const updated=await c.query(
  'UPDATE mvp_finance_native.transactions SET status=$1,revision=revision+1,'+
  'archived_at=$2,transaction_date_key=$3,operation_type=$4,'+
  'client_id=$5,object_id=$6,work_order_id=$7,worker_id=$8,'+
  'amount_base=$9,commission_base=$10,cash_effect_base=$11,'+
  'profit_effect_base=$12,worker_payable_effect_base=$13,normalized=$14::jsonb '+
  'WHERE finance_transaction_id=$15 AND revision=$16 AND status=$17 '+
  'RETURNING finance_transaction_id,revision,status',
  [nextStatus,archivedAt,next.transactionDateKey,next.operationType,
   next.clientId||null,next.objectId||null,next.workOrderId||null,next.workerId||null,
   dec(micro(next.amountBase,'next_amount')),
   dec(micro(next.commissionBase,'next_commission')),
   dec(nextCash),dec(micro(next.profitEffectBase,'next_profit')),dec(nextPayable),
   JSON.stringify(action==='FINANCE_EDIT'?next:original),
   id,row.revision,row.status]);
 if(updated.rowCount!==1||updated.rows.length!==1)
  fail('B14_ATOMIC_REVISION_RACE');
 const after=await readLedger(c);
 if(micro(after.cashBase,'cash_balance')!==
    micro(before.cashBase,'cash_balance')+cashChange)
  fail('B14_LEDGER_READBACK_CASH_DRIFT');
 if(micro(after.payableBase,'payable_balance')!==
    micro(before.payableBase,'payable_balance')+payChange)
  fail('B14_LEDGER_READBACK_PAYABLE_DRIFT');
 const profitChange=newOn*micro(next.profitEffectBase,'next_profit')-
  oldOn*oldProfit;
 if(micro(after.profitDeltaBase,'profit_delta')!==
    micro(before.profitDeltaBase,'profit_delta')+profitChange)
  fail('B14_LEDGER_READBACK_PROFIT_DRIFT');
 return {
  sourceKind:'FinanceTransaction',sourceId:id,financeTransactionId:id,
  sourceSystem:'CLEAN_NATIVE_FINANCE',
  action,revisionBefore:row.revision,revisionAfter:updated.rows[0].revision,
  statusBefore:row.status,statusAfter:updated.rows[0].status,
  before,after,
  effects:{
   cashDifference:dec(cashChange),profitDifference:dec(profitChange),
   workerPayableDifference:dec(payChange)
  },
  historicalSourcePreserved:true,
  writer:'B14_ISOLATED_PG',synthetic:true,replayed:false
 };
}
