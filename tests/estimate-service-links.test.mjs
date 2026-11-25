import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeCalculationBatches,normalizeLineCalculation,validateCalculationBatches,resolveEstimateLineLinks,BRIDGE_RULES,estimatorBridgeAction,bridgeSnapshotManifest,importEstimatorBridgeSnapshotTx} from '../estimate-service-links.mjs';
class E extends Error{constructor(status,msg){super(msg);this.status=status;}}
const uuid=x=>{if(!/^[0-9a-f-]{36}$/.test(x))throw new E(400,'UUID');return x;};
const opts={uuid,AppError:E};
const fixture=()=>{
 const batch={id:randomUUID(),mode:'BATCH',sourcePackageSha256:'a'.repeat(64),inputSnapshot:{tariff:'ECONOM',cards:{BATH:{quantity:'2'}},config:{BATH:{install:true}}}};
 const raw={calculation:{batchId:batch.id,cardKey:'BATH',sourceAction:'FIXTURE_INSTALL',original:{description:'Synthetic install',quantity:'2.000',unit:'шт',unitPriceAMD:'500',priceMode:'OWNER_ENTERED'}}};
 const line={lineKey:randomUUID(),kind:'WORK',unit:'шт',...normalizeLineCalculation(raw,{kind:'WORK'},opts)};
 return {batch,line,raw};
};
test('legacy bridge semantics distinguish source action and catalog action',()=>{
 assert.deepEqual(BRIDGE_RULES.WATER,{actionCode:'CONNECT',unit:'point',quantityRule:'WATER_POINT_TOTAL'});
 assert.equal(BRIDGE_RULES.FIXTURE_INSTALL.actionCode,'INSTALL');
 assert.equal(BRIDGE_RULES.SEWER.quantityRule,'SEWER_POINT_COUNT');
 assert.deepEqual(normalizeLineCalculation({},{kind:'WORK'},opts),{});
});
test('snapshots have bounded IDs and cannot change or become orphaned',()=>{
 const {batch,line,raw}=fixture(),batches=normalizeCalculationBatches([batch],opts);
 validateCalculationBatches([line],batches,[],E);
 assert.throws(()=>validateCalculationBatches([line],[],[],E),e=>e.status===400);
 assert.throws(()=>validateCalculationBatches([line],batches,[{...batch,inputSnapshot:{tariff:'VIP'}}],E),e=>e.status===409);
 assert.throws(()=>normalizeLineCalculation(raw,{kind:'MATERIAL'},opts),e=>e.status===400);
 assert.throws(()=>normalizeLineCalculation({serviceId:'SRV-2026-0001'},{kind:'WORK'},opts),e=>e.status===400);
 assert.throws(()=>normalizeCalculationBatches([batch,batch],opts),e=>e.status===400);
});
test('historical service link survives catalog archival without live reads; changed unit is rejected',async()=>{
 const {line}=fixture(),serviceSnapshot={serviceId:'SRV-2026-0001',actionCode:'INSTALL',defaultUnit:'item'};
 const old={line_key:line.lineKey,calculation_context:line.calculation,service_id:serviceSnapshot.serviceId,service_snapshot:serviceSnapshot};
 const db={query:()=>{throw Error('historic read must not access catalog');}};
 const [saved]=await resolveEstimateLineLinks(db,[{...line,serviceId:old.service_id}],[old],E);
 assert.equal(saved.serviceId,old.service_id);assert.deepEqual(saved.serviceSnapshot,serviceSnapshot);
 await assert.rejects(()=>resolveEstimateLineLinks(db,[{...line,unit:'м',serviceId:old.service_id}],[old],E),e=>e.status===409);
 await assert.rejects(()=>resolveEstimateLineLinks(db,[{lineKey:line.lineKey,kind:'WORK'}],[old],E),e=>e.status===409);
 await assert.rejects(()=>resolveEstimateLineLinks(db,[line],[{line_key:line.lineKey}],E),e=>e.status===409);
 const [detached]=await resolveEstimateLineLinks(db,[{...line,serviceId:''}],[old],E);
 assert.equal(detached.serviceId,null);assert.equal(detached.actionCode,'INSTALL');
});

test('restorable batch shape and exact card association are checked',()=>{
 const {batch,line}=fixture();
 assert.throws(()=>normalizeCalculationBatches([{...batch,inputSnapshot:{tariff:'ECONOM',cards:[],config:{}}}],opts),e=>e.status===400);
 assert.throws(()=>normalizeCalculationBatches([{...batch,inputSnapshot:{tariff:'ECONOM',cards:{BATH:{quantity:'99'}},config:{BATH:{}}}}],opts),e=>e.status===400);
 assert.throws(()=>validateCalculationBatches([{...line,calculation:{...line.calculation,cardKey:'WC'}}],normalizeCalculationBatches([batch],opts),[],E),e=>e.status===400);
});
function sourceDb(phase,{status='active',actionCode='INSTALL',unit='item',missing=false}={}){
 const calls=[];
 const db={calls,query:async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.includes('to_regclass'))return {rows:[{authority_exists:true,catalog_exists:true,prices_exists:true}]};
  if(sql.includes('SELECT phase,master_snapshot_hash'))return {rows:[{phase,master_snapshot_hash:'a'.repeat(64),dependency_receipt_hash:'b'.repeat(64)}]};
  if(sql.includes('mvp_service_reference_batches'))return {rows:[{verified:1}]};
  if(sql.includes('mvp_estimator_service_bridges'))return {rows:missing?[]:[{service_id:'SRV-2026-9001'}]};
  if(sql.includes('FROM public.mvp_services_'))return {rows:[{service_id:'SRV-2026-9001',service_name:'Synthetic',category:'Synthetic',status,action_code:actionCode,default_unit:unit}]};
  if(['BEGIN','ROLLBACK'].includes(sql)||sql.startsWith('SET LOCAL'))return {rows:[]};
  throw Error(sql);
 },release(){}};
 return db;
}
test('exact local service source selected, no unsafe fallback, no inferred link',async()=>{
 const {line}=fixture();
 for(const phase of ['LEGACY','CLEAN']){
  const db=sourceDb(phase),[saved]=await resolveEstimateLineLinks(db,[line],[],E);
  assert.equal(saved.serviceId,'SRV-2026-9001');assert.equal(saved.actionCode,'INSTALL');
  assert.ok(db.calls.some(x=>x.sql.includes(phase==='CLEAN'?'FROM public.mvp_services_catalog':'FROM public.mvp_services_reference')));
  assert.ok(!db.calls.some(x=>x.sql.includes(phase==='CLEAN'?'FROM public.mvp_services_reference WHERE service_id':'FROM public.mvp_services_catalog WHERE service_id')));
 }
 for(const invalid of [{status:'archived'},{actionCode:'CONNECT'},{unit:'point'}])await assert.rejects(()=>resolveEstimateLineLinks(sourceDb('CLEAN',invalid),[line],[],E),e=>e.status===409);
 const [unlinked]=await resolveEstimateLineLinks(sourceDb('LEGACY',{missing:true}),[line],[],E);
 assert.equal(unlinked.serviceId,null);assert.equal(unlinked.actionCode,'INSTALL');
});
test('bridge writer denied before ledger or DML under LEGACY; offline import rejects bad manifest before queries',async()=>{
 const db=sourceDb('LEGACY');
 await assert.rejects(()=>estimatorBridgeAction({pool:{connect:async()=>db},p:{cardKey:'BATH',actionType:'FIXTURE_INSTALL',serviceId:'SRV-2026-9001'},key:randomUUID(),AppError:E}),e=>e.status===409);
 assert.ok(db.calls.some(x=>x.sql==='ROLLBACK'));
 assert.ok(!db.calls.some(x=>x.sql.includes('INSERT INTO')));
 const manifest=bridgeSnapshotManifest([{estimatorServiceBridgeId:'ESB-2026-9001',cardKey:'BATH'}],E);
 assert.match(manifest.sha256,/^[a-f0-9]{64}$/);
 await assert.rejects(()=>importEstimatorBridgeSnapshotTx({query(){throw Error('unexpected query');}},manifest.canonical,'0'.repeat(64),E),e=>e.status===409);
});

test('exact import replay verifies canonical projection and source, not just stored snapshot',async()=>{
 const rows=[{estimatorServiceBridgeId:'ESB-2026-9001',cardKey:'BATH',actionType:'FIXTURE_INSTALL',serviceId:'SRV-2026-9001',quantityRule:'ITEM_QUANTITY',status:'active',relationKey:'BATH|FIXTURE_INSTALL',notes:'synthetic'}];
 const m=bridgeSnapshotManifest(rows,E),base=sourceDb('LEGACY'),original=base.query;
 const projected={bridge_id:rows[0].estimatorServiceBridgeId,card_key:'BATH',action_type:'FIXTURE_INSTALL',service_id:rows[0].serviceId,quantity_rule:'ITEM_QUANTITY',status:'active',source_system:'LEGACY_RECONCILED',source_snapshot:m.canonical[0],source_manifest_sha256:m.sha256,archived_at:null};
 let stored=[projected];
 base.query=async(sql,args)=>{
  if(sql.startsWith('LOCK TABLE'))return {rows:[]};
  if(sql.startsWith('SELECT bridge_id,card_key'))return {rows:stored};
  if(sql.startsWith('INSERT INTO'))throw Error('replay must not write');
  return original(sql,args);
 };
 assert.deepEqual(await importEstimatorBridgeSnapshotTx(base,rows,m.sha256,E),{imported:0,deduplicated:true});
 for(const change of [{card_key:'WC'},{action_type:'WATER'},{service_id:'SRV-2026-9002'},{quantity_rule:'WATER_POINT_TOTAL'},{status:'archived'},{source_system:'CLEAN_NATIVE'},{archived_at:'2026-01-01'},{source_manifest_sha256:'0'.repeat(64)},{source_snapshot:{...projected.source_snapshot,notes:'changed'}}]){
  stored=[{...projected,...change}];
  await assert.rejects(()=>importEstimatorBridgeSnapshotTx(base,rows,m.sha256,E),e=>e.status===409);
 }
});
