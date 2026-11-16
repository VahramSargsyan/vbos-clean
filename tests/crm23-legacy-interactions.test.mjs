import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 classifyLegacyInteraction,countLegacyRows,crmLegacyInteractionsForClient
} from '../crm-legacy-interactions.mjs';

const get=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const legacy=get('./fixtures/legacy/CrmService.snippets.txt'),ui=get('../public/app.js'),
 server=get('../server.mjs'),source=get('../crm-legacy-interactions.mjs');
const migration=get('../migrations/0027_crm23a_legacy_interactions_CANDIDATE.sql');
const clientId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
const uuid=x=>String(x)===clientId?x:(()=>{throw new AppError(400,'UUID');})();
const stamp='2026-10-07T10:00:00.000Z';
const old=(i,lead)=>({
 interactionId:'INT-CRM23-'+String(i).padStart(3,'0'),createdAt:stamp,updatedAt:stamp,
 status:'active',entityType:'Lead',entityId:lead,interactionType:'call',
 summary:'Synthetic archive call '+i,nextAction:'',nextActionAt:'',notes:'',
 clientRequestId:'CRM23-REQ-'+i
});
function fixture(){
 const leads=Array.from({length:33},(_,i)=>'LEAD-CRM23-'+String(i).padStart(2,'0'));
 const clients=Array.from({length:17},(_,i)=>'CLIENT-CRM23-'+String(i).padStart(2,'0'));
 const clientsMap=clients.map((source_id,i)=>({
  source_id,target_id:i===0?clientId:'bbbbbbbb-bbbb-4bbb-8bbb-'+String(i).padStart(12,'0'),
  source_lead_id:i===0?leads[0]:''
 }));
 const rows=[];
 // 15 genuine calls. Two primary-source and two final-relation contact rows
 // link exactly to client 0; the other 11 are not assigned to a Client.
 for(let i=0;i<15;i++)rows.push(old(i,i<2?leads[0]:i<4?leads[1]:leads[i+1]));
 // Five final relations: one goes to the client with two contacts.
 for(let j=0;j<5;j++)rows.push({...old(15+j,j===4?leads[31]:leads[j+1]),interactionType:'note',
  clientRequestId:'REL|LeadClient|'+(j===4?leads[31]:leads[j+1])+'|'+clients[j],summary:'SYNTHETIC REL'});
 // Ten pending relations to other Client identities; three have actual calls,
 // and must not be linked just because a pending marker exists.
 for(let j=0;j<10;j++)rows.push({...old(20+j,leads[j+5]),interactionType:'note',
  clientRequestId:'REL|LeadClientPending|'+leads[j+5]+'|'+clients[j+5],summary:'SYNTHETIC PENDING'});
 // Move canonical relation j=0 to client 0 for lead[1], already done.
 const dbrows=rows.map(x=>{
  const c=classifyLegacyInteraction(x);
  return {source_id:x.interactionId,entity_type:x.entityType,entity_id:x.entityId,
   record_kind:c.kind,interaction_type:x.interactionType,created_at:new Date(x.createdAt),
   updated_at:new Date(x.updatedAt),original_status:x.status,summary:x.summary,
   next_action:x.nextAction,next_action_at:x.nextActionAt,notes:x.notes,
   client_request_id:x.clientRequestId,row_sha256:'a'.repeat(64)}
 });
 const expected={LEAD:33,CLIENT:17,OBJECT:19,WORKER:2,
 WORK_ORDER:22,CLIENT_ASSESSMENT:13,WORKER_ASSIGNMENT:1,FINANCE_TRANSACTION:24};
 const receipt={receipt_id:'SYNTHETIC_RECEIPT',history_batch_id:'SYNTHETIC_BATCH',
  count_all:30,count_activity:15,count_relation_final:5,count_relation_pending:10,
  expected_counts:expected,reconciled_counts:expected};
 return {rows,dbrows,leads,clients,clientsMap,receipt};
}
function db(fx,{receipt=true,hasTable=true,alterRows=null,alterMapping=null,alterReceipt=null}={}){
 const calls=[];
 const pool={async query(sql,args){
  calls.push({sql,args});
  if(sql.startsWith('SELECT id FROM public.mvp_clients'))return {rows:[{id:clientId}]};
  if(sql.includes('FROM mvp_history.crm_legacy_interaction_receipts')){
   if(!hasTable){let e=Error('not found');e.code='42P01';throw e;}
   return {rows:receipt?[{...fx.receipt,...alterReceipt}]:[]};
  }
  if(sql.includes('FROM mvp_history.crm_legacy_interactions'))return {rows:alterRows||fx.dbrows};
  if(sql.includes('FROM public.mvp_legacy_import_map'))return {rows:alterMapping||fx.clientsMap};
  if(sql.includes('FROM mvp_history.source_records'))return {rows:fx.leads.map(source_id=>({source_id}))};
  throw Error('UNEXPECTED_QUERY '+sql);
 }};
 return {pool,calls};
}
const read=pool=>crmLegacyInteractionsForClient({pool,clientId,uuid,AppError});
test('legacy identifies Client history with primary sourceLeadId, exact relation records and interaction ID dedup',()=>{
 assert.match(legacy,/function getClientService_\(/);
 assert.match(legacy,/function getRelatedLeadsForClient_\(/);
 assert.match(legacy,/function mergeInteractionHistory_\(/);
 assert.match(legacy,/function parseAnyLeadClientRelation_\(/);
 assert.match(legacy,/historyStage:'after_client'/);
});
test('source inventory classifier excludes 15 relation carriers even when they have note summaries',()=>{
 const fx=fixture();
 assert.deepEqual(countLegacyRows(fx.rows,fx.leads,fx.clients),{
  all:30,activity:15,final:5,pending:10
 });
 const used=new Set(fx.rows.map(x=>x.interactionId));assert.equal(used.size,30);
 const wrong={...fx.rows[15],entityId:'UNKNOWN'};
 assert.throws(()=>classifyLegacyInteraction(wrong),/SCOPE_CONFLICT/);
 assert.throws(()=>classifyLegacyInteraction({...fx.rows[0],clientRequestId:'REL|Other|X'}),/UNKNOWN_LEGACY_RELATION/);
 assert.throws(()=>countLegacyRows([...fx.rows,fx.rows[0]],fx.leads,fx.clients),/DUPLICATE_INTERACTION_ID/);
});
test('verified immutable archive returns only four exact Client-linked contacts and leaves eleven unassigned',async()=>{
 const fx=fixture(),d=db(fx);const r=await read(d.pool);
 assert.equal(r.status,'VERIFIED_READONLY');
 assert.equal(r.source,'LEGACY_GOOGLE_VERIFIED_READONLY');
 assert.equal(r.archiveActivities,15);
 assert.equal(r.unlinkedActivities,11);
 assert.equal(r.items.length,4);
 assert.ok(r.items.every(x=>x.readonly===true&&x.source==='LEGACY_GOOGLE'));
 assert.equal(r.items.filter(x=>x.historyStage==='before_client').length,2);
 assert.equal(r.items.filter(x=>x.historyStage==='repeat_lead').length,2);
 assert.ok(r.items.every(x=>!x.summary.includes('REL')));
 assert.ok(d.calls.every(x=>/^\s*SELECT/i.test(x.sql)),'no side effects on canonical data');
 assert.ok(d.calls.some(x=>x.sql.includes('mvp_history.source_records')));
});
test('pending-only linkage is not final and old Client statuses have no inferred native Lead ID',async()=>{
 const fx=fixture(),d=db(fx);
 const out=await read(d.pool);
 assert.ok(out.items.every(x=>x.originalEntityId.startsWith('LEAD-')));
 assert.equal(out.unlinkedActivities,11);
 assert.doesNotMatch(source,/INSERT INTO public\.mvp_crm_interactions/);
 assert.doesNotMatch(source,/phone\s*=|name\s*=/);
});
test('no verified source receipt returns explicit NOT_IMPORTED and never fake empty confirmed history',async()=>{
 const fx=fixture();
 for(const cfg of [{receipt:false},{hasTable:false}]){
  const result=await read(db(fx,cfg).pool);
  assert.equal(result.status,'NOT_IMPORTED');
  assert.equal(result.archiveActivities,null);
  assert.equal(result.items.length,0);
 }
});
test('tampered source counts, two-client identity and parent conflict fail closed',async()=>{
 const fx=fixture();
 await assert.rejects(()=>read(db(fx,{alterReceipt:{count_all:29}}).pool),e=>e.status===503);
 const duplicate=[...fx.clientsMap];
 duplicate[1]={...duplicate[1],source_lead_id:fx.leads[0]};
 await assert.rejects(()=>read(db(fx,{alterMapping:duplicate}).pool),e=>e.status===503);
 const bad=fx.dbrows.map(x=>({...x}));bad[0].row_sha256='BAD';
 await assert.rejects(()=>read(db(fx,{alterRows:bad}).pool),e=>e.status===503);
});
test('owner cookie gate and separate read-only archive UI retained',()=>{
 assert.match(server,/if\(!sessionValid\(req\)\)throw new AppError\(401/);
 assert.match(server,/pathname==='\/api\/crm\/legacy-interactions'/);
 assert.match(ui,/function crmLegacyInteractionView\(clientId\)/);
 assert.match(ui,/crmLegacyInteractionView\(x\.id\)/);
 assert.match(ui,/data-crm23-open/);
 assert.match(ui,/source!=='LEGACY_GOOGLE_VERIFIED_READONLY'/);
 assert.match(ui,/Старые контакты VBOS|Контакты старого VBOS/);
 assert.match(ui,/Старые контакты|старый VBOS/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS mvp_history\.crm_legacy_interactions/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS mvp_history\.crm_legacy_interaction_receipts/);
 assert.match(migration,/count_all=30/);
 assert.match(migration,/count_activity=15/);
 assert.match(migration,/count_relation_final=5/);
 assert.match(migration,/count_relation_pending=10/);
});
