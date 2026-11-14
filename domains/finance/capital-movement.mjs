/**
 * FINANCE B6 — source-only Capital fund TRANSFER, SPEND and REVERSAL preview.
 *
 * Parity basis: CapitalService.js capitalTransactionEffects_,
 * saveCapitalFundMovementService_, reverseCapitalFundTransactionService_.
 *
 * No database I/O or finance writes. Historical Google rows are immutable.
 * The future native writer must lock fund balances and the original movement,
 * prove one original/no competing reversal and atomically persist movement,
 * fund balance changes, original reversal status and durable audit.
 */
export class CapitalMovementError extends Error {
 constructor(code){super(code);this.name='CapitalMovementError';this.code=code;}
}
const fail=code=>{throw new CapitalMovementError(code);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MICRO=1000000n;
const BALANCE_FIELDS=['balanceBase','allocatedBase','transferredInBase',
 'transferredOutBase','spentBase'];
const DELTA_FIELDS=[...BALANCE_FIELDS,'transactionCount'];
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const validDay=v=>typeof v==='string'&&DAY.test(v)&&
 !Number.isNaN(Date.parse(v+'T00:00:00.000Z'))&&
 new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)===v;
const validId=v=>typeof v==='string'&&ID.test(v)&&v.length<=100;
function micro(value,field,{positive=false}={}){
 const s=String(value??'');
 if(!/^(0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(s))
  fail('CAPITAL_B6_INVALID_MONEY_'+field);
 const [whole,frac='']=s.split('.');
 const n=BigInt(whole)*MICRO+BigInt(frac.padEnd(6,'0'));
 if(n>1000000000000n*MICRO||(positive&&n===0n))
  fail('CAPITAL_B6_INVALID_MONEY_'+field);
 return n;
}
function fixed(n){
 const neg=n<0n,abs=neg?-n:n;
 return (neg?'-':'')+String(abs/MICRO)+'.'+String(abs%MICRO).padStart(6,'0');
}
function notes(input,max=5000){
 if(input===undefined||input===null)return '';
 if(typeof input!=='string'||input.length>max||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input))
  fail('CAPITAL_B6_TEXT_INVALID');
 return input.trim();
}
function textRequired(s,max){
 const v=notes(s,max);
 if(!v)fail('CAPITAL_B6_REASON_REQUIRED');
 return v;
}
function allowed(payload,fields){
 if(!object(payload))fail('CAPITAL_B6_PAYLOAD_INVALID');
 if(Object.keys(payload).some(k=>!fields.includes(k)))
  fail('CAPITAL_B6_EXTRA_FIELDS_FORBIDDEN');
 if(!UUID.test(payload.requestKey??''))
  fail('CAPITAL_B6_REQUEST_KEY_INVALID');
 if(!validDay(payload.transactionDateKey))
  fail('CAPITAL_B6_DATE_INVALID');
}
function snapshot(funds,balances,context){
 // The flag is an injected preview contract, NOT evidence of a DB lock.
 if(context?.sourceSnapshotVerified!==true)
  fail('CAPITAL_B6_CANONICAL_SNAPSHOT_REQUIRED');
 if(!Array.isArray(funds)||funds.length<1||funds.length>50||
    !Array.isArray(balances)||balances.length!==funds.length)
  fail('CAPITAL_B6_SNAPSHOT_INCOMPLETE');
 const fundMap=new Map(),balanceMap=new Map();
 for(const fund of funds){
  if(!object(fund)||!validId(fund.fundId)||fundMap.has(fund.fundId)||
     !['active','paused','archived'].includes(fund.status))
   fail('CAPITAL_B6_FUND_INVALID_OR_DUPLICATE');
  fundMap.set(fund.fundId,fund);
 }
 for(const r of balances){
  if(!object(r)||!validId(r.fundId)||balanceMap.has(r.fundId)||
     !fundMap.has(r.fundId))
   fail('CAPITAL_B6_BALANCE_INVALID_OR_DUPLICATE');
  const converted={fundId:r.fundId};
  for(const field of BALANCE_FIELDS)converted[field]=micro(r[field],field);
  if(!Number.isSafeInteger(r.transactionCount)||r.transactionCount<0)
   fail('CAPITAL_B6_COUNT_INVALID');
  converted.transactionCount=r.transactionCount;
  balanceMap.set(r.fundId,converted);
 }
 if(balanceMap.size!==fundMap.size)fail('CAPITAL_B6_SNAPSHOT_INCOMPLETE');
 return {fundMap,balanceMap};
}
const zero=()=>Object.fromEntries(BALANCE_FIELDS.map(f=>[f,0n]).concat([['transactionCount',0]]));
function add(map,fundId,changes){
 if(!fundId)return;
 const state=map.get(fundId)||zero();
 for(const [field,value] of Object.entries(changes)){
  if(!DELTA_FIELDS.includes(field))fail('CAPITAL_B6_DELTA_FIELD_INVALID');
  state[field]+=value;
 }
 map.set(fundId,state);
}
function originalDeltas(record){
 const amount=micro(record.amountBase,'amountBase',{positive:true}),effects=new Map();
 if(record.movementType==='TRANSFER'){
  if(!validId(record.fromFundId)||!validId(record.toFundId)||
     record.fromFundId===record.toFundId)
   fail('CAPITAL_B6_TRANSFER_FUNDS_INVALID');
  add(effects,record.fromFundId,{balanceBase:-amount,transferredOutBase:amount,transactionCount:1});
  add(effects,record.toFundId,{balanceBase:amount,transferredInBase:amount,transactionCount:1});
 }else if(record.movementType==='SPEND'){
  if(!validId(record.fromFundId)||record.toFundId)
   fail('CAPITAL_B6_SPEND_FUNDS_INVALID');
  add(effects,record.fromFundId,{balanceBase:-amount,spentBase:amount,transactionCount:1});
 }else if(record.movementType==='ALLOCATION'){
  if(!validId(record.toFundId)||record.fromFundId)
   fail('CAPITAL_B6_ALLOCATION_FUNDS_INVALID');
  add(effects,record.toFundId,{balanceBase:amount,allocatedBase:amount,transactionCount:1});
 }else fail('CAPITAL_B6_TYPE_UNSUPPORTED');
 return effects;
}
function applyDelta(effects,{fundMap,balanceMap}){
 const next=[],formatted=[];
 for(const [fundId,delta] of effects){
  const fund=fundMap.get(fundId),current=balanceMap.get(fundId);
  if(!fund||!current||fund.status==='archived')
   fail('CAPITAL_B6_AFFECTED_FUND_UNAVAILABLE');
  const balance={fundId},row={fundId};
  for(const field of BALANCE_FIELDS){
   const sum=current[field]+delta[field];
   if(sum<0n)fail(field==='balanceBase'?
    'CAPITAL_B6_INSUFFICIENT_FUNDS':'CAPITAL_B6_NEGATIVE_COUNTER_'+field);
   balance[field]=fixed(sum);
   row[field]=fixed(delta[field]);
  }
  const count=current.transactionCount+delta.transactionCount;
  if(!Number.isSafeInteger(count)||count<0)fail('CAPITAL_B6_COUNT_OVERFLOW');
  balance.transactionCount=count;row.transactionCount=delta.transactionCount;
  next.push(Object.freeze(balance));formatted.push(Object.freeze(row));
 }
 return {nextBalances:Object.freeze(next),effects:Object.freeze(formatted)};
}
function result(data,sources,record,action,extra={}){
 const updated=applyDelta(data,sources);
 return Object.freeze({
  source:'CLEAN_NATIVE_CAPITAL_PREVIEW',planningOnly:true,writerConnected:false,
  historicalSourcePreserved:true,financeLedgerEffect:'NONE',
  action,record:Object.freeze(record),...updated,...extra,
  requiredWriterChecks:Object.freeze([
   'OWNER_AUTH_AND_CSRF','FUND_SNAPSHOT_AND_RELATED_MOVEMENT_ROW_LOCK',
   'DURABLE_REQUEST_IDEMPOTENCY_AND_REVERSAL_UNIQUENESS',
   'ATOMIC_MOVEMENT_FUND_BALANCES_ORIGINAL_STATUS_AUDIT',
   'POST_COMMIT_READBACK_AND_ROLLBACK'
  ])
 });
}
/**
 * Mirrors the original movement service: source may be paused, but cannot be
 * archived; TRANSFER destination must be active and different from source.
 */
export function planCapitalMovement(payload,funds,balances,context={}){
 allowed(payload,['requestKey','movementType','amountBase','fromFundId',
  'toFundId','transactionDateKey','purpose','notes']);
 if(!['TRANSFER','SPEND'].includes(payload.movementType))
  fail('CAPITAL_B6_TYPE_UNSUPPORTED');
 const sources=snapshot(funds,balances,context);
 const from=sources.fundMap.get(payload.fromFundId);
 if(!from||from.status==='archived')fail('CAPITAL_B6_SOURCE_FUND_UNAVAILABLE');
 if(payload.movementType==='TRANSFER'){
  const to=sources.fundMap.get(payload.toFundId);
  if(!to||to.status!=='active'||from.fundId===to.fundId)
   fail('CAPITAL_B6_DESTINATION_INVALID');
 }else if(payload.toFundId!==undefined&&payload.toFundId!=='')
  fail('CAPITAL_B6_SPEND_DESTINATION_FORBIDDEN');
 const amount=micro(payload.amountBase,'amountBase',{positive:true});
 const purpose=textRequired(payload.purpose,1000);
 const record={
  status:'active',movementType:payload.movementType,
  transactionDateKey:payload.transactionDateKey,
  amountBase:fixed(amount),fromFundId:payload.fromFundId,
  toFundId:payload.movementType==='TRANSFER'?payload.toFundId:'',
  allocationBatchId:'',sourceType:payload.movementType==='TRANSFER'?'REALLOCATION':'FUND_USE',
  sourcePeriodKey:'',purpose,notes:notes(payload.notes),
  clientRequestId:payload.requestKey,reversalOfTransactionId:'',
  reversedAt:'',reversedByTransactionId:''
 };
 return result(originalDeltas(record),sources,record,'CREATE_'+payload.movementType);
}
/**
 * A reversal is an additional economic movement; the original remains in the
 * ledger but becomes status=reversed, with a newly issued reversal ID.
 * The reversal's fund transactionCount is +1 for every touched fund, matching
 * CapitalService.js. Allocation reversals require a different whole-batch
 * Finance+Capital guard and are never authorized here.
 */
export function planCapitalReversal(payload,original,funds,balances,context={}){
 allowed(payload,['requestKey','fundTransactionId','transactionDateKey','reason','notes']);
 if(!object(original)||!validId(original.fundTransactionId)||
    payload.fundTransactionId!==original.fundTransactionId)
  fail('CAPITAL_B6_ORIGINAL_ID_INVALID');
 if(original.sourceSystem!=='CLEAN_NATIVE_CAPITAL')
  fail('CAPITAL_B6_HISTORICAL_SOURCE_IMMUTABLE');
 if(context.originalTransactionVerified!==true||
    context.reversalLookupVerified!==true||context.matchingReversalsCount!==0)
  fail('CAPITAL_B6_REVERSAL_LOOKUP_UNVERIFIED');
 if(original.movementType==='REVERSAL')fail('CAPITAL_B6_CANNOT_REVERSE_REVERSAL');
 if(original.movementType==='ALLOCATION')
  fail('CAPITAL_B6_ALLOCATION_REQUIRES_BATCH_GATE');
 if(!['TRANSFER','SPEND'].includes(original.movementType)||
    original.status!=='active'||original.reversedByTransactionId!==''||
    original.reversalOfTransactionId!==''||original.allocationBatchId!=='')
  fail('CAPITAL_B6_ORIGINAL_NOT_REVERSIBLE');
 if(!validDay(original.transactionDateKey))
  fail('CAPITAL_B6_ORIGINAL_DATE_INVALID');
 const sources=snapshot(funds,balances,context);
 const reason=textRequired(payload.reason,1000);
 const base=originalDeltas(original),reverse=new Map();
 for(const [fundId,effect] of base){
  const delta={transactionCount:1};
  for(const field of BALANCE_FIELDS)delta[field]=-effect[field];
  add(reverse,fundId,delta);
 }
 const record={
  status:'active',movementType:'REVERSAL',
  transactionDateKey:payload.transactionDateKey,
  amountBase:fixed(micro(original.amountBase,'amountBase',{positive:true})),
  fromFundId:original.fromFundId,toFundId:original.toFundId||'',
  allocationBatchId:'',sourceType:'REVERSAL',sourcePeriodKey:original.sourcePeriodKey||'',
  purpose:'Сторно: '+reason,notes:notes(payload.notes),
  clientRequestId:payload.requestKey,reversalOfTransactionId:original.fundTransactionId,
  reversedAt:'',reversedByTransactionId:''
 };
 const extra={
  originalTransition:Object.freeze({
   fundTransactionId:original.fundTransactionId,
   fromStatus:'active',toStatus:'reversed',
   reversedByTransactionId:'REQUIRES_INSERTED_REVERSAL_ID',
   originalLedgerEntryPreserved:true
  })
 };
 return result(reverse,sources,record,'REVERSE_'+original.movementType,extra);
}
