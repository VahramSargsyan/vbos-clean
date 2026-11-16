import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {planCapitalWaterfall,prepareNewFinanceInvestmentAllocation,
 CapitalWaterfallError} from '../capital-waterfall.mjs';
const createFund=(id,code,groupType,allocationSharePct=0,targetAmountBase=0,status='active')=>
 Object.freeze({fundId:id,code,groupType,allocationSharePct,targetAmountBase,status});
const funds=()=>Object.freeze([
 createFund('FND-2026-0001','OPERATING_RESERVE','PROTECTIVE',0,2000000),
 createFund('FND-2026-0002','WARRANTY_RESERVE','PROTECTIVE',0,1000000),
 createFund('FND-2026-0003','MARKETING_SALES','GROWTH',20),
 createFund('FND-2026-0004','PEOPLE_TRAINING','GROWTH',30),
 createFund('FND-2026-0005','EQUIPMENT','GROWTH',50)
]);
const balances=(overrides={})=>Object.freeze(funds().map(f=>Object.freeze({
 fundId:f.fundId,balanceBase:overrides[f.fundId]??0
})));
const plan=(total=100000,fs=funds(),bs=balances(),ctx={sourceSnapshotVerified:true})=>
 planCapitalWaterfall(total,fs,bs,ctx);
const bad=(fn,code)=>assert.throws(fn,
 e=>e instanceof CapitalWaterfallError&&e.code===code);
const amounts=p=>p.allocations.map(a=>[a.fundId,a.amountBase]);
const sum=rows=>rows.reduce((x,r)=>x+BigInt(r.amountBase.replace('.','')),0n);

test('15/15/70 original policy with full reserves exactly reconciles six-decimal money',()=>{
 const p=plan(100000);
 assert.equal(p.totalAmountBase,'100000.000000');
 assert.deepEqual(amounts(p),[
  ['FND-2026-0001','15000.000000'],['FND-2026-0002','15000.000000'],
  ['FND-2026-0003','14000.000000'],['FND-2026-0004','21000.000000'],
  ['FND-2026-0005','35000.000000']]);
 assert.deepEqual({...p.reservedByFund},{OPERATING_RESERVE:'15000.000000',
  WARRANTY_RESERVE:'15000.000000'});
 assert.equal(p.growthPoolBase,'70000.000000');
 assert.equal(sum(p.allocations),100000000000n);
 assert.equal(p.unallocatedBase,'0.000000');
 assert.equal(p.policy.targetAware,true);
 assert.equal(p.writerConnected,false);
});

test('target-capped protective funds release unused percentages to growth',()=>{
 const bs=balances({'FND-2026-0001':1999900,'FND-2026-0002':999950});
 const p=plan(100000,funds(),bs);
 assert.deepEqual(amounts(p),[
  ['FND-2026-0001','100.000000'],['FND-2026-0002','50.000000'],
  ['FND-2026-0003','19970.000000'],['FND-2026-0004','29955.000000'],
  ['FND-2026-0005','49925.000000']]);
 assert.equal(p.growthPoolBase,'99850.000000');
 assert.equal(sum(p.allocations),100000000000n);
});

test('full targets, paused and archived funds never receive new allocation',()=>{
 const capped=plan(100000,funds(),balances({
  'FND-2026-0001':2000000,'FND-2026-0002':1000000
 }));
 assert.deepEqual(amounts(capped),[
  ['FND-2026-0003','20000.000000'],
  ['FND-2026-0004','30000.000000'],
  ['FND-2026-0005','50000.000000']]);
 const modified=funds().map(f=>f.code==='OPERATING_RESERVE'?
  {...f,status:'paused'}:f.code==='MARKETING_SALES'?{...f,status:'archived'}:f);
 const p=plan(100000,modified,balances());
 assert.deepEqual(amounts(p),[
  ['FND-2026-0002','15000.000000'],
  ['FND-2026-0004','31875.000000'],
  ['FND-2026-0005','53125.000000']]);
 assert.equal(p.reservedByFund.OPERATING_RESERVE,'0.000000');
});

test('growth weight normalization works if weights do not add to 100%',()=>{
 const varied=funds().map(f=>f.groupType==='GROWTH'?{...f,allocationSharePct:
  f.code==='MARKETING_SALES'?10:f.code==='PEOPLE_TRAINING'?20:40}:f);
 const p=plan(700,varied,balances());
 assert.deepEqual(p.allocations.map(x=>x.amountBase),[
  '105.000000','105.000000','70.000000','140.000000','280.000000']);
 assert.equal(sum(p.allocations),700000000n);
});

test('checks against pinned verbatim original CapitalService.js functions',()=>{
 // Execute exact source-frozen function excerpts, not Clean implementation or an invented formula.
 const source=readFileSync(new URL('../../../tests/fixtures/legacy/CapitalService.excerpts.js.txt',import.meta.url),'utf8');
 const extract=name=>{
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'Missing original '+name);
  const end=source.indexOf('\nfunction ',start+10);
  return source.slice(start,end<0?source.length:end);
 };
 const legacy=extract('capitalPolicyShareForFund_')+'\n'+
  extract('capitalWaterfallAllocationsUnlocked_')+'\n'+
  'capitalWaterfallAllocationsUnlocked_(total)';
 const fixtures=[
  [100000,funds(),balances()],
  [100000,funds(),balances({'FND-2026-0001':1999900,'FND-2026-0002':999950})],
  [100000,funds().map(f=>f.code==='OPERATING_RESERVE'?{...f,status:'paused'}:f),balances()],
  [100000,funds(),balances({'FND-2026-0001':2000000,'FND-2026-0002':1000000})],
  [10000.000001,funds(),balances()]
 ];
 for(const [total,fs,bs] of fixtures){
  const lookup=new Map(bs.map(b=>[b.fundId,b]));
  const context={
   total,VBOS_CONFIG:{CAPITAL_OPERATING_RESERVE_SHARE_PCT:15,
    CAPITAL_WARRANTY_RESERVE_SHARE_PCT:15},
   VBOS_ERROR_CODES:{CAPITAL_VALIDATION:'CAPITAL_VALIDATION'},
   capitalMoneyNumber_:(v)=>Number(v),
   financeRound_:(v)=>Math.round((Number(v||0)+Number.EPSILON)*1000000)/1000000,
   listRecentRecords_:()=>({items:fs.filter(f=>f.status!=='archived')}),
   getCapitalFundBalanceRecord_:(fundId)=>lookup.get(fundId)||{balanceBase:0},
   makeVbosError_:(_code,_message,details)=>new Error(details)
  };
  const old=runInNewContext(legacy,context,{timeout:1000});
  const modern=plan(total,fs,bs);
  const oldLines=Array.from(old.allocations,x=>[x.fundId,Number(x.amountBase).toFixed(6)]);
  const newLines=amounts(modern);
  assert.deepEqual(newLines,oldLines,'original source disagreement: '+total);
  assert.equal(modern.totalAmountBase,Number(old.totalAmountBase).toFixed(6));
 }
});

test('strict snapshot completeness and duplicate/corrupt fund records fail closed',()=>{
 bad(()=>plan(100000,funds(),balances(),{}),'CAPITAL_B5_CANONICAL_SNAPSHOT_REQUIRED');
 bad(()=>plan(100000,funds(),balances().slice(1)),'CAPITAL_B5_BALANCE_LIST_INCOMPLETE');
 bad(()=>plan(100000,[...funds(),funds()[0]],
  [...balances(),balances()[0]]),'CAPITAL_B5_BALANCE_DUPLICATE_OR_INVALID');
 bad(()=>plan(100000,[...funds(),{...funds()[0],fundId:'FND-2026-0999'}],
  [...balances(),{fundId:'FND-2026-0999',balanceBase:0}]),
  'CAPITAL_B5_FUND_ID_OR_CODE_INVALID');
 bad(()=>plan(100000,[...funds().slice(0,1),{...funds()[1],code:'OPERATING_RESERVE'},
  ...funds().slice(2)],balances()),'CAPITAL_B5_FUND_ID_OR_CODE_INVALID');
 bad(()=>plan(100000,funds().map(f=>f.code==='OPERATING_RESERVE'?
  {...f,groupType:'GROWTH'}:f),balances()),'CAPITAL_B5_PROTECTIVE_GROUP_INVALID');
 bad(()=>plan(100000,funds().map(f=>f.code==='MARKETING_SALES'?
  {...f,allocationSharePct:101}:f),balances()),'CAPITAL_B5_PERCENT_OUT_OF_RANGE_allocationSharePct');
 bad(()=>plan(100000,funds(),balances({'FND-2026-0002':-1})),'CAPITAL_B5_INVALID_balanceBase');
 bad(()=>plan(100000,funds(),balances().map(b=>b.fundId==='FND-2026-0002'?
  {...b,fundId:'FND-2026-9999'}:b)),'CAPITAL_B5_FUND_STATUS_OR_BALANCE_INVALID');
});

test('no active growth weight is a hard error even if protective reserve exists',()=>{
 const fs=funds().map(f=>f.groupType==='GROWTH'?{...f,status:'paused'}:f);
 bad(()=>plan(100000,fs,balances()),'CAPITAL_B5_NO_ACTIVE_GROWTH_WEIGHTS');
});

test('money shape, negative, zero, precision and malformed values rejected',()=>{
 for(const badVal of [0,-2,'1.1234567','0.000000','1e5','Infinity','abc',null])
  bad(()=>plan(badVal),'CAPITAL_B5_INVALID_totalAmountBase');
});

const finance=(override={})=>Object.freeze({
 financeTransactionId:'FIN-2026-0100',sourceSystem:'CLEAN_NATIVE_FINANCE',
 operationType:'OWNER_TRANSFER',ownerDirection:'investments',status:'active',
 transactionDate:'2026-11-09',transactionDateKey:'2026-11-09',
 amountBase:100000,...override
});
const newCtx=(overrides={})=>({
 newFinancePostVerified:true,sourceSnapshotVerified:true,
 finCapLookupVerified:true,existingFinCapBatchCount:0,...overrides
});

test('new native investment projects deterministic FINCAP and allocation line keys only',()=>{
 const p=prepareNewFinanceInvestmentAllocation(finance(),funds(),balances(),newCtx());
 assert.equal(p.clientRequestId,'FINCAP|FIN-2026-0100');
 assert.equal(p.sourceType,'OPERATING_PROFIT');
 assert.equal(p.transactionDateKey,'2026-11-09');
 assert.equal(p.sourcePeriodKey,'2026-11');
 assert.deepEqual([...p.movementRequestKeys],p.allocations.map(x=>p.clientRequestId+'|ALLOC|'+x.fundId));
 assert.equal(p.historicalSourcePreserved,true);
 assert.equal(p.planningOnly,true);
 assert.equal(p.writerConnected,false);
 assert.equal(Object.isFrozen(p),true);
});

test('existing linked, unverified, historical and malformed investments cannot post',()=>{
 bad(()=>prepareNewFinanceInvestmentAllocation(finance(),funds(),balances(),
  newCtx({existingFinCapBatchCount:1})),'CAPITAL_B5_FINCAP_BATCH_EXISTS_OR_UNKNOWN');
 bad(()=>prepareNewFinanceInvestmentAllocation(finance(),funds(),balances(),
  newCtx({existingFinCapBatchCount:2})),'CAPITAL_B5_FINCAP_BATCH_EXISTS_OR_UNKNOWN');
 bad(()=>prepareNewFinanceInvestmentAllocation(finance(),funds(),balances(),
  newCtx({newFinancePostVerified:false})),'CAPITAL_B5_AUTHORITATIVE_CREATION_PROOF_REQUIRED');
 bad(()=>prepareNewFinanceInvestmentAllocation(finance(),funds(),balances(),
  newCtx({finCapLookupVerified:false})),'CAPITAL_B5_AUTHORITATIVE_CREATION_PROOF_REQUIRED');
 for(const source of ['LEGACY_GOOGLE','GOOGLE','VERIFIED_LEGACY_FINANCE_CAPITAL_CLEAN_TEST'])
  bad(()=>prepareNewFinanceInvestmentAllocation(finance({sourceSystem:source}),
   funds(),balances(),newCtx()),'CAPITAL_B5_LEGACY_FINANCE_IMMUTABLE');
 for(const part of [
  {ownerDirection:'home'},{operationType:'EXPENSE'},{status:'archived'},
  {transactionDate:'2026-11-08'},{transactionDateKey:'2026-02-30'}
 ]){
  bad(()=>prepareNewFinanceInvestmentAllocation(finance(part),funds(),balances(),
   newCtx()),'CAPITAL_B5_NOT_NEW_ACTIVE_INVESTMENT');
 }
});

test('does not mutate passed arrays, records, money balances or any datastore',()=>{
 const fs=funds(),bs=balances(),f=finance();
 const original=JSON.stringify([fs,bs,f]);
 const p=prepareNewFinanceInvestmentAllocation(f,fs,bs,newCtx());
 assert.equal(JSON.stringify([fs,bs,f]),original);
 assert.equal(p.totalAmountBase,'100000.000000');
 assert.ok(p.requiredWriterChecks.includes('ATOMIC_FINANCE_CAPITAL_LINES_BALANCES_AUDIT'));
});
