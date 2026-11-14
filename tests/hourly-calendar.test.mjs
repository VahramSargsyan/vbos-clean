import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {scheduleHourlyRead} from '../schedule-hourly.mjs';
class SourceError extends Error{constructor(status,message){super(message);this.status=status;}}
const js=readFileSync(new URL('../public/schedule-hourly.js',import.meta.url),'utf8');
const instance=(rows=[],fetcher=null)=>{
 const calls=[],ctx={Date,URLSearchParams,console,document:{querySelector:()=>null},data:{today:'2026-11-10'},
  tab:'schedule',schedule:{loaded:true,viewMode:'week',anchorDate:'2026-11-10',
   periodStart:'2026-11-09',periodEnd:'2026-11-15'},
  scheduleShiftDay:(key,n)=>new Date(Date.parse(key+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),
  render(){},esc:x=>String(x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),
  api:async url=>{calls.push(url);return fetcher?fetcher(url):{
   version:'LEGACY_CALENDAR_HOURLY_V1101',complete:true,viewMode:'week',
   periodStart:'2026-11-09',periodEnd:'2026-11-15',timezone:'Asia/Yerevan',
   workStart:'08:00',workEnd:'19:00',items:rows
  }}
 };
 vm.createContext(ctx);vm.runInContext(js,ctx);
 return {ctx,calls,eval:v=>vm.runInContext(v,ctx)};
};
const row=(kind,from,to,title='Проверка',item_type='Работа',order_id=null)=>({
 source_kind:kind,start_at:from,end_at:to,title,item_type,order_id,status:'planned'
});
test('legacy hour policy 08:00–19:00, gap before first event remains free',()=>{
 const items=[row('manual','2026-11-10T08:00:00Z','2026-11-10T09:00:00Z','Фирма')]; // 12:00–13:00 Yerevan
 const {ctx,eval:e}=instance();
 ctx.input=items;
 assert.deepEqual(Array.from(e('hourlyIntervalsFor(input,"2026-11-10")')).map(x=>[x.start,x.end]),[[720,780]]);
 const free=Array.from(e('hourlyFree(hourlyIntervalsFor(input,"2026-11-10"))')).map(x=>[x.start,x.end]);
 assert.deepEqual(free,[[480,720],[780,1140]]);
 assert.equal(e('hourlyClock(480)'),'08:00');
 assert.equal(e('hourlyClock(1140)'),'19:00');
});
test('overlap merges, cross-midnight carries into next period',()=>{
 const first=row('manual','2026-11-09T14:30:00Z','2026-11-10T05:00:00Z','Ночная работа');
 const second=row('work_order','2026-11-10T04:30:00Z','2026-11-10T06:00:00Z','Заказ');
 const {ctx,eval:e}=instance();ctx.rows=[first,second];
 assert.deepEqual(Array.from(e('hourlyMerged(hourlyIntervalsFor(rows,"2026-11-10"))')).map(x=>[x.start,x.end]),[[480,600]]);
 assert.deepEqual(Array.from(e('hourlyIntervalsFor(rows,"2026-11-09")')).map(x=>[x.start,x.end]),[[1110,1140]]);
});
test('same legacy semantic colors and Sunday day off',()=>{
 const {ctx,eval:e}=instance();
 ctx.rows=[
  row('crm','2026-11-10T04:00:00Z','2026-11-10T05:00:00Z'),
  row('manual','2026-11-10T05:00:00Z','2026-11-10T06:00:00Z','Дом','Личное'),
  row('manual','2026-11-10T06:00:00Z','2026-11-10T07:00:00Z','Компания'),
  row('manual','2026-11-10T07:00:00Z','2026-11-10T08:00:00Z','Заказ','Работа','uuid')
 ];
 assert.deepEqual(Array.from(e('hourlyIntervalsFor(rows,"2026-11-10")')).map(x=>x.kind),
  ['crm','personal','firm','client']);
 assert.equal(e('hourlyIntervalsFor(rows,"2026-11-15").length'),0);
 assert.match(e('hourlyDayView("2026-11-15")'),/Воскресенье/);
});
test('XSS title escaped, unreadable/partial source never shows free time',async()=>{
 const {ctx,eval:e}=instance([row('manual','2026-11-10T07:00:00Z','2026-11-10T08:00:00Z','<script>bad</script>')]);
 await e('loadHourlySchedule()');
 const html=e('hourlyDayView("2026-11-10")');
 assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<script>bad/);
 assert.match(html,/Свободно по часам/);
 assert.match(e('hourlyMiniFor("2026-11-10")'),/legacy-hour-firm/);
 e('invalidateHourlySchedule()');
 assert.doesNotMatch(e('hourlyDayView("2026-11-10")'),/Свободно по часам/);
});
test('foreign or incomplete read fails closed, late response discarded',async()=>{
 let resolve;
 const {ctx,eval:e}=instance([] ,()=>new Promise(r=>{resolve=r}));
 const pending=e('loadHourlySchedule()');
 e('invalidateHourlySchedule()');
 resolve({version:'LEGACY_CALENDAR_HOURLY_V1101',complete:true,viewMode:'week',
  periodStart:'2026-11-09',periodEnd:'2026-11-15',timezone:'Asia/Yerevan',
  workStart:'08:00',workEnd:'19:00',items:[]});
 await pending;
 assert.equal(e('hourlySchedule.loaded'),false);
 const bad=instance([] ,async()=>({complete:false,items:[]}));
 await bad.eval('loadHourlySchedule()');
 assert.equal(bad.eval('hourlySchedule.loaded'),false);
 assert.match(bad.eval('hourlyDayView("2026-11-10")'),/недоступна/);
});
test('backend uses canonical overlap-complete union and strict row cap',async()=>{
 const sql=[],pool={query:async(q,args)=>{sql.push({q,args});return {rows:[]};}},
 ctx={dayYerevan:()=> '2026-11-10',safeDate:v=>v,AppError:SourceError};
 const r=await scheduleHourlyRead(pool,new URL('https://x/api/schedule/hourly?viewMode=week&anchorDate=2026-11-10'),ctx);
 assert.equal(r.periodStart,'2026-11-09');
 assert.equal(r.periodEnd,'2026-11-15');
 assert.equal(r.complete,true);
 assert.ok(sql[0].q.includes('end_at > ($1::date'));
 assert.ok(sql[0].q.includes('start_at < (($2::date'));
 assert.ok(sql[0].q.includes('mvp_schedule_lead_items'));
 assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(sql[0].q));
 assert.deepEqual(sql[0].args,['2026-11-09','2026-11-15']);
 await assert.rejects(()=>scheduleHourlyRead({query:async()=>({rows:Array(2001).fill({})})},
  new URL('https://x/api/schedule/hourly'),ctx),e=>e.status===503);
 await assert.rejects(()=>scheduleHourlyRead(pool,new URL('https://x/api/schedule/hourly?viewMode=wrong'),ctx),
  e=>e.status===400);
});



test('legacy next slot first gap is not skipped and 15-minute today cursor is honored',()=>{
 const {ctx,eval:e}=instance();
 ctx.items=[row('manual','2026-11-10T08:00:00Z','2026-11-10T09:00:00Z')];
 const morning=e('hourlyNextSlot(items,"2026-11-10",60,new Date("2026-11-10T03:15:00Z"))');
 assert.equal(morning.date,'2026-11-10');
 assert.equal(morning.start,480);assert.equal(morning.end,540);
 const after=e('hourlyNextSlot(items,"2026-11-10",60,new Date("2026-11-10T08:07:00Z"))');
 assert.equal(after.date,'2026-11-10');
 assert.equal(after.start,780); // Today 12:07; 12:15 is inside 12–13 busy block, next free is 13–14
 assert.equal(after.end,840);
 const empty=e('hourlyNextSlot([],"2026-11-12",60,new Date("2026-11-10T08:07:00Z"))');
 assert.equal(empty.start,480);assert.equal(empty.date,'2026-11-12');
});
test('legacy next slot skips Sundays, handles cross-midnight jobs and bounded search',()=>{
 const {ctx,eval:e}=instance();
 ctx.busy=[row('manual','2026-11-14T03:30:00Z','2026-11-16T05:00:00Z')];
 const next=e('hourlyNextSlot(busy,"2026-11-14",60,new Date("2026-11-13T22:00:00Z"))');
 assert.equal(next.date,'2026-11-16');assert.equal(next.start,540);assert.equal(next.end,600);
 const sunday=e('hourlyNextSlot([],"2026-11-15",60,new Date("2026-11-15T03:00:00Z"))');
 assert.equal(sunday.date,'2026-11-16');assert.equal(sunday.start,480);
 const full=[];
 for(let i=0;i<=14;i++){
  const start=new Date(Date.parse('2026-11-11T00:00:00Z')+i*86400000).toISOString().slice(0,10);
  full.push(row('manual',start+'T04:00:00Z',start+'T15:00:00Z'));
 }
 ctx.full=full;
 assert.equal(e('hourlyNextSlot(full,"2026-11-11",60,new Date("2026-11-10T08:00:00Z"))'),null);
 assert.throws(()=>e('hourlyNextSlot([],"2026-11-11",495,new Date("2026-11-10T08:00:00Z"))'),/длительность/i);
});
test('existing canonical form helper renders old 30/60/120/240 and escape-safe notes',()=>{
 const {ctx,eval:e}=instance();
 ctx.scheduleLeadDraft=null;ctx.scheduleCapacityDraft=null;
 assert.match(e('hourlyManualPanelView()'),/data-hourly-duration="30"/);
 assert.match(e('hourlyManualPanelView()'),/data-hourly-duration="60"/);
 assert.match(e('hourlyManualPanelView()'),/data-hourly-duration="120"/);
 assert.match(e('hourlyManualPanelView()'),/data-hourly-duration="240"/);
 assert.match(e('hourlyManualPanelView()'),/data-hourly-category="Личное"/);
 ctx.bad='<img src=x onerror=alert(1)>';
 e('hourlyManual.note=bad');
 assert.doesNotMatch(e('hourlyManualPanelView()'),/<img src=x/);
 assert.match(e('hourlyManualPanelView()'),/&lt;img src=x/);
 ctx.scheduleCapacityDraft={start:'2026-11-10'};
 assert.equal(e('hourlyManualPanelView()'),'');
});
test('source search is pure, includes all overlapping owners and caps incomplete source',async()=>{
 const {scheduleHourlyNextSourceRead}=await import('../schedule-hourly.mjs');
 const queries=[],pool={query:async(sql,args)=>{queries.push({sql,args});return {rows:[]};}};
 const auth={dayYerevan:()=> '2026-11-10',safeDate:v=>v,AppError:SourceError};
 const r=await scheduleHourlyNextSourceRead(pool,new URL('https://x/api/schedule/hourly/search?startDate=2026-11-28'),auth);
 assert.equal(r.startDate,'2026-11-28');assert.equal(r.endDate,'2026-12-12');
 assert.equal(r.version,'LEGACY_HOURLY_NEXT_SOURCE_V1101');assert.equal(r.complete,true);
 assert.deepEqual(queries[0].args,['2026-11-28','2026-12-12']);
 assert.match(queries[0].sql,/mvp_schedule_lead_items/);
 assert.match(queries[0].sql,/end_at > \(\$1::date/);
 assert.doesNotMatch(queries[0].sql,/\b(?:INSERT|UPDATE|DELETE)\b/i);
 await assert.rejects(()=>scheduleHourlyNextSourceRead({
  query:async()=>({rows:Array(2001).fill({})})},
  new URL('https://x/api/schedule/hourly/search?startDate=2026-11-28'),auth),
  error=>error.status===503);
});
test('stale asynchronous next-slot result cannot restore a closed/new form',async()=>{
 let release;
 const {ctx,eval:e}=instance([],()=>new Promise(resolve=>{release=resolve}));
 ctx.scheduleLeadDraft=null;ctx.scheduleCapacityDraft=null;
 e('hourlyManual.open=true;hourlyManual.date="2026-11-10"');
 const ongoing=e('hourlyFindManual()');
 assert.equal(e('hourlyManual.loading'),true);
 e('resetHourlyManual()');
 release({version:'LEGACY_HOURLY_NEXT_SOURCE_V1101',startDate:'2026-11-10',
  endDate:'2026-11-24',complete:true,timezone:'Asia/Yerevan',
  source:'mvp_schedule_items+mvp_schedule_order_items+mvp_schedule_lead_items',items:[]});
 await ongoing;
 assert.equal(e('hourlyManual.slot'),null);
 assert.equal(e('hourlyManual.loading'),false);
});
