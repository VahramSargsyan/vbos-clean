import {test} from 'node:test';
import assert from 'node:assert/strict';
import {financeCorrectionAuditRead} from '../finance-corrections.mjs';
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
const row=(id,kind='FINANCE_TRANSACTION',source='FIN-1')=>({
 event_id:String(id),source_kind:kind,source_id:source,
 source_snapshot_id:kind==='FINANCE_TRANSACTION'?'FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1':
  'FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1',
 prior_title:null,next_title:'Мой заголовок',prior_note:null,next_note:'Моя заметка',
 revision:1,actor_login:'ci-owner',recorded_at:new Date('2026-11-06T11:30:00.000Z')
});
function withEvents(f,rows){
 const q=f.pool.query;let calls=0;
 f.pool.query=async(sql,args=[])=>{
  if(sql.includes('event_id::text AS event_id')){
   calls++;
   const subset=rows.filter(x=>args[0].includes(x.source_kind)&&
     (args[1]===null||BigInt(x.event_id)<BigInt(args[1])));
   return {rows:subset.sort((a,b)=>Number(b.event_id)-Number(a.event_id)).slice(0,args[2])};
  }
  return q(sql,args);
 };
 return()=>calls;
}
test('owner-only before SQL, invalid mode/cursor/limit rejected before read',async()=>{
 const f=fixture();withEvents(f,[row(1)]);
 await assert.rejects(financeCorrectionAuditRead(f.pool,new URL('http://local/?mode=finance'),
  {authorizeOwner:()=>false}),{status:401});
 assert.equal(f.commands.length,0);
 await assert.rejects(financeCorrectionAuditRead(f.pool,new URL('http://local/?mode=bad'),owner),{status:400});
 await assert.rejects(financeCorrectionAuditRead(f.pool,new URL('http://local/?cursor=0'),owner),{status:400});
 await assert.rejects(financeCorrectionAuditRead(f.pool,new URL('http://local/?cursor=9223372036854775808'),owner),{status:400});
 await assert.rejects(financeCorrectionAuditRead(f.pool,new URL('http://local/?limit=100'),owner),{status:400});
 assert.equal(f.commands.length,0);
});
test('source-verified audit reads exactly one page, keyset pagination without writes',async()=>{
 const f=fixture(),counts=withEvents(f,[row(11),row(10),row(9)]);
 const p=await financeCorrectionAuditRead(f.pool,new URL('http://local/?mode=finance&limit=2'),owner);
 assert.equal(p.source,'VERIFIED_FINANCE_CORRECTION_AUDIT');
 assert.deepEqual(p.events.map(e=>e.eventId),['11','10']);
 assert.equal(p.hasMore,true);assert.equal(p.nextCursor,'10');
 assert.equal(p.financialWriter,'GOOGLE');assert.equal(p.moneyAffected,false);
 assert.equal(p.events[0].actorLogin,'ci-owner');
 assert.equal(Object.hasOwn(p.events[0],'requestKey'),false);
 const p2=await financeCorrectionAuditRead(f.pool,new URL('http://local/?mode=finance&limit=2&cursor=10'),owner);
 assert.deepEqual(p2.events.map(e=>e.eventId),['9']);
 assert.equal(p2.hasMore,false);assert.equal(p2.nextCursor,null);
 assert.equal(counts(),2);
 assert.ok(f.commands.every(q=>!/\b(?:UPDATE|DELETE|INSERT)\b/i.test(q)));
});
test('finance and capital events never mix and keep original source title',async()=>{
 const f=fixture();withEvents(f,[row(3),row(2,'CAPITAL_FUND','FND-1')]);
 const finance=await financeCorrectionAuditRead(f.pool,new URL('http://local/?mode=finance'),owner);
 const capital=await financeCorrectionAuditRead(f.pool,new URL('http://local/?mode=capital'),owner);
 assert.equal(finance.events.length,1);
 assert.equal(capital.events.length,1);
 assert.equal(capital.events[0].sourceId,'FND-1');
 assert.equal(capital.events[0].originalTitle,'Fund FND-1');
});
test('orphan/incorrect snapshot/tampered actor fail closed; writer authority required',async()=>{
 for(const tampered of [
  {...row(1),source_id:'UNKNOWN'},
  {...row(1),source_snapshot_id:'OTHER'},
  {...row(1),actor_login:'bad actor'},
  {...row(1),next_title:'X'.repeat(181)}
 ]){
  const f=fixture();withEvents(f,[tampered]);
  await assert.rejects(financeCorrectionAuditRead(f.pool,new URL('http://local/?mode=finance'),owner),{status:503});
 }
 const f=fixture();withEvents(f,[row(1)]);
 f.man.financial_write_authority='CLEAN';
 await assert.rejects(financeCorrectionAuditRead(f.pool,new URL('http://local/?mode=finance'),owner),{status:503});
});
