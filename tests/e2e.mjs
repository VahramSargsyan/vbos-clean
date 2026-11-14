import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';

const {Client}=pg;
const connectionString=process.env.TEST_DATABASE_URL;
if(!connectionString || !/localhost|127\.0\.0\.1/.test(new URL(connectionString).hostname)) {
 throw Error('E2E_DISPOSABLE_LOCAL_DATABASE_ONLY');
}
const database=new Client({connectionString,ssl:false});
const port=34271,base='http://127.0.0.1:'+port;
const claim='CI-ONLY-SYNTHETIC-ACTIVATION-CODE';
const password='CI-only-strong-password-1234';
let server;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path,payload,cookie='') {
 const r=await fetch(base+path,{
  method:payload===undefined?'GET':'POST',
  headers:{
   ...(payload!==undefined?{'Content-Type':'application/json','Origin':base}:{}),
   ...(cookie?{Cookie:cookie}:{})
  },
  ...(payload!==undefined?{body:JSON.stringify(payload)}:{})
 });
 const body=await r.json();
 return {status:r.status,body,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
}
async function waitForServer(){
 for(let n=0;n<100;n++){
  if(server.exitCode!==null)throw Error('MVP_SERVER_EXITED_BEFORE_START');
  try{const r=await request('/health');if(r.status===200&&r.body.ok)return;}catch{}
  await sleep(125);
 }
 throw Error('MVP_SERVER_DID_NOT_START');
}
async function create(type,payload,cookie) {
 const r=await request('/api/action',{type,payload:{...payload,requestKey:payload.requestKey||randomUUID()}},cookie);
 assert.equal(r.status,200,type+': '+r.body.error);
 assert.equal(r.body.saved,true,type+' did not confirm write');
 return r.body.item;
}
try{
 await database.connect();
 await database.query(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
 const v10Provenance=readFileSync(new URL('../migrations/0008_v10_legacy_provenance.sql',import.meta.url),'utf8');
 await database.query(v10Provenance);await database.query(v10Provenance);
 assert.equal((await database.query("SELECT to_regclass('public.mvp_legacy_import_map') IS NOT NULL AS present")).rows[0].present,true);
 console.log('V10_GOOGLE_LEGACY_ID_PROVENANCE_ADDITIVE_SCHEMA_TWICE_PASS');
 const a1Migration=readFileSync(new URL('../migrations/0001_daily_a1.sql',import.meta.url),'utf8');
 await database.query(a1Migration);
 await database.query(a1Migration);
 const a1Schema=await database.query("SELECT (to_regclass('public.mvp_daily_a1') IS NOT NULL) AS goal_table,(to_regclass('public.mvp_a1_requests') IS NOT NULL) AS receipt_table");
 assert.equal(a1Schema.rows[0].goal_table,true);
 assert.equal(a1Schema.rows[0].receipt_table,true);
 console.log('V6_A1_ADDITIVE_IDEMPOTENT_SCHEMA_REHEARSAL_PASS');
 const pSchema=readFileSync(new URL('../migrations/0002_object_presence.sql',import.meta.url),'utf8');
 await database.query(pSchema);
 await database.query(pSchema);
 const pSchemaCheck=await database.query("SELECT to_regclass('public.mvp_object_presence') IS NOT NULL AS visits, to_regclass('public.mvp_presence_requests') IS NOT NULL AS receipts");
 assert.equal(pSchemaCheck.rows[0].visits,true);
 assert.equal(pSchemaCheck.rows[0].receipts,true);
 console.log('V7_OBJECT_PRESENCE_ADDITIVE_SCHEMA_IDEMPOTENCE_PASS');
 const ownerSchema=readFileSync(new URL('../migrations/0003_owner_activity.sql',import.meta.url),'utf8');
 await database.query(ownerSchema);await database.query(ownerSchema);
 const ownerSchemaCheck=await database.query("SELECT to_regclass('public.mvp_owner_activities') IS NOT NULL AS activities,to_regclass('public.mvp_owner_activity_requests') IS NOT NULL AS receipts");
 assert.equal(ownerSchemaCheck.rows[0].activities,true);
 assert.equal(ownerSchemaCheck.rows[0].receipts,true);
 console.log('V8_OWNER_ACTIVITY_SCHEMA_REHEARSED_TWICE_PASS');
 const scheduleSql=readFileSync(new URL('../migrations/0004_schedule_manual.sql',import.meta.url),'utf8');
 await database.query(scheduleSql);await database.query(scheduleSql);
 const scheduleTables=await database.query("SELECT to_regclass('public.mvp_schedule_items') IS NOT NULL AS items,to_regclass('public.mvp_schedule_requests') IS NOT NULL AS receipts");
 assert.equal(scheduleTables.rows[0].items,true);
 assert.equal(scheduleTables.rows[0].receipts,true);
 console.log('V9A_SCHEDULE_ADDITIVE_SQL_REPLAY_TWICE_PASS');
 const autoScheduleSql=readFileSync(new URL('../migrations/0005_schedule_order_sync.sql',import.meta.url),'utf8');
 await database.query(autoScheduleSql);await database.query(autoScheduleSql);
 const autoTables=await database.query("SELECT to_regclass('public.mvp_schedule_order_items') IS NOT NULL AS items,to_regclass('public.mvp_order_schedule_requests') IS NOT NULL AS requests");
 assert.equal(autoTables.rows[0].items,true);
 assert.equal(autoTables.rows[0].requests,true);
 console.log('V9B_AUTO_SCHEDULE_ADDITIVE_SCHEMA_REHEARSED_TWICE_PASS');
 const workerSql=readFileSync(new URL('../migrations/0006_worker_assignments.sql',import.meta.url),'utf8');
 await database.query(workerSql);await database.query(workerSql);
 const workerSchema=await database.query("SELECT to_regclass('public.mvp_workers') IS NOT NULL AS workers,to_regclass('public.mvp_worker_order_assignments') IS NOT NULL AS orders,to_regclass('public.mvp_manual_plan_workers') IS NOT NULL AS plans,to_regclass('public.mvp_worker_requests') IS NOT NULL AS requests");
 assert.deepEqual(workerSchema.rows[0],{workers:true,orders:true,plans:true,requests:true});
 console.log('V9C_WORKER_ASSIGNMENT_ADDITIVE_SQL_TWICE_PASS');
 const workerDaySql=readFileSync(new URL('../migrations/0007_worker_days.sql',import.meta.url),'utf8');
 await database.query(workerDaySql);await database.query(workerDaySql);
 const dayTables=await database.query("SELECT to_regclass('public.mvp_worker_days') IS NOT NULL AS days,to_regclass('public.mvp_worker_day_orders') IS NOT NULL AS orders,to_regclass('public.mvp_worker_day_requests') IS NOT NULL AS receipts");
 assert.deepEqual(dayTables.rows[0],{days:true,orders:true,receipts:true});
 console.log('V9D_WORKER_DAY_SCHEMA_IDEMPOTENCE_TWICE_PASS');
 const workerTaskSql=readFileSync(new URL('../migrations/0009_worker_tasks.sql',import.meta.url),'utf8');
 await database.query(workerTaskSql);await database.query(workerTaskSql);
 const taskTables=await database.query("SELECT to_regclass('public.mvp_worker_tasks') IS NOT NULL AS tasks,to_regclass('public.mvp_worker_task_requests') IS NOT NULL AS receipts");
 assert.deepEqual(taskTables.rows[0],{tasks:true,receipts:true});
 console.log('V9E_WORKER_TASK_SCHEMA_IDEMPOTENCE_TWICE_PASS');

 const benchmarkSchemaSql=readFileSync(new URL('../migrations/0010_benchmark_approvals.sql',import.meta.url),'utf8');
 await database.query(benchmarkSchemaSql);await database.query(benchmarkSchemaSql);
 const v9hSchema=await database.query("SELECT to_regclass('public.mvp_benchmark_proposals') IS NOT NULL AS proposals,to_regclass('public.mvp_benchmark_approvals') IS NOT NULL AS approvals,to_regclass('public.mvp_benchmark_approval_events') IS NOT NULL AS events");
 assert.deepEqual(v9hSchema.rows[0],{proposals:true,approvals:true,events:true});
 console.log('V9H_MANUAL_BENCHMARK_SCHEMA_REPLAY_TWICE_PASS');
 const refSchemaSql=readFileSync(new URL('../migrations/0012_services_masterprices_REFERENCE_TEST_ONLY.sql',import.meta.url),'utf8');
 await database.query(refSchemaSql);await database.query(refSchemaSql);
 const refTables=await database.query("SELECT to_regclass('public.mvp_service_reference_batches') IS NOT NULL AS batches,to_regclass('public.mvp_services_reference') IS NOT NULL AS services,to_regclass('public.mvp_master_prices_reference') IS NOT NULL AS prices");
 assert.deepEqual(refTables.rows[0],{batches:true,services:true,prices:true});
 console.log('V12_REFERENCE_ADDITIVE_SCHEMA_REPLAY_TWICE_PASS');
 const nativeCloseSql=readFileSync(new URL('../migrations/0013_native_order_close_MANUAL_FINANCE_TEST_ONLY.sql',import.meta.url),'utf8');
 await database.query(nativeCloseSql);await database.query(nativeCloseSql);
 const nativeCloseSchema=await database.query("SELECT to_regclass('public.mvp_native_client_assessments') IS NOT NULL AS assessments,to_regclass('public.mvp_native_order_close_facts') IS NOT NULL AS facts");
 assert.deepEqual(nativeCloseSchema.rows[0],{assessments:true,facts:true});
 console.log('V13B2_NATIVE_CLOSE_SCHEMA_REPLAY_TWICE_PASS');
 const crm01Sql=readFileSync(new URL('../migrations/0014_crm_lead_conversion_TEST_ONLY.sql',import.meta.url),'utf8');
 await database.query(crm01Sql);await database.query(crm01Sql);
 const crmTables=await database.query("SELECT to_regclass('public.mvp_crm_lead_client_links') IS NOT NULL AS links,to_regclass('public.mvp_crm_conversion_requests') IS NOT NULL AS receipts");
 assert.deepEqual(crmTables.rows[0],{links:true,receipts:true});
 assert.equal((await database.query("SELECT public.mvp_crm_phone_canonical('+374 91 234 56 78') phone")).rows[0].phone,'374912345678');
 assert.equal((await database.query("SELECT public.mvp_crm_phone_canonical('091234567') phone")).rows[0].phone,'37491234567');
 console.log('CRM01_LINKS_AND_PHONE_CANONICAL_SCHEMA_REPLAY_TWICE_PASS');
 const crm02Sql=readFileSync(new URL('../migrations/0015_crm_existing_client_intake_TEST_ONLY.sql',import.meta.url),'utf8');
 await database.query(crm02Sql);await database.query(crm02Sql);
 assert.equal((await database.query("SELECT to_regclass('public.mvp_crm_lead_intakes') IS NOT NULL AS ready")).rows[0].ready,true);
 console.log('CRM02_EXISTING_CLIENT_INTAKE_SCHEMA_REPLAY_TWICE_PASS');
 const crm15Sql=readFileSync(new URL('../migrations/0023_crm15a_client_profile_TEST_ONLY.sql',import.meta.url),'utf8');
 await database.query(crm15Sql);await database.query(crm15Sql);
 const profileCols=(await database.query("SELECT email,address,status,client_tier,referral_status,client_label_note FROM public.mvp_clients LIMIT 0")).fields.map(x=>x.name);
 assert.deepEqual(profileCols,['email','address','status','client_tier','referral_status','client_label_note']);
 console.log('CRM15A_ADDITIVE_CLIENT_PROFILE_SQL_REPLAY_TWICE_PASS');
 const crm05Sql=readFileSync(new URL('../migrations/0016_crm05a_manual_estimate_drafts_TEST_ONLY.sql',import.meta.url),'utf8');
 await database.query(crm05Sql);await database.query(crm05Sql);
 const crm05Schema=(await database.query("SELECT to_regclass('public.mvp_estimates') IS NOT NULL AS drafts,to_regclass('public.mvp_estimate_lines') IS NOT NULL AS lines,to_regclass('public.mvp_estimate_versions') IS NOT NULL AS versions,to_regclass('public.mvp_estimate_mutation_requests') IS NOT NULL AS requests")).rows[0];
 assert.deepEqual(crm05Schema,{drafts:true,lines:true,versions:true,requests:true});
 console.log('CRM05A_VERSIONED_ESTIMATE_ADDITIVE_SCHEMA_REPLAY_TWICE_PASS');
 const crm16Sql=readFileSync(new URL('../migrations/0024_crm16a_estimate_handoff_TEST_ONLY.sql',import.meta.url),'utf8');
 await database.query(crm16Sql);await database.query(crm16Sql);
 assert.deepEqual((await database.query("SELECT status,work_order_id,accepted_total_amd FROM public.mvp_estimates LIMIT 0")).fields.map(x=>x.name),['status','work_order_id','accepted_total_amd']);
 assert.equal((await database.query("SELECT to_regclass('public.mvp_estimate_handoff_requests') IS NOT NULL AS ready")).rows[0].ready,true);
 console.log('CRM16A_ACCEPTED_ESTIMATE_HANDOFF_ADDITIVE_SQL_REPLAY_TWICE_PASS');
 const crm06Sql=readFileSync(new URL('../migrations/0019_crm06a_interactions_TEST_ONLY.sql',import.meta.url),'utf8');
 await database.query(crm06Sql);await database.query(crm06Sql);
 assert.equal((await database.query("SELECT to_regclass('public.mvp_crm_interactions') IS NOT NULL AS ready")).rows[0].ready,true);
 console.log('CRM06A_ADDITIVE_INTERACTION_SCHEMA_TWICE_PASS');
 const crm08Sql=readFileSync(new URL('../migrations/0020_crm08a_next_action_calendar_TEST_ONLY.sql',import.meta.url),'utf8');
 await database.query(crm08Sql);await database.query(crm08Sql);
 const crm08Schema=(await database.query("SELECT to_regclass('public.mvp_schedule_lead_items') IS NOT NULL AS plans,to_regclass('public.mvp_crm_reminder_requests') IS NOT NULL AS requests,(SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='mvp_leads' AND column_name IN ('next_action','next_action_at')) AS lead_fields")).rows[0];
 assert.deepEqual(crm08Schema,{plans:true,requests:true,lead_fields:2});
 console.log('CRM08A_ADD_ONLY_SCHEMA_REPLAY_TWICE_PASS');
 const crm10Sql=readFileSync(new URL('../migrations/0021_crm10a_lead_signals_TEST_ONLY.sql',import.meta.url),'utf8');
 await database.query(crm10Sql);await database.query(crm10Sql);
 const crm10Schema=(await database.query("SELECT to_regclass('public.mvp_crm_signal_requests') IS NOT NULL AS receipts,(SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='mvp_leads' AND column_name IN ('agreement_stage','source_channel','need_summary')) AS fields")).rows[0];
 assert.deepEqual(crm10Schema,{receipts:true,fields:3});
 console.log('CRM10A_ADDITIVE_SIGNAL_SCHEMA_REPLAY_TWICE_PASS');
 const crm12Sql=readFileSync(new URL('../migrations/0022_crm12a_score_history_TEST_ONLY.sql',import.meta.url),'utf8');
 await database.query(crm12Sql);
 const initialEpoch=(await database.query("SELECT schema_version,tracking_since FROM public.mvp_crm_score_history_meta WHERE singleton=true")).rows[0];
 assert.equal(initialEpoch.schema_version,'CRM_SCORE_HISTORY_V1');
 assert.ok(new Date(initialEpoch.tracking_since).getTime()>0);
 await database.query(crm12Sql);
 const replayEpoch=(await database.query("SELECT schema_version,tracking_since FROM public.mvp_crm_score_history_meta WHERE singleton=true")).rows[0];
 assert.deepEqual(replayEpoch,initialEpoch,'Migration replay may not reset tracking epoch');
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_lead_score_snapshots')).rows[0].n,0);
 console.log('CRM12A_ADD_ONLY_HISTORY_SCHEMA_REPLAY_TWICE_TRACKING_EPOCH_STABLE_PASS');
 const crm22Sql=readFileSync(new URL('../migrations/0025_crm22a_lead_transfer_TEST_ONLY.sql',import.meta.url),'utf8');
 await database.query(crm22Sql);await database.query(crm22Sql);
 const transferTable=(await database.query(
  "SELECT to_regclass('public.mvp_crm_lead_transfers') IS NOT NULL AS present")).rows[0].present;
 assert.equal(transferTable,true);
 const transferStatus=(await database.query(
  "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint "+
  "WHERE conrelid='public.mvp_leads'::regclass AND conname='mvp_leads_status_check'")).rows[0].def;
 assert.match(transferStatus,/transferred/);
 console.log('CRM22A_TEST_SQL_0025_IDEMPOTENT_DOUBLE_REPLAY_PASS');
 const crm26Sql=readFileSync(new URL('../migrations/0029_crm26a_legacy_transfer_archive_CANDIDATE.sql',import.meta.url),'utf8');
 await database.query(crm26Sql);await database.query(crm26Sql);
 assert.deepEqual((await database.query("SELECT to_regclass('mvp_history.crm_legacy_lead_transfers') IS NOT NULL AS archive,to_regclass('mvp_history.crm_legacy_transfer_batches') IS NOT NULL AS batches")).rows[0],
  {archive:true,batches:true});
 console.log('CRM26_ARCHIVE_ADD_ONLY_SQL_REPLAY_TWICE_PASS');
 const crm25Sql=readFileSync(new URL('../migrations/0028_crm25a_master_directory_CANDIDATE.sql',import.meta.url),'utf8');
 await database.query(crm25Sql);await database.query(crm25Sql);
 const crm25Schema=(await database.query("SELECT to_regclass('public.mvp_crm_masters') IS NOT NULL AS masters,(SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='mvp_crm_lead_transfers' AND column_name='master_id') AS fkcol")).rows[0];
 assert.deepEqual(crm25Schema,{masters:true,fkcol:1});
 console.log('CRM25_MASTER_SCHEMA_DOUBLE_REPLAY_PASS');
 const objParityMigration=readFileSync(new URL('../migrations/0032_object_card_legacy_parity_CANDIDATE.sql',import.meta.url),'utf8');
 await database.query(objParityMigration);await database.query(objParityMigration);
 const paritySchema=(await database.query(
  "SELECT to_regclass('public.mvp_object_interactions') IS NOT NULL AS contact_table,"+
  "(SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='mvp_objects' AND column_name='object_type') AS type_columns")).rows[0];
 assert.deepEqual(paritySchema,{contact_table:true,type_columns:1});
 console.log('OBJECT_CARD_BATCH2_ADDITIVE_SCHEMA_DOUBLE_REPLAY_PASS');
 // 0033 isolated Order contacts: execute twice, preserving all parent tables.
 const oldOrderRowCount=(await database.query('SELECT count(*)::int n FROM public.mvp_orders')).rows[0].n;
 const oldObjectContacts=(await database.query('SELECT count(*)::int n FROM public.mvp_object_interactions')).rows[0].n;
 const orderContactsMigration=readFileSync(new URL('../migrations/0033_order_contacts_CANDIDATE.sql',import.meta.url),'utf8');
 await database.query(orderContactsMigration);await database.query(orderContactsMigration);
 const orderContactsSchema=(await database.query(
  "SELECT to_regclass('public.mvp_order_interactions') IS NOT NULL AS table_present,"+
  "(SELECT count(*)::int FROM pg_constraint WHERE conrelid='public.mvp_order_interactions'::regclass AND contype='f') AS fk_count,"+
  "(SELECT count(*)::int FROM pg_indexes WHERE tablename='mvp_order_interactions' AND indexname='mvp_order_interactions_order_created_idx') AS index_count")).rows[0];
 assert.deepEqual(orderContactsSchema,{table_present:true,fk_count:1,index_count:1});
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_orders')).rows[0].n,oldOrderRowCount);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_object_interactions')).rows[0].n,oldObjectContacts);
 console.log('ORDER_CONTACTS_0033_DOUBLE_REPLAY_FK_INDEX_PARENT_PRESERVED_PG_PASS');
 // Full WorkLog 0034: two exact additive rehearsals, with no old rows rewritten.
 const workLogFullSql=readFileSync(new URL('../migrations/0034_full_worklog_parity_CANDIDATE.sql',import.meta.url),'utf8');
 const basicLogsBefore=(await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n;
 await database.query(workLogFullSql);await database.query(workLogFullSql);
 const detailSchema=(await database.query(
  "SELECT to_regclass('public.mvp_work_log_details') IS NOT NULL AS detail,"+
  "to_regclass('public.mvp_work_log_full_requests') IS NOT NULL AS receipts,"+
  "(SELECT count(*)::int FROM pg_indexes WHERE tablename='mvp_work_log_details' AND indexname='mvp_work_log_details_day_start_idx') AS day_idx")).rows[0];
 assert.deepEqual(detailSchema,{detail:true,receipts:true,day_idx:1});
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n,basicLogsBefore);
 console.log('FULL_WORKLOG_0034_ADDITIVE_SQL_TWICE_PRESERVE_CANONICAL_LOGS_PASS');


 server=spawn(process.execPath,[new URL('../server.mjs',import.meta.url).pathname],{
  env:{
   ...process.env,
   NODE_ENV:'test',MVP_DATABASE_SSL:'disable',DATABASE_URL:connectionString,
   COOKIE_KEY:'THIS-IS-ONLY-A-DISPOSABLE-CI-HMAC-SECRET-'+randomUUID(),
   CLAIM_TOKEN_SHA256:createHash('sha256').update(claim).digest('hex'),
   PORT:String(port)
  },stdio:['ignore','pipe','pipe']
 });
 let logged='';
 server.stdout.on('data',v=>{logged+=v.toString().slice(0,1000);});
 server.stderr.on('data',v=>{logged+=v.toString().replace(/postgres(?:ql)?:\/\/[^\s]+/g,'[REDACTED]').slice(0,1000);});
 await waitForServer();
 assert.match(logged,/MVP_POSTGRES_TRANSACTIONAL_WRITE_READBACK_ROLLBACK_PASS/);
 console.log('STARTUP_POSTGRES_WRITE_READBACK_ROLLBACK_PASS');

 assert.equal((await request('/api/state')).status,401);
 assert.equal((await request('/api/orders/close-preview?id=5b89c984-72b5-4c39-bb3d-7f2012f29b46')).status,401);
 assert.equal((await request('/api/orders/capacity-context?id=5b89c984-72b5-4c39-bb3d-7f2012f29b46')).status,401);
 assert.equal((await request('/api/worker-days')).status,401);
 assert.equal((await request('/api/history')).status,401);
 assert.equal((await request('/api/history/orders')).status,401);
 assert.equal((await request('/api/history/orders/assessment?id=WO-2026-0001')).status,401);
 assert.equal((await request('/api/history/finance')).status,401);
 assert.equal((await request('/api/finance/archive')).status,401);
 assert.equal((await request('/api/finance/csrf')).status,401);
 assert.equal((await request('/api/finance/native-ledger-preview')).status,401);
 assert.equal((await request('/api/finance/cutover-readiness')).status,401);
 assert.equal((await request('/api/finance/native-action-preview',{})).status,401);
 assert.equal((await request('/api/finance/reviews')).status,401);
 assert.equal((await request('/api/finance/corrections')).status,401);
 assert.equal((await request('/api/finance/correction-audit?mode=capital')).status,401);
 assert.equal((await request('/api/finance/correction',{sourceKind:'FINANCE_TRANSACTION'})).status,401);
 assert.equal((await request('/api/finance/review',{sourceKind:'CAPITAL_FUND',sourceId:'X'})).status,401);
 assert.equal((await request('/api/reference/services')).status,401);
 // UX V1C: actual HTTP proof that the grouped-menu CSS is served, not a 404.
 const menuCssResponse=await fetch(base+'/menu-groups.css');
 assert.equal(menuCssResponse.status,200,'Grouped menu stylesheet must be available via HTTP');
 assert.match(menuCssResponse.headers.get('content-type')||'',/^text\/css/i);
 assert.match(await menuCssResponse.text(),/display:flex;flex-direction:column;flex-wrap:nowrap/);
 console.log('NAVIGATION_UX_V1C_CSS_HTTP_200_VERTICAL_SUBMENU_PASS');
 // Today V1 must be executable on deployed Render; server serves an explicit
 // path whitelist, so VM unit tests alone cannot prove the bundle is reachable.
 const [homePage,todayJs,todayCss]=await Promise.all([
  fetch(base+'/'),fetch(base+'/today-dashboard.js'),fetch(base+'/today-dashboard.css')
 ]);
 assert.equal(homePage.status,200);
 const homeHtml=await homePage.text();
 assert.match(homeHtml,/src="\/today-dashboard\.js"/);
 assert.match(homeHtml,/href="\/today-dashboard\.css"/);
 assert.ok(homeHtml.indexOf('/today-dashboard.js')<homeHtml.indexOf('/app.js'),
  'Today controller must load before the app event handlers');
 assert.equal(todayJs.status,200,'Today controller must be whitelisted for HTTP');
 assert.match(todayJs.headers.get('content-type')||'',/^text\/javascript/i);
 assert.match(await todayJs.text(),/function todayDashboardView\(/);
 assert.equal(todayCss.status,200,'Today stylesheet must be whitelisted for HTTP');
 assert.match(todayCss.headers.get('content-type')||'',/^text\/css/i);
 assert.match(await todayCss.text(),/\.today-quick-actions/);
 console.log('TODAY_V1_ACTUAL_HTTP_SCRIPT_CSS_200_AND_DEFER_ORDER_PASS');
 assert.equal((await fetch(base+'/service-reference-view.mjs')).status,200);
 assert.equal((await fetch(base+'/history-orders-view.mjs')).status,200);
 assert.equal((await fetch(base+'/finance-history-view.mjs')).status,200);
 assert.equal((await fetch(base+'/finance-capital-view.mjs')).status,200);
 assert.equal((await fetch(base+'/finance-corrections-view.mjs')).status,200);
 assert.equal((await fetch(base+'/finance-correction-audit-view.mjs')).status,200);
 assert.equal((await request('/api/my-work')).status,401);
 assert.equal((await request('/api/a1')).status,401);
 assert.equal((await request('/api/presence')).status,401);
 assert.equal((await request('/api/owner-activity')).status,401);
 assert.equal((await request('/api/schedule')).status,401);
 assert.equal((await request('/api/schedule/hourly')).status,401);
 assert.equal((await request('/api/schedule/hourly/search')).status,401);
 assert.equal((await request('/api/schedule/conflicts')).status,401);
 assert.equal((await fetch(base+'/schedule-conflicts.js')).status,200);
 assert.equal((await fetch(base+'/schedule-conflicts.css')).status,200);
 assert.ok(homeHtml.indexOf('/schedule-conflicts.js')<homeHtml.indexOf('/app.js'));
 assert.ok(homeHtml.indexOf('/schedule-overlap.js')<homeHtml.indexOf('/app.js'));
 assert.equal((await fetch(base+'/schedule-overlap.js')).status,200);
 assert.equal((await fetch(base+'/schedule-overlap.css')).status,200);
 assert.equal((await fetch(base+'/schedule-hourly.js')).status,200);
 assert.equal((await fetch(base+'/schedule-hourly.css')).status,200);
 assert.equal((await request('/api/capacity')).status,401);
 const [capacityScript,capacityStyle]=await Promise.all([fetch(base+'/capacity.js'),fetch(base+'/capacity.css')]);
 assert.equal(capacityScript.status,200);
 assert.match(capacityScript.headers.get('content-type')||'',/^text\/javascript/i);
 assert.match(await capacityScript.text(),/function capacityPanelView\(/);
 assert.equal(capacityStyle.status,200);
 assert.match(capacityStyle.headers.get('content-type')||'',/^text\/css/i);
 assert.match(await capacityStyle.text(),/\.capacity-window/);
 console.log('CAPACITY_V1_HTTP_ASSETS_AND_OWNER_AUTH_GATE_PASS');
 assert.equal((await request('/api/catalog')).status,401);
 assert.equal((await request('/api/bootstrap')).body.setupRequired,true);
 const setup=await request('/api/setup',{claimCode:claim,login:'ci-owner',password});
 assert.equal(setup.status,201,setup.body.error);
 const cookie=setup.cookie;
 const blankMyWork=await request('/api/my-work',undefined,cookie);
 assert.equal(blankMyWork.status,200,blankMyWork.body.error);
 assert.equal(blankMyWork.body.day,null);
 assert.equal(blankMyWork.body.currentSession,null);
 assert.equal(blankMyWork.body.todayTotals.logCount,0);
 assert.equal(blankMyWork.body.todayTotals.workMinutes,0);
 const emptyPlan=await request('/api/schedule?viewMode=week&anchorDate=2026-11-03',undefined,cookie);
 assert.equal(emptyPlan.status,200,emptyPlan.body.error);
 assert.equal(emptyPlan.body.periodStart,'2026-11-02');
 assert.equal(emptyPlan.body.periodEnd,'2026-11-08');
 assert.equal(emptyPlan.body.calendarDayPolicy.version,'CALENDAR_WORKING_DAY_V194_V195');
 assert.equal(emptyPlan.body.calendarDayPolicy.policyVersion,'SHARED_CAPACITY_MON_SAT_MONTHLY_BANK_REVIEW_V2');
 assert.equal(emptyPlan.body.calendarDayPolicy.days['2026-11-08'],'SUNDAY');
 assert.equal(emptyPlan.body.calendarDayPolicy.days['2026-11-07'],'WORKING_DAY');
 const monthPolicy=await request('/api/schedule?viewMode=month&anchorDate=2026-11-02',undefined,cookie);
 assert.equal(monthPolicy.status,200,monthPolicy.body.error);
 assert.equal(monthPolicy.body.calendarDayPolicy.days['2026-11-29'],'SUNDAY');
 assert.equal(monthPolicy.body.calendarDayPolicy.days['2026-11-30'],'MONTHLY_REVIEW');
 assert.equal(monthPolicy.body.calendarDayPolicy.days['2026-11-28'],'WORKING_DAY');
 console.log('CALENDAR_V194_V195_REAL_HTTP_SERVER_POLICY_EXCLUSIVE_COMPANY_DAY_PASS');
 assert.equal(emptyPlan.body.total,0);
 assert.equal(emptyPlan.body.autoWorkOrderSync,'ENABLED');
 assert.equal(emptyPlan.body.workerAssignment,'NOT_IMPLEMENTED');
 const hourlyEmpty=await request('/api/schedule/hourly?viewMode=week&anchorDate=2026-11-03',undefined,cookie);
 assert.equal(hourlyEmpty.status,200,hourlyEmpty.body.error);
 assert.equal(hourlyEmpty.body.version,'LEGACY_CALENDAR_HOURLY_V1101');
 assert.equal(hourlyEmpty.body.complete,true);
 assert.equal(hourlyEmpty.body.periodStart,'2026-11-02');
 assert.equal(hourlyEmpty.body.periodEnd,'2026-11-08');
 assert.equal(hourlyEmpty.body.items.length,0);
 assert.equal((await request('/api/schedule/hourly?viewMode=bad',undefined,cookie)).status,400);
 const nextSource=await request('/api/schedule/hourly/search?startDate=2026-11-28',undefined,cookie);
 assert.equal(nextSource.status,200,nextSource.body.error);
 assert.equal(nextSource.body.version,'LEGACY_HOURLY_NEXT_SOURCE_V1101');
 assert.equal(nextSource.body.startDate,'2026-11-28');
 assert.equal(nextSource.body.endDate,'2026-12-12');
 assert.equal(nextSource.body.complete,true);
 assert.equal(nextSource.body.items.length,0);
 assert.equal((await request('/api/schedule/hourly/search?startDate=wrong',undefined,cookie)).status,400);
 const emptyConflicts=await request('/api/schedule/conflicts?startDate=2026-11-10&endDate=2026-11-12',undefined,cookie);
 assert.equal(emptyConflicts.status,200,emptyConflicts.body.error);
 assert.equal(emptyConflicts.body.version,'LEGACY_CONFLICT_GUARD_V1105_SOURCE');
 assert.equal(emptyConflicts.body.horizonDate,'2026-11-26');
 assert.equal(emptyConflicts.body.complete,true);
 assert.equal(emptyConflicts.body.items.length,0);
 assert.equal((await request('/api/schedule/conflicts?startDate=bad&endDate=2026-11-12',undefined,cookie)).status,400);
 assert.equal((await request('/api/schedule/conflicts?startDate=2026-11-12&endDate=2026-11-10',undefined,cookie)).status,400);
 console.log('LEGACY_CONFLICT_GUARD_OWNER_AUTH_READ_BOUNDARY_POSTGRES_PASS');
 console.log('LEGACY_HOURLY_NEXT_15DAY_OWNER_READ_POSTGRES_SOURCE_PASS');
 console.log('LEGACY_HOURLY_CALENDAR_OWNER_READ_AND_COMPLETE_EMPTY_PASS');
 const capEmpty=await request('/api/capacity?durationWorkingDays=3',undefined,cookie);
 assert.equal(capEmpty.status,200,capEmpty.body.error);
 assert.equal(capEmpty.body.version,'CAPACITY_SCHEDULE_V1');
 assert.equal(capEmpty.body.timeBridgeVersion,'CALENDAR_TIME_ENGINE_MANUAL_V1121');
 assert.equal(capEmpty.body.time.version,'v1.12.0');
 assert.equal(capEmpty.body.time.durationSource,'MANUAL');
 assert.equal(capEmpty.body.time.durationWorkingDays,3);
 assert.equal(capEmpty.body.time.coverage,'EXPLICIT_MANUAL_WORKING_DAYS');
 assert.equal(capEmpty.body.time.readyForCapacity,true);
 assert.equal(capEmpty.body.time.durationHours,null);
 assert.equal(capEmpty.body.time.sourceRef,'CALENDAR_CAPACITY_FINDER_V1121');
 console.log('TIME_ENGINE_V1120_V1121_REAL_HTTP_POSTGRES_SINGLE_CAPACITY_SOURCE_PASS');
 assert.equal(capEmpty.body.sourceCoverage,'SCHEDULE_ONLY_NOT_FULL_DURATION');
 assert.equal(capEmpty.body.bookingReady,false);
 assert.equal(capEmpty.body.policyVersion,'SHARED_CAPACITY_MON_SAT_MONTHLY_BANK_REVIEW_V2');
 assert.equal(capEmpty.body.windows.length,3);
 assert.equal(capEmpty.body.unplannedOrders,0);
 assert.ok(capEmpty.body.days.length>=25);
 assert.equal((await request('/api/capacity?durationWorkingDays=0',undefined,cookie)).status,400);
 assert.equal((await request('/api/capacity?durationWorkingDays=61',undefined,cookie)).status,400);
 assert.equal((await request('/api/capacity?durationWorkingDays=3.5',undefined,cookie)).status,400);
 assert.equal((await request('/api/capacity?startDate=2026-02-31',undefined,cookie)).status,400);
 console.log('CAPACITY_V1_REAL_POSTGRES_EMPTY_BOUNDED_SOURCE_GUARDS_PASS');
 assert.equal((await request('/api/schedule?viewMode=bad',undefined,cookie)).status,400);
 assert.equal((await request('/api/schedule?viewMode=month&anchorDate=2026-02-31',undefined,cookie)).status,400);
 assert.equal(blankMyWork.body.sources.a1,'INDEPENDENT_API');
 assert.equal(blankMyWork.body.sources.physicalPresence,'INDEPENDENT_API');
 assert.equal(blankMyWork.body.sources.ownerBusinessTime,'INDEPENDENT_API');
 assert.match(cookie,/^vbos_sid=/);
 // B12 tests the ACTUAL owner setup cookie; B11's synthetic cookie is
 // deliberately not used. Financial posting stays disabled on the server.
 const csrf=await request('/api/finance/csrf',undefined,cookie);
 assert.equal(csrf.status,200);
 assert.equal(csrf.body.financialWriterEnabled,false);
 assert.match(csrf.body.token,/^[0-9a-f]{64}$/);
 assert.equal((await request('/api/finance/native-ledger-preview',undefined,cookie)).status,503);
 assert.equal((await request('/api/finance/cutover-readiness',undefined,cookie)).status,503);
 const financeAttempt={action:'FINANCE_CREATE',requestKey:randomUUID(),payload:{
  operationType:'INCOME',amountOriginal:'300',transactionDate:'2026-11-11'}};
 assert.equal((await request('/api/finance/native-action-preview',financeAttempt,cookie)).status,403,
  'Owner session alone does not satisfy dedicated finance CSRF');
 const csrfPost=async(extra={})=>{
  const response=await fetch(base+'/api/finance/native-action-preview',{
   method:'POST',headers:{
    'Content-Type':'application/json','Origin':base,'Cookie':cookie,
    ...extra
   },body:JSON.stringify(financeAttempt)
  });
  return {status:response.status,body:await response.json()};
 };
 assert.equal((await csrfPost({'X-Finance-CSRF':'f'.repeat(64)})).status,403);
 assert.equal((await csrfPost({'Origin':'https://untrusted.example',
  'X-Finance-CSRF':csrf.body.token})).status,403);
 assert.equal((await csrfPost({'Origin':base.replace('http:','https:'),
  'X-Finance-CSRF':csrf.body.token})).status,403,
  'Same host over a different scheme is not same-origin');
 const blockedWriter=await csrfPost({'X-Finance-CSRF':csrf.body.token});
 assert.equal(blockedWriter.status,503);
 assert.equal(blockedWriter.body.error,'FINANCE_B12_REAL_MONEY_WRITER_DISABLED');
 assert.equal((await database.query(
  "SELECT to_regclass('mvp_finance_native.transactions') IS NULL AS absent"
 )).rows[0].absent,true,'B12 must not install native finance schema');
 console.log('FINANCE_B12_REAL_OWNER_SESSION_CSRF_AND_NO_MONEY_WRITER_PASS');

 // B15: test actual signed owner session, exact Origin, session-bound CSRF.
 // B9 source absent in disposable DB -> safe, explicit 503 not a saved draft.
 const draftAttempt={mode:'finance',operationType:'INCOME',category:'other',
  transactionDateKey:'2026-10-14',amountAMD:'50.00',notes:'Только проверка'};
 assert.equal((await request('/api/finance/draft-validate',draftAttempt)).status,401);
 assert.equal((await request('/api/finance/draft-validate',draftAttempt,cookie)).status,403);
 const previewPost=async(extra={})=>{
  const response=await fetch(base+'/api/finance/draft-validate',{
   method:'POST',headers:{
    'Content-Type':'application/json','Origin':base,'Cookie':cookie,...extra
   },body:JSON.stringify(draftAttempt)
  });
  return {status:response.status,body:await response.json()};
 };
 assert.equal((await previewPost({'X-Finance-CSRF':'f'.repeat(64)})).status,403);
 assert.equal((await previewPost({'Origin':'https://untrusted.example',
  'X-Finance-CSRF':csrf.body.token})).status,403);
 assert.equal((await previewPost({'Origin':base.replace('http:','https:'),
  'X-Finance-CSRF':csrf.body.token})).status,403);
 const dry=await previewPost({'X-Finance-CSRF':csrf.body.token});
 assert.equal(dry.status,503);
 assert.equal(dry.body.error,'FINANCE_B15_SOURCE_UNAVAILABLE');
 assert.equal((await database.query(
  "SELECT to_regclass('mvp_finance_native.transactions') IS NULL AS absent"
 )).rows[0].absent,true);
 console.log('FINANCE_B15_REAL_OWNER_SESSION_ORIGIN_CSRF_DRYRUN_SOURCE_FAIL_CLOSED_PASS');

 // No history schema exists in this disposable CI database: source-gated endpoint must fail closed.
 const pendingHistoricalOrders=await request('/api/history/orders',undefined,cookie);
 assert.equal(pendingHistoricalOrders.status,503);
 assert.match(pendingHistoricalOrders.body.error,/Исторические заказы/);
 assert.equal((await request('/api/history',undefined,cookie)).status,200);
 const pendingAssessment=await request('/api/history/orders/assessment?id=WO-2026-0001',undefined,cookie);
 assert.equal(pendingAssessment.status,503);
 assert.match(pendingAssessment.body.error,/Исторические оценки/);
 const pendingFinanceArchive=await request('/api/history/finance',undefined,cookie);
 assert.equal(pendingFinanceArchive.status,503);
 assert.match(pendingFinanceArchive.body.error,/Исторические финансовые операции/);
 const pendingFinanceCapital=await request('/api/finance/archive',undefined,cookie);
 assert.equal(pendingFinanceCapital.status,503);
 assert.match(pendingFinanceCapital.body.error,/финансовый архив|Финансовый архив/i);
 assert.equal((await request('/api/finance/archive',{anything:'FORBIDDEN'},cookie)).status,404);
 const financeReviewPending=await request('/api/finance/reviews',undefined,cookie);
 assert.equal(financeReviewPending.status,503);
 const financeReviewWritePending=await request('/api/finance/review',{
  sourceKind:'FINANCE_TRANSACTION',sourceId:'FIN-CI-TEST',
  nextState:'REVIEWED',revision:0,requestKey:randomUUID()
 },cookie);
 assert.equal(financeReviewWritePending.status,503);
 assert.equal((await database.query("SELECT to_regclass('public.mvp_finance_history_review') IS NULL AS absent")).rows[0].absent,true);
 const pendingCorrections=await request('/api/finance/corrections',undefined,cookie);
 assert.equal(pendingCorrections.status,503);
 const pendingCorrectionWrite=await request('/api/finance/correction',{
  sourceKind:'FINANCE_TRANSACTION',sourceId:'FIN-CI-001',
  displayTitle:'Label',ownerNote:'Nonfinancial comment',revision:0,requestKey:randomUUID()
 },cookie);
 assert.equal(pendingCorrectionWrite.status,503);
 assert.equal((await database.query("SELECT to_regclass('public.mvp_finance_history_corrections') IS NULL AS absent")).rows[0].absent,true);
 const pendingAudit=await request('/api/finance/correction-audit?mode=capital',undefined,cookie);
 assert.equal(pendingAudit.status,503);
 assert.equal((await request('/api/finance/correction-audit?mode=bad',undefined,cookie)).status,400);
 console.log('FINANCE_CORRECTION_AUDIT_OWNER_AUTH_SOURCE_GATED_PASS');
 console.log('FINANCE_CORRECTION_OWNER_AUTH_NO_SCHEMA_FAIL_CLOSED_PASS');
 console.log('FINANCE_REVIEW_OWNER_GATE_NO_SOURCE_NO_WRITE_FAIL_CLOSED_PASS');
 console.log('FINANCE_CAPITAL_OWNER_AUTH_NO_SCHEMA_FAIL_CLOSED_NO_WRITE_PASS');
 console.log('V14_FINANCE_ARCHIVE_OWNER_GATE_AND_MISSING_SOURCE_FAIL_CLOSED_PASS');
 console.log('V13A_ASSESSMENT_OWNER_AUTH_NO_SCHEMA_FAIL_CLOSED_PASS');
 console.log('HISTORY_ORDERS_AUTH_SOURCE_GATE_NO_SCHEMA_FAIL_CLOSED_PASS');
 const referencePending=await request('/api/reference/services',undefined,cookie);
 assert.equal(referencePending.status,503);
 assert.match(referencePending.body.error,/Справочник услуг/);
 const refBatch='SERVICES_MASTERPRICES_V12_TEST_20261105_R1';
 await database.query("INSERT INTO public.mvp_service_reference_batches(batch_id,source_system,source_modified_at,services_count,prices_count,manifest_sha256,verified_at,status) VALUES ($1,'LEGACY_GOOGLE_VBOS','2026-11-03T19:06:09.263Z',37,1,$2,now(),'VERIFIED')",[refBatch,'fc85e0e51751b50c689fceaba8d6c273706a25e577e798df3e886deef3a8d674']);
 await database.query(`INSERT INTO public.mvp_services_reference(batch_id,service_id,created_at,updated_at,status,category,service_name,default_unit,notes,action_code)
  SELECT $1,'SRV-TEST-'||lpad(n::text,4,'0'), '2026-11-05T00:00:00Z','2026-11-05T00:00:00Z','active','Сантехника',
  'Пробная услуга '||n,'item','',CASE WHEN n=37 THEN NULL ELSE 'INSTALL' END
  FROM generate_series(1,37) n`,[refBatch]);
 await database.query("INSERT INTO public.mvp_master_prices_reference(batch_id,master_price_id,created_at,updated_at,status,master_id,service_id,price_type,price_from,price_to,currency,unit,valid_from) VALUES ($1,'MPR-TEST-0001','2026-11-05T00:00:00Z','2026-11-05T00:00:00Z','active','MST-TEST-0001','SRV-TEST-0001','range',3000,5000,'AMD','item','2026-08-16')",[refBatch]);
 const refFirst=await request('/api/reference/services?limit=20',undefined,cookie);
 assert.equal(refFirst.status,200,refFirst.body.error);
 assert.equal(refFirst.body.readonly,true);
 assert.equal(refFirst.body.items.length,20);
 assert.equal(refFirst.body.hasMore,true);
 assert.equal(refFirst.body.items[0].masterPrices[0].masterId,'MST-TEST-0001');
 assert.equal(refFirst.body.items[0].masterPrices[0].priceFrom,'3000.0000');
 assert.equal(refFirst.body.items[0].masterPrices[0].priceTo,'5000.0000');
 const refSecond=await request('/api/reference/services?limit=20&cursor='+refFirst.body.nextCursor,undefined,cookie);
 assert.equal(refSecond.status,200);
 assert.equal(refSecond.body.items.length,17);
 assert.equal(refSecond.body.hasMore,false);
 const refSearch=await request('/api/reference/services?q=0007',undefined,cookie);
 assert.equal(refSearch.status,200);
 assert.equal(refSearch.body.items.length,1);
 assert.equal(refSearch.body.items[0].serviceId,'SRV-TEST-0007');
 const refMissingAction=await request('/api/reference/services?action=unclassified',undefined,cookie);
 assert.equal(refMissingAction.status,200);
 assert.equal(refMissingAction.body.items.length,1);
 assert.equal(refMissingAction.body.items[0].actionCode,null);
 assert.equal((await request('/api/reference/services?limit=51',undefined,cookie)).status,400);
 assert.equal((await request('/api/reference/services?action=FAKE',undefined,cookie)).status,400);
 assert.equal((await request('/api/reference/services?cursor=%3Cbad%3E',undefined,cookie)).status,400);
 await assert.rejects(database.query("UPDATE public.mvp_services_reference SET service_name='altered' WHERE service_id='SRV-TEST-0001'"),e=>e.code==='55000');
 assert.equal((await database.query("SELECT count(*)::int AS n FROM public.mvp_services_reference")).rows[0].n,37);
 console.log('V12_SERVICE_MASTERPRICE_REAL_HTTP_OWNER_SEARCH_PAGE_IMMUTABLE_PASS');
 assert.equal((await request('/api/bootstrap')).body.setupRequired,false);
 assert.equal((await request('/api/setup',{claimCode:claim,login:'another',password})).status,409);
 assert.equal((await request('/api/action',{type:'day_open',payload:{}})).status,401);
 console.log('OWNER_SETUP_AUTH_AND_DENY_BY_DEFAULT_PASS');


 const emptyA1=await request('/api/a1',undefined,cookie);
 assert.equal(emptyA1.status,200);
 assert.equal(emptyA1.body.item,null);
 assert.equal(emptyA1.body.coupledToWorkDay,false);
 assert.equal(emptyA1.body.coupledToWorkOrder,false);
 const a1Day=emptyA1.body.date;
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_days')).rows[0].n,0);
 const createA1Key=randomUUID();
 const a1Created=await create('a1_save',{date:a1Day,revision:0,goal:'Главная цель V6',reason:'Проверка независимой A1',notes:'Без WorkDay',requestKey:createA1Key},cookie);
 assert.equal(a1Created.id,'DA1-'+a1Day);
 assert.equal(a1Created.status,'open');
 assert.equal(a1Created.revision,1);
 const firstReplay=await request('/api/action',{type:'a1_save',payload:{date:a1Day,revision:0,goal:'Главная цель V6',reason:'Проверка независимой A1',notes:'Без WorkDay',requestKey:createA1Key}},cookie);
 assert.equal(firstReplay.status,200);
 assert.equal(firstReplay.body.deduplicated,true);
 assert.equal(firstReplay.body.item.revision,1);
 const mismatchReplay=await request('/api/action',{type:'a1_save',payload:{date:a1Day,revision:0,goal:'Другая цель',reason:'Проверка независимой A1',notes:'Без WorkDay',requestKey:createA1Key}},cookie);
 assert.equal(mismatchReplay.status,409);
 assert.equal((await request('/api/action',{type:'a1_save',payload:{date:a1Day,revision:0,goal:'Перезапись',reason:'Нет'}},cookie)).status,409);
 const beforeDays=await database.query('SELECT count(*)::int n FROM public.mvp_work_days');
 assert.equal(beforeDays.rows[0].n,0,'A1 must not create a WorkDay');
 const a1Update=await create('a1_save',{date:a1Day,id:a1Created.id,revision:1,goal:'Цель изменена',reason:'Уточнена причина',notes:'Без связи с работами'},cookie);
 assert.equal(a1Update.id,a1Created.id);
 assert.equal(a1Update.revision,2);
 assert.equal((await request('/api/action',{type:'a1_complete',payload:{date:a1Day,id:a1Update.id,revision:2,outcome:'BAD'}},cookie)).status,400);
 const completeKey=randomUUID();
 const a1Done=await create('a1_complete',{date:a1Day,id:a1Update.id,revision:2,outcome:'PARTIAL',outcomeNote:'Сделана половина',requestKey:completeKey},cookie);
 assert.equal(a1Done.status,'completed');
 assert.equal(a1Done.outcome,'PARTIAL');
 assert.equal(a1Done.outcome_note,'Сделана половина');
 assert.equal(a1Done.revision,3);
 const repeatedComplete=await request('/api/action',{type:'a1_complete',payload:{date:a1Day,id:a1Update.id,revision:2,outcome:'PARTIAL',outcomeNote:'Сделана половина',requestKey:completeKey}},cookie);
 assert.equal(repeatedComplete.status,200);
 assert.equal(repeatedComplete.body.deduplicated,true);
 assert.equal((await request('/api/action',{type:'a1_complete',payload:{date:a1Day,id:a1Update.id,revision:2,outcome:'COMPLETED'}},cookie)).status,409);
 const a1Reopened=await create('a1_reopen',{date:a1Day,id:a1Done.id,revision:3},cookie);
 assert.equal(a1Reopened.status,'open');
 assert.equal(a1Reopened.outcome,'');
 assert.equal(a1Reopened.outcome_note,'');
 assert.equal(a1Reopened.revision,4);
 assert.equal((await request('/api/action',{type:'a1_reopen',payload:{date:a1Day,id:a1Done.id,revision:3}},cookie)).status,409);
 const pastA1=await create('a1_save',{date:'2026-09-01',revision:0,goal:'Старая цель',reason:'Другой день'},cookie);
 assert.equal(pastA1.id,'DA1-2026-09-01');
 const savedA1=await request('/api/a1',undefined,cookie);
 assert.equal(savedA1.body.item.goal,'Цель изменена');
 assert.equal(savedA1.body.item.revision,4);
 const a1Backup=await request('/api/export',undefined,cookie);
 assert.equal(a1Backup.status,200,a1Backup.body.error);
 assert.equal(a1Backup.body.a1Records.length,2);
 assert.deepEqual(new Set(a1Backup.body.a1Records.map(x=>x.id)),new Set([a1Created.id,pastA1.id]));
 assert.equal((await request('/api/export')).status,401);

 const earlierA1=await request('/api/a1?date=2026-09-01',undefined,cookie);
 assert.equal(earlierA1.body.item.id,pastA1.id);
 assert.equal((await request('/api/a1?date=2026-02-31',undefined,cookie)).status,400);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_days')).rows[0].n,0);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n,0);
 const trueA1Rows=await database.query('SELECT count(*)::int n,count(DISTINCT day_date)::int dates FROM public.mvp_daily_a1');
 assert.deepEqual(trueA1Rows.rows[0],{n:2,dates:2});
 console.log('V6_A1_INDEPENDENT_DAY_ID_REVISION_REPLAY_OUTCOME_REOPEN_POSTGRES_PASS');


 // V8: owner business time is independent of WorkDay, presence and WorkLog.
 const ownerBlank=await request('/api/owner-activity',undefined,cookie);
 assert.equal(ownerBlank.status,200,ownerBlank.body.error);
 assert.equal(ownerBlank.body.active,null);
 assert.equal(ownerBlank.body.trackingSince,null,'no prior tracking means unavailable, not zero history');
 assert.equal(ownerBlank.body.model.physicalPresence,'not_inferred');
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_days')).rows[0].n,0);
 const firstOwnerKey=randomUUID();
 const oPayload={type:'owner_activity_start',payload:{activityClass:'ORGANIZATION',startTime:'2026-09-02T23:30',summary:'Управление',notes:'Ночная задача',requestKey:firstOwnerKey}};
 const ownerStarted=await request('/api/action',oPayload,cookie);
 assert.equal(ownerStarted.status,200,ownerStarted.body.error);
 assert.equal(ownerStarted.body.saved,true);
 assert.equal(ownerStarted.body.item.status,'active');
 assert.equal(ownerStarted.body.item.work_day_id,null);
 assert.equal(ownerStarted.body.item.date,'2026-09-02');
 const ownerId=ownerStarted.body.item.id;
 const ownerReplay=await request('/api/action',oPayload,cookie);
 assert.equal(ownerReplay.status,200);
 assert.equal(ownerReplay.body.deduplicated,true);
 assert.equal(ownerReplay.body.item.id,ownerId);
 assert.equal((await request('/api/action',{type:'owner_activity_start',payload:{activityClass:'BUSINESS_SYSTEM',startTime:'2026-09-02T23:45'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'owner_activity_start',payload:{activityClass:'BAD',startTime:'2026-09-02T09:00'}},cookie)).status,400);
 const stopKey=randomUUID();
 const stopPayload={type:'owner_activity_stop',payload:{id:ownerId,revision:1,endTime:'2026-09-04T00:15',requestKey:stopKey}};
 const stopped=await request('/api/action',stopPayload,cookie);
 assert.equal(stopped.status,200,stopped.body.error);
 assert.equal(stopped.body.splitCount,2);
 assert.equal(stopped.body.totalDurationMinutes,1485);
 assert.equal(stopped.body.item.duration_minutes,30);
 assert.equal(stopped.body.item.revision,2);
 assert.equal((await request('/api/action',stopPayload,cookie)).body.deduplicated,true);
 const segmentRows=await database.query("SELECT day_date::text AS day_date,duration_minutes, status FROM public.mvp_owner_activities ORDER BY day_date");
 assert.deepEqual(segmentRows.rows.map(x=>[x.day_date,x.duration_minutes,x.status]),[
  ['2026-09-02',30,'completed'],['2026-09-03',1440,'completed'],['2026-09-04',15,'completed']
 ]);
 const day3Owner=await request('/api/owner-activity?date=2026-09-03',undefined,cookie);
 assert.equal(day3Owner.status,200);
 assert.equal(day3Owner.body.totals.ORGANIZATION,1440);
 assert.equal(day3Owner.body.trackingSince,'2026-09-02');
 const correctedOwner=await create('owner_activity_update',{id:ownerId,revision:2,activityClass:'BUSINESS_SYSTEM',startTime:'2026-09-02T23:20',endTime:'2026-09-03T00:00',summary:'Изменено',notes:'За полночь'},cookie);
 assert.equal(correctedOwner.id,ownerId);
 assert.equal(correctedOwner.duration_minutes,40);
 assert.equal(correctedOwner.activity_class,'BUSINESS_SYSTEM');
 assert.equal(correctedOwner.revision,3);
 assert.equal((await request('/api/action',{type:'owner_activity_update',payload:{id:ownerId,revision:2,activityClass:'ORGANIZATION',startTime:'2026-09-02T23:10',endTime:'2026-09-03T00:00'}},cookie)).status,409);
 const archivedOwner=await create('owner_activity_archive',{id:ownerId,revision:3},cookie);
 assert.equal(archivedOwner.status,'archived');
 assert.equal((await request('/api/action',{type:'owner_activity_archive',payload:{id:ownerId,revision:3}},cookie)).status,409);
 assert.equal((await request('/api/owner-activity?date=2026-09-02',undefined,cookie)).body.items.length,0);
 assert.equal((await request('/api/action',{type:'owner_activity_start',payload:{activityClass:'ORGANIZATION',startTime:'2026-09-02T09:00',relatedEntityType:'Client',relatedEntityId:randomUUID()}},cookie)).status,400);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_days')).rows[0].n,0);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n,0);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_object_presence')).rows[0].n,0);
 const afterOwnerExport=await request('/api/export',undefined,cookie);
 assert.equal(afterOwnerExport.status,200,afterOwnerExport.body.error);
 assert.equal(afterOwnerExport.body.ownerActivityRecords.length,3);
 assert.equal(afterOwnerExport.body.ownerActivityRecords.some(x=>x.status==='archived'),true);
 console.log('V8_OWNER_ACTIVITY_NIGHT_SPLIT_REVISION_ARCHIVE_IDEMPOTENCE_INDEPENDENCE_POSTGRES_PASS');

 const leadKey=randomUUID();
 const lead=await create('lead_create',{title:'Test lead',contactName:'Synthetic',requestKey:leadKey},cookie);
 const replay=await create('lead_create',{title:'Test lead',contactName:'Synthetic',requestKey:leadKey},cookie);
 assert.equal(lead.id,replay.id);
 const client=await create('client_create',{name:'Synthetic client'},cookie);
 const object=await create('object_create',{clientId:client.id,name:'Synthetic object',objectType:'Квартира'},cookie);
 assert.equal(object.object_type,'Квартира');
 const editedClient=await create('client_update',{id:client.id,revision:client.revision,name:'Corrected client',phone:'+37410000000',notes:'Updated'},cookie);
 assert.equal(editedClient.id,client.id);
 assert.equal(editedClient.revision,client.revision+1);
 assert.equal((await request('/api/action',{type:'client_update',payload:{id:client.id,revision:client.revision,name:'Stale overwrite'}},cookie)).status,409);
 const profile=await create('client_update',{id:client.id,revision:editedClient.revision,name:editedClient.name,
  phone:editedClient.phone,notes:editedClient.notes,email:'crm15@example.test',address:'Street 1',
  status:'active',clientTier:'vip',referralStatus:'one',clientLabelNote:'Completed repeat job'},cookie);
 assert.equal(profile.id,client.id);assert.equal(profile.email,'crm15@example.test');
 assert.equal(profile.address,'Street 1');assert.equal(profile.client_tier,'vip');
 assert.equal(profile.referral_status,'one');assert.equal(profile.client_label_note,'Completed repeat job');
 const compatible=await create('client_update',{id:client.id,revision:profile.revision,name:profile.name,phone:profile.phone,notes:profile.notes},cookie);
 assert.equal(compatible.email,profile.email);assert.equal(compatible.client_tier,'vip');
 assert.equal((await request('/api/action',{type:'client_update',payload:{id:client.id,revision:compatible.revision,name:profile.name,status:'bad'}},cookie)).status,400);
 console.log('CRM15A_REAL_POSTGRES_CLIENT_PROFILE_REVISION_ENUM_COMPAT_PASS');


 const originalObjectVersion=(await request('/api/state',undefined,cookie)).body.objects[0].row_version;
 const editedObject=await create('object_update',{id:object.id,rowVersion:originalObjectVersion,name:'Corrected object',address:'Test address',objectType:'Частный дом',notes:'Adjusted'},cookie);
 assert.equal(editedObject.object_type,'Частный дом');
 assert.equal((await request('/api/state',undefined,cookie)).body.objects.find(x=>x.id===object.id).object_type,'Частный дом');
 assert.equal(editedObject.id,object.id);
 assert.equal(editedObject.client_id,client.id);
 assert.equal((await request('/api/action',{type:'presence_start',payload:{objectId:object.id,arrivalTime:'08:30'}},cookie)).status,409);
 assert.notEqual(editedObject.row_version,originalObjectVersion);
 assert.equal((await request('/api/action',{type:'object_update',payload:{id:object.id,rowVersion:originalObjectVersion,name:'Stale object'}},cookie)).status,409);
 // CRM-01: cannot mark won without committing a canonical Client relation.
 assert.equal((await request('/api/action',{type:'lead_status',payload:{id:lead.id,revision:lead.revision,status:'won'}},cookie)).status,409);
 const earlyOrder=await request('/api/action',{type:'order_create',payload:{objectId:object.id,leadId:lead.id,title:'Blocked unlinked source',requestKey:randomUUID()}},cookie);
 assert.equal(earlyOrder.status,409);
 const convertKey=randomUUID();
 const conversion={leadId:lead.id,revision:lead.revision,clientId:client.id,objectId:object.id,requestKey:convertKey};
 const converted=await request('/api/action',{type:'lead_convert',payload:conversion},cookie);
 assert.equal(converted.status,200,converted.body.error);
 assert.equal(converted.body.source,'CLEAN_CRM01_ATOMIC_CONVERSION');
 assert.equal(converted.body.conversion,'linked_existing');
 assert.equal(converted.body.clientId,client.id);
 assert.equal(converted.body.objectId,object.id);
 // Old VBOS parity: agreement is one Lead journal note and linked Order stays explicit.
 const agreement=await database.query(
  'SELECT id,request_key,entity_type,interaction_type,summary FROM public.mvp_crm_interactions WHERE request_key=$1',[convertKey]);
 assert.equal(agreement.rowCount,1);
 assert.equal(agreement.rows[0].entity_type,'Lead');
 assert.equal(agreement.rows[0].interaction_type,'note');
 assert.match(agreement.rows[0].summary,/Договорились/);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_orders WHERE lead_id=$1',[lead.id])).rows[0].n,0);
 const clientTimeline=await request('/api/crm/interactions?entityType=Client&entityId='+client.id+'&unified=1',undefined,cookie);
 assert.equal(clientTimeline.status,200,clientTimeline.body.error);
 assert.equal(clientTimeline.body.items.some(i=>i.id===agreement.rows[0].id),true);
 assert.equal((await request('/api/action',{type:'lead_convert',payload:conversion},cookie)).body.deduplicated,true);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_interactions WHERE request_key=$1',[convertKey])).rows[0].n,1);
 assert.equal((await request('/api/action',{type:'lead_convert',payload:{...conversion,objectId:''}},cookie)).status,409);
 const crm01InitialLink=(await database.query('SELECT client_id,object_id FROM public.mvp_crm_lead_client_links WHERE lead_id=$1',[lead.id])).rows[0];
 assert.equal(crm01InitialLink.client_id,client.id);assert.equal(crm01InitialLink.object_id,object.id);
 assert.equal((await database.query('SELECT status,revision FROM public.mvp_leads WHERE id=$1',[lead.id])).rows[0].status,'won');
 assert.equal((await request('/api/action',{type:'lead_status',payload:{id:lead.id,revision:lead.revision+1,status:'contacted'}},cookie)).status,409);
 const crmState=(await request('/api/state',undefined,cookie)).body;
 assert.equal(crmState.leadClientLinks.some(x=>x.lead_id===lead.id&&x.client_id===client.id),true);
 console.log('CRM01_EXISTING_CLIENT_EXPLICIT_LINK_ORDER_SOURCE_REPLAY_WON_GUARD_PASS');
 const now=(await request('/api/state',undefined,cookie)).body.today;
 const order=await create('order_create',{objectId:object.id,leadId:lead.id,title:'Synthetic heating order',plannedOn:now},cookie);
 // OBJECT_CARD_LEGACY_PARITY_BATCH1: exact owner-only object order list,
 // directly after durable new order creation; no additional test records.
 assert.equal((await request('/api/objects/orders?id='+object.id)).status,401);
 const objectOrders=await request('/api/objects/orders?id='+object.id,undefined,cookie);
 assert.equal(objectOrders.status,200,objectOrders.body.error);
 assert.equal(objectOrders.body.objectId,object.id);
 assert.equal(objectOrders.body.clientId,client.id);
 assert.equal(objectOrders.body.hasMore,false);
 assert.equal(objectOrders.body.items.some(x=>x.id===order.id&&x.object_id===object.id),true);
 assert.equal(objectOrders.body.items.find(x=>x.id===order.id).object_name,'Corrected object');
 assert.equal((await request('/api/objects/orders?id=invalid',undefined,cookie)).status,400);
 console.log('OBJECT_CARD_EXACT_OBJECT_OWNER_AUTH_PERSISTED_ORDER_POSTGRES_PASS');
 // BATCH2: legacy Object contact, exact local datetime, strict owner-only scope.
 assert.equal((await request('/api/objects/interactions?id='+object.id)).status,401);
 const contactKey=randomUUID();
 const contactPayload={entityType:'Object',entityId:object.id,interactionType:'call',
  summary:'Осмотр объекта',nextAction:'Созвониться',nextActionAt:'2026-11-15T14:30',
  notes:'Проверить материалы',requestKey:contactKey};
 assert.equal((await request('/api/action',{type:'object_interaction_add',payload:contactPayload})).status,401);
 const contactFirst=await request('/api/action',{type:'object_interaction_add',payload:contactPayload},cookie);
 assert.equal(contactFirst.status,200,contactFirst.body.error);
 assert.equal(contactFirst.body.item.entityId,object.id);
 assert.equal(contactFirst.body.item.nextActionAt,'2026-11-15T14:30');
 const replayContact=await request('/api/action',{type:'object_interaction_add',payload:contactPayload},cookie);
 assert.equal(replayContact.status,200);assert.equal(replayContact.body.deduplicated,true);
 assert.equal(replayContact.body.item.id,contactFirst.body.item.id);
 assert.equal((await request('/api/action',{type:'object_interaction_add',
  payload:{...contactPayload,summary:'Другое содержание'}},cookie)).status,409);
 for(const input of [
  {...contactPayload,requestKey:randomUUID(),nextActionAt:'2026-02-30T14:30'},
  {...contactPayload,requestKey:randomUUID(),nextAction:''},
  {...contactPayload,requestKey:randomUUID(),entityId:randomUUID()},
  {...contactPayload,requestKey:randomUUID(),entityType:'Client'}
 ]){
  const resp=await request('/api/action',{type:'object_interaction_add',payload:input},cookie);
  assert.equal(resp.status,input.entityId!==object.id?404:400,resp.body.error);
 }
 const secondContact=await request('/api/action',{type:'object_interaction_add',payload:{
  entityType:'Object',entityId:object.id,interactionType:'note',summary:'Повторный контакт',
  requestKey:randomUUID()
 }},cookie);
 assert.equal(secondContact.status,200,secondContact.body.error);
 const objectContactFirstPage=await request('/api/objects/interactions?id='+object.id+'&limit=1',undefined,cookie);
 assert.equal(objectContactFirstPage.status,200,objectContactFirstPage.body.error);
 assert.equal(objectContactFirstPage.body.items.length,1);assert.equal(objectContactFirstPage.body.hasMore,true);
 const objectContactSecondPage=await request('/api/objects/interactions?id='+object.id+'&limit=1&cursor='+
  encodeURIComponent(objectContactFirstPage.body.nextCursor),undefined,cookie);
 assert.equal(objectContactSecondPage.status,200,objectContactSecondPage.body.error);
 assert.equal(objectContactSecondPage.body.items.length,1);
 assert.notEqual(objectContactSecondPage.body.items[0].id,objectContactFirstPage.body.items[0].id);
 assert.equal(objectContactSecondPage.body.items[0].entityId,object.id);
 assert.equal((await request('/api/objects/interactions?id='+randomUUID()+'&limit=1&cursor='+
  encodeURIComponent(objectContactFirstPage.body.nextCursor),undefined,cookie)).status,400);
 assert.equal((await request('/api/objects/interactions?id='+randomUUID(),undefined,cookie)).status,404);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_object_interactions WHERE object_id=$1',[object.id])).rows[0].n,2);
 const objectContactExport=await request('/api/export',undefined,cookie);
 assert.equal(objectContactExport.status,200,objectContactExport.body.error);
 assert.ok(Array.isArray(objectContactExport.body.objectInteractions));
 assert.deepEqual(new Set(objectContactExport.body.objectInteractions.filter(x=>x.object_id===object.id).map(x=>x.id)),
  new Set([contactFirst.body.item.id,secondContact.body.item.id]));
 console.log('OBJECT_CONTACTS_OWNER_EXPORT_INCLUDES_ALL_NEW_RECORDS_PASS');
 console.log('OBJECT_CARD_BATCH2_OWNER_AUTH_TYPE_CONTACT_DATETIME_IDEMPOTENCY_CURSOR_POSTGRES_PASS');
 // ORDER_CONTACT_JOURNAL_BATCH1: communications belong solely to exact WorkOrder UUID.
 const orderContactPath='/api/orders/interactions?id='+order.id;
 assert.equal((await request(orderContactPath)).status,401);
 assert.equal((await request('/api/action',{type:'order_interaction_add',payload:{
  entityType:'Order',entityId:order.id,summary:'Без сессии',requestKey:randomUUID()}})).status,401);
 const orderContactKey=randomUUID();
 const orderContactPayload={entityType:'Order',entityId:order.id,interactionType:'call',
  summary:'Согласовали дату монтажа',nextAction:'Позвонить мастеру',
  nextActionAt:'2026-11-15T14:30',notes:'Синтетическая договорённость',requestKey:orderContactKey};
 const beforeOrderContactLogs=(await database.query('SELECT count(*)::int n FROM public.mvp_work_logs WHERE order_id=$1',[order.id])).rows[0].n;
 const beforeOrderContactObjectEvents=(await database.query('SELECT count(*)::int n FROM public.mvp_object_interactions WHERE object_id=$1',[object.id])).rows[0].n;
 const savedOrderContact=await request('/api/action',{type:'order_interaction_add',payload:orderContactPayload},cookie);
 assert.equal(savedOrderContact.status,200,savedOrderContact.body.error);
 assert.equal(savedOrderContact.body.item.entityType,'Order');
 assert.equal(savedOrderContact.body.item.entityId,order.id);
 assert.equal(savedOrderContact.body.item.nextActionAt,'2026-11-15T14:30');
 const duplicateOrderContact=await request('/api/action',{type:'order_interaction_add',payload:orderContactPayload},cookie);
 assert.equal(duplicateOrderContact.status,200,duplicateOrderContact.body.error);
 assert.equal(duplicateOrderContact.body.deduplicated,true);
 assert.equal(duplicateOrderContact.body.item.id,savedOrderContact.body.item.id);
 assert.equal((await request('/api/action',{type:'order_interaction_add',
  payload:{...orderContactPayload,summary:'Изменено содержание'}},cookie)).status,409);
 for(const bad of [
  {...orderContactPayload,requestKey:randomUUID(),nextActionAt:'2026-02-30T14:30'},
  {...orderContactPayload,requestKey:randomUUID(),nextAction:''},
  {...orderContactPayload,requestKey:randomUUID(),entityType:'Object'},
  {...orderContactPayload,requestKey:randomUUID(),entityId:randomUUID()}
 ]){
  const rejected=await request('/api/action',{type:'order_interaction_add',payload:bad},cookie);
  assert.equal(rejected.status,bad.entityId!==order.id?404:400,rejected.body.error);
 }
 const anotherOrderContact=await request('/api/action',{type:'order_interaction_add',payload:{
  entityType:'Order',entityId:order.id,interactionType:'note',summary:'Дополнительная договорённость',
  requestKey:randomUUID()}},cookie);
 assert.equal(anotherOrderContact.status,200,anotherOrderContact.body.error);
 const orderContactsPage1=await request(orderContactPath+'&limit=1',undefined,cookie);
 assert.equal(orderContactsPage1.status,200,orderContactsPage1.body.error);
 assert.equal(orderContactsPage1.body.orderId,order.id);
 assert.equal(orderContactsPage1.body.items.length,1);
 assert.equal(orderContactsPage1.body.hasMore,true);
 const orderContactsPage2=await request(orderContactPath+'&limit=1&cursor='+
  encodeURIComponent(orderContactsPage1.body.nextCursor),undefined,cookie);
 assert.equal(orderContactsPage2.status,200,orderContactsPage2.body.error);
 assert.equal(orderContactsPage2.body.items.length,1);
 assert.notEqual(orderContactsPage2.body.items[0].id,orderContactsPage1.body.items[0].id);
 assert.equal(orderContactsPage2.body.items[0].entityId,order.id);
 assert.equal((await request('/api/orders/interactions?id='+randomUUID()+'&limit=1&cursor='+
  encodeURIComponent(orderContactsPage1.body.nextCursor),undefined,cookie)).status,400);
 assert.equal((await request('/api/orders/interactions?id='+randomUUID(),undefined,cookie)).status,404);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_order_interactions WHERE order_id=$1',[order.id])).rows[0].n,2);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_logs WHERE order_id=$1',[order.id])).rows[0].n,beforeOrderContactLogs);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_object_interactions WHERE object_id=$1',[object.id])).rows[0].n,beforeOrderContactObjectEvents);
 const orderContactExport=await request('/api/export',undefined,cookie);
 assert.equal(orderContactExport.status,200,orderContactExport.body.error);
 assert.ok(Array.isArray(orderContactExport.body.orderInteractions));
 assert.deepEqual(new Set(orderContactExport.body.orderInteractions.filter(x=>x.order_id===order.id).map(x=>x.id)),
  new Set([savedOrderContact.body.item.id,anotherOrderContact.body.item.id]));
 console.log('ORDER_CONTACTS_OWNER_AUTH_REPLAY_CROSS_SCOPE_PAGING_BACKUP_NO_WORKLOG_MUTATION_PG_PASS');

 const exactCapacity=await request('/api/orders/capacity-context?id='+order.id,undefined,cookie);
 assert.equal(exactCapacity.status,200,exactCapacity.body.error);
 assert.equal(exactCapacity.body.version,'WORKORDER_CAPACITY_EXACT_V191_192');
 assert.equal(exactCapacity.body.source,'MVP_ORDERS_OBJECTS_ID');
 assert.equal(exactCapacity.body.orderId,order.id);
 assert.equal(exactCapacity.body.objectId,object.id);
 assert.equal(exactCapacity.body.objectName,'Corrected object');
 assert.equal(exactCapacity.body.title,'Synthetic heating order');
 assert.equal(exactCapacity.body.plannedStartDate,now);
 assert.equal(exactCapacity.body.status,'open');
 assert.equal(exactCapacity.body.bookingReady,false);
 assert.equal((await request('/api/orders/capacity-context?id=not-a-uuid',undefined,cookie)).status,400);
 assert.equal((await request('/api/orders/capacity-context?id='+randomUUID(),undefined,cookie)).status,404);
 console.log('WORKORDER_CAPACITY_EXACT_OWNER_AUTH_CANONICAL_OBJECT_ID_POSTGRES_PASS');
 const afterOrder=(await request('/api/state',undefined,cookie)).body;
 assert.equal(afterOrder.orders.length,1);
 assert.equal(afterOrder.orders[0].title,'Synthetic heating order');
 assert.equal(afterOrder.objects[0].client_id,client.id);
 assert.equal(afterOrder.objects[0].name,'Corrected object');
 assert.equal(afterOrder.clients.find(x=>x.id===client.id)?.name,'Corrected client',
  'CRM01 must preserve the exact related Client regardless of list sort order');
 const currentAuto=(await database.query('SELECT * FROM public.mvp_schedule_order_items WHERE order_id=$1',[order.id])).rows[0];
 assert.equal(currentAuto.order_id,order.id);
 assert.equal(currentAuto.auto_source_key,'WORKORDER|'+order.id);
 assert.equal(currentAuto.source_kind,'work_order');
 assert.equal(currentAuto.status,'planned');
 assert.equal(String(currentAuto.schedule_date instanceof Date?currentAuto.schedule_date.toISOString():currentAuto.schedule_date).slice(0,10),now);
 assert.equal(new Date(currentAuto.start_at).toISOString().slice(11,16),'05:00');
 assert.equal(new Date(currentAuto.end_at).toISOString().slice(11,16),'06:00');
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_schedule_items')).rows[0].n,0);
 // V13b: preview never implies an order has confirmed finance or a close writer.
 const closeNative=await request('/api/orders/close-preview?id='+order.id,undefined,cookie);
 assert.equal(closeNative.status,200,closeNative.body.error);
 assert.equal(closeNative.body.readonly,true);
 assert.equal(closeNative.body.previewOnly,true);
 assert.equal(closeNative.body.canClose,false);
 assert.equal(closeNative.body.order.googleOwned,false);
 assert.equal(closeNative.body.finance.status,'UNVERIFIED_IN_CLEAN');
 assert.equal(closeNative.body.counts.pendingAutoPlans,1);
 assert.ok(closeNative.body.blockers.some(x=>x.includes('транзакция закрытия')));
 assert.equal((await request('/api/orders/close-preview?id=not-uuid',undefined,cookie)).status,400);
 assert.equal((await request('/api/orders/close-preview?id='+randomUUID(),undefined,cookie)).status,404);
 const directDoneKey=randomUUID();
 const denyDone=await request('/api/action',{type:'order_status',payload:{id:order.id,revision:order.revision,status:'done',requestKey:directDoneKey}},cookie);
 assert.equal(denyDone.status,409);
 assert.equal((await database.query("SELECT count(*)::int n FROM public.mvp_order_schedule_requests WHERE request_key=$1",[directDoneKey])).rows[0].n,0);
 assert.equal((await database.query("SELECT status FROM public.mvp_orders WHERE id=$1",[order.id])).rows[0].status,'open');
 console.log('V13B_NATIVE_DONE_SHORTCUT_BLOCKED_PREVIEW_ONLY_PASS');

  const orderPlanDuplicate=await create('order_create',{objectId:object.id,leadId:lead.id,title:'Synthetic heating order',plannedOn:now,requestKey:order.request_key},cookie);
 assert.equal(orderPlanDuplicate.id,order.id);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_schedule_order_items')).rows[0].n,1);
 


 // V9C: owner-authenticated worker profiles, phone dedup, stable IDs, order assignment and replay.
 const workerKey=randomUUID();
 const workerCreate={type:'worker_create',payload:{name:'Арам Сотрудник',phone:'+374 91 777 221',roleTitle:'Монтажник',notes:'Тестовый сотрудник',requestKey:workerKey}};
 const workerFirst=await request('/api/action',workerCreate,cookie);
 assert.equal(workerFirst.status,200,workerFirst.body.error);
 const worker=workerFirst.body.item;
 assert.equal(worker.status,'active');
 assert.equal(worker.name,'Арам Сотрудник');
 assert.equal(worker.phone_key,'37491777221');
 assert.equal((await request('/api/action',workerCreate,cookie)).body.deduplicated,true);
 assert.equal((await request('/api/action',{type:'worker_create',payload:{...workerCreate.payload,name:'Повтор под тем же ключом'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'worker_create',payload:{name:'Дубликат',phone:'374-91-777-221'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'worker_create',payload:{name:'Плохой телефон',phone:'123'}},cookie)).status,400);
 const secondWorker=await create('worker_create',{name:'Второй сотрудник',phone:'091234567',roleTitle:'Помощник'},cookie);
 assert.notEqual(secondWorker.id,worker.id);
 const renamedWorker=await create('worker_update',{id:worker.id,revision:worker.revision,name:'Арам Исполнитель',phone:'+374 91 777 221',roleTitle:'Мастер',notes:'Обновлено',status:'active'},cookie);
 assert.equal(renamedWorker.revision,worker.revision+1);
 assert.equal((await request('/api/action',{type:'worker_update',payload:{id:worker.id,revision:1,name:'Старые данные'}},cookie)).status,409);
 // V9C transaction race: a concurrent close must win before assignment validation.
 await database.query('BEGIN');
 await database.query('SELECT id FROM public.mvp_orders WHERE id=$1 FOR UPDATE',[order.id]);
 const closingRace=request('/api/action',{type:'worker_assign_order',payload:{workerId:worker.id,orderId:order.id,requestKey:randomUUID()}},cookie);
 await sleep(200);
 await database.query("UPDATE public.mvp_orders SET status='cancelled' WHERE id=$1",[order.id]);
 await database.query('COMMIT');
 const closeResult=await closingRace;
 assert.equal(closeResult.status,409,'Assignment must reject an order closed during a row lock');
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_worker_order_assignments WHERE order_id=$1',[order.id])).rows[0].n,0);
 await database.query("UPDATE public.mvp_orders SET status='open' WHERE id=$1",[order.id]);
 // The same serialized decision is required when the worker is deactivated.
 await database.query('BEGIN');
 await database.query('SELECT id FROM public.mvp_workers WHERE id=$1 FOR UPDATE',[worker.id]);
 const inactiveRace=request('/api/action',{type:'worker_assign_order',payload:{workerId:worker.id,orderId:order.id,requestKey:randomUUID()}},cookie);
 await sleep(200);
 await database.query("UPDATE public.mvp_workers SET status='inactive' WHERE id=$1",[worker.id]);
 await database.query('COMMIT');
 assert.equal((await inactiveRace).status,409,'Assignment must reject a concurrently deactivated worker');
 await database.query("UPDATE public.mvp_workers SET status='active' WHERE id=$1",[worker.id]);
 // A manual plan + worker assignment is atomic under the same status transition.
 await database.query('BEGIN');
 await database.query('SELECT id FROM public.mvp_workers WHERE id=$1 FOR UPDATE',[worker.id]);
 const manualRace=request('/api/action',{type:'schedule_save',payload:{revision:0,startAt:'2027-03-03T08:00',endAt:'2027-03-03T09:00',itemType:'Тест',title:'V9C concurrency rollback',workerId:worker.id,requestKey:randomUUID()}},cookie);
 await sleep(200);
 await database.query("UPDATE public.mvp_workers SET status='inactive' WHERE id=$1",[worker.id]);
 await database.query('COMMIT');
 assert.equal((await manualRace).status,409,'Manual plan must not persist assignment after worker is deactivated');
 assert.equal((await database.query("SELECT count(*)::int n FROM public.mvp_schedule_items WHERE title='V9C concurrency rollback'")).rows[0].n,0);
 await database.query("UPDATE public.mvp_workers SET status='active' WHERE id=$1",[worker.id]);
 console.log('V9C_CONCURRENT_CLOSE_DEACTIVATE_ASSIGNMENT_SERIALIZATION_PASS');

 const assignmentKey=randomUUID();
 const orderWorkerPayload={type:'worker_assign_order',payload:{workerId:worker.id,orderId:order.id,requestKey:assignmentKey}};
 const workerAssigned=await request('/api/action',orderWorkerPayload,cookie);
 assert.equal(workerAssigned.status,200,workerAssigned.body.error);
 const firstWorkerLink=workerAssigned.body.item;
 assert.equal(firstWorkerLink.worker_id,worker.id);
 assert.equal(firstWorkerLink.order_id,order.id);
 assert.equal(firstWorkerLink.status,'active');
 assert.equal((await request('/api/action',orderWorkerPayload,cookie)).body.deduplicated,true);
 assert.equal((await request('/api/action',{type:'worker_assign_order',payload:{...orderWorkerPayload.payload,workerId:secondWorker.id}},cookie)).status,409);
 const secondLink=await create('worker_assign_order',{workerId:secondWorker.id,orderId:order.id},cookie);
 assert.equal(secondLink.status,'active');
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_worker_order_assignments WHERE status=$1',['active'])).rows[0].n,2);
 const detached=await create('worker_remove_order',{workerId:worker.id,orderId:order.id},cookie);
 assert.equal(detached.status,'removed');
 const reattached=await create('worker_assign_order',{workerId:worker.id,orderId:order.id},cookie);
 assert.equal(reattached.id,firstWorkerLink.id);
 assert.equal(reattached.status,'active');
 assert.equal(reattached.revision,firstWorkerLink.revision+2);
 const invalidWorker=await request('/api/action',{type:'worker_assign_order',payload:{workerId:randomUUID(),orderId:order.id}},cookie);
 assert.equal(invalidWorker.status,409);
 const disabledWorker=await create('worker_update',{id:secondWorker.id,revision:1,name:secondWorker.name,phone:secondWorker.phone,roleTitle:secondWorker.role_title,notes:'',status:'inactive'},cookie);
 assert.equal(disabledWorker.status,'inactive');
 const removedInactive=await create('worker_remove_order',{workerId:secondWorker.id,orderId:order.id},cookie);
 assert.equal(removedInactive.status,'removed');
 assert.equal((await request('/api/action',{type:'worker_assign_order',payload:{workerId:secondWorker.id,orderId:order.id}},cookie)).status,409);
 const activeWorkerState=await request('/api/state',undefined,cookie);
 assert.equal(activeWorkerState.status,200);
 assert.equal(activeWorkerState.body.workers.length,2);
 assert.equal(activeWorkerState.body.workerOrderAssignments.length,2);
 assert.equal(activeWorkerState.body.workerOrderAssignments.filter(x=>x.status==='active').length,1);
 console.log('V9C_WORKERS_PROFILE_PHONE_DEDUP_IDEMPOTENCE_ORDER_MANY_TO_MANY_POSTGRES_PASS');




 // V9A manual ScheduleItems: source-backed period, edits, archived preservation and order ownership.
 const planKey=randomUUID();
 const planPayload={type:'schedule_save',payload:{revision:0,startAt:'2026-11-03T09:00',endAt:'2026-11-03T10:00',itemType:'Осмотр',title:'Проверка объекта',objectId:object.id,notes:'Отдельный план',workerId:worker.id,requestKey:planKey}};
 const firstPlan=await request('/api/action',planPayload,cookie);
 assert.equal(firstPlan.status,200,firstPlan.body.error);
 assert.equal(firstPlan.body.saved,true);
 const manual=firstPlan.body.item;
 assert.equal(manual.status,'planned');
 assert.equal(manual.schedule_date,'2026-11-03');
 assert.equal(manual.source_kind,'manual');
 assert.equal(manual.auto_source_key,'');
 assert.equal(manual.object_id,object.id);
 assert.equal(manual.order_id,null);
 assert.equal(manual.revision,1);
 const conflictRead=await request('/api/schedule/conflicts?startDate=2026-11-03&endDate=2026-11-03',undefined,cookie);
 assert.equal(conflictRead.status,200,conflictRead.body.error);
 assert.equal(conflictRead.body.items.find(x=>x.id===manual.id)?.title,'Проверка объекта');
 assert.equal(conflictRead.body.source,'mvp_schedule_items+mvp_schedule_order_items+mvp_schedule_lead_items');
 console.log('LEGACY_CONFLICT_GUARD_REAL_POSTGRES_MANUAL_SOURCE_ID_PASS');
 const workerPlan=(await database.query('SELECT worker_id,status FROM public.mvp_manual_plan_workers WHERE plan_id=$1',[manual.id])).rows[0];
 assert.equal(workerPlan.worker_id,worker.id);
 assert.equal(workerPlan.status,'active');
 const planReplay=await request('/api/action',planPayload,cookie);
 assert.equal(planReplay.status,200);
 assert.equal(planReplay.body.deduplicated,true);
 assert.equal(planReplay.body.item.id,manual.id);
 assert.equal((await request('/api/action',{type:'schedule_save',payload:{...planPayload.payload,title:'Другое'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'schedule_save',payload:{revision:0,startAt:'2026-11-03T10:00',endAt:'2026-11-03T09:00',title:'Wrong'}},cookie)).status,400);
 assert.equal((await request('/api/action',{type:'schedule_save',payload:{revision:0,startAt:'2026-02-31T10:00',endAt:'2026-11-03T11:00',title:'Wrong date'}},cookie)).status,400);
 assert.equal((await request('/api/action',{type:'schedule_save',payload:{revision:0,startAt:'2026-11-03T10:00',endAt:'2026-11-03T11:00',title:'Wrong status',status:'invalid'}},cookie)).status,400);
 assert.equal((await request('/api/action',{type:'schedule_save',payload:{revision:0,startAt:'2026-11-03T10:00',endAt:'2026-11-03T11:00',title:'Missing object',objectId:randomUUID()}},cookie)).status,400);
 const linked=await create('schedule_save',{revision:0,startAt:'2026-11-05T15:00',endAt:'2026-11-05T16:00',itemType:'Монтаж',orderId:order.id},cookie);
 assert.equal(linked.order_id,order.id);
 assert.equal(linked.object_id,object.id);
 assert.equal(linked.title,'Synthetic heating order');
 assert.equal(linked.status,'planned');
 assert.equal((await request('/api/action',{type:'schedule_save',payload:{revision:0,startAt:'2026-11-06T08:00',endAt:'2026-11-06T09:00',title:'Mismatch',orderId:order.id,objectId:randomUUID()}},cookie)).status,400);
 const week=await request('/api/schedule?viewMode=week&anchorDate=2026-11-03',undefined,cookie);
 assert.equal(week.status,200,week.body.error);
 const autoFallsInWeek=now>='2026-11-02'&&now<='2026-11-08';
 assert.equal(week.body.total,autoFallsInWeek?3:2);
 assert.equal(week.body.items.filter(x=>x.source_kind==='manual').length,2);
 assert.equal(week.body.items.filter(x=>x.source_kind==='work_order').length,autoFallsInWeek?1:0);
 assert.equal(week.body.items.find(x=>x.id===manual.id).object_name,'Corrected object');
 assert.equal(week.body.items.find(x=>x.id===linked.id).order_title,'Synthetic heating order');
 assert.equal(week.body.items.find(x=>x.id===manual.id).worker_names,'Арам Исполнитель');
 if(autoFallsInWeek)assert.equal(week.body.items.find(x=>x.source_kind==='work_order').worker_names,'Арам Исполнитель');
 const complete=await create('schedule_save',{id:manual.id,revision:1,status:'completed'},cookie);
 assert.equal(complete.status,'completed');
 assert.equal(complete.revision,2);
 assert.equal((await request('/api/action',{type:'schedule_save',payload:{id:manual.id,revision:1,status:'cancelled'}},cookie)).status,409);
 const moved=await create('schedule_save',{id:linked.id,revision:1,startAt:'2026-11-10T08:00',endAt:'2026-11-10T09:15',title:'Перенос работы'},cookie);
 assert.equal(moved.id,linked.id);
 assert.equal(moved.schedule_date,'2026-11-10');
 assert.equal(moved.object_id,object.id);
 assert.equal(moved.order_id,order.id);
 assert.equal(moved.revision,2);
 const cancel=await create('schedule_save',{id:moved.id,revision:2,status:'cancelled'},cookie);
 assert.equal(cancel.status,'cancelled');
 const archive=await create('schedule_archive',{id:manual.id,revision:2},cookie);
 assert.equal(archive.status,'archived');
 assert.ok(archive.archived_at);
 assert.equal((await request('/api/action',{type:'schedule_save',payload:{id:manual.id,revision:3,status:'planned'}},cookie)).status,409);
 const weekAfter=await request('/api/schedule?viewMode=week&anchorDate=2026-11-03',undefined,cookie);
 assert.equal(weekAfter.body.total,autoFallsInWeek?1:0);
 const month=await request('/api/schedule?viewMode=month&anchorDate=2026-11-17',undefined,cookie);
 assert.equal(month.status,200);
 assert.equal(month.body.periodStart,'2026-11-01');
 assert.equal(month.body.periodEnd,'2026-11-30');
 assert.equal(month.body.total,now.startsWith('2026-11-')?2:1);
 assert.equal(month.body.items.find(x=>x.id===linked.id).title,'Перенос работы');
 const backupPlan=await request('/api/export',undefined,cookie);
 assert.equal(backupPlan.status,200,backupPlan.body.error);
 assert.equal(backupPlan.body.scheduleItems.length,2);
 assert.equal(backupPlan.body.scheduleOrderItems.length,1);
 assert.equal(backupPlan.body.scheduleItems.find(x=>x.id===manual.id).status,'archived');
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_days')).rows[0].n,0);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n,0);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_object_presence')).rows[0].n,0);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_daily_a1')).rows[0].n,2);
 const workerBackup=await request('/api/export',undefined,cookie);
 assert.equal(workerBackup.status,200,workerBackup.body.error);
 assert.equal(workerBackup.body.workers.length,2);
 assert.equal(workerBackup.body.workerOrderAssignments.length,2);
 assert.equal(workerBackup.body.manualPlanWorkers.length,1);
 assert.equal(workerBackup.body.manualPlanWorkers[0].status,'active');
 const planBadWorker=await request('/api/action',{type:'schedule_save',payload:{revision:0,title:'Неправильное назначение',startAt:'2027-03-02T08:00',endAt:'2027-03-02T09:00',workerId:randomUUID()}},cookie);
 assert.equal(planBadWorker.status,409);
 assert.equal((await database.query("SELECT count(*)::int n FROM public.mvp_schedule_items WHERE title='Неправильное назначение'")).rows[0].n,0);
 console.log('V9C_MANUAL_ASSIGNMENT_ATOMIC_WORKER_READ_AND_BACKUP_POSTGRES_PASS');
 console.log('V9A_SCHEDULE_MANUAL_AUTH_CRUD_WEEK_MONTH_ORDER_LINK_REVISION_ARCHIVE_POSTGRES_PASS');



 const linkedOwner=await create('owner_activity_start',{activityClass:'BUSINESS_SYSTEM',startTime:'2026-09-05T13:00',summary:'CRM sync',relatedEntityType:'Object',relatedEntityId:object.id},cookie);
 assert.equal(linkedOwner.related_entity_type,'Object');
 assert.equal(linkedOwner.related_entity_id,object.id);
 assert.equal(linkedOwner.work_day_id,null);
 assert.equal((await request('/api/action',{type:'owner_activity_start',payload:{activityClass:'ORGANIZATION',startTime:'2026-09-05T13:01'}},cookie)).status,409);
 const linkedStop=await create('owner_activity_stop',{id:linkedOwner.id,revision:1,endTime:'2026-09-05T13:20'},cookie);
 assert.equal(linkedStop.duration_minutes,20);

 console.log('CRM_LEAD_CLIENT_OBJECT_ORDER_POSTGRES_READBACK_PASS');

 const key=randomUUID();
 const first=await request('/api/action',{type:'work_start_order',payload:{orderId:order.id,requestKey:key}},cookie);
 assert.equal(first.status,200,first.body.error);
 const repeat=await request('/api/action',{type:'work_start_order',payload:{orderId:order.id,requestKey:key}},cookie);
 assert.equal(repeat.status,200,repeat.body.error);
 assert.equal(repeat.body.deduplicated,true);
 assert.equal(repeat.body.item.id,first.body.item.id);
 assert.equal((await request('/api/action',{type:'work_start_order',payload:{orderId:order.id,requestKey:randomUUID()}},cookie)).status,409);
 const state=(await request('/api/state',undefined,cookie)).body;
 assert.equal(state.days.length,1);
 assert.equal(state.sessions.length,1);
 assert.equal(state.orders[0].status,'active');
 assert.equal(state.sessions[0].order_id,order.id);
 const runningWork=await request('/api/my-work',undefined,cookie);
 assert.equal(runningWork.status,200,runningWork.body.error);
 assert.equal(runningWork.body.today,state.today);
 assert.equal(runningWork.body.day.status,'open');
 assert.equal(runningWork.body.currentSession.id,first.body.item.id);
 assert.equal(runningWork.body.currentSession.order_id,order.id);
 assert.equal(runningWork.body.currentSession.order_title,'Synthetic heating order');
 assert.equal(runningWork.body.currentSession.object_name,'Corrected object');
 assert.equal(runningWork.body.currentSession.object_address,'Test address');
 assert.equal(runningWork.body.currentSession.client_name,'Corrected client');
 // MyWork V1: exact WorkOrder is a read projection, not a second current-order table.
 const focused=await request('/api/my-work?orderId='+order.id,undefined,cookie);
 assert.equal(focused.status,200,focused.body.error);
 assert.equal(focused.body.selectedOrderId,order.id);
 assert.equal(focused.body.contextOrder.id,order.id);
 assert.equal(focused.body.contextOrder.object_id,object.id);
 assert.equal(focused.body.contextOrder.client_id,client.id);
 assert.equal(focused.body.contextOrder.client_name,'Corrected client');
 assert.equal(focused.body.assignedWorkers.length,1);
 assert.equal(focused.body.assignedWorkers[0].worker_id,worker.id);
 assert.equal(focused.body.assignedWorkers[0].day_status,null);
 assert.equal(focused.body.assignedWorkers[0].completed_count,0);
 assert.equal(focused.body.assignedWorkers[0].active_count,0);
 assert.equal(focused.body.currentPresence,null);
 assert.equal((await request('/api/my-work?orderId=bad',undefined,cookie)).status,400);
 assert.equal((await request('/api/my-work?orderId='+order.id)).status,401);
 const orderBeforeProjection=(await database.query('SELECT status FROM public.mvp_orders WHERE id=$1',[order.id])).rows[0].status;
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n,0);
 assert.equal((await database.query('SELECT status FROM public.mvp_orders WHERE id=$1',[order.id])).rows[0].status,orderBeforeProjection);
 console.log('MYWORK_V1_AUTH_EXACT_ORDER_OBJECT_CLIENT_WORKER_PROJECTION_NO_MUTATION_PASS');
 assert.equal(runningWork.body.todaySessions.length,1);
 assert.equal(runningWork.body.plannedOrders[0].id,order.id);
 assert.equal(runningWork.body.recentWorkdays.length,1);
 
 // V7 independent on-site visits — actual HTTP + disposable PostgreSQL.
 const pBlank=await request('/api/presence',undefined,cookie);
 assert.equal(pBlank.status,200,pBlank.body.error);
 assert.equal(pBlank.body.day.status,'open');
 assert.equal(pBlank.body.active,null);
 assert.equal(pBlank.body.items.length,0);
 assert.equal(pBlank.body.model.presence,'object_visit');
 assert.equal(pBlank.body.model.workLog,'performed_work');
 const startKey=randomUUID();
 const firstVisit=await create('presence_start',{date:now,objectId:object.id,orderId:order.id,arrivalTime:'08:30',notes:'Первый объект',requestKey:startKey},cookie);
 assert.equal(firstVisit.status,'open');
 assert.equal(firstVisit.object_id,object.id);
 assert.equal(firstVisit.order_id,order.id);
 assert.equal(firstVisit.day_date,now);
 const replayVisit=await request('/api/action',{type:'presence_start',payload:{date:now,objectId:object.id,orderId:order.id,arrivalTime:'08:30',notes:'Первый объект',requestKey:startKey}},cookie);
 assert.equal(replayVisit.status,200);
 assert.equal(replayVisit.body.deduplicated,true);
 assert.equal(replayVisit.body.item.id,firstVisit.id);
 assert.equal((await request('/api/action',{type:'presence_start',payload:{date:now,objectId:object.id,orderId:order.id,arrivalTime:'08:50',requestKey:startKey}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'presence_start',payload:{date:now,objectId:object.id,arrivalTime:'09:00'}},cookie)).status,409);
 const pLive=await request('/api/presence',undefined,cookie);
 assert.equal(pLive.body.active.id,firstVisit.id);
 assert.equal(pLive.body.active.object_name,'Corrected object');
 assert.equal(pLive.body.active.client_name,'Corrected client');
 assert.equal(pLive.body.items[0].order_title,'Synthetic heating order');
 const withPresence=await request('/api/my-work?orderId='+order.id,undefined,cookie);
 assert.equal(withPresence.status,200,withPresence.body.error);
 assert.equal(withPresence.body.currentPresence.id,firstVisit.id);
 assert.equal(withPresence.body.currentPresence.object_id,object.id);
 assert.equal(withPresence.body.currentPresence.order_id,order.id);
 assert.equal(withPresence.body.assignedWorkers.length,1);
 assert.equal(withPresence.body.currentSession.id,first.body.item.id,
  'Physical presence must not replace WorkSession');
 assert.equal((await request('/api/action',{type:'presence_stop',payload:{id:firstVisit.id,date:now,revision:1,departureTime:'08:00'}},cookie)).status,400);
 const firstClosed=await create('presence_stop',{id:firstVisit.id,date:now,revision:1,departureTime:'09:30',notes:'Ушёл'},cookie);
 assert.equal(firstClosed.status,'closed');
 assert.equal(firstClosed.revision,2);
 assert.ok(firstClosed.departed_at);
 assert.equal((await request('/api/action',{type:'presence_update',payload:{id:firstVisit.id,date:now,revision:1,arrivalTime:'08:00',departureTime:'09:30'}},cookie)).status,409);
 const corrected=await create('presence_update',{id:firstVisit.id,date:now,revision:2,arrivalTime:'08:45',departureTime:'09:15',notes:'Исправлено'},cookie);
 assert.equal(corrected.revision,3);
 assert.equal(corrected.id,firstVisit.id);
 assert.equal(corrected.object_id,object.id);
 assert.equal(corrected.order_id,order.id);
 assert.equal(corrected.notes,'Исправлено');
 const secondVisit=await create('presence_start',{date:now,objectId:object.id,arrivalTime:'09:30',notes:'Без заказа'},cookie);
 assert.equal(secondVisit.order_id,null);
 assert.equal((await request('/api/action',{type:'presence_update',payload:{id:secondVisit.id,date:now,revision:1,arrivalTime:'09:00'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'presence_update',payload:{id:firstVisit.id,date:now,revision:3,arrivalTime:'08:45',departureTime:'10:00'}},cookie)).status,409);
 const secondClosed=await create('presence_stop',{id:secondVisit.id,date:now,revision:1,departureTime:'10:30'},cookie);
 assert.equal(secondClosed.status,'closed');
 assert.equal((await request('/api/action',{type:'presence_stop',payload:{id:secondVisit.id,date:now,revision:1,departureTime:'10:40'}},cookie)).status,409);
 const pClosed=await request('/api/presence',undefined,cookie);
 assert.equal(pClosed.body.active,null);
 assert.equal(pClosed.body.items.length,2);
 assert.equal(new Set(pClosed.body.items.map(x=>x.id)).size,2);
 const stored=await database.query("SELECT count(*)::int AS n,count(DISTINCT id)::int AS ids FROM public.mvp_object_presence");
 assert.deepEqual(stored.rows[0],{n:2,ids:2});
 console.log('V7_OBJECT_PRESENCE_AUTH_REPLAY_SAME_OBJECT_ORDER_OVERLAP_EDIT_READBACK_PASS');

 console.log('MY_WORK_REAL_POSTGRES_ACTIVE_CONTEXT_AND_SEPARATE_SOURCES_PASS');
 console.log('ATOMIC_DAY_ORDER_START_DEDUPLICATION_AND_SECOND_START_DENIED_PASS');

 await create('session_stop',{id:first.body.item.id},cookie);
 // MyWork V1 uses the existing session_start writer, never work_start_order:
 // a WorkSession cannot itself mark presence, record WorkLog, or change WorkOrder status.
 const originalStatus=(await database.query('SELECT status FROM public.mvp_orders WHERE id=$1',[order.id])).rows[0].status;
 const beforeDirectPresence=(await database.query("SELECT count(*)::int n FROM public.mvp_object_presence WHERE status='open'")).rows[0].n;
 const sessionStartKey=randomUUID();
 const directSessionPayload={type:'session_start',payload:{orderId:order.id,description:'MyWork selected order',requestKey:sessionStartKey}};
 const directStarted=await request('/api/action',directSessionPayload,cookie);
 assert.equal(directStarted.status,200,directStarted.body.error);
 assert.equal(directStarted.body.item.order_id,order.id);
 const repeatedDirect=await request('/api/action',directSessionPayload,cookie);
 assert.equal(repeatedDirect.status,200,repeatedDirect.body.error);
 assert.equal(repeatedDirect.body.item.id,directStarted.body.item.id);
 const sessionRead=(await request('/api/my-work?orderId='+order.id,undefined,cookie)).body;
 assert.equal(sessionRead.currentSession.id,directStarted.body.item.id);
 assert.equal(sessionRead.currentPresence,null);
 assert.equal((await database.query('SELECT status FROM public.mvp_orders WHERE id=$1',[order.id])).rows[0].status,originalStatus);
 assert.equal((await database.query("SELECT count(*)::int n FROM public.mvp_object_presence WHERE status='open'")).rows[0].n,beforeDirectPresence);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n,0);
 const directStopped=await create('session_stop',{id:directStarted.body.item.id},cookie);
 assert.ok(directStopped.ended_at);
 // CI-local fixture cleanup keeps the existing historical baseline assertions unchanged.
 await database.query('DELETE FROM public.mvp_sessions WHERE id=$1',[directStarted.body.item.id]);
 console.log('MYWORK_V1_NATIVE_SESSION_START_STOP_REPLAY_INDEPENDENT_PRESENCE_ORDER_STATUS_PASS');
 const logKey=randomUUID();
 const log=await create('log_create',{orderId:order.id,title:'Pipe installation',minutes:95,quantity:'12.5',unit:'m',requestKey:logKey},cookie);
 const logAgain=await create('log_create',{orderId:order.id,title:'Pipe installation',minutes:95,quantity:'12.5',unit:'m',requestKey:logKey},cookie);
 assert.equal(log.id,logAgain.id);
 const loggedWork=await request('/api/my-work',undefined,cookie);
 assert.equal(loggedWork.status,200);
 assert.equal(loggedWork.body.currentSession,null);
 assert.equal(loggedWork.body.todayTotals.logCount,1);
 assert.equal(loggedWork.body.todayTotals.workMinutes,95);
 assert.equal(loggedWork.body.todayLogs[0].order_title,'Synthetic heating order');
 assert.equal(loggedWork.body.todayLogs[0].order_id,order.id);
 assert.equal(loggedWork.body.todayLogs[0].quantity,'12.500');
 assert.equal(loggedWork.body.todayLogs[0].minutes,95);
 const filteredHistory=await request('/api/history?from='+now+'&to='+now+'&orderId='+order.id,undefined,cookie);
 assert.equal(filteredHistory.status,200,filteredHistory.body.error);
 assert.equal(filteredHistory.body.items.some(x=>x.id===log.id),true);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_logs WHERE order_id=$1',[order.id])).rows[0].n,1);
 console.log('MYWORK_V1_WORKLOG_RETRY_QUANTITY_MINUTES_SCOPED_HISTORY_POSTGRES_PASS');
 assert.equal(loggedWork.body.recentWorkdays[0].work_minutes,95);
 
 const thirdVisit=await create('presence_start',{date:now,objectId:object.id,arrivalTime:'11:00'},cookie);
 assert.equal((await request('/api/action',{type:'day_close',payload:{}},cookie)).status,409,'cannot close day while on object');
 assert.equal((await request('/api/presence',undefined,cookie)).body.active.id,thirdVisit.id);
 await create('presence_stop',{id:thirdVisit.id,date:now,revision:1,departureTime:'11:20'},cookie);

 await create('day_close',{},cookie);
 const reloaded=(await request('/api/state',undefined,cookie)).body;
 assert.equal(reloaded.logs.length,1);
 assert.equal(reloaded.logs[0].minutes,95);
 assert.equal(reloaded.sessions[0].ended_at!==null,true);
 assert.equal(reloaded.days[0].status,'closed');
 const visitsPostClose=await request('/api/presence',undefined,cookie);
 assert.equal(visitsPostClose.body.active,null);
 assert.equal(visitsPostClose.body.items.length,3);
 assert.equal((await request('/api/action',{type:'presence_start',payload:{objectId:object.id,arrivalTime:'12:00'}},cookie)).status,409);
 const closedWork=await request('/api/my-work',undefined,cookie);
 assert.equal(closedWork.body.day.status,'closed');
 assert.equal(closedWork.body.currentSession,null);
 assert.equal(closedWork.body.recentWorkdays[0].status,'closed');
 assert.equal(closedWork.body.todaySessions[0].ended_at!==null,true);
 assert.equal((await request('/api/action',{type:'work_start_order',payload:{orderId:order.id,requestKey:randomUUID()}},cookie)).status,409);
 const countSql='SELECT (SELECT count(*) FROM public.mvp_leads)::int AS leads, (SELECT count(*) FROM public.mvp_clients)::int AS clients, (SELECT count(*) FROM public.mvp_objects)::int AS objects, (SELECT count(*) FROM public.mvp_orders)::int AS orders, (SELECT count(*) FROM public.mvp_work_days)::int AS days, (SELECT count(*) FROM public.mvp_sessions)::int AS sessions, (SELECT count(*) FROM public.mvp_work_logs)::int AS logs';
 const counts=await database.query(countSql);
 assert.deepEqual(counts.rows[0],{leads:1,clients:1,objects:1,orders:1,days:1,sessions:1,logs:1});
 const updatedLog=await create('log_update',{id:log.id,revision:log.revision,dayDate:now,orderId:order.id,title:'Corrected installation',minutes:72,quantity:'10.25',unit:'m',notes:'Fixed typo'},cookie);
 assert.equal(updatedLog.id,log.id);
 assert.equal(updatedLog.revision,log.revision+1);
 assert.equal((await request('/api/action',{type:'log_update',payload:{id:log.id,revision:log.revision,dayDate:now,title:'Stale',minutes:5}},cookie)).status,409);
 const persisted=await database.query('SELECT l.id,l.title,l.minutes,l.quantity::text AS quantity,l.revision,o.client_id FROM public.mvp_work_logs l JOIN public.mvp_orders w ON l.order_id=w.id JOIN public.mvp_objects o ON w.object_id=o.id WHERE l.id=$1',[log.id]);
 assert.equal(persisted.rows[0].id,log.id);
 assert.equal(persisted.rows[0].title,'Corrected installation');
 assert.equal(persisted.rows[0].minutes,72);
 assert.equal(persisted.rows[0].quantity,'10.250');
 assert.equal(persisted.rows[0].client_id,client.id);
 const correctedWork=await request('/api/my-work',undefined,cookie);
 assert.equal(correctedWork.status,200);
 assert.equal(correctedWork.body.todayTotals.workMinutes,72);
 assert.equal(correctedWork.body.todayLogs[0].title,'Corrected installation');
 const another=await create('log_create',{orderId:order.id,title:'Second item',minutes:20},cookie);
 await create('log_create',{title:'Unlinked item',minutes:15},cookie);
 const page1=await request('/api/history?from='+now+'&to='+now+'&limit=1',undefined,cookie);
 assert.equal(page1.status,200,page1.body.error);
 assert.equal(page1.body.items.length,1);
 assert.equal(page1.body.items[0].day_date,now);
 assert.equal(page1.body.hasMore,true);
 assert.ok(page1.body.nextCursor);
 const page2=await request('/api/history?from='+now+'&to='+now+'&limit=1&cursor='+encodeURIComponent(page1.body.nextCursor),undefined,cookie);
 assert.equal(page2.status,200,page2.body.error);
 assert.notEqual(page1.body.items[0].id,page2.body.items[0].id);
 const onlyOrder=await request('/api/history?from='+now+'&to='+now+'&orderId='+order.id,undefined,cookie);
 assert.equal(onlyOrder.status,200);
 assert.deepEqual(new Set(onlyOrder.body.items.map(x=>x.id)),new Set([log.id,another.id]));

 // OBJECT_CARD_LEGACY_PARITY_BATCH3: actual WorkLogs on exact parent WorkOrder.
 assert.equal((await request('/api/orders/worklogs?id='+order.id)).status,401);
 const cardWorklogs=await request('/api/orders/worklogs?id='+order.id,undefined,cookie);
 assert.equal(cardWorklogs.status,200,cardWorklogs.body.error);
 assert.equal(cardWorklogs.body.orderId,order.id);
 assert.equal(cardWorklogs.body.objectId,object.id);
 assert.equal(cardWorklogs.body.clientId,client.id);
 assert.equal(cardWorklogs.body.objectName,'Corrected object');
 assert.equal(cardWorklogs.body.coverage,'CLEAN_NATIVE_WORKLOGS_ONLY');
 assert.deepEqual(new Set(cardWorklogs.body.items.map(x=>x.id)),new Set([log.id,another.id]));
 assert.equal(cardWorklogs.body.hasMore,false);
 assert.equal((await request('/api/orders/worklogs?id='+randomUUID(),undefined,cookie)).status,404);
 assert.equal((await request('/api/orders/worklogs?id=bad',undefined,cookie)).status,400);
 const invalidOrderCursor=Buffer.from(JSON.stringify([
  randomUUID(),now,new Date().toISOString(),log.id])).toString('base64url');
 assert.equal((await request('/api/orders/worklogs?id='+order.id+
  '&cursor='+invalidOrderCursor,undefined,cookie)).status,400);
 console.log('ORDER_CARD_LEGACY_WORKLOGS_SCOPED_OWNER_AUTH_RELATION_POSTGRES_PASS');
 const otherDay=await request('/api/history?from=2025-01-01&to=2025-01-01',undefined,cookie);
 assert.equal(otherDay.body.items.length,0);
 assert.equal((await request('/api/history?from=2026-02-31&to=2026-02-31',undefined,cookie)).status,400);
 assert.equal((await request('/api/history?from='+now+'&to='+now+'&limit=1000',undefined,cookie)).status,400);
 assert.equal((await request('/api/history?from='+now+'&to='+now+'&cursor=bad',undefined,cookie)).status,400);
 const allLogs=await database.query('SELECT count(*)::int AS n,count(DISTINCT id)::int AS unique_ids FROM public.mvp_work_logs');
 assert.deepEqual(allLogs.rows[0],{n:3,unique_ids:3});

 // V3: the same Lead was converted atomically in CRM-01, which increments revision.
 // Read its current revision rather than pretending this synthetic record was not converted.
 // Optimistic concurrency enforcement remains unchanged.
 const leadAtV3=(await database.query('SELECT id,revision,status FROM public.mvp_leads WHERE id=$1',[lead.id])).rows[0];
 assert.equal(leadAtV3.status,'won');
 const updatedLead=await create('lead_update',{id:lead.id,revision:leadAtV3.revision,title:'Lead corrected V3',contactName:'New contact',phone:'12345',notes:'Checked'},cookie);
 assert.equal(updatedLead.id,lead.id);
 assert.equal(updatedLead.revision,leadAtV3.revision+1);
 assert.equal((await request('/api/action',{type:'lead_update',payload:{id:lead.id,revision:lead.revision,title:'Stale lead'}},cookie)).status,409);
 const changedOrder=await create('order_update',{id:order.id,revision:(await request('/api/state',undefined,cookie)).body.orders[0].revision,title:'Corrected V3 heating order',plannedOn:now,notes:'Retained links'},cookie);
 assert.equal(changedOrder.id,order.id);
 assert.equal(changedOrder.object_id,object.id);
 assert.equal(changedOrder.lead_id,lead.id);
 assert.equal(changedOrder.status,'active');
 const renamedAuto=(await database.query('SELECT id,title,revision FROM public.mvp_schedule_order_items WHERE order_id=$1',[order.id])).rows[0];
 assert.equal(renamedAuto.id,currentAuto.id);
 assert.equal(renamedAuto.title,'Corrected V3 heating order');
 assert.equal(renamedAuto.revision,2);
 assert.equal((await request('/api/action',{type:'order_update',payload:{id:order.id,revision:changedOrder.revision-1,title:'Stale order'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'order_update',payload:{id:order.id,revision:changedOrder.revision,title:'Invalid date',plannedOn:'2026-02-31'}},cookie)).status,400);
 const clientIdSearch=await request('/api/catalog?entity=clients&q='+client.id,undefined,cookie);
 assert.equal(clientIdSearch.status,200,clientIdSearch.body.error);
 assert.deepEqual(clientIdSearch.body.items.map(x=>x.id),[client.id]);
 const byPhone=await request('/api/catalog?entity=clients&q=%2B37410000000',undefined,cookie);
 assert.equal(byPhone.status,200,byPhone.body.error);
 assert.equal(byPhone.body.items[0].id,client.id);
 const byAddress=await request('/api/catalog?entity=objects&q=Test%20address',undefined,cookie);
 assert.equal(byAddress.status,200,byAddress.body.error);
 assert.equal(byAddress.body.items[0].client_name,'Corrected client');
 assert.ok(byAddress.body.items[0].row_version);
 const byOrder=await request('/api/catalog?entity=orders&q=Corrected%20V3',undefined,cookie);
 assert.equal(byOrder.status,200,byOrder.body.error);
 assert.equal(byOrder.body.items[0].id,order.id);
 assert.equal(byOrder.body.items[0].object_name,'Corrected object');
 for(let i=0;i<3;i++)await create('lead_create',{title:'V3SearchMarker '+i},cookie);
 const firstPage=await request('/api/catalog?entity=leads&q=V3SearchMarker&limit=2',undefined,cookie);
 assert.equal(firstPage.status,200,firstPage.body.error);
 assert.equal(firstPage.body.items.length,2);
 assert.equal(firstPage.body.hasMore,true);
 assert.ok(firstPage.body.nextCursor);
 const secondPage=await request('/api/catalog?entity=leads&q=V3SearchMarker&limit=2&cursor='+encodeURIComponent(firstPage.body.nextCursor),undefined,cookie);
 assert.equal(secondPage.status,200,secondPage.body.error);
 assert.equal(secondPage.body.items.length,1);
 assert.equal(secondPage.body.hasMore,false);
 assert.equal(new Set(firstPage.body.items.concat(secondPage.body.items).map(x=>x.id)).size,3);
 assert.equal((await request('/api/catalog?entity=leads&q=other&cursor='+encodeURIComponent(firstPage.body.nextCursor),undefined,cookie)).status,400);
 assert.equal((await request('/api/catalog?entity=nope',undefined,cookie)).status,400);
 assert.equal((await request('/api/catalog?entity=leads&q=a',undefined,cookie)).status,400);
 assert.equal((await request('/api/catalog?entity=leads&limit=1000',undefined,cookie)).status,400);
 assert.equal((await request('/api/catalog?entity=leads&cursor=bad',undefined,cookie)).status,400);
 await create('lead_create',{title:'Special %_ marker'},cookie);
 const literal=await request('/api/catalog?entity=leads&q=%25_',undefined,cookie);
 assert.equal(literal.status,200,literal.body.error);
 assert.equal(literal.body.items.length,1);
 assert.equal(literal.body.items[0].title,'Special %_ marker');
 // CRM-24: real disposable PostgreSQL filtering. No live/owner database writes.
 const c24Source=(await database.query('SELECT status,client_tier,referral_status FROM public.mvp_clients WHERE id=$1',[client.id])).rows[0];
 const c24Profile=new URLSearchParams({entity:'clients',q:client.id,
  status:c24Source.status,tier:c24Source.client_tier||'unset',
  referral:c24Source.referral_status||'unset'});
 const c24Exact=await request('/api/catalog?'+c24Profile,undefined,cookie);
 assert.equal(c24Exact.status,200,c24Exact.body.error);
 assert.deepEqual(c24Exact.body.items.map(x=>x.id),[client.id]);
 const otherStatus=c24Source.status==='active'?'inactive':'active';
 c24Profile.set('status',otherStatus);
 assert.equal((await request('/api/catalog?'+c24Profile,undefined,cookie)).body.items.length,0);
 const c24First=await request('/api/catalog?entity=leads&q=V3SearchMarker&status=new&limit=2',undefined,cookie);
 assert.equal(c24First.status,200,c24First.body.error);
 assert.equal(c24First.body.items.length,2);
 assert.equal(c24First.body.hasMore,true);
 const c24Second=await request('/api/catalog?entity=leads&q=V3SearchMarker&status=new&limit=2&cursor='+encodeURIComponent(c24First.body.nextCursor),undefined,cookie);
 assert.equal(c24Second.status,200,c24Second.body.error);
 assert.equal(c24Second.body.items.length,1);
 assert.equal(new Set([...c24First.body.items,...c24Second.body.items].map(x=>x.id)).size,3);
 assert.equal((await request('/api/catalog?entity=leads&q=V3SearchMarker&status=contacted&cursor='+encodeURIComponent(c24First.body.nextCursor),undefined,cookie)).status,400);
 assert.equal((await request('/api/catalog?entity=leads&q=V3SearchMarker&status=new&cursor='+encodeURIComponent(firstPage.body.nextCursor),undefined,cookie)).status,400);
 assert.equal((await request('/api/catalog?entity=clients&tier=unauthorized',undefined,cookie)).status,400);
 assert.equal((await request('/api/catalog?entity=leads&tier=vip',undefined,cookie)).status,400);
 assert.equal((await request('/api/catalog?entity=orders&status=active',undefined,cookie)).status,400);
 assert.equal((await request('/api/catalog?entity=clients&status=active',undefined)).status,401);
 const saved=await database.query('SELECT title,notes,status,object_id,lead_id FROM public.mvp_orders WHERE id=$1',[order.id]);
 assert.equal(saved.rows[0].title,'Corrected V3 heating order');
 assert.equal(saved.rows[0].notes,'Retained links');
 assert.equal(saved.rows[0].status,'active');
 assert.equal(saved.rows[0].object_id,object.id);
 assert.equal(saved.rows[0].lead_id,lead.id);
 console.log('V3_CATALOG_AUTH_EXACT_ID_FILTER_CURSOR_AND_LITERAL_SEARCH_PASS');
 console.log('V3_LEAD_ORDER_OPTIMISTIC_EDITS_PRESERVE_ID_RELATIONS_PASS');

 console.log('CLIENT_OBJECT_LOG_OPTIMISTIC_EDIT_RELATIONS_READBACK_PASS');
 console.log('WORKLOG_HISTORY_FILTER_CURSOR_PAGINATION_AUTH_PASS');
 console.log('TODAY_WORKLOG_SAVE_RELOAD_HISTORY_DAY_CLOSE_POSTGRES_PASS');
 for(let i=0;i<11;i++)await create('log_create',{title:'V5 extra '+i,minutes:1},cookie);
 const boundedWork=await request('/api/my-work',undefined,cookie);
 assert.equal(boundedWork.body.todayLogs.length,10);
 assert.equal(boundedWork.body.moreTodayLogs,true);
 assert.equal(boundedWork.body.todayTotals.logCount,14);
 assert.equal(boundedWork.body.todayTotals.workMinutes,118);
 assert.equal(boundedWork.body.recentWorkdays.length,1);
 console.log('MY_WORK_BOUNDED_RECENT_LOGS_AND_FULL_DAY_TOTALS_PASS');
 
 const historyDay='2026-09-01';
 const historyId=(await database.query("INSERT INTO public.mvp_work_days(day_date,status) VALUES($1::date,'closed') RETURNING id",[historyDay])).rows[0].id;
 for(let i=0;i<27;i++){
  const h=String(Math.floor(i/6)).padStart(2,'0'),minute=String((i%6)*10).padStart(2,'0');
  const arr=historyDay+'T'+h+':'+minute+':00+04:00';
  const to=historyDay+'T'+h+':'+String((i%6)*10+9).padStart(2,'0')+':00+04:00';
  await database.query("INSERT INTO public.mvp_object_presence(day_id,day_date,object_id,status,arrived_at,departed_at,departure_recorded_at) VALUES($1,$2::date,$3,'closed',$4,$5,now())",[historyId,historyDay,object.id,arr,to]);
 }
 const historyFirst=await request('/api/presence?date='+historyDay,undefined,cookie);
 assert.equal(historyFirst.status,200,historyFirst.body.error);
 assert.equal(historyFirst.body.items.length,25);
 assert.equal(historyFirst.body.hasMore,true);
 const historyNext=await request('/api/presence?date='+historyDay+'&cursor='+encodeURIComponent(historyFirst.body.nextCursor),undefined,cookie);
 assert.equal(historyNext.status,200,historyNext.body.error);
 assert.equal(historyNext.body.items.length,2);
 assert.equal(historyNext.body.hasMore,false);
 assert.equal(new Set([...historyFirst.body.items,...historyNext.body.items].map(x=>x.id)).size,27);
 assert.equal((await request('/api/presence?date=2026-02-31',undefined,cookie)).status,400);
 assert.equal((await request('/api/presence?date='+historyDay+'&cursor=bad',undefined,cookie)).status,400);
 const presenceExport=await request('/api/export',undefined,cookie);
 assert.equal(presenceExport.status,200,presenceExport.body.error);
 assert.equal(presenceExport.body.objectPresence.length,30);
 console.log('V7_OBJECT_PRESENCE_HISTORY_KEYSET_PAGING_BACKUP_PASS');

 
 for(let i=0;i<27;i++){
  const HH=String(Math.floor(i/6)).padStart(2,'0'),a=String((i%6)*10).padStart(2,'0'),b=String((i%6)*10+9).padStart(2,'0');
  await database.query("INSERT INTO public.mvp_owner_activities(day_date,status,activity_class,summary,start_at,end_at,duration_minutes,ended_recorded_at) VALUES('2026-09-10','completed','ORGANIZATION','Page', $1,$2,9,now())",['2026-09-10T'+HH+':'+a+':00+04:00','2026-09-10T'+HH+':'+b+':00+04:00']);
 }
 const oPage1=await request('/api/owner-activity?date=2026-09-10',undefined,cookie);
 assert.equal(oPage1.status,200);
 assert.equal(oPage1.body.items.length,25);
 assert.equal(oPage1.body.hasMore,true);
 assert.equal(oPage1.body.completedCount,27);
 const oPage2=await request('/api/owner-activity?date=2026-09-10&cursor='+encodeURIComponent(oPage1.body.nextCursor),undefined,cookie);
 assert.equal(oPage2.status,200,oPage2.body.error);
 assert.equal(oPage2.body.items.length,2);
 assert.equal(oPage2.body.hasMore,false);
 assert.equal(new Set([...oPage1.body.items,...oPage2.body.items].map(x=>x.id)).size,27);
 assert.equal((await request('/api/owner-activity?date=2026-02-31',undefined,cookie)).status,400);
 assert.equal((await request('/api/owner-activity?date=2026-09-10&cursor=invalid',undefined,cookie)).status,400);
 const backupOwner=await request('/api/export',undefined,cookie);
 assert.equal(backupOwner.status,200,backupOwner.body.error);
 assert.equal(backupOwner.body.ownerActivityRecords.length,31);
 console.log('V8_OWNER_ACTIVITY_HISTORY_CURSOR_TOTALS_BACKUP_PASS');

 

 // V9B: one persisted auto-plan per order, change propagation, terminal statuses and manual isolation.
 const undated=await create('order_create',{objectId:object.id,title:'Без даты'},cookie);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_schedule_order_items WHERE order_id=$1',[undated.id])).rows[0].n,0);
 const planOnKey=randomUUID();
 const setOn={type:'order_update',payload:{id:undated.id,revision:1,title:'Заказ на январь',plannedOn:'2027-01-05',notes:'Сначала дата',requestKey:planOnKey}};
 const setOnResult=await request('/api/action',setOn,cookie);
 assert.equal(setOnResult.status,200,setOnResult.body.error);
 const linkedAutomatic=(await database.query('SELECT * FROM public.mvp_schedule_order_items WHERE order_id=$1',[undated.id])).rows[0];
 assert.ok(linkedAutomatic.id);
 assert.equal(linkedAutomatic.status,'planned');
 assert.equal(String(linkedAutomatic.schedule_date instanceof Date?linkedAutomatic.schedule_date.toISOString():linkedAutomatic.schedule_date).slice(0,10),'2027-01-05');
 assert.equal((await request('/api/action',setOn,cookie)).body.deduplicated,true);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_schedule_order_items WHERE order_id=$1',[undated.id])).rows[0].n,1);
 assert.equal((await request('/api/action',{type:'order_update',payload:{...setOn.payload,title:'Другой заказ'}},cookie)).status,409);
 const janWeek=await request('/api/schedule?viewMode=week&anchorDate=2027-01-05',undefined,cookie);
 assert.equal(janWeek.body.total,1);
 assert.equal(janWeek.body.items[0].source_kind,'work_order');
 assert.equal(janWeek.body.items[0].auto_source_key,'WORKORDER|'+undated.id);
 assert.equal(janWeek.body.items[0].object_name,'Corrected object');
 const shifted=await create('order_update',{id:undated.id,revision:2,title:'Заказ на январь — перенос',plannedOn:'2027-01-12',notes:'Перенос'},cookie);
 const afterShift=(await database.query('SELECT id,schedule_date::text AS day,title,revision FROM public.mvp_schedule_order_items WHERE order_id=$1',[undated.id])).rows[0];
 assert.equal(afterShift.id,linkedAutomatic.id);
 assert.equal(afterShift.day,'2027-01-12');
 assert.equal(afterShift.title,'Заказ на январь — перенос');
 assert.equal(afterShift.revision,2);
 assert.equal((await request('/api/schedule?viewMode=week&anchorDate=2027-01-05',undefined,cookie)).body.total,0);
 assert.equal((await request('/api/schedule?viewMode=week&anchorDate=2027-01-12',undefined,cookie)).body.total,1);
 const terminalKey=randomUUID();
 // Until the guarded close writer is delivered, cancellation (not false completion)
 // remains the valid terminal transition and must synchronize the auto schedule.
 const terminalPayload={type:'order_status',payload:{id:undated.id,revision:shifted.revision,status:'cancelled',requestKey:terminalKey}};
 const terminal=await request('/api/action',terminalPayload,cookie);
 assert.equal(terminal.status,200,terminal.body.error);
 assert.equal((await request('/api/action',terminalPayload,cookie)).body.deduplicated,true);
 assert.equal((await database.query('SELECT status FROM public.mvp_schedule_order_items WHERE order_id=$1',[undated.id])).rows[0].status,'cancelled');
 assert.equal((await request('/api/action',{type:'order_status',payload:{id:undated.id,revision:shifted.revision,status:'open'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'schedule_save',payload:{id:linkedAutomatic.id,revision:3,status:'cancelled'}},cookie)).status,404);
 const cancelledOrder=await create('order_create',{objectId:object.id,title:'Отменить заказ',plannedOn:'2027-02-03'},cookie);
 const cancelled=await create('order_status',{id:cancelledOrder.id,revision:1,status:'cancelled'},cookie);
 assert.equal((await request('/api/orders/capacity-context?id='+cancelledOrder.id,undefined,cookie)).status,409);
 console.log('WORKORDER_CAPACITY_TERMINAL_ORDER_FAIL_CLOSED_POSTGRES_PASS');
 assert.equal(cancelled.status,'cancelled');
 assert.equal((await database.query('SELECT status FROM public.mvp_schedule_order_items WHERE order_id=$1',[cancelledOrder.id])).rows[0].status,'cancelled');
 const noDateKey=await create('order_update',{id:order.id,revision:changedOrder.revision,title:'Без даты на сегодня',plannedOn:'',notes:'Удалено из графика'},cookie);
 const noDateAuto=(await database.query('SELECT status,id FROM public.mvp_schedule_order_items WHERE order_id=$1',[order.id])).rows[0];
 assert.equal(noDateAuto.status,'cancelled');
 assert.equal(noDateAuto.id,currentAuto.id);
 assert.equal((await database.query('SELECT status,title FROM public.mvp_schedule_items WHERE id=$1',[linked.id])).rows[0].status,'cancelled');
 const invalidAuto=(await request('/api/action',{type:'order_create',payload:{objectId:object.id,title:'Плохая дата',plannedOn:'2027-02-31'}},cookie));
 assert.equal(invalidAuto.status,400);
 const autoCount=await database.query('SELECT count(*)::int n,count(distinct order_id)::int unique_orders FROM public.mvp_schedule_order_items');
 assert.equal(autoCount.rows[0].n,autoCount.rows[0].unique_orders);
 assert.equal(autoCount.rows[0].n,3);
 const autoBackup=await request('/api/export',undefined,cookie);
 assert.equal(autoBackup.status,200,autoBackup.body.error);
 assert.equal(autoBackup.body.scheduleItems.length,2);
 assert.equal(autoBackup.body.scheduleOrderItems.length,3);
 console.log('V9B_WORKORDER_AUTOPLAN_ATOMIC_CREATE_MOVE_STATUS_KEY_REPLAY_MANUAL_ISOLATION_POSTGRES_PASS');

 // Large calendar periods must paginate, never silently truncate.
 for(let i=0;i<52;i++){
  const time='10:'+String(i).padStart(2,'0')+':00+04:00';
  const end='10:'+String(i+1).padStart(2,'0')+':00+04:00';
  await database.query("INSERT INTO public.mvp_schedule_items(status,start_at,end_at,schedule_date,item_type,title) VALUES('planned',$1,$2,'2026-12-10','Работа',$3)",['2026-12-10T'+time,'2026-12-10T'+end,'Synthetic plan '+i]);
 }
 const scheduleFirst=await request('/api/schedule?viewMode=week&anchorDate=2026-12-10',undefined,cookie);
 assert.equal(scheduleFirst.status,200);
 assert.equal(scheduleFirst.body.periodStart,'2026-12-07');
 assert.equal(scheduleFirst.body.periodEnd,'2026-12-13');
 assert.equal(scheduleFirst.body.total,52);
 assert.equal(scheduleFirst.body.items.length,50);
 assert.equal(scheduleFirst.body.hasMore,true);
 const scheduleSecond=await request('/api/schedule?viewMode=week&anchorDate=2026-12-10&cursor='+encodeURIComponent(scheduleFirst.body.nextCursor),undefined,cookie);
 assert.equal(scheduleSecond.status,200,scheduleSecond.body.error);
 assert.equal(scheduleSecond.body.items.length,2);
 assert.equal(scheduleSecond.body.hasMore,false);
 assert.equal(new Set([...scheduleFirst.body.items,...scheduleSecond.body.items].map(x=>x.id)).size,52);
 assert.equal((await request('/api/schedule?viewMode=week&anchorDate=2026-12-10&cursor=bad',undefined,cookie)).status,400);
 const allPlans=await request('/api/export',undefined,cookie);
 assert.equal(allPlans.status,200,allPlans.body.error);
 assert.equal(allPlans.body.scheduleItems.length,54);
 assert.equal(allPlans.body.scheduleOrderItems.length,3);
 // The order planned_on value was not used to synthesize an extra ScheduleItem.
 assert.equal((await database.query("SELECT count(*)::int n FROM public.mvp_schedule_items WHERE auto_source_key=''")).rows[0].n,54);
 console.log('V9A_SCHEDULE_KEYSET_PAGING_AND_BACKUP_FALL_CLOSED_PASS');

 {
 // V9D: WorkerDay is observable attendance, never a WorkLog or payable.
 const v9dFirstOrder=await create('order_create',{objectId:object.id,title:'V9D первый заказ для прихода'},cookie);
 await create('worker_assign_order',{workerId:worker.id,orderId:v9dFirstOrder.id},cookie);
 const arrivedKey=randomUUID();
 const arrivedPayload={type:'worker_day_arrive',payload:{workerId:worker.id,orderId:v9dFirstOrder.id,
  date:'2026-11-04',arrivalAt:'2026-11-04T09:15',notes:'Приход на объект',requestKey:arrivedKey}};
 const beforeLogs=(await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n;
 const arriveFirst=await request('/api/action',arrivedPayload,cookie);
 assert.equal(arriveFirst.status,200,arriveFirst.body.error);
 const day=arriveFirst.body.item;
 assert.equal(day.status,'open');assert.equal(day.day_date,'2026-11-04');
 assert.equal(day.arrival_at,'2026-11-04T09:15');
 assert.equal(arriveFirst.body.linkedOrder,true);
 assert.equal((await request('/api/action',arrivedPayload,cookie)).body.deduplicated,true);
 assert.equal((await request('/api/action',{type:'worker_day_arrive',payload:{...arrivedPayload.payload,arrivalAt:'2026-11-04T09:16'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'worker_day_arrive',payload:{workerId:worker.id,orderId:v9dFirstOrder.id,date:'2026-11-04',arrivalAt:'2026-11-04T09:16'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'worker_day_arrive',payload:{workerId:worker.id,orderId:v9dFirstOrder.id,date:'2026-11-05',arrivalAt:'2026-11-05T09:00'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'worker_day_arrive',payload:{workerId:secondWorker.id,orderId:v9dFirstOrder.id,date:'2026-11-04',arrivalAt:'2026-11-04T10:00'}},cookie)).status,409);
 const workerDaysPage=await request('/api/worker-days?workerId='+worker.id+'&date=2026-11-04',undefined,cookie);
 assert.equal(workerDaysPage.status,200);assert.equal(workerDaysPage.body.items.length,1);
 assert.equal(workerDaysPage.body.items[0].linkedOrders.length,1);
 assert.equal((await request('/api/worker-days?cursor=bad',undefined,cookie)).status,400);
 const otherOrder=await create('order_create',{objectId:object.id,title:'Второй заказ для смены'},cookie);
 await create('worker_assign_order',{workerId:worker.id,orderId:otherOrder.id},cookie);
 const linkedExisting=await request('/api/action',{type:'worker_day_arrive',payload:{
  workerId:worker.id,orderId:otherOrder.id,date:'2026-11-04',arrivalAt:'2026-11-04T09:15',requestKey:randomUUID()}},cookie);
 assert.equal(linkedExisting.status,200,linkedExisting.body.error);
 assert.equal(linkedExisting.body.item.id,day.id);
 assert.equal(linkedExisting.body.attachedExisting,true);
 assert.equal(linkedExisting.body.linkedOrder,true);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_worker_days')).rows[0].n,1);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_worker_day_orders')).rows[0].n,2);
 // V9E: task time, assignment and WorkerDay are independent from owner WorkLog/payroll.
 const startKey=randomUUID();
 const startPayload={type:'worker_task_start',payload:{workerDayId:day.id,workerId:worker.id,
  orderId:v9dFirstOrder.id,startAt:'2026-11-04T09:30',notes:'Монтаж',requestKey:startKey}};
 const taskStart=await request('/api/action',startPayload,cookie);
 assert.equal(taskStart.status,200,taskStart.body.error);
 const task=taskStart.body.item;
 assert.equal(task.status,'active');assert.equal(task.task_type,'WORK_SESSION');
 assert.equal((await request('/api/action',startPayload,cookie)).body.deduplicated,true);
 assert.equal((await request('/api/action',{type:'worker_task_start',payload:{...startPayload.payload,notes:'Different'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'worker_task_start',payload:{workerDayId:day.id,workerId:worker.id,
  orderId:otherOrder.id,startAt:'2026-11-04T09:35'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'worker_day_depart',payload:{
  id:day.id,revision:day.revision,departureAt:'2026-11-04T17:00',closeReasonCode:'work_done_early'}},cookie)).status,409,
 'Cannot depart while WorkerTask active');
 assert.equal((await request('/api/action',{type:'worker_task_finish',payload:{
  id:task.id,revision:task.revision,endAt:'2026-11-04T09:20',taskType:'Прокладка трубы',managementMinutes:0,
  outcome:'COMPLETED'}},cookie)).status,400);
 assert.equal((await request('/api/action',{type:'worker_task_finish',payload:{
  id:task.id,revision:task.revision,endAt:'2026-11-04T11:00',taskType:'Прокладка трубы',managementMinutes:91,
  outcome:'COMPLETED'}},cookie)).status,400);
 assert.equal((await request('/api/action',{type:'worker_task_finish',payload:{
  id:task.id,revision:task.revision,endAt:'2026-11-04T11:00',taskType:'Прокладка трубы',managementMinutes:10,
  outcome:'COMPLETED',problem:'yes'}},cookie)).status,400);
 const finishKey=randomUUID();
 const finishPayload={type:'worker_task_finish',payload:{id:task.id,revision:task.revision,
  endAt:'2026-11-04T11:00',taskType:'Прокладка трубы',resultQty:'12.5',resultUnit:'м',
  managementMinutes:'10',outcome:'COMPLETED',problem:'no',rework:'no',notes:'Уложено',requestKey:finishKey}};
 const finished=await request('/api/action',finishPayload,cookie);
 assert.equal(finished.status,200,finished.body.error);
 assert.equal(finished.body.item.status,'completed');
 assert.equal(finished.body.item.duration_minutes,90);
 assert.equal(finished.body.item.management_minutes,10);
 assert.equal((await request('/api/action',finishPayload,cookie)).body.deduplicated,true);
 assert.equal((await request('/api/action',{type:'worker_task_finish',payload:{...finishPayload.payload,notes:'Other'}},cookie)).status,409);
 const nextTask=await create('worker_task_start',{workerDayId:day.id,workerId:worker.id,
  orderId:otherOrder.id,startAt:'2026-11-04T11:05'},cookie);
 assert.equal(nextTask.status,'active');
 assert.equal((await request('/api/action',{type:'worker_task_start',payload:{workerDayId:day.id,workerId:worker.id,
  orderId:v9dFirstOrder.id,startAt:'2026-11-04T10:50'}},cookie)).status,409);
 const secondTask=await create('worker_task_finish',{id:nextTask.id,revision:1,endAt:'2026-11-04T12:00',
  taskType:'Опрессовка',managementMinutes:0,outcome:'PARTIAL',problem:'yes',problemType:'Нет материалов',
  rework:'yes',reworkMinutes:5},cookie);
 assert.equal(secondTask.status,'completed');
 const taskPage=await request('/api/worker-tasks?workerId='+worker.id+'&date=2026-11-04&limit=1',undefined,cookie);
 assert.equal(taskPage.status,200);assert.equal(taskPage.body.items.length,1);assert.equal(taskPage.body.hasMore,true);
 const taskPage2=await request('/api/worker-tasks?workerId='+worker.id+'&date=2026-11-04&limit=1&cursor='+encodeURIComponent(taskPage.body.nextCursor),undefined,cookie);
 assert.equal(taskPage2.status,200);assert.equal(taskPage2.body.items.length,1);
 assert.notEqual(taskPage.body.items[0].id,taskPage2.body.items[0].id);
 assert.equal((await request('/api/worker-tasks?cursor=bad',undefined,cookie)).status,400);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n,beforeLogs,
  'WorkerTasks do not invent owner WorkLogs');
 const taskExport=await request('/api/export',undefined,cookie);
 assert.equal(taskExport.status,200);assert.equal(taskExport.body.workerTasks.length,2);
 console.log('V9E_WORKER_TASK_START_FINISH_REPLAY_OVERLAP_ASSIGNMENT_SHIFT_GUARD_PAGE_EXPORT_NO_WORKLOG_PASS');
 // V9F: exact-source observed productivity is separate from approved norms, payroll or WorkLogs.
 assert.equal((await request('/api/worker-benchmarks?workerId='+worker.id+'&from=2026-11-04&to=2026-11-04')).status,401);
 const observed=await request('/api/worker-benchmarks?workerId='+worker.id+'&from=2026-11-04&to=2026-11-04',undefined,cookie);
 assert.equal(observed.status,200,observed.body.error);
 assert.equal(observed.body.status,'OBSERVED_ONLY');
 assert.equal(observed.body.sampleCount,1);
 assert.equal(observed.body.items.length,1);
 assert.equal(observed.body.items[0].sampleCount,1);
 assert.equal(observed.body.items[0].taskType,'Прокладка трубы');
 assert.equal(observed.body.items[0].resultUnit,'м');
 assert.equal(observed.body.items[0].totalResult,12.5);
 assert.equal(observed.body.items[0].totalMinutes,90);
 assert.equal(observed.body.items[0].observedPerHour,8.333);
 assert.equal(observed.body.items[0].bestPerHour,8.333);
 assert.equal(observed.body.isApprovedBenchmark,false);
 assert.equal(observed.body.isPayrollBasis,false);
 assert.equal(observed.body.legacyHistoryImported,false);
 const comparative=await request('/api/worker-benchmarks?workerId='+worker.id+'&from=2026-11-04&to=2026-11-04&compare=previous',undefined,cookie);
 assert.equal(comparative.status,200,comparative.body.error);
 assert.equal(comparative.body.compareMode,'previous');
 assert.equal(comparative.body.previousFrom,'2026-11-03');
 assert.equal(comparative.body.previousTo,'2026-11-03');
 assert.equal(comparative.body.previousSampleCount,0);
 assert.equal(comparative.body.items[0].previousSampleCount,0);
 assert.equal(comparative.body.items[0].previousObservedPerHour,null);
 assert.equal(comparative.body.items[0].observedChangePct,null);
 assert.equal((await request('/api/worker-benchmarks?workerId='+worker.id+'&compare=bad',undefined,cookie)).status,400);
 const noSamples=await request('/api/worker-benchmarks?workerId='+secondWorker.id+'&from=2026-11-04&to=2026-11-04',undefined,cookie);
 assert.equal(noSamples.status,200);
 assert.equal(noSamples.body.status,'NO_SAMPLES');
 assert.equal(noSamples.body.items.length,0);
 assert.equal((await request('/api/worker-benchmarks',undefined,cookie)).status,400);
 assert.equal((await request('/api/worker-benchmarks?workerId=bad',undefined,cookie)).status,400);
 assert.equal((await request('/api/worker-benchmarks?workerId='+worker.id+'&from=2026-11-05&to=2026-11-04',undefined,cookie)).status,400);
 assert.equal((await request('/api/worker-benchmarks?workerId='+worker.id+'&from=2024-01-01&to=2026-11-04',undefined,cookie)).status,400);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n,beforeLogs);
 console.log('V9F_OBSERVED_WORKER_TASKS_AUTH_WEIGHTED_MEAN_NULL_EXCLUSION_NO_PAYROLL_NO_WORKLOG_PASS');

 // V9H: owner-only approved target is separate from provisional legacy observation.
 assert.equal((await request('/api/benchmark-proposals')).status,401);
 assert.equal((await request('/api/action',{type:'benchmark_approve',payload:{benchmarkId:'WBM-CI-0001',revision:0,approvedRate:'4',reason:'test',confirmed:'yes'}})).status,401);
 const blankProposals=await request('/api/benchmark-proposals',undefined,cookie);
 assert.equal(blankProposals.status,200,blankProposals.body.error);
 assert.equal(blankProposals.body.items.length,0);
 assert.equal(blankProposals.body.isApprovedAutomatically,false);
 const ciProposal='WBM-CI-0001';
 await database.query("INSERT INTO public.mvp_benchmark_proposals(benchmark_id,benchmark_key,work_type,result_unit,source_tag,observed_rate,best_observed,sample_count,total_result,total_minutes,source_updated_at) VALUES($1,$2,$3,$4,$5,4,6,2,8,120,'2026-10-07T07:51:24Z')",
 [ciProposal,'OWNER_HISTORY||ci-test|pieces','<img src=x onerror=alert(1)>','шт','CI_SYNTHETIC_ONLY']);
 const afterSeed=await request('/api/benchmark-proposals',undefined,cookie);
 assert.equal(afterSeed.status,200,afterSeed.body.error);
 assert.equal(afterSeed.body.items.length,1);
 assert.equal(afterSeed.body.items[0].observed_rate,'4.000');
 assert.equal(afterSeed.body.items[0].approval_status,null);
 assert.equal(afterSeed.body.items[0].source_status,'PROVISIONAL');
 assert.equal((await request('/api/action',{type:'benchmark_approve',payload:{benchmarkId:ciProposal,revision:0,approvedRate:'3.5',reason:'Тест без подтверждения'}},cookie)).status,400);
 assert.equal((await request('/api/action',{type:'benchmark_approve',payload:{benchmarkId:ciProposal,revision:0,approvedRate:'-1',reason:'Проверено',confirmed:'yes'}},cookie)).status,400);
 assert.equal((await request('/api/action',{type:'benchmark_revoke',payload:{benchmarkId:ciProposal,revision:0,reason:'Проверено',confirmed:'yes'}},cookie)).status,409);
 const approvalKey=randomUUID();
 const approvalBody={type:'benchmark_approve',payload:{benchmarkId:ciProposal,revision:0,approvedRate:'3,500',reason:'Лично проверил замеры',confirmed:'yes',requestKey:approvalKey}};
 const approved=await request('/api/action',approvalBody,cookie);
 assert.equal(approved.status,200,approved.body.error);
 assert.equal(approved.body.saved,true);
 assert.equal(approved.body.item.status,'APPROVED');
 assert.equal(approved.body.item.approved_rate,'3.500');
 assert.equal(approved.body.item.revision,1);
 assert.equal(approved.body.isPayrollBasis,false);
 const replayApproved=await request('/api/action',approvalBody,cookie);
 assert.equal(replayApproved.status,200,replayApproved.body.error);
 assert.equal(replayApproved.body.deduplicated,true);
 assert.equal((await request('/api/action',{type:'benchmark_approve',payload:{...approvalBody.payload,approvedRate:'3.6'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'benchmark_approve',payload:{benchmarkId:ciProposal,revision:0,approvedRate:'4.2',reason:'Устаревшая версия',confirmed:'yes'}},cookie)).status,409);
 const acceptedRead=await request('/api/benchmark-proposals',undefined,cookie);
 assert.equal(acceptedRead.body.items[0].observed_rate,'4.000');
 assert.equal(acceptedRead.body.items[0].approved_rate,'3.500');
 assert.equal(acceptedRead.body.items[0].approval_revision,1);
 assert.equal(acceptedRead.body.events.length,1);
 const updated=await create('benchmark_approve',{benchmarkId:ciProposal,revision:1,approvedRate:'4.125',reason:'Уточнение владельца',confirmed:'yes'},cookie);
 assert.equal(updated.revision,2);
 const revoked=await create('benchmark_revoke',{benchmarkId:ciProposal,revision:2,reason:'Временно снимаю норму',confirmed:'yes'},cookie);
 assert.equal(revoked.status,'REVOKED');
 assert.equal(revoked.revision,3);
 assert.equal((await request('/api/action',{type:'benchmark_revoke',payload:{benchmarkId:ciProposal,revision:3,reason:'Повторно отменить',confirmed:'yes'}},cookie)).status,409);
 const reapproved=await create('benchmark_approve',{benchmarkId:ciProposal,revision:3,approvedRate:'4.250',reason:'Повторная проверка',confirmed:'yes'},cookie);
 assert.equal(reapproved.revision,4);
 const verifiedEvents=await database.query('SELECT action,revision FROM public.mvp_benchmark_approval_events ORDER BY event_id');
 assert.deepEqual(verifiedEvents.rows.map(x=>x.action),['benchmark_approve','benchmark_approve','benchmark_revoke','benchmark_approve']);
 assert.deepEqual(verifiedEvents.rows.map(x=>x.revision),[1,2,3,4]);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_benchmark_proposals')).rows[0].n,1);
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n,beforeLogs);
 const approvalsExport=await request('/api/export',undefined,cookie);
 assert.equal(approvalsExport.status,200,approvalsExport.body.error);
 assert.equal(approvalsExport.body.benchmarkProposals.length,1);
 assert.equal(approvalsExport.body.benchmarkApprovals.length,1);
 assert.equal(approvalsExport.body.benchmarkApprovalEvents.length,4);
 console.log('V9H_OWNER_ONLY_SOURCE_UNAPPROVED_APPROVE_REPLAY_MISMATCH_STALE_REVOKE_REAPPROVE_AUDIT_EXPORT_PASS');

 // Failed close must preserve open day and must not create duplicate receipt.
 assert.equal((await request('/api/action',{type:'worker_day_depart',payload:{
  id:day.id,revision:day.revision,departureAt:'2026-11-04T08:00',closeReasonCode:'activity_not_recorded'}},cookie)).status,400);
 assert.equal((await request('/api/action',{type:'worker_day_depart',payload:{
  id:day.id,revision:day.revision,departureAt:'2026-11-04T17:00'}},cookie)).status,400);
 const departed=await create('worker_day_depart',{id:day.id,revision:day.revision,
  departureAt:'2026-11-04T17:00',closeReasonCode:'activity_not_recorded'},cookie);
 assert.equal(departed.status,'closed');assert.equal(departed.departure_at,'2026-11-04T17:00');
 assert.equal(departed.revision,day.revision+1);
 assert.equal((await request('/api/action',{type:'worker_day_arrive',payload:{
  workerId:worker.id,orderId:v9dFirstOrder.id,date:'2026-11-04',arrivalAt:'2026-11-04T09:15'}},cookie)).status,409);
 assert.equal((await request('/api/action',{type:'worker_day_correct',payload:{
  id:day.id,revision:day.revision,arrivalAt:'2026-11-04T09:10'}},cookie)).status,409);
 const corrected=await create('worker_day_correct',{id:day.id,revision:departed.revision,
  arrivalAt:'2026-11-04T09:10',departureAt:'2026-11-04T17:10',
  closeReasonCode:'activity_not_recorded',notes:'Исправлено'},cookie);
 assert.equal(corrected.arrival_at,'2026-11-04T09:10');
 assert.equal(corrected.departure_at,'2026-11-04T17:10');
 // Worker presence on a different date is not today's attendance.
 const noFalseWorkerDay=await request('/api/my-work?orderId='+v9dFirstOrder.id,undefined,cookie);
 assert.equal(noFalseWorkerDay.status,200,noFalseWorkerDay.body.error);
 assert.equal(noFalseWorkerDay.body.contextOrder.id,v9dFirstOrder.id);
 assert.equal(noFalseWorkerDay.body.assignedWorkers.length,1);
 assert.equal(noFalseWorkerDay.body.assignedWorkers[0].day_status,null);
 assert.equal(noFalseWorkerDay.body.assignedWorkers[0].completed_count,0);
 assert.equal(noFalseWorkerDay.body.assignedWorkers[0].completed_minutes,0);
 assert.equal(noFalseWorkerDay.body.assignedWorkers[0].active_count,0);
 assert.equal(noFalseWorkerDay.body.currentSession,null);
 console.log('MYWORK_V1_WORKERDAY_WORKERTASK_DATE_SCOPE_NO_ATTENDANCE_INFERENCE_PASS');
 assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n,beforeLogs,
  'Worker attendance must not invent performed work');
 const workerDayBackup=await request('/api/export',undefined,cookie);
 assert.equal(workerDayBackup.status,200,workerDayBackup.body.error);
 assert.equal(workerDayBackup.body.workerDays.length,1);
 assert.equal(workerDayBackup.body.workerDayOrders.length,2);
 assert.equal((await request('/api/worker-days?limit=0',undefined,cookie)).status,400);
 console.log('V9D_WORKER_DAY_AUTH_ATTENDANCE_ASSIGNMENT_LINKS_KEY_REPLAY_CLOSE_CORRECT_EXPORT_NO_WORKLOG_PASS');
 }

 // V10: imported Google WorkOrders are locked for updates and status changes;
 // new work and worker assignments remain allowed.
 {
  const imported=await create('order_create',{objectId:object.id,title:'V10 synthetic Google-owned order'},cookie);
  const raw={workOrderId:'SYNTHETIC_E2E_ONLY',status:'planned',title:'V10 synthetic Google-owned order'};
  await database.query(
   "INSERT INTO public.mvp_legacy_import_map(source_system,source_entity,source_id,target_id,source_payload) VALUES($1,'WorkOrders',$2,$3,$4::jsonb)",
   ['Working IP APP / M8C cutover baseline','SYNTHETIC_E2E_ONLY',imported.id,JSON.stringify(raw)]);
  const legacyState=(await request('/api/state',undefined,cookie)).body;
  assert.ok(legacyState.legacyGoogleOrderIds.includes(imported.id));
  assert.equal(legacyState.legacyGoogleOrderStatusById[imported.id],'planned');
  const beforeState=legacyState.orders.find(o=>o.id===imported.id);
  assert.equal(beforeState.status,'open');
  const blockedUpdate=await request('/api/action',{type:'order_update',payload:{
   id:imported.id,revision:imported.revision,title:'Forbidden edit'}},cookie);
  assert.equal(blockedUpdate.status,409);
  const importedPreview=await request('/api/orders/close-preview?id='+imported.id,undefined,cookie);
  assert.equal(importedPreview.status,200);
  assert.equal(importedPreview.body.order.googleOwned,true);
  assert.equal(importedPreview.body.canClose,false);
  assert.ok(importedPreview.body.blockers.some(x=>x.includes('Google VBOS')));
    const blockedStatus=await request('/api/action',{type:'order_status',payload:{
   id:imported.id,revision:imported.revision,status:'done'}},cookie);
  assert.equal(blockedStatus.status,409);
  assert.equal((await database.query('SELECT status FROM public.mvp_orders WHERE id=$1',[imported.id])).rows[0].status,'open');
  const assigned=await create('worker_assign_order',{workerId:worker.id,orderId:imported.id},cookie);
  assert.equal(assigned.status,'active');
  // Prior scenarios closed the local synthetic workday. Reopen only the
  // disposable CI fixture; no owner/runtime business data is affected.
  await database.query("UPDATE public.mvp_work_days SET status='open',closed_at=NULL WHERE day_date=$1",[now]);
  const started=await create('work_start_order',{orderId:imported.id},cookie);
  assert.equal(started.order_id,imported.id);
  const stillOpen=(await database.query('SELECT status,revision FROM public.mvp_orders WHERE id=$1',[imported.id])).rows[0];
  assert.equal(stillOpen.status,'open');
  assert.equal(stillOpen.revision,imported.revision);
  await create('session_stop',{id:started.id},cookie);
  const log=await create('log_create',{orderId:imported.id,title:'Synthetic V10 performed work',minutes:12},cookie);
  assert.equal(log.order_id,imported.id);
  assert.equal((await database.query('SELECT status FROM public.mvp_orders WHERE id=$1',[imported.id])).rows[0].status,'open');
  console.log('V10_GOOGLE_ORDER_DENY_METADATA_EDITS_ALLOW_ASSIGNMENT_SESSION_LOG_PRESERVE_STATUS_PASS');
 }


 // V13b.2: real temporary PostgreSQL native close; no shared Neon writes.
 {
  const native=await create('order_create',{objectId:object.id,title:'V13b2 synthetic native closure',plannedOn:'2027-06-01'},cookie);
  const assignment=(await database.query(
   "INSERT INTO public.mvp_worker_order_assignments(worker_id,order_id) VALUES($1,$2) RETURNING id",[worker.id,native.id])).rows[0];
  const manual=(await database.query(
   "INSERT INTO public.mvp_schedule_items(source_kind,status,order_id,object_id,item_type,title,start_at,end_at,schedule_date) VALUES('manual','planned',$1,$2,'Работа','V13b2 future manual plan','2027-06-02T09:00:00+04:00','2027-06-02T10:00:00+04:00','2027-06-02') RETURNING id",
   [native.id,object.id])).rows[0];
  const fullAssessment={paymentBehavior:'ON_TIME',communicationQuality:'EASY',scopeChanges:'NONE',
   workAgain:'YES',acceptance:'NO_REMARKS',satisfaction:'YES',comment:'Проверен вручную'};
  const reqKey=randomUUID();
  const closePayload={orderId:native.id,revision:native.revision,completionDate:'2026-11-05',
   financeChecked:'yes',financeReference:'Выписка банка, проверка от 05.11.2026',
   unfinishedObligationsStatus:'NONE',clientAssessment:fullAssessment,closeNote:'Работа сдана',
   requestKey:reqKey};
  const close=async p=>request('/api/action',{type:'close_work_order',payload:p},cookie);
  assert.equal((await request('/api/orders/close-fact?id='+native.id)).status,401);
  assert.equal((await request('/api/action',{type:'close_work_order',payload:closePayload})).status,401);
  assert.equal((await close({...closePayload,financeChecked:'no'})).status,400);
  assert.equal((await close({...closePayload,financeReference:'abc'})).status,400);
  assert.equal((await close({...closePayload,unfinishedObligationsStatus:'REMAINS'})).status,409);
  assert.equal((await close({...closePayload,clientAssessment:{...fullAssessment,scopeChanges:'INVENTED'}})).status,400);
  const imported=await create('order_create',{objectId:object.id,title:'V13b2 source-owned forbidden'},cookie);
  await database.query(
   "INSERT INTO public.mvp_legacy_import_map(source_system,source_entity,source_id,target_id,source_payload) VALUES('Working IP APP / M8C cutover baseline','WorkOrders','V13B2_CI_IMPORT_ONLY',$1,'{}'::jsonb)",[imported.id]);
  assert.equal((await close({...closePayload,orderId:imported.id,requestKey:randomUUID()})).status,409);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_native_order_close_facts')).rows[0].n,0);
  const openDay=(await database.query("INSERT INTO public.mvp_work_days(day_date) VALUES('2027-06-01') RETURNING id")).rows[0];
  const openSession=(await database.query(
   "INSERT INTO public.mvp_sessions(request_key,day_id,order_id,description) VALUES($1,$2,$3,'V13b2 synthetic open session') RETURNING id",
   [randomUUID(),openDay.id,native.id])).rows[0];
  assert.equal((await close(closePayload)).status,409);
  await database.query('UPDATE public.mvp_sessions SET ended_at=now() WHERE id=$1',[openSession.id]);
  assert.equal((await close({...closePayload,revision:999})).status,409);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_native_close_requests WHERE request_key=$1',[reqKey])).rows[0].n,0);
  // Fault after assignments, plans, evidence and receipt were inserted: everything must roll back.
  await database.query("CREATE FUNCTION public.ci_native_close_fail() RETURNS trigger LANGUAGE plpgsql AS $ci$BEGIN IF NEW.status='done' THEN RAISE EXCEPTION 'SYNTHETIC_NATIVE_CLOSE_FAIL'; END IF; RETURN NEW; END$ci$");
  await database.query("CREATE TRIGGER zz_ci_native_close_fail BEFORE UPDATE OF status ON public.mvp_orders FOR EACH ROW EXECUTE FUNCTION public.ci_native_close_fail()");
  assert.equal((await close(closePayload)).status,500);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_native_client_assessments')).rows[0].n,0);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_native_order_close_facts')).rows[0].n,0);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_native_close_requests WHERE request_key=$1',[reqKey])).rows[0].n,0);
  assert.equal((await database.query('SELECT status FROM public.mvp_worker_order_assignments WHERE id=$1',[assignment.id])).rows[0].status,'active');
  assert.equal((await database.query('SELECT status FROM public.mvp_schedule_items WHERE id=$1',[manual.id])).rows[0].status,'planned');
  assert.equal((await database.query('SELECT status FROM public.mvp_orders WHERE id=$1',[native.id])).rows[0].status,'open');
  await database.query('DROP TRIGGER zz_ci_native_close_fail ON public.mvp_orders');
  await database.query('DROP FUNCTION public.ci_native_close_fail()');
  // Same requestKey succeeds once after failed transaction, then gives a byte-equivalent replay.
  const accepted=await close(closePayload);
  assert.equal(accepted.status,200,accepted.body.error);
  assert.equal(accepted.body.saved,true);
  assert.equal(accepted.body.closed,true);
  assert.equal(accepted.body.item.status,'done');
  assert.equal(accepted.body.assessment.score,100);
  assert.equal(accepted.body.assessment.riskLabel,'LOW_RISK');
  assert.equal(accepted.body.financeStatus,'UNVERIFIED_IN_CLEAN');
  assert.equal(accepted.body.externalManualFinance,true);
  // CRM-20A: owner-authenticated native close and exact frozen-history Client view.
  // ALL fixtures and DDL below are restricted to disposable local PostgreSQL.
  const owningClient=(await database.query('SELECT client_id FROM public.mvp_objects WHERE id=$1',
   [object.id])).rows[0].client_id;
  const clientHistoryPath='/api/crm/client-assessments?clientId='+owningClient;
  assert.equal((await request(clientHistoryPath)).status,401);
  assert.equal((await request('/api/crm/client-assessments?clientId=invalid',undefined,cookie)).status,400);
  assert.equal((await request('/api/crm/client-assessments?clientId='+randomUUID(),undefined,cookie)).status,404);
  const nativeOnly=await request(clientHistoryPath,undefined,cookie);
  assert.equal(nativeOnly.status,200,nativeOnly.body.error);
  assert.equal(nativeOnly.body.readonly,true);
  assert.equal(nativeOnly.body.nativeCount,1);
  assert.equal(nativeOnly.body.archiveStatus,'UNAVAILABLE','Missing frozen archive never misrepresented as empty');
  assert.equal(nativeOnly.body.items[0].score,100);
  assert.equal(nativeOnly.body.items[0].source,'CLEAN_NATIVE');
  // Synthetic isolated archive evidence, not owner historical records.
  await database.query('CREATE SCHEMA IF NOT EXISTS mvp_history');
  await database.query('CREATE TABLE mvp_history.import_batches(batch_id text PRIMARY KEY,expected_counts jsonb NOT NULL,evidence_manifest_sha256 text NOT NULL)');
  await database.query('CREATE TABLE mvp_history.batch_receipts(batch_id text,receipt_kind text,reconciled_counts jsonb,verified_manifest_sha256 text)');
  await database.query('CREATE TABLE mvp_history.source_records(source_kind text,source_id text,source_system text,import_batch_id text,client_source_id text,original_status text,source_payload jsonb)');
  const frozenCounts={LEAD:33,CLIENT:17,OBJECT:19,WORKER:2,WORK_ORDER:22,
   CLIENT_ASSESSMENT:13,WORKER_ASSIGNMENT:1,FINANCE_TRANSACTION:24};
  const batch='CRM20_SYNTHETIC_DISPOSABLE_BATCH',sha='c'.repeat(64);
  await database.query('INSERT INTO mvp_history.import_batches(batch_id,expected_counts,evidence_manifest_sha256) VALUES($1,$2::jsonb,$3)',
   [batch,JSON.stringify(frozenCounts),sha]);
  await database.query("INSERT INTO mvp_history.batch_receipts(batch_id,receipt_kind,reconciled_counts,verified_manifest_sha256) VALUES($1,'RECONCILED_IN_ISOLATED_TEST',$2::jsonb,$3)",
   [batch,JSON.stringify(frozenCounts),sha]);
  const originalClientId='CL-CRM20-DISPOSABLE',unrelatedClientId='CL-CRM20-OTHER';
  const outsider=await create('client_create',{name:'CRM20 other synthetic client'},cookie);
  for(const [legacyId,clientUuid] of [[originalClientId,owningClient],[unrelatedClientId,outsider.id]]){
   await database.query("INSERT INTO public.mvp_legacy_import_map(source_system,source_entity,source_id,target_id,source_payload) VALUES('Working IP APP / M8C cutover baseline','Clients',$1,$2,'{}'::jsonb)",
    [legacyId,clientUuid]);
  }
  const archivedInputs=[
   {suffix:'FIRST',client:originalClientId,score:100,known:true},
   {suffix:'MISSING',client:originalClientId,score:'',known:false},
   {suffix:'OUTSIDER',client:unrelatedClientId,score:100,known:true}
  ];
  for(const item of archivedInputs){
   const work='WO-CRM20-'+item.suffix,cas='CAS-CRM20-'+item.suffix,obj='OBJ-CRM20-'+item.suffix;
   const orderFields={clientId:item.client,objectId:obj,clientAssessmentId:cas,
    completionDate:46250,closedAt:'2026-08-16T16:00:00Z',
    financeCheckedAt:'2026-08-16T15:00:00Z',
    unfinishedObligationsStatus:'NONE',clientRequestId:'CRM20_DISPOSABLE_ONLY',
    title:'Исторический заказ '+item.suffix};
   const assessmentFields={clientAssessmentId:cas,clientId:item.client,objectId:obj,
    workOrderId:work,satisfaction:item.known?'YES':'UNKNOWN',
    acceptance:item.known?'NO_REMARKS':'UNKNOWN',
    paymentBehavior:item.known?'ON_TIME':'UNKNOWN',
    communicationQuality:item.known?'EASY':'UNKNOWN',
    scopeChanges:item.known?'NONE':'UNKNOWN',
    workAgain:item.known?'YES':'UNKNOWN',
    score:item.score,scoreVersion:'CLIENT_SCORE_V1_100',
    riskLabel:item.known?'LOW_RISK':'UNKNOWN',
    updatedAt:'2026-08-16T17:00:00Z'};
   await database.query("INSERT INTO mvp_history.source_records(source_kind,source_id,source_system,import_batch_id,client_source_id,original_status,source_payload) VALUES('WORK_ORDER',$1,'LEGACY_GOOGLE',$2,$3,'completed',$4::jsonb)",
    [work,batch,item.client,JSON.stringify(orderFields)]);
   await database.query("INSERT INTO mvp_history.source_records(source_kind,source_id,source_system,import_batch_id,client_source_id,original_status,source_payload) VALUES('CLIENT_ASSESSMENT',$1,'LEGACY_GOOGLE',$2,$3,'active',$4::jsonb)",
    [cas,batch,item.client,JSON.stringify(assessmentFields)]);
  }
  const combined=await request(clientHistoryPath,undefined,cookie);
  assert.equal(combined.status,200,combined.body.error);
  assert.equal(combined.body.archiveStatus,'VERIFIED_READONLY');
  assert.equal(combined.body.nativeCount,1);
  assert.equal(combined.body.archiveCount,2);
  assert.equal(combined.body.totalCount,3);
  assert.equal(combined.body.scoredCount,2);
  assert.equal(combined.body.average,100);
  assert.equal(combined.body.historicalGoogleImported,false);
  assert.equal(combined.body.items.filter(x=>x.source==='VERIFIED_LEGACY_ARCHIVE').length,2);
  assert.equal(combined.body.items.find(x=>x.legacyAssessmentId==='CAS-CRM20-MISSING').score,null);
  assert.ok(!combined.body.items.some(x=>x.legacyAssessmentId==='CAS-CRM20-OUTSIDER'),
   'a different client history must not leak across mapping IDs');
  const otherHistory=await request('/api/crm/client-assessments?clientId='+outsider.id,undefined,cookie);
  assert.equal(otherHistory.status,200);
  assert.equal(otherHistory.body.nativeCount,0);
  assert.equal(otherHistory.body.archiveCount,1);
  assert.equal(otherHistory.body.items[0].legacyAssessmentId,'CAS-CRM20-OUTSIDER');
  console.log('CRM20A_DISPOSABLE_REAL_POSTGRES_NATIVE_AND_VERIFIED_ARCHIVE_EXACT_CLIENT_LINK_SCORE_AVERAGE_AUTH_PASS');

  const expectedOwnerLogin=(await database.query("SELECT setting_value FROM public.mvp_settings WHERE setting_key='owner_login'")).rows[0].setting_value;
  const fact=(await database.query('SELECT * FROM public.mvp_native_order_close_facts WHERE order_id=$1',[native.id])).rows[0];
  assert.equal(fact.finance_mode,'EXTERNAL_MANUAL');
  assert.equal(fact.payment_status,'UNVERIFIED_IN_CLEAN');
  assert.equal(fact.closed_by_login,expectedOwnerLogin);
  assert.ok(fact.finance_checked_at);
  assert.equal(fact.finance_check_reference,closePayload.financeReference);
  assert.equal(fact.removed_worker_assignments,1);
  assert.equal(fact.archived_manual_plans,1);
  assert.equal((await database.query('SELECT status FROM public.mvp_worker_order_assignments WHERE id=$1',[assignment.id])).rows[0].status,'removed');
  assert.equal((await database.query('SELECT status FROM public.mvp_schedule_items WHERE id=$1',[manual.id])).rows[0].status,'archived');
  assert.equal((await database.query('SELECT status FROM public.mvp_schedule_order_items WHERE order_id=$1',[native.id])).rows[0].status,'completed');
  const readback=await request('/api/orders/close-fact?id='+native.id,undefined,cookie);
  assert.equal(readback.status,200);
  assert.equal(readback.body.readonly,true);
  assert.equal(readback.body.financeIsSettled,false);
  assert.equal(readback.body.fact.closedByLogin,expectedOwnerLogin);
  assert.equal(readback.body.fact.paymentStatus,'UNVERIFIED_IN_CLEAN');
  assert.equal((await close({...closePayload,financeReference:'Другой источник подтверждения'})).status,409);
  const again=await close(closePayload);
  assert.equal(again.status,200);
  assert.equal(again.body.deduplicated,true);
  assert.equal(again.body.item.id,accepted.body.item.id);
  assert.equal((await close({...closePayload,requestKey:randomUUID()})).status,409);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_native_order_close_facts')).rows[0].n,1);
  assert.equal((await request('/api/action',{type:'order_status',payload:{id:native.id,revision:2,status:'open'}},cookie)).status,409);
  assert.equal((await request('/api/action',{type:'order_update',payload:{id:native.id,revision:2,title:'Invalid postclose edit'}},cookie)).status,409);
  await assert.rejects(database.query("INSERT INTO public.mvp_worker_order_assignments(worker_id,order_id) VALUES($1,$2)",[worker.id,native.id]),x=>x.code==='23514');
  await assert.rejects(database.query("UPDATE public.mvp_native_order_close_facts SET payment_status='UNVERIFIED_IN_CLEAN' WHERE order_id=$1",[native.id]),x=>x.code==='55000');
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_native_client_assessments')).rows[0].n,1);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_native_close_requests WHERE request_key=$1',[reqKey])).rows[0].n,1);
  console.log('V13B2_NATIVE_CLOSE_REAL_PG_FINANCE_MANUAL_OWNER_SCORE_ATOMIC_ROLLBACK_REPLAY_GOOGLE_GUARD_PASS');
 }

 // CRM-01: genuine additive PostgreSQL contract, all fixture data disposable.
 {
  const crm01Existing=await create('client_create',{name:'CRM01 repeat client',phone:'091234567'},cookie);
  const crm01OtherObject=object; // owned by a DIFFERENT client than the repeat candidate.
  const crm01RepeatLead=await create('lead_create',{title:'CRM01 repeat',contactName:'Known',phone:'+374 91 234 567'},cookie);
  const action=payload=>request('/api/action',{type:'lead_convert',payload:{...payload,requestKey:payload.requestKey||randomUUID()}},cookie);
  const noExplicitChoice=await action({leadId:crm01RepeatLead.id,revision:crm01RepeatLead.revision});
  assert.equal(noExplicitChoice.status,409);
  assert.match(noExplicitChoice.body.error,/Выбери его явно/);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_lead_client_links WHERE lead_id=$1',[crm01RepeatLead.id])).rows[0].n,0);
  const mismatch=await action({leadId:crm01RepeatLead.id,revision:crm01RepeatLead.revision,clientId:client.id});
  assert.equal(mismatch.status,409);
  const wrongObject=await action({leadId:crm01RepeatLead.id,revision:crm01RepeatLead.revision,clientId:crm01Existing.id,objectId:crm01OtherObject.id});
  assert.equal(wrongObject.status,409);
  const valid=await action({leadId:crm01RepeatLead.id,revision:crm01RepeatLead.revision,clientId:crm01Existing.id});
  assert.equal(valid.status,200,valid.body.error);
  assert.equal(valid.body.clientId,crm01Existing.id);
  assert.equal(valid.body.conversion,'linked_existing');
  assert.equal((await request('/api/action',{type:'order_create',payload:{objectId:crm01OtherObject.id,leadId:crm01RepeatLead.id,title:'CRM01 forbidden wrong parent',requestKey:randomUUID()}},cookie)).status,409);
  console.log('CRM01_REPEAT_PHONE_MATCH_EXPLICIT_CONFIRMATION_WRONG_PARENT_ROLLBACK_PASS');

  const crm01NewLead=await create('lead_create',{title:'CRM01 new',contactName:'Fresh name',phone:'+374 99 777 11 22'},cookie);
  const newKey=randomUUID(),newPayload={leadId:crm01NewLead.id,revision:crm01NewLead.revision,newClientName:'Fresh created customer',requestKey:newKey};
  const fresh=await action(newPayload);
  assert.equal(fresh.status,200,fresh.body.error);
  assert.equal(fresh.body.conversion,'created_new');
  const newClientAgreement=await database.query(
   'SELECT id,lead_id FROM public.mvp_crm_interactions WHERE request_key=$1',[newKey]);
  assert.equal(newClientAgreement.rowCount,1);
  assert.equal(newClientAgreement.rows[0].lead_id,crm01NewLead.id);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_orders WHERE lead_id=$1',[crm01NewLead.id])).rows[0].n,0);
  const created=(await database.query('SELECT id,name,phone FROM public.mvp_clients WHERE id=$1',[fresh.body.clientId])).rows[0];
  assert.equal(created.name,'Fresh created customer');
  assert.equal(created.phone,'374997771122');
  assert.equal((await database.query('SELECT status FROM public.mvp_leads WHERE id=$1',[crm01NewLead.id])).rows[0].status,'won');
  const replay=await action(newPayload);
  assert.equal(replay.status,200);assert.equal(replay.body.deduplicated,true);
  assert.equal(replay.body.clientId,fresh.body.clientId);
  assert.equal((await action({...newPayload,newClientName:'mismatched attempt'})).status,409);
  assert.equal((await action({...newPayload,requestKey:randomUUID()})).status,409);
  const crm01NewObject=await create('object_create',{clientId:fresh.body.clientId,name:'CRM01 new object'},cookie);
  const crm01NewOrder=await create('order_create',{objectId:crm01NewObject.id,leadId:crm01NewLead.id,title:'CRM01 end-to-end source order'},cookie);
  assert.equal(crm01NewOrder.lead_id,crm01NewLead.id);
  console.log('CRM01_NEW_CLIENT_OBJECT_ORDER_ATOMIC_REPLAY_PRESERVED_IDS_PASS');

  // Historical/dirty Client duplicates must still fail closed during conversion.
  // CRM21 correctly blocks a second duplicate through the public create API,
  // so inject the second legacy-only fixture into disposable CI PostgreSQL.
  await create('client_create',{name:'CRM01 duplicate one',phone:'091555555'},cookie);
  const legacyAmbiguousFixture=await database.query(
   "INSERT INTO public.mvp_clients(request_key,name,phone) "+
   "VALUES($1,'CRM01 duplicate two','+374 91 555 555') RETURNING id",
   [randomUUID()]);
  assert.equal(legacyAmbiguousFixture.rows.length,1);
  const crm01Ambiguous=await create('lead_create',{title:'CRM01 ambiguous',contactName:'Ambiguous',phone:'091555555'},cookie);
  const ambiguity=await action({leadId:crm01Ambiguous.id,revision:crm01Ambiguous.revision});
  assert.equal(ambiguity.status,409);
  assert.match(ambiguity.body.error,/несколько клиентов/);
  assert.equal((await database.query('SELECT status FROM public.mvp_leads WHERE id=$1',[crm01Ambiguous.id])).rows[0].status,'new');

  // Revision is checked inside the same transaction as the link mutation.
  const crm01Stale=await create('lead_create',{title:'CRM01 stale',contactName:'Stale',phone:'099123455'},cookie);
  const moved=await create('lead_status',{id:crm01Stale.id,revision:crm01Stale.revision,status:'qualified'},cookie);
  assert.equal(moved.revision,2);
  assert.equal((await action({leadId:crm01Stale.id,revision:1})).status,409);
  const freshRev=await action({leadId:crm01Stale.id,revision:2});
  assert.equal(freshRev.status,200,freshRev.body.error);
  console.log('CRM01_AMBIGUOUS_CLIENTS_AND_STALE_REVISION_FAIL_CLOSED_PASS');

  // Inject failure at the final Lead status write: new Client, relation and
  // idempotency receipt must be atomically rolled back.
  const crm01FaultLead=await create('lead_create',{title:'CRM01 rollback source',contactName:'Atomic',phone:'099456788'},cookie);
  const beforeCount=(await database.query('SELECT count(*)::int n FROM public.mvp_clients')).rows[0].n;
  await database.query("CREATE FUNCTION public.crm01_fail_won_ci() RETURNS trigger LANGUAGE plpgsql AS $ci$ BEGIN IF NEW.status='won' AND NEW.title LIKE 'CRM01 rollback%' THEN RAISE EXCEPTION 'CRM01_SYNTHETIC_ABORT'; END IF; RETURN NEW; END $ci$");
  await database.query("CREATE TRIGGER zz_crm01_fail_won BEFORE UPDATE OF status ON public.mvp_leads FOR EACH ROW EXECUTE FUNCTION public.crm01_fail_won_ci()");
  const faultKey=randomUUID(),faultPayload={leadId:crm01FaultLead.id,revision:crm01FaultLead.revision,requestKey:faultKey};
  const fault=await action(faultPayload);
  assert.equal(fault.status,500);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_clients')).rows[0].n,beforeCount);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_lead_client_links WHERE lead_id=$1',[crm01FaultLead.id])).rows[0].n,0);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_conversion_requests WHERE request_key=$1',[faultKey])).rows[0].n,0);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_interactions WHERE request_key=$1',[faultKey])).rows[0].n,0);
  await database.query('DROP TRIGGER zz_crm01_fail_won ON public.mvp_leads');
  await database.query('DROP FUNCTION public.crm01_fail_won_ci()');
  const afterFault=await action(faultPayload);
  assert.equal(afterFault.status,200,afterFault.body.error);
  console.log('CRM01_REAL_PG_INJECTED_FAILURE_FULL_ROLLBACK_SAME_KEY_RETRY_PASS');
 }

 // CRM-02: selecting an existing Client at Lead creation must not mean conversion.
 {
  const known=await create('client_create',{name:'CRM02 existing customer',phone:'+374 94 123 654'},cookie);
  const before=(await database.query('SELECT count(*)::int n FROM public.mvp_clients')).rows[0].n;
  const intakeKey=randomUUID();
  const leadArgs={title:'CRM02 tomorrow visit',clientId:known.id,contactName:'Customer representative',
    phone:'095555555',notes:'Synthetic visit tomorrow. No calendar event.',requestKey:intakeKey};
  const created=await request('/api/action',{type:'lead_create',payload:leadArgs},cookie);
  assert.equal(created.status,200,created.body.error);
  assert.equal(created.body.association,'EXISTING_CLIENT_INTAKE');
  assert.equal(created.body.item.status,'new');
  const intake=(await database.query('SELECT client_id,source_kind FROM public.mvp_crm_lead_intakes WHERE lead_id=$1',[created.body.item.id])).rows[0];
  assert.equal(intake.client_id,known.id);
  assert.equal(intake.source_kind,'EXISTING_CLIENT_SELECTED_AT_INTAKE');
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_clients')).rows[0].n,before);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_lead_client_links WHERE lead_id=$1',[created.body.item.id])).rows[0].n,0);
  const replay=await request('/api/action',{type:'lead_create',payload:leadArgs},cookie);
  assert.equal(replay.status,200);assert.equal(replay.body.deduplicated,true);
  assert.equal(replay.body.item.id,created.body.item.id);
  assert.equal((await request('/api/action',{type:'lead_create',payload:{...leadArgs,notes:'Different info'}},cookie)).status,409);
  const snapshot=(await request('/api/state',undefined,cookie)).body;
  assert.equal(snapshot.leadIntakes.some(x=>x.lead_id===created.body.item.id&&x.client_id===known.id),true);
  const other=await create('client_create',{name:'CRM02 other customer'},cookie);
  const wrong=await request('/api/action',{type:'lead_convert',payload:{
    leadId:created.body.item.id,revision:created.body.item.revision,clientId:other.id,requestKey:randomUUID()}},cookie);
  assert.equal(wrong.status,409);
  assert.match(wrong.body.error,/выбранным ранее клиентом/);
  const finished=await request('/api/action',{type:'lead_convert',payload:{
    leadId:created.body.item.id,revision:created.body.item.revision,clientId:known.id,requestKey:randomUUID()}},cookie);
  assert.equal(finished.status,200,finished.body.error);
  assert.equal(finished.body.conversion,'linked_existing');
  assert.equal(finished.body.clientId,known.id);
  assert.equal((await database.query('SELECT status FROM public.mvp_leads WHERE id=$1',[created.body.item.id])).rows[0].status,'won');
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_clients')).rows[0].n,before+1);
  console.log('CRM02_EXISTING_CLIENT_SELECTED_ON_INTAKE_NEW_STATUS_REPLAY_LATER_CONVERSION_PASS');
  // Missing Client cannot produce a dangling Lead or intake.
  const absentKey=randomUUID(),priorLeads=(await database.query('SELECT count(*)::int n FROM public.mvp_leads')).rows[0].n;
  const missing=await request('/api/action',{type:'lead_create',payload:{
    title:'CRM02 missing client',clientId:randomUUID(),requestKey:absentKey}},cookie);
  assert.equal(missing.status,404);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_leads')).rows[0].n,priorLeads);
  const failKey=randomUUID(),badArgs={title:'CRM02 fault injection',clientId:known.id,requestKey:failKey};
  await database.query("CREATE FUNCTION public.crm02_fail_intake_ci() RETURNS trigger LANGUAGE plpgsql AS $ci$ BEGIN RAISE EXCEPTION 'CRM02_SYNTHETIC_ABORT'; END $ci$");
  await database.query("CREATE TRIGGER zz_crm02_fail_intake BEFORE INSERT ON public.mvp_crm_lead_intakes FOR EACH ROW EXECUTE FUNCTION public.crm02_fail_intake_ci()");
  const failed=await request('/api/action',{type:'lead_create',payload:badArgs},cookie);
  assert.equal(failed.status,500);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_leads WHERE request_key=$1',[failKey])).rows[0].n,0);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_lead_intakes WHERE request_key=$1',[failKey])).rows[0].n,0);
  await database.query('DROP TRIGGER zz_crm02_fail_intake ON public.mvp_crm_lead_intakes');
  await database.query('DROP FUNCTION public.crm02_fail_intake_ci()');
  const retry=await request('/api/action',{type:'lead_create',payload:badArgs},cookie);
  assert.equal(retry.status,200,retry.body.error);
  assert.equal(retry.body.item.status,'new');
  console.log('CRM02_REAL_POSTGRES_MISSING_CLIENT_AND_INJECTED_FAILURE_FULL_ROLLBACK_RETRY_PASS');
 }

 // CRM-03: owner-controlled manual site visit carries a traceable CRM lead ID
 // but does NOT mutate the lead, make a WorkOrder or silently create a calendar row.
 {
  const source=await create('lead_create',{title:'CRM03 visit lead',contactName:'Visit source'},cookie);
  const leadBefore=(await database.query('SELECT status,revision FROM public.mvp_leads WHERE id=$1',[source.id])).rows[0];
  const visitKey=randomUUID(),payload={
   revision:0,startAt:'2026-11-06T09:00',endAt:'2026-11-06T10:00',
   itemType:'Осмотр',title:'Осмотр · CRM03 visit lead',
   notes:'CRM LEAD ID: '+source.id+'\nКонтакт: Visit source\nДетали: Проверить объект',
   requestKey:visitKey
  };
  const before=(await database.query('SELECT count(*)::int n FROM public.mvp_schedule_items')).rows[0].n;
  const saved=await create('schedule_save',payload,cookie);
  assert.equal(saved.status,'planned');assert.equal(saved.schedule_date,'2026-11-06');
  assert.equal(saved.item_type,'Осмотр');assert.equal(saved.notes,payload.notes);
  const replay=await request('/api/action',{type:'schedule_save',payload},cookie);
  assert.equal(replay.status,200);assert.equal(replay.body.deduplicated,true);
  assert.equal(replay.body.item.id,saved.id);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_schedule_items')).rows[0].n,before+1);
  const leadAfter=(await database.query('SELECT status,revision FROM public.mvp_leads WHERE id=$1',[source.id])).rows[0];
  assert.deepEqual(leadAfter,leadBefore);
  const plan=await request('/api/schedule?viewMode=week&anchorDate=2026-11-06',undefined,cookie);
  assert.equal(plan.status,200);
  assert.equal(plan.body.items.some(x=>x.id===saved.id&&x.notes.includes('CRM LEAD ID: '+source.id)),true);
  console.log('CRM03_MANUAL_LEAD_SITE_VISIT_REAL_PG_SAVE_REPLAY_NO_LEAD_MUTATION_PASS');
 }

 // CRM-04: record real visit notes without schema, lead status mutation or auto-calendar writes.
 {
  const source=await create('lead_create',{title:'CRM04 site report',contactName:'Contact Person',notes:'Original property observation'},cookie);
  const date='2026-11-06',key=randomUUID();
  const payload={leadId:source.id,revision:source.revision,visitDate:date,
   observations:'Radiators and collector inspected',nextAction:'Prepare written estimate',
   followUpOn:'2026-11-09',requestKey:key};
  const beforePlan=(await database.query('SELECT count(*)::int n FROM public.mvp_schedule_items')).rows[0].n;
  const result=await request('/api/action',{type:'lead_visit_record',payload},cookie);
  assert.equal(result.status,200,result.body.error);
  assert.equal(result.body.source,'CRM04_LEAD_NOTES');
  assert.equal(result.body.item.status,'new');
  assert.equal(result.body.item.revision,source.revision+1);
  const stored=(await database.query('SELECT id,title,contact_name,status,notes,revision FROM public.mvp_leads WHERE id=$1',[source.id])).rows[0];
  assert.equal(stored.title,source.title);
  assert.equal(stored.contact_name,source.contact_name);
  assert.equal(stored.status,'new');
  assert.ok(stored.notes.startsWith('Original property observation\n\n'));
  assert.match(stored.notes,/\[CRM04 RECORD \|/);
  assert.match(stored.notes,/Дата осмотра: 2026-11-06/);
  assert.match(stored.notes,/Результат: Radiators and collector inspected/);
  assert.match(stored.notes,/Следующий контакт: 2026-11-09/);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_schedule_items')).rows[0].n,beforePlan);
  const replay=await request('/api/action',{type:'lead_visit_record',payload},cookie);
  assert.equal(replay.status,200,replay.body.error);
  assert.equal(replay.body.deduplicated,true);
  assert.equal(replay.body.item.revision,source.revision+1);
  assert.equal((await request('/api/action',{type:'lead_visit_record',payload:{...payload,nextAction:'Changed'}} ,cookie)).status,409);
  const stale=await request('/api/action',{type:'lead_visit_record',payload:{...payload,requestKey:randomUUID()}},cookie);
  assert.equal(stale.status,409);
  const denied=await request('/api/action',{type:'lead_visit_record',payload:{...payload,requestKey:randomUUID()}});
  assert.equal(denied.status,401);
  const lost=await create('lead_create',{title:'CRM04 lost lead'},cookie);
  const lostNow=await create('lead_status',{id:lost.id,revision:1,status:'lost'},cookie);
  const lostResult=await request('/api/action',{type:'lead_visit_record',payload:{
   ...payload,leadId:lost.id,revision:lostNow.revision,requestKey:randomUUID()}},cookie);
  assert.equal(lostResult.status,409);
  assert.equal((await database.query('SELECT notes FROM public.mvp_leads WHERE id=$1',[lost.id])).rows[0].notes,'');
  console.log('CRM04_SITE_REPORT_REAL_PG_APPEND_REPLAY_STALE_AUTH_LOST_NO_AUTOSCHEDULE_PASS');

  const appointmentKey=randomUUID(),followUp=await create('schedule_save',{
   revision:0,startAt:'2026-11-09T11:00',endAt:'2026-11-09T11:30',
   itemType:'Связь с клиентом',title:'Связаться · CRM04 site report',
   notes:'CRM LEAD ID: '+source.id+'\nСледующий шаг: Prepare written estimate',
   requestKey:appointmentKey
  },cookie);
  assert.equal(followUp.status,'planned');
  assert.equal(followUp.schedule_date,'2026-11-09');
  const check=(await database.query('SELECT status,revision FROM public.mvp_leads WHERE id=$1',[source.id])).rows[0];
  assert.equal(check.status,'new');assert.equal(check.revision,stored.revision);
  const page=await request('/api/schedule?viewMode=week&anchorDate=2026-11-09',undefined,cookie);
  assert.equal(page.status,200);
  assert.equal(page.body.items.some(x=>x.id===followUp.id&&x.notes.includes('CRM LEAD ID: '+source.id)),true);
  console.log('CRM04_EXPLICIT_NEXT_CONTACT_SCHEDULE_REAL_PG_PASS');
 }

 // CRM-05A: manual internal Estimate, never accepted / Order / Finance.
 {
  const source=await create('lead_create',{title:'CRM05A real-world-priced proposal',contactName:'Synthetic client'},cookie);
  const before=(await database.query('SELECT (SELECT count(*)::int FROM public.mvp_clients) clients,(SELECT count(*)::int FROM public.mvp_orders) orders,(SELECT count(*)::int FROM public.mvp_leads) leads')).rows[0];
  assert.equal((await request('/api/estimates?leadId='+source.id)).status,401);
  const blank=await request('/api/estimates?leadId='+source.id,undefined,cookie);
  assert.equal(blank.status,200,blank.body.error);
  assert.equal(blank.body.estimate,null);
  assert.equal(blank.body.sourceLeadId,source.id);
  assert.equal((await request('/api/action',{type:'estimate_create',payload:{leadId:source.id,title:'Unauthorized',requestKey:randomUUID()}})).status,401);
  const createKey=randomUUID();
  const initial={leadId:source.id,title:'Монтаж отопления / внутренний черновик',notes:'Owner enters real prices',requestKey:createKey};
  const created=await request('/api/action',{type:'estimate_create',payload:initial},cookie);
  assert.equal(created.status,200,created.body.error);
  assert.equal(created.body.item.status,'draft');
  assert.equal(created.body.item.sourceLeadId,source.id);
  assert.equal(created.body.item.revision,1);
  assert.equal(created.body.totals.pricingComplete,false);
  assert.equal(created.body.totals.knownTotalAMD,'0.000');
  assert.equal((await request('/api/action',{type:'estimate_create',payload:initial},cookie)).body.deduplicated,true);
  assert.equal((await request('/api/action',{type:'estimate_create',payload:{...initial,title:'Different'}},cookie)).status,409);
  assert.equal((await request('/api/action',{type:'estimate_create',payload:{...initial,requestKey:randomUUID()}},cookie)).status,409);
  const estimateId=created.body.item.id;
  const w=randomUUID(),m=randomUUID(),u=randomUUID();
  const updateKey=randomUUID();
  const update={estimateId,revision:1,title:'Внутренняя смета после осмотра',
   notes:'Price coverage is incomplete',requestKey:updateKey,
   lines:[
    {lineKey:w,kind:'WORK',description:'Монтаж коллектора',quantity:'2.500',unit:'час',unitPriceAMD:'1000'},
    {lineKey:m,kind:'MATERIAL',description:'Труба PEX',quantity:'3',unit:'м',unitPriceAMD:'500'},
    {lineKey:u,kind:'MATERIAL',description:'Нужен уточнённый фитинг',quantity:'1.250',unit:'шт',unitPriceAMD:''}
   ]};
  const saved=await request('/api/action',{type:'estimate_save',payload:update},cookie);
  assert.equal(saved.status,200,saved.body.error);
  assert.equal(saved.body.item.revision,2);
  assert.equal(saved.body.lines.length,3);
  assert.equal(saved.body.totals.laborKnownAMD,'2500.000');
  assert.equal(saved.body.totals.materialsKnownAMD,'1500.000');
  assert.equal(saved.body.totals.knownTotalAMD,'4000.000');
  assert.equal(saved.body.totals.unpricedCount,1);
  assert.equal(saved.body.totals.pricingComplete,false);
  assert.equal(saved.body.lines[2].lineTotalAMD,null);
  assert.equal((await request('/api/action',{type:'estimate_save',payload:update},cookie)).body.deduplicated,true);
  assert.equal((await request('/api/action',{type:'estimate_save',payload:{...update,notes:'Changed body'}},cookie)).status,409);
  assert.equal((await request('/api/action',{type:'estimate_save',payload:{...update,requestKey:randomUUID()}},cookie)).status,409);
  const reload=await request('/api/estimates?leadId='+source.id,undefined,cookie);
  assert.equal(reload.status,200);
  assert.equal(reload.body.estimate.id,estimateId);
  assert.equal(reload.body.lines[2].priceSource,'UNPRICED');
  const priced={...update,revision:2,requestKey:randomUUID(),notes:'All lines have owner-entered AMD prices',
   lines:update.lines.map(x=>x.lineKey===u?{...x,unitPriceAMD:'800'}:x)};
  const final=await request('/api/action',{type:'estimate_save',payload:priced},cookie);
  assert.equal(final.status,200,final.body.error);
  assert.equal(final.body.item.revision,3);
  assert.equal(final.body.totals.materialsKnownAMD,'2500.000');
  assert.equal(final.body.totals.knownTotalAMD,'5000.000');
  assert.equal(final.body.totals.pricingComplete,true);
  const versioned=(await database.query('SELECT revision,snapshot FROM public.mvp_estimate_versions WHERE estimate_id=$1 ORDER BY revision',[estimateId])).rows;
  assert.deepEqual(versioned.map(x=>x.revision),[1,2,3]);
  assert.equal(versioned[1].snapshot.lines[2].unitPriceAMD,null);
  assert.equal(versioned[2].snapshot.lines[2].unitPriceAMD,'800');
  const history=(await database.query('SELECT estimate_revision,COUNT(*)::int n,COUNT(*) FILTER(WHERE archived_at IS NULL)::int active FROM public.mvp_estimate_lines WHERE estimate_id=$1 GROUP BY estimate_revision ORDER BY estimate_revision',[estimateId])).rows;
  assert.deepEqual(history.map(x=>[x.estimate_revision,x.n,x.active]),[[2,3,0],[3,3,3]]);
  assert.equal((await database.query("SELECT COUNT(*)::int FROM public.mvp_estimates WHERE source_lead_id=$1",[source.id])).rows[0].count,1);
  const after=(await database.query('SELECT (SELECT count(*)::int FROM public.mvp_clients) clients,(SELECT count(*)::int FROM public.mvp_orders) orders,(SELECT count(*)::int FROM public.mvp_leads) leads')).rows[0];
  assert.deepEqual(after,before);
  assert.equal((await database.query('SELECT status,revision FROM public.mvp_leads WHERE id=$1',[source.id])).rows[0].status,'new');
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_estimate_mutation_requests WHERE action=$1',['estimate_save'])).rows[0].n,2);
  console.log('CRM05A_REAL_PG_DRAFT_CREATE_EDIT_REVISIONS_EXACT_AMD_PARTIAL_PRICING_NO_ORDER_PASS');

  // Broken or malicious pricing must fail closed; no row changes.
  for(const [badQty,badPrice] of [['0','100'],['-1','100'],['1.0001','100'],['1','-100'],['1','Infinity'],['1','1.5']]){
   const bad=await request('/api/action',{type:'estimate_save',payload:{
    ...priced,revision:3,requestKey:randomUUID(),lines:[{...priced.lines[0],quantity:badQty,unitPriceAMD:badPrice}]}},cookie);
   assert.equal(bad.status,400,JSON.stringify([badQty,badPrice,bad.body]));
  }
  const duplicateKey=await request('/api/action',{type:'estimate_save',payload:{
   ...priced,revision:3,requestKey:randomUUID(),lines:[priced.lines[0],{...priced.lines[0],description:'Duplicate identity'}]}},cookie);
  assert.equal(duplicateKey.status,409);
  assert.equal((await database.query('SELECT revision FROM public.mvp_estimates WHERE id=$1',[estimateId])).rows[0].revision,3);
  // An injected version insertion failure must roll back archived rows and draft revision.
  await database.query("CREATE FUNCTION public.crm05a_fail_snapshot_ci() RETURNS trigger LANGUAGE plpgsql AS $ci$ BEGIN IF NEW.revision=4 THEN RAISE EXCEPTION 'CRM05A_SYNTHETIC_ABORT'; END IF; RETURN NEW; END $ci$");
  await database.query("CREATE TRIGGER zz_crm05a_fail_snapshot BEFORE INSERT ON public.mvp_estimate_versions FOR EACH ROW EXECUTE FUNCTION public.crm05a_fail_snapshot_ci()");
  const failedPayload={...priced,revision:3,requestKey:randomUUID(),title:'Changed draft after inspection'};
  const fail=await request('/api/action',{type:'estimate_save',payload:failedPayload},cookie);
  assert.equal(fail.status,500);
  assert.equal((await database.query('SELECT revision FROM public.mvp_estimates WHERE id=$1',[estimateId])).rows[0].revision,3);
  assert.equal((await database.query('SELECT COUNT(*)::int n FROM public.mvp_estimate_lines WHERE estimate_id=$1 AND archived_at IS NULL',[estimateId])).rows[0].n,3);
  assert.equal((await database.query('SELECT COUNT(*)::int n FROM public.mvp_estimate_mutation_requests WHERE request_key=$1',[failedPayload.requestKey])).rows[0].n,0);
  await database.query('DROP TRIGGER zz_crm05a_fail_snapshot ON public.mvp_estimate_versions');
  await database.query('DROP FUNCTION public.crm05a_fail_snapshot_ci()');
  const retry=await request('/api/action',{type:'estimate_save',payload:failedPayload},cookie);
  assert.equal(retry.status,200,retry.body.error);
  assert.equal(retry.body.item.revision,4);
  assert.equal(retry.body.totals.pricingComplete,true);
  console.log('CRM05A_INVALID_PRICE_STALE_DUPLICATE_AND_ATOMIC_ROLLBACK_RETRY_PASS');
 }

 
 // CRM-06A: independently durable Lead/Client contact history; existing lead is immutable.
 {
  const lead=await create('lead_create',{title:'CRM06 synthetic contact',contactName:'Synthetic contact'},cookie);
  const client=await create('client_create',{name:'CRM06 synthetic client'},cookie);
  const before=(await database.query('SELECT status,notes,revision FROM public.mvp_leads WHERE id=$1',[lead.id])).rows[0];
  assert.equal((await request('/api/crm/interactions?entityType=Lead&entityId='+lead.id)).status,401);
  const requestKey=randomUUID();
  const payload={entityType:'Lead',entityId:lead.id,interactionType:'call',contactOn:'2026-11-07',
   summary:'Customer asked to call back',nextAction:'Позвонить клиенту',nextActionOn:'2026-11-09',notes:'Safe CRM06 note',requestKey};
  assert.equal((await request('/api/action',{type:'crm_interaction_add',payload})).status,401);
  const first=await request('/api/action',{type:'crm_interaction_add',payload},cookie);
  assert.equal(first.status,200,first.body.error);
  assert.equal(first.body.saved,true);assert.equal(first.body.item.entityId,lead.id);
  assert.equal(first.body.item.nextActionOn,'2026-11-09');
  const repeated=await request('/api/action',{type:'crm_interaction_add',payload},cookie);
  assert.equal(repeated.status,200,repeated.body.error);
  assert.equal(repeated.body.deduplicated,true);assert.equal(repeated.body.item.id,first.body.item.id);
  assert.equal((await request('/api/action',{type:'crm_interaction_add',payload:{...payload,summary:'different'}},cookie)).status,409);
  const reopened=await request('/api/crm/interactions?entityType=Lead&entityId='+lead.id,undefined,cookie);
  assert.equal(reopened.status,200,reopened.body.error);assert.equal(reopened.body.items.length,1);
  assert.equal(reopened.body.items[0].summary,payload.summary);
  for(let i=0;i<4;i++)await create('crm_interaction_add',{entityType:'Lead',entityId:lead.id,contactOn:'2026-11-07',interactionType:'note',summary:'Contact '+i,nextAction:'',nextActionOn:''},cookie);
  const page1=await request('/api/crm/interactions?entityType=Lead&entityId='+lead.id+'&limit=2',undefined,cookie);
  assert.equal(page1.status,200,page1.body.error);assert.equal(page1.body.items.length,2);assert.equal(page1.body.hasMore,true);
  const page2=await request('/api/crm/interactions?entityType=Lead&entityId='+lead.id+'&limit=2&cursor='+encodeURIComponent(page1.body.nextCursor),undefined,cookie);
  assert.equal(page2.status,200,page2.body.error);assert.equal(page2.body.items.length,2);
  assert.equal(new Set([...page1.body.items,...page2.body.items].map(x=>x.id)).size,4);
  assert.equal((await request('/api/crm/interactions?entityType=Lead&entityId='+lead.id+'&cursor=invalid',undefined,cookie)).status,400);
  assert.equal((await request('/api/crm/interactions?entityType=Lead&entityId='+lead.id+'&limit=41',undefined,cookie)).status,400);
  const c=await create('crm_interaction_add',{entityType:'Client',entityId:client.id,interactionType:'message',contactOn:'2026-11-07',summary:'Client confirmed'},cookie);
  assert.equal(c.entityId,client.id);
  const clientPage=await request('/api/crm/interactions?entityType=Client&entityId='+client.id,undefined,cookie);
  assert.equal(clientPage.status,200,clientPage.body.error);assert.equal(clientPage.body.items.length,1);
  assert.equal((await request('/api/action',{type:'crm_interaction_add',payload:{...payload,requestKey:randomUUID(),entityType:'Object'}},cookie)).status,400);
  assert.equal((await request('/api/action',{type:'crm_interaction_add',payload:{...payload,requestKey:randomUUID(),entityId:randomUUID()}},cookie)).status,404);
  assert.equal((await request('/api/action',{type:'crm_interaction_add',payload:{...payload,requestKey:randomUUID(),contactOn:'2026-02-31'}},cookie)).status,400);
  assert.equal((await request('/api/action',{type:'crm_interaction_add',payload:{...payload,requestKey:randomUUID(),nextAction:''}},cookie)).status,400);
  const after=(await database.query('SELECT status,notes,revision FROM public.mvp_leads WHERE id=$1',[lead.id])).rows[0];
  assert.deepEqual(after,before,'Interaction must not modify existing Lead');
  assert.equal((await database.query('SELECT COUNT(*)::int n FROM public.mvp_crm_interactions WHERE lead_id=$1',[lead.id])).rows[0].n,5);
  const ownerBackup=await request('/api/export',undefined,cookie);
  assert.equal(ownerBackup.status,200,ownerBackup.body.error);
  assert.equal(ownerBackup.body.crmInteractions.some(x=>x.id===first.body.item.id),true);
  assert.equal(ownerBackup.body.crmInteractions.some(x=>x.id===c.id),true);
  assert.equal((await request('/api/export')).status,401);
  console.log('CRM06A_REAL_POSTGRES_LEAD_CLIENT_HISTORY_AUTH_RETRY_FK_CURSOR_PASS');
 }



 // CRM-19A: canonical Client history joins only explicitly linked Leads.
 // Synthetic fixtures in disposable PostgreSQL only; no TEST/PROD writes.
 {
  const client=await create('client_create',{name:'CRM19 synthetic client'},cookie);
  const otherClient=await create('client_create',{name:'CRM19 separate synthetic client'},cookie);
  const original=await create('lead_create',{title:'CRM19 converted lead',contactName:'Synthetic'},cookie);
  const repeat=await create('lead_create',{title:'CRM19 repeat intake',contactName:'Synthetic'},cookie);
  const outsider=await create('lead_create',{title:'CRM19 unrelated lead',contactName:'Synthetic'},cookie);
  await database.query(
   'INSERT INTO public.mvp_crm_lead_client_links(lead_id,client_id,request_key) VALUES($1,$2,$3)',
   [original.id,client.id,randomUUID()]);
  // Same Lead in both relations must not duplicate its interaction history.
  await database.query(
   'INSERT INTO public.mvp_crm_lead_intakes(lead_id,client_id,request_key,payload_sha256) VALUES($1,$2,$3,$4),($5,$2,$6,$7)',
   [original.id,client.id,randomUUID(),'a'.repeat(64),repeat.id,randomUUID(),'b'.repeat(64)]);
  const records=[];
  records.push(await create('crm_interaction_add',{entityType:'Lead',entityId:original.id,
   interactionType:'call',contactOn:'2026-11-07',summary:'CRM19 original Lead #1'},cookie));
  records.push(await create('crm_interaction_add',{entityType:'Lead',entityId:original.id,
   interactionType:'message',contactOn:'2026-11-07',summary:'CRM19 original Lead #2'},cookie));
  records.push(await create('crm_interaction_add',{entityType:'Lead',entityId:repeat.id,
   interactionType:'meeting',contactOn:'2026-11-07',summary:'CRM19 repeat intake'},cookie));
  records.push(await create('crm_interaction_add',{entityType:'Client',entityId:client.id,
   interactionType:'note',contactOn:'2026-11-07',summary:'CRM19 direct client'},cookie));
  await create('crm_interaction_add',{entityType:'Client',entityId:otherClient.id,
   interactionType:'note',contactOn:'2026-11-07',summary:'CRM19 unrelated client'},cookie);
  await create('crm_interaction_add',{entityType:'Lead',entityId:outsider.id,
   interactionType:'note',contactOn:'2026-11-07',summary:'CRM19 unrelated lead'},cookie);
  const path='/api/crm/interactions?entityType=Client&entityId='+client.id+'&unified=1';
  assert.equal((await request(path)).status,401,'Unified history is owner-only');
  assert.equal((await request(path+'&limit=41',undefined,cookie)).status,400);
  assert.equal((await request(path+'&cursor=invalid',undefined,cookie)).status,400);
  assert.equal((await request('/api/crm/interactions?entityType=Lead&entityId='+original.id+'&unified=1',undefined,cookie)).status,400);
  assert.equal((await request('/api/crm/interactions?entityType=Client&entityId='+randomUUID()+'&unified=1',undefined,cookie)).status,404);
  const merged=await request(path,undefined,cookie);
  assert.equal(merged.status,200,merged.body.error);
  assert.equal(merged.body.unified,true);
  assert.equal(merged.body.coverage,'CLEAN_LINKED_INTERACTIONS_ONLY');
  assert.equal(merged.body.historicalGoogleImported,false);
  assert.equal(merged.body.items.length,4,'one direct + two converted Lead + one repeat Lead');
  assert.deepEqual(new Set(merged.body.items.map(x=>x.id)),new Set(records.map(x=>x.id)));
  assert.equal(merged.body.items.filter(x=>x.historyStage==='converted_lead').length,2);
  assert.equal(merged.body.items.filter(x=>x.historyStage==='repeat_lead').length,1);
  assert.equal(merged.body.items.filter(x=>x.historyStage==='after_client').length,1);
  assert.ok(merged.body.items.filter(x=>x.historyStage==='converted_lead')
   .every(x=>x.leadTitle==='CRM19 converted lead'));
  assert.ok(merged.body.items.filter(x=>x.historyStage==='repeat_lead')
   .every(x=>x.leadTitle==='CRM19 repeat intake'));
  const direct=await request('/api/crm/interactions?entityType=Client&entityId='+client.id,undefined,cookie);
  assert.equal(direct.status,200);assert.equal(direct.body.items.length,1);
  assert.equal(direct.body.unified,undefined);
  const leadOnly=await request('/api/crm/interactions?entityType=Lead&entityId='+original.id,undefined,cookie);
  assert.equal(leadOnly.status,200);assert.equal(leadOnly.body.items.length,2);
  let cursor=null,all=[];
  for(let n=0;n<3;n++){
   const page=await request(path+'&limit=2'+(cursor?'&cursor='+encodeURIComponent(cursor):''),undefined,cookie);
   assert.equal(page.status,200,page.body.error);
   all=all.concat(page.body.items);
   if(!page.body.hasMore){assert.equal(page.body.nextCursor,null);break;}
   assert.equal(page.body.items.length,2);
   cursor=page.body.nextCursor;
  }
  assert.equal(all.length,4);
  assert.equal(new Set(all.map(x=>x.id)).size,4);
  assert.deepEqual(new Set(all.map(x=>x.id)),new Set(records.map(x=>x.id)));
  assert.deepEqual(all.map(x=>x.id),merged.body.items.map(x=>x.id),'stable cursor ordering');
  assert.ok(all.every((x,i)=>i===0||new Date(all[i-1].createdAt)>=new Date(x.createdAt)));
  console.log('CRM19A_REAL_POSTGRES_UNIFIED_CLIENT_HISTORY_EXACT_LINK_DEDUP_AUTH_PAGING_PASS');
 }

 // CRM-07A: read-only owner follow-up preview from latest CRM06 interaction.
 {
  assert.equal((await request('/api/crm/followups')).status,401);
  const attentionLead=await create('lead_create',{title:'CRM07 overdue synthetic Lead'},cookie);
  await create('crm_interaction_add',{entityType:'Lead',entityId:attentionLead.id,
   interactionType:'call',contactOn:'2026-10-30',summary:'Synthetic call',
   nextAction:'Позвонить повторно',nextActionOn:'2026-10-31'},cookie);
  const canonicalAttention=await create('crm_reminder_save',{leadId:attentionLead.id,revision:attentionLead.revision,
   nextAction:'Позвонить повторно',nextActionAt:'2026-10-31T09:00'},cookie);
  const beforeAttention=(await database.query('SELECT status,notes,revision FROM public.mvp_leads WHERE id=$1',[attentionLead.id])).rows[0];
  const beforeContacts=(await database.query('SELECT count(*)::int n FROM public.mvp_crm_interactions')).rows[0].n;
  const attention=await request('/api/crm/followups?limit=6',undefined,cookie);
  assert.equal(attention.status,200,attention.body.error);
  assert.equal(attention.body.version,'CRM07A_READ_ONLY');
  assert.equal(attention.body.coverage.complete,true);
  assert.equal(attention.body.source,'CANONICAL_LEAD_NEXT_ACTION');
  assert.ok(attention.body.buckets.overdue.items.some(x=>x.leadId===attentionLead.id));
  // CRM-09A is part of the same owner-authenticated, read-only one-query
  // response; urgency class first, then factual CRM10A score, never a prediction.
  assert.equal(attention.body.priority.version,'CRM11A_ATTENTION_SCORE_V1');
  assert.equal(attention.body.priority.source,'CANONICAL_CRM10A_SIGNALS_AND_CRM07_ATTENTION');
  assert.equal(attention.body.priority.coverage.complete,true);
  assert.equal(attention.body.priority.scoreCoverage.ready,0,'Unclassified real fixture has no score');
  assert.ok(attention.body.priority.items.every(x=>x.winScore?.score===null),'no default 10-point score');
  assert.ok(attention.body.priority.count>=1);
  assert.ok(attention.body.priority.items.some(x=>x.leadId===attentionLead.id));
  assert.equal(attention.body.priority.count,attention.body.attentionCount);
  assert.equal((await request('/api/crm/followups?limit=13',undefined,cookie)).status,400);
  assert.equal((await request('/api/crm/followups?limit=01',undefined,cookie)).status,400);
  const repeat=await request('/api/crm/followups?limit=6',undefined,cookie);
  assert.deepEqual(repeat.body,attention.body,'Repeated read must be deterministic');
  assert.deepEqual((await database.query('SELECT status,notes,revision FROM public.mvp_leads WHERE id=$1',[attentionLead.id])).rows[0],beforeAttention);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_interactions')).rows[0].n,beforeContacts);
  await create('lead_status',{id:attentionLead.id,revision:canonicalAttention.revision,status:'lost'},cookie);
  const removed=await request('/api/crm/followups',undefined,cookie);
  assert.equal(removed.status,200);
  assert.equal(Object.values(removed.body.buckets).flatMap(x=>x.items).some(x=>x.leadId===attentionLead.id),false);
  assert.equal(removed.body.priority.items.some(x=>x.leadId===attentionLead.id),false);
  console.log('CRM09A_OWNER_AUTH_ONE_READ_PRIORITY_CLASSES_NO_WRITES_PASS');
  console.log('CRM07A_OWNER_AUTH_READ_ONLY_ATTENTION_TERMINAL_EXCLUSION_POSTGRES_PASS');
 }


 // CRM-08A: canonical reminder is one atomic Lead+managed Calendar record.
 {
  assert.equal((await request('/api/action',{type:'crm_reminder_save',payload:{}})).status,401);
  const lead=await create('lead_create',{title:'CRM08 canonical next contact',contactName:'Synthetic'},cookie);
  const manualCount=(await database.query('SELECT count(*)::int n FROM public.mvp_schedule_items')).rows[0].n;
  const orderCount=(await database.query('SELECT count(*)::int n FROM public.mvp_schedule_order_items')).rows[0].n;
  const preContacts=(await database.query('SELECT count(*)::int n FROM public.mvp_crm_interactions')).rows[0].n;
  const key=randomUUID();
  const payload={leadId:lead.id,revision:lead.revision,nextAction:'Уточнить смету',
   nextActionAt:'2026-11-12T14:30',requestKey:key};
  const saved=await request('/api/action',{type:'crm_reminder_save',payload},cookie);
  assert.equal(saved.status,200,saved.body.error);
  assert.equal(saved.body.saved,true);
  assert.equal(saved.body.item.next_action,'Уточнить смету');
  assert.equal(new Date(saved.body.item.next_action_at).toISOString(),'2026-11-12T10:30:00.000Z');
  const id=saved.body.planId;
  const plan=(await database.query('SELECT id,auto_source_key,lead_id,status,schedule_date::text AS schedule_date FROM public.mvp_schedule_lead_items WHERE lead_id=$1',[lead.id])).rows[0];
  assert.equal(plan.id,id);assert.equal(plan.auto_source_key,'LEAD|'+lead.id);
  assert.equal(plan.schedule_date,'2026-11-12');assert.equal(plan.status,'planned');
  const replay=await request('/api/action',{type:'crm_reminder_save',payload},cookie);
  assert.equal(replay.status,200);assert.equal(replay.body.deduplicated,true);
  assert.equal(replay.body.planId,id);
  assert.equal((await request('/api/action',{type:'crm_reminder_save',payload:{...payload,nextAction:'Другая задача'}},cookie)).status,409);
  assert.equal((await request('/api/action',{type:'crm_reminder_save',payload:{...payload,requestKey:randomUUID(),nextActionAt:'2026-02-31T09:00'}},cookie)).status,400);
  assert.equal((await request('/api/action',{type:'crm_reminder_save',payload:{...payload,requestKey:randomUUID(),nextAction:'',nextActionAt:'2026-11-13T09:00'}},cookie)).status,400);
  assert.equal((await request('/api/action',{type:'crm_reminder_save',payload:{...payload,requestKey:randomUUID(),revision:lead.revision}},cookie)).status,409);
  const page=await request('/api/schedule?viewMode=week&anchorDate=2026-11-12',undefined,cookie);
  assert.equal(page.status,200,page.body.error);
  const crmItem=page.body.items.find(x=>x.id===id);
  assert.equal(crmItem.source_kind,'crm');assert.equal(crmItem.lead_id,lead.id);
  assert.match(crmItem.title,/Уточнить смету/,'Managed Calendar title reflects current next action');
  assert.equal(crmItem.item_type,'CRM');assert.equal(crmItem.worker_names,'');
  assert.match(page.body.source,/mvp_schedule_lead_items/);
  const currentRevision=saved.body.item.revision;
  const moved=await create('crm_reminder_save',{leadId:lead.id,revision:currentRevision,
   nextAction:'Позвонить уточнить',nextActionAt:'2026-11-13T11:00'},cookie);
  assert.equal(moved.next_action,'Позвонить уточнить');
  assert.equal((await database.query('SELECT id FROM public.mvp_schedule_lead_items WHERE lead_id=$1',[lead.id])).rows[0].id,id);
  const cleared=await create('crm_reminder_save',{leadId:lead.id,revision:moved.revision,nextAction:'',nextActionAt:''},cookie);
  assert.equal(cleared.next_action,'');assert.equal(cleared.next_action_at,null);
  const archived=(await database.query('SELECT id,status,archived_at FROM public.mvp_schedule_lead_items WHERE lead_id=$1',[lead.id])).rows[0];
  assert.equal(archived.id,id);assert.equal(archived.status,'archived');assert.ok(archived.archived_at);
  const reactivated=await create('crm_reminder_save',{leadId:lead.id,revision:cleared.revision,
   nextAction:'Повторить встречу',nextActionAt:'2026-11-15T12:00'},cookie);
  assert.equal((await database.query('SELECT id,status FROM public.mvp_schedule_lead_items WHERE lead_id=$1',[lead.id])).rows[0].id,id);
  const beforeLost=(await database.query('SELECT count(*)::int n FROM public.mvp_schedule_lead_items')).rows[0].n;
  const lost=await create('lead_status',{id:lead.id,revision:reactivated.revision,status:'lost'},cookie);
  assert.equal(lost.next_action,'');assert.equal(lost.next_action_at,null);
  assert.equal((await database.query('SELECT status FROM public.mvp_schedule_lead_items WHERE lead_id=$1',[lead.id])).rows[0].status,'archived');
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_schedule_lead_items')).rows[0].n,beforeLost);
  assert.equal((await request('/api/action',{type:'crm_reminder_save',payload:{leadId:lead.id,
   revision:lost.revision,nextAction:'Снова',nextActionAt:'2026-11-20T10:00',requestKey:randomUUID()}},cookie)).status,409);

  const conversionLead=await create('lead_create',{title:'CRM08 conversion closes reminder',contactName:'Test conversion'},cookie);
  const prior=await create('crm_reminder_save',{leadId:conversionLead.id,revision:conversionLead.revision,
   nextAction:'Встреча',nextActionAt:'2026-11-12T10:00'},cookie);
  const conv=await request('/api/action',{type:'lead_convert',payload:{
   leadId:conversionLead.id,revision:prior.revision,newClientName:'CRM08 new client',requestKey:randomUUID()}},cookie);
  assert.equal(conv.status,200,conv.body.error);
  assert.equal((await database.query('SELECT status,next_action,next_action_at FROM public.mvp_leads WHERE id=$1',[conversionLead.id])).rows[0].next_action,'');
  assert.equal((await database.query('SELECT status FROM public.mvp_schedule_lead_items WHERE lead_id=$1',[conversionLead.id])).rows[0].status,'archived');

  const failLead=await create('lead_create',{title:'CRM08 transaction rollback'},cookie);
  await database.query(`CREATE OR REPLACE FUNCTION public.crm08_ci_failure() RETURNS trigger LANGUAGE plpgsql AS $crm08$ BEGIN RAISE EXCEPTION 'CRM08_SYNTHETIC_ABORT'; END $crm08$`);
  await database.query("CREATE TRIGGER crm08_ci_abort BEFORE INSERT ON public.mvp_schedule_lead_items FOR EACH ROW EXECUTE FUNCTION public.crm08_ci_failure()");
  const badKey=randomUUID();
  const badPayload={leadId:failLead.id,revision:failLead.revision,nextAction:'Синтетический сбой',nextActionAt:'2026-11-15T10:00',requestKey:badKey};
  const failed=await request('/api/action',{type:'crm_reminder_save',payload:badPayload},cookie);
  assert.equal(failed.status,500);
  assert.equal((await database.query('SELECT next_action,next_action_at,revision FROM public.mvp_leads WHERE id=$1',[failLead.id])).rows[0].revision,failLead.revision);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_reminder_requests WHERE request_key=$1',[badKey])).rows[0].n,0);
  await database.query('DROP TRIGGER crm08_ci_abort ON public.mvp_schedule_lead_items');
  await database.query('DROP FUNCTION public.crm08_ci_failure()');
  const recovery=await request('/api/action',{type:'crm_reminder_save',payload:badPayload},cookie);
  assert.equal(recovery.status,200,recovery.body.error);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_schedule_lead_items WHERE lead_id=$1',[failLead.id])).rows[0].n,1);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_schedule_items')).rows[0].n,manualCount);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_schedule_order_items')).rows[0].n,orderCount);
  // One and only one agreement journal event is now part of successful conversion;
  // the failed CRM reminder and its retry must add no unrelated journal records.
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_interactions WHERE lead_id=$1 AND summary LIKE $2',[conversionLead.id,'Договорились%'])).rows[0].n,1);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_interactions')).rows[0].n,preContacts+1);
  const exportData=await request('/api/export',undefined,cookie);
  assert.equal(exportData.status,200,exportData.body.error);
  assert.ok(exportData.body.scheduleLeadItems.some(x=>x.id===id));
  console.log('CRM08A_CANONICAL_LEAD_NEXT_ACTION_MANAGED_CALENDAR_ATOMIC_REPLAY_ARCHIVE_ROLLBACK_PASS');
 }


 // CRM-10A: explicit current Lead facts and transparent accepted Win Score.
 {
  assert.equal((await request('/api/crm/lead-signals?leadId='+randomUUID())).status,401);
  assert.equal((await request('/api/action',{type:'crm_signal_save',payload:{}})).status,401);
  const lead=await create('lead_create',{title:'CRM10 score',contactName:'Synthetic'},cookie);
  const url='/api/crm/lead-signals?leadId='+lead.id;
  const before=await request(url,undefined,cookie);
  assert.equal(before.status,200,before.body.error);
  assert.equal(before.body.version,'CRM10A_LEAD_SIGNALS');
  assert.equal(before.body.signal.winScore.score,null);
  assert.equal(before.body.signal.winScore.coverage,'STAGE_REQUIRED');
  assert.equal((await request('/api/crm/lead-signals?leadId='+randomUUID(),undefined,cookie)).status,404);
  assert.equal((await request('/api/crm/lead-signals?leadId='+lead.id+'&leadId='+lead.id,undefined,cookie)).status,400);
  assert.equal((await request('/api/crm/lead-signals?leadId=not-a-uuid',undefined,cookie)).status,400);
  const originalContacts=(await database.query('SELECT count(*)::int n FROM public.mvp_crm_interactions')).rows[0].n;
  const originalPlans=(await database.query('SELECT count(*)::int n FROM public.mvp_schedule_lead_items')).rows[0].n;
  const requestKey=randomUUID();
  const payload={leadId:lead.id,revision:lead.revision,agreementStage:'negotiation',
   sourceChannel:'referral',needSummary:'Консультация по отоплению',requestKey};
  const saved=await request('/api/action',{type:'crm_signal_save',payload},cookie);
  assert.equal(saved.status,200,saved.body.error);
  assert.equal(saved.body.saved,true);
  assert.equal(saved.body.item.agreement_stage,'negotiation');
  assert.equal(saved.body.item.source_channel,'referral');
  assert.equal(saved.body.item.need_summary,'Консультация по отоплению');
  const signal=await request(url,undefined,cookie);
  assert.equal(signal.status,200,signal.body.error);
  assert.equal(signal.body.signal.winScore.score,70);
  assert.deepEqual(signal.body.signal.winScore.reasons.map(x=>x.points),[50,10,10,0,0,0]);
  assert.equal(signal.body.signal.winScore.band,'STRONG');
  assert.equal(signal.body.signal.winScore.calibratedProbability,false);
  const focusAfterScore=await request('/api/crm/followups?limit=12',undefined,cookie);
  assert.equal(focusAfterScore.status,200,focusAfterScore.body.error);
  assert.equal(focusAfterScore.body.priority.version,'CRM11A_ATTENTION_SCORE_V1');
  assert.equal(focusAfterScore.body.priority.source,'CANONICAL_CRM10A_SIGNALS_AND_CRM07_ATTENTION');
  assert.ok(focusAfterScore.body.priority.scoreCoverage.ready>=1);
  assert.ok(focusAfterScore.body.priority.items.some(x=>x.winScore.ready&&Number.isInteger(x.winScore.score)),
   'At least one real explicit-stage Lead appears with a numeric factual score');
  assert.equal((await request('/api/crm/followups?limit=12',undefined,cookie)).body.priority.scoreCoverage.ready,
   focusAfterScore.body.priority.scoreCoverage.ready);
  console.log('CRM11A_REAL_POSTGRES_OWNER_AUTH_SCORE_AWARE_PRIORITY_NO_EXTRA_WRITES_PASS');
  const replay=await request('/api/action',{type:'crm_signal_save',payload},cookie);
  assert.equal(replay.status,200);assert.equal(replay.body.deduplicated,true);
  assert.equal(replay.body.item.revision,saved.body.item.revision);
  for(const modified of [
   {...payload,needSummary:'Other'},
   {...payload,requestKey:randomUUID(),revision:lead.revision},
  ])assert.equal((await request('/api/action',{type:'crm_signal_save',payload:modified},cookie)).status,409);
  for(const modified of [
   {...payload,requestKey:randomUUID(),agreementStage:'qualified'},
   {...payload,requestKey:randomUUID(),sourceChannel:'unverified_source'},
   {...payload,requestKey:randomUUID(),needSummary:'z'.repeat(1001)}
  ])assert.equal((await request('/api/action',{type:'crm_signal_save',payload:modified},cookie)).status,400);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_signal_requests WHERE lead_id=$1',[lead.id])).rows[0].n,1);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_interactions')).rows[0].n,originalContacts);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_schedule_lead_items')).rows[0].n,originalPlans);
  await create('crm_interaction_add',{entityType:'Lead',entityId:lead.id,interactionType:'call',contactOn:'2026-11-05',summary:'Synthetic contact'},cookie);
  assert.equal((await request(url,undefined,cookie)).body.signal.winScore.score,75);
  const reminder=await create('crm_reminder_save',{leadId:lead.id,revision:saved.body.item.revision,nextAction:'Подготовить смету',nextActionAt:'2026-11-14T11:00'},cookie);
  const after=await request(url,undefined,cookie);
  assert.equal(after.body.signal.winScore.score,85);
  assert.deepEqual(after.body.signal.winScore.reasons.map(x=>x.points),[50,10,10,5,5,5]);

  const faultLead=await create('lead_create',{title:'CRM10 fault rollback'},cookie);
  await database.query("CREATE OR REPLACE FUNCTION public.crm10_ci_failure() RETURNS trigger LANGUAGE plpgsql AS $crm10$ BEGIN RAISE EXCEPTION 'CRM10_SYNTHETIC_ABORT'; END $crm10$");
  await database.query("CREATE TRIGGER crm10_ci_abort BEFORE UPDATE ON public.mvp_leads FOR EACH ROW WHEN (NEW.agreement_stage IS DISTINCT FROM OLD.agreement_stage) EXECUTE FUNCTION public.crm10_ci_failure()");
  const badKey=randomUUID();
  const failPayload={leadId:faultLead.id,revision:faultLead.revision,agreementStage:'approved',sourceChannel:'partner',needSummary:'Test',requestKey:badKey};
  assert.equal((await request('/api/action',{type:'crm_signal_save',payload:failPayload},cookie)).status,500);
  const untouched=(await database.query('SELECT revision,agreement_stage FROM public.mvp_leads WHERE id=$1',[faultLead.id])).rows[0];
  assert.equal(untouched.revision,faultLead.revision);assert.equal(untouched.agreement_stage,null);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_signal_requests WHERE request_key=$1',[badKey])).rows[0].n,0);
  await database.query('DROP TRIGGER crm10_ci_abort ON public.mvp_leads');
  await database.query('DROP FUNCTION public.crm10_ci_failure()');
  assert.equal((await request('/api/action',{type:'crm_signal_save',payload:failPayload},cookie)).status,200);
  const closed=await create('lead_status',{id:lead.id,revision:reminder.revision,status:'lost'},cookie);
  assert.equal(closed.status,'lost');
  assert.equal((await request(url,undefined,cookie)).body.signal.winScore.coverage,'TERMINAL_LEAD');
  assert.equal((await request('/api/action',{type:'crm_signal_save',payload:{
   leadId:lead.id,revision:closed.revision,agreementStage:'approved',
   sourceChannel:'referral',needSummary:'No',requestKey:randomUUID()}},cookie)).status,409);
  const exported=await request('/api/export',undefined,cookie);
  assert.equal(exported.status,200,exported.body.error);
  assert.ok(exported.body.leads.some(x=>x.id===lead.id&&x.agreement_stage==='negotiation'));
  assert.ok(exported.body.crmSignalRequests.some(x=>x.lead_id===lead.id));
  console.log('CRM10A_OWNER_AUTH_EXPLICIT_SCORE_PARITY_REPLAY_ROLLBACK_NO_PHANTOM_FACTS_REAL_POSTGRES_PASS');
 }


 // CRM-12A: truthful observation of current facts, no migration-time backfill.
 {
  const {crmScoreHistoryObserve}=await import('../crm-score-history.mjs');
  const trackedAction=async(type,payload)=>{
   const out=await request('/api/action',{type,payload:{...payload,requestKey:payload.requestKey||randomUUID()}},cookie);
   assert.equal(out.status,200,type+': '+out.body.error);
   assert.equal(out.body.saved,true,type+' did not confirm canonical write');
   return out.body;
  };
  const unknown=await create('lead_create',{title:'CRM12 unknown stage'},cookie);
  const url='/api/crm/lead-signals?leadId='+unknown.id;
  assert.equal((await request(url)).status,401);
  const before=await request(url,undefined,cookie);
  assert.equal(before.status,200,before.body.error);
  assert.equal(before.body.history.ready,true);
  assert.equal(before.body.history.status,'READY');
  assert.equal(before.body.history.hasHistory,false);
  assert.equal(before.body.history.items.length,0);
  assert.equal(before.body.signal.winScore.score,null);
  const ignored=await trackedAction('crm_reminder_save',{leadId:unknown.id,revision:unknown.revision,
   nextAction:'Позвонить',nextActionAt:'2026-11-14T10:00'},cookie);
  assert.equal(ignored.scoreHistoryObservation.status,'SKIPPED_UNKNOWN_STAGE');
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_lead_score_snapshots WHERE lead_id=$1',[unknown.id])).rows[0].n,0);

  const lead=await create('lead_create',{title:'CRM12 explicit score history'},cookie);
  const key=randomUUID();
  const p={leadId:lead.id,revision:lead.revision,agreementStage:'negotiation',
   sourceChannel:'referral',needSummary:'Системы отопления',requestKey:key};
  const first=await request('/api/action',{type:'crm_signal_save',payload:p},cookie);
  assert.equal(first.status,200,first.body.error);
  assert.equal(first.body.scoreHistoryObservation.status,'APPENDED');
  const currentUrl='/api/crm/lead-signals?leadId='+lead.id;
  const firstHistory=await request(currentUrl,undefined,cookie);
  assert.equal(firstHistory.body.history.items.length,1);
  assert.equal(firstHistory.body.history.items[0].score,70);
  assert.equal(firstHistory.body.history.items[0].lead_revision,undefined,'API should expose only bounded safe history fields');
  assert.equal((await database.query('SELECT lead_revision FROM public.mvp_lead_score_snapshots WHERE lead_id=$1',[lead.id])).rows[0].lead_revision,first.body.item.revision);
  assert.equal(firstHistory.body.history.items[0].previous_score,null);
  assert.equal(firstHistory.body.history.items[0].score_delta,null);
  assert.ok(firstHistory.body.history.trackingSince);
  assert.equal(firstHistory.body.history.outcomeReady,false);

  const replay=await request('/api/action',{type:'crm_signal_save',payload:p},cookie);
  assert.equal(replay.status,200);
  assert.equal(replay.body.deduplicated,true);
  assert.equal(replay.body.scoreHistoryObservation.status,'UNCHANGED');
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_lead_score_snapshots WHERE lead_id=$1',[lead.id])).rows[0].n,1);

  const next=await trackedAction('crm_signal_save',{...p,revision:first.body.item.revision,
   agreementStage:'approved',requestKey:randomUUID()},cookie);
  assert.equal(next.scoreHistoryObservation.status,'APPENDED');
  const back=await trackedAction('crm_signal_save',{...p,revision:next.item.revision,requestKey:randomUUID()},cookie);
  assert.equal(back.scoreHistoryObservation.status,'APPENDED','A→B→A is a legitimate new snapshot');
  const scores=(await database.query('SELECT score,score_delta FROM public.mvp_lead_score_snapshots WHERE lead_id=$1 ORDER BY snapshot_id',[lead.id])).rows;
  assert.deepEqual(scores.map(x=>x.score),[70,80,70]);
  assert.deepEqual(scores.map(x=>x.score_delta),[null,10,-10]);

  const call=await trackedAction('crm_interaction_add',{entityType:'Lead',entityId:lead.id,
   interactionType:'call',contactOn:'2026-11-08',summary:'Synthetic business contact'},cookie);
  assert.equal(call.scoreHistoryObservation.status,'APPENDED');
  const reminder=await trackedAction('crm_reminder_save',{leadId:lead.id,revision:back.item.revision,
   nextAction:'Смета',nextActionAt:'2026-11-14T11:00'},cookie);
  assert.equal(reminder.scoreHistoryObservation.status,'APPENDED');
  const live=await request(currentUrl,undefined,cookie);
  assert.equal(live.body.signal.winScore.score,85);
  assert.equal(live.body.history.items.length,5);
  assert.equal(live.body.history.latestScoreMovement.delta,10);
  assert.ok(live.body.history.items.every(x=>x.capture_source&&x.lead_status));
  assert.doesNotMatch(JSON.stringify(live.body.history),/Системы отопления|Synthetic business contact/,'history has no need text or contact notes');

  const closed=await trackedAction('lead_status',{id:lead.id,revision:reminder.item.revision,status:'lost'},cookie);
  assert.equal(closed.scoreHistoryObservation.status,'APPENDED');
  const final=await request(currentUrl,undefined,cookie);
  assert.equal(final.body.signal.winScore.score,null);
  assert.equal(final.body.history.outcomeReady,true);
  assert.equal(final.body.history.items[0].lead_status,'lost');
  assert.equal(final.body.history.items[0].score,null);
  assert.equal(final.body.history.items[0].previous_score,85);
  assert.equal(final.body.history.items[0].score_delta,null);

  // Sidecar failure may not unwind the successfully committed canonical Lead.
  const broken=await create('lead_create',{title:'CRM12 independent history fail'},cookie);
  await database.query("CREATE OR REPLACE FUNCTION public.crm12_ci_failure() RETURNS trigger LANGUAGE plpgsql AS $crm12$ BEGIN RAISE EXCEPTION 'CRM12_SYNTHETIC_ABORT'; END $crm12$");
  await database.query('CREATE TRIGGER crm12_ci_abort BEFORE INSERT ON public.mvp_lead_score_snapshots FOR EACH ROW EXECUTE FUNCTION public.crm12_ci_failure()');
  const badKey=randomUUID();
  const payload={leadId:broken.id,revision:broken.revision,agreementStage:'approved',
   sourceChannel:'partner',needSummary:'Test',requestKey:badKey};
  const successDespiteHistory=await request('/api/action',{type:'crm_signal_save',payload},cookie);
  assert.equal(successDespiteHistory.status,200,successDespiteHistory.body.error);
  assert.equal(successDespiteHistory.body.saved,true);
  assert.equal(successDespiteHistory.body.scoreHistoryObservation.status,'FAILED');
  assert.equal((await database.query('SELECT agreement_stage,revision FROM public.mvp_leads WHERE id=$1',[broken.id])).rows[0].agreement_stage,'approved');
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_lead_score_snapshots WHERE lead_id=$1',[broken.id])).rows[0].n,0);
  await database.query('DROP TRIGGER crm12_ci_abort ON public.mvp_lead_score_snapshots');
  await database.query('DROP FUNCTION public.crm12_ci_failure()');
  const repaired=await request('/api/action',{type:'crm_signal_save',payload},cookie);
  assert.equal(repaired.status,200,repaired.body.error);
  assert.equal(repaired.body.deduplicated,true);
  assert.equal(repaired.body.scoreHistoryObservation.status,'APPENDED');
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_lead_score_snapshots WHERE lead_id=$1',[broken.id])).rows[0].n,1);

  // Exact per-Lead lock: concurrent observers of a new signature cannot duplicate it.
  await database.query("UPDATE public.mvp_leads SET source_channel='referral' WHERE id=$1",[broken.id]);
  const cp=new pg.Pool({connectionString,ssl:false,max:3});
  try{
   const results=await Promise.all([
    crmScoreHistoryObserve({pool:cp,leadId:broken.id,captureSource:'crm_signal_save'}),
    crmScoreHistoryObserve({pool:cp,leadId:broken.id,captureSource:'crm_signal_save'})
   ]);
   assert.deepEqual(results.map(x=>x.status).sort(),['APPENDED','UNCHANGED']);
   assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_lead_score_snapshots WHERE lead_id=$1',[broken.id])).rows[0].n,2);
  }finally{await cp.end();}

  const exported=await request('/api/export',undefined,cookie);
  assert.equal(exported.status,200,exported.body.error);
  assert.ok(exported.body.crmScoreHistory.some(x=>x.lead_id===lead.id));
  assert.equal(exported.body.crmScoreHistoryMeta[0].schema_version,'CRM_SCORE_HISTORY_V1');
  console.log('CRM12A_OWNER_AUTH_HISTORY_DEDUP_REVERSION_DELTA_OUTCOME_NONBLOCKING_FAILURE_CONCURRENT_REAL_POSTGRES_PASS');
 }

 // CRM-16A: accepted Estimate -> exactly one canonical native Order; no Finance/Calendar writes.
 {
  const source=await create('lead_create',{title:'CRM16 isolated priced estimate',contactName:'Client for handoff'},cookie);
  const person=await create('client_create',{name:'CRM16 synthetic customer'},cookie);
  const place=await create('object_create',{clientId:person.id,name:'CRM16 synthetic object'},cookie);
  const converted=await request('/api/action',{type:'lead_convert',payload:{
   leadId:source.id,revision:source.revision,clientId:person.id,objectId:place.id,requestKey:randomUUID()
  }},cookie);
  assert.equal(converted.status,200,converted.body.error);
  const created=await create('estimate_create',{leadId:source.id,title:'Accepted heating estimate'},cookie);
  const id=created.id;
  const row={lineKey:randomUUID(),kind:'WORK',description:'Install heating',quantity:'2.500',unit:'meter',unitPriceAMD:'12000'};
  const saved=await request('/api/action',{type:'estimate_save',payload:{
   estimateId:id,revision:1,title:'Accepted heating estimate',notes:'Scope agreed',lines:[row],requestKey:randomUUID()
  }},cookie);
  assert.equal(saved.status,200,saved.body.error);
  const requestKey=randomUUID();
  const payload={estimateId:id,objectId:place.id,revision:2,confirm:'ACCEPT_AND_CREATE_OPEN_ORDER',requestKey};
  assert.equal((await request('/api/action',{type:'estimate_accept_handoff',payload})).status,401);
  const before=(await database.query('SELECT count(*)::int n FROM public.mvp_orders')).rows[0].n;
  await database.query("CREATE FUNCTION public.crm16_fault_ci() RETURNS trigger LANGUAGE plpgsql AS $ci$ BEGIN IF NEW.status='accepted' THEN RAISE EXCEPTION 'CRM16_SYNTHETIC_ABORT'; END IF; RETURN NEW; END $ci$");
  await database.query("CREATE TRIGGER zz_crm16_fault BEFORE UPDATE ON public.mvp_estimates FOR EACH ROW EXECUTE FUNCTION public.crm16_fault_ci()");
  assert.equal((await request('/api/action',{type:'estimate_accept_handoff',payload},cookie)).status,500);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_orders')).rows[0].n,before);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_estimate_handoff_requests WHERE request_key=$1',[requestKey])).rows[0].n,0);
  await database.query('DROP TRIGGER zz_crm16_fault ON public.mvp_estimates');
  await database.query('DROP FUNCTION public.crm16_fault_ci()');
  const accepted=await request('/api/action',{type:'estimate_accept_handoff',payload},cookie);
  assert.equal(accepted.status,200,accepted.body.error);
  assert.equal(accepted.body.acceptedTotalAMD,'30000.000');
  assert.equal(accepted.body.orderStatus,'open');
  assert.equal((await request('/api/action',{type:'estimate_accept_handoff',payload},cookie)).body.deduplicated,true);
  assert.equal((await request('/api/action',{type:'estimate_accept_handoff',payload:{...payload,objectId:randomUUID()}},cookie)).status,409);
  assert.equal((await request('/api/action',{type:'estimate_accept_handoff',payload:{...payload,requestKey:randomUUID()}},cookie)).status,409);
  const reopened=await request('/api/estimates?leadId='+source.id,undefined,cookie);
  assert.equal(reopened.status,200,reopened.body.error);
  assert.equal(reopened.body.estimate.status,'accepted');
  assert.equal(reopened.body.readonly,true);
  assert.equal(reopened.body.estimate.workOrderId,accepted.body.orderId);
  assert.equal((await request('/api/action',{type:'estimate_save',payload:{
   estimateId:id,revision:2,title:'Incorrect overwrite',notes:'',lines:[row],requestKey:randomUUID()
  }},cookie)).status,409);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_orders')).rows[0].n,before+1);
  const exact=(await database.query('SELECT object_id,lead_id,status,planned_on FROM public.mvp_orders WHERE id=$1',[accepted.body.orderId])).rows[0];
  assert.equal(exact.object_id,place.id);assert.equal(exact.lead_id,source.id);
  assert.equal(exact.status,'open');assert.equal(exact.planned_on,null);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_schedule_order_items WHERE order_id=$1',[accepted.body.orderId])).rows[0].n,0);
  console.log('CRM16A_REAL_POSTGRES_ACCEPT_HANDOFF_ONE_ORDER_IDEMPOTENT_ROLLBACK_NO_FINANCE_SCHEDULE_PASS');
 }
 // CRM-21A: the SAME canonical phone lock as Lead conversion protects all
 // direct Client writes. Synthetic temporary PostgreSQL only, never TEST.
 {
  const clientCount=async phone=>(await database.query(
   "SELECT count(*)::int n FROM public.mvp_clients WHERE status<>'archived' "+
   "AND public.mvp_crm_phone_canonical(phone)=$1",[phone])).rows[0].n;
  // Isolated phone fixture, independent of original CRM01/CRM15 customer ordering.
  const fixture=await create('client_create',{name:'CRM21 canonical fixture',phone:'+374 99 018765'},cookie);
  assert.ok(fixture.id);
  const oldCanonical='37499018765';
  const before=await clientCount(oldCanonical);
  const one=await request('/api/action',{type:'client_create',payload:{
   name:'Accidental duplicate',phone:'099018765',requestKey:randomUUID()}},cookie);
  assert.equal(one.status,409,'local Armenian 0 format must collide with +374');
  assert.match(one.body.error,/существует|дубликат/);
  const otherFormat=await request('/api/action',{type:'client_create',payload:{
   name:'International duplicate',phone:'00374 99 018765',requestKey:randomUUID()}},cookie);
  assert.equal(otherFormat.status,409,'00 international format must collide');
  assert.equal(await clientCount(oldCanonical),before,'duplicate requests never append clients');
  const staleTarget=await create('client_create',{name:'CRM21 different client',phone:'+374 55 987654'},cookie);
  const stolen=await request('/api/action',{type:'client_update',payload:{
   id:staleTarget.id,revision:staleTarget.revision,name:staleTarget.name,
   phone:'099018765',notes:'Must not overwrite'}},cookie);
  assert.equal(stolen.status,409,'direct Client edit must refuse somebody else phone');
  const readBack=(await database.query('SELECT phone,revision FROM public.mvp_clients WHERE id=$1',[staleTarget.id])).rows[0];
  assert.equal(readBack.phone,staleTarget.phone);
  assert.equal(readBack.revision,staleTarget.revision);
  const same=await create('client_update',{id:staleTarget.id,revision:staleTarget.revision,
   name:staleTarget.name,phone:'055987654',notes:'Self phone edit'},
   cookie);
  assert.equal(same.id,staleTarget.id,'same normalized number is own, not a duplicate');
  assert.equal(same.revision,staleTarget.revision+1);
  const replayKey=randomUUID();
  const replayFirst=await create('client_create',{name:'CRM21 once',phone:'094 258 111',requestKey:replayKey},cookie);
  const replaySecond=await create('client_create',{name:'CRM21 once',phone:'094 258 111',requestKey:replayKey},cookie);
  assert.equal(replayFirst.id,replaySecond.id,'request key retry must be idempotent');
  assert.equal(await clientCount('37494258111'),1);
  const archived=await create('client_create',{name:'CRM21 archived',phone:'094777777'},cookie);
  const archivedUpdated=await create('client_update',{id:archived.id,revision:archived.revision,
   name:archived.name,phone:archived.phone,status:'archived'},cookie);
  assert.equal(archivedUpdated.status,'archived');
  const replacement=await create('client_create',{name:'CRM21 active after archive',phone:'0037494777777'},cookie);
  assert.notEqual(replacement.id,archived.id,'archived Client excluded from duplicate search');
  assert.equal(await clientCount('37494777777'),1);
  const blankOne=await create('client_create',{name:'CRM21 no phone A',phone:''},cookie);
  const blankTwo=await create('client_create',{name:'CRM21 no phone B'},cookie);
  assert.notEqual(blankOne.id,blankTwo.id,'blank phones remain permitted');
  // Explicit synthetic duplicate from an old dirty dataset; no creation via app.
  const legacyDuplicateId=(await database.query(
   "INSERT INTO public.mvp_clients(request_key,name,phone) VALUES($1,'CRM21 dirty duplicate fixture','0037499018765') RETURNING id",
   [randomUUID()])).rows[0].id;
  const ambiguous=await request('/api/action',{type:'client_create',payload:{
   name:'CRM21 ambiguous',phone:'+374 99 018765',requestKey:randomUUID()}},cookie);
  assert.equal(ambiguous.status,409);
  assert.match(ambiguous.body.error,/Найдено 2 клиентов/);
  await database.query('DELETE FROM public.mvp_clients WHERE id=$1',[legacyDuplicateId]);
  // Two concurrent canonical writes cannot both create the same phone.
  const concurrentPhone='37494307070';
  const concurrent=await Promise.all([
   request('/api/action',{type:'client_create',payload:{
    name:'CRM21 concurrent A',phone:'094 307070',requestKey:randomUUID()}},cookie),
   request('/api/action',{type:'client_create',payload:{
    name:'CRM21 concurrent B',phone:'+374 94 307070',requestKey:randomUUID()}},cookie)
  ]);
  assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]);
  assert.equal(await clientCount(concurrentPhone),1);
  // Direct create and Lead conversion SHARE namespace 151106; one winner only.
  const racingLead=await create('lead_create',{title:'CRM21 conversion race',contactName:'CRM21 lead',
   phone:'+374 55 303030'},cookie);
  const race=await Promise.all([
   request('/api/action',{type:'client_create',payload:{
    name:'CRM21 direct rival',phone:'055303030',requestKey:randomUUID()}},cookie),
   request('/api/action',{type:'lead_convert',payload:{
    leadId:racingLead.id,revision:racingLead.revision,newClientName:'CRM21 converted rival',
    requestKey:randomUUID()}},cookie)
  ]);
  assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
  assert.equal(await clientCount('37455303030'),1);
  console.log('CRM21A_REAL_POSTGRES_DIRECT_DUPLICATE_REPLAY_ARCHIVE_REVISION_TWO_WRITER_AND_CONVERSION_RACE_PASS');
 }


 // CRM25A — external Masters directory, owner read/create/update and linked Lead transfer.
 // These are fictional, disposable CI-only records, never Google/Neon owner data.
 {
  assert.equal((await request('/api/crm/masters')).status,401);
  const createKey=randomUUID();
  const ownerMaster={name:'CRM25 Synthetic external master',phone:'000000001',email:'',
   serviceArea:'TEST area',notes:'Synthetic only',status:'active',qualityTier:'good',
   messengerType:'telegram',messengerContact:'@synthetic',requestKey:createKey};
  assert.equal((await request('/api/action',{type:'crm_master_create',payload:{...ownerMaster,name:' '}},cookie)).status,400);
  assert.equal((await request('/api/action',{type:'crm_master_create',payload:{...ownerMaster,qualityTier:'VIP'}},cookie)).status,400);
  const first=await request('/api/action',{type:'crm_master_create',payload:ownerMaster},cookie);
  assert.equal(first.status,200,first.body.error);
  const master=first.body.item;
  assert.equal(master.source_system,'CLEAN_NATIVE');
  assert.equal(master.source_master_id,null);
  assert.equal(master.revision,1);
  const replay=await request('/api/action',{type:'crm_master_create',payload:ownerMaster},cookie);
  assert.equal(replay.status,200,replay.body.error);
  assert.equal(replay.body.item.id,master.id);
  assert.equal(replay.body.deduplicated,true);
  assert.equal((await request('/api/action',{type:'crm_master_create',payload:{...ownerMaster,name:'mutated'}},cookie)).status,409);
  const listed=await request('/api/crm/masters?q=synthetic&status=active',undefined,cookie);
  assert.equal(listed.status,200,listed.body.error);
  assert.equal(listed.body.items.some(x=>x.id===master.id),true);
  assert.equal((await request('/api/crm/masters?status=won',undefined,cookie)).status,400);
  assert.equal((await request('/api/crm/masters?cursor=bad',undefined,cookie)).status,400);
  const badUpdate=await request('/api/action',{type:'crm_master_update',payload:{
   ...ownerMaster,masterId:master.id,revision:100,name:'Stale',requestKey:randomUUID()}},cookie);
  assert.equal(badUpdate.status,409);
  const updated=await request('/api/action',{type:'crm_master_update',payload:{
   ...ownerMaster,masterId:master.id,revision:1,name:'CRM25 Updated synthetic master',requestKey:randomUUID()}},cookie);
  assert.equal(updated.status,200,updated.body.error);
  assert.equal(updated.body.item.revision,2);
  await database.query(
   "INSERT INTO public.mvp_crm_masters(source_system,source_master_id,name,status,quality_tier,messenger_type) "+
   "VALUES('LEGACY_GOOGLE','SYNTHETIC-LEGACY-MASTER-0001','Imported synthetic master','active','normal','none')");
  const old=(await database.query("SELECT id FROM public.mvp_crm_masters WHERE source_master_id='SYNTHETIC-LEGACY-MASTER-0001'")).rows[0];
  assert.equal((await request('/api/action',{type:'crm_master_update',payload:{
   ...ownerMaster,masterId:old.id,revision:1,requestKey:randomUUID()}},cookie)).status,409);
  const lead=await create('lead_create',{title:'CRM25 linked external master',phone:'000000002'},cookie);
  const payload={leadId:lead.id,revision:lead.revision,masterId:master.id,
   reason:'no_time',comment:'from directory',confirm:'TRANSFER_LEAD',requestKey:randomUUID()};
  assert.equal((await request('/api/action',{type:'lead_transfer',payload})).status,401);
  const transfer=await request('/api/action',{type:'lead_transfer',payload},cookie);
  assert.equal(transfer.status,200,transfer.body.error);
  assert.equal(transfer.body.transfer.masterId,master.id);
  assert.equal(transfer.body.transfer.recipientName,'CRM25 Updated synthetic master');
  assert.equal(transfer.body.transfer.source,'CLEAN_NATIVE_MASTER_RECIPIENT');
  const ref=await database.query('SELECT master_id,recipient_name FROM public.mvp_crm_lead_transfers WHERE lead_id=$1',[lead.id]);
  assert.equal(ref.rows[0].master_id,master.id);
  assert.equal(ref.rows[0].recipient_name,'CRM25 Updated synthetic master');
  const replayTransfer=await request('/api/action',{type:'lead_transfer',payload},cookie);
  assert.equal(replayTransfer.status,200,replayTransfer.body.error);
  assert.equal(replayTransfer.body.deduplicated,true);
  const archived=await request('/api/action',{type:'crm_master_update',payload:{
   ...ownerMaster,masterId:master.id,revision:2,status:'archived',
   name:'CRM25 Archived master',requestKey:randomUUID()}},cookie);
  assert.equal(archived.status,200,archived.body.error);
  const archiveLead=await create('lead_create',{title:'CRM25 archived rejection'},cookie);
  assert.equal((await request('/api/action',{type:'lead_transfer',payload:{
   leadId:archiveLead.id,revision:archiveLead.revision,masterId:master.id,
   reason:'other',confirm:'TRANSFER_LEAD',requestKey:randomUUID()}},cookie)).status,409);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_lead_transfers WHERE lead_id=$1',
   [archiveLead.id])).rows[0].n,0);
  console.log('CRM25_MASTERS_REAL_PG_AUTH_CREATE_REPLAY_UPDATE_LEGACY_READONLY_TRANSFER_ARCHIVE_PASS');
 }

 // CRM26A — immutable old Google LeadTransfers archive. Fake source rows, disposable PostgreSQL only.
 {
  const {TRANSFER_HEADER,LEAD_EVIDENCE_HEADER,prepareLegacyTransfers,importPreparedLegacyTransfers}=
   await import('../crm-legacy-transfers-import.mjs');
  const iso='2026-11-08T12:34:56.000Z';
  const originalLead=id=>{
   const row=Array(LEAD_EVIDENCE_HEADER.length).fill('');
   row[0]='LEGACY-CI-LEAD-'+id;row[3]='transferred';row[15]='LEGACY-CI-TRANSFER-'+id;
   row[16]=iso;return row;
  };
  const transfers=[TRANSFER_HEADER,
   ['LEGACY-CI-TRANSFER-01',iso,iso,'active','LEGACY-CI-LEAD-01','Synthetic master A',
    'no_time',iso,'Synthetic no-time comment','REQ-CI-01','MASTER-CI-A'],
   ['LEGACY-CI-TRANSFER-02',iso,iso,'active','LEGACY-CI-LEAD-02','Synthetic master B',
    'different_specialist_needed',iso,'Synthetic referral','REQ-CI-02','MASTER-CI-B']];
  const leads=[LEAD_EVIDENCE_HEADER,originalLead('01'),originalLead('02')];
  const shaRows=r=>createHash('sha256').update(JSON.stringify(r)).digest('hex');
  const sourceHash=shaRows({transfers:transfers.slice(1),leadWitness:leads.slice(1).map(x=>[x[0],x[3],x[15]])});
  const receipt={sourceSpreadsheetId:'SYNTHETIC-CI-SHEET-ONLY',
   sourceSheet:'LeadTransfers',sourceModifiedAt:iso,
   batchId:'CRM26-SYNTHETIC-CI-01',expectedCount:2,expectedSourceSha256:sourceHash};
  const prepared=prepareLegacyTransfers({transfers,leads,receipt});
  const gate={explicitOwnerApproval:true,independentlyRestorableBackupId:'DISPOSABLE-CI-ONLY',
   approvedBatchId:receipt.batchId,approvedSourceSha256:sourceHash};
  const importerPool={async connect(){return {query:(sql,args)=>database.query(sql,args),release(){}};}};
  const nativeBefore=(await database.query('SELECT count(*)::int n FROM public.mvp_crm_lead_transfers')).rows[0].n;
  const leadsBefore=(await database.query('SELECT count(*)::int n FROM public.mvp_leads')).rows[0].n;
  assert.equal((await request('/api/crm/legacy-transfers')).status,401);
  assert.equal((await request('/api/crm/legacy-transfers',undefined,cookie)).body.items.length,0);
  const imported=await importPreparedLegacyTransfers({pool:importerPool,prepared,gate});
  assert.equal(imported.importedOrVerified,2);
  const again=await importPreparedLegacyTransfers({pool:importerPool,prepared,gate});
  assert.deepEqual(again,imported);
  assert.equal((await database.query('SELECT count(*)::int n FROM mvp_history.crm_legacy_lead_transfers')).rows[0].n,2);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_lead_transfers')).rows[0].n,nativeBefore);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_leads')).rows[0].n,leadsBefore);
  const first=await request('/api/crm/legacy-transfers?limit=1',undefined,cookie);
  assert.equal(first.status,200,first.body.error);
  assert.equal(first.body.linkedToClean,false);
  assert.equal(first.body.items.length,1);
  assert.equal(first.body.hasMore,true);
  assert.ok(first.body.nextCursor);
  const second=await request('/api/crm/legacy-transfers?limit=1&cursor='+encodeURIComponent(first.body.nextCursor),undefined,cookie);
  assert.equal(second.status,200,second.body.error);
  assert.equal(second.body.items.length,1);
  assert.notEqual(first.body.items[0].source_transfer_id,second.body.items[0].source_transfer_id);
  assert.equal((await request('/api/crm/legacy-transfers?q=LEGACY-CI-LEAD-01',undefined,cookie)).body.items.length,1);
  assert.equal((await request('/api/crm/legacy-transfers?q=unrelated&cursor='+encodeURIComponent(first.body.nextCursor),undefined,cookie)).status,400);
  assert.equal((await request('/api/crm/legacy-transfers?limit=1000',undefined,cookie)).status,400);
  // An altered old row with the same transfer ID must not overwrite the archive.
  const badTransfers=structuredClone(transfers);badTransfers[1][5]='CHANGED synthetic recipient';
  const changedHash=shaRows({transfers:badTransfers.slice(1),leadWitness:leads.slice(1).map(x=>[x[0],x[3],x[15]])});
  const conflicting=prepareLegacyTransfers({transfers:badTransfers,leads,receipt:{
   ...receipt,batchId:'CRM26-SYNTHETIC-CI-COLLISION',expectedSourceSha256:changedHash}});
  await assert.rejects(importPreparedLegacyTransfers({pool:importerPool,prepared:conflicting,
   gate:{...gate,approvedBatchId:'CRM26-SYNTHETIC-CI-COLLISION',approvedSourceSha256:changedHash}}),
    /CRM26_SOURCE_GATE:ROW_ID_COLLISION/);
  assert.equal((await database.query('SELECT count(*)::int n FROM mvp_history.crm_legacy_transfer_batches')).rows[0].n,1);
  assert.equal((await database.query('SELECT count(*)::int n FROM mvp_history.crm_legacy_lead_transfers')).rows[0].n,2);
  console.log('CRM26_DISPOSABLE_PG_IDEMPOTENT_PRIVATE_IMPORT_OWNER_AUTH_PAGINATION_COLLISION_PASS');
 }

 // CRM22A — old transferLeadService_ manual recipient path, isolated CI DB.
 // All mutation tests run against ephemeral PostgreSQL only.
 {
  const source=await create('lead_create',{title:'CRM22 manual recipient',contactName:'Fixture',phone:'094611000'},cookie);
  const requestKey=randomUUID();
  const payload={leadId:source.id,revision:source.revision,
   recipientName:'Внешний мастер тестовый',reason:'no_time',comment:'Передаю по просьбе клиента',
   confirm:'TRANSFER_LEAD',requestKey};
  assert.equal((await request('/api/action',{type:'lead_transfer',payload})).status,401);
  assert.equal((await request('/api/action',{type:'lead_transfer',payload:{...payload,confirm:''}},cookie)).status,400);
  assert.equal((await request('/api/action',{type:'lead_transfer',payload:{...payload,reason:'INVALID'}},cookie)).status,400);
  assert.equal((await request('/api/action',{type:'lead_transfer',payload:{...payload,recipientName:'',masterId:randomUUID()}},cookie)).status,404);
  const orderCount=(await database.query('SELECT count(*)::int n FROM public.mvp_orders')).rows[0].n;
  const clientCount=(await database.query('SELECT count(*)::int n FROM public.mvp_clients')).rows[0].n;
  await database.query("UPDATE public.mvp_leads SET next_action='Позвонить',next_action_at=now()+interval '1 day' WHERE id=$1",[source.id]);
  await database.query(
   "INSERT INTO public.mvp_schedule_lead_items(lead_id,auto_source_key,status,start_at,end_at,schedule_date,title,notes) "+
   "VALUES($1,$2,'planned',now()+interval '1 day',now()+interval '1 day 30 minutes',((now()+interval '1 day') AT TIME ZONE 'Asia/Yerevan')::date,'CRM22 TEST','isolated')",
   [source.id,'LEAD|'+source.id]);
  const beforePlan=(await database.query(
   "SELECT status FROM public.mvp_schedule_lead_items WHERE lead_id=$1",[source.id])).rows[0];
  assert.equal(beforePlan.status,'planned');
  const transferred=await request('/api/action',{type:'lead_transfer',payload},cookie);
  assert.equal(transferred.status,200,transferred.body.error);
  assert.equal(transferred.body.item.status,'transferred');
  assert.equal(transferred.body.item.revision,source.revision+1);
  assert.equal(transferred.body.item.next_action,'');
  assert.equal(transferred.body.item.next_action_at,null);
  assert.equal(transferred.body.transfer.reason,'no_time');
  assert.equal(transferred.body.transfer.recipientName,'Внешний мастер тестовый');
  assert.equal(transferred.body.transfer.source,'CLEAN_NATIVE_MANUAL_RECIPIENT');
  const row=(await database.query("SELECT * FROM public.mvp_crm_lead_transfers WHERE lead_id=$1",
   [source.id])).rows[0];
  assert.equal(row.status,'active');
  assert.equal(row.source_system,'CLEAN_NATIVE');
  assert.equal(row.request_key,requestKey);
  assert.equal(row.comment,'Передаю по просьбе клиента');
  const plan=(await database.query("SELECT status,archived_at FROM public.mvp_schedule_lead_items WHERE lead_id=$1",
   [source.id])).rows[0];
  assert.equal(plan.status,'archived');
  assert.ok(plan.archived_at);
  const again=await request('/api/action',{type:'lead_transfer',payload},cookie);
  assert.equal(again.status,200,again.body.error);
  assert.equal(again.body.deduplicated,true);
  assert.equal(again.body.transfer.id,transferred.body.transfer.id);
  assert.equal((await request('/api/action',{type:'lead_transfer',payload:{...payload,requestKey:randomUUID()}},cookie)).status,409);
  assert.equal((await request('/api/action',{type:'lead_transfer',payload:{...payload,recipientName:'Изменено'}},cookie)).status,409);
  const statusWrite=await request('/api/action',{type:'lead_status',payload:{
   id:source.id,revision:source.revision+1,status:'contacted'}},cookie);
  assert.equal(statusWrite.status,409);
  assert.equal((await request('/api/action',{type:'lead_update',payload:{
   id:source.id,revision:source.revision+1,title:'Not allowed',contactName:'TEST'}},cookie)).status,409);
  assert.equal((await request('/api/action',{type:'lead_convert',payload:{
   leadId:source.id,revision:source.revision+1,newClientName:'Not allowed',requestKey:randomUUID()}},cookie)).status,409);
  assert.equal((await request('/api/action',{type:'crm_reminder_save',payload:{
   leadId:source.id,revision:source.revision+1,nextAction:'New callback',nextActionAt:''}},cookie)).status,409);
  assert.equal((await request('/api/action',{type:'lead_visit_record',payload:{
   leadId:source.id,revision:source.revision+1,visitDate:'2026-11-08',
   observations:'Site',nextAction:'Call'}},cookie)).status,409);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_orders')).rows[0].n,orderCount);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_clients')).rows[0].n,clientCount);
  const state=await request('/api/state',undefined,cookie);
  assert.equal(state.status,200);
  assert.equal(state.body.leadTransfers.find(x=>x.lead_id===source.id)?.id,row.id);

  const second=await create('lead_create',{title:'CRM22 prohibited on won',contactName:'Fixture'},cookie);
  const won=await request('/api/action',{type:'lead_status',payload:{
   id:second.id,revision:second.revision,status:'lost'}},cookie);
  assert.equal(won.status,200);
  const lostTransfer=await request('/api/action',{type:'lead_transfer',payload:{
   leadId:second.id,revision:won.body.item.revision,recipientName:'Мастер другой',reason:'other',
   comment:'',confirm:'TRANSFER_LEAD',requestKey:randomUUID()}},cookie);
  assert.equal(lostTransfer.status,200,lostTransfer.body.error);
  assert.equal(lostTransfer.body.item.status,'transferred');

  // A failed Lead update must roll back the transfer receipt in the same transaction.
  const faultLead=await create('lead_create',{title:'CRM22 rollback source',contactName:'Fixture'},cookie);
  await database.query("CREATE FUNCTION public.crm22_fault_ci() RETURNS trigger LANGUAGE plpgsql AS $ci$ "+
   "BEGIN IF NEW.status='transferred' AND NEW.title LIKE 'CRM22 rollback%' THEN "+
   "RAISE EXCEPTION 'CRM22_SYNTHETIC_ABORT'; END IF; RETURN NEW; END $ci$");
  await database.query("CREATE TRIGGER zz_crm22_fault BEFORE UPDATE ON public.mvp_leads "+
   "FOR EACH ROW EXECUTE FUNCTION public.crm22_fault_ci()");
  const faultPayload={leadId:faultLead.id,revision:faultLead.revision,
   recipientName:'Отказ транзакции',reason:'other',confirm:'TRANSFER_LEAD',requestKey:randomUUID()};
  assert.equal((await request('/api/action',{type:'lead_transfer',payload:faultPayload},cookie)).status,500);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_lead_transfers WHERE lead_id=$1',
   [faultLead.id])).rows[0].n,0);
  assert.equal((await database.query('SELECT status FROM public.mvp_leads WHERE id=$1',[faultLead.id])).rows[0].status,'new');
  await database.query('DROP TRIGGER zz_crm22_fault ON public.mvp_leads');
  await database.query('DROP FUNCTION public.crm22_fault_ci()');
  assert.equal((await request('/api/action',{type:'lead_transfer',payload:faultPayload},cookie)).status,200);

  // Contention for one canonical Lead: exactly one transfer, no overwrite.
  const raceLead=await create('lead_create',{title:'CRM22 concurrent source',contactName:'Fixture'},cookie);
  const race=await Promise.all([
   request('/api/action',{type:'lead_transfer',payload:{leadId:raceLead.id,revision:raceLead.revision,
    recipientName:'Мастер А',reason:'too_far',confirm:'TRANSFER_LEAD',requestKey:randomUUID()}},cookie),
   request('/api/action',{type:'lead_transfer',payload:{leadId:raceLead.id,revision:raceLead.revision,
    recipientName:'Мастер Б',reason:'not_my_specialty',confirm:'TRANSFER_LEAD',requestKey:randomUUID()}},cookie)
  ]);
  assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_lead_transfers WHERE lead_id=$1',
   [raceLead.id])).rows[0].n,1);
  console.log('CRM22A_REAL_POSTGRES_MANUAL_RECIPIENT_TRANSFER_REASON_OWNER_AUTH_ONCE_REMINDER_ARCHIVE_REPLAY_ROLLBACK_RACE_PASS');
 }

 // MyWork V1 positive WorkerTask projection for the actual owner-local date.
 // Isolated synthetic order/worker, after legacy E2E counters, no shared data.
 {
  const orderNow=await create('order_create',{objectId:object.id,title:'MyWork V1 worker activity'},cookie);
  const workerNow=await create('worker_create',{name:'MyWork V1 worker',roleTitle:'Монтажник'},cookie);
  await create('worker_assign_order',{workerId:workerNow.id,orderId:orderNow.id},cookie);
  const priorLogs=(await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n;
  const workerDayNow=await create('worker_day_arrive',{workerId:workerNow.id,orderId:orderNow.id,
   date:now,arrivalAt:now+'T08:00'},cookie);
  const working=await create('worker_task_start',{workerDayId:workerDayNow.id,workerId:workerNow.id,
   orderId:orderNow.id,startAt:now+'T08:20'},cookie);
  const activeView=(await request('/api/my-work?orderId='+orderNow.id,undefined,cookie)).body;
  assert.equal(activeView.assignedWorkers.length,1);
  assert.equal(activeView.assignedWorkers[0].day_status,'open');
  assert.equal(activeView.assignedWorkers[0].active_count,1);
  assert.equal(activeView.assignedWorkers[0].completed_count,0);
  assert.equal(activeView.assignedWorkers[0].latest_task_status,'active');
  const completed=await create('worker_task_finish',{id:working.id,revision:working.revision,
   endAt:now+'T09:20',taskType:'Сборка труб',resultQty:'3.5',resultUnit:'м',
   managementMinutes:'0',outcome:'COMPLETED',problem:'no',rework:'no'},cookie);
  assert.equal(completed.status,'completed');
  const completedView=(await request('/api/my-work?orderId='+orderNow.id,undefined,cookie)).body;
  const summary=completedView.assignedWorkers[0];
  assert.equal(summary.worker_id,workerNow.id);
  assert.equal(summary.day_status,'open');
  assert.equal(summary.active_count,0);
  assert.equal(summary.completed_count,1);
  assert.equal(summary.completed_minutes,60);
  assert.equal(summary.latest_task_type,'Сборка труб');
  assert.equal(summary.latest_result_qty,'3.500');
  assert.equal(summary.latest_result_unit,'м');
  assert.equal(summary.latest_outcome,'COMPLETED');
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_logs')).rows[0].n,priorLogs);
  await create('worker_day_depart',{id:workerDayNow.id,revision:workerDayNow.revision,
   departureAt:now+'T10:00',closeReasonCode:'work_done_early'},cookie);
  const departedView=(await request('/api/my-work?orderId='+orderNow.id,undefined,cookie)).body;
  assert.equal(departedView.assignedWorkers[0].day_status,'closed');
  assert.equal(departedView.assignedWorkers[0].completed_count,1);
  console.log('MYWORK_V1_TODAY_WORKER_ATTENDANCE_LATEST_TASK_QUANTITY_READBACK_NO_PAYROLL_INFERENCE_PASS');
 }


 // CRM-23A: all archive content below is synthetic and in disposable CI DB.
 // Owner TEST is never seeded and the genuine 30 old Google rows remain private.
 {
  const crm23Sql=readFileSync(new URL('../migrations/0027_crm23a_legacy_interactions_CANDIDATE.sql',import.meta.url),'utf8');
  await database.query(crm23Sql);await database.query(crm23Sql);
  const publicRoute='/api/crm/legacy-interactions?clientId=';
  const existingMaps=(await database.query(
   "SELECT source_id,target_id FROM public.mvp_legacy_import_map "+
   "WHERE source_entity='Clients' AND source_system='Working IP APP / M8C cutover baseline' ORDER BY source_id")).rows;
  assert.equal(existingMaps.length,2,'CRM20 created exactly two synthetic Client source maps');
  const clients=[...existingMaps];
  for(let i=2;i<17;i++){
   const nativeClient=await create('client_create',{name:'CRM23 synthetic imported client '+i},cookie);
   const oldId='CRM23-CLIENT-'+String(i).padStart(2,'0');
   await database.query(
    "INSERT INTO public.mvp_legacy_import_map(source_system,source_entity,source_id,target_id,source_payload) "+
    "VALUES('Working IP APP / M8C cutover baseline','Clients',$1,$2,'{}'::jsonb)",
    [oldId,nativeClient.id]);
   clients.push({source_id:oldId,target_id:nativeClient.id});
  }
  const sourceLeads=Array.from({length:33},(_,i)=>'CRM23-OLD-LEAD-'+String(i).padStart(2,'0'));
  const historyBatch=(await database.query(
   "SELECT batch_id FROM mvp_history.import_batches WHERE expected_counts->>'LEAD'='33' LIMIT 2")).rows;
  assert.equal(historyBatch.length,1);
  const batchId=historyBatch[0].batch_id;
  for(const sourceId of sourceLeads){
   await database.query(
    "INSERT INTO mvp_history.source_records(source_kind,source_id,source_system,import_batch_id,client_source_id,original_status,source_payload) "+
    "VALUES('LEAD',$1,'LEGACY_GOOGLE',$2,NULL,'active','{}'::jsonb)",[sourceId,batchId]);
  }
  // Exact frozen source Client witness for CRM23 private-import preflight in CI.
  for(const original of clients){
   await database.query(
    "INSERT INTO mvp_history.source_records(source_kind,source_id,source_system,import_batch_id,client_source_id,original_status,source_payload) "+
    "VALUES('CLIENT',$1,'LEGACY_GOOGLE',$2,NULL,'active','{}'::jsonb)",
    [original.source_id,batchId]);
  }
  await database.query(
   "UPDATE public.mvp_legacy_import_map SET source_payload=jsonb_set(source_payload,'{sourceLeadId}',to_jsonb($1::text),true) "+
   "WHERE source_entity='Clients' AND source_id=$2",
   [sourceLeads[0],clients[0].source_id]);
  const id0=clients[0].target_id;
  const notImported=await request(publicRoute+id0,undefined,cookie);
  assert.equal(notImported.status,200,notImported.body.error);
  assert.equal(notImported.body.status,'NOT_IMPORTED');
  assert.equal(notImported.body.archiveActivities,null);
  assert.equal((await request(publicRoute+id0)).status,401);
  assert.equal((await request(publicRoute+randomUUID(),undefined,cookie)).status,404);
  const receiptId='CRM23_SYNTHETIC_RECEIPT_ONLY';
  await database.query(
   "INSERT INTO mvp_history.crm_legacy_interaction_receipts(receipt_id,history_batch_id,source_spreadsheet_id,"+
   "snapshot_sha256,count_all,count_activity,count_relation_final,count_relation_pending) "+
   "VALUES($1,$2,'CI_ONLY_FAKE_SHEET',$3,30,15,5,10)",[receiptId,batchId,'c'.repeat(64)]);
  for(let i=0;i<30;i++){
   const kind=i<15?'ACTIVITY':i<20?'RELATION_FINAL':'RELATION_PENDING';
   const entityId=i<2?sourceLeads[0]:i<4?sourceLeads[1]:
    i<15?sourceLeads[i+1]:i<20?(i===19?sourceLeads[31]:sourceLeads[i-14]):sourceLeads[i-15];
   const targetClientId=kind==='RELATION_FINAL'?clients[i-15].source_id:
    kind==='RELATION_PENDING'?clients[i-15].source_id:null;
   const req=kind==='ACTIVITY'?'CRM23-CI-'+i:
    'REL|'+(kind==='RELATION_FINAL'?'LeadClient':'LeadClientPending')+
    '|'+entityId+'|'+targetClientId;
   await database.query(
    "INSERT INTO mvp_history.crm_legacy_interactions(source_id,receipt_id,entity_type,entity_id,record_kind,"+
    "interaction_type,created_at,updated_at,original_status,summary,next_action,next_action_at,notes,"+
    "client_request_id,row_sha256) VALUES($1,$2,'Lead',$3,$4,$5,$6,$6,'active',$7,'','','',$8,$9)",
    ['INT-CRM23-CI-'+i,receiptId,entityId,kind,kind==='ACTIVITY'?'call':'note',
     new Date(Date.UTC(2026,9,7,10,0,i)),kind==='ACTIVITY'?'CRM23 synthetic phone call '+i:'RELATION_CARRIER',
     req,'a'.repeat(64)]);
  }
  const linked=await request(publicRoute+id0,undefined,cookie);
  assert.equal(linked.status,200,linked.body.error);
  assert.equal(linked.body.readonly,true);
  assert.equal(linked.body.status,'VERIFIED_READONLY');
  assert.equal(linked.body.archiveActivities,15);
  assert.equal(linked.body.unlinkedActivities,11);
  assert.equal(linked.body.items.length,4);
  assert.equal(linked.body.items.filter(x=>x.historyStage==='before_client').length,2);
  assert.equal(linked.body.items.filter(x=>x.historyStage==='repeat_lead').length,2);
  assert.ok(linked.body.items.every(x=>x.readonly&&x.source==='LEGACY_GOOGLE'&&
   x.summary.startsWith('CRM23 synthetic phone call')));
  const outside=await request(publicRoute+clients[14].target_id,undefined,cookie);
  assert.equal(outside.status,200);
  assert.equal(outside.body.status,'VERIFIED_READONLY');
  assert.equal(outside.body.items.length,0,'pending-only relationship never assigns a Client');
  const nativeHistory=await request('/api/crm/interactions?entityType=Client&entityId='+id0+'&unified=1',undefined,cookie);
  assert.equal(nativeHistory.status,200);
  // Legacy Google archive must remain separate from native PostgreSQL CRM19.
  // This Client already has exactly one legitimate native Lead agreement note.
  assert.equal(nativeHistory.body.items.length,1,'existing native agreement remains visible; archived Google contacts stay separate');
  assert.match(nativeHistory.body.items[0].summary,/^Договорились по обращению:/);
  assert.equal(nativeHistory.body.items.some(x=>x.summary.startsWith('CRM23 synthetic phone call')),false);
  const beforeNative=(await database.query('SELECT count(*)::int n FROM public.mvp_crm_interactions')).rows[0].n;
  const orphanCount=(await database.query(
   "SELECT count(*)::int n FROM mvp_history.crm_legacy_interactions WHERE record_kind='ACTIVITY'")).rows[0].n;
  assert.equal(orphanCount,15);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_interactions')).rows[0].n,beforeNative);
  // Unexpected extra source rows disable verified display instead of partial results.
  await database.query(
   "DELETE FROM mvp_history.crm_legacy_interactions WHERE source_id='INT-CRM23-CI-29'");
  const broken=await request(publicRoute+id0,undefined,cookie);
  assert.equal(broken.status,503,'partial historic archive must fail closed');
  console.log('CRM23A_REAL_POSTGRES_30_15_5_10_VERIFIED_CLIENT_4_UNLINKED_11_PENDING_IGNORED_OWNER_ONLY_PASS');
 }

 // CRM23+CRM25 source-safe importer transaction on disposable PostgreSQL ONLY.
 // All rows below are invented fixtures, NEVER fetched from owner's Google/Neon.
 {
  const {INTERACTIONS_HEADER,prepareLegacyInteractions,importPreparedLegacyInteractions}=
   await import('../crm-legacy-interactions-import.mjs');
  const {MASTERS_HEADER,prepareLegacyMasters,importPreparedLegacyMasters}=
   await import('../crm-legacy-masters-import.mjs');
  const when='2026-11-08T10:59:32.797Z';
  const batch=(await database.query("SELECT batch_id FROM mvp_history.import_batches WHERE expected_counts->>'LEAD'='33'")).rows;
  assert.equal(batch.length,1);
  const batchId=batch[0].batch_id;
  const frozenLeads=(await database.query(
   "SELECT source_id FROM mvp_history.source_records WHERE source_kind='LEAD' AND import_batch_id=$1 ORDER BY source_id",
   [batchId])).rows.map(x=>x.source_id);
  const frozenClients=(await database.query(
   "SELECT source_id FROM mvp_history.source_records WHERE source_kind='CLIENT' AND import_batch_id=$1 ORDER BY source_id",
   [batchId])).rows.map(x=>x.source_id);
  assert.equal(frozenLeads.length,33);
  assert.equal(frozenClients.length,17);
  const leadHeader=['leadId','createdAt','updatedAt','status','name','phone','source','needSummary',
   'agreementStage','nextAction','nextActionAt','notes','clientRequestId','sourceChannel','sourceDetail',
   'lastTransferId','lastTransferredAt','lastTransferRecipient','lastTransferReason'];
  const clientHeader=['clientId','createdAt','updatedAt','status','name','phone','email','address',
   'notes','sourceLeadId','clientRequestId','clientTier','referralStatus','clientLabelNote'];
  // Current Google 32 Leads vs frozen 33 intentionally; the missing Lead is unreferenced.
  const leads=[leadHeader,...frozenLeads.slice(0,32).map(id=>[id,when,when,'transferred'])];
  const clients=[clientHeader,...frozenClients.map(id=>[id,when,when,'active'])];
  const interactions=[INTERACTIONS_HEADER];
  for(let i=0;i<30;i++){
   const kind=i<15?'ACTIVITY':i<20?'RELATION_FINAL':'RELATION_PENDING';
   const lead=i<2?frozenLeads[0]:i<4?frozenLeads[1]:
    kind==='ACTIVITY'?frozenLeads[i+1]:frozenLeads[i%32];
   const client=frozenClients[i%17];
   const request=kind==='ACTIVITY'?'CRM23-PRIVATE-CI-'+i:
    'REL|'+(kind==='RELATION_FINAL'?'LeadClient':'LeadClientPending')+'|'+lead+'|'+client;
   interactions.push(['CRM23-PRIVATE-CI-'+i,when,when,'active','Lead',lead,
    kind==='ACTIVITY'?'call':'note',
    kind==='ACTIVITY'?'Synthetic private history '+i:'Synthetic relationship',
    '','','',request]);
  }
  const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
  const frozen=(arr)=>[...arr].sort();
  const expectedSourceSha256=digest({interactions:interactions.slice(1),
   leadWitness:leads.slice(1).map(x=>[x[0],x[3]]),
   clientWitness:clients.slice(1).map(x=>[x[0],x[9]||'']),
   frozenLeads:frozen(frozenLeads),frozenClients:frozen(frozenClients)});
  const receipt23={sourceSheet:'Interactions',sourceSpreadsheetId:'CI-ONLY-NO-REAL-SHEET',
   sourceModifiedAt:when,batchId:'CRM23-PRIVATE-CI-01',historyBatchId:batchId,
   expectedCount:30,expectedSourceSha256};
  const prepared23=prepareLegacyInteractions({
   interactions,leads,clients,frozenLeads,frozenClients,receipt:receipt23});
  const gate23={explicitOwnerApproval:true,independentlyRestorableBackupId:'FAKE-LOCAL-PG',
   approvedBatchId:receipt23.batchId,approvedHistoryBatchId:batchId,
   approvedSourceSha256:expectedSourceSha256,approvedSourceModifiedAt:when};
  const disposablePool={async connect(){return {query:(sql,args)=>database.query(sql,args),release(){}};}};
  const nativeBefore=(await database.query('SELECT count(*)::int n FROM public.mvp_crm_interactions')).rows[0].n;
  const leadsBefore=(await database.query('SELECT count(*)::int n FROM public.mvp_leads')).rows[0].n;
  const first23=await importPreparedLegacyInteractions({pool:disposablePool,prepared:prepared23,gate:gate23});
  assert.equal(first23.verifiedRows,30);
  assert.deepEqual(await importPreparedLegacyInteractions({pool:disposablePool,prepared:prepared23,gate:gate23}),first23);
  const count23=(await database.query('SELECT count(*)::int n FROM mvp_history.crm_legacy_interactions WHERE receipt_id=$1',
   [first23.receiptId])).rows[0].n;
  assert.equal(count23,30);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_crm_interactions')).rows[0].n,nativeBefore);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_leads')).rows[0].n,leadsBefore);
  const changed23=structuredClone(interactions);
  changed23[1][7]='Changed synthetic history';
  const changedDigest=digest({interactions:changed23.slice(1),
   leadWitness:leads.slice(1).map(x=>[x[0],x[3]]),
   clientWitness:clients.slice(1).map(x=>[x[0],x[9]||'']),
   frozenLeads:frozen(frozenLeads),frozenClients:frozen(frozenClients)});
  const collided23=prepareLegacyInteractions({interactions:changed23,leads,clients,
   frozenLeads,frozenClients,receipt:{...receipt23,batchId:'CRM23-PRIVATE-CI-COLLISION',
    sourceSpreadsheetId:'CI-SYNTHETIC-SECOND-SHEET',expectedSourceSha256:changedDigest}});
  await assert.rejects(importPreparedLegacyInteractions({pool:disposablePool,
   prepared:collided23,gate:{...gate23,approvedBatchId:'CRM23-PRIVATE-CI-COLLISION',
    approvedSourceSha256:changedDigest}}),/CRM23_IMPORT_GATE:INTERACTION_SOURCE_ID_COLLISION/);
  const masters=[MASTERS_HEADER];
  for(let i=0;i<5;i++)masters.push(['CRM25-PRIVATE-CI-'+i,when,when,'active',
   'Fictional master '+i,'000000'+i,'','CI region','','','normal','none','']);
  const masterSha=digest({masters:masters.slice(1),sourceSheet:'Masters'});
  const masterReceipt={sourceSheet:'Masters',sourceSpreadsheetId:'CI-ONLY-NO-REAL-SHEET',
   sourceModifiedAt:when,batchId:'CRM25-PRIVATE-CI-01',expectedCount:5,expectedSourceSha256:masterSha};
  const prepared25=prepareLegacyMasters({masters,receipt:masterReceipt});
  const gate25={explicitOwnerApproval:true,independentlyRestorableBackupId:'FAKE-LOCAL-PG',
   approvedBatchId:masterReceipt.batchId,approvedSourceSha256:masterSha,approvedSourceModifiedAt:when};
  const first25=await importPreparedLegacyMasters({pool:disposablePool,prepared:prepared25,gate:gate25});
  assert.equal(first25.verifiedRows,5);
  assert.deepEqual(await importPreparedLegacyMasters({pool:disposablePool,prepared:prepared25,gate:gate25}),first25);
  const saved25=(await database.query("SELECT id,source_system,source_master_id,source_created_at,source_updated_at,legacy_receipt_id "+
   "FROM public.mvp_crm_masters WHERE legacy_receipt_id=$1 ORDER BY source_master_id",[first25.receiptId])).rows;
  assert.equal(saved25.length,5);
  assert.equal(new Set(saved25.map(x=>x.id)).size,5);
  assert.ok(saved25.every(x=>x.source_system==='LEGACY_GOOGLE'&&
   x.source_created_at===when&&x.source_updated_at===when&&x.legacy_receipt_id===first25.receiptId));
  const changed25=structuredClone(masters);changed25[1][4]='Different fictional master';
  const changedMasterSha=digest({masters:changed25.slice(1),sourceSheet:'Masters'});
  const collide25=prepareLegacyMasters({masters:changed25,receipt:{
   ...masterReceipt,batchId:'CRM25-PRIVATE-CI-COLLISION',
   sourceSpreadsheetId:'CI-SYNTHETIC-SECOND-SHEET',expectedSourceSha256:changedMasterSha}});
  await assert.rejects(importPreparedLegacyMasters({pool:disposablePool,
   prepared:collide25,gate:{...gate25,approvedBatchId:'CRM25-PRIVATE-CI-COLLISION',
    approvedSourceSha256:changedMasterSha}}),/CRM25_IMPORT_GATE:MASTER_SOURCE_ID_COLLISION/);
  assert.equal((await database.query('SELECT count(*)::int n FROM mvp_history.crm_legacy_master_receipts')).rows[0].n,1);
  assert.equal((await database.query(
   "SELECT count(*)::int n FROM public.mvp_crm_masters WHERE source_system='LEGACY_GOOGLE' AND legacy_receipt_id=$1",
   [first25.receiptId])).rows[0].n,5);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_leads')).rows[0].n,leadsBefore);
  console.log('CRM23_25_PRIVATE_SOURCE_DISPOSABLE_PG_IMPORT_IDEMPOTENCE_COLLISION_ROLLBACK_AND_NO_NATIVE_MUTATION_PASS');
 }

 // Cross-boundary witness: source Schedule list is start-date scoped, but
 // Hourly must include a planned item that started before the viewed week.
 const overnight=await create('schedule_save',{revision:0,
   startAt:'2026-11-01T18:30',endAt:'2026-11-02T09:00',
   itemType:'Личное',title:'CI hourly boundary witness',notes:'synthetic only'},cookie);
 assert.equal(overnight.status,'planned');
 const viewWeek=await request('/api/schedule?viewMode=week&anchorDate=2026-11-03',undefined,cookie);
 assert.equal(viewWeek.status,200);
 assert.ok(!viewWeek.body.items.some(x=>x.title==='CI hourly boundary witness'));
 const hourWeek=await request('/api/schedule/hourly?viewMode=week&anchorDate=2026-11-03',undefined,cookie);
 assert.equal(hourWeek.status,200,hourWeek.body.error);
 assert.ok(hourWeek.body.items.some(x=>x.title==='CI hourly boundary witness'&&x.source_kind==='manual'));
 assert.equal(hourWeek.body.complete,true);
 const nextWindow=await request('/api/schedule/hourly/search?startDate=2026-11-01',undefined,cookie);
 assert.equal(nextWindow.status,200,nextWindow.body.error);
 assert.ok(nextWindow.body.items.some(x=>x.title==='CI hourly boundary witness'&&x.source_kind==='manual'));
 assert.equal(nextWindow.body.endDate,'2026-11-15');
 console.log('LEGACY_HOURLY_NEXT_REAL_POSTGRES_15DAY_OVERLAP_COMPLETE_PASS');
 console.log('LEGACY_HOURLY_CALENDAR_REAL_POSTGRES_CROSS_WEEK_OVERLAP_COMPLETE_PASS');

 // CLIENT_PORTFOLIO: test 500+ homes and server-side exact counts, not /api/state first 500.
 const portfolioBefore=(await database.query('SELECT count(*)::int AS n FROM public.mvp_objects WHERE client_id=$1',[client.id])).rows[0].n;
 await database.query("INSERT INTO public.mvp_objects(request_key,client_id,name,address) "+
  "SELECT gen_random_uuid(),$1,'Блок '||i,'Улица '||i FROM generate_series(1,520) AS i",[client.id]);
 const portfolioHomes=(await database.query('SELECT count(*)::int AS n FROM public.mvp_objects WHERE client_id=$1',[client.id])).rows[0].n;
 assert.equal(portfolioHomes,portfolioBefore+520);
 await database.query("INSERT INTO public.mvp_orders(request_key,object_id,title,status) "+
  "SELECT gen_random_uuid(),id,'Заявка '||name,CASE WHEN name='Блок 2' THEN 'done' WHEN name='Блок 3' THEN 'active' ELSE 'cancelled' END "+
  "FROM public.mvp_objects WHERE client_id=$1 AND name IN ('Блок 1','Блок 2','Блок 3')",[client.id]);
 const foreignPortfolioClient=await create('client_create',{name:'Другая управляющая организация'},cookie);
 const foreignPortfolioObject=await create('object_create',{clientId:foreignPortfolioClient.id,name:'Другой дом'},cookie);
 await create('order_create',{objectId:foreignPortfolioObject.id,title:'Чужой заказ'},cookie);
 const portfolioUrl='/api/clients/portfolio?id='+client.id+'&kind=objects&limit=12';
 assert.equal((await request(portfolioUrl)).status,401);
 assert.equal((await request('/api/clients/portfolio?id=wrong&kind=objects',undefined,cookie)).status,400);
 assert.equal((await request('/api/clients/portfolio?id='+randomUUID()+'&kind=objects',undefined,cookie)).status,404);
 for(const suffix of ['&kind=bad','&kind=orders&status=wrong','&kind=objects&status=done','&kind=objects&limit=51','&kind=orders&q=%00']){
  assert.equal((await request('/api/clients/portfolio?id='+client.id+suffix,undefined,cookie)).status,400);
 }
 const homesFirst=await request(portfolioUrl,undefined,cookie);
 assert.equal(homesFirst.status,200,homesFirst.body.error);
 assert.equal(homesFirst.body.clientId,client.id);
 assert.equal(homesFirst.body.counts.objects,portfolioHomes);
 assert.equal(homesFirst.body.items.length,12);
 assert.equal(homesFirst.body.hasMore,true);
 assert.equal(homesFirst.body.items.every(x=>x.client_id===client.id),true);
 const homesSecond=await request(portfolioUrl+'&cursor='+encodeURIComponent(homesFirst.body.nextCursor),undefined,cookie);
 assert.equal(homesSecond.status,200,homesSecond.body.error);
 assert.equal(homesSecond.body.items.length,12);
 assert.equal(new Set([...homesFirst.body.items,...homesSecond.body.items].map(x=>x.id)).size,24);
 assert.equal((await request('/api/clients/portfolio?id='+foreignPortfolioClient.id+'&kind=objects&limit=12&cursor='+
  encodeURIComponent(homesFirst.body.nextCursor),undefined,cookie)).status,400);
 assert.equal((await request('/api/clients/portfolio?id='+client.id+'&kind=orders&limit=12&cursor='+
  encodeURIComponent(homesFirst.body.nextCursor),undefined,cookie)).status,400);
 const selectedHome=await request('/api/clients/portfolio?id='+client.id+'&kind=objects&q='+encodeURIComponent('бЛоК 517'),undefined,cookie);
 assert.equal(selectedHome.status,200);assert.equal(selectedHome.body.items.length,1);
 assert.equal(selectedHome.body.items[0].name,'Блок 517');
 const portfolioOrders=await request('/api/clients/portfolio?id='+client.id+'&kind=orders&limit=12',undefined,cookie);
 assert.equal(portfolioOrders.status,200,portfolioOrders.body.error);
 const canonicalOrderTotals=(await database.query(
  "SELECT count(*)::int AS orders,count(*) FILTER (WHERE w.status IN ('open','active'))::int AS active FROM public.mvp_orders w JOIN public.mvp_objects o ON o.id=w.object_id WHERE o.client_id=$1",[client.id])).rows[0];
 assert.equal(portfolioOrders.body.counts.orders,canonicalOrderTotals.orders);
 assert.equal(portfolioOrders.body.counts.activeOrders,canonicalOrderTotals.active);
 assert.equal(portfolioOrders.body.items.every(x=>x.client_id===client.id),true);
 assert.equal(portfolioOrders.body.items.some(x=>x.title==='Чужой заказ'),false);
 const activeOnly=await request('/api/clients/portfolio?id='+client.id+'&kind=orders&status=active',undefined,cookie);
 assert.equal(activeOnly.status,200,activeOnly.body.error);
 const activeExpected=(await database.query("SELECT count(*)::int AS n FROM public.mvp_orders w JOIN public.mvp_objects o ON o.id=w.object_id WHERE o.client_id=$1 AND w.status='active'",[client.id])).rows[0].n;
 assert.equal(activeOnly.body.items.length,activeExpected);
 assert.equal(activeOnly.body.items.every(x=>x.status==='active'&&x.client_id===client.id),true);
 assert.equal(activeOnly.body.items.some(x=>x.title==='Заявка Блок 3'),true);
 const byObjectAddress=await request('/api/clients/portfolio?id='+client.id+'&kind=orders&q='+encodeURIComponent('Улица 3'),undefined,cookie);
 assert.equal(byObjectAddress.status,200);assert.equal(byObjectAddress.body.items.length,1);
 assert.equal(byObjectAddress.body.items[0].object_name,'Блок 3');
 const otherClientPage=await request('/api/clients/portfolio?id='+foreignPortfolioClient.id+'&kind=orders',undefined,cookie);
 assert.equal(otherClientPage.status,200);assert.equal(otherClientPage.body.counts.orders,1);
 assert.equal(otherClientPage.body.items[0].title,'Чужой заказ');
 console.log('CLIENT_PORTFOLIO_OWNER_520PLUS_OBJECTS_EXACT_COUNTS_KEYSET_CROSS_CLIENT_FILTERS_PG_PASS');

 // FULL WORKLOG 0034: deterministic, disposable, exact-owner HTTP/PostgreSQL.
 {
  const fullOrder=await create('order_create',{objectId:object.id,title:'FULL_WORKLOG fixture'},cookie);
  const fullDay='2030-03-15';
  const ciDay=(await database.query(
   "INSERT INTO public.mvp_work_days(day_date,status) VALUES($1::date,'open') RETURNING id",[fullDay])).rows[0].id;
  await database.query(
   'INSERT INTO public.mvp_sessions(request_key,day_id,order_id,description) VALUES($1,$2,$3,$4)',
   [randomUUID(),ciDay,fullOrder.id,'Full Log CI session']);
  const payload={orderId:fullOrder.id,dayDate:fullDay,startClock:'08:00',endClock:'10:00',
   performerMode:'OWNER',location:'Кухня',workType:'Монтаж труб',workDetail:'20 мм',
   quantity:'12.5',unit:'м',points:'4',nodes:'2',meters:'12.5',complexity:'3',
   lossMinutes:'15',lossReason:'материалы',reworkStatus:'no',reworkMinutes:'0',notes:'CI work'};
  const k=randomUUID();
  assert.equal((await request('/api/action',{type:'work_log_full_create',payload:{...payload,requestKey:k}})).status,401);
  assert.equal((await request('/api/worklogs/full-context?orderId='+fullOrder.id+
   '&dayDate='+fullDay+'&startClock=08%3A00&endClock=10%3A00')).status,401);
  const saved=await request('/api/action',{type:'work_log_full_create',payload:{...payload,requestKey:k}},cookie);
  assert.equal(saved.status,200,saved.body.error);
  assert.equal(saved.body.saved,true);
  assert.equal(saved.body.item.title,'Монтаж труб');
  assert.equal(saved.body.item.minutes,120);
  assert.equal(saved.body.item.detail.clean_minutes,105);
  assert.equal(saved.body.item.detail.work_day_id,ciDay);
  assert.equal(saved.body.item.detail.loss_minutes,15);
  const id=saved.body.item.id;
  assert.equal((await request('/api/action',{type:'work_log_full_create',payload:{...payload,requestKey:k}},cookie)).body.deduplicated,true);
  assert.equal((await request('/api/action',{type:'work_log_full_create',payload:{...payload,location:'Чужая комната',requestKey:k}},cookie)).status,409);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_work_log_details WHERE work_log_id=$1',[id])).rows[0].n,1);
  assert.equal((await request('/api/action',{type:'log_update',payload:{id,revision:1,dayDate:fullDay,title:'Broken basic edit',minutes:5}},cookie)).status,409);
  assert.equal((await request('/api/action',{type:'work_log_full_create',payload:{...payload,startClock:'09:00',endClock:'09:45',requestKey:randomUUID()}},cookie)).status,409);
  const gapPayload={...payload,startClock:'11:00',endClock:'12:00',lossMinutes:0,lossReason:'',
   quantity:'5',workType:'Испытание системы',requestKey:randomUUID()};
  assert.equal((await request('/api/action',{type:'work_log_full_create',payload:gapPayload},cookie)).status,409);
  const withReason={...gapPayload,gapReason:'lunch'};
  const second=await request('/api/action',{type:'work_log_full_create',payload:withReason},cookie);
  assert.equal(second.status,200,second.body.error);
  assert.equal(second.body.item.detail.gap_reason,'lunch');
  const updateKey=randomUUID();
  const changed={...payload,id,revision:1,workDetail:'21 мм',requestKey:updateKey};
  const corrected=await request('/api/action',{type:'work_log_full_update',payload:changed},cookie);
  assert.equal(corrected.status,200,corrected.body.error);
  assert.equal(corrected.body.item.id,id);
  assert.equal(corrected.body.item.revision,2);
  assert.equal(corrected.body.item.detail.work_detail,'21 мм');
  assert.equal((await request('/api/action',{type:'work_log_full_update',payload:changed},cookie)).body.deduplicated,true);
  assert.equal((await request('/api/action',{type:'work_log_full_update',payload:{...changed,requestKey:randomUUID()}},cookie)).status,409);
  const history=await request('/api/history?from='+fullDay+'&to='+fullDay+'&orderId='+fullOrder.id,undefined,cookie);
  assert.equal(history.status,200,history.body.error);
  assert.equal(history.body.items.filter(x=>x.detail).length,2);
  assert.equal(history.body.items.find(x=>x.id===id).detail.clean_minutes,105);
  const orderHistory=await request('/api/orders/worklogs?id='+fullOrder.id,undefined,cookie);
  assert.equal(orderHistory.status,200,orderHistory.body.error);
  assert.equal(orderHistory.body.items.length,2);
  assert.equal(orderHistory.body.items.find(x=>x.id===id).detail.location,'Кухня');
  const context=await request('/api/worklogs/full-context?orderId='+fullOrder.id+
   '&dayDate='+fullDay+'&startClock=13%3A00&endClock=14%3A00',undefined,cookie);
  assert.equal(context.status,200,context.body.error);
  assert.equal(context.body.gapMinutes,60);
  assert.equal(context.body.unrecordedLegacyClocks,'NOT_INFERRED');
  assert.equal((await request('/api/action',{type:'work_log_full_create',payload:{...payload,dayDate:'2030-03-16',requestKey:randomUUID()}},cookie)).status,409);
  assert.equal((await request('/api/action',{type:'work_log_full_create',payload:{...payload,performerMode:'WORKER',workerId:randomUUID(),requestKey:randomUUID()}},cookie)).status,409);
  assert.equal((await database.query('SELECT COUNT(*)::int n FROM public.mvp_work_log_full_requests WHERE work_log_id=$1',[id])).rows[0].n,1);
  console.log('FULL_WORKLOG_OWNER_TRANSACTION_PG_CLOCK_CLEAN_TIME_REPLAY_GAP_OVERLAP_HISTORY_AND_LEGACY_COMPAT_PASS');
 }


 // CRM WON to Order: legacy post-conversion wizard, atomic new Object + Order,
 // safe linked client/object, exact lead provenance, planner, retry and rollback.
 {
  const lead=await create('lead_create',{title:'CRM WON handoff fixture',contactName:'Order Handoff Client'},cookie);
  const conversion=await request('/api/action',{type:'lead_convert',payload:{
   leadId:lead.id,revision:lead.revision,newClientName:'Order Handoff Client',requestKey:randomUUID()}},cookie);
  assert.equal(conversion.status,200,conversion.body.error);
  const clientId=conversion.body.clientId;
  const key=randomUUID();
  const newPayload={leadId:lead.id,objectMode:'new',objectName:'Новая квартира',
   objectAddress:'Проверочный адрес',objectType:'Квартира',
   title:'Монтаж подводки',plannedOn:'2031-05-21',notes:'Согласовано',requestKey:key};
  assert.equal((await request('/api/action',{type:'crm_won_order_create',payload:newPayload})).status,401);
  const beforeObjects=(await database.query('SELECT count(*)::int n FROM public.mvp_objects')).rows[0].n;
  const beforeOrders=(await database.query('SELECT count(*)::int n FROM public.mvp_orders')).rows[0].n;
  const saved=await request('/api/action',{type:'crm_won_order_create',payload:newPayload},cookie);
  assert.equal(saved.status,200,saved.body.error);
  assert.equal(saved.body.saved,true);
  assert.equal(saved.body.createdObject,true);
  assert.equal(saved.body.leadId,lead.id);
  assert.equal(saved.body.clientId,clientId);
  assert.equal(saved.body.item.object_id,saved.body.objectId);
  assert.equal(saved.body.item.lead_id,lead.id);
  assert.equal(saved.body.item.title,'Монтаж подводки');
  const newObject=(await database.query(
   'SELECT client_id,name,object_type FROM public.mvp_objects WHERE id=$1',[saved.body.objectId])).rows[0];
  assert.equal(newObject.client_id,clientId);
  assert.equal(newObject.name,'Новая квартира');
  assert.equal(newObject.object_type,'Квартира');
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_objects')).rows[0].n,beforeObjects+1);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_orders')).rows[0].n,beforeOrders+1);
  const linked=(await database.query(
   'SELECT lead_id,client_id,object_id FROM public.mvp_crm_lead_client_links WHERE lead_id=$1',[lead.id])).rows[0];
  assert.equal(linked.client_id,clientId);
  assert.equal(linked.object_id,null,'Conversion link remains immutable; Order is linked explicitly');
  const plan=(await database.query(
   'SELECT order_id,object_id,schedule_date::text AS date FROM public.mvp_schedule_order_items WHERE order_id=$1',
   [saved.body.orderId])).rows[0];
  assert.equal(plan.order_id,saved.body.orderId);
  assert.equal(plan.object_id,saved.body.objectId);
  assert.equal(plan.date,'2031-05-21');
  const replay=await request('/api/action',{type:'crm_won_order_create',payload:newPayload},cookie);
  assert.equal(replay.status,200,replay.body.error);
  assert.equal(replay.body.deduplicated,true);
  assert.equal(replay.body.orderId,saved.body.orderId);
  assert.equal(replay.body.objectId,saved.body.objectId);
  assert.equal((await request('/api/action',{type:'crm_won_order_create',
   payload:{...newPayload,title:'Другое название'}},cookie)).status,409);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_orders WHERE lead_id=$1',[lead.id])).rows[0].n,1);
  const otherClient=await create('client_create',{name:'CRM handoff other Client'},cookie);
  const otherObject=await create('object_create',{clientId:otherClient.id,name:'Чужой объект'},cookie);
  const invalid=await request('/api/action',{type:'crm_won_order_create',
   payload:{leadId:lead.id,objectMode:'existing',objectId:otherObject.id,
    title:'Неверная связь',requestKey:randomUUID()}},cookie);
  assert.equal(invalid.status,409);
  const notWon=await create('lead_create',{title:'CRM handoff cannot bypass WON'},cookie);
  const notWonKey=randomUUID();
  assert.equal((await request('/api/action',{type:'crm_won_order_create',payload:{
   leadId:notWon.id,objectMode:'new',objectName:'Без договорённости',title:'Запрещено',
   requestKey:notWonKey}},cookie)).status,409);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_order_schedule_requests WHERE request_key=$1',
   [notWonKey])).rows[0].n,0);
  const pinnedLead=await create('lead_create',{title:'CRM pinned object',contactName:'Already related'},cookie);
  const linkedClient=await create('client_create',{name:'CRM pinned Client'},cookie);
  const pinnedObject=await create('object_create',{clientId:linkedClient.id,name:'CRM fixed Object'},cookie);
  const pinned=await request('/api/action',{type:'lead_convert',payload:{
   leadId:pinnedLead.id,revision:pinnedLead.revision,clientId:linkedClient.id,
   objectId:pinnedObject.id,requestKey:randomUUID()}},cookie);
  assert.equal(pinned.status,200,pinned.body.error);
  assert.equal((await request('/api/action',{type:'crm_won_order_create',payload:{
   leadId:pinnedLead.id,objectMode:'new',objectName:'Other Object',title:'Wrong',
   requestKey:randomUUID()}},cookie)).status,409);
  const pinnedOrder=await request('/api/action',{type:'crm_won_order_create',payload:{
   leadId:pinnedLead.id,objectMode:'existing',objectId:pinnedObject.id,
   title:'Верный закреплённый объект',requestKey:randomUUID()}},cookie);
  assert.equal(pinnedOrder.status,200,pinnedOrder.body.error);
  assert.equal(pinnedOrder.body.createdObject,false);
  assert.equal(pinnedOrder.body.item.lead_id,pinnedLead.id);
  // In the same PostgreSQL transaction, synthetic Order insert failure must
  // roll back the newly-created Object and idempotency receipt as well.
  await database.query(
   "CREATE FUNCTION public.crm_won_handoff_ci_fail() RETURNS trigger LANGUAGE plpgsql AS $ci$ BEGIN "+
   "IF NEW.title='CRM-WON-ROLLBACK' THEN RAISE EXCEPTION 'CRM_WON_SYNTHETIC_ABORT'; END IF; RETURN NEW; END $ci$");
  await database.query(
   'CREATE TRIGGER crm_won_handoff_ci_abort BEFORE INSERT ON public.mvp_orders FOR EACH ROW EXECUTE FUNCTION public.crm_won_handoff_ci_fail()');
  const rollbackKey=randomUUID(),objectCount=(await database.query('SELECT count(*)::int n FROM public.mvp_objects')).rows[0].n;
  const rollbackPayload={leadId:lead.id,objectMode:'new',objectName:'Should Roll Back',
   title:'CRM-WON-ROLLBACK',requestKey:rollbackKey};
  assert.equal((await request('/api/action',{type:'crm_won_order_create',payload:rollbackPayload},cookie)).status,500);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_objects')).rows[0].n,objectCount);
  assert.equal((await database.query('SELECT count(*)::int n FROM public.mvp_order_schedule_requests WHERE request_key=$1',
   [rollbackKey])).rows[0].n,0);
  await database.query('DROP TRIGGER crm_won_handoff_ci_abort ON public.mvp_orders');
  await database.query('DROP FUNCTION public.crm_won_handoff_ci_fail()');
  const recovered=await request('/api/action',{type:'crm_won_order_create',payload:rollbackPayload},cookie);
  assert.equal(recovered.status,200,recovered.body.error);
  assert.equal(recovered.body.createdObject,true);
  console.log('CRM_WON_ORDER_WIZARD_PG_ATOMIC_OBJECT_ORDER_FOREIGN_PARENT_REPLAY_ROLLBACK_PLAN_PASS');
 }

 console.log('DISPOSABLE_REAL_POSTGRES_AUTH_HTTP_E2E_PASS');
}finally{
 if(server){server.kill('SIGTERM');await sleep(150);}
 await database.end().catch(()=>{});
}
