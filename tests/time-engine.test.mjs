import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveManualCalendarTimeV1120,timeEngineCapacityRead,
 TIME_ENGINE_V1120,CALENDAR_TIME_BRIDGE_V1121} from '../time-engine.mjs';

class TimeError extends Error{constructor(code,message){super(message);this.code=code;}}

test('legacy TimeEngine v1.12.0 MANUAL duration yields explicit verified fact, not labor estimate',()=>{
 for(const n of [1,2,3,5,7,14,30,60]){
  const t=resolveManualCalendarTimeV1120({durationSource:'MANUAL',durationWorkingDays:n},TimeError);
  assert.equal(t.version,TIME_ENGINE_V1120);
  assert.equal(t.resolutionMode,'EXPLICIT_SOURCE_V1');
  assert.equal(t.readyForCapacity,true);
  assert.equal(t.coverage,'EXPLICIT_MANUAL_WORKING_DAYS');
  assert.equal(t.durationWorkingDays,n);
  assert.equal(t.durationMinutes,null);
  assert.equal(t.durationHours,null);
  assert.equal(t.sourceRef,'CALENDAR_CAPACITY_FINDER_V1121');
  assert.equal(t.sourceStatus,'CONFIRMED_INPUT');
  assert.equal(t.capacityAuthority,'SharedCapacityDecision_v1_11_1');
  assert.equal(t.availabilityAuthority,'ScheduleItems');
 }
 for(const n of [null,undefined,'',0,61,-1,1.5,'1','60',NaN,Infinity]){
  assert.throws(()=>resolveManualCalendarTimeV1120({durationSource:'MANUAL',durationWorkingDays:n},TimeError),x=>x.code===400);
 }
 for(const source of ['RULE','BENCHMARK','CALIBRATED','LEARNED','BOGUS']){
  assert.throws(()=>resolveManualCalendarTimeV1120({durationSource:source,durationWorkingDays:2},TimeError),x=>x.code===400,
   'future or unverified source must not silently claim readyForCapacity');
 }
});

test('v1.12.1 bridge calls existing Shared Capacity exactly once, preserves booking=false',async()=>{
 let reads=0;
 const r=await timeEngineCapacityRead({durationSource:'MANUAL',durationWorkingDays:3},{
  AppError:TimeError,readCapacity:async days=>{
   reads++;assert.equal(days,3);
   return {version:'CAPACITY_SCHEDULE_V1',durationWorkingDays:3,
    sourceCoverage:'SCHEDULE_ONLY_NOT_FULL_DURATION',bookingReady:false,
    fit:'CANDIDATES_IN_SCHEDULE',windows:[{start:'2026-11-28',end:'2026-12-01'}]};
  }});
 assert.equal(reads,1);
 assert.equal(r.timeBridgeVersion,CALENDAR_TIME_BRIDGE_V1121);
 assert.equal(r.time.durationWorkingDays,r.durationWorkingDays);
 assert.equal(r.time.readyForCapacity,true);
 assert.equal(r.bookingReady,false);
 assert.equal(r.timeEngineRecommendation,'EARLIEST_REALISTIC_WINDOW_AVAILABLE');
 assert.equal(r.timeEngineFit,'CANDIDATES_IN_SCHEDULE');
 assert.equal(r.windows.length,1);
 const none=await timeEngineCapacityRead({durationWorkingDays:1},{
  AppError:TimeError,readCapacity:async days=>({version:'CAPACITY_SCHEDULE_V1',
   sourceCoverage:'SCHEDULE_ONLY_NOT_FULL_DURATION',bookingReady:false,
   durationWorkingDays:days,fit:'NO_CANDIDATES_IN_HORIZON',windows:[]})});
 assert.equal(none.timeEngineRecommendation,'NO_CONFIRMED_WINDOW_IN_HORIZON');
});

test('v1.12.1 refuses missing, fake, or contradicting Shared Capacity without fallback',async()=>{
 for(const wrong of [null,{},{
  version:'WRONG',sourceCoverage:'SCHEDULE_ONLY_NOT_FULL_DURATION',bookingReady:false,durationWorkingDays:2
 },{version:'CAPACITY_SCHEDULE_V1',sourceCoverage:'SCHEDULE_ONLY_NOT_FULL_DURATION',bookingReady:true,durationWorkingDays:2},
 {version:'CAPACITY_SCHEDULE_V1',sourceCoverage:'UNKNOWN',bookingReady:false,durationWorkingDays:2},
 {version:'CAPACITY_SCHEDULE_V1',sourceCoverage:'SCHEDULE_ONLY_NOT_FULL_DURATION',bookingReady:false,durationWorkingDays:3}]){
  await assert.rejects(()=>timeEngineCapacityRead({durationWorkingDays:2},{
   AppError:TimeError,readCapacity:async()=>wrong
  }),e=>e.code===503);
 }
 await assert.rejects(()=>timeEngineCapacityRead({durationWorkingDays:2},{AppError:TimeError}),e=>e.code===503);
 let calls=0;
 await assert.rejects(()=>timeEngineCapacityRead({durationSource:'RULE',durationWorkingDays:2},{
  AppError:TimeError,readCapacity:async()=>{calls++;return {};}}),e=>e.code===400);
 assert.equal(calls,0,'unsupported source never touches database');
});
