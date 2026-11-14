import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {financeCorrectionRead,financeCorrectionAction,FinanceCorrectionError} from '../finance-corrections.mjs';

function fixture(){
 const ids=Array.from({length:8},(_,i)=>'FND-'+(i+1));
 const lines=ids.slice(0,6).map(fundId=>({fundId,amountBase:10}));
 const mk=(kind,id,p)=>({source_kind:kind,source_id:id,source_status:p.status||'active',
  source_payload:p,payload_sha256:'a'.repeat(64),sha_valid:true});
 const finance=Array.from({length:24},(_,i)=>mk('FINANCE_TRANSACTION','FIN-'+(i+1),{
  operationType:'INCOME',amountBase:1,status:'active',notes:'ORIGINAL_PRIVATE',cashEffectBase:1,profitEffectBase:1,workerPayableEffectBase:0
 }));
 const facts=[
  ...['2026-08','2026-09','2026-10'].map(monthKey=>mk('BUSINESS_MONTHLY_GAIN',monthKey,{
   monthKey,status:'active',referralCommissionBase:1,purchaseCommissionBase:1,organizationMarginBase:1,
   taxOptimizationSavingsBase:1,otherBusinessIncomeBase:1,totalBusinessGainsBase:5
  })),
  ...ids.map(fundId=>mk('CAPITAL_FUND',fundId,{fundId,name:'Fund '+fundId,code:fundId,status:'active',targetAmountBase:100})),
  mk('CAPITAL_ALLOCATION_BATCH','BATCH-1',{allocationBatchId:'BATCH-1',
   allocationsJson:JSON.stringify(lines),totalAmountBase:60,status:'applied'}),
  ...lines.map((r,i)=>mk('CAPITAL_FUND_TRANSACTION','MOVE-'+i,{fundTransactionId:'MOVE-'+i,
   toFundId:r.fundId,fromFundId:'',allocationBatchId:'BATCH-1',amountBase:10,movementType:'ALLOCATION',status:'active'}))
 ];
 const controls=[
  mk('FINANCE_BALANCE','GLOBAL|ALL',{scopeKey:'GLOBAL|ALL',cashBalanceBase:24,profitBase:24,workerPayableBase:0,earnedBase:24,receivedBase:24,economicExpenseBase:9,workerPaidBase:8,ownerTransferBase:7}),
  ...Array.from({length:29},(_,i)=>mk('FINANCE_BALANCE','OTHER|'+i,{scopeKey:'OTHER|'+i})),
  ...ids.map((fundId,i)=>mk('CAPITAL_FUND_BALANCE',fundId,{fundId,balanceBase:i<6?10:0}))
 ];
 const expected={FINANCE_TRANSACTION:24,BUSINESS_MONTHLY_GAIN:3,CAPITAL_FUND:8,
  CAPITAL_ALLOCATION_BATCH:1,CAPITAL_FUND_TRANSACTION:6,FINANCE_BALANCE:30,CAPITAL_FUND_BALANCE:8};
 const man={snapshot_id:'FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1',
  history_batch_id:'FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1',source_system:'LEGACY_GOOGLE',
  financial_write_authority:'GOOGLE',owner_identity_approved:false,expected_counts:expected};
 const overrides=new Map(),events=new Map(),commands=[];
 const query=async(sql,args=[])=>{
  commands.push(sql);
  if(sql.includes('freeze_manifests'))return{rows:[man]};
  if(sql.includes('mvp_finance_stage.control_snapshots'))return{rows:controls};
  if(sql.includes('mvp_finance_stage.source_facts'))return{rows:facts};
  if(sql.includes('mvp_history.source_records')){
   if(sql.includes('COUNT(*)'))return{rows:[{total:24,cash:'24',profit:'24',worker_payable:'0'}]};
   return{rows:finance};
  }
  if(sql.includes('mvp_finance_history_review_events'))return{rows:[]};
  if(sql.includes('mvp_finance_history_review'))return{rows:[]};
  if(sql.includes('mvp_finance_history_correction_events')){
   if(sql.startsWith('SELECT'))return{rows:events.has(args[0])?[events.get(args[0])]:[]};
   const response=JSON.parse(args[11]);events.set(args[0],{payload_sha256:args[1],response});
   return{rows:[]};
  }
  if(sql.includes('mvp_finance_history_corrections')){
   if(sql.startsWith('SELECT')&&sql.includes('LIMIT'))return{rows:[...overrides.values()]};
   if(sql.startsWith('SELECT'))return{rows:overrides.has(args[0]+':'+args[1])?[overrides.get(args[0]+':'+args[1])]:[]};
   if(sql.startsWith('INSERT')){
    const key=args[0]+':'+args[1],old=overrides.get(key);
    const record={source_kind:args[0],source_id:args[1],display_title:args[2],owner_note:args[3],
     revision:(old?.revision||0)+1,updated_at:'2026-11-06T00:00:00Z'};
    overrides.set(key,record);return{rows:[record]};
   }
  }
  if(sql.includes('mvp_settings'))return{rows:[{setting_value:'ci-owner'}]};
  if(/^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory_xact_lock)/.test(sql))return{rows:[]};
  throw Error('UNMOCKED_SQL '+sql.slice(0,90));
 };
 const pool={query,async connect(){return{query,release(){}};}};
 return{pool,overrides,events,commands,finance,facts,controls,man};
}
const owner={authorizeOwner:()=>true};
const input=(override={})=>({sourceKind:'FINANCE_TRANSACTION',sourceId:'FIN-1',revision:0,
 displayTitle:'Исправленная операция',ownerNote:'Только моя заметка',requestKey:randomUUID(),...override});

test('42 finance/capital records are listed with only the two editable fields, no source secrets',async()=>{
 const f=fixture(),result=await financeCorrectionRead(f.pool,owner);
 assert.equal(result.total,42);assert.equal(result.items.length,42);
 assert.deepEqual(result.editableFields,['displayTitle','ownerNote']);
 assert.equal(result.financialWriter,'GOOGLE');assert.equal(result.moneyAffected,false);
 assert.equal(JSON.stringify(result).includes('ORIGINAL_PRIVATE'),false);
 assert.equal(result.items.find(x=>x.sourceId==='FIN-1').amountBase,'1');
 assert.equal(result.corrected,0);
});
test('all SQL is blocked before owner authorization',async()=>{
 const f=fixture();
 await assert.rejects(financeCorrectionRead(f.pool,{authorizeOwner:()=>false}),{status:401});
 await assert.rejects(financeCorrectionAction(f.pool,input(),{authorizeOwner:()=>false}),{status:401});
 assert.equal(f.commands.length,0);
});
test('correct name/comment, replay, reject stale revision, and restore original display',async()=>{
 const f=fixture(),first=input();
 const result=await financeCorrectionAction(f.pool,first,owner);
 assert.equal(result.saved,true);assert.equal(result.moneyAffected,false);
 assert.equal(result.item.revision,1);assert.equal(f.overrides.size,1);assert.equal(f.events.size,1);
 assert.equal((await financeCorrectionRead(f.pool,owner)).corrected,1);
 const retry=await financeCorrectionAction(f.pool,first,owner);
 assert.equal(retry.deduplicated,true);assert.equal(f.events.size,1);
 await assert.rejects(financeCorrectionAction(f.pool,input({revision:0}),owner),{status:409});
 await assert.rejects(financeCorrectionAction(f.pool,input({requestKey:first.requestKey,displayTitle:'Подмена'}),owner),{status:409});
 const undo=await financeCorrectionAction(f.pool,input({revision:1,displayTitle:'',ownerNote:''}),owner);
 assert.equal(undo.item.displayTitle,null);assert.equal(undo.item.ownerNote,null);
 assert.equal(undo.item.revision,2);assert.equal(f.events.size,2);
 assert.equal((await financeCorrectionRead(f.pool,owner)).corrected,0);
 assert.equal(f.finance[0].source_payload.amountBase,1);
 assert.equal(f.finance[0].source_payload.notes,'ORIGINAL_PRIVATE');
 assert.ok(f.commands.every(q=>!/^UPDATE.*(source_records|source_facts|control_snapshots)/i.test(q)));
});
test('invalid, stale, extra financial fields, missing source and failed source authority are rejected',async()=>{
 const f=fixture();
 await assert.rejects(financeCorrectionAction(f.pool,input({sourceId:'MISSING'}),owner),{status:404});
 await assert.rejects(financeCorrectionAction(f.pool,input({amountBase:999}),owner),{status:400});
 await assert.rejects(financeCorrectionAction(f.pool,input({ownerNote:'x'.repeat(1001)}),owner),{status:400});
 await assert.rejects(financeCorrectionAction(f.pool,input({displayTitle:'\u0000'}),owner),{status:400});
 await assert.rejects(financeCorrectionAction(f.pool,input({requestKey:'not-a-uuid'}),owner),{status:400});
 assert.equal(f.overrides.size,0);
 f.man.financial_write_authority='CLEAN';
 await assert.rejects(financeCorrectionAction(f.pool,input(),owner),{status:503});
 assert.equal(f.events.size,0);
});
