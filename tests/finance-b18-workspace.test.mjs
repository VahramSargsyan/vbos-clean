import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeWorkspaceHtml,nativeWorkspaceFormAction} from
 '../domains/finance/finance-native-workspace-view.mjs';
import {readNativeFinanceWorkspace,validateNativeWorkspaceSource,NativeFinanceWorkspaceError} from
 '../domains/finance/native-finance-workspace-read.mjs';

const SNAP='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const SHA='8bdfd30faa9e45785f928c2861d7e3645a9dd168bb6d678004c0df730a04871d';
const amount=['1000','2000','2000','2500','0','1500','0','1000'];
const nativeFunds=amount.map((opening,i)=>({
 fund_id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),
 legacy_source_id:'FND-2026-'+String(i+1).padStart(4,'0'),
 code:['OPERATING_RESERVE','WARRANTY_RESERVE','MARKETING_SALES','PEOPLE_TRAINING',
  'TOOLS_CREW_KITS','RND_MATERIALS','DIGITAL_AI_VBOS','INFRASTRUCTURE'][i],
 status:'active',opening_balance_base:Number(opening).toFixed(6),
 current_balance_base:Number(opening).toFixed(6)
}));
const open={source_snapshot_id:SNAP,manifest_sha256:SHA,as_of_date:'2026-09-30',
 opening_cash_base:'203000.000000',opening_profit_base:'588000.000000',
 opening_worker_payable_base:'0.000000'};
const gate={phase:'BLOCKED',financial_write_authority:'GOOGLE',
 google_frozen_confirmed:false,owner_identity_approved:false,
 cutover_date_key:null,snapshot_id:null,manifest_sha256:null,
 crm_bridge_sha256:null,expected_fund_count:8};
const ledger={opening_cash_base:'203000.000000',current_cash_balance_base:'203000.000000',
 opening_profit_base:'588000.000000',native_profit_delta_base:'0.000000',
 opening_worker_payable_base:'0.000000',native_worker_payable_delta_base:'0.000000'};
function fakePool({opening=open,funds=nativeFunds,gateControl=gate,archive=24}={}){
 const queries=[];
 const c={
  query:async(sql)=>{
   queries.push(sql);
   if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
   if(sql.includes('FROM mvp_finance_native.cutover_control'))return {rows:[gateControl]};
   if(sql.includes('FROM mvp_finance_native.opening_snapshot'))return {rows:[opening]};
   if(sql.includes('FROM mvp_history.source_records'))return {rows:[{n:archive}]};
   if(sql.includes('FROM mvp_finance_native.funds f'))return {rows:funds};
   if(sql.includes('FROM mvp_finance_native.v_cash_ledger'))return {rows:[ledger]};
   if(sql.includes('FROM mvp_finance_native.transactions ORDER BY'))return {rows:[]};
   if(sql.includes('FROM mvp_finance_native.fund_movements ')&&sql.includes('ORDER BY'))return {rows:[]};
   if(sql.includes('FROM public.mvp_orders o JOIN public.mvp_objects obj')){
    assert.match(sql,/obj\.name AS object_title/);
    assert.doesNotMatch(sql,/obj\.title/);
    return {rows:[{id:'00000000-0000-4000-8000-000000000031',title:'Монтаж',
     object_title:'Объект 1',status:'active'}]};
   }
   if(sql.includes('(SELECT count(*)::int FROM mvp_finance_native.transactions)'))
    return {rows:[{tx:0,movements:0}]};
   throw Error('Unexpected SQL in read-only test: '+sql);
  },
  release:()=>{}
 };
 const pool={options:{connectionString:'read_only_test'},connect:async()=>c};
 return {pool,queries};
}
const uiState=(postingEnabled=false)=>({
 version:'FINANCE_B18_NATIVE_WORKSPACE_V1',source:'CLEAN_NATIVE_POST_CUTOVER_ONLY',
 historicalArchiveImmutable:true,asOfOpening:'2026-09-30',
 phase:postingEnabled?'ACTIVE':'BLOCKED',authority:postingEnabled?'POSTGRES':'GOOGLE',
 postingEnabled,reason:postingEnabled?'SIGNED_SINGLE_WRITER_READY':'B17_HOSTED_FINANCIAL_POSTING_DISABLED',
 ledger:{openingCashAMD:'203000.000000',currentCashAMD:'203000.000000',
 openingProfitAMD:'588000.000000',nativeProfitDeltaAMD:'0.000000',
 openingPayableAMD:'0.000000',nativePayableDeltaAMD:'0.000000',
 isCurrentFinanceBalance:postingEnabled},
 funds:nativeFunds.map(f=>({id:f.fund_id,legacyId:f.legacy_source_id,
  code:f.code,status:f.status,openingBalanceAMD:f.opening_balance_base,
  balanceAMD:f.current_balance_base})),
 entries:[],movements:[],counts:{transactions:0,movements:0},truncated:false
});
test('B18 non-owner rejected before DB read',async()=>{
 const {pool,queries}=fakePool();
 await assert.rejects(readNativeFinanceWorkspace(pool,{authorizeOwner:()=>false}),
  e=>e instanceof NativeFinanceWorkspaceError&&e.status===401);
 assert.equal(queries.length,0);
});
test('B18 read-only source authenticates owner and stays disabled on BLOCKED/GOOGLE',async()=>{
 const {pool,queries}=fakePool();
 const view=await readNativeFinanceWorkspace(pool,{authorizeOwner:()=>true});
 assert.equal(view.version,'FINANCE_B18_NATIVE_WORKSPACE_V1');
 assert.equal(view.postingEnabled,false);
 assert.equal(view.phase,'BLOCKED');
 assert.equal(view.ledger.isCurrentFinanceBalance,false);
 assert.equal(view.counts.transactions,0);
 assert.equal(view.funds.length,8);
 assert.equal(view.orders.length,1);
 assert.equal(view.orderListComplete,true);
 assert.ok(queries[0].includes('READ ONLY'));
 assert.equal(queries.at(-1),'COMMIT');
 assert.ok(queries.every(q=>!/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT)\b/i.test(q)));
});
test('B18 detects approved historical cash/fund source drift before showing editable UI',async()=>{
 validateNativeWorkspaceSource({opening:open,archiveCount:24,funds:nativeFunds});
 for(const tamper of [
  {opening:{...open,opening_cash_base:'203001.000000'},archiveCount:24,funds:nativeFunds},
  {opening:open,archiveCount:23,funds:nativeFunds},
  {opening:open,archiveCount:24,funds:nativeFunds.slice(1)},
  {opening:open,archiveCount:24,funds:nativeFunds.map((f,i)=>i===0?{...f,opening_balance_base:'0.000000'}:f)}
 ])assert.throws(()=>validateNativeWorkspaceSource(tamper),NativeFinanceWorkspaceError);
});
test('B18 disabled mobile hides all create/edit/cancel/restore buttons and current balance claims',()=>{
 const view=uiState();
 view.entries.push({id:'00000000-0000-4000-8000-000000000020',date:'2026-10-01',
  operationType:'INCOME',status:'active',revision:1,amountAMD:'500.000000',
  amountOriginal:'500',currencyOriginal:'AMD',category:'other',notes:'<script>alert(1)</script>'});
 for(const mode of ['finance','capital']){
  const html=nativeWorkspaceHtml(view,mode);
  assert.match(html,/Запись отключена/);
  assert.doesNotMatch(html,/data-b18-form|data-b18-edit|data-b18-change|data-b18-reverse/);
  assert.doesNotMatch(html,/Остаток по внесённым операциям/);
  assert.doesNotMatch(html,/<script>/);
 }
});
test('B18 after separate signed approval enables native-only form + escaped row actions',()=>{
 const state=uiState(true);
 state.entries.push({id:'00000000-0000-4000-8000-000000000021',date:'2026-10-01',
  operationType:'INCOME',status:'active',revision:2,amountAMD:'500.000000',
  amountOriginal:'500',currencyOriginal:'AMD',category:'other',notes:'<script>alert(1)</script>'});
 const html=nativeWorkspaceHtml(state,'finance',{today:'2026-11-10',
  editingId:state.entries[0].id});
 assert.match(html,/data-b18-form="finance"/);
 assert.match(html,/data-b18-edit/);
 assert.match(html,/data-b18-change/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/Остаток по внесённым операциям/);
 const cap=nativeWorkspaceHtml(state,'capital');
 assert.match(cap,/data-b18-form="capital"/);
});
test('B19 checked native Order UUID and money-authority separation',()=>{
 const id='00000000-0000-4000-8000-000000000031';
 const orders=[{id,title:'Монтаж',objectTitle:'Объект 1'}];
 const active=uiState(true);active.orders=orders;
 const html=nativeWorkspaceHtml(active,'finance',{today:'2026-11-10'});
 assert.match(html,/Оплата работы по заказу/);
 assert.match(html,/name="workOrderId"/);
 const form={date:'2026-11-10',amount:'190000',category:'current_work',
  operationType:'INCOME',workOrderId:id};
 const result=nativeWorkspaceFormAction({mode:'finance',form,orders,today:'2026-11-10'});
 assert.equal(result.payload.workOrderId,id);
 for(const bad of ['','00000000-0000-4000-8000-000000000099','invalid'])
  assert.throws(()=>nativeWorkspaceFormAction({mode:'finance',orders,today:'2026-11-10',
   form:{...form,workOrderId:bad}}));
 const without=nativeWorkspaceFormAction({mode:'finance',orders,today:'2026-11-10',
  form:{...form,category:'other',workOrderId:''}});
 assert.equal(without.payload.workOrderId,undefined);
 const blocked=uiState(false);blocked.orders=orders;
 assert.doesNotMatch(nativeWorkspaceHtml(blocked,'finance'),/name="workOrderId"|data-b18-form/);
});
test('B18 form derives only server-approved actions; rejects invalid date/amount/linked category',()=>{
 const form={date:'2026-10-02',amount:'50.00',category:'other',
  notes:'Покупка материалов',operationType:'EXPENSE'};
 const created=nativeWorkspaceFormAction({mode:'finance',form,today:'2026-11-10'});
 assert.equal(created.action,'FINANCE_CREATE');
 assert.equal(created.payload.amountOriginal,'50.00');
 assert.equal(created.payload.currencyOriginal,'AMD');
 const original={id:'00000000-0000-4000-8000-000000000020',
  revision:3,operationType:'EXPENSE',status:'active',currencyOriginal:'AMD'};
 const edited=nativeWorkspaceFormAction({mode:'finance',form,record:original,today:'2026-11-10'});
 assert.equal(edited.action,'FINANCE_EDIT');
 assert.equal(edited.payload.expectedRevision,3);
 for(const invalid of [{...form,date:'2026-09-30'}, {...form,date:'2026-11-11'},
  {...form,amount:'-50'},{...form,amount:'1e6'},
  {...form,category:'current_work'}])
  assert.throws(()=>nativeWorkspaceFormAction({mode:'finance',form:invalid,
   today:'2026-11-10'}));
 const capital=nativeWorkspaceFormAction({mode:'capital',today:'2026-11-10',
  form:{date:'2026-10-02',amount:'40',action:'CAPITAL_TRANSFER',
   fromFundId:nativeFunds[0].fund_id,toFundId:nativeFunds[1].fund_id,purpose:'Резерв'}});
 assert.equal(capital.action,'CAPITAL_TRANSFER');
 assert.throws(()=>nativeWorkspaceFormAction({mode:'capital',today:'2026-11-10',
  form:{date:'2026-10-02',amount:'40',action:'CAPITAL_TRANSFER',
   fromFundId:nativeFunds[0].fund_id,toFundId:nativeFunds[0].fund_id,purpose:'Резерв'}}));
});
