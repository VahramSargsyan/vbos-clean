/**
 * Finance P1 actual PostgreSQL 17 E2E.
 * DESTRUCTIVE TEST FIXTURE: only an ephemeral localhost/vbos_mvp_ci database.
 * Rebuilds synthetic exact-shape B18/B21 attestation, never contacts Google/Neon/Render.
 * Execute after existing test:e2e's B23 run.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {normalizeFinanceCreate} from '../domains/finance/finance-create-normalize.mjs';
import {readNativeFinanceHistory,NativeFinanceHistoryError} from '../domains/finance/finance-native-summary-history.mjs';

const uri=process.env.TEST_DATABASE_URL||'';
let url;
try{url=new URL(uri);}catch{throw Error('FINANCE_P1_DISPOSABLE_POSTGRES_REQUIRED');}
if(!['postgres:','postgresql:'].includes(url.protocol)||
 !['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/vbos_mvp_ci')
 throw Error('FINANCE_P1_DISPOSABLE_POSTGRES_REQUIRED');
const pool=new pg.Pool({connectionString:uri,ssl:false,max:4});
const migration=readFileSync(new URL('../migrations/0030_finance_native_cutover_CANDIDATE.sql',import.meta.url),'utf8');
const attestation=readFileSync(new URL('../migrations/0037_finance_postfence_attestation_CANDIDATE_TEST_ONLY.sql',import.meta.url),'utf8');
const openingId='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const openingSha='8bdfd30faa9e45785f928c2861d7e3645a9dd168bb6d678004c0df730a04871d';
const googleId='13LRWLgHJQb24WXOsPLCIP2W8ZIaSX9AI3sfXJgF2-y8';
const copyId='1jN8nuyFOCozJ3rEeOhIMOVLrbRhkfY8VGkPSiFsvhH0';
const modified='2026-11-22T16:39:20.917Z',captured='2026-11-22T17:04:23.012Z';
const day='2026-11-23',asOf='2026-09-30';
const uid=()=>randomUUID(),one='00000000-0000-4000-8000-000000000071';
const two='00000000-0000-4000-8000-000000000072';
const clientId=uid(),objectId=uid(),workerId=uid();
const amounts=[
 {order:one,operationType:'INCOME',category:'current_work',amountOriginal:'200',commissionOriginal:'3'},
 {order:one,operationType:'INCOME',category:'advance',amountOriginal:'80'},
 {order:one,operationType:'EXPENSE',category:'materials',amountOriginal:'60',commissionOriginal:'2',notes:'P1 unique materials purchase'},
 {order:one,operationType:'WORKER_ACCRUAL',amountOriginal:'30',workerId},
 {order:one,operationType:'WORKER_PAYMENT',amountOriginal:'15',commissionOriginal:'1',workerId},
 {order:one,operationType:'EXPENSE',category:'client_material_purchase',amountOriginal:'20'},
 {order:one,operationType:'INCOME',category:'current_work',incomeRecognition:'EARNED_ONLY',amountOriginal:'50'},
 {order:one,operationType:'INCOME',category:'current_work',amountOriginal:'500',archived:true},
 {order:two,operationType:'INCOME',category:'current_work',amountOriginal:'999'}
];
const refs={clients:{[clientId]:{clientId}},objects:{[objectId]:{objectId,clientId}},
 workOrders:{[one]:{workOrderId:one,objectId,clientId},[two]:{workOrderId:two,objectId,clientId}},
 workers:{[workerId]:{workerId,status:'active'}}};
const params=o=>new URLSearchParams(o);
const run=(o={})=>readNativeFinanceHistory(pool,params(o),{authorizeOwner:()=>true});
async function install(){
 const current=(await pool.query('SELECT current_database() AS name,inet_server_addr()::text AS host')).rows[0];
 assert.equal(current.name,'vbos_mvp_ci');
 // The URL is hard-fenced to loopback; the service is Docker PG17 in GitHub Actions.
 // Reuse the same disposable DB after existing e2e; no occupied database is touched.
 for(const schema of ['mvp_finance_native','mvp_finance_stage','mvp_history'])
  await pool.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');
 await pool.query('CREATE SCHEMA mvp_history');
 await pool.query('CREATE SCHEMA mvp_finance_stage');
 await pool.query('CREATE TABLE mvp_history.source_records(source_kind text NOT NULL,source_id text NOT NULL,source_payload jsonb NOT NULL)');
 await pool.query('CREATE TABLE mvp_finance_stage.source_facts(source_kind text NOT NULL,source_id text NOT NULL,source_payload jsonb NOT NULL)');
 await pool.query('CREATE TABLE mvp_finance_stage.control_snapshots(source_kind text NOT NULL,source_id text NOT NULL,source_payload jsonb NOT NULL)');
 await pool.query("CREATE TABLE mvp_finance_stage.freeze_manifests("+
  "snapshot_id text PRIMARY KEY,google_manifest_sha256 text NOT NULL,"+
  "owner_identity_approved boolean NOT NULL DEFAULT false CHECK(owner_identity_approved=false),"+
  "financial_write_authority text NOT NULL DEFAULT 'GOOGLE' CHECK(financial_write_authority='GOOGLE'),"+
  "source_system text NOT NULL DEFAULT 'LEGACY_GOOGLE' CHECK(source_system='LEGACY_GOOGLE'))");
 await pool.query('INSERT INTO mvp_finance_stage.freeze_manifests(snapshot_id,google_manifest_sha256) VALUES($1,$2)',
  [openingId,openingSha]);
 for(const [table,kind,count] of [
  ['mvp_history.source_records','FINANCE_TRANSACTION',24],
  ['mvp_finance_stage.source_facts','BUSINESS_MONTHLY_GAIN',3],
  ['mvp_finance_stage.source_facts','CAPITAL_FUND',8],
  ['mvp_finance_stage.source_facts','CAPITAL_ALLOCATION_BATCH',1],
  ['mvp_finance_stage.source_facts','CAPITAL_FUND_TRANSACTION',6],
  ['mvp_finance_stage.control_snapshots','FINANCE_BALANCE',30],
  ['mvp_finance_stage.control_snapshots','CAPITAL_FUND_BALANCE',8]
 ]){
  for(let i=0;i<count;i++)
   await pool.query('INSERT INTO '+table+'(source_kind,source_id,source_payload) VALUES($1,$2,$3::jsonb)',
    [kind,kind+'_'+(i+1),JSON.stringify({synthetic:true,amount:i+1,currency:'AMD'})]);
 }
 await pool.query(migration);
 const openingAmounts=['1000','2000','2000','2500','0','1500','0','1000'];
 const codes=['OPERATING_RESERVE','WARRANTY_RESERVE','MARKETING_SALES','PEOPLE_TRAINING',
  'TOOLS_CREW_KITS','RND_MATERIALS','DIGITAL_AI_VBOS','INFRASTRUCTURE'];
 await pool.query('INSERT INTO mvp_finance_native.opening_snapshot(source_snapshot_id,manifest_sha256,as_of_date,'+
  'opening_cash_base,opening_profit_base,opening_worker_payable_base) VALUES($1,$2,$3,$4,$5,$6)',
  [openingId,openingSha,asOf,'203000','588000','0']);
 for(let i=0;i<8;i++){
  const fund=uid();
  await pool.query('INSERT INTO mvp_finance_native.funds(fund_id,legacy_source_id,code,group_type,status) VALUES($1,$2,$3,$4,$5)',
   [fund,'FND-2026-'+String(i+1).padStart(4,'0'),codes[i],i<2?'PROTECTIVE':'GROWTH','active']);
  await pool.query('INSERT INTO mvp_finance_native.fund_openings(fund_id,legacy_balance_source_id,source_snapshot_id,opening_balance_base) VALUES($1,$2,$3,$4)',
   [fund,'SYNTH_P1_FUND_'+(i+1),openingId,openingAmounts[i]]);
 }
 await pool.query(attestation);
 const googleSha=(await pool.query(
  'SELECT mvp_finance_native.post_fence_archived_source_sha256($1,$2,$3,$4,$5) sha',
  [googleId,copyId,modified,captured,93])).rows[0].sha;
 const crmSha=(await pool.query('SELECT mvp_finance_native.post_fence_archive_only_bridge_sha256() sha')).rows[0].sha;
 const columns='snapshot_id,original_snapshot_id,original_manifest_sha256,'+
  'google_manifest_sha256,crm_bridge_sha256,google_spreadsheet_id,source_copy_id,'+
  'google_modified_at,captured_at,google_prod_version,source_record_count,'+
  'expected_counts,legacy_link_policy,owner_identity_approved,owner_attestation_ref,signed_at';
 const counts={FINANCE_TRANSACTION:24,FINANCE_BALANCE:30,BUSINESS_MONTHLY_GAIN:3,
  CAPITAL_FUND:8,CAPITAL_ALLOCATION_BATCH:1,CAPITAL_FUND_TRANSACTION:6,CAPITAL_FUND_BALANCE:8};
 const values=['SYNTHETIC_P1_POSTFENCE_CHECK',openingId,openingSha,googleSha,crmSha,
  googleId,copyId,modified,captured,93,80,JSON.stringify(counts),
  'ARCHIVE_ONLY_NO_UUID_BRIDGE',true,'SYNTHETIC_P1_ONLY_NEVER_USER_APPROVAL','2026-11-22T17:10:00.000Z'];
 await pool.query('INSERT INTO mvp_finance_native.post_fence_attestations('+columns+') VALUES('+
  Array.from({length:16},(_,i)=>'$'+(i+1)).join(',')+')',values);
 await pool.query("UPDATE mvp_finance_native.cutover_control SET "+
  "phase='ACTIVE',financial_write_authority='POSTGRES',"+
  "cutover_date_key=$1,snapshot_id=$2,manifest_sha256=$3,crm_bridge_sha256=$4,"+
  "owner_identity_approved=true,google_frozen_confirmed=true WHERE id=1",
  ['2026-10-01',openingId,openingSha,crmSha]);
 Object.assign(process.env,{
  FINANCE_NATIVE_POSTING_ENABLE:'OWNER_APPROVED_CLEAN_TEST',
  RENDER_SERVICE_ID:'srv-dbkvfh2jnfac73a31nv0',
  FINANCE_NATIVE_FROZEN_MANIFEST_SHA256:googleSha,
  FINANCE_NATIVE_CRM_BRIDGE_SHA256:crmSha,
  DATABASE_URL:uri
 });
 await pool.query('INSERT INTO public.mvp_clients(id,request_key,name) VALUES($1,$2,$3)',
  [clientId,uid(),'P1_SYNTHETIC_CLIENT']);
 await pool.query('INSERT INTO public.mvp_objects(id,request_key,client_id,name) VALUES($1,$2,$3,$4)',
  [objectId,uid(),clientId,'P1_SYNTHETIC_OBJECT']);
 await pool.query('INSERT INTO public.mvp_orders(id,request_key,object_id,title) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
  [one,uid(),objectId,'P1_SYNTHETIC_ORDER_A',two,uid(),objectId,'P1_SYNTHETIC_ORDER_B']);
 await pool.query('INSERT INTO public.mvp_workers(id,name) VALUES($1,$2)',[workerId,'P1_SYNTHETIC_WORKER']);
 for(let i=0;i<amounts.length;i++){
  const r=amounts[i];
  const norm=normalizeFinanceCreate({
   operationType:r.operationType,category:r.category,incomeRecognition:r.incomeRecognition,
   workOrderId:r.order,workerId:r.workerId,notes:r.notes,
   amountOriginal:r.amountOriginal,commissionOriginal:r.commissionOriginal||'0',
   currencyOriginal:'AMD',transactionDate:day
  },{todayKey:day,references:refs});
  await pool.query(
   'INSERT INTO mvp_finance_native.transactions('+
   'finance_transaction_id,request_key,status,transaction_date_key,operation_type,'+
   'client_id,object_id,work_order_id,worker_id,amount_base,commission_base,'+
   'cash_effect_base,profit_effect_base,worker_payable_effect_base,normalized,created_at)'+
   ' VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::timestamptz)',
   [uid(),uid(),r.archived?'archived':'active',day,norm.operationType,clientId,objectId,r.order,
    r.workerId||null,String(norm.amountBase),String(norm.commissionBase),
    String(norm.cashEffectBase),String(norm.profitEffectBase),
    String(norm.workerPayableEffectBase),JSON.stringify(norm),
    '2026-11-23 10:00:00.12345'+String(i%5)+'+00']);
 }
}
test('Finance P1 actual PostgreSQL 17: signed synthetic source, exact metrics, UUID scope, filters, cursor and no writes',async t=>{
 try{
  await install();
  await t.test('B18 synthetic signed readiness and exact native Order accounting equivalent to B23',async()=>{
   const a=await run({workOrderId:one,limit:'3'});
   assert.equal(a.version,'FINANCE_P1_NATIVE_READ_V1');
   assert.equal(a.historicalIncluded,false);assert.equal(a.readonly,true);
   assert.equal(a.totalCount,8);assert.equal(a.activeCount,7);
   assert.equal(a.summary.receivedBase,'280.000000');
   assert.equal(a.summary.earnedBase,'250.000000');
   assert.equal(a.summary.economicExpenseBase,'96.000000');
   assert.equal(a.summary.profitBase,'154.000000');
   assert.equal(a.summary.cashBalanceBase,'179.000000');
   assert.equal(a.summary.workerPayableBase,'15.000000');
   assert.equal(a.summary.workerPaidBase,'15.000000');
   assert.equal(a.summary.ownerTransferBase,'0.000000');
  });
  await t.test('scope by native UUID excludes other orders but includes object and worker correctly',async()=>{
   const b=await run({workOrderId:two});
   assert.equal(b.totalCount,1);assert.equal(b.summary.receivedBase,'999.000000');
   const obj=await run({objectId});
   assert.equal(obj.totalCount,9);assert.equal(obj.summary.receivedBase,'1279.000000');
   const worker=await run({workerId});
   assert.equal(worker.totalCount,2);assert.equal(worker.summary.workerPaidBase,'15.000000');
   assert.equal(worker.summary.workerPayableBase,'15.000000');
  });
  await t.test('date/type/q narrow history only, leaving accumulated scoped metrics unchanged',async()=>{
   const p=await run({workOrderId:one,operationType:'EXPENSE',dateFrom:'2026-11-24',q:'materials'});
   assert.equal(p.items.length,0);
   assert.equal(p.totalCount,8);
   assert.equal(p.summary.profitBase,'154.000000');
   const q=await run({workOrderId:one,operationType:'EXPENSE',q:'material'});
   assert.equal(q.items.length,2); // ordinary + client-paid materials
   assert.equal(q.summary.profitBase,'154.000000');
   const names=await run({workOrderId:one,q:'P1_SYNTHETIC_ORDER_A',limit:'10'});
   assert.equal(names.items.length,8);
  });
  await t.test('microsecond keyset reads all records once; archived visible but omitted from sums',async()=>{
   let c=null;const ids=new Set();let archived=false;
   do{
    const p=await run({...{workOrderId:one,limit:'3'},...(c?{cursor:c}:{})});
    for(const row of p.items){
     assert.equal(ids.has(row.id),false,'duplicate ID across keyset pages');
     ids.add(row.id);
     if(row.status==='archived'&&row.amountBase==='500.000000')archived=true;
    }
    c=p.nextCursor;
    assert.ok(ids.size<=8);
   }while(c);
   assert.equal(ids.size,8);assert.equal(archived,true);
  });
  await t.test('current cash stock distinct from native-only cash delta',async()=>{
   const g=await run();
   assert.equal(g.summary.cashBalanceBase,'1178.000000');
   assert.equal(g.ledger.openingCashBase,'203000.000000');
   assert.equal(g.ledger.currentCashBase,'204178.000000');
  });
  await t.test('owner, malformed scope and cursor replay rejected; GET never mutates ledger',async()=>{
   await assert.rejects(readNativeFinanceHistory(pool,params(),{authorizeOwner:()=>false}),
    e=>e instanceof NativeFinanceHistoryError&&e.status===401);
   await assert.rejects(run({workOrderId:'WO-LEGACY-1'}),
    e=>e instanceof NativeFinanceHistoryError&&e.status===400);
   const p=await run({workOrderId:one,limit:'2'});
   await assert.rejects(run({workOrderId:two,limit:'2',cursor:p.nextCursor}),
    e=>e instanceof NativeFinanceHistoryError&&e.status===400);
   const before=(await pool.query('SELECT count(*)::int AS n FROM mvp_finance_native.transactions')).rows[0].n;
   await Promise.all([run(),run(),run()]);
   const after=(await pool.query('SELECT count(*)::int AS n FROM mvp_finance_native.transactions')).rows[0].n;
   assert.equal(after,before);
  });
  console.log('FINANCE_P1_REAL_DISPOSABLE_PG17_SIGNED_SOURCE_FILTERS_SUMS_KEYSET_PASS');
 }finally{await pool.end();}
});
