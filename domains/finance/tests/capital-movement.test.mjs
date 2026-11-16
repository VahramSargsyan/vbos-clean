import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {planCapitalMovement,planCapitalReversal,CapitalMovementError}
 from '../capital-movement.mjs';

const IDA='FND-2026-0001',IDB='FND-2026-0002',IDC='FND-2026-0003';
const IDT='CFT-2026-0007';
const KEY='61028380-d30a-4fc1-9c24-bdeb889dcddb';
const DATE='2026-11-09';
const funds=()=>Object.freeze([
 Object.freeze({fundId:IDA,status:'active'}),
 Object.freeze({fundId:IDB,status:'active'}),
 Object.freeze({fundId:IDC,status:'paused'})
]);
const makeBalance=(fundId,balanceBase,rest={})=>Object.freeze({
 fundId,balanceBase,allocatedBase:0,transferredInBase:0,transferredOutBase:0,
 spentBase:0,transactionCount:0,...rest
});
const balances=()=>Object.freeze([
 makeBalance(IDA,200,{allocatedBase:200,transactionCount:1}),
 makeBalance(IDB,50,{allocatedBase:50,transactionCount:1}),
 makeBalance(IDC,30,{allocatedBase:30,transactionCount:1})
]);
const ctx=(change={})=>Object.freeze({sourceSnapshotVerified:true,...change});
const move=(change={})=>Object.freeze({
 requestKey:KEY,movementType:'TRANSFER',fromFundId:IDA,toFundId:IDB,
 amountBase:60,transactionDateKey:DATE,purpose:'Распределение',...change
});
const original=(change={})=>Object.freeze({
 fundTransactionId:IDT,sourceSystem:'CLEAN_NATIVE_CAPITAL',
 status:'active',movementType:'TRANSFER',fromFundId:IDA,toFundId:IDB,
 amountBase:60,transactionDateKey:DATE,sourceType:'REALLOCATION',
 sourcePeriodKey:'',allocationBatchId:'',reversedByTransactionId:'',
 reversalOfTransactionId:'',...change
});
const reversal=(change={})=>Object.freeze({
 requestKey:KEY,fundTransactionId:IDT,transactionDateKey:DATE,
 reason:'Ошибка в фонде',...change
});
const reverseCtx=(change={})=>ctx({
 originalTransactionVerified:true,reversalLookupVerified:true,
 matchingReversalsCount:0,...change
});
const fail=(func,code)=>assert.throws(func,
 e=>e instanceof CapitalMovementError&&e.code===code);
const byId=(p,id)=>p.nextBalances.find(r=>r.fundId===id);
const effect=(p,id)=>p.effects.find(r=>r.fundId===id);

test('TRANSFER debits one fund, credits the other, preserves total capital',()=>{
 const p=planCapitalMovement(move(),funds(),balances(),ctx());
 assert.equal(p.action,'CREATE_TRANSFER');
 assert.equal(p.record.sourceType,'REALLOCATION');
 assert.equal(p.record.fromFundId,IDA);
 assert.equal(p.record.toFundId,IDB);
 assert.equal(p.record.clientRequestId,KEY);
 assert.equal(p.record.amountBase,'60.000000');
 assert.equal(byId(p,IDA).balanceBase,'140.000000');
 assert.equal(byId(p,IDA).transferredOutBase,'60.000000');
 assert.equal(byId(p,IDB).balanceBase,'110.000000');
 assert.equal(byId(p,IDB).transferredInBase,'60.000000');
 assert.equal(effect(p,IDA).transactionCount,1);
 assert.equal(effect(p,IDB).transactionCount,1);
 assert.equal(p.financeLedgerEffect,'NONE');
 assert.equal(p.writerConnected,false);
});

test('SPEND subtracts cash and increases spent field; paused source allowed',()=>{
 const s=planCapitalMovement(move({movementType:'SPEND',fromFundId:IDC,
  toFundId:'',amountBase:'10.125005'}),funds(),balances(),ctx());
 assert.equal(s.record.sourceType,'FUND_USE');
 assert.equal(s.record.toFundId,'');
 assert.equal(byId(s,IDC).balanceBase,'19.874995');
 assert.equal(byId(s,IDC).spentBase,'10.125005');
 assert.equal(effect(s,IDC).transactionCount,1);
});

test('protects against overdraft and invalid destination including paused and self-transfer',()=>{
 fail(()=>planCapitalMovement(move({amountBase:201}),funds(),balances(),ctx()),
  'CAPITAL_B6_INSUFFICIENT_FUNDS');
 fail(()=>planCapitalMovement(move({toFundId:IDC}),funds(),balances(),ctx()),
  'CAPITAL_B6_DESTINATION_INVALID');
 fail(()=>planCapitalMovement(move({toFundId:IDA}),funds(),balances(),ctx()),
  'CAPITAL_B6_DESTINATION_INVALID');
 fail(()=>planCapitalMovement(move({movementType:'SPEND',amountBase:250,toFundId:''}),
  funds(),balances(),ctx()),'CAPITAL_B6_INSUFFICIENT_FUNDS');
 fail(()=>planCapitalMovement(move({movementType:'SPEND'}),funds(),balances(),ctx()),
  'CAPITAL_B6_SPEND_DESTINATION_FORBIDDEN');
});

test('TRANSFER reversal restores both balances and adjusts cumulative in/out counters',()=>{
 const moved=planCapitalMovement(move(),funds(),balances(),ctx());
 const current=balances().map(b=>moved.nextBalances.find(n=>n.fundId===b.fundId)||b);
 const p=planCapitalReversal(reversal(),original(),funds(),current,reverseCtx());
 assert.equal(p.action,'REVERSE_TRANSFER');
 assert.equal(p.record.movementType,'REVERSAL');
 assert.equal(p.record.reversalOfTransactionId,IDT);
 assert.equal(p.record.sourceType,'REVERSAL');
 assert.equal(byId(p,IDA).balanceBase,'200.000000');
 assert.equal(byId(p,IDB).balanceBase,'50.000000');
 assert.equal(byId(p,IDA).transferredOutBase,'0.000000');
 assert.equal(byId(p,IDB).transferredInBase,'0.000000');
 assert.equal(byId(p,IDA).transactionCount,3);
 assert.equal(byId(p,IDB).transactionCount,3);
 assert.equal(effect(p,IDA).transactionCount,1);
 assert.equal(effect(p,IDB).transactionCount,1);
 assert.equal(p.originalTransition.toStatus,'reversed');
 assert.equal(p.originalTransition.originalLedgerEntryPreserved,true);
});

test('SPEND reversal returns funds without decreasing total transaction counts',()=>{
 const spent=planCapitalMovement(move({movementType:'SPEND',amountBase:40,toFundId:''}),
  funds(),balances(),ctx());
 const current=balances().map(b=>spent.nextBalances.find(n=>n.fundId===b.fundId)||b);
 const originalSpend=original({movementType:'SPEND',toFundId:'',amountBase:40,sourceType:'FUND_USE'});
 const p=planCapitalReversal(reversal(),originalSpend,funds(),current,reverseCtx());
 assert.equal(byId(p,IDA).balanceBase,'200.000000');
 assert.equal(byId(p,IDA).spentBase,'0.000000');
 assert.equal(byId(p,IDA).transactionCount,3);
 assert.equal(p.record.amountBase,'40.000000');
});

test('reversal of spent/transfer asset cannot overdraft subsequent fund spending',()=>{
 const after=balances().map(b=>b.fundId===IDA?{...b,balanceBase:140,transferredOutBase:60}:b.fundId===IDB?{...b,balanceBase:40,transferredInBase:60}:b);
 fail(()=>planCapitalReversal(reversal(),original(),funds(),after,reverseCtx()),
  'CAPITAL_B6_INSUFFICIENT_FUNDS');
});

test('cannot reverse reversal, reversed movement, or linked ALLOCATION out of band',()=>{
 fail(()=>planCapitalReversal(reversal(),original({movementType:'REVERSAL'}),
  funds(),balances(),reverseCtx()),'CAPITAL_B6_CANNOT_REVERSE_REVERSAL');
 fail(()=>planCapitalReversal(reversal(),original({status:'reversed'}),
  funds(),balances(),reverseCtx()),'CAPITAL_B6_ORIGINAL_NOT_REVERSIBLE');
 fail(()=>planCapitalReversal(reversal(),original({reversedByTransactionId:'CFT-2026-0012'}),
  funds(),balances(),reverseCtx()),'CAPITAL_B6_ORIGINAL_NOT_REVERSIBLE');
 fail(()=>planCapitalReversal(reversal(),original({movementType:'ALLOCATION',
  allocationBatchId:'CAB-2026-0001'}),funds(),balances(),reverseCtx()),
  'CAPITAL_B6_ALLOCATION_REQUIRES_BATCH_GATE');
});

test('original movement requires native canonical source and unique reversal check',()=>{
 for(const source of ['LEGACY_GOOGLE','GOOGLE','VERIFIED_LEGACY_FINANCE_CAPITAL_CLEAN_TEST',undefined])
  fail(()=>planCapitalReversal(reversal(),original({sourceSystem:source}),
   funds(),balances(),reverseCtx()),'CAPITAL_B6_HISTORICAL_SOURCE_IMMUTABLE');
 fail(()=>planCapitalReversal(reversal(),original(),funds(),balances(),
  reverseCtx({matchingReversalsCount:1})),'CAPITAL_B6_REVERSAL_LOOKUP_UNVERIFIED');
 fail(()=>planCapitalReversal(reversal(),original(),funds(),balances(),
  reverseCtx({reversalLookupVerified:false})),'CAPITAL_B6_REVERSAL_LOOKUP_UNVERIFIED');
 fail(()=>planCapitalReversal(reversal(),original(),funds(),balances(),
  reverseCtx({originalTransactionVerified:false})),'CAPITAL_B6_REVERSAL_LOOKUP_UNVERIFIED');
});

test('fails closed on incomplete, stale-looking and negative balance source',()=>{
 fail(()=>planCapitalMovement(move(),funds(),balances(),{}),
  'CAPITAL_B6_CANONICAL_SNAPSHOT_REQUIRED');
 fail(()=>planCapitalMovement(move(),funds(),balances().slice(1),ctx()),
  'CAPITAL_B6_SNAPSHOT_INCOMPLETE');
 fail(()=>planCapitalMovement(move(),funds(),[
  ...balances().slice(0,2),{...balances()[2],fundId:IDA}
 ],ctx()),'CAPITAL_B6_BALANCE_INVALID_OR_DUPLICATE');
 fail(()=>planCapitalMovement(move(),funds(),balances().map(x=>x.fundId===IDA?
  {...x,spentBase:-1}:x),ctx()),'CAPITAL_B6_INVALID_MONEY_spentBase');
 fail(()=>planCapitalMovement(move(),funds(),balances().map(x=>x.fundId===IDA?
  {...x,transactionCount:1.5}:x),ctx()),'CAPITAL_B6_COUNT_INVALID');
});

test('payload validation rejects malformed operation, UUID, date, money and extra fields',()=>{
 fail(()=>planCapitalMovement(move({movementType:'ALLOCATION'}),funds(),balances(),ctx()),
  'CAPITAL_B6_TYPE_UNSUPPORTED');
 fail(()=>planCapitalMovement(move({amountBase:'0.000000'}),funds(),balances(),ctx()),
  'CAPITAL_B6_INVALID_MONEY_amountBase');
 fail(()=>planCapitalMovement(move({amountBase:'1.0000001'}),funds(),balances(),ctx()),
  'CAPITAL_B6_INVALID_MONEY_amountBase');
 fail(()=>planCapitalMovement(move({requestKey:'foo'}),funds(),balances(),ctx()),
  'CAPITAL_B6_REQUEST_KEY_INVALID');
 fail(()=>planCapitalMovement(move({transactionDateKey:'2026-02-31'}),funds(),balances(),ctx()),
  'CAPITAL_B6_DATE_INVALID');
 fail(()=>planCapitalMovement(move({status:'active'}),funds(),balances(),ctx()),
  'CAPITAL_B6_EXTRA_FIELDS_FORBIDDEN');
 fail(()=>planCapitalMovement(move({purpose:''}),funds(),balances(),ctx()),
  'CAPITAL_B6_REASON_REQUIRED');
 fail(()=>planCapitalReversal(reversal({amountBase:12}),original(),funds(),
  balances(),reverseCtx()),'CAPITAL_B6_EXTRA_FIELDS_FORBIDDEN');
});

test('native Fund movement effects match pinned exact CapitalService.js function excerpts',()=>{
 const src=readFileSync(new URL('../../../tests/fixtures/legacy/CapitalService.excerpts.js.txt',import.meta.url),'utf8');
 const extract=name=>{
  const i=src.indexOf('function '+name+'(');
  assert.ok(i>=0,name+' missing from original');
  const end=src.indexOf('\nfunction ',i+10);
  return src.slice(i,end<0?src.length:end);
 };
 const legacy=extract('capitalEffectAdd_')+'\n'+extract('capitalTransactionEffects_')+
  '\ncapitalTransactionEffects_(record,original)';
 const types=[
  {record:{movementType:'TRANSFER',amountBase:60,fromFundId:IDA,toFundId:IDB},
   proposed:planCapitalMovement(move(),funds(),balances(),ctx())},
  {record:{movementType:'SPEND',amountBase:30,fromFundId:IDA,toFundId:''},
   proposed:planCapitalMovement(move({movementType:'SPEND',amountBase:30,toFundId:''}),
    funds(),balances(),ctx())},
  {record:{movementType:'REVERSAL',amountBase:60,fromFundId:IDA,toFundId:IDB,
   reversalOfTransactionId:IDT},original:{
    movementType:'TRANSFER',amountBase:60,fromFundId:IDA,toFundId:IDB
   },proposed:planCapitalReversal(reversal(),original(),funds(),
    balances().map(x=>x.fundId===IDA?{...x,balanceBase:140,transferredOutBase:60}:
     x.fundId===IDB?{...x,balanceBase:110,transferredInBase:60}:x),reverseCtx())}
 ];
 for(const {record,original:orig,proposed} of types){
  const old=runInNewContext(legacy,{
   record,original:orig,
   financeRound_:v=>Math.round((Number(v||0)+Number.EPSILON)*1000000)/1000000,
   VBOS_ERROR_CODES:{CAPITAL_VALIDATION:'CAPITAL_VALIDATION'},
   makeVbosError_:()=>new Error('legacy unexpected')
  },{timeout:1000});
  const cmp=Object.fromEntries(proposed.effects.map(x=>[x.fundId,x]));
  assert.deepEqual(Object.keys(cmp).sort(),Object.keys(old).sort());
  for(const [fundId,e] of Object.entries(old)){
   for(const field of ['balanceBase','allocatedBase','transferredInBase','transferredOutBase','spentBase'])
    assert.equal(cmp[fundId][field],Number(e[field]||0).toFixed(6),
     fundId+' '+field);
   assert.equal(cmp[fundId].transactionCount,e.transactionCount);
  }
 }
});

test('pure preview leaves source records unchanged; no created IDs or writes',()=>{
 const fs=funds(),bs=balances(),p=move();
 const originalSource=JSON.stringify({fs,bs,p});
 const planned=planCapitalMovement(p,fs,bs,ctx());
 assert.equal(JSON.stringify({fs,bs,p}),originalSource);
 assert.ok(Object.isFrozen(planned));
 assert.ok(Object.isFrozen(planned.record));
 assert.equal(planned.record.fundTransactionId,undefined);
 assert.equal(planned.planningOnly,true);
 assert.ok(planned.requiredWriterChecks.includes(
  'ATOMIC_MOVEMENT_FUND_BALANCES_ORIGINAL_STATUS_AUDIT'));
});
