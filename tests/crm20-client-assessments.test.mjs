import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clientAssessmentHistoryRead} from '../crm-client-assessments.mjs';

const legacy=readFileSync(new URL('../../../CrmService.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const id='00000000-0000-4000-8000-000000000001';
const uuid=x=>{if(x!==id)throw new Error('INVALID_UUID');return x;};
class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
const clientId='CL-CRM20-SYNTHETIC';
const orderId='WO-CRM20-SYNTHETIC';
const objectId='OBJ-CRM20-SYNTHETIC';
const assessmentId='CAS-CRM20-SYNTHETIC';
const complete={
 clientAssessmentId:assessmentId,clientId,workOrderId:orderId,objectId,
 satisfaction:'YES',acceptance:'NO_REMARKS',paymentBehavior:'ON_TIME',
 communicationQuality:'EASY',scopeChanges:'NONE',workAgain:'YES',
 score:100,scoreVersion:'CLIENT_SCORE_V1_100',riskLabel:'LOW_RISK',
 updatedAt:'2026-08-16T15:00:00Z'
};
const orderFields={
 clientAssessmentId:assessmentId,clientId,objectId,
 title:'Синтетический завершённый заказ',completionDate:46250,
 closedAt:'2026-08-16T15:00:00Z',financeCheckedAt:'2026-08-16T14:00:00Z',
 unfinishedObligationsStatus:'NONE',clientRequestId:'REQ-CRM20-TEST'
};
const archivedRow=(changes={})=>({
 assessment_id:assessmentId,assessment_status:'active',assessment_system:'LEGACY_GOOGLE',
 assessment:{...complete},client_source_id:clientId,
 order_id:orderId,order_status:'completed',order_system:'LEGACY_GOOGLE',
 order_fields:{...orderFields},...changes
});
const nativeRow=()=>({
 id:'00000000-0000-4000-8000-000000000002',
 order_id:'00000000-0000-4000-8000-000000000003',order_title:'Synthetic native close',
 completion_date:'2026-11-06',recorded_at:new Date('2026-11-06T10:00:00Z'),
 score:80,score_version:'CLIENT_SCORE_V1_100',score_complete:true,known_factors:6,risk_label:'LOW_RISK'
});
const mk=({native=[],history=[],receipt=true,missingArchive=false,exists=true}={})=>{
 const calls=[];
 const pool={async query(sql,args){
  calls.push({sql,args});
  if(sql.startsWith('SELECT id FROM public.mvp_clients'))return {rows:exists?[{id}]:[]};
  if(sql.includes('FROM public.mvp_native_client_assessments'))return {rows:native};
  if(sql.includes('FROM mvp_history.import_batches')){
   if(missingArchive){const e=Error('missing archive');e.code='42P01';throw e;}
   return {rows:receipt?[{batch_id:'SYNTHETIC_CI_VERIFIED_BATCH'}]:[]};
  }
  if(sql.includes('FROM public.mvp_legacy_import_map'))return {rows:history};
  throw Error('UNEXPECTED_QUERY '+sql);
 }};
 return {calls,pool};
};
const read=pool=>clientAssessmentHistoryRead({pool,clientId:id,uuid,AppError});
test('legacy Client assessment history uses exact order joins and complete scores for average',()=>{
 assert.match(legacy,/const assessments=findRecordsByColumnValues_\('ClientAssessments','clientId'/);
 assert.match(legacy,/const assessmentOrders=getRecordProjectionMapByIdSet_\('WorkOrders'/);
 assert.match(legacy,/scoreComplete && item\.score!==''/);
 assert.match(legacy,/clientAssessmentHistory:clientAssessmentHistory/);
});
test('historical Excel completion date, 6-factor source parity and combined native average',async()=>{
 const {pool,calls}=mk({native:[nativeRow()],history:[archivedRow()]});
 const result=await read(pool);
 assert.equal(result.archiveStatus,'VERIFIED_READONLY');
 assert.equal(result.historicalGoogleImported,false);
 assert.equal(result.nativeCount,1);assert.equal(result.archiveCount,1);
 assert.equal(result.totalCount,2);assert.equal(result.scoredCount,2);
 assert.equal(result.average,90);
 assert.equal(result.items[0].source,'CLEAN_NATIVE');
 const hist=result.items[1];
 assert.equal(hist.source,'VERIFIED_LEGACY_ARCHIVE');
 assert.equal(hist.completionDate,'2026-08-16');
 assert.equal(hist.score,100);assert.equal(hist.scoreComplete,true);
 assert.equal(hist.verifiedForAverage,true);
 assert.equal(hist.knownFactors,6);
 assert.ok(calls.every(c=>!/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP)/i.test(c.sql)));
 assert.deepEqual(calls[2].args.length,1);
 assert.deepEqual(calls[3].args,[id,'SYNTHETIC_CI_VERIFIED_BATCH']);
 assert.ok(calls[3].sql.includes("m.source_system='Working IP APP / M8C cutover baseline'"));
 assert.ok(calls[3].sql.includes('m.target_id=$1'));
});
test('missing stored score is visibly missing and not fabricated into average',async()=>{
 const partial=archivedRow({assessment:{...complete,score:'',satisfaction:'UNKNOWN',riskLabel:'UNKNOWN'}});
 const r=await read(mk({history:[partial]}).pool);
 assert.equal(r.archiveCount,1);assert.equal(r.totalCount,1);
 assert.equal(r.average,null);assert.equal(r.scoredCount,0);
 assert.equal(r.items[0].score,null);
 assert.equal(r.items[0].scoreComplete,false);
 assert.equal(r.items[0].verifiedForAverage,false);
});
test('stored but incomplete score stays displayed yet does not contaminate the average',async()=>{
 const partial=archivedRow({assessment:{...complete,satisfaction:'UNKNOWN',riskLabel:'UNKNOWN'}});
 const r=await read(mk({history:[partial]}).pool);
 assert.equal(r.items[0].score,100);
 assert.equal(r.items[0].verifiedForAverage,false);
 assert.equal(r.items[0].requiresScoreReview,true);
 assert.equal(r.average,null);
});
test('corrupted history pair and malformed score fail closed; archived assessments excluded',async()=>{
 for(const row of [
  archivedRow({order_fields:{...orderFields,clientId:'OTHER_CLIENT'}}),
  archivedRow({order_fields:{...orderFields,clientAssessmentId:'WRONG'}}),
  archivedRow({order_status:'active'}),
  archivedRow({assessment:{...complete,objectId:'WRONG'}}),
  archivedRow({assessment:{...complete,score:250}})
 ]){
  await assert.rejects(()=>read(mk({history:[row]}).pool),e=>e.status===503);
 }
 const archived=await read(mk({history:[archivedRow({assessment_status:'archived'})]}).pool);
 assert.equal(archived.totalCount,0);assert.equal(archived.archiveStatus,'VERIFIED_READONLY');
});
test('unavailable archive is explicit and never reported as zero verified historic records',async()=>{
 for(const options of [{receipt:false},{missingArchive:true}]){
  const r=await read(mk({native:[nativeRow()],...options}).pool);
  assert.equal(r.archiveStatus,'UNAVAILABLE');
  assert.equal(r.averageCompleteCoverage,false);
  assert.equal(r.nativeCount,1);assert.equal(r.archiveCount,0);
 }
 await assert.rejects(()=>read(mk({exists:false}).pool),e=>e.status===404);
});
test('Client card is lazy and owner-authenticated; no assessment writes or exposing raw comments',()=>{
 assert.match(ui,/Оценки клиента по заказам/);
 assert.match(ui,/data-client-assessment-open/);
 assert.match(ui,/loadClientAssessments/);
 assert.match(ui,/\/api\/crm\/client-assessments\?clientId=/);
 assert.match(ui,/clientAssessmentView\(x\.id\)/);
 assert.match(ui,/scoredCount/);
 assert.match(ui,/r\.archiveStatus!=='VERIFIED_READONLY'/);
 assert.match(server,/if\(!sessionValid\(req\)\)throw new AppError\(401/);
 assert.match(server,/pathname==='\/api\/crm\/client-assessments'/);
 assert.match(server,/clientAssessmentHistoryRead/);
 assert.doesNotMatch(ui.slice(ui.indexOf('function clientAssessmentView('),ui.indexOf('async function loadClientAssessments()')),/item\.comment/);
});
