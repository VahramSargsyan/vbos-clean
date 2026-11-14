import test from 'node:test';
import assert from 'node:assert/strict';
import {capacityProject,capacityRead,capacityCalendarDayPolicy} from '../capacity.mjs';

class CapacityError extends Error{constructor(code,message){super(message);this.code=code;}}
const project=(items,from='2026-11-28',end='2026-12-10',duration=2)=>
 capacityProject(items,{startDate:from,horizonEnd:end,durationWorkingDays:duration,AppError:CapacityError});
const row=(source_kind,start,end)=>({source_kind,status:'planned',start_at:start,end_at:end});

test('MON-SAT, last bank working day, 2-day window crosses both excluded days',()=>{
 const result=project([]);
 assert.equal(result.policyVersion,'SHARED_CAPACITY_MON_SAT_MONTHLY_BANK_REVIEW_V2');
 assert.equal(result.bookingReady,false);
 assert.equal(result.sourceCoverage,'SCHEDULE_ONLY_NOT_FULL_DURATION');
 assert.equal(result.days.find(x=>x.date==='2026-11-29').status,'SUNDAY');
 assert.equal(result.days.find(x=>x.date==='2026-11-30').status,'MONTHLY_REVIEW');
 assert.equal(result.days.find(x=>x.date==='2026-11-28').status,'OPEN_IN_SCHEDULE');
 assert.deepEqual(result.windows[0].workingDays,['2026-11-28','2026-12-01']);
 assert.equal(result.windows[0].skippedDays,2);
 assert.equal(result.windows[0].monthlyReviewDaysInside,1);
});
test('one CRM reminder nonblocking, two scheduled CRM reminders blocking',()=>{
 const crm=row('crm','2026-11-28T05:00:00.000Z','2026-11-28T05:30:00.000Z');
 const one=project([crm]);
 assert.equal(one.days[0].busy,false);
 assert.equal(one.days[0].crm,1);
 assert.equal(one.windows[0].crmRemindersInside,1);
 const two=project([crm,row('crm','2026-11-28T06:00:00.000Z','2026-11-28T06:30:00.000Z')]);
 assert.equal(two.days[0].status,'BUSY');
 assert.equal(two.windows[0].start,'2026-12-01');
});
test('manual and auto order plans block, cross-midnight interval counted on both dates',()=>{
 const manual=row('manual','2026-11-28T08:00:00.000Z','2026-11-28T09:00:00.000Z');
 const order=row('work_order','2026-12-01T18:30:00.000Z','2026-12-02T08:30:00.000Z');
 const result=project([manual,order]);
 assert.equal(result.days.find(x=>x.date==='2026-11-28').status,'BUSY');
 assert.equal(result.days.find(x=>x.date==='2026-12-01').busy,true);
 assert.equal(result.days.find(x=>x.date==='2026-12-02').busy,true);
 assert.equal(result.windows[0].start,'2026-12-03');
});
test('last banking day Dec 2026 is 30 because Dec 31 fixed holiday',()=>{
 const result=project([],'2026-12-29','2027-01-05',1);
 assert.equal(result.days.find(x=>x.date==='2026-12-30').status,'MONTHLY_REVIEW');
 assert.equal(result.days.find(x=>x.date==='2026-12-31').status,'OPEN_IN_SCHEDULE');
 assert.equal(result.days.find(x=>x.date==='2027-01-03').status,'SUNDAY');
});
test('duration 60 bounded and no windows when horizon too short',()=>{
 const many=project([],'2026-11-10','2027-05-31',60);
 assert.ok(many.windows.length>=1,'at least one 60-day window should fit the six-month horizon');
 assert.equal(many.windows[0].durationWorkingDays,60);
 assert.ok(many.windows[0].skippedDays>0);
 assert.equal(project([],'2026-11-28','2026-11-28',2).windows.length,0);
});
test('unknown and incomplete sources fail closed rather than return false availability',()=>{
 for(const list of [[{status:'completed',source_kind:'manual',start_at:'2026-11-28',end_at:'2026-11-29'}],
  [row('unknown','2026-11-28T05:00:00Z','2026-11-28T06:00:00Z')],
  [row('manual','broken','2026-11-28T05:00:00Z')]]){
  assert.throws(()=>project(list),e=>e.code===503);
 }
 assert.throws(()=>project(Array(2001).fill(row('crm','2026-11-28T05:00:00Z','2026-11-28T05:30:00Z'))),e=>e.code===503);
 assert.throws(()=>project([],'2026-11-28','2026-11-29',0),e=>e.code===400);
});
test('database read uses repeatable read / read only and rejects orphaned auto order',async()=>{
 const statements=[],client={async query(sql,args){
  statements.push(sql);
  if(sql.startsWith('SELECT source_kind'))return {rows:[]};
  if(sql.startsWith('SELECT count(*) FILTER'))return {rows:[{unplanned:2,broken:0}]};
  return {rows:[]};
 },release(){}};
 const pool={connect:async()=>client};
 const req=new URL('https://test/api/capacity?startDate=2026-11-28&durationWorkingDays=2');
 const ctx={dayYerevan:()=> '2026-11-10',safeDate:x=>x,AppError:CapacityError};
 const r=await capacityRead(pool,req,ctx);
 assert.equal(r.timeBridgeVersion,'CALENDAR_TIME_ENGINE_MANUAL_V1121');
 assert.equal(r.time.version,'v1.12.0');
 assert.equal(r.time.durationSource,'MANUAL');
 assert.equal(r.time.durationWorkingDays,2);
 assert.equal(r.time.readyForCapacity,true);
 assert.equal(r.time.sourceStatus,'CONFIRMED_INPUT');
 assert.equal(r.time.durationHours,null);
 assert.equal(r.bookingReady,false);
 assert.equal(r.windows[0].start,'2026-11-28');
 assert.equal(r.unplannedOrders,2);
 assert.ok(statements.some(x=>x.includes('REPEATABLE READ READ ONLY')));
 assert.ok(statements.some(x=>x.includes('COMMIT')));
 assert.ok(!statements.some(x=>/UPDATE |INSERT |DELETE /i.test(x)));
 const broken={connect:async()=>({...client,query:async sql=>sql.startsWith('SELECT count(*) FILTER')?{rows:[{unplanned:0,broken:1}]}:{rows:[]}})};
 await assert.rejects(()=>capacityRead(broken,req,ctx),e=>e.code===503);
});


test('legacy v1.9.4–v1.9.5 Calendar policy uses the same exclusive Capacity days',()=>{
 const p=capacityCalendarDayPolicy('2026-11-28','2026-12-03');
 assert.equal(p.version,'CALENDAR_WORKING_DAY_V194_V195');
 assert.equal(p.policyVersion,'SHARED_CAPACITY_MON_SAT_MONTHLY_BANK_REVIEW_V2');
 assert.equal(p.days['2026-11-28'],'WORKING_DAY','Saturday is usable');
 assert.equal(p.days['2026-11-29'],'SUNDAY','Sunday excluded and dim');
 assert.equal(p.days['2026-11-30'],'MONTHLY_REVIEW','Nov bank last working day green only');
 assert.equal(p.days['2026-12-01'],'WORKING_DAY');
 const actual=project([],'2026-11-28','2026-12-03',1);
 for(const [date,status] of Object.entries(p.days))
  assert.equal(actual.days.find(d=>d.date===date)?.status,status==='WORKING_DAY'?'OPEN_IN_SCHEDULE':status,
   'Calendar must not invent a second working-day policy');
 const christmas=capacityCalendarDayPolicy('2026-12-29','2027-01-01');
 assert.equal(christmas.days['2026-12-30'],'MONTHLY_REVIEW');
 assert.equal(christmas.days['2026-12-31'],'WORKING_DAY',
  'Bank holiday is not automatically a Capacity day off; legacy only excludes Sunday/company');
 assert.throws(()=>capacityCalendarDayPolicy('2026-02-30','2026-03-03'));
 assert.throws(()=>capacityCalendarDayPolicy('2026-11-28','2027-03-03'));
});
