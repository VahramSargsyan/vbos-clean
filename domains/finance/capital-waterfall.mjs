/**
 * FINANCE B5 — target-aware 15/15/70 capital waterfall, source-only.
 *
 * Source: CapitalService.js capitalWaterfallAllocationsUnlocked_ and
 * FinanceService.js ensureFinanceInvestmentCapitalAllocationUnlocked_.
 * Frozen policy: 15% operating reserve + 15% warranty reserve; whatever is
 * not reserved (including released/capped reserve portions) goes to active
 * GROWTH funds in their canonical input order and proportional weights.
 *
 * This module never posts money. All snapshots, unique FINCAP link checks,
 * single-writer authority and atomic persistence belong to a future writer.
 * LEGACY_GOOGLE historical facts must remain immutable.
 */
import {financeInvestmentRequestId} from './finance-investment-guard.mjs';

export class CapitalWaterfallError extends Error {
 constructor(code){super(code);this.name='CapitalWaterfallError';this.code=code;}
}
const fail=code=>{throw new CapitalWaterfallError(code);};
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const MICRO=1000000n;
const PCT_BASE=100n*MICRO;
const MAX=1000000000000n*MICRO;
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
 !Number.isNaN(Date.parse(v+'T00:00:00.000Z'))&&
 new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)===v;
const fmt=n=>String(n/MICRO)+'.'+String(n%MICRO).padStart(6,'0');
function micro(value,label,{positive=false}={}){
 const raw=String(value??'');
 if(!/^(0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(raw))fail('CAPITAL_B5_INVALID_'+label);
 const [whole,part='']=raw.split('.');
 const n=BigInt(whole)*MICRO+BigInt(part.padEnd(6,'0'));
 if(n>MAX||(positive&&n===0n))fail('CAPITAL_B5_INVALID_'+label);
 return n;
}
function percent(value,label){
 const n=micro(value,label);
 if(n>PCT_BASE)fail('CAPITAL_B5_PERCENT_OUT_OF_RANGE_'+label);
 return n;
}
const rounded=(num,denom)=>(num+denom/2n)/denom;
const minimum=(a,b)=>a<b?a:b;
function canonicalSources(funds,balances){
 if(!Array.isArray(funds)||funds.length<1||funds.length>50)
  fail('CAPITAL_B5_FUND_LIST_INVALID');
 if(!Array.isArray(balances)||balances.length!==funds.length)
  fail('CAPITAL_B5_BALANCE_LIST_INCOMPLETE');
 const seenIds=new Set(),seenCodes=new Set(),byBalance=new Map(),cleanFunds=[];
 for(const row of balances){
  if(!obj(row)||!id(row.fundId)||byBalance.has(row.fundId))
   fail('CAPITAL_B5_BALANCE_DUPLICATE_OR_INVALID');
  byBalance.set(row.fundId,micro(row.balanceBase,'balanceBase'));
 }
 for(const fund of funds){
  if(!obj(fund)||!id(fund.fundId)||fund.fundId.length>100||
     typeof fund.code!=='string'||!fund.code||fund.code.length>100||
     seenIds.has(fund.fundId)||seenCodes.has(fund.code))
   fail('CAPITAL_B5_FUND_ID_OR_CODE_INVALID');
  if(!['active','paused','archived'].includes(fund.status)||
     !['PROTECTIVE','GROWTH'].includes(fund.groupType)||
     !byBalance.has(fund.fundId))
   fail('CAPITAL_B5_FUND_STATUS_OR_BALANCE_INVALID');
  if(['OPERATING_RESERVE','WARRANTY_RESERVE'].includes(fund.code)&&
     fund.groupType!=='PROTECTIVE')fail('CAPITAL_B5_PROTECTIVE_GROUP_INVALID');
  seenIds.add(fund.fundId);seenCodes.add(fund.code);
  cleanFunds.push({
   id:fund.fundId,code:fund.code,status:fund.status,group:fund.groupType,
   target:micro(fund.targetAmountBase,'targetAmountBase'),
   weight:percent(fund.allocationSharePct,'allocationSharePct'),
   balance:byBalance.get(fund.fundId)
  });
 }
 if([...byBalance.keys()].some(k=>!seenIds.has(k)))
  fail('CAPITAL_B5_BALANCE_ORPHAN');
 return cleanFunds;
}
/**
 * Deterministic micro-AMD plan. At normal precision this matches the legacy
 * 6-place Math.round waterfall; for tiny split residues it fails closed rather
 * than leaving an unmatched or negative last allocation.
 *
 * Caller-supplied rows are NOT trusted proof of current DB balances or locks.
 */
export function planCapitalWaterfall(totalAmountBase,funds,balances,{sourceSnapshotVerified=false}={}){
 if(sourceSnapshotVerified!==true)fail('CAPITAL_B5_CANONICAL_SNAPSHOT_REQUIRED');
 const total=micro(totalAmountBase,'totalAmountBase',{positive:true});
 const rows=canonicalSources(funds,balances);
 const active=rows.filter(f=>f.status==='active'),allocations=[],reservedByFund={};
 let allocated=0n;
 for(const [code,pct] of [['OPERATING_RESERVE',15n*MICRO],['WARRANTY_RESERVE',15n*MICRO]]){
  const fund=active.find(f=>f.code===code);
  let amount=0n;
  if(fund){
   const desired=rounded(total*pct,PCT_BASE);
   const remaining=fund.target>0n?
    (fund.balance>=fund.target?0n:fund.target-fund.balance):desired;
   amount=minimum(desired,remaining);
   if(amount>0n){allocations.push({fundId:fund.id,amountBase:fmt(amount)});allocated+=amount;}
  }
  reservedByFund[code]=fmt(amount);
 }
 const growthPool=total-allocated;
 const growth=active.filter(f=>f.group==='GROWTH'&&f.weight>0n);
 const weightTotal=growth.reduce((s,f)=>s+f.weight,0n);
 if(growthPool>0n&&weightTotal===0n)fail('CAPITAL_B5_NO_ACTIVE_GROWTH_WEIGHTS');
 let growthAllocated=0n;
 growth.forEach((fund,i)=>{
  const remaining=growthPool-growthAllocated;
  let amount=i===growth.length-1?remaining:rounded(growthPool*fund.weight,weightTotal);
  if(amount>remaining)fail('CAPITAL_B5_MICRO_ROUNDING_OVERFLOW');
  if(amount>0n){allocations.push({fundId:fund.id,amountBase:fmt(amount)});growthAllocated+=amount;}
 });
 const totalPlanned=allocated+growthAllocated;
 if(totalPlanned!==total)fail('CAPITAL_B5_SUM_NOT_EXACT');
 const seen=new Set();
 for(const line of allocations){
  if(seen.has(line.fundId))fail('CAPITAL_B5_DUPLICATE_ALLOCATION');
  seen.add(line.fundId);
 }
 return Object.freeze({
  source:'CAPITAL_WATERFALL_SOURCE_PREVIEW',readonly:true,planningOnly:true,
  writerConnected:false,sourceSnapshotVerified:true,
  totalAmountBase:fmt(total),allocations:Object.freeze(allocations.map(x=>Object.freeze(x))),
  reservedByFund:Object.freeze(reservedByFund),
  growthPoolBase:fmt(growthPool),unallocatedBase:'0.000000',
  policy:Object.freeze({
   operatingReserveSharePct:15,warrantyReserveSharePct:15,growthBaseSharePct:70,
   releasedProtectiveShareFlowsToGrowth:true,targetAware:true,
   precision:'MICRO_AMD',growthOrder:'CANONICAL_INPUT_ORDER'
  })
 });
}
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
 const plan=planCapitalWaterfall(financeRecord.amountBase,funds,balances,
  {sourceSnapshotVerified:true});
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
