import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {masterPayload,mastersRead,mastersAction,normalizeMasterPhone} from '../crm-masters.mjs';
import {leadTransferAction} from '../crm-lead-transfer.mjs';
class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
const uuid=x=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x)))throw new AppError(400,'ID');return x;};
const safeRevision=x=>{if(!Number.isInteger(+x)||+x<1)throw new AppError(400,'Revision');return Number(x);};
const file=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const schema=file('../migrations/0028_crm25a_master_directory_CANDIDATE.sql');
const plan=file('../migrations/0028_crm25a_master_directory_MIGRATION_PLAN.md');
const legacy=file('./fixtures/legacy/Config.snippets.txt');
const ui=file('../public/app.js'),server=file('../server.mjs');
const good={name:'Внешний мастер',phone:'',email:'',serviceArea:'Ереван',notes:'',status:'active',qualityTier:'normal',messengerType:'none',messengerContact:''};

test('CRM25 historical source contract, separate external Masters and additive migration',()=>{
 assert.match(legacy,/Masters: \['masterId', 'createdAt', 'updatedAt'/);
 assert.match(legacy,/masterStatus: \['active', 'unavailable', 'archived'\]/);
 assert.match(legacy,/masterQualityTier: \['good', 'normal', 'problematic'\]/);
 assert.match(legacy,/masterMessengerType: \['whatsapp', 'viber', 'telegram', 'other', 'none'\]/);
 assert.match(schema,/CREATE TABLE IF NOT EXISTS public\.mvp_crm_masters/);
 assert.match(schema,/source_master_id text UNIQUE/);
 assert.match(schema,/ALTER TABLE public\.mvp_crm_lead_transfers/);
 assert.match(schema,/master_id uuid REFERENCES public\.mvp_crm_masters\(id\)/);
 assert.match(plan,/fresh independently restorable|fresh independent|independently recoverable/i);
 assert.doesNotMatch(schema,/mvp_workers/);
});

test('CRM25 master form validates all legacy statuses and rejects malformed fields',()=>{
 assert.deepEqual(masterPayload(good,AppError).status,'active');
 assert.equal(masterPayload({...good,status:'unavailable',qualityTier:'problematic',messengerType:'viber'},AppError).status,'unavailable');
 for(const p of [
  {...good,name:' '},{...good,name:'x'.repeat(301)},{...good,status:'won'},
  {...good,qualityTier:'vip'},{...good,messengerType:'signal'},
  {...good,email:'x'.repeat(201)}, {...good,notes:'x'.repeat(5001)}
 ])assert.throws(()=>masterPayload(p,AppError),x=>x.status===400);
});
test('CRM25 master read filters are SQL-bound and cursor is scope-bound',async()=>{
 const id=randomUUID(),date='2026-11-09T08:02:03.123456Z',calls=[];
 const pool={async query(sql,params){calls.push({sql,params});return {rows:[{id,cursor_at:date,name:'A'},{id:randomUUID(),cursor_at:date,name:'B'}]};}};
 const ctx={pool,AppError};
 const make=src=>mastersRead({url:new URL('http://local/api/crm/masters?'+src),...ctx});
 const first=await make('q=Arm&status=active&limit=1');
 assert.equal(first.hasMore,true);assert.equal(first.items.length,1);assert.equal(first.items[0].cursor_at,undefined);
 assert.match(calls[0].sql,/FROM public\.mvp_crm_masters/);
 assert.match(calls[0].sql,/status=\$2/);
 assert.deepEqual(calls[0].params,['arm','active',2]);
 const second=await make('q=Arm&status=active&limit=1&cursor='+first.nextCursor);
 assert.equal(second.items.length,1);
 assert.equal(calls[1].params[2],date);
 assert.equal(calls[1].params[3],id);
 await assert.rejects(make('q=Arm&status=archived&cursor='+first.nextCursor),e=>e.status===400);
 for(const bad of ['status=won','limit=101','cursor=bad','q=%00'])await assert.rejects(make(bad),e=>e.status===400);
 assert.equal(calls.length,2);
});
test('CRM25 native master create is idempotent and updates validate source/canonical revision',async()=>{
 const id=randomUUID(),key=randomUUID(),calls=[],item={id,source_system:'CLEAN_NATIVE',revision:1};
 const db={async query(sql,args){calls.push({sql,args});if(sql.startsWith('INSERT INTO public.mvp_crm_masters'))return {rows:[item]};if(sql.startsWith('SELECT source_system,revision'))return {rows:[item]};if(sql.startsWith('UPDATE'))return {rows:[{...item,revision:2}]};return {rows:[]};},release(){}};
 const pool={async connect(){return db;},async query(sql,args){
  calls.push({sql,args}); if(sql.startsWith('UPDATE'))return {rows:[{...item,revision:2}]};return {rows:[]};
 }};
 const created=await mastersAction({pool,type:'crm_master_create',p:good,key,uuid,safeRevision,AppError});
 assert.equal(created.item.id,id);assert.equal(created.deduplicated,false);
 assert.ok(calls.some(x=>/ON CONFLICT\(request_key\) DO NOTHING/.test(x.sql)));
 const changed=await mastersAction({pool,type:'crm_master_update',p:{...good,masterId:id,revision:1},key,uuid,safeRevision,AppError});
 assert.equal(changed.item.revision,2);
 assert.ok(calls.some(x=>/source_system='CLEAN_NATIVE' RETURNING/.test(x.sql)));
 await assert.rejects(mastersAction({pool,type:'crm_master_create',p:{...good,sourceMasterId:'LEGACY-1'},key,uuid,safeRevision,AppError}),e=>e.status===400);
});
test('CRM25 selected Master snapshots verified foreign ID and disallows archive/unknown',async()=>{
 const leadId=randomUUID(),masterId=randomUUID(),key=randomUUID();
 function mocked(status='active'){
  const calls=[],db={async query(sql,args){
   calls.push({sql,args});
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
   if(/SELECT \* FROM public\.mvp_leads/.test(sql))return {rows:[{id:leadId,status:'new',revision:1}]};
   if(/SELECT \* FROM public\.mvp_crm_lead_transfers/.test(sql))return {rows:[]};
   if(/SELECT id,name,status FROM public\.mvp_crm_masters/.test(sql))return {rows:[{id:masterId,name:'Справочник A',status}]};
   if(/INSERT INTO public\.mvp_crm_lead_transfers/.test(sql))return {rows:[{id:randomUUID(),lead_id:leadId,master_id:masterId,reason:'other',comment:'',recipient_name:'Справочник A',transferred_at:'2026-11-09T10:00:00Z'}]};
   if(/UPDATE public\.mvp_leads SET status='transferred'/.test(sql))return {rows:[{id:leadId,status:'transferred',revision:2}]};
   return {rows:[]};
  },release(){}};return {pool:{async connect(){return db;}},calls};
 }
 const p={leadId,revision:1,masterId,reason:'other',comment:'',confirm:'TRANSFER_LEAD'};
 const ok=mocked();
 const done=await leadTransferAction({pool:ok.pool,p,key,uuid,safeRevision,AppError});
 assert.equal(done.transfer.masterId,masterId);
 assert.equal(done.transfer.recipientName,'Справочник A');
 assert.equal(done.transfer.source,'CLEAN_NATIVE_MASTER_RECIPIENT');
 const ins=ok.calls.find(x=>x.sql.startsWith('INSERT INTO public.mvp_crm_lead_transfers'));
 assert.equal(ins.args[3],'Справочник A');assert.equal(ins.args[6],masterId);
 const archived=mocked('archived');
 await assert.rejects(leadTransferAction({pool:archived.pool,p,key,uuid,safeRevision,AppError}),e=>e.status===409);
 assert.equal(archived.calls.some(x=>x.sql.startsWith('INSERT INTO public.mvp_crm_lead_transfers')),false);
});
test('CRM25 no Worker substitution; owner API/UI integration is explicit',()=>{
 assert.match(server,/if\(type==='crm_master_create'\|\|type==='crm_master_update'\)/);
 assert.match(server,/pathname==='\/api\/crm\/masters'/);
 assert.match(ui,/function crmMastersDirectory\(\)/);
 assert.match(ui,/data-act="crm_master_update"/);
 assert.match(ui,/data-crm-master-load/);
 assert.match(ui,/data-crm-lead-transfer/);
 assert.match(ui,/select\('masterId','Внешний мастер из справочника'/);
 assert.match(ui,/receiver\.disabled=Boolean\(masterSelector\.value\)/);
 assert.doesNotMatch(file('../crm-masters.mjs'),/mvp_workers|GoogleSheets|SpreadsheetApp|googleapis/);
});


test('MS1 filters use verified snapshot and exact source IDs; cursor binds every filter',async()=>{
 const id=randomUUID(), date='2026-11-09T08:02:03.123456Z',calls=[];
 const options=[{serviceId:'SVC-1',category:'A',serviceName:'Монтаж'},{serviceId:'SVC-2',category:'B',serviceName:'Ремонт'}];
 const pool={async query(sql,args){calls.push({sql,args});
  if(sql.includes('SELECT 1 AS verified'))return {rows:[{verified:1}]};
  if(sql.includes('FROM public.mvp_services_reference WHERE'))return {rows:options};
  return {rows:[{id,cursor_at:date,source_system:'LEGACY_GOOGLE',source_master_id:'MST-1'},{id:randomUUID(),cursor_at:date}]};
 }};
 const make=query=>mastersRead({pool,AppError,url:new URL('http://local/api/crm/masters?'+query)});
 const got=await make('reference=1&status=available&category=A&serviceId=SVC-1&limit=1');
 assert.equal(got.reference.readonly,true);assert.equal(got.reference.services.length,2);assert.equal(got.hasMore,true);
 const filtered=calls.at(-1);
 assert.match(filtered.sql,/p\.master_id=m\.source_master_id/);assert.match(filtered.sql,/m\.source_system='LEGACY_GOOGLE'/);
 assert.match(filtered.sql,/status<>'archived'/);assert.match(filtered.sql,/Asia\/Yerevan/);assert.match(filtered.sql,/p\.valid_from/);
 assert.deepEqual(filtered.args.slice(-3),['A','SVC-1',2]);
 const before=calls.length;
 await assert.rejects(make('reference=1&status=available&category=B&serviceId=SVC-2&limit=1&cursor='+got.nextCursor),e=>e.status===400);
 assert.equal(calls.length,before);
 await assert.rejects(make('reference=1&category=A&serviceId=SVC-2'),e=>e.status===400);
 const next=await make('reference=1&status=available&category=A&serviceId=SVC-1&limit=1&cursor='+got.nextCursor);
 assert.equal(next.items.length,1);assert.match(calls.at(-1).sql,/\(created_at,id\)</);
});
test('MS1 direct card preserves source ID, native revision and historical write fence',async()=>{
 const id=randomUUID(),calls=[];
 const pool={async query(sql,args){calls.push({sql,args});
  if(sql.includes('SELECT 1 AS verified'))return {rows:[{verified:1}]};
  if(sql.includes('FROM public.mvp_services_reference WHERE'))return {rows:[]};
  if(sql.includes('SELECT DISTINCT'))return {rows:[{serviceId:'SVC-1',category:'A',serviceName:'Монтаж'}]};
  if(sql.startsWith('UPDATE public.mvp_crm_masters'))return {rows:[]};
  if(sql.includes('SELECT source_system,revision'))return {rows:[{source_system:'LEGACY_GOOGLE',revision:1}]};
  return {rows:[{id,source_system:'LEGACY_GOOGLE',source_master_id:'MST-1'}]};
 }};
 pool.connect=async()=>({query:pool.query.bind(pool),release(){}});
 const detail=await mastersRead({pool,AppError,url:new URL('http://local/api/crm/masters?reference=1&masterId='+id)});
 assert.equal(detail.items[0].id,id);assert.equal(detail.linkedServices.length,1);assert.equal(calls.at(-1).args[1],'MST-1');
 await assert.rejects(mastersAction({pool,type:'crm_master_update',p:{...good,masterId:id,revision:1},key:randomUUID(),uuid,safeRevision,AppError}),e=>e.status===409);
 await assert.rejects(mastersRead({pool,AppError,url:new URL('http://local/api/crm/masters?masterId='+id+'&q=other')}),e=>e.status===400);
 const noReceipt={async query(){return {rows:[]};}};
 await assert.rejects(mastersRead({pool:noReceipt,AppError,url:new URL('http://local/api/crm/masters?reference=1&category=A')}),e=>e.status===503);
});
test('MS1 standalone navigation and session scope preserve existing CRM recipient route',()=>{
 const html=file('../public/index.html');
 assert.equal((html.match(/data-tab="masters"/g)||[]).length,1);
 assert.match(ui,/tab==='masters'\?ms1View\(\)/);assert.match(ui,/function ms1ResetSession\(\)/);
 assert.match(ui,/ms1!==state\|\|state\.seq!==seq/);assert.match(ui,/knowledgeResetSession\(\);ms1ResetSession\(\)/);
 assert.match(ui,/data-ms1-directory/);assert.match(ui,/data-ms1-back/);assert.match(ui,/data-ms1-reset/);
 assert.match(ui,/function ms1Detail/);assert.match(ui,/source_system==='CLEAN_NATIVE'/);
 assert.match(ui,/function crmLeadTransferCard/);assert.match(ui,/data-crm-master-load/);
});


test('MS1.2 strict phone normalization matches M8B2 forms and rejects malformed input',()=>{
 for(const v of ['099 123456','37499123456','+374 (99) 123-456','00374 99 123456'])
  assert.equal(normalizeMasterPhone(v,AppError),'+37499123456');
 assert.equal(normalizeMasterPhone('',AppError),'');
 assert.equal(normalizeMasterPhone('+1 202 555 0100',AppError),'+12025550100');
 for(const bad of ['123456','09912345','+374099123456','abc','+12','+3740 1234567'])
  assert.throws(()=>normalizeMasterPhone(bad,AppError),e=>e.status===400);
});
test('MS1.2 duplicate check is serialized; same-key replay precedes duplicate lookup',async()=>{
 const calls=[],id=randomUUID(),key=randomUUID(),raw={...good,phone:'099123456'};
 let previous=null,duplicate=true,old={id,source_system:'CLEAN_NATIVE',revision:1};
 const db={async query(sql,args){calls.push({sql,args});
  if(sql.startsWith('SELECT * FROM public.mvp_crm_masters WHERE request_key'))return {rows:previous?[previous]:[]};
  if(sql.startsWith('SELECT source_system,revision'))return {rows:[old]};
  if(sql.startsWith('SELECT id FROM public.mvp_crm_masters'))return {rows:duplicate?[{id:randomUUID()}]:[]};
  if(sql.startsWith('INSERT'))return {rows:[{id,phone:args[3]}]};
  if(sql.startsWith('UPDATE'))return {rows:[{id,revision:2,phone:args[3]}]};
  return {rows:[]};},release(){}};
 const pool={async connect(){return db;}};
 const create=p=>mastersAction({pool,type:'crm_master_create',p,key,uuid,safeRevision,AppError});
 await assert.rejects(create(raw),e=>e.status===409);
 assert.ok(calls.findIndex(x=>x.sql.startsWith('LOCK TABLE'))<calls.findIndex(x=>x.sql.startsWith('SELECT id FROM')));
 assert.equal(calls.some(x=>x.sql.startsWith('INSERT')),false);
 assert.ok(calls.some(x=>x.sql==='ROLLBACK'));
 previous={id,payload_sha256:createHash('sha256').update(JSON.stringify(masterPayload(raw,AppError))).digest('hex')};
 calls.length=0;
 assert.equal((await create(raw)).deduplicated,true);
 assert.equal(calls.some(x=>x.sql.startsWith('SELECT id FROM')),false);
 await assert.rejects(create({...raw,name:'Другой'}),e=>e.status===409);
 previous=null;duplicate=false;
 assert.equal((await create(raw)).item.phone,'+37499123456');
 const update=()=>mastersAction({pool,type:'crm_master_update',p:{...raw,masterId:id,revision:1},key,uuid,safeRevision,AppError});
 assert.equal((await update()).item.revision,2);
 assert.deepEqual(calls.filter(x=>x.sql.startsWith('SELECT id FROM')).at(-1).args,['+37499123456',id]);
 old={...old,source_system:'LEGACY_GOOGLE'};
 await assert.rejects(update(),e=>e.status===409);
});
