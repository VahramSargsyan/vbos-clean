/**
 * FINANCE_ORDER_RESULT_ARCHIVE_V1
 * Port of FinanceService.js financeContribution_ + WORK_ORDER scope semantics.
 * Owner-only frozen historical source; not a current/live financial balance.
 */
import {financeCapitalArchiveRead} from './finance-capital-archive-api.mjs';

export class FinanceOrderResultError extends Error {
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new FinanceOrderResultError(status,code);};
const BATCH='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const SNAP='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const idValid=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(x);
const fields=['earnedBase','receivedBase','economicExpenseBase','cashOutBase','ownerTransferBase',
 'workerAccruedBase','workerPaidBase','workerPayableBase','profitBase','cashBalanceBase','transactionCount'];
const types=new Set(['INCOME','EXPENSE','WORKER_ACCRUAL','WORKER_PAYMENT','WORKER_ACCRUAL_PAYMENT','OWNER_TRANSFER']);
const decimal=x=>{const neg=x<0n,v=neg?-x:x;return (neg?'-':'')+String(v/1000000n)+'.'+String(v%1000000n).padStart(6,'0');};
function micros(value,field){
 const text=String(value??'');
 if(!/^-?(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text))fail(503,'FINANCE_ORDER_INVALID_MONEY_'+field);
 const neg=text.startsWith('-'),[w,frac='']=(neg?text.slice(1):text).split('.');
 const v=BigInt(w)*1000000n+BigInt(frac.padEnd(6,'0'));
 return neg?-v:v;
}
const empty=()=>Object.fromEntries(fields.map(k=>[k,0n]));

/** Shared original FinanceService.js contribution logic: one row contributes once
 * to each matching independent scope (WORK_ORDER, OBJECT or WORKER), not summed via Orders.
 * Values are original normalized source facts, fixed to 6-decimal micro precision.
 */
function legacyScopedFinanceSummary(scopeType,id,transactions,control){
 const scope={
  OBJECT:{field:'objectId',prefix:'FINANCE_OBJECT'},
  WORK_ORDER:{field:'workOrderId',prefix:'FINANCE_ORDER'},
  WORKER:{field:'workerId',prefix:'FINANCE_WORKER'}
 }[scopeType];
 const prefix=scope?.prefix||'FINANCE_SCOPE',field=scope?.field;
 if(!scope||!idValid(id)||
    !Array.isArray(transactions)||transactions.length>24)
  fail(503,prefix+'_SOURCE_INVALID');
 const total=empty();
 for(const row of transactions){
  if(!row||row[field]!==id||!['active','archived'].includes(row.status)||
     !types.has(row.operationType))fail(503,prefix+'_ROW_INVALID');
  if(row.status==='archived')continue;
  const amount=micros(row.amountBase,'amountBase');
  const commission=micros(row.commissionBase,'commissionBase');
  const cash=micros(row.cashEffectBase,'cashEffectBase');
  const profit=micros(row.profitEffectBase,'profitEffectBase');
  const worker=micros(row.workerPayableEffectBase,'workerPayableEffectBase');
  if(amount<0n||commission<0n)fail(503,prefix+'_NEGATIVE_SOURCE_AMOUNT');
  if(row.operationType==='INCOME'){
   if(row.incomeRecognition!=='RECEIVED_ONLY')total.earnedBase+=amount;
   if(row.incomeRecognition!=='EARNED_ONLY')total.receivedBase+=amount;
  }
  if(row.operationType==='EXPENSE'&&row.category!=='client_material_purchase')
   total.economicExpenseBase+=amount;
  if(row.operationType==='WORKER_ACCRUAL'||row.operationType==='WORKER_ACCRUAL_PAYMENT'){
   total.economicExpenseBase+=amount;total.workerAccruedBase+=amount;
  }
  if(row.operationType==='WORKER_PAYMENT'||row.operationType==='WORKER_ACCRUAL_PAYMENT')
   total.workerPaidBase+=amount;
  if(row.operationType==='OWNER_TRANSFER')total.ownerTransferBase+=amount;
  total.economicExpenseBase+=commission;
  total.cashOutBase+=cash<0n?-cash:0n;
  total.workerPayableBase+=worker;total.profitBase+=profit;total.cashBalanceBase+=cash;
  total.transactionCount+=1000000n;
 }
 if(control){
  if(control.scopeKey!==scopeType+'|'+id||control.scopeId!==id||
     control.scopeType!==scopeType)fail(503,prefix+'_SCOPE_MISMATCH');
  for(const key of fields){
   if(micros(control[key],key)!==total[key])fail(503,prefix+'_BALANCE_PARITY_'+key);
  }
 }else if(total.transactionCount!==0n)fail(503,prefix+'_BALANCE_MISSING');
 return Object.freeze(Object.fromEntries(fields.map(k=>
  [k,k==='transactionCount'?Number(total[k]/1000000n):decimal(total[k])])));
}
export function legacyOrderFinanceSummary(orderId,transactions,control){
 return legacyScopedFinanceSummary('WORK_ORDER',orderId,transactions,control);
}
export function legacyObjectFinanceSummary(objectId,transactions,control){
 return legacyScopedFinanceSummary('OBJECT',objectId,transactions,control);
}
export function legacyWorkerFinanceSummary(workerId,transactions,control){
 return legacyScopedFinanceSummary('WORKER',workerId,transactions,control);
}

/** Read a single verified frozen order and its source transactions; nothing mutates PostgreSQL. */
export async function financeOrderResultRead(db,orderId,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)fail(401,'OWNER_SESSION_REQUIRED');
 if(!idValid(orderId))fail(400,'FINANCE_ORDER_ID_INVALID');
 // Reuse existing independent finance snapshot identity / row hash / balance controls.
 const archive=await financeCapitalArchiveRead(db,{authorizeOwner:()=>true});
 if(archive.readonly!==true||archive.financialWriter!=='GOOGLE')fail(503,'FINANCE_ORDER_ARCHIVE_UNVERIFIED');
 const q=await db.query(
  "SELECT source_id,original_status,source_payload->>'title' AS title FROM mvp_history.source_records WHERE source_kind='WORK_ORDER' AND source_system='LEGACY_GOOGLE' AND import_batch_id=$1 AND source_id=$2 LIMIT 2",
  [BATCH,orderId]);
 if(q.rows?.length!==1)fail(404,'FINANCE_ORDER_NOT_FOUND');
 const order=q.rows[0];
 const rows=await db.query(
  "SELECT source_payload, payload_sha256=encode(sha256(convert_to(source_payload::text,'UTF8')),'hex') AS sha_valid,original_status,source_system FROM mvp_history.source_records WHERE source_kind='FINANCE_TRANSACTION' AND source_system='LEGACY_GOOGLE' AND import_batch_id=$1 AND source_payload->>'workOrderId'=$2 ORDER BY source_id LIMIT 25",
  [BATCH,orderId]);
 const transactions=(rows.rows||[]).map(item=>{
  if(item.sha_valid!==true||item.source_system!=='LEGACY_GOOGLE'||
     item.original_status!==item.source_payload?.status)fail(503,'FINANCE_ORDER_TRANSACTION_INTEGRITY');
  return item.source_payload;
 });
 if(transactions.length>24)fail(503,'FINANCE_ORDER_TOO_MANY_TRANSACTIONS');
 const c=await db.query(
  "SELECT source_payload,payload_sha256=encode(sha256(convert_to(source_payload::text,'UTF8')),'hex') AS sha_valid FROM mvp_finance_stage.control_snapshots WHERE snapshot_id=$1 AND source_kind='FINANCE_BALANCE' AND source_id=$2 LIMIT 2",
  [SNAP,'WORK_ORDER|'+orderId]);
 if((c.rows||[]).length>1||c.rows?.[0]?.sha_valid===false)
  fail(503,'FINANCE_ORDER_CONTROL_INTEGRITY');
 const metrics=legacyOrderFinanceSummary(orderId,transactions,c.rows?.[0]?.source_payload||null);
 return Object.freeze({
  source:'VERIFIED_FROZEN_LEGACY_ORDER_FINANCE',readonly:true,financialWriter:'GOOGLE',
  currentOperationalFinance:false,sourceModifiedAt:archive.sourceModifiedAt,
  orderId,orderTitle:String(order.title||orderId),orderStatus:order.original_status,
  currency:'AMD',...metrics,hasOperations:metrics.transactionCount>0,
  meaning:'HISTORICAL_ACCUMULATED_ORDER_FINANCE_NOT_CURRENT_BALANCE'
 });
}
