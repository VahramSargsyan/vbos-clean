import {test} from 'node:test';
import assert from 'node:assert/strict';
import {financeCapitalArchiveRead,FinanceCapitalArchiveError} from '../finance-capital-archive-api.mjs';
const snapshot='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const batchId='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const make=(kind,id,payload)=>({source_kind:kind,source_id:id,source_payload:payload,sha_valid:true});
function fixture(){
 const expected={FINANCE_TRANSACTION:24,BUSINESS_MONTHLY_GAIN:3,CAPITAL_FUND:8,
  CAPITAL_ALLOCATION_BATCH:1,CAPITAL_FUND_TRANSACTION:6,FINANCE_BALANCE:30,CAPITAL_FUND_BALANCE:8};
 const ids=Array.from({length:8},(_,i)=>'FND-'+(i+1));
 const lines=ids.slice(0,6).map(fundId=>({fundId,amountBase:10}));
 const facts=[
  ...['2026-08','2026-09','2026-10'].map(monthKey=>make('BUSINESS_MONTHLY_GAIN',monthKey,
   {monthKey,status:'active',referralCommissionBase:1,purchaseCommissionBase:1,organizationMarginBase:1,
    taxOptimizationSavingsBase:1,otherBusinessIncomeBase:1,totalBusinessGainsBase:5})),
  ...ids.map(fundId=>make('CAPITAL_FUND',fundId,{fundId,name:'Фонд '+fundId,groupType:'SAVINGS',code:fundId,
    status:'active',targetAmountBase:100,allocationSharePct:12.5,notes:'KEEP_PRIVATE'})),
  make('CAPITAL_ALLOCATION_BATCH','BATCH-001',{allocationBatchId:'BATCH-001',
   allocationsJson:JSON.stringify(lines),totalAmountBase:60,status:'active'}),
  ...lines.map((x,i)=>make('CAPITAL_FUND_TRANSACTION','MOVE-'+i,{fundTransactionId:'MOVE-'+i,
   movementType:'ALLOCATION',toFundId:x.fundId,fromFundId:'',allocationBatchId:'BATCH-001',amountBase:10,status:'active'}))
 ];
 const controls=[
  make('FINANCE_BALANCE','GLOBAL|ALL',{scopeKey:'GLOBAL|ALL',cashBalanceBase:24,profitBase:24,workerPayableBase:0,
   earnedBase:24,receivedBase:24,economicExpenseBase:9,workerPaidBase:8,ownerTransferBase:7}),
  ...Array.from({length:29},(_,i)=>make('FINANCE_BALANCE','OTHER|'+i,{scopeKey:'OTHER|'+i,cashBalanceBase:0,profitBase:0})),
  ...ids.map((fundId,i)=>make('CAPITAL_FUND_BALANCE',fundId,{fundId,balanceBase:i<6?10:0}))
 ];
 const manifest={snapshot_id:snapshot,history_batch_id:batchId,source_system:'LEGACY_GOOGLE',
  google_modified_at:'2026-11-03T19:06:09.263Z',financial_write_authority:'GOOGLE',
  owner_identity_approved:false,expected_counts:expected};
 let queries=[];
 const db={async query(sql,params){
  queries.push(sql);
  if(!/^\s*SELECT\b/i.test(sql))throw Error('Unexpected write in archive reader');
  if(sql.includes('freeze_manifests')){assert.deepEqual(params,[snapshot]);return{rows:[manifest]};}
  if(sql.includes('FROM mvp_finance_stage.source_facts')){assert.deepEqual(params,[snapshot]);return{rows:facts};}
  if(sql.includes('FROM mvp_finance_stage.control_snapshots')){assert.deepEqual(params,[snapshot]);return{rows:controls};}
  if(sql.includes('FROM mvp_history.source_records')){assert.deepEqual(params,[batchId]);return{rows:[{total:24,cash:'24.000000',profit:'24.000000',worker_payable:'0.000000'}]};}
  throw Error('UNKNOWN_QUERY');
 }};
 return {db,facts,controls,manifest,queries};
}
const approved={authorizeOwner:()=>true};
test('complete history uses only owner session, 5 SELECTs, and whitelisted finance/capital fields',async()=>{
 const f=fixture(),result=await financeCapitalArchiveRead(f.db,approved);
 assert.equal(result.readonly,true);
 assert.equal(result.financialWriter,'GOOGLE');
 assert.equal(result.source,'VERIFIED_LEGACY_FINANCE_CAPITAL_CLEAN_TEST');
 assert.equal(result.finance.cashBalanceBase,'24.000000');
 assert.equal(result.finance.economicExpenseBase,'9.000000');
 assert.equal(result.finance.workerPaidBase,'8.000000');
 assert.equal(result.finance.ownerTransferBase,'7.000000');
 assert.equal(result.capital.allocatedBase,'60.000000');
 assert.equal(result.capital.funds.length,8);
 assert.equal(result.capital.movements.length,6);
 assert.equal(result.months.length,3);
 assert.equal(result.months[0].referralCommissionBase,'1.000000');
 assert.equal(result.months[0].purchaseCommissionBase,'1.000000');
 assert.equal(result.months[0].organizationMarginBase,'1.000000');
 assert.equal(result.months[0].taxOptimizationSavingsBase,'1.000000');
 assert.equal(result.months[0].otherBusinessIncomeBase,'1.000000');
 assert.equal(f.queries.length,4);
 assert.equal(JSON.stringify(result).includes('KEEP_PRIVATE'),false);
 assert.equal(JSON.stringify(result).includes('source_payload'),false);
});
test('cannot query without original Clean owner session',async()=>{
 const f=fixture();
 await assert.rejects(financeCapitalArchiveRead(f.db,{authorizeOwner:()=>false}),
  err=>err instanceof FinanceCapitalArchiveError&&err.status===401);
 assert.equal(f.queries.length,0);
});
test('missing or altered finance schema manifest fails closed',async()=>{
 for(const mutate of [f=>{f.manifest.financial_write_authority='CLEAN';},f=>{f.manifest.expected_counts.CAPITAL_FUND=7;},
  f=>{f.manifest.owner_identity_approved=true;}]){
  const f=fixture();mutate(f);
  await assert.rejects(financeCapitalArchiveRead(f.db,approved),{status:503});
 }
});
test('source row gaps and SHA mismatch fail closed',async()=>{
 const f1=fixture();f1.facts.pop();await assert.rejects(financeCapitalArchiveRead(f1.db,approved),{status:503});
 const f2=fixture();f2.controls[0].sha_valid=false;await assert.rejects(financeCapitalArchiveRead(f2.db,approved),{status:503});
});
test('balance drift, movement drift and month sum drift fail closed',async()=>{
 for(const mutate of [f=>{f.controls[0].source_payload.cashBalanceBase=999;},
  f=>{f.facts.find(x=>x.source_kind==='CAPITAL_FUND_TRANSACTION').source_payload.amountBase=99;},
  f=>{f.facts.find(x=>x.source_kind==='BUSINESS_MONTHLY_GAIN').source_payload.totalBusinessGainsBase=999;} ]){
  const f=fixture();mutate(f);await assert.rejects(financeCapitalArchiveRead(f.db,approved),{status:503});
 }
});
