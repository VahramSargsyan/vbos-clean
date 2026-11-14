/**
 * FINANCE-BATCH2-03 — source-independent FinanceService parity engine.
 * Pure functions ONLY: caller supplies normalized rows and existing balances.
 * NO Google/Neon reads, no imports, no backfills, no schema, no persistence.
 *
 * 11 fields and scope order come from FinanceService.js:
 * financeContribution_, financeScopesForRecord_, financeScopeFromRequest_,
 * applyFinanceBalanceDeltaUnlocked_.
 *
 * Important: a computed result proves only the supplied input, not that a
 * historical snapshot/current ledger is complete. The future writer must
 * persist transaction + each affected scope atomically and idempotently.
 */
export class FinanceSummaryEngineError extends Error {
 constructor(code){super(code);this.name='FinanceSummaryEngineError';this.code=code;}
}
const fail=code=>{throw new FinanceSummaryEngineError(code);};
export const FINANCE_BALANCE_FIELDS=Object.freeze([
 'earnedBase','receivedBase','economicExpenseBase','cashOutBase','ownerTransferBase',
 'workerAccruedBase','workerPaidBase','workerPayableBase','profitBase',
 'cashBalanceBase','transactionCount'
]);
const FINANCE_TYPES=new Set(['INCOME','EXPENSE','WORKER_ACCRUAL',
 'WORKER_PAYMENT','WORKER_ACCRUAL_PAYMENT','OWNER_TRANSFER']);
const MICRO=1000000n;
const MISSING=Symbol('noRecord');
const validID=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(v);
const str=v=>v===undefined||v===null?'':String(v);
function parseMicro(value,field,{allowNegative=true}={}){
 const text=str(value);
 if(!/^-?(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text))fail('FINANCE_SUMMARY_INVALID_MONEY_'+field);
 const negative=text.startsWith('-'),[whole,frac='']=(negative?text.slice(1):text).split('.');
 const v=BigInt(whole)*MICRO+BigInt(frac.padEnd(6,'0'));
 if(!allowNegative&&negative&&v!==0n)fail('FINANCE_SUMMARY_NEGATIVE_'+field);
 return negative?-v:v;
}
function asDecimal(micro){
 const negative=micro<0n,amount=negative?-micro:micro;
 return (negative?'-':'')+String(amount/MICRO)+'.'+String(amount%MICRO).padStart(6,'0');
}
function scope(type,id){
 const valid=type==='GLOBAL'&&id==='ALL'||
  ['OBJECT','WORK_ORDER','WORKER'].includes(type)&&validID(id);
 if(!valid)fail('FINANCE_SUMMARY_SCOPE_INVALID');
 return Object.freeze({scopeKey:type+'|'+id,scopeType:type,scopeId:id});
}
/** Same priority as original financeScopeFromRequest_: order > worker > object > global. */
export function financeScopeFromRequest(request={}){
 if(!request||typeof request!=='object'||Array.isArray(request))
  fail('FINANCE_SUMMARY_REQUEST_INVALID');
 for(const [field,type] of [['workOrderId','WORK_ORDER'],['workerId','WORKER'],['objectId','OBJECT']]){
  if(request[field])return scope(type,str(request[field]));
 }
 return scope('GLOBAL','ALL');
}
export function financeScopesForRecord(record){
 const scopes=[scope('GLOBAL','ALL')];
 if(!record)return Object.freeze(scopes);
 if(typeof record!=='object'||Array.isArray(record))fail('FINANCE_SUMMARY_RECORD_INVALID');
 for(const [field,type] of [['objectId','OBJECT'],['workOrderId','WORK_ORDER'],['workerId','WORKER']]){
  if(record[field])scopes.push(scope(type,str(record[field])));
 }
 return Object.freeze(scopes);
}
const empty=()=>Object.fromEntries(FINANCE_BALANCE_FIELDS.map(field=>[field,0n]));
function contribution(record){
 const result=empty();
 if(record===null||record===undefined)return result;
 if(typeof record!=='object'||Array.isArray(record))fail('FINANCE_SUMMARY_RECORD_INVALID');
 const status=str(record.status);
 if(status==='archived')return result;
 if(status!=='active')fail('FINANCE_SUMMARY_STATUS_INVALID');
 if(!FINANCE_TYPES.has(record.operationType))fail('FINANCE_SUMMARY_OPERATION_INVALID');
 const amount=parseMicro(record.amountBase,'amountBase',{allowNegative:false});
 const commission=parseMicro(record.commissionBase,'commissionBase',{allowNegative:false});
 const cash=parseMicro(record.cashEffectBase,'cashEffectBase');
 const profit=parseMicro(record.profitEffectBase,'profitEffectBase');
 const payable=parseMicro(record.workerPayableEffectBase,'workerPayableEffectBase');
 const {operationType:type,category,incomeRecognition}=record;
 if(type==='INCOME'){
  if(incomeRecognition!=='RECEIVED_ONLY')result.earnedBase+=amount;
  if(incomeRecognition!=='EARNED_ONLY')result.receivedBase+=amount;
 }
 if(type==='EXPENSE'&&category!=='client_material_purchase')
  result.economicExpenseBase+=amount;
 if(type==='WORKER_ACCRUAL'||type==='WORKER_ACCRUAL_PAYMENT'){
  result.economicExpenseBase+=amount;result.workerAccruedBase+=amount;
 }
 if(type==='WORKER_PAYMENT'||type==='WORKER_ACCRUAL_PAYMENT')
  result.workerPaidBase+=amount;
 if(type==='OWNER_TRANSFER')result.ownerTransferBase+=amount;
 result.economicExpenseBase+=commission;
 result.cashOutBase+=cash<0n?-cash:0n;
 result.workerPayableBase+=payable;
 result.profitBase+=profit;
 result.cashBalanceBase+=cash;
 result.transactionCount=MICRO;
 return result;
}
function decorate(scopeKey,scopeType,scopeId,t){
 const obj={scopeKey,scopeType,scopeId};
 for(const field of FINANCE_BALANCE_FIELDS)
  obj[field]=field==='transactionCount'?Number(t[field]/MICRO):asDecimal(t[field]);
 return Object.freeze(obj);
}
function counted(record,scopeKey){
 return !!record&&str(record.status)==='active'&&
  financeScopesForRecord(record).some(s=>s.scopeKey===scopeKey);
}
/** Recalculate purely from supplied rows. Never use this as proof of source completeness. */
export function financeSummaryFromRows(rows,requestedScope=scope('GLOBAL','ALL')){
 if(!Array.isArray(rows)||rows.length>10000)fail('FINANCE_SUMMARY_INPUT_BOUND');
 const selected=scope(requestedScope?.scopeType,requestedScope?.scopeId),total=empty();
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row))
   fail('FINANCE_SUMMARY_RECORD_INVALID');
  // Check every supplied row's type/status, including records for other scopes.
  if(!['active','archived'].includes(str(row.status)))
   fail('FINANCE_SUMMARY_STATUS_INVALID');
  if(str(row.status)==='active'&&!FINANCE_TYPES.has(row.operationType))
   fail('FINANCE_SUMMARY_OPERATION_INVALID');
  if(!financeScopesForRecord(row).some(x=>x.scopeKey===selected.scopeKey))continue;
  const v=contribution(row);
  for(const field of FINANCE_BALANCE_FIELDS)total[field]+=v[field];
 }
 return decorate(selected.scopeKey,selected.scopeType,selected.scopeId,total);
}
/** Apply before/after to an existing scoped balance IN MEMORY; no writes, no I/O. */
export function financeSummaryDelta(priorBalance,requestedScope,before=null,after=null){
 const selected=scope(requestedScope?.scopeType,requestedScope?.scopeId);
 const total=empty();
 if(priorBalance!==null&&priorBalance!==undefined){
  if(priorBalance.scopeKey!==selected.scopeKey||
     priorBalance.scopeType!==selected.scopeType||
     priorBalance.scopeId!==selected.scopeId)fail('FINANCE_SUMMARY_BALANCE_SCOPE_MISMATCH');
  for(const field of FINANCE_BALANCE_FIELDS){
   if(field==='transactionCount'){
    const n=priorBalance[field];
    if(!Number.isSafeInteger(n)||n<0)fail('FINANCE_SUMMARY_BALANCE_COUNT_INVALID');
    total[field]=BigInt(n)*MICRO;
   }else total[field]=parseMicro(priorBalance[field],field);
  }
 }
 const subtract=counted(before,selected.scopeKey)?contribution(before):empty();
 const add=counted(after,selected.scopeKey)?contribution(after):empty();
 for(const field of FINANCE_BALANCE_FIELDS){
  total[field]+=add[field]-subtract[field];
  if(field==='transactionCount'&&total[field]<0n)
   fail('FINANCE_SUMMARY_NEGATIVE_COUNT');
 }
 return decorate(selected.scopeKey,selected.scopeType,selected.scopeId,total);
}
/** A single transaction mutation may affect GLOBAL and up to 3 relation scopes. */
export function financeAffectedScopes(before=null,after=null){
 const found=new Map();
 for(const record of [before,after]){
  for(const s of financeScopesForRecord(record))found.set(s.scopeKey,s);
 }
 return Object.freeze([...found.values()]);
}
