import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {financeReviewRead,financeReviewAction,FinanceReviewError} from '../finance-review.mjs';
const SNAP='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const BATCH='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const kinds=['FINANCE_TRANSACTION','BUSINESS_MONTHLY_GAIN','CAPITAL_FUND','CAPITAL_ALLOCATION_BATCH','CAPITAL_FUND_TRANSACTION'];
function fixture(){
 const fundIds=Array.from({length:8},(_,i)=>'FND-'+(i+1));
 const allocations=fundIds.slice(0,6).map(fundId=>({fundId,amountBase:10}));
 const st=(kind,id,payload)=>({source_kind:kind,source_id:id,source_payload:payload,source_status:payload.status||'active',payload_sha256:'0'.repeat(64),sha_valid:true});
 const src=[
  ...['2026-08','2026-09','2026-10'].map(monthKey=>st('BUSINESS_MONTHLY_GAIN',monthKey,{monthKey,status:'active',
   referralCommissionBase:1,purchaseCommissionBase:1,organizationMarginBase:1,
   taxOptimizationSavingsBase:1,otherBusinessIncomeBase:1,totalBusinessGainsBase:5})),
  ...fundIds.map(id=>st('CAPITAL_FUND',id,{fundId:id,name:'Fund '+id,status:'active',targetAmountBase:100,code:id})),
  st('CAPITAL_ALLOCATION_BATCH','BATCH-1',{allocationBatchId:'BATCH-1',allocationsJson:JSON.stringify(allocations),totalAmountBase:60,status:'applied'}),
  ...allocations.map((p,i)=>st('CAPITAL_FUND_TRANSACTION','MOVE-'+i,{fundTransactionId:'MOVE-'+i,amountBase:10,movementType:'ALLOCATION',toFundId:p.fundId,fromFundId:'',allocationBatchId:'BATCH-1',status:'active'}))
 ];
 const controls=[
  st('FINANCE_BALANCE','GLOBAL|ALL',{scopeKey:'GLOBAL|ALL',cashBalanceBase:24,profitBase:24,workerPayableBase:0,earnedBase:24,receivedBase:24,economicExpenseBase:9,workerPaidBase:8,ownerTransferBase:7}),
  ...Array.from({length:29},(_,i)=>st('FINANCE_BALANCE','OTHER|'+i,{scopeKey:'OTHER|'+i,cashBalanceBase:0,profitBase:0})),
  ...fundIds.map((fundId,i)=>st('CAPITAL_FUND_BALANCE',fundId,{fundId,balanceBase:i<6?10:0}))
 ];
 const finance=Array.from({length:24},(_,i)=>({source_kind:'FINANCE_TRANSACTION',source_id:'FIN-'+(i+1),
  source_payload:{operationType:'INCOME',amountBase:'1',status:'active',notes:'SECRET'},
  source_status:'active',payload_sha256:'0'.repeat(64)}));
 const manifest={snapshot_id:SNAP,history_batch_id:BATCH,source_system:'LEGACY_GOOGLE',
  google_modified_at:'2026-11-03T19:06:09.263Z',financial_write_authority:'GOOGLE',
  owner_identity_approved:false,expected_counts:{FINANCE_TRANSACTION:24,BUSINESS_MONTHLY_GAIN:3,
   CAPITAL_FUND:8,CAPITAL_ALLOCATION_BATCH:1,CAPITAL_FUND_TRANSACTION:6,FINANCE_BALANCE:30,CAPITAL_FUND_BALANCE:8}};
 const states=new Map(),events=new Map(),commands=[];
 const simple=async(sql,p=[])=>{
  commands.push(sql);
  if(sql.includes('freeze_manifests'))return{rows:[manifest]};
  if(sql.includes('mvp_finance_stage.source_facts')){
   return{rows:sql.includes('sha_valid')?src:sql.includes('source_kind=$2')?src.filter(x=>x.source_kind===p[1]&&x.source_id===p[2]):src};
  }
  if(sql.includes('mvp_finance_stage.control_snapshots'))return{rows:controls};
  if(sql.includes('mvp_history.source_records')){
   if(sql.includes('COUNT(*)'))return{rows:[{total:24,cash:'24.000000',profit:'24.000000',worker_payable:'0.000000'}]};
   if(sql.includes('source_id=$2'))return{rows:finance.filter(x=>x.source_id===p[1])};
   return{rows:finance};
  }
  if(sql.includes('mvp_finance_history_review_events')){
   if(sql.startsWith('SELECT'))return{rows:events.has(p[0])?[events.get(p[0])]:[]};
   let response=JSON.parse(p[9]);events.set(p[0],{payload_sha256:p[1],response});return{rows:[]};
  }
  if(sql.includes('mvp_finance_history_review')){
   if(sql.startsWith('SELECT')&&sql.includes('LIMIT'))return{rows:[...states.values()]};
   if(sql.startsWith('SELECT'))return{rows:states.has(p[0]+':'+p[1])?[states.get(p[0]+':'+p[1])]:[]};
   if(sql.startsWith('INSERT')){
    const key=p[0]+':'+p[1],old=states.get(key),row={source_kind:p[0],source_id:p[1],review_state:p[2],
      revision:(old?.revision||0)+1,updated_at:'2026-11-06T00:00:00Z'};
    states.set(key,row);return{rows:[row]};
   }
  }
  if(sql.includes('mvp_settings'))return{rows:[{setting_value:'owner-ci'}]};
  if(/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory_xact_lock)/.test(sql))return{rows:[]};
  throw Error('UNRECOGNIZED_QUERY '+sql.slice(0,80));
 };
 const pool={query:simple,async connect(){return{query:simple,release(){}};}};
 return {pool,states,events,commands,src,controls,finance,manifest};
}
const owner={authorizeOwner:()=>true};
test('owner sees 42 source rows, no notes or personal source payload, 5 kind types',async()=>{
 const f=fixture(),r=await financeReviewRead(f.pool,owner);
 assert.equal(r.total,42);assert.equal(r.items.length,42);
 assert.equal(r.financialWriter,'GOOGLE');assert.equal(r.moneyAffectedByArchive,false);
 assert.equal(r.items.filter(x=>x.sourceKind==='FINANCE_TRANSACTION').length,24);
 assert.equal(JSON.stringify(r).includes('SECRET'),false);
 assert.equal(r.items.find(x=>x.sourceKind==='CAPITAL_ALLOCATION_BATCH').sourceStatus,'applied');
});
test('unauthorized GET and POST query nothing',async()=>{
 const f=fixture();await assert.rejects(financeReviewRead(f.pool,{authorizeOwner:()=>false}),{status:401});
 await assert.rejects(financeReviewAction(f.pool,{}, {authorizeOwner:()=>false}),{status:401});
 assert.equal(f.commands.length,0);
});
test('owner review, archive, restore and idempotent replay preserve source balances',async()=>{
 const f=fixture(),sourceId='FIN-1',sourceKind='FINANCE_TRANSACTION';
 const p={sourceKind,sourceId,revision:0,nextState:'REVIEWED',requestKey:randomUUID()};
 const first=await financeReviewAction(f.pool,p,owner);
 assert.equal(first.saved,true);assert.equal(first.item.revision,1);assert.equal(first.moneyAffectedByArchive,false);
 assert.equal(f.events.size,1);
 const replay=await financeReviewAction(f.pool,p,owner);
 assert.equal(replay.deduplicated,true);assert.equal(f.events.size,1);
 const archived=await financeReviewAction(f.pool,{...p,revision:1,nextState:'ARCHIVED',confirmed:'yes',requestKey:randomUUID()},owner);
 assert.equal(archived.item.reviewState,'ARCHIVED');assert.equal(archived.item.revision,2);
 assert.equal((await financeReviewRead(f.pool,owner)).counts.archived,1);
 const restored=await financeReviewAction(f.pool,{...p,revision:2,nextState:'UNREVIEWED',requestKey:randomUUID()},owner);
 assert.equal(restored.item.revision,3);assert.equal(restored.item.reviewState,'UNREVIEWED');
 assert.equal(f.finance[0].source_status,'active');assert.equal(f.finance[0].source_payload.amountBase,'1');
 assert.equal(f.events.size,3);assert.ok(f.commands.every(x=>!/^UPDATE .*mvp_history|^UPDATE .*source_facts/i.test(x)));
});
test('reject stale revision, reused key, missing source and missing archive confirmation',async()=>{
 const f=fixture(),p={sourceKind:'CAPITAL_FUND',sourceId:'FND-1',revision:0,nextState:'REVIEWED',requestKey:randomUUID()};
 await financeReviewAction(f.pool,p,owner);
 await assert.rejects(financeReviewAction(f.pool,{...p,requestKey:randomUUID()},owner),{status:409});
 await assert.rejects(financeReviewAction(f.pool,{...p,nextState:'ARCHIVED',revision:1,confirmed:'yes'},owner),{status:409});
 await assert.rejects(financeReviewAction(f.pool,{...p,nextState:'ARCHIVED',revision:1,requestKey:randomUUID()},owner),{status:400});
 await assert.rejects(financeReviewAction(f.pool,{...p,sourceId:'FAKE',requestKey:randomUUID()},owner),{status:404});
});
test('invalid source count/financial authority abort before review writes',async()=>{
 const f=fixture();f.manifest.financial_write_authority='CLEAN';
 await assert.rejects(financeReviewAction(f.pool,{sourceKind:'CAPITAL_FUND',sourceId:'FND-1',revision:0,
  nextState:'REVIEWED',requestKey:randomUUID()},owner));
 assert.equal(f.states.size,0);
});
