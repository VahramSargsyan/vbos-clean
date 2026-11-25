import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {servicesCatalogRead,servicesCatalogSave,servicePayload} from '../services-catalog.mjs';
import {renderServiceCatalog} from '../public/services-catalog-view.mjs';
class AppError extends Error{constructor(status,message){super(message);this.status=status}}
const key='12345678-1234-4234-8234-123456789012';
const good={status:'active',category:'Test',serviceName:'Synthetic service',defaultUnit:'item',notes:'',actionCode:'INSTALL'};
const authority={phase:'CLEAN',master_snapshot_hash:'a'.repeat(64),dependency_receipt_hash:'b'.repeat(64)};
const row={service_id:'SRV-2026-0061',status:'active',category:'Test',service_name:'Synthetic service',default_unit:'item',notes:'',action_code:'INSTALL',revision:1};
test('MS2 validates legacy enums and immutable identity',()=>{
 assert.equal(servicePayload(good,AppError).defaultUnit,'item');
 for(const bad of [{...good,defaultUnit:'fake'},{...good,status:'deleted'},{...good,category:''},{...good,source_system:'CLEAN_NATIVE'},{...good,serviceId:'SRV-2026-0061',revision:0},{...good,actionCode:'fake'}])assert.throws(()=>servicePayload(bad,AppError),e=>e.status===400);
});
test('MS2 reads snapshot while LEGACY and canonical table only after CLEAN',async()=>{
 let phase='LEGACY';const calls=[];
 const pool={async query(sql,args){calls.push({sql,args});
  if(sql.includes('FROM public.mvp_masters_services_authority'))return {rows:[{...authority,phase}]};
  if(sql.includes('FROM public.mvp_service_reference_batches'))return {rows:[{}]};
  if(sql.startsWith('SELECT DISTINCT'))return {rows:[{category:'Test'}]};
  return {rows:[row]};}};
 const get=()=>servicesCatalogRead({pool,url:new URL('http://local/api/masters/services?q=Test'),AppError});
 assert.equal((await get()).writeEnabled,false);assert.ok(calls.some(x=>x.sql.includes('FROM public.mvp_services_reference WHERE')));
 phase='CLEAN';calls.length=0;assert.equal((await get()).writeEnabled,true);assert.ok(calls.some(x=>x.sql.includes('FROM public.mvp_services_catalog WHERE')));
 assert.equal(calls.some(x=>x.sql.includes('FROM public.mvp_services_reference')),false);
});
test('MS2 shared gate, duplicates, revision and replay',async()=>{
 let phase='LEGACY',dup=false,prior=null;const calls=[];
 const db={async query(sql,args){calls.push({sql,args});
  if(sql.includes('FROM public.mvp_masters_services_authority'))return {rows:[{...authority,phase}]};
  if(sql.startsWith('SELECT payload_sha256'))return {rows:prior?[prior]:[]};
  if(sql.startsWith('SELECT revision'))return {rows:[{revision:1}]};
  if(sql.startsWith('SELECT service_id'))return {rows:dup?[row]:[]};
  if(sql.startsWith('INSERT INTO public.mvp_services_catalog_sequences'))return {rows:[{year:2026,last_value:61}]};
  if(sql.startsWith('INSERT INTO public.mvp_services_catalog('))return {rows:[row]};
  if(sql.startsWith('UPDATE public.mvp_services_catalog SET'))return {rows:[{...row,revision:2}]};
  if(sql.startsWith('INSERT INTO public.mvp_services_catalog_requests'))prior={payload_sha256:args[1],response:JSON.parse(args[2])};
  return {rows:[]};},release(){}};
 const pool={connect:async()=>db},save=p=>servicesCatalogSave({pool,p,key,AppError});
 await assert.rejects(save(good),e=>e.status===409);assert.ok(calls.some(x=>x.sql==='ROLLBACK'));assert.equal(calls.some(x=>x.sql.startsWith('INSERT')),false);
 phase='CLEAN';dup=true;await assert.rejects(save(good),e=>e.status===409);
 dup=false;const made=await save(good);assert.equal(made.entityId,row.service_id);calls.length=0;assert.deepEqual(await save(good),made);assert.equal(calls.some(x=>x.sql.startsWith('INSERT')),false);
 await assert.rejects(save({...good,serviceName:'Other'}),e=>e.status===409);
 prior=null;await assert.rejects(save({...good,serviceId:row.service_id,revision:2}),e=>e.status===409);
 const changed=await save({...good,serviceId:row.service_id,revision:1});assert.equal(changed.data.revision,2);
 const update=calls.find(x=>x.sql.startsWith('UPDATE public.mvp_services_catalog SET'));assert.doesNotMatch(update.sql.split(' WHERE ')[0],/source_|service_id=|created_at/);
 const guard=calls.find(x=>x.sql.startsWith('SELECT service_id'));assert.match(guard.sql,/NOT EXISTS \(SELECT 1 FROM public\.mvp_services_catalog own WHERE own\.service_id=\$1 AND own\.status='active'/);
});
test('MS2 UI escapes data and snapshot cannot grant writes',()=>{
 const state={page:{items:[{serviceId:'SRV-2026-0001',serviceName:'<script>',category:'A&B',defaultUnit:'item',status:'active'}],categories:['A&B'],writeEnabled:false,source:'VERIFIED_LEGACY_SNAPSHOT'},filters:{q:'',status:'active',category:'',action:''}};
 const html=renderServiceCatalog(state);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/data-ms2-new disabled/);
 const ddl=readFileSync(new URL('../migrations/ms2_services_catalog_CANDIDATE_TEST_ONLY.sql',import.meta.url),'utf8');assert.match(ddl,/SELECT service_id,created_at,updated_at/);assert.doesNotMatch(ddl,/CREATE UNIQUE INDEX mvp_services_catalog_active_name/);assert.doesNotMatch(ddl,/UPDATE public\.mvp_services_reference|DELETE FROM public\.mvp_services_reference|UPDATE public\.mvp_masters_services_authority/);
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');assert.match(server,/\/api\/masters\/services\/save/);assert.match(server,/\/api\/reference\/services/);
});
