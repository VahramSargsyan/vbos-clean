import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeCalculationBatches,normalizeLineCalculation,validateCalculationBatches,resolveEstimateLineLinks,BRIDGE_RULES} from '../estimate-service-links.mjs';
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
