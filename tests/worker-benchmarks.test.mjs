import assert from 'node:assert/strict';
import test from 'node:test';
import {aggregateWorkerTaskObservations,workerBenchmarksRead} from '../worker-benchmarks.mjs';

const sample=(qty,minutes,more={})=>({status:'completed',task_type:'Прокладка трубы',result_unit:'м',result_qty:String(qty),duration_minutes:minutes,...more});

test('V9F: weighted productivity is total result per total time, not simple mean',()=>{
 const rows=[sample(12.5,90),sample(7.5,30,{task_type:'  ПРОКЛАДКА  ТРУБЫ ',result_unit:'М'}),sample(0,20),sample(123,30,{status:'active'}),sample(7,40,{result_unit:''})];
 const items=aggregateWorkerTaskObservations(rows);
 assert.equal(items.length,1);
 assert.equal(items[0].sampleCount,2);
 assert.equal(items[0].totalResult,20);
 assert.equal(items[0].totalMinutes,120);
 assert.equal(items[0].observedPerHour,10);
 assert.equal(items[0].bestPerHour,15);
 assert.equal(items[0].status,'OBSERVATION_ONLY');
 console.log('V9F_WEIGHTED_OBSERVED_SPEED_SOURCE_PARITY_PASS');
});

test('V9F: different units/types are not mixed',()=>{
 const items=aggregateWorkerTaskObservations([sample(2,60),sample(20,60,{result_unit:'шт'}),sample(5,30,{task_type:'Демонтаж'})]);
 assert.equal(items.length,3);
 assert.deepEqual(items.map(x=>x.observedPerHour).sort((a,b)=>a-b),[2,10,20]);
 console.log('V9F_DISTINCT_UNITS_AND_TYPES_PASS');
});

test('V9F: validation and hard fail-closed on over 500 rows',async()=>{
 const wid='11111111-1111-4111-8111-111111111111';
 const AppError=class extends Error{constructor(status,msg){super(msg);this.status=status;}};
 const deps={
  uuid:x=>{if(x!==wid)throw new AppError(400,'UUID');return x;},
  safeDate:x=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(x)||Number.isNaN(Date.parse(x+'T00:00:00Z')))throw new AppError(400,'Date');return x;},
  dayYerevan:()=> '2026-11-04',AppError
 };
 const pool={query:async(sql)=>sql.startsWith('SELECT id FROM public.mvp_workers')?{rows:[{id:wid}]}:{rows:[sample(2,30)]}};
 const u=new URL('https://example.invalid/api/worker-benchmarks?workerId='+wid+'&from=2026-11-03&to=2026-11-04');
 const r=await workerBenchmarksRead(pool,u,deps);
 assert.equal(r.source,'CLEAN_WORKER_TASKS_ONLY');
 assert.equal(r.isApprovedBenchmark,false);
 assert.equal(r.isPayrollBasis,false);
 assert.equal(r.legacyHistoryImported,false);
 assert.equal(r.items[0].observedPerHour,4);
 await assert.rejects(workerBenchmarksRead(pool,new URL('https://example.invalid/api/worker-benchmarks?workerId='+wid+'&from=2026-11-05&to=2026-11-04'),deps),e=>e.status===400);
 await assert.rejects(workerBenchmarksRead(pool,new URL('https://example.invalid/api/worker-benchmarks'),deps),e=>e.status===400);
 const capped={query:async(sql)=>sql.startsWith('SELECT id FROM public.mvp_workers')?{rows:[{id:wid}]}:{rows:Array.from({length:501},()=>sample(1,30))}};
 await assert.rejects(workerBenchmarksRead(capped,u,deps),e=>e.status===409);
 console.log('V9F_EXACT_WINDOW_VALIDATION_AND_NO_PARTIAL_AGGREGATION_PASS');
});

test('V9F2: equal nonoverlapping comparison by normalized work type and unit',async()=>{
 const wid='11111111-1111-4111-8111-111111111111';
 const AppError=class extends Error{constructor(status,msg){super(msg);this.status=status;}};
 const deps={uuid:x=>x,safeDate:x=>x,dayYerevan:()=> '2026-11-04',AppError};
 const queries=[];
 const pool={query:async(sql,params)=>{
  if(sql.startsWith('SELECT id FROM public.mvp_workers'))return {rows:[{id:wid}]};
  queries.push(params);
  if(params[1]==='2026-11-01')return {rows:[sample(20,120),sample(1,30,{result_unit:'шт'})]};
  if(params[1]==='2026-10-28')return {rows:[sample(5,60,{task_type:'  ПРОКЛАДКА ТРУБЫ  ',result_unit:'М'})]};
  return {rows:[]};
 }};
 const url=new URL('https://example.invalid/api/worker-benchmarks?workerId='+wid+'&from=2026-11-01&to=2026-11-04&compare=previous');
 const r=await workerBenchmarksRead(pool,url,deps);
 assert.equal(r.compareMode,'previous');
 assert.equal(r.previousFrom,'2026-10-28');assert.equal(r.previousTo,'2026-10-31');
 assert.equal(queries.length,2);
 assert.equal(r.sampleCount,2);assert.equal(r.previousSampleCount,1);
 const metres=r.items.find(i=>i.resultUnit==='м');
 assert.equal(metres.previousSampleCount,1);assert.equal(metres.previousObservedPerHour,5);
 assert.equal(metres.observedPerHour,10);assert.equal(metres.observedChangePct,100);
 const pieces=r.items.find(i=>i.resultUnit==='шт');
 assert.equal(pieces.previousSampleCount,0);
 assert.equal(pieces.previousObservedPerHour,null);assert.equal(pieces.observedChangePct,null);
 await assert.rejects(workerBenchmarksRead(pool,new URL(String(url).replace('compare=previous','compare=invalid')),deps),e=>e.status===400);
 console.log('V9F2_EQUAL_NONOVERLAPPING_PERIOD_NORMALIZED_GROUP_COMPARE_NO_BASELINE_PASS');
});

test('V9F2: previous-window overflow fails closed',async()=>{
 const wid='11111111-1111-4111-8111-111111111111';
 const AppError=class extends Error{constructor(status,msg){super(msg);this.status=status;}};
 let n=0;
 const pool={query:async(sql)=>{
  if(sql.startsWith('SELECT id FROM public.mvp_workers'))return {rows:[{id:wid}]};
  n++;return {rows:n===1?[sample(12.5,90)]:Array.from({length:501},()=>sample(2,60))};
 }};
 await assert.rejects(workerBenchmarksRead(pool,new URL('https://example.invalid/api/worker-benchmarks?workerId='+wid+'&from=2026-11-01&to=2026-11-04&compare=previous'),
  {uuid:x=>x,safeDate:x=>x,dayYerevan:()=> '2026-11-04',AppError}),e=>e.status===409);
 console.log('V9F2_PREVIOUS_HISTORY_LIMIT_FAIL_CLOSED_PASS');
});
