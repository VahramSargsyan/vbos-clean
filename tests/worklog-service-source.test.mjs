import test from 'node:test';
import assert from 'node:assert/strict';
import {readWorkLogServiceReferences,requireActiveWorkLogServiceTx} from '../worklog-service-source.mjs';
import {REFERENCE_BATCH,REFERENCE_SOURCE_MANIFEST,REFERENCE_SOURCE_MODIFIED} from '../service-reference.mjs';
class E extends Error{constructor(status,message){super(message);this.status=status;}}
function fixture({phase=null,catalog=phase==='CLEAN',prices=catalog,confirmed=true,verified=true,active=true,error=null}={}){
 const calls=[];
 const legacy={service_id:'SRV-2026-0001',status:'active'};
 const clean={service_id:'SRV-2026-0061',status:'active'};
 const db={async query(sql,args=[]){
  calls.push({sql,args});
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.startsWith('SET LOCAL'))return {rows:[]};
  if(sql.includes('to_regclass'))return {rows:[{authority_exists:phase!==null,catalog_exists:catalog,prices_exists:prices}]};
  if(sql.startsWith('SELECT phase'))return {rows:phase==='MISSING'?[]:[{phase,master_snapshot_hash:confirmed?'a'.repeat(64):null,dependency_receipt_hash:confirmed?'b'.repeat(64):null}]};
  if(sql.startsWith('SELECT 1 FROM public.mvp_service_reference_batches'))return {rows:verified?[{}]:[]};
  if(sql.includes('FROM public.mvp_services_catalog')){
   if(error)throw Object.assign(new Error('catalog unavailable'),{code:error});
   return {rows:active?[clean]:[],rowCount:active?1:0};
  }
  if(sql.includes('FROM public.mvp_services_reference'))return {rows:active?[legacy]:[],rowCount:active?1:0};
  throw Error('Unexpected SQL: '+sql);
 },release(){calls.push({sql:'RELEASE'});}};
 return {calls,db,pool:{async connect(){return db;}}};
}
test('before migration, only the verified legacy batch supplies WorkLog references',async()=>{
 const f=fixture();const r=await readWorkLogServiceReferences(f.pool,E);
 assert.equal(r.rows[0].service_id,'SRV-2026-0001');assert.equal(r.unavailable,false);
 assert.deepEqual(f.calls.find(x=>x.sql.startsWith('SELECT 1 FROM')).args,[REFERENCE_BATCH,REFERENCE_SOURCE_MANIFEST,REFERENCE_SOURCE_MODIFIED]);
 assert.deepEqual(f.calls.find(x=>x.sql.startsWith('SELECT service_id,')).args,[REFERENCE_BATCH]);
 assert.equal(f.calls.at(-2).sql,'COMMIT');assert.equal(f.calls.at(-1).sql,'RELEASE');
});
test('LEGACY with prepared catalogs still uses historical batch, locks authority',async()=>{
 const f=fixture({phase:'LEGACY',catalog:true});await requireActiveWorkLogServiceTx(f.db,'SRV-2026-0001',E);
 assert.match(f.calls.find(x=>x.sql.startsWith('SELECT phase')).sql,/FOR SHARE$/);
 assert.deepEqual(f.calls.at(-1).args,['SRV-2026-0001',REFERENCE_BATCH]);
 assert.match(f.calls.at(-1).sql,/status='active' AND batch_id=\$2/);
});
test('CLEAN uses canonical references and exact active ID under row lock; never falls back',async()=>{
 const f=fixture({phase:'CLEAN'});const r=await readWorkLogServiceReferences(f.pool,E);
 assert.equal(r.rows[0].service_id,'SRV-2026-0061');
 await requireActiveWorkLogServiceTx(f.db,'SRV-2026-0061',E);
 assert.match(f.calls.at(-1).sql,/mvp_services_catalog WHERE service_id=\$1 AND status='active' LIMIT 1 FOR SHARE/);
 assert.deepEqual(f.calls.at(-1).args,['SRV-2026-0061']);
 assert.ok(!f.calls.some(x=>x.sql.includes('mvp_services_reference WHERE')));
});
test('archive or unknown service is rejected; empty optional service performs no query',async()=>{
 const f=fixture({phase:'CLEAN',active:false});
 await requireActiveWorkLogServiceTx(f.db,'',E);assert.equal(f.calls.length,0);
 await assert.rejects(requireActiveWorkLogServiceTx(f.db,'SRV-2026-0001',E),{status:409});
});
test('invalid authority, partial CLEAN schema or unverified snapshot are unavailable, not stale fallback',async()=>{
 for(const cfg of [{phase:'CLEAN',confirmed:false},{phase:'CLEAN',prices:false},{phase:'MISSING',catalog:true},{catalog:true},{verified:false}]){
  const f=fixture(cfg);
  assert.deepEqual(await readWorkLogServiceReferences(f.pool,E),{rows:[],unavailable:true});
  assert.equal(f.calls.at(-2).sql,'ROLLBACK');assert.equal(f.calls.at(-1).sql,'RELEASE');
  await assert.rejects(requireActiveWorkLogServiceTx(f.db,'SRV-2026-0001',E),{status:503});
  assert.ok(!f.calls.some(x=>x.sql.startsWith('SELECT service_id')));
 }
});
test('missing canonical table during read is explicitly unavailable, never legacy fallback',async()=>{
 const f=fixture({phase:'CLEAN',error:'42P01'});
 assert.deepEqual(await readWorkLogServiceReferences(f.pool,E),{rows:[],unavailable:true});
 assert.ok(!f.calls.some(x=>x.sql.includes('mvp_services_reference WHERE')));
});
