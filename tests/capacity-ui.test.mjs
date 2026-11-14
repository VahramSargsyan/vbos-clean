import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const src=readFileSync(new URL('public/capacity.js',root),'utf8');
const app=readFileSync(new URL('public/app.js',root),'utf8');
const html=readFileSync(new URL('public/index.html',root),'utf8');
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fixture={version:'CAPACITY_SCHEDULE_V1',sourceCoverage:'SCHEDULE_ONLY_NOT_FULL_DURATION',bookingReady:false,
 timeBridgeVersion:'CALENDAR_TIME_ENGINE_MANUAL_V1121',
 time:{version:'v1.12.0',resolutionMode:'EXPLICIT_SOURCE_V1',durationSource:'MANUAL',
  readyForCapacity:true,coverage:'EXPLICIT_MANUAL_WORKING_DAYS',sourceStatus:'CONFIRMED_INPUT',
  sourceRef:'CALENDAR_CAPACITY_FINDER_V1121',durationWorkingDays:2},
 startDate:'2026-11-28',horizonEnd:'2027-01-31',durationWorkingDays:2,
 scheduleItemsConsidered:3,unplannedOrders:1,
 days:[{date:'2026-11-28',status:'BUSY',work:1,crm:1}],
 windows:[{start:'2026-12-01',end:'2026-12-02',durationWorkingDays:2,skippedDays:0,
 crmRemindersInside:1,freeWorkingDaysBefore:0,freeWorkingDaysAfter:3}]};
function context(){
 const events={requests:[],renders:0};
 const c={data:{today:'2026-11-10'},tab:'schedule',schedule:{selectedDay:'2026-11-10'},URLSearchParams,console,Date,
  esc:escape,fmt:x=>String(x),editText:(name,title,value,kind,attributes)=>'<label>'+escape(title)+
   '<input name="'+name+'" type="'+kind+'" value="'+escape(value)+'" '+attributes+'></label>',
  render:()=>{events.renders++},
  api:async url=>{events.requests.push(url);return fixture;}};
 vm.createContext(c);vm.runInContext(src,c,{filename:'capacity.js'});
 return {c,events};
}
test('Capacity script loads before app but finder lives only inside Calendar',()=>{
 assert.doesNotMatch(html,/data-tab="capacity"/);
 assert.match(html,/href="\/capacity.css"/);
 assert.match(html,/src="\/capacity.js"/);
 assert.ok(html.indexOf('/capacity.js')<html.indexOf('/app.js'));
 assert.doesNotMatch(app,/tab==='capacity'\?capacityView\(\)/);
 assert.match(app,/tab==='schedule'\?scheduleView\(\)/);
 assert.match(readFileSync(new URL('public/schedule.js',root),'utf8'),/s\+=capacityPanelView\(\);/);
 assert.match(app,/data-capacity-open-day/);
 assert.match(app,/f.id==='capacitySearch'/);
});
test('initial search form and no invented result',()=>{
 const {c}=context();
 const text=vm.runInContext('capacityPanelView()',c);
 assert.match(text,/Capacity · свободные окна/);
 assert.match(text,/id="capacityFinder"/);
 assert.match(text,/aria-label="Capacity в календаре"/);
 assert.match(text,/name="durationWorkingDays"/);
 assert.match(text,/1–60/);
 assert.doesNotMatch(text,/Вариант 1/);
});
test('loaded Capacity clearly disclaims booking and escapes untrusted failures',async()=>{
 const {c,events}=context();
 await vm.runInContext('loadCapacity()',c);
 assert.equal(events.requests.length,1);
 assert.equal(events.requests[0],'/api/capacity?startDate=2026-11-10&durationWorkingDays=3');
 assert.equal(vm.runInContext('capacity.loaded',c),false);
 // Fixture has a deliberately inconsistent duration so the fetch guard must reject it.
 assert.match(vm.runInContext('capacity.error',c),/Ответ Capacity/);
 assert.equal(vm.runInContext('capacity.result',c),null);
 vm.runInContext('capacity.durationWorkingDays=2;capacity.startDate="2026-11-28"',c);
 await vm.runInContext('loadCapacity()',c);
 const page=vm.runInContext('capacityPanelView()',c);
 assert.match(page,/Вариант 1/);
 assert.match(page,/Нераспланированных активных заказов: 1/);
 assert.match(page,/Это кандидаты, не бронирование/);
 assert.match(page,/data-capacity-open-day="2026-12-01"/);
 assert.match(page,/Показать день в календаре/);
 assert.match(page,/Запланировать сюда/);
 assert.match(page,/data-capacity-plan-start="2026-12-01"/);
 assert.match(page,/data-capacity-plan-end="2026-12-02"/);
 assert.match(page,/data-capacity-quick="1"/);
 assert.match(page,/data-capacity-quick="2"/);
 assert.match(page,/data-capacity-quick="3"/);
 assert.match(page,/data-capacity-quick="5"/);
 assert.match(page,/data-capacity-quick="7"/);
 assert.match(page,/aria-pressed="false"/);
 assert.doesNotMatch(page,/data-act="capacity_book"/);

 assert.doesNotMatch(page,/<h1>Capacity/);
 assert.doesNotMatch(page,/data-act="schedule_save"/);
 vm.runInContext('capacity.loaded=false;capacity.error="<script>evil</script>"',c);
 const error=vm.runInContext('capacityPanelView()',c);
 assert.match(error,/&lt;script&gt;evil&lt;\/script&gt;/);
 assert.doesNotMatch(error,/<script>evil/);
});


test('stale search responses cannot revive windows after calendar changes',async()=>{
 const {c}=context();
 let finish;
 c.api=()=>new Promise(resolve=>{finish=resolve;});
 const request=vm.runInContext('loadCapacity()',c);
 assert.equal(vm.runInContext('capacity.loading',c),true);
 vm.runInContext('invalidateCapacity()',c);
 assert.equal(vm.runInContext('capacity.loaded',c),false);
 finish(fixture);
 await request;
 assert.equal(vm.runInContext('capacity.result',c),null);
 assert.equal(vm.runInContext('capacity.loading',c),false);
 assert.match(vm.runInContext('capacityPanelView()',c),/id="capacitySearch"/);
});


test('exact WorkOrder v1.9.1/v1.9.2 context is validated and scoped, no booking',()=>{
 const {c}=context();
 const id='11111111-1111-4111-8111-111111111111';
 const object='33333333-3333-4333-8333-333333333333';
 const raw={version:'WORKORDER_CAPACITY_EXACT_V191_192',source:'MVP_ORDERS_OBJECTS_ID',
  orderId:id,objectId:object,title:'Работы <опасно>',objectName:'Объект <дом>',
  status:'open',plannedStartDate:'2026-11-28',bookingReady:false};
 c.raw=raw;c.expected=id;
 const valid=vm.runInContext('capacityExactWorkOrder(raw,expected)',c);
 assert.equal(valid?.orderId,id);
 assert.equal(valid?.objectId,object);
 assert.equal(valid?.plannedStartDate,'2026-11-28');
 c.order=valid;
 vm.runInContext('capacityWorkOrderContext=order;capacity.loaded=true;capacity.result='+JSON.stringify(fixture),c);
 const page=vm.runInContext('capacityPanelView()',c);
 assert.match(page,/Найти место для заказа/);
 assert.match(page,/data-capacity-clear-order/);
 assert.match(page,/Работы &lt;опасно&gt;/);
 assert.match(page,/Объект &lt;дом&gt;/);
 assert.match(page,/Выбрать даты →/);
 assert.match(page,/id="capacityResults" tabindex="-1"/);
 assert.match(page,/Найдено вариантов: 1/);
 assert.match(page,/Редактор плана откроется сразу перед календарём/);
 assert.doesNotMatch(page,/<опасно>|<дом>|capacity_book/);
 const invalid=(patch,idOverride=id)=>{
  c.raw={...raw,...patch};c.expected=idOverride;
  return vm.runInContext('capacityExactWorkOrder(raw,expected)',c);
 };
 assert.equal(invalid({},'22222222-2222-4222-8222-222222222222'),null,'exact ID required');
 assert.equal(invalid({objectId:''}),null,'missing canonical Object fails closed');
 assert.equal(invalid({status:'cancelled'}),null,'terminal order cannot be planned');
 assert.equal(invalid({status:'done'}),null,'finished order cannot be planned');
 assert.equal(invalid({plannedStartDate:'2026-02-30'}),null,'invalid planned date');
 assert.equal(invalid({bookingReady:true}),null,'capacity cannot be claimed bookable');
 assert.equal(invalid({version:'UNKNOWN'}),null,'unknown source refused');
 assert.equal(invalid({title:'<script>bad</script>',status:'active',plannedStartDate:null})?.title,'<script>bad</script>',
  'unknown date allowed; markup must escape owner data');
});


test('Time Engine v1.12.1 fact is required before Calendar displays search results',async()=>{
 const {c,events}=context();
 vm.runInContext('capacity.durationWorkingDays=2;capacity.startDate="2026-11-28"',c);
 await vm.runInContext('loadCapacity()',c);
 assert.equal(events.requests.length,1);
 assert.equal(vm.runInContext('capacity.time',c),undefined,'Time fact lives in the verified result only');
 let page=vm.runInContext('capacityPanelView()',c);
 assert.match(page,/Time Engine подтвердил 2 рабочих дней/);
 assert.match(page,/источник MANUAL/);
 assert.match(page,/Вариант 1/);
 const invalid=[{time:null},{time:{...fixture.time,readyForCapacity:false}},
  {time:{...fixture.time,durationWorkingDays:4}},
  {time:{...fixture.time,durationSource:'BENCHMARK'}},
  {timeBridgeVersion:'NOT_VERIFIED'}];
 for(const patch of invalid){
  c.api=async()=>({...fixture,...patch});
  vm.runInContext('capacity.loaded=false;capacity.result=null;capacity.error=""',c);
  await vm.runInContext('loadCapacity()',c);
  assert.equal(vm.runInContext('capacity.result',c),null);
  assert.match(vm.runInContext('capacityPanelView()',c),/Ответ Capacity не прошёл проверку источника/);
 }
});
