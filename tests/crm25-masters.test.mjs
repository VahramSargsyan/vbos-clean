import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {masterPayload,mastersRead,mastersAction} from '../crm-masters.mjs';
import {leadTransferAction} from '../crm-lead-transfer.mjs';
class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
const uuid=x=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x)))throw new AppError(400,'ID');return x;};
const safeRevision=x=>{if(!Number.isInteger(+x)||+x<1)throw new AppError(400,'Revision');return Number(x);};
const file=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const schema=file('../migrations/0028_crm25a_master_directory_CANDIDATE.sql');
const plan=file('../migrations/0028_crm25a_master_directory_MIGRATION_PLAN.md');
const legacy=file('../../../Config.js');
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
 const db={async query(sql,args){calls.push({sql,args});if(sql.startsWith('INSERT INTO public.mvp_crm_masters'))return {rows:[item]};return {rows:[]};},release(){}};
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
