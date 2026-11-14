/**
 * FINANCE-BATCH2-04 — pure NEW transaction normalization.
 * Port of FinanceService.js normalizeFinanceTransaction_ + financeLinkContext_.
 * Caller supplies the exact date and already-loaded reference records.
 * NO stored data reads/writes, no IDs generated, no capital allocations.
 */
export class FinanceCreateNormalizeError extends Error{
 constructor(code){super(code);this.name='FinanceCreateNormalizeError';this.code=code;}
}
const fail=code=>{throw new FinanceCreateNormalizeError(code);};
const TYPES=Object.freeze(['INCOME','EXPENSE','WORKER_ACCRUAL','WORKER_PAYMENT',
 'WORKER_ACCRUAL_PAYMENT','OWNER_TRANSFER']);
const INCOME_CATS=Object.freeze(['current_work','advance','client_material_funds','old_debt','bonus','other']);
const EXPENSE_CATS=Object.freeze(['materials','client_material_purchase','transport',
 'tools','subcontractor','office','other']);
const RECOGNITION=Object.freeze(['EARNED_AND_RECEIVED','RECEIVED_ONLY','EARNED_ONLY']);
const DIRECTIONS=Object.freeze(['wife','home','self','investments','other']);
const CURRENCIES=Object.freeze(['AMD','USD','EUR']);
export const FINANCE_CREATE_ENUMS=Object.freeze({
 operationTypes:TYPES,incomeCategories:INCOME_CATS,expenseCategories:EXPENSE_CATS,
 recognition:RECOGNITION,ownerDirections:DIRECTIONS,currencies:CURRENCIES
});
const safe=(value,max=100)=>String(value===undefined||value===null?'':value).trim().slice(0,max);
function choice(value,allowed,field,fallback){
 const s=safe(value,100);
 if(!s&&fallback!==undefined)return fallback;
 if(!allowed.includes(s))fail('FINANCE_CREATE_INVALID_'+field);
 return s;
}
function date(value,field){
 const s=safe(value,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s))fail('FINANCE_CREATE_INVALID_'+field);
 const t=Date.parse(s+'T00:00:00Z');
 if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==s)
  fail('FINANCE_CREATE_NONCALENDAR_'+field);
 return s;
}
/** Original financeRound_ parity, including JS decimal and six-digit rounding. */
const round=x=>Math.round((x+Number.EPSILON)*1000000)/1000000;
function number(value,field,allowZero){
 if(value===null||value===undefined||safe(value,100)===''){
  if(allowZero)return 0;
  fail('FINANCE_CREATE_REQUIRED_'+field);
 }
 const n=Number(String(value).replace(',','.'));
 if(!Number.isFinite(n)||n<0||(!allowZero&&n<=0))
  fail('FINANCE_CREATE_INVALID_'+field);
 const rounded=round(n);
 if(!Number.isFinite(rounded)||rounded<0||(!allowZero&&rounded<=0))
  fail('FINANCE_CREATE_ROUNDED_INVALID_'+field);
 return rounded;
}
function ref(refs,group,id,key){
 if(!id)return null;
 const dict=refs?.[group];
 const row=dict instanceof Map?dict.get(id):
  dict&&typeof dict==='object'&&Object.hasOwn(dict,id)?dict[id]:null;
 if(!row||typeof row!=='object'||safe(row[key])!==id)
  fail('FINANCE_CREATE_REFERENCE_NOT_FOUND_'+group);
 return row;
}
const validID=v=>!v||/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(v);
function links(input,operationType,category,references){
 let workOrderId=safe(input.workOrderId),objectId=safe(input.objectId),clientId=safe(input.clientId);
 if(![workOrderId,objectId,clientId].every(validID))
  fail('FINANCE_CREATE_REFERENCE_ID_INVALID');
 let workOrder=null,objectRecord=null;
 if(workOrderId){
  workOrder=ref(references,'workOrders',workOrderId,'workOrderId');
  if(objectId&&objectId!==safe(workOrder.objectId))
   fail('FINANCE_CREATE_ORDER_OBJECT_MISMATCH');
  objectId=safe(workOrder.objectId);
  clientId=safe(workOrder.clientId);
 }
 if(objectId){
  objectRecord=ref(references,'objects',objectId,'objectId');
  if(clientId&&clientId!==safe(objectRecord.clientId))
   fail('FINANCE_CREATE_OBJECT_CLIENT_MISMATCH');
  clientId=safe(objectRecord.clientId);
 }
 if(clientId)ref(references,'clients',clientId,'clientId');
 const orderRequired=operationType==='INCOME'&&
  ['current_work','advance','client_material_funds'].includes(category)||
  operationType==='EXPENSE'&&category==='client_material_purchase'||
  ['WORKER_ACCRUAL','WORKER_ACCRUAL_PAYMENT'].includes(operationType);
 if(orderRequired&&!workOrderId)fail('FINANCE_CREATE_WORK_ORDER_REQUIRED');
 return {workOrderId,objectId,clientId};
}
/**
 * For CREATE only. Status must be active (FinanceService.saveFinanceTransactionService_).
 * No now() fallback: caller explicitly provides todayKey and optional fxRateDate.
 * Existing legacy transaction updates and capital investing are separate features.
 */
export function normalizeFinanceCreate(payload,{todayKey,references={}}={}){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))
  fail('FINANCE_CREATE_PAYLOAD_INVALID');
 if(payload.financeTransactionId)fail('FINANCE_CREATE_NOT_AN_UPDATE');
 const operationType=choice(payload.operationType??'INCOME',TYPES,'operationType','INCOME');
 let category='',incomeRecognition='',ownerDirection='',workerId='';
 if(operationType==='INCOME'){
  category=choice(payload.category??'current_work',INCOME_CATS,'category','current_work');
  const fallback=['advance','old_debt','client_material_funds'].includes(category)?
   'RECEIVED_ONLY':'EARNED_AND_RECEIVED';
  incomeRecognition=category==='client_material_funds'?'RECEIVED_ONLY':
   choice(payload.incomeRecognition??fallback,RECOGNITION,'incomeRecognition',fallback);
 }else if(operationType==='EXPENSE'){
  category=choice(payload.category??'other',EXPENSE_CATS,'category','other');
 }else if(['WORKER_ACCRUAL','WORKER_PAYMENT','WORKER_ACCRUAL_PAYMENT'].includes(operationType)){
  category='worker';workerId=safe(payload.workerId);
  if(!workerId||!validID(workerId))fail('FINANCE_CREATE_WORKER_REQUIRED');
  const worker=ref(references,'workers',workerId,'workerId');
  if(safe(worker.status)==='archived')fail('FINANCE_CREATE_WORKER_ARCHIVED');
 }else{
  category='owner_transfer';
  ownerDirection=choice(payload.ownerDirection,DIRECTIONS,'ownerDirection');
 }
 const linked=operationType==='OWNER_TRANSFER'?
  {workOrderId:'',objectId:'',clientId:''}:
  links(payload,operationType,category,references);
 const transactionDate=date(payload.transactionDate||todayKey,'transactionDate');
 const amountOriginal=number(payload.amountOriginal,'amountOriginal',false);
 const currencyOriginal=choice(
  safe(payload.currencyOriginal??'AMD',100).toUpperCase(),CURRENCIES,'currencyOriginal','AMD');
 const baseCurrency='AMD';
 let fxRate=1,fxRateSource='same_currency';
 if(currencyOriginal!==baseCurrency){
  fxRate=number(payload.fxRate,'fxRate',false);
  fxRateSource=safe(payload.fxRateSource??'manual')||'manual';
 }
 const fxRateDate=date(payload.fxRateDate===undefined?transactionDate:(payload.fxRateDate||todayKey),'fxRateDate');
 const amountBase=round(amountOriginal*fxRate);
 const commissionOriginal=number(payload.commissionOriginal??0,'commissionOriginal',true);
 const commissionBase=round(commissionOriginal*fxRate);
 if(!Number.isFinite(amountBase)||!Number.isFinite(commissionBase)||
    amountBase<=0||commissionBase<0)
  fail('FINANCE_CREATE_FX_OVERFLOW');
 if(operationType==='WORKER_ACCRUAL'&&commissionBase>0)
  fail('FINANCE_CREATE_ACCRUAL_COMMISSION');
 if(operationType==='INCOME'&&incomeRecognition==='EARNED_ONLY'&&commissionBase>0)
  fail('FINANCE_CREATE_UNPAID_INCOME_COMMISSION');
 let cashEffectBase=0,profitEffectBase=0,workerPayableEffectBase=0;
 if(operationType==='INCOME'){
  if(incomeRecognition!=='EARNED_ONLY')cashEffectBase=amountBase-commissionBase;
  if(incomeRecognition!=='RECEIVED_ONLY')profitEffectBase=amountBase;
  if(incomeRecognition!=='EARNED_ONLY')profitEffectBase-=commissionBase;
 }else if(operationType==='EXPENSE'){
  cashEffectBase=-(amountBase+commissionBase);
  profitEffectBase=category==='client_material_purchase'?-commissionBase:cashEffectBase;
 }else if(operationType==='WORKER_ACCRUAL'){
  profitEffectBase=-amountBase;workerPayableEffectBase=amountBase;
 }else if(operationType==='WORKER_PAYMENT'){
  cashEffectBase=-(amountBase+commissionBase);profitEffectBase=-commissionBase;
  workerPayableEffectBase=-amountBase;
 }else if(operationType==='WORKER_ACCRUAL_PAYMENT'){
  cashEffectBase=-(amountBase+commissionBase);profitEffectBase=cashEffectBase;
 }else if(operationType==='OWNER_TRANSFER'){
  cashEffectBase=-(amountBase+commissionBase);profitEffectBase=-commissionBase;
 }
 const status=choice(payload.status??'active',['active','archived'],'status','active');
 if(status!=='active')fail('FINANCE_CREATE_ARCHIVED_NOT_ALLOWED');
 const effects=[cashEffectBase,profitEffectBase,workerPayableEffectBase];
 if(effects.some(x=>!Number.isFinite(x)))fail('FINANCE_CREATE_EFFECT_OVERFLOW');
 return Object.freeze({
  status,transactionDate,transactionDateKey:transactionDate,operationType,category,
  incomeRecognition,amountOriginal,currencyOriginal,baseCurrency,fxRate,fxRateDate,
  fxRateSource,amountBase,commissionOriginal,commissionBase,
  cashEffectBase:round(cashEffectBase),profitEffectBase:round(profitEffectBase),
  workerPayableEffectBase:round(workerPayableEffectBase),
  ...linked,workerId,counterparty:safe(payload.counterparty,300),ownerDirection,
  sourceModule:'Finance',notes:safe(payload.notes,5000),archivedAt:''
 });
}
