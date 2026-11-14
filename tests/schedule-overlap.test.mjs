import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/schedule-overlap.js',import.meta.url),'utf8');
function scenario(){
 const ctx={
  data:{today:'2026-11-09'},
  schedule:{viewMode:'week',periodStart:'2026-11-09',periodEnd:'2026-11-15',
   calendarDayPolicy:{version:'CALENDAR_WORKING_DAY_V194_V195',
    policyVersion:'SHARED_CAPACITY_MON_SAT_MONTHLY_BANK_REVIEW_V2',
    periodStart:'2026-11-09',periodEnd:'2026-11-15',
    days:Object.fromEntries(Array.from({length:7},(_,i)=>['2026-11-'+String(9+i).padStart(2,'0'),i===6?'SUNDAY':'WORKING_DAY']))}},
  hourlySchedule:{loaded:true,items:[],viewMode:'week',
   periodStart:'2026-11-09',periodEnd:'2026-11-15'},
  hourlyReady:()=>ctx.hourlySchedule.loaded&&
   ctx.hourlySchedule.viewMode===ctx.schedule.viewMode&&
   ctx.hourlySchedule.periodStart===ctx.schedule.periodStart&&
   ctx.hourlySchedule.periodEnd===ctx.schedule.periodEnd,
  hourlyLocal:instant=>new Date(new Date(instant).getTime()+14400000).toISOString().slice(0,16),
  scheduleShiftDay:(key,n)=>new Date(Date.parse(key+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),
  esc:s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]))
 };
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {ctx,run:code=>vm.runInContext(code,ctx)};
}
const row=(start_at,end_at,status='planned')=>({start_at,end_at,status});
test('v1.8.6 two plans on same date is a coincidence, not verified time overlap',()=>{
 const {ctx,run}=scenario();
 ctx.hourlySchedule.items=[
  row('2026-11-10T05:00:00Z','2026-11-10T06:00:00Z'),
  row('2026-11-10T12:00:00Z','2026-11-10T13:00:00Z'),
  row('2026-11-12T05:00:00Z','2026-11-12T06:00:00Z'),
  row('2026-11-12T19:00:00Z','2026-11-13T05:00:00Z'),
  row('2026-11-11T05:00:00Z','2026-11-11T06:00:00Z','completed')
 ];
 assert.equal(run('scheduleOverlapCounts().get("2026-11-10")'),2);
 assert.equal(run('scheduleOverlapCounts().get("2026-11-11")'),0);
 assert.equal(run('scheduleOverlapCounts().get("2026-11-12")'),2);
 assert.equal(run('scheduleOverlapCounts().get("2026-11-13")'),1,'overnight plan continues to next day');
 assert.equal(run('scheduleOverlapCounts().get("2026-11-15")'),0,'Sunday is free when no planned item');
 const badge=run('scheduleOverlapBadge("2026-11-10",scheduleOverlapCounts())');
 assert.match(badge,/⚠ 2/);
 assert.match(badge,/Это сигнал для проверки, а не подтверждённая перегрузка/);
 assert.equal(run('scheduleOverlapBadge("2026-11-13",scheduleOverlapCounts())'),'');
 assert.equal(run('scheduleOverlapDays(scheduleOverlapCounts()).join(",")'),'2026-11-10,2026-11-12');
 assert.equal(run('scheduleFreeDays(scheduleOverlapCounts()).join(",")'),'2026-11-09,2026-11-11,2026-11-14');
 const toolbar=run('scheduleOverlapToolbar(scheduleOverlapCounts())+scheduleFreeToolbar(scheduleOverlapCounts())');
 assert.match(toolbar,/Совпадений дней: 2/);
 assert.match(toolbar,/← Совпадение/);
 assert.match(toolbar,/Свободный →/);
 assert.match(toolbar,/0 \/ 2/);
 assert.match(toolbar,/0 \/ 3/);
});
test('v1.8.7 and v1.8.8 wrap next and previous on only visible days',()=>{
 const {ctx,run}=scenario();
 ctx.hourlySchedule.items=[
  row('2026-11-10T05:00:00Z','2026-11-10T06:00:00Z'),
  row('2026-11-10T12:00:00Z','2026-11-10T13:00:00Z'),
  row('2026-11-12T05:00:00Z','2026-11-12T06:00:00Z'),
  row('2026-11-12T09:00:00Z','2026-11-12T10:00:00Z')
 ];
 assert.equal(run('scheduleOverlapNext(1,scheduleOverlapCounts())'),'2026-11-10');
 assert.equal(run('scheduleOverlapNext(1,scheduleOverlapCounts())'),'2026-11-12');
 assert.equal(run('scheduleOverlapNext(1,scheduleOverlapCounts())'),'2026-11-10');
 assert.equal(run('scheduleOverlapNext(-1,scheduleOverlapCounts())'),'2026-11-12');
 assert.equal(run('scheduleFreeNext(1,scheduleOverlapCounts())'),'2026-11-09');
 assert.equal(run('scheduleFreeNext(1,scheduleOverlapCounts())'),'2026-11-11');
 assert.equal(run('scheduleFreeNext(-1,scheduleOverlapCounts())'),'2026-11-09');
 run('resetScheduleOverlap()');
 assert.equal(run('scheduleOverlapActive'),'');
 assert.equal(run('scheduleFreeActive'),'');
 assert.equal(run('scheduleOverlapNext(-1,scheduleOverlapCounts())'),'2026-11-12',
  'original previous-from-unselected wraps to last');
 assert.equal(run('scheduleFreeNext(-1,scheduleOverlapCounts())'),'2026-11-14');
});
test('full source coverage is required; paged or stale period does not yield misleading free days',()=>{
 const {ctx,run}=scenario();
 ctx.hourlySchedule.loaded=false;
 assert.equal(run('scheduleOverlapCounts()'),null);
 assert.match(run('scheduleOverlapToolbar(scheduleOverlapCounts())'),/загружается или недоступно/);
 assert.equal(run('scheduleFreeToolbar(scheduleOverlapCounts())'),'');
 ctx.hourlySchedule.loaded=true;
 ctx.schedule.periodEnd='2026-11-22';
 assert.equal(run('scheduleOverlapCounts()'),null,'stale hourly response must not be used');
 ctx.schedule.periodEnd='2026-11-15';
 assert.equal(run('scheduleOverlapCounts().size'),7);
});


test('v1.9.4 Sunday, company day and past dates are never offered as free working days',()=>{
 const {ctx,run}=scenario();
 ctx.data.today='2026-11-13';
 assert.equal(run('scheduleFreeDays(scheduleOverlapCounts()).join(",")'),'2026-11-13,2026-11-14',
  'Mon–Sat future window only, not Sunday and past');
 ctx.data.today='2026-11-09';
 ctx.schedule.calendarDayPolicy.days['2026-11-14']='MONTHLY_REVIEW';
 assert.equal(run('scheduleFreeDays(scheduleOverlapCounts()).includes("2026-11-14")'),false);
 assert.equal(run('scheduleFreeDays(scheduleOverlapCounts()).includes("2026-11-15")'),false);
 ctx.schedule.calendarDayPolicy.version='UNKNOWN';
 assert.equal(run('scheduleFreeDays(scheduleOverlapCounts()).length'),0,'missing policy never implies free workdays');
});
