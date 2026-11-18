import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const root=new URL('../',import.meta.url);
const script=readFileSync(new URL('public/app.js',root),'utf8');
const fullWorkLogScript=readFileSync(new URL('public/worklog-full-ui.js',root),'utf8');
const legacyMyWorkScript=readFileSync(new URL('public/workday-legacy-ui.js',root),'utf8');
const myWorkScript=readFileSync(new URL('public/my-work.js',root),'utf8');
const todayDashboardScript=readFileSync(new URL('public/today-dashboard.js',root),'utf8');
const presenceScript=readFileSync(new URL('public/presence.js',root),'utf8');
const ownerActivityScript=readFileSync(new URL('public/owner-activity.js',root),'utf8');
const scheduleScript=readFileSync(new URL('public/schedule.js',root),'utf8');
const capacityScript=readFileSync(new URL('public/capacity.js',root),'utf8');
const hourlyScheduleScript=readFileSync(new URL('public/schedule-hourly.js',root),'utf8');
const conflictGuardScript=readFileSync(new URL('public/schedule-conflicts.js',root),'utf8');
const overlapNavScript=readFileSync(new URL('public/schedule-overlap.js',root),'utf8');
const workersScript=readFileSync(new URL('public/workers.js',root),'utf8');
const a1Script=readFileSync(new URL('public/a1.js',root),'utf8');
const elements=new Map();
const docEvents={};
const element=key=>{
 if(!elements.has(key))elements.set(key,{
  hidden:false,textContent:'',className:'',dataset:{},
  classList:{toggle(){}},attrs:{},events:{},setAttribute(name,value){this.attrs[name]=value},focus(){this.focused=true},addEventListener(name,fn){this.events[name]=fn},querySelectorAll(){return [];},querySelector(){return {disabled:false}},
  reset(){},innerHTML:''
 });
 return elements.get(key);
};
const sandbox={
 document:{querySelector:element,body:element('body'),addEventListener(name,fn){docEvents[name]=fn}},
 window:{addEventListener(){}},
 navigator:{},
 crypto:{randomUUID},
 fetch:async()=>({ok:true,json:async()=>({setupRequired:true,installable:true})}),
 console,Intl,Date,URL,URLSearchParams,confirm:()=>true,alert:()=>{},
};
vm.createContext(sandbox);
vm.runInContext(a1Script,sandbox,{filename:'a1.js'});
vm.runInContext(presenceScript,sandbox,{filename:'presence.js'});
vm.runInContext(ownerActivityScript,sandbox,{filename:'owner-activity.js'});
vm.runInContext(scheduleScript,sandbox,{filename:'schedule.js'});
vm.runInContext(capacityScript,sandbox,{filename:'capacity.js'});
vm.runInContext(hourlyScheduleScript,sandbox,{filename:'schedule-hourly.js'});
vm.runInContext(conflictGuardScript,sandbox,{filename:'schedule-conflicts.js'});
vm.runInContext(overlapNavScript,sandbox,{filename:'schedule-overlap.js'});
vm.runInContext(workersScript,sandbox,{filename:'workers.js'});
vm.runInContext(fullWorkLogScript,sandbox,{filename:'worklog-full-ui.js'});
vm.runInContext(legacyMyWorkScript,sandbox,{filename:'workday-legacy-ui.js'});
vm.runInContext(myWorkScript,sandbox,{filename:'my-work.js'});
vm.runInContext(todayDashboardScript,sandbox,{filename:'today-dashboard.js'});
vm.runInContext(script,sandbox,{filename:'app.js'});

const id1='11111111-1111-4111-8111-111111111111';
const id2='22222222-2222-4222-8222-222222222222';
const object='33333333-3333-4333-8333-333333333333';
const today='2026-11-03';
const data={
 today,days:[],sessions:[],logs:[],leads:[],clients:[],
 objects:[{id:object,name:'Тестовый объект'}],
 orders:[
  {id:id1,object_id:object,title:'Прокладка труб',planned_on:today,status:'open',revision:1},
  {id:id2,object_id:object,title:'Завершённый заказ',planned_on:today,status:'done',revision:1}
 ]
};
function show(next=data){
 vm.runInContext('data='+JSON.stringify(next),sandbox);
 return vm.runInContext('todayView()',sandbox);
}
const html=show();
assert.match(html,/Сегодня · 2026-11-03/);
assert.match(html,/Требует внимания/);
assert.match(html,/План: сегодня \/ неделя/);
assert.match(html,/Бизнес сейчас/);
assert.match(html,/Ближайшие действия/);
assert.match(html,/data-today-route="myWork"/);
assert.match(html,/data-today-route="crm"/);
assert.match(html,/data-today-intent="newLead"/);
assert.match(html,/data-today-route="finance"/);
assert.match(html,/data-today-refresh/);
assert.doesNotMatch(html,/data-act="(?:work_start_order|log_create|session_start|day_open)"/,
 'Today is a command dashboard; writers belong to My Work');
console.log('TODAY_V1_LEGACY_COMMAND_CENTER_SEPARATES_MYWORK_ACTIONS_PASS');

const planItem={id:id2,title:'План <script>bad</script>',schedule_date:today,
 start_at:'2026-11-03T06:00:00Z',status:'planned',object_name:'Улица & город'};
const futureItem={...planItem,id:id1,title:'Осмотр в пятницу',schedule_date:'2026-11-06'};
const crmItem={leadId:id1,title:'Позвонить <img src=x onerror=alert(1)>',
 reason:'Просрочено',nextAction:'Уточнить заказ',nextActionLocal:'2026-11-03T09:00'};
const dashFixture={
 date:today,loaded:true,loading:false,errors:{},
 work:{today,todayTotals:{logCount:7,workMinutes:95},currentSession:null},
 crm:{version:'CRM07A_READ_ONLY',todayKey:today,coverage:{complete:true},openLeadCount:17,
  buckets:{overdue:{count:2},today:{count:3},noNext:{count:4},stale:{count:1}},
  priority:{count:1,items:[crmItem],coverage:{complete:true}}},
 plan:{viewMode:'week',anchorDate:today,periodStart:'2026-11-02',periodEnd:'2026-11-08',
  items:[planItem,futureItem],total:2,hasMore:false}
};
vm.runInContext('todayDashboard='+JSON.stringify(dashFixture),sandbox);
const ready=show();
assert.match(ready,/Позвонить &lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(ready,/План &lt;script&gt;bad&lt;\/script&gt;/);
assert.doesNotMatch(ready,/<img src=x|<script>bad/);
assert.match(ready,/Открытых обращений/);
assert.match(ready,/>17<\/strong>/);
assert.match(ready,/Работы записаны/);
assert.match(ready,/>95<\/strong>/);
assert.match(ready,/Осмотр в пятницу/);
assert.match(ready,/data-today-lead="/);
console.log('TODAY_V1_CANONICAL_CRM_SCHEDULE_WORKLOG_ESCAPED_BUSINESS_PULSE_PASS');

vm.runInContext('todayDashboard='+JSON.stringify({
 ...dashFixture,plan:{...dashFixture.plan,hasMore:true,total:70,items:[]}
}),sandbox);
assert.match(show(),/Список неполный/);
assert.match(show(),/первые 50 из 70/);
vm.runInContext('todayDashboard='+JSON.stringify({
 ...dashFixture,work:null,crm:null,errors:{work:'Нет доступа',crm:'Слишком много записей'}
}),sandbox);
const unavailable=show();
assert.match(unavailable,/Источник недоступен: Нет доступа/);
assert.match(unavailable,/Источник недоступен: Слишком много записей/);
assert.doesNotMatch(unavailable,/Открытых обращений/,'Unavailable source must not become zero');
vm.runInContext('todayDashboard='+JSON.stringify({...dashFixture,date:'2026-11-02'}),sandbox);
assert.match(show(),/Загружаю данные/,'Stale prior-day snapshot may not be shown');
console.log('TODAY_V1_PARTIAL_SOURCE_TRUNCATION_DATE_FAIL_CLOSED_PASS');

vm.runInContext('todayDashboard='+JSON.stringify({
 date:'',loaded:false,loading:false,work:null,crm:null,plan:null,errors:{}
}),sandbox);
const originalFetch=sandbox.fetch,requested=[];
sandbox.fetch=async url=>{
 requested.push(url);
 const payload=url.startsWith('/api/my-work')?dashFixture.work:
  url.startsWith('/api/crm/followups')?dashFixture.crm:dashFixture.plan;
 return {ok:true,json:async()=>payload};
};
await vm.runInContext('loadTodayDashboard()',sandbox);
assert.equal(requested.length,3,'read only existing authenticated source APIs');
assert.ok(requested.some(x=>x==='/api/my-work'));
assert.ok(requested.some(x=>x==='/api/crm/followups?limit=6'));
assert.ok(requested.some(x=>x.includes('viewMode=week')&&x.includes('anchorDate=2026-11-03')));
assert.equal(vm.runInContext('todayDashboard.loaded',sandbox),true);
assert.equal(vm.runInContext('todayDashboard.work.todayTotals.logCount',sandbox),7);
sandbox.fetch=originalFetch;
console.log('TODAY_V1_THREE_CANONICAL_READ_ONLY_ENDPOINTS_LOAD_PASS');
vm.runInContext('data='+JSON.stringify(data),sandbox);
assert.match(vm.runInContext('ordersView()',sandbox),/value="2026-11-03"/);
console.log('ORDER_FORM_DEFAULTS_PLANNED_DATE_TO_TODAY_PASS');
const sample=structuredClone(data);
sample.clients=[{id:id1,name:'Old name',phone:'123',notes:'Test',revision:2}];
sample.objects=[{id:object,name:'Old object',address:'Old address',notes:'Test',row_version:'12345',client_id:id1}];
vm.runInContext('data='+JSON.stringify(sample),sandbox);
assert.match(vm.runInContext('crmView()',sandbox),/data-act="lead_create"/);
assert.doesNotMatch(vm.runInContext('crmView()',sandbox),/data-act="client_(?:create|update)"/);
assert.match(vm.runInContext('clientsView()',sandbox),/data-act="client_create"/);
const clientList=vm.runInContext('clientsView()',sandbox);
assert.match(clientList,/data-act="client_create"/);
assert.match(clientList,/data-client-open="/);
assert.match(clientList,/class="client-list-phone">123/);
assert.doesNotMatch(clientList,/data-act="client_update"/);
vm.runInContext('clientDetailId='+JSON.stringify(id1),sandbox);
const clientDetail=vm.runInContext('clientsView()',sandbox);
assert.match(clientDetail,/data-client-back/);
assert.match(clientDetail,/data-act="client_update"/);
assert.match(clientDetail,/name="revision" value="2"/);
assert.match(clientDetail,/name="notes"/);
assert.match(clientDetail,/Объекты клиента/);
assert.match(clientDetail,/Заказы клиента/);
assert.match(clientDetail,/data-act="object_create"/);
assert.match(clientDetail,/name="clientId" value="/);
assert.match(clientDetail,/data-act="order_create"/);
assert.match(clientDetail,/data-client-portfolio-filter="objects"/);
assert.match(clientDetail,/data-client-portfolio-filter="orders"/);
assert.match(clientDetail,/Статус заказа/);
const clientPortfolioFixture={id:"11111111-1111-4111-8111-111111111111",counts:{objects:41,orders:5,activeOrders:2}};
vm.runInContext('clientPortfolio=clientPortfolioNew('+JSON.stringify(id1)+');'+
 'clientPortfolio.counts='+JSON.stringify(clientPortfolioFixture.counts)+';'+
 'clientPortfolio.objects.loaded=true;clientPortfolio.objects.items='+JSON.stringify([{id:object,client_id:id1,name:'Old object',address:'Old address'}])+';'+
 'clientPortfolio.orders.loaded=true;clientPortfolio.orders.items='+JSON.stringify([{id:id2,client_id:id1,object_id:object,title:'Old work order',status:'active',object_name:'Old object'}]),sandbox);
const portfolioClient=vm.runInContext('clientsView()',sandbox);
assert.match(portfolioClient,/data-client-portfolio-open="objects"/);
assert.match(portfolioClient,/data-client-portfolio-open="orders"/);
assert.match(portfolioClient,/>41<\/strong>/);
assert.match(portfolioClient,/>5<\/strong>/);
assert.match(portfolioClient,/>2<\/strong>/);
assert.match(clientDetail,/Клиент → объект → заказ/);
vm.runInContext('clientDetailId=null',sandbox);
const objectList=vm.runInContext('objectsView()',sandbox);
assert.match(objectList,/data-act="object_create"/);
assert.match(objectList,/data-record-open="objects"/);
assert.match(objectList,/Old address/);
assert.match(objectList,/Клиент: Old name/);
assert.doesNotMatch(objectList,/data-act="object_update"/);
vm.runInContext('objectDetailId='+JSON.stringify(object),sandbox);
const objectDetail=vm.runInContext('objectsView()',sandbox);
assert.match(objectDetail,/data-record-back/);
assert.match(objectDetail,/data-act="object_update"/);
assert.match(objectDetail,/name="rowVersion" value="12345"/);
vm.runInContext('objectDetailId=null',sandbox);
const ordersList=vm.runInContext('ordersView()',sandbox);
assert.match(ordersList,/data-act="order_create"/);
assert.match(ordersList,/data-record-open="orders"/);
assert.doesNotMatch(ordersList,/data-act="order_update"/);
assert.doesNotMatch(ordersList,/data-act="order_status"/);
vm.runInContext('orderDetailId='+JSON.stringify(id1),sandbox);
const orderDetail=vm.runInContext('ordersView()',sandbox);
assert.match(orderDetail,/data-act="order_update"/);
assert.match(orderDetail,/data-act="order_status"/);
assert.match(orderDetail,/name="revision" value="1"/);
vm.runInContext('orderDetailId=null',sandbox);
vm.runInContext('history.loaded=true;history.items='+JSON.stringify([{id:id2,order_id:id1,day_date:today,title:'Repaired',minutes:30,quantity:'2.000',unit:'m',notes:'ok',revision:1}]),sandbox);
const historyHtml=vm.runInContext('historyView()',sandbox);
assert.match(historyHtml,/data-act="log_update"/);
assert.match(historyHtml,/name="dayDate"/);
assert.match(historyHtml,/name="minutes"/);
console.log('CLIENT_OBJECT_ORDER_LIST_CARDS_AND_DETAIL_ONLY_EDIT_PASS');


const leadRow={id:id1,title:'Запрос В3',contact_name:'Контакт',phone:'777',notes:'Заметка',status:'new',revision:3};
const orderRow={id:id2,object_id:object,title:'Задание В3',planned_on:today,notes:'Примечание',status:'open',revision:4};
const editLead=vm.runInContext('leadEdit('+JSON.stringify(leadRow)+')',sandbox);
assert.match(editLead,/data-act="lead_update"/);
assert.match(editLead,/name="revision" value="3"/);
const editOrder=vm.runInContext('orderEdit('+JSON.stringify(orderRow)+')',sandbox);
assert.match(editOrder,/data-act="order_update"/);
assert.match(editOrder,/name="plannedOn"/);
assert.match(editOrder,/name="revision" value="4"/);
vm.runInContext('catalog.items='+JSON.stringify([leadRow])+';catalog.entity="leads";catalog.loaded=true',sandbox);
const catalogHtml=vm.runInContext('catalogView()',sandbox);
assert.match(catalogHtml,/id="catalogFilters"/);
assert.match(catalogHtml,/data-act="lead_update"/);
assert.match(catalogHtml,/Запрос В3/);
const injection={...leadRow,title:'<img src=x onerror=alert(1)>'};
vm.runInContext('catalog.items='+JSON.stringify([injection]),sandbox);
const safeSearch=vm.runInContext('catalogView()',sandbox);
assert.match(safeSearch,/&lt;img src=x/);
assert.doesNotMatch(safeSearch,/<img src=x/);
console.log('V3_CATALOG_MOBILE_RENDER_AND_ESCAPING_PASS');
vm.runInContext('catalog.entity="clients";catalog.loaded=true;catalog.items='+JSON.stringify(sample.clients),sandbox);
const clientCatalog=vm.runInContext('catalogView()',sandbox);
assert.match(clientCatalog,/data-client-open="/);
assert.doesNotMatch(clientCatalog,/data-act="client_update"/);
vm.runInContext('clientDetailId='+JSON.stringify(id1),sandbox);
assert.match(vm.runInContext('catalogView()',sandbox),/data-act="client_update"/);
vm.runInContext('clientDetailId=null',sandbox);
console.log('CATALOG_CLIENT_CARD_DETAIL_ONLY_EDIT_PASS');
vm.runInContext('catalog.entity="objects";catalog.loaded=true;catalog.items='+JSON.stringify([{...sample.objects[0],client_name:'Old name'}]),sandbox);
const objectCatalog=vm.runInContext('catalogView()',sandbox);
assert.match(objectCatalog,/data-record-open="objects"/);
assert.doesNotMatch(objectCatalog,/data-act="object_update"/);
vm.runInContext('objectDetailId='+JSON.stringify(object),sandbox);
assert.match(vm.runInContext('catalogView()',sandbox),/data-act="object_update"/);
vm.runInContext('objectDetailId=null',sandbox);
vm.runInContext('catalog.entity="orders";catalog.items='+JSON.stringify([{...orderRow,object_name:'Old object'}]),sandbox);
const orderCatalog=vm.runInContext('catalogView()',sandbox);
assert.match(orderCatalog,/data-record-open="orders"/);
assert.doesNotMatch(orderCatalog,/data-act="order_update"/);
assert.doesNotMatch(orderCatalog,/data-act="order_status"/);
vm.runInContext('orderDetailId='+JSON.stringify(id2),sandbox);
assert.match(vm.runInContext('catalogView()',sandbox),/data-act="order_update"/);
vm.runInContext('orderDetailId=null',sandbox);
const adversarial=vm.runInContext('objectListCard('+JSON.stringify({id:object,name:'<img src=x onerror=alert(1)>',address:'<script>',client_name:'Unsafe'})+')',sandbox);
assert.match(adversarial,/&lt;img src=x/);
assert.match(adversarial,/&lt;script&gt;/);
assert.doesNotMatch(adversarial,/<img/);
console.log('CATALOG_OBJECT_ORDER_CARDS_ESCAPE_DETAIL_ONLY_EDIT_PASS');


const markup=readFileSync(new URL('public/index.html',root),'utf8');
const styles=readFileSync(new URL('public/style.css',root),'utf8');
assert.match(markup,/<button id="menuToggle"[^>]*hidden[^>]*aria-controls="tabs"[^>]*aria-expanded="false"/);
assert.match(markup,/id="menuBackdrop"[^>]*hidden/);
assert.match(markup,/<nav id="tabs"[^>]*hidden>/);
assert.match(markup,/id="menuClose"/);
assert.match(markup,/data-tab="today"/);
assert.match(markup,/data-tab="catalog"/);
assert.match(markup,/data-tab="clients"/);
assert.match(markup,/data-tab="report"/);
assert.match(styles,/#tabs\[hidden\],#menuBackdrop\[hidden\]\{display:none!important\}/);
assert.match(styles,/#tabs\{position:fixed/);
element('#appPanel').hidden=false;
element('#tabs').hidden=true;
vm.runInContext("setMenuOpen(true,{restoreFocus:false})",sandbox);
assert.equal(element('#tabs').hidden,false);
assert.equal(element('#menuBackdrop').hidden,false);
assert.equal(element('#menuToggle').attrs['aria-expanded'],'true');
assert.equal(element('#menuToggle').attrs['aria-label'],'Закрыть меню');
docEvents.keydown({key:'Escape'});
assert.equal(element('#tabs').hidden,true);
assert.equal(element('#menuBackdrop').hidden,true);
assert.equal(element('#menuToggle').attrs['aria-expanded'],'false');
assert.equal(element('#menuToggle').focused,true);
element('#menuToggle').events.click();
assert.equal(element('#tabs').hidden,false);
element('#menuBackdrop').events.click();
assert.equal(element('#tabs').hidden,true);
element('#menuToggle').events.click();
element('#menuClose').events.click();
assert.equal(element('#tabs').hidden,true);
element('#menuToggle').events.click();
vm.runInContext('tab="today";data='+JSON.stringify(data),sandbox);
element('#tabs').events.click({target:{closest:sel=>sel==='[data-tab]'?{dataset:{tab:'report'}}:null}});
assert.equal(vm.runInContext('tab',sandbox),'report');
assert.equal(element('#tabs').hidden,true);
element('#appPanel').hidden=true;
vm.runInContext("setMenuOpen(true,{restoreFocus:false})",sandbox);
assert.equal(element('#tabs').hidden,true,'menu must stay closed when logged out');
console.log('V4_MOBILE_MENU_OPEN_CLOSE_ESC_OUTSIDE_NAV_AUTH_AND_ARIA_PASS');
element('#appPanel').hidden=false;
vm.runInContext('data='+JSON.stringify(sample)+';tab="clients";clientDetailId=null',sandbox);
await element('#content').events.click({target:{closest:sel=>sel==='button[data-client-open]'?{dataset:{clientOpen:id1}}:null}});
assert.equal(vm.runInContext('clientDetailId',sandbox),id1);
assert.match(element('#content').innerHTML,/data-act="client_update"/);
await element('#content').events.click({target:{closest:sel=>sel==='button[data-client-back]'?{}:null}});
assert.equal(vm.runInContext('clientDetailId',sandbox),null);
assert.doesNotMatch(element('#content').innerHTML,/data-act="client_update"/);
console.log('CLIENT_CARD_OPEN_BACK_INTERACTION_PASS');
vm.runInContext('data='+JSON.stringify(sample)+';tab="clients";clientDetailId='+JSON.stringify(id1)+';clientReturn=null',sandbox);
await element('#content').events.click({target:{closest:sel=>sel==='button[data-client-related]'?{dataset:{clientRelated:'objects',clientRelatedId:object}}:null}});
assert.equal(vm.runInContext('tab',sandbox),'objects');
assert.equal(vm.runInContext('objectDetailId',sandbox),object);
assert.match(element('#content').innerHTML,/← К карточке клиента/);
await element('#content').events.click({target:{closest:sel=>sel==='button[data-record-back]'?{}:null}});
assert.equal(vm.runInContext('tab',sandbox),'clients');
assert.equal(vm.runInContext('objectDetailId',sandbox),null);
assert.equal(vm.runInContext('clientDetailId',sandbox),id1);
assert.match(element('#content').innerHTML,/Объекты клиента/);
await element('#content').events.click({target:{closest:sel=>sel==='button[data-client-related]'?{dataset:{clientRelated:'orders',clientRelatedId:id1}}:null}});
assert.equal(vm.runInContext('tab',sandbox),'orders');
assert.equal(vm.runInContext('orderDetailId',sandbox),id1);
await element('#content').events.click({target:{closest:sel=>sel==='button[data-record-back]'?{}:null}});
assert.equal(vm.runInContext('tab',sandbox),'clients');
vm.runInContext('clientDetailId=null;clientReturn=null',sandbox);
const isolated=structuredClone(sample);
isolated.objects=[];isolated.orders=[];
vm.runInContext('data='+JSON.stringify(isolated)+';clientDetailId='+JSON.stringify(id1),sandbox);
const blankClient=vm.runInContext('clientsView()',sandbox);
assert.match(blankClient,/Для создания заказа сначала добавь объект этому клиенту/);
assert.doesNotMatch(blankClient,/data-act="order_create"/);
assert.match(blankClient,/data-act="object_create"/);
vm.runInContext('clientDetailId=null;data='+JSON.stringify(sample),sandbox);
console.log('CLIENT_HUB_LINKED_OBJECT_ORDER_OPEN_BACK_AND_CREATE_GATE_PASS');
vm.runInContext('data='+JSON.stringify(sample)+';tab="objects";objectDetailId=null',sandbox);
await element('#content').events.click({target:{closest:sel=>sel==='button[data-record-open]'?{dataset:{recordOpen:'objects',recordId:object}}:null}});
assert.equal(vm.runInContext('objectDetailId',sandbox),object);
assert.match(element('#content').innerHTML,/data-act="object_update"/);
await element('#content').events.click({target:{closest:sel=>sel==='button[data-record-back]'?{}:null}});
assert.equal(vm.runInContext('objectDetailId',sandbox),null);
assert.doesNotMatch(element('#content').innerHTML,/data-act="object_update"/);
vm.runInContext('tab="orders";orderDetailId=null',sandbox);
await element('#content').events.click({target:{closest:sel=>sel==='button[data-record-open]'?{dataset:{recordOpen:'orders',recordId:id1}}:null}});
assert.equal(vm.runInContext('orderDetailId',sandbox),id1);
assert.match(element('#content').innerHTML,/data-act="order_update"/);
await element('#content').events.click({target:{closest:sel=>sel==='button[data-record-back]'?{}:null}});
assert.equal(vm.runInContext('orderDetailId',sandbox),null);
assert.doesNotMatch(element('#content').innerHTML,/data-act="order_update"/);
console.log('OBJECT_ORDER_CARD_OPEN_BACK_INTERACTION_PASS');


const myWorkSample={
 today,day:{id:'44444444-4444-4444-8444-444444444444',day_date:today,status:'open'},
 currentSession:{id:'55555555-5555-4555-8555-555555555555',day_date:today,order_id:id1,order_title:'Прокладка труб',object_name:'Тестовый объект',object_address:'Армения',client_name:'Тест',started_at:'2026-11-03T08:00:00.000Z'},
 todayTotals:{logCount:1,workMinutes:72},
 todayLogs:[{id:id2,order_id:id1,order_title:'Прокладка труб',title:'Работа <img src=x onerror=alert(1)>',minutes:72,quantity:'2.000',unit:'м',notes:'Заметка'}],
 moreTodayLogs:false,todaySessions:[{id:'55555555-5555-4555-8555-555555555555',order_title:'Прокладка труб',started_at:'2026-11-03T08:00:00.000Z',ended_at:null,description:'В работе'}],
 moreTodaySessions:false,
 plannedOrders:[{id:id1,title:'Прокладка труб',object_name:'Тестовый объект',status:'active',planned_on:today}],
 morePlannedOrders:false,
 recentWorkdays:[{day_date:today,status:'open',log_count:1,work_minutes:72}],
 selectedOrderId:id1,
 contextOrder:{id:id1,title:'Прокладка труб',status:'active',object_id:object,object_name:'Тестовый объект',object_address:'Армения',client_id:id1,client_name:'Тест'},
 currentPresence:null,
 assignedWorkers:[{worker_id:id2,name:'Тестовый работник',role_title:'Монтажник',day_status:'open',arrival_at:today+'T08:30',active_count:1,completed_count:2,completed_minutes:120,latest_task_type:'Монтаж труб',latest_task_status:'completed',latest_result_qty:'3.500',latest_result_unit:'м',latest_outcome:'COMPLETED'}],
 moreAssignedWorkers:false,
 sources:{a1:'INDEPENDENT_API',physicalPresence:'INDEPENDENT_API',ownerBusinessTime:'INDEPENDENT_API'}
};
vm.runInContext('data='+JSON.stringify(data)+';myWork.snapshot='+JSON.stringify(myWorkSample),sandbox);
let workHtml=vm.runInContext('myWorkView()',sandbox);
assert.match(workHtml,/A1/);
assert.match(workHtml,/Бизнес-время владельца/);
assert.match(workHtml,/Физический приход и уход — отдельно от начала и окончания рабочего интервала/);
assert.match(workHtml,/data-act="session_stop"/);
assert.match(workHtml,/data-workflow-open="log"/);
assert.match(workHtml,/Тестовый работник/);
assert.match(workHtml,/время завершённых задач: 120 мин/);
assert.match(workHtml,/Последняя задача: Монтаж труб/);
assert.match(workHtml,/3.500 м/);
assert.match(workHtml,/id="myWorkOrderSelect"/);
assert.match(workHtml,/data-history-range="today" data-order-id="/);
assert.match(workHtml,/data-history-range="all" data-order-id="/);
assert.match(workHtml,new RegExp('name="orderId" value="'+id1+'"'));
assert.match(workHtml,/Последние рабочие дни/);
assert.match(workHtml,/&lt;img src=x onerror=alert\(1\)&gt;/);
assert.doesNotMatch(workHtml,/<img src=x/);
assert.doesNotMatch(workHtml,/data-act="work_start_order"/);
vm.runInContext('myWork.snapshot='+JSON.stringify({...myWorkSample,currentSession:null}),sandbox);
workHtml=vm.runInContext('myWorkView()',sandbox);
assert.doesNotMatch(workHtml,/data-act="work_start_order"/);
assert.match(workHtml,/data-act="session_start"/);
assert.match(workHtml,/data-workflow-open="finish"/);
vm.runInContext('myWork.snapshot='+JSON.stringify({...myWorkSample,currentSession:null,day:{status:'closed'}}),sandbox);
workHtml=vm.runInContext('myWorkView()',sandbox);
assert.doesNotMatch(workHtml,/data-act="work_start_order"/);
assert.doesNotMatch(workHtml,/data-workflow-open="finish"/);
assert.doesNotMatch(workHtml,/data-act="session_start"/);
vm.runInContext('myWork.snapshot='+JSON.stringify({...myWorkSample,currentSession:null,contextOrder:null,selectedOrderId:null}),sandbox);
workHtml=vm.runInContext('myWorkView()',sandbox);
assert.doesNotMatch(workHtml,/data-workflow-open="log"/,'no selected WorkOrder must not open a wrong WorkLog');
vm.runInContext('myWork.snapshot='+JSON.stringify({...myWorkSample,currentSession:null,currentPresence:{id:id2,object_id:object,order_id:id1,object_name:'Тестовый объект',day_date:today,arrived_at:'2026-11-03T08:00:00Z',revision:1}}),sandbox);
workHtml=vm.runInContext('myWorkView()',sandbox);
assert.match(workHtml,/data-act="presence_stop"/);
assert.doesNotMatch(workHtml,/data-act="presence_start"/);
assert.doesNotMatch(workHtml,/data-workflow-open="finish"/);
vm.runInContext('myWork.snapshot=null',sandbox);
assert.match(vm.runInContext('myWorkView()',sandbox),/Загружаю текущую работу/);

const legacyScriptMarkup=readFileSync(new URL('public/workday-legacy-ui.js',root),'utf8');
const legacyIndex=readFileSync(new URL('public/index.html',root),'utf8');
assert.ok(legacyIndex.indexOf('/worklog-full-ui.js')<legacyIndex.indexOf('/workday-legacy-ui.js'));
assert.ok(legacyIndex.indexOf('/workday-legacy-ui.js')<legacyIndex.indexOf('/my-work.js'));
assert.match(legacyScriptMarkup,/function workFlowModalHtml\(\)/);
assert.match(legacyScriptMarkup,/function workFlowModalSubmitDay\(form,kind\)/);
assert.match(legacyScriptMarkup,/aria-modal="true"/);
assert.match(legacyScriptMarkup,/A1 сегодня/);
assert.match(legacyScriptMarkup,/Завершить рабочий день/);
assert.match(legacyScriptMarkup,/workFlowModalClose\(\{force:true\}\)/);
vm.runInContext('myWork.snapshot='+JSON.stringify(myWorkSample)+';workFlowModalState.kind="log";workFlowModalState.orderId="'+id1+'";workFlowModalState.item=null',sandbox);
let legacyModal=vm.runInContext('workFlowModalHtml()',sandbox);
assert.match(legacyModal,/aria-modal="true"/);
assert.match(legacyModal,/data-act="work_log_full_create"/);
assert.match(legacyModal,/data-full-worklog-panel open/);
assert.match(legacyModal,/Сохранить работу/);
vm.runInContext('workFlowModalState.kind="finish";workFlowModalState.item=null;workFlowModalState.orderId=""',sandbox);
legacyModal=vm.runInContext('workFlowModalHtml()',sandbox);
assert.match(legacyModal,/Что сделано сегодня/);
assert.match(legacyModal,/Сначала заверши рабочий интервал/);
vm.runInContext('workFlowModalState.kind="start";workFlowModalState.item=null',sandbox);
legacyModal=vm.runInContext('workFlowModalHtml()',sandbox);
assert.match(legacyModal,/Начало рабочего дня \/ A1/);
assert.match(legacyModal,/data-workflow-day-start/);
vm.runInContext('myWork.snapshot='+JSON.stringify({...myWorkSample,currentSession:null})+
 ';workFlowModalState.kind="continue";workFlowModalState.item={source:"session_stop",orderTitle:"Прокладка труб"};workFlowModalState.orderId="'+id1+'"',sandbox);
let continuationHtml=vm.runInContext('workFlowModalHtml()',sandbox);
assert.match(continuationHtml,/Рабочий день продолжается/);
assert.match(continuationHtml,/Да, рабочий день продолжается/);
assert.match(continuationHtml,/Нет, на сегодня всё/);
assert.match(continuationHtml,/data-workflow-day-continues/);
assert.match(continuationHtml,/data-workflow-day-is-over/);
assert.match(continuationHtml,/A1 остаётся общей целью дня/);
assert.doesNotMatch(continuationHtml,/data-workflow-day-finish/);
vm.runInContext('workFlowModalState.item={source:"close_work_order",orderTitle:"Прокладка труб"}',sandbox);
continuationHtml=vm.runInContext('workFlowModalHtml()',sandbox);
assert.match(continuationHtml,/Заказ.*закрыт/);
assert.match(legacyScriptMarkup,/w\.day\?\.status!=='open'/);
assert.match(legacyScriptMarkup,/if\(!w\|\|w\.day\?\.status!=='open'\|\|w\.currentSession\)return false/);
assert.match(script,/if\(\['session_stop','close_work_order'\]\.includes\(type\)\)/);
assert.match(script,/workFlowContinuationPrompt\(/);
assert.match(script,/if\(keepDay\)\{/);
assert.match(script,/if\(endDay\)\{workFlowModalOpen\('finish'/);
vm.runInContext('workFlowModalState.kind=null',sandbox);
console.log('LEGACY_MY_WORK_DIALOG_OPEN_DAY_FULL_LOG_END_DAY_PARITY_STATIC_VM_PASS');
console.log('WORKDAY_MULTIPLE_ORDER_CONTINUATION_CHOICE_NO_AUTO_CLOSE_STATIC_VM_PASS');

assert.match(readFileSync(new URL('public/index.html',root),'utf8'),/data-tab="myWork"/);
const servedHtml=readFileSync(new URL('public/index.html',root),'utf8');
assert.ok(servedHtml.indexOf('/my-work.js')<servedHtml.indexOf('/app.js'));
console.log('MY_WORK_OBJECT_CONTEXT_DISTINCT_SOURCES_QUICK_LOG_AND_ESCAPED_UI_PASS');


const a1Record={
 id:'DA1-2026-11-03',date:'2026-11-03',goal:'Цель <img src=x onerror=alert(1)>',
 reason:'Почему <script>alert(1)</script>',status:'open',outcome:'',outcome_note:'',
 notes:'Заметка',revision:2
};
vm.runInContext('dailyA1='+JSON.stringify({date:today,item:a1Record})+';data='+JSON.stringify(data),sandbox);
let a1Html=vm.runInContext('a1Card()',sandbox);
assert.match(a1Html,/data-act="a1_save"/);
assert.match(a1Html,/data-act="a1_complete"/);
assert.match(a1Html,/name="revision" value="2"/);
assert.match(a1Html,/&lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(a1Html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(a1Html,/<script>|<img src/);
assert.match(vm.runInContext('todayView()',sandbox),/🎯 A1 — главная цель дня/);
vm.runInContext('myWork.snapshot='+JSON.stringify(myWorkSample),sandbox);
const newWorkHtml=vm.runInContext('myWorkView()',sandbox);
assert.match(newWorkHtml,/🎯 A1 — главная цель дня/);
vm.runInContext('dailyA1='+JSON.stringify({date:today,item:{...a1Record,status:'completed',outcome:'PARTIAL',outcome_note:'Половина'}}),sandbox);
a1Html=vm.runInContext('a1Card()',sandbox);
assert.match(a1Html,/Частично/);
assert.match(a1Html,/data-act="a1_reopen"/);
assert.doesNotMatch(a1Html,/data-act="a1_complete"/);
vm.runInContext('dailyA1='+JSON.stringify({date:today,item:null}),sandbox);
assert.match(vm.runInContext('a1Card()',sandbox),/Задать A1/);
assert.match(vm.runInContext('a1Card()',sandbox),/name="revision" value="0"/);
const htmlA1=readFileSync(new URL('public/index.html',root),'utf8');
assert.ok(htmlA1.indexOf('/a1.js')<htmlA1.indexOf('/app.js'));
console.log('V6_DAILY_A1_INDEPENDENT_TODAY_MYWORK_EDIT_OUTCOME_REOPEN_ESCAPED_UI_PASS');


const presenceSample={
 date:today,day:{id:'44444444-4444-4444-8444-444444444444',status:'open'},
 active:null,items:[],loaded:true,loading:false,hasMore:false,nextCursor:null
};
vm.runInContext('data='+JSON.stringify(data)+';presence='+JSON.stringify(presenceSample),sandbox);
let presenceHtml=vm.runInContext('presencePane()',sandbox);
assert.match(presenceHtml,/data-act="presence_start"/);
assert.match(presenceHtml,/name="objectId"/);
assert.match(presenceHtml,/name="arrivalTime"/);
assert.match(presenceHtml,/id="presenceFilters"/);
const visit={
 id:id2,object_id:object,object_name:'<img src=x onerror=alert(1)>',
 object_address:'Артём & К',client_name:'Тест',order_id:id1,order_title:'Запрос',day_date:today,
 status:'open',arrived_at:'2026-11-03T07:00:00.000Z',departed_at:null,revision:1,notes:'<script>alert(1)</script>'
};
vm.runInContext('presence='+JSON.stringify({...presenceSample,active:visit,items:[visit]}),sandbox);
presenceHtml=vm.runInContext('presencePane()',sandbox);
assert.match(presenceHtml,/data-act="presence_stop"/);
assert.match(presenceHtml,/data-act="presence_update"/);
assert.match(presenceHtml,/&lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(presenceHtml,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(presenceHtml,/<img src=x|<script>alert/);
assert.doesNotMatch(presenceHtml,/data-act="presence_start"/);
vm.runInContext('presence='+JSON.stringify({...presenceSample,items:[{...visit,status:'closed',departed_at:'2026-11-03T08:30:00.000Z'}],active:null,day:{status:'closed'}}),sandbox);
presenceHtml=vm.runInContext('presencePane()',sandbox);
assert.match(presenceHtml,/name="departureTime"/);
assert.doesNotMatch(presenceHtml,/data-act="presence_start"/);
const withPresence=vm.runInContext('myWorkView()',sandbox);
assert.match(withPresence,/Присутствие на объекте/);
assert.ok(withPresence.indexOf('Присутствие на объекте')<withPresence.indexOf('data-workflow-secondary'),
 'Main arrival/departure control must be visible before secondary details');
assert.match(withPresence,/История по объектам/,'Historical visits remain inside advanced details');
const presentHtml=readFileSync(new URL('public/index.html',root),'utf8');
assert.ok(presentHtml.indexOf('/presence.js')<presentHtml.indexOf('/my-work.js'));
console.log('V7_OBJECT_PRESENCE_MOBILE_START_STOP_EDIT_SEPARATION_XSS_PASS');


const activityItem={
 id:id2,date:today,status:'completed',activity_class:'BUSINESS_SYSTEM',
 summary:'Контакт <img src=x onerror=alert(1)>',notes:'Notes <script>alert(1)</script>',
 start_at:'2026-11-03T08:00:00.000Z',end_at:'2026-11-03T08:30:00.000Z',
 duration_minutes:30,revision:2,work_day_id:null,related_entity_type:'',related_entity_id:null
};
vm.runInContext('data='+JSON.stringify(data)+';ownerActivity='+JSON.stringify({
 date:today,active:null,items:[activityItem],totals:{ORGANIZATION:0,BUSINESS_SYSTEM:30},trackingSince:today,
 hasMore:false,loaded:true,loading:false
}),sandbox);
let activityHtml=vm.runInContext('ownerActivityPane()',sandbox);
assert.match(activityHtml,/data-act="owner_activity_start"/);
assert.match(activityHtml,/name="activityClass"/);
assert.match(activityHtml,/data-act="owner_activity_update"/);
assert.match(activityHtml,/data-act="owner_activity_archive"/);
assert.match(activityHtml,/&lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(activityHtml,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(activityHtml,/<script>alert|<img src=x/);
assert.match(activityHtml,/Пересечения с WorkLog/);
assert.match(activityHtml,/id="ownerActivityFilters"/);
vm.runInContext('ownerActivity.active='+JSON.stringify({...activityItem,status:'active',end_at:null,duration_minutes:null}),sandbox);
activityHtml=vm.runInContext('ownerActivityPane()',sandbox);
assert.match(activityHtml,/data-act="owner_activity_stop"/);
assert.doesNotMatch(activityHtml,/data-act="owner_activity_start"/);
assert.match(activityHtml,/после полуночи/);
const workWithActivity=vm.runInContext('myWorkView()',sandbox);
assert.match(workWithActivity,/Бизнес-время владельца/);
assert.match(workWithActivity,/Посещения объектов/);
const htmlV8=readFileSync(new URL('public/index.html',root),'utf8');
assert.ok(htmlV8.indexOf('/owner-activity.js')<htmlV8.indexOf('/my-work.js'));
assert.ok(htmlV8.indexOf('/owner-activity.js')<htmlV8.indexOf('/app.js'));
console.log('V8_OWNER_ACTIVITY_MOBILE_CLASS_STOP_ARCHIVE_ESCAPED_HISTORY_PASS');


const planFixture={
 viewMode:'week',anchorDate:today,selectedDay:today,periodStart:'2026-11-02',periodEnd:'2026-11-08',
 items:[{id:id1,source_kind:'manual',auto_source_key:'',status:'planned',schedule_date:today,
  start_at:'2026-11-03T05:00:00.000Z',end_at:'2026-11-03T06:00:00.000Z',
  item_type:'Работа',title:'Монтаж <demo>',notes:'Примечание & детали',
  object_id:object,object_name:'Тестовый объект',order_id:id2,order_title:'Тестовый заказ',revision:1}],
 total:1,nextCursor:null,hasMore:false,loaded:true,loading:false
};
vm.runInContext('data='+JSON.stringify(data)+';schedule='+JSON.stringify(planFixture),sandbox);
let scheduleHtml=vm.runInContext('scheduleView()',sandbox);
assert.match(scheduleHtml,/План работ/);
assert.match(scheduleHtml,/data-schedule-mode="week"/);
assert.match(scheduleHtml,/data-schedule-mode="month"/);
assert.match(scheduleHtml,/data-schedule-day="2026-11-03"/);
assert.match(scheduleHtml,/data-act="schedule_save"/);
assert.match(scheduleHtml,/data-act="schedule_archive"/);
assert.match(scheduleHtml,/Монтаж &lt;demo&gt;/);
assert.doesNotMatch(scheduleHtml,/Монтаж <demo>/);
vm.runInContext('schedule.items='+JSON.stringify([{...planFixture.items[0],status:'completed'}]),sandbox);
assert.match(vm.runInContext('scheduleView()',sandbox),/schedule-done/);
vm.runInContext('schedule.items='+JSON.stringify([{...planFixture.items[0],schedule_date:'2026-11-02'}]),sandbox);
assert.match(vm.runInContext('scheduleView()',sandbox),/schedule-overdue/);
vm.runInContext('schedule.items='+JSON.stringify([{...planFixture.items[0],object_id:'99999999-9999-4999-8999-999999999999'}]),sandbox);
assert.match(vm.runInContext('scheduleView()',sandbox),/Сохранённая связь \(вне текущего списка\)/);
const htmlV9=readFileSync(new URL('public/index.html',root),'utf8');
assert.match(htmlV9,/data-tab="schedule"/);
assert.ok(htmlV9.indexOf('/schedule.js')<htmlV9.indexOf('/app.js'));
assert.match(vm.runInContext('todayView()',sandbox),/data-today-route="schedule"/);
console.log('V9A_SCHEDULE_WEEK_MONTH_MOBILE_ESCAPING_RELATIONS_STATUS_PASS');


// V9A calendar alignment regression: month starts on actual weekday, Monday first.
const gridHtml=s=>s.match(/<div class="schedule-day-grid"[^>]*>([\s\S]*?)<\/div>/)?.[1]||'';
const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const regularGrid=gridHtml(vm.runInContext('scheduleView()',sandbox));
assert.ok(weekdays.every(x=>regularGrid.includes('>'+x+'</span>')),'weekday headers not visible');
assert.equal((regularGrid.match(/class="schedule-day-empty"/g)||[]).length,0,'week starts Monday without blanks');
vm.runInContext('schedule='+JSON.stringify({...planFixture,viewMode:'month',periodStart:'2026-11-01',periodEnd:'2026-11-30'}),sandbox);
const novemberGrid=gridHtml(vm.runInContext('scheduleView()',sandbox));
const firstDate=novemberGrid.indexOf('data-schedule-day="2026-11-01"');
assert.ok(firstDate>0,'November first date must render');
assert.equal((novemberGrid.slice(0,firstDate).match(/class="schedule-day-empty"/g)||[]).length,6,'November 1 2026 is Sunday, column seven');
assert.equal((novemberGrid.match(/data-schedule-day="/g)||[]).length,30,'November has 30 actionable days');
assert.match(novemberGrid,/data-schedule-day="2026-11-30"/);
vm.runInContext('schedule='+JSON.stringify({...planFixture,viewMode:'month',anchorDate:'2027-02-09',periodStart:'2027-02-01',periodEnd:'2027-02-28'}),sandbox);
const februaryGrid=gridHtml(vm.runInContext('scheduleView()',sandbox));
assert.equal((februaryGrid.match(/class="schedule-day-empty"/g)||[]).length,0,'February 1 2027 is Monday');
assert.equal((februaryGrid.match(/data-schedule-day="/g)||[]).length,28);
vm.runInContext('schedule='+JSON.stringify({...planFixture,viewMode:'month',anchorDate:'2028-02-09',periodStart:'2028-02-01',periodEnd:'2028-02-29'}),sandbox);
const leapGrid=gridHtml(vm.runInContext('scheduleView()',sandbox));
assert.equal((leapGrid.slice(0,leapGrid.indexOf('data-schedule-day="2028-02-01"')).match(/class="schedule-day-empty"/g)||[]).length,1,'Feb 1 2028 is Tuesday');
assert.equal((leapGrid.match(/data-schedule-day="/g)||[]).length,29,'Leap February has 29 actionable days');
console.log('V9A_CALENDAR_MONDAY_ALIGNMENT_NOV2026_WEEK_FEB2027_LEAP2028_PASS');


// V9B: order-owned automatic plans are clearly read-only, not editable manual entries.
const autoScheduleFixture={...planFixture.items[0],source_kind:'work_order',auto_source_key:'WORKORDER|'+id2,status:'planned'};
const renderedAuto=vm.runInContext('scheduleItemCard('+JSON.stringify(autoScheduleFixture)+')',sandbox);
assert.match(renderedAuto,/Из заказа/);
assert.match(renderedAuto,/в разделе «Заказы»/);
assert.doesNotMatch(renderedAuto,/data-act="schedule_save"/);
assert.doesNotMatch(renderedAuto,/data-act="schedule_archive"/);
const renderedManual=vm.runInContext('scheduleItemCard('+JSON.stringify(planFixture.items[0])+')',sandbox);
assert.match(renderedManual,/data-act="schedule_save"/);
console.log('V9B_AUTOPLAN_READ_ONLY_AND_MANUAL_SCHEDULE_EDIT_BOUNDARY_PASS');


// V9C worker screens, order staff links and manual schedule assignment are separate from WorkLog.
const workerUiFixture={id:'66666666-6666-4666-8666-666666666666',name:'<script>bad</script>',phone:'+374 91 777 222',role_title:'Монтажник',status:'active',notes:'Монтаж',revision:1};
const fixtureData={...data,workers:[workerUiFixture],workerOrderAssignments:[
 {id:'77777777-7777-4777-8777-777777777777',worker_id:workerUiFixture.id,order_id:id1,status:'active'}],
 manualPlanWorkers:[{plan_id:id2,worker_id:workerUiFixture.id,status:'active'}]};
vm.runInContext('data='+JSON.stringify(fixtureData),sandbox);
const workersPage=vm.runInContext('workersView()',sandbox);
assert.match(workersPage,/Исполнители/);
assert.match(workersPage,/data-act="worker_create"/);
assert.match(workersPage,/data-act="worker_update"/);
assert.match(workersPage,/&lt;script&gt;bad&lt;\/script&gt;/);
assert.doesNotMatch(workersPage,/<script>bad<\/script>/);
const assignedOrder=vm.runInContext('workerOrderPanel(data.orders[0])',sandbox);
assert.match(assignedOrder,/Исполнители заказа/);
assert.match(assignedOrder,/data-act="worker_remove_order"/);
assert.match(assignedOrder,/Снять с заказа/);
assert.match(assignedOrder,/&lt;script&gt;bad&lt;\/script&gt;/);
const unassignedOrder=vm.runInContext('workerOrderPanel({...data.orders[0],id:"88888888-8888-4888-8888-888888888888"})',sandbox);
assert.match(unassignedOrder,/data-act="worker_assign_order"/);
const manualFields=vm.runInContext('scheduleItemFields({id:data.orders[1].id,start_at:"2026-11-03T05:00:00Z",end_at:"2026-11-03T06:00:00Z",revision:1})',sandbox);
assert.match(manualFields,/name="workerId"/);
assert.match(manualFields,/Исполнитель \(необязательно\)/);
const calendarWithWorker=vm.runInContext('scheduleItemCard({id:data.orders[1].id,source_kind:"work_order",worker_names:"<script>bad</script>",status:"planned",schedule_date:"2026-11-03",start_at:"2026-11-03T05:00:00Z",end_at:"2026-11-03T06:00:00Z",title:"Проверка",item_type:"Работа",revision:1})',sandbox);
assert.match(calendarWithWorker,/Исполнители:/);
assert.match(calendarWithWorker,/&lt;script&gt;bad&lt;\/script&gt;/);
assert.doesNotMatch(calendarWithWorker,/data-act="schedule_save"/);
const workerIndex=readFileSync(new URL('public/index.html',root),'utf8');
assert.match(workerIndex,/data-tab="workers"/);
assert.ok(workerIndex.indexOf('/workers.js')<workerIndex.indexOf('/app.js'));
console.log('V9C_WORKERS_UI_AUTHORIZED_FORMS_ASSIGNMENTS_ESCAPE_AND_MOBILE_PASS');

// V9D: WorkerDay is not WorkLog, supports visible arrival/departure/corrections, escapes stored values.
const workerDayFixture={id:'99999999-9999-4999-8999-999999999999',worker_id:workerUiFixture.id,
 day_date:'2026-11-03',status:'open',arrival_at:'2026-11-03T09:00',departure_at:'',
 revision:1,notes:'<script>alert("x")</script>'};
vm.runInContext('data='+JSON.stringify({...fixtureData,
 orders:fixtureData.orders.map((o,i)=>i===0?{...o,status:'active'}:o),
 workerDays:[workerDayFixture],workerDayOrders:[{worker_day_id:workerDayFixture.id,work_order_id:id1,status:'active'}]}),sandbox);
const dayPanelHtml=vm.runInContext('workerDayPanel(data.workers[0])',sandbox);
assert.match(dayPanelHtml,/data-act="worker_day_depart"/);
assert.match(dayPanelHtml,/data-act="worker_day_correct"/);
assert.match(dayPanelHtml,/name="closeReasonCode"/);
assert.match(dayPanelHtml,/Приход и уход/);
assert.doesNotMatch(dayPanelHtml,/<script>alert/);
vm.runInContext('data='+JSON.stringify({...fixtureData,
 workerDays:[{...workerDayFixture,status:'closed',departure_at:'2026-11-03T18:00',close_reason_code:'activity_not_recorded'}],
 workerDayOrders:[{worker_day_id:workerDayFixture.id,work_order_id:id1,status:'active'}]}),sandbox);
const closedPanelHtml=vm.runInContext('workerDayPanel(data.workers[0])',sandbox);
assert.doesNotMatch(closedPanelHtml,/data-act="worker_day_depart"/);
assert.match(closedPanelHtml,/data-act="worker_day_correct"/);
assert.match(closedPanelHtml,/Завершена/);
assert.match(vm.runInContext('workersView()',sandbox),/worker-day-panel/);
console.log('V9D_WORKER_DAY_MOBILE_ATTENDANCE_CORRECTION_SEPARATION_ESCAPE_PASS');


// PLAN_DAY_WORKFLOW_V1 — bounded date agenda, canonical status filtering,
// exact-source WorkOrder/My Work handoff. Never create WorkLogs from a plan click.
const planLinkedOrder={...planFixture.items[0],id:id2,order_id:id1,order_status:'open',
 source_kind:'work_order',auto_source_key:'WORKORDER|'+id1,
 title:'Сантехника <b>план</b>',worker_names:'Мастер & напарник',status:'planned'};
const planCompleted={...planFixture.items[0],id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 title:'Готовый монтаж',status:'completed',order_id:null};
const planCancelled={...planFixture.items[0],id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 title:'Отменённая встреча',status:'cancelled',order_id:null};
const planAggregate={...planFixture,dayFilter:'all',items:[
 planLinkedOrder,planCompleted,planCancelled],total:3,error:''};
vm.runInContext('data='+JSON.stringify(data)+';schedule='+JSON.stringify(planAggregate),sandbox);
const planDayHtml=vm.runInContext('scheduleView()',sandbox);
assert.match(planDayHtml,/Фильтр плана на день/);
assert.match(planDayHtml,/data-schedule-filter="planned"/);
assert.match(planDayHtml,/3 пункта · 1 к выполнению · 1 выполнено · 1 отменено/);
assert.ok(planDayHtml.includes('data-schedule-work-order="'+id1+'"'));
assert.ok(planDayHtml.includes('data-schedule-open-order="'+id1+'"'));
assert.match(planDayHtml,/Сантехника &lt;b&gt;план&lt;\/b&gt;/);
assert.match(planDayHtml,/Мастер &amp; напарник/);
assert.doesNotMatch(planDayHtml,/<b>план<\/b>/);
assert.doesNotMatch(planDayHtml,/data-act="work_start_order"/);
assert.doesNotMatch(planDayHtml,/data-act="session_start"/);
const planWorkCard=vm.runInContext('scheduleItemCard('+JSON.stringify(planLinkedOrder)+')',sandbox);
assert.doesNotMatch(planWorkCard,/data-act="schedule_save"/);
assert.match(planWorkCard,/Время 09:00–10:00 условное/);
const terminalPlanCard=vm.runInContext('scheduleItemCard('+JSON.stringify({...planLinkedOrder,order_status:'done'})+')',sandbox);
assert.doesNotMatch(terminalPlanCard,/data-schedule-work-order/);
assert.match(terminalPlanCard,/data-schedule-open-order/);
console.log('PLAN_V1_EXACT_ORDER_WORK_HANDOFF_ESCAPING_NO_IMPLICIT_WRITES_PASS');

vm.runInContext('schedule.dayFilter="completed"',sandbox);
const onlyCompleted=vm.runInContext('scheduleView()',sandbox).match(/<section class="card"><h2>План на ([^<]*)<\/h2>([\s\S]*?)<\/section>/)?.[2];
assert.ok(onlyCompleted,'focused day card is present');
assert.match(onlyCompleted,/Готовый монтаж/);
assert.doesNotMatch(onlyCompleted,/Сантехника &lt;b&gt;план/);
assert.doesNotMatch(onlyCompleted,/Отменённая встреча/);
assert.match(onlyCompleted,/aria-pressed="true" class="primary">Выполнено/);
vm.runInContext('schedule.dayFilter="planned";schedule.hasMore=true;schedule.total=73',sandbox);
const partialPlan=vm.runInContext('scheduleView()',sandbox);
assert.match(partialPlan,/загружено 3 \(не все\)/);
assert.match(partialPlan,/По загруженной части плана:/);
assert.match(partialPlan,/Подсчёты по дню могут быть неполными/);
assert.match(partialPlan,/Показать ещё 50/);
vm.runInContext('schedule.items=[];schedule.dayFilter="completed"',sandbox);
assert.match(vm.runInContext('scheduleView()',sandbox),/остальная часть ещё не загружена/);
vm.runInContext('schedule.loaded=false;schedule.error="Сбой <script>bad<\/script>"',sandbox);
const planFailed=vm.runInContext('scheduleView()',sandbox);
assert.match(planFailed,/Не удалось загрузить план/);
assert.match(planFailed,/data-schedule-retry/);
assert.doesNotMatch(planFailed,/<script>bad<\/script>/);
console.log('PLAN_V1_FILTER_PAGED_COUNTS_AND_ERROR_FAIL_CLOSED_PASS');

const schedulePlanClick=element('#content').events.click;
assert.equal(typeof schedulePlanClick,'function');
const planFakeButton=(selector,attr,value)=>({target:{closest(query){
 return query===selector?{dataset:{[attr]:value}}:null;
}}});
vm.runInContext('tab="schedule";data='+JSON.stringify(data)+';schedule='+JSON.stringify(planAggregate)+
 ';loadMyWork=async()=>{};loadPresence=async()=>{};loadOwnerActivity=async()=>{};',sandbox);
await schedulePlanClick(planFakeButton('button[data-schedule-work-order]','scheduleWorkOrder',id1));
assert.equal(vm.runInContext('tab',sandbox),'myWork');
assert.equal(vm.runInContext('myWork.selectedOrderId',sandbox),id1);
assert.equal(vm.runInContext('myWork.loaded',sandbox),false);
vm.runInContext('tab="schedule";schedule.items='+JSON.stringify([{...planLinkedOrder,order_status:'done'}]),sandbox);
await schedulePlanClick(planFakeButton('button[data-schedule-work-order]','scheduleWorkOrder',id1));
assert.equal(vm.runInContext('tab',sandbox),'schedule','terminal order cannot be sent to work');
vm.runInContext('tab="schedule";data.orders=[];schedule.items='+JSON.stringify([planLinkedOrder])+
 ';loadCatalog=async()=>{catalog.loaded=true;};',sandbox);
await schedulePlanClick(planFakeButton('button[data-schedule-open-order]','scheduleOpenOrder',id1));
assert.equal(vm.runInContext('tab',sandbox),'catalog','missing bounded order uses exact-ID search');
assert.equal(vm.runInContext('catalog.entity',sandbox),'orders');
assert.equal(vm.runInContext('catalog.q',sandbox),id1);
console.log('PLAN_V1_CLICK_ROUTE_TO_MYWORK_TERMINAL_GUARD_EXACT_UUID_CATALOG_FALLBACK_PASS');


// CAPACITY_IN_PLAN_UX — owner-selected candidate stays in the one Plan screen,
// with no duplicate Capacity tab, no work start and no schedule mutation.
vm.runInContext('tab="schedule";data='+JSON.stringify(data)+
 ';schedule='+JSON.stringify(planAggregate)+
 ';capacity.result={windows:[{start:"2026-11-06"},{start:"2026-12-02"}]};capacity.loaded=true;',sandbox);
const calendarWithFinder=vm.runInContext('scheduleView()',sandbox);
assert.match(calendarWithFinder,/id="capacityFinder"/);
assert.match(calendarWithFinder,/id="capacitySearch"/);
assert.ok(calendarWithFinder.indexOf('schedule-day-grid')<calendarWithFinder.indexOf('capacityFinder'));
assert.ok(calendarWithFinder.indexOf('capacityFinder')<calendarWithFinder.indexOf('План на 2026-11-03'));
const beforeSelected=vm.runInContext('schedule.selectedDay',sandbox);
await schedulePlanClick(planFakeButton('button[data-capacity-open-day]','capacityOpenDay','2026-11-07'));
assert.equal(vm.runInContext('schedule.selectedDay',sandbox),beforeSelected,'unlisted candidate ignored');
await schedulePlanClick(planFakeButton('button[data-capacity-open-day]','capacityOpenDay','2026-11-06'));
assert.equal(vm.runInContext('tab',sandbox),'schedule');
assert.equal(vm.runInContext('schedule.selectedDay',sandbox),'2026-11-06');
vm.runInContext('loadSchedule=async()=>{schedule.loaded=true;};',sandbox);
await schedulePlanClick(planFakeButton('button[data-capacity-open-day]','capacityOpenDay','2026-12-02'));
assert.equal(vm.runInContext('tab',sandbox),'schedule');
assert.equal(vm.runInContext('schedule.selectedDay',sandbox),'2026-12-02');
assert.equal(vm.runInContext('schedule.anchorDate',sandbox),'2026-12-02');
assert.equal(vm.runInContext('schedule.viewMode',sandbox),'week');
assert.doesNotMatch(calendarWithFinder,/data-act="capacity_book"/);
console.log('CAPACITY_IN_PLAN_UX_EMBEDDED_CANDIDATE_NAVIGATION_NO_STANDALONE_WRITES_PASS');


// Legacy Google Calendar parity: quick presets only set the input; "Plan here"
// must merely prefill the normal Schedule form. It may never auto-create a plan.
vm.runInContext('tab="schedule";data='+JSON.stringify(data)+
 ';schedule='+JSON.stringify(planAggregate)+
 ';scheduleLeadDraft=null;scheduleCapacityDraft=null;capacity.durationWorkingDays=3;'+
 'capacity.loaded=true;capacity.result={windows:[{start:"2026-11-06",end:"2026-11-07"}]};',sandbox);
const oldLegacyView=vm.runInContext('scheduleView()',sandbox);
assert.match(oldLegacyView,/data-capacity-quick="1"/);
assert.match(oldLegacyView,/data-capacity-quick="2"/);
assert.match(oldLegacyView,/data-capacity-quick="3"/);
assert.match(oldLegacyView,/data-capacity-quick="5"/);
assert.match(oldLegacyView,/data-capacity-quick="7"/);
assert.match(oldLegacyView,/data-capacity-plan-start="2026-11-06"/);
assert.match(oldLegacyView,/data-capacity-plan-end="2026-11-07"/);
await schedulePlanClick(planFakeButton('button[data-capacity-plan-start]','capacityPlanStart','2026-11-07'));
assert.equal(vm.runInContext('scheduleCapacityDraft',sandbox),null,'invalid candidate cannot open editor');
await schedulePlanClick({target:{closest(query){
 if(query==='button[data-capacity-plan-start]')return {dataset:{capacityPlanStart:'2026-11-06',capacityPlanEnd:'2026-11-07'}};
 return null;
}}});
assert.equal(vm.runInContext('tab',sandbox),'schedule');
assert.equal(vm.runInContext('scheduleCapacityDraft.start',sandbox),'2026-11-06');
assert.equal(vm.runInContext('scheduleCapacityDraft.end',sandbox),'2026-11-07');
const prepared=vm.runInContext('scheduleView()',sandbox);
assert.match(prepared,/Capacity · запланировать выбранное окно/);
assert.match(prepared,/name="startAt"[^>]*value="2026-11-06T09:00"/);
assert.match(prepared,/name="endAt"[^>]*value="2026-11-07T10:00"/);
assert.match(prepared,/data-capacity-plan-draft/);
assert.match(prepared,/План НЕ сохранён/);
assert.match(prepared,/data-cancel-capacity-draft/);
assert.ok(!vm.runInContext('capacity.loading',sandbox),'no auto-write or search started by draft');
await schedulePlanClick(planFakeButton('button[data-cancel-capacity-draft]','x',''));
assert.equal(vm.runInContext('scheduleCapacityDraft',sandbox),null);
await schedulePlanClick(planFakeButton('button[data-capacity-quick]','capacityQuick','5'));
assert.equal(vm.runInContext('capacity.durationWorkingDays',sandbox),5);
assert.equal(vm.runInContext('capacity.result',sandbox),null,'old options invalidated when duration changes');
assert.doesNotMatch(vm.runInContext('scheduleView()',sandbox),/data-capacity-plan-start/);
console.log('CAPACITY_LEGACY_QUICK_PRESETS_PREFILL_ONLY_AND_EXPLICIT_SAVE_PASS');



// Exact Google Hourly v1.10.1 manual assistant stays in Plan, not a new writer.
vm.runInContext('tab="schedule";data='+JSON.stringify(data)+
 ';schedule='+JSON.stringify(planAggregate)+
 ';scheduleLeadDraft=null;scheduleCapacityDraft=null;resetHourlyManual();'+
 'hourlyFindManual=async()=>{hourlyManual.note="CI passive next-time lookup";};',sandbox);
const manualView=vm.runInContext('scheduleView()',sandbox);
assert.match(manualView,/data-hourly-add-day="2026-11-03"/);
assert.match(manualView,/data-hourly-new-editor/);
assert.match(manualView,/data-hourly-manual-form/);
assert.match(manualView,/data-hourly-duration="30"/);
assert.match(manualView,/data-hourly-duration="60"/);
assert.match(manualView,/data-hourly-duration="120"/);
assert.match(manualView,/data-hourly-duration="240"/);
assert.match(manualView,/data-hourly-find/);
assert.match(manualView,/data-schedule-status="planned"/);
assert.match(manualView,/data-hourly-category="Личное"/);
assert.match(manualView,/data-hourly-category="Организационное"/);
assert.doesNotMatch(manualView,/data-act="hourly_save"/);
const fakeManualClick=(selector,attr,value)=>({preventDefault(){},target:{closest(q){
 return q===selector?{dataset:{[attr]:value}}:null;
}}});
const manualEditorNode=element('details[data-hourly-new-editor][open]');
manualEditorNode.scrollIntoView=options=>{manualEditorNode.lastScroll=options;};
manualEditorNode.querySelector=()=>({focus(options){manualEditorNode.lastFocus=options;}});
await schedulePlanClick(fakeManualClick('button[data-hourly-add-day]','hourlyAddDay','2026-11-03'));
assert.equal(manualEditorNode.lastScroll?.block,'start','add-day tap reveals editor below day entries');
assert.equal(manualEditorNode.lastFocus?.preventScroll,true,'keyboard focus follows revealed editor');
assert.equal(vm.runInContext('hourlyManual.open',sandbox),true);
assert.equal(vm.runInContext('hourlyManual.date',sandbox),'2026-11-03');
const openManual=vm.runInContext('scheduleView()',sandbox);
assert.match(openManual,/data-hourly-new-editor open/);
assert.match(openManual,/name="startAt"[^>]*value="2026-11-03T09:00"/);
await schedulePlanClick(fakeManualClick('button[data-hourly-category]','hourlyCategory','Личное'));
assert.equal(vm.runInContext('hourlyManual.category',sandbox),'Личное');
assert.match(vm.runInContext('scheduleItemFields(null)',sandbox),/name="itemType"[^>]*value="Личное"/);
await schedulePlanClick(fakeManualClick('button[data-hourly-duration]','hourlyDuration','120'));
assert.equal(vm.runInContext('hourlyManual.duration',sandbox),120);
assert.equal(vm.runInContext('hourlyManual.slot',sandbox),null);
vm.runInContext('hourlyManual.slot={date:"2026-11-03",startAt:"2026-11-03T14:15",endAt:"2026-11-03T16:15"}',sandbox);
assert.match(vm.runInContext('scheduleItemFields(null)',sandbox),/name="startAt"[^>]*value="2026-11-03T14:15"/);
assert.match(vm.runInContext('scheduleItemFields(null)',sandbox),/name="endAt"[^>]*value="2026-11-03T16:15"/);
await schedulePlanClick(fakeManualClick('summary[data-hourly-new-summary]','anything',''));
assert.equal(vm.runInContext('hourlyManual.open',sandbox),false);
assert.equal(vm.runInContext('hourlyManual.slot',sandbox),null);
vm.runInContext('scheduleLeadDraft={date:"2026-11-06",title:"CRM"}',sandbox);
assert.doesNotMatch(vm.runInContext('scheduleView()',sandbox),/data-hourly-manual-form/);
vm.runInContext('scheduleLeadDraft=null;scheduleCapacityDraft={start:"2026-11-06",end:"2026-11-07"}',sandbox);
assert.doesNotMatch(vm.runInContext('scheduleView()',sandbox),/data-hourly-manual-form/);
console.log('LEGACY_HOURLY_NEW_PLAN_QUICK_DURATION_CATEGORY_ADD_DAY_CANONICAL_SAVE_BOUNDARY_PASS');

// V1H: direct Week/Month calendar actions reveal existing manual editor,
// prefill only allowed dates and never call a new save endpoint.
const rangeItem={...planFixture.items[0],
 id:'12345678-1234-4123-8123-123456789abc',source_kind:'manual',
 revision:3,status:'planned',start_at:'2026-11-03T05:00:00Z',end_at:'2026-11-03T06:00:00Z'};
const rangePlan={...planAggregate,loaded:true,loading:false,items:[rangeItem]};
vm.runInContext('tab="schedule";schedule='+JSON.stringify(rangePlan)+';data='+JSON.stringify(data)+';',sandbox);
const rangeButtons=vm.runInContext('scheduleItemCard('+JSON.stringify(rangeItem)+')',sandbox);
assert.equal((rangeButtons.match(/data-schedule-range-action=/g)||[]).length,5);
assert.match(rangeButtons,/data-schedule-range-delta="-1"/);
const rangeForm={elements:{id:{value:rangeItem.id},revision:{value:'3'},
 startAt:{value:'2026-11-03T09:00'},endAt:{value:'2026-11-03T10:00'}},
 querySelector:()=>null};
const rangeNotice={hidden:true,textContent:''};
const rangeSummary={scrollIntoView:opts=>{rangeSummary.scrollOptions=opts;},
 focus:opts=>{rangeSummary.focusOptions=opts;}};
const rangeDetails={open:false,querySelector:q=>({
 'form[data-act="schedule_save"]':rangeForm,
 '[data-schedule-range-notice]':rangeNotice,summary:rangeSummary
})[q]||null};
const rangeCard={querySelector:q=>q==='details.edit-panel'?rangeDetails:null};
const rangeButton={dataset:{scheduleRangeId:rangeItem.id,scheduleRangeAction:'shift',
 scheduleRangeDelta:'1'},closest:q=>q==='article.schedule-item'?rangeCard:null};
await schedulePlanClick({target:{closest:q=>q==='button[data-schedule-range-action]'?rangeButton:null}});
assert.equal(rangeDetails.open,true);
assert.equal(rangeForm.elements.startAt.value,'2026-11-04T09:00');
assert.equal(rangeForm.elements.endAt.value,'2026-11-04T10:00');
assert.equal(rangeSummary.scrollOptions.block,'start');
assert.equal(rangeSummary.focusOptions.preventScroll,true);
assert.match(rangeNotice.textContent,/Сроки сдвинуты/);
console.log('LEGACY_CALENDAR_181_183_184_185_DIRECT_EDIT_WEEK_MONTH_PREFILL_ONLY_PASS');


// Legacy Calendar bundle 1.8.6 + 1.8.7 + 1.8.8: one complete planned source
// supplies informational 2+ markers and both read-only date navigators.
const completeOverlapDays=[
 {status:'planned',start_at:'2026-11-03T05:00:00Z',end_at:'2026-11-03T06:00:00Z',title:'Ранний план'},
 {status:'planned',start_at:'2026-11-03T11:00:00Z',end_at:'2026-11-03T12:00:00Z',title:'Поздний план'},
 {status:'planned',start_at:'2026-11-05T05:00:00Z',end_at:'2026-11-05T06:00:00Z',title:'Первый'},
 {status:'planned',start_at:'2026-11-05T11:00:00Z',end_at:'2026-11-05T12:00:00Z',title:'Второй'}
];
const overlapFixture={viewMode:'week',anchorDate:'2026-11-03',
 periodStart:'2026-11-02',periodEnd:'2026-11-08',
 selectedDay:'2026-11-03',dayFilter:'all',loaded:true,loading:false,
 items:[],total:0,hasMore:false,error:'',
 calendarDayPolicy:{version:'CALENDAR_WORKING_DAY_V194_V195',
  policyVersion:'SHARED_CAPACITY_MON_SAT_MONTHLY_BANK_REVIEW_V2',
  periodStart:'2026-11-02',periodEnd:'2026-11-08',
  days:{'2026-11-02':'WORKING_DAY','2026-11-03':'WORKING_DAY','2026-11-04':'WORKING_DAY',
   '2026-11-05':'WORKING_DAY','2026-11-06':'WORKING_DAY','2026-11-07':'WORKING_DAY','2026-11-08':'SUNDAY'}}};
vm.runInContext('tab="schedule";data='+JSON.stringify(data)+';schedule='+JSON.stringify(overlapFixture)+
 ';hourlySchedule='+JSON.stringify({loaded:true,loading:false,items:completeOverlapDays,
 viewMode:'week',periodStart:'2026-11-02',periodEnd:'2026-11-08',error:''})+';',sandbox);
const marked=vm.runInContext('scheduleView()',sandbox);
assert.match(marked,/data-schedule-day="2026-11-03" data-schedule-overlap="true"/);
assert.match(marked,/data-schedule-day="2026-11-05" data-schedule-overlap="true"/);
assert.match(marked,/⚠ 2/);
assert.match(marked,/Совпадений дней: 2/);
assert.match(marked,/← Совпадение/);
assert.match(marked,/Свободный →/);
assert.match(marked,/Это сигнал для проверки, а не подтверждённая перегрузка/);
const planNav=(selector,attr,value)=>({target:{closest(query){
 return query===selector?{dataset:{[attr]:value}}:null;
}}});
const day3=element('button[data-schedule-day="2026-11-03"]');
day3.scrollIntoView=opts=>{day3.lastScroll=opts;};
await schedulePlanClick(planNav('button[data-schedule-overlap-step]','scheduleOverlapStep','1'));
assert.equal(vm.runInContext('schedule.selectedDay',sandbox),'2026-11-03');
assert.equal(vm.runInContext('scheduleOverlapActive',sandbox),'2026-11-03');
assert.equal(day3.lastScroll?.block,'center');
await schedulePlanClick(planNav('button[data-schedule-overlap-step]','scheduleOverlapStep','1'));
assert.equal(vm.runInContext('schedule.selectedDay',sandbox),'2026-11-05');
await schedulePlanClick(planNav('button[data-schedule-overlap-step]','scheduleOverlapStep','1'));
assert.equal(vm.runInContext('schedule.selectedDay',sandbox),'2026-11-03','next wraps');
await schedulePlanClick(planNav('button[data-schedule-free-step]','scheduleFreeStep','1'));
assert.equal(vm.runInContext('schedule.selectedDay',sandbox),'2026-11-04',
 'free navigator selects only a day with no planned items');
assert.equal(vm.runInContext('scheduleFreeActive',sandbox),'2026-11-04');
assert.doesNotMatch(vm.runInContext('scheduleView()',sandbox),/data-act="overlap_save"/);
console.log('LEGACY_CALENDAR_186_OVERLAP_187_NAV_188_FREE_DAY_ONE_COMPLETE_SOURCE_UI_PASS');


// WorkOrder 1.9.1/1.9.2: from the native order card, exact owner read,
// then existing Calendar Capacity candidate and canonical Schedule form.
vm.runInContext('tab="orders";orderDetailId='+JSON.stringify(id1)+
 ';data='+JSON.stringify(data)+';scheduleLeadDraft=null;scheduleCapacityDraft=null;capacityWorkOrderContext=null;',sandbox);
const orderCapacityCard=vm.runInContext('ordersView()',sandbox);
assert.match(orderCapacityCard,/data-workorder-capacity="/);
vm.runInContext('orderDetailId='+JSON.stringify(id2),sandbox);
assert.doesNotMatch(vm.runInContext('ordersView()',sandbox),/data-workorder-capacity="/,
 'closed Order does not expose Find Slot');
vm.runInContext('orderDetailId='+JSON.stringify(id1),sandbox);
const capacityRequests=[];
const savedCapacityFetch=sandbox.fetch;
sandbox.fetch=async(url,options)=>{
 capacityRequests.push({url,method:options?.method||'GET'});
 if(url==='/api/orders/capacity-context?id='+id1)return{ok:true,json:async()=>({
  version:'WORKORDER_CAPACITY_EXACT_V191_192',source:'MVP_ORDERS_OBJECTS_ID',
  orderId:id1,objectId:object,title:'Прокладка труб',objectName:'Тестовый объект',
  plannedStartDate:'2026-11-03',status:'open',bookingReady:false})};
 throw Error('Unexpected network request '+url);
};
vm.runInContext('loadSchedule=async()=>{schedule.loaded=true;};render=()=>{};',sandbox);
const orderCapacityButton={dataset:{workorderCapacity:id1},disabled:false};
const finderTarget=element('#capacityFinder');
finderTarget.scrollIntoView=opts=>{finderTarget.scrollOptions=opts;};
finderTarget.focus=opts=>{finderTarget.focusOptions=opts;};
const draftTarget=element('#scheduleCapacityEditor');
draftTarget.scrollIntoView=opts=>{draftTarget.scrollOptions=opts;};
draftTarget.focus=opts=>{draftTarget.focusOptions=opts;};
const clickFor=(sel,button)=>({target:{closest:q=>q===sel?button:null}});
await element('#content').events.click(clickFor('button[data-workorder-capacity]',orderCapacityButton));
assert.equal(capacityRequests.length,1,'one exact owner request, no background writes');
assert.equal(capacityRequests[0].method,'GET');
assert.equal(orderCapacityButton.disabled,false);
assert.equal(vm.runInContext('tab',sandbox),'schedule');
assert.equal(vm.runInContext('capacityWorkOrderContext.orderId',sandbox),id1);
assert.equal(vm.runInContext('capacityWorkOrderContext.objectId',sandbox),object);
assert.equal(vm.runInContext('capacity.startDate',sandbox),'2026-11-03');
assert.equal(vm.runInContext('scheduleCapacityDraft',sandbox),null,'opening does not book or save');
assert.equal(finderTarget.scrollOptions.block,'start','Finder auto-revealed after Order click');
assert.equal(finderTarget.focusOptions.preventScroll,true,'avoid mobile keyboard');
const orderFinderFirst=vm.runInContext('scheduleView()',sandbox);
assert.ok(orderFinderFirst.indexOf('id="capacityFinder"')>=0);
assert.ok(orderFinderFirst.indexOf('id="capacityFinder"')<orderFinderFirst.indexOf('class="schedule-day-grid"'),
 'Order Capacity renders ABOVE Calendar, never after the long agenda');
vm.runInContext('schedule.loaded=true;schedule.periodStart="2026-11-09";'+
 'schedule.periodEnd="2026-11-15";capacity.loaded=true;capacity.result='+JSON.stringify({
 windows:[{start:'2026-11-12',end:'2026-11-13'}]})+';',sandbox);
await element('#content').events.click(clickFor('button[data-capacity-plan-start]',{
 dataset:{capacityPlanStart:'2026-11-12',capacityPlanEnd:'2026-11-13'}
}));
assert.equal(vm.runInContext('scheduleCapacityDraft.orderId',sandbox),id1);
assert.equal(vm.runInContext('scheduleCapacityDraft.objectId',sandbox),object);
assert.equal(vm.runInContext('scheduleCapacityDraft.title',sandbox),'Прокладка труб');
assert.equal(draftTarget.scrollOptions.block,'start','candidate selection reveals editor');
assert.equal(draftTarget.focusOptions.preventScroll,true,'no keyboard pop-up');
const candidateTop=vm.runInContext('scheduleView()',sandbox);
assert.match(candidateTop,/id="scheduleCapacityEditor" tabindex="-1"/);
assert.match(candidateTop,/Сохранить план заказа/);
assert.match(candidateTop,/data-hourly-new-editor[^>]* open/);
assert.ok(candidateTop.indexOf('id="scheduleCapacityEditor"')<candidateTop.indexOf('id="capacityFinder"'),
 'selected draft appears ABOVE Finder and Calendar on mobile');
assert.ok(candidateTop.indexOf('id="capacityFinder"')<candidateTop.indexOf('class="schedule-day-grid"'),
 'Finder remains visible above long calendar');
const exactDraftFields=vm.runInContext('scheduleItemFields(null)',sandbox);
assert.match(exactDraftFields,/name="orderId"/);
assert.match(exactDraftFields,/name="objectId"/);
assert.match(exactDraftFields,/Прокладка труб/);
assert.match(exactDraftFields,/Тестовый объект/);
vm.runInContext('data.orders=[];data.objects=[];',sandbox);
const truncatedDraftFields=vm.runInContext('scheduleItemFields(null)',sandbox);
assert.match(truncatedDraftFields,new RegExp('value="'+id1+'" selected>Прокладка труб'));
assert.match(truncatedDraftFields,new RegExp('value="'+object+'" selected>Тестовый объект'));
await element('#content').events.click(clickFor('button[data-capacity-clear-order]',{dataset:{}}));
assert.equal(vm.runInContext('capacityWorkOrderContext.orderId',sandbox),id1,
 'cannot clear active linked draft silently');
assert.equal(capacityRequests.some(x=>x.method==='POST'),false);
sandbox.fetch=savedCapacityFetch;
const resultsTarget=element('#capacityResults');
resultsTarget.scrollIntoView=opts=>{resultsTarget.scrollOptions=opts;};
resultsTarget.focus=opts=>{resultsTarget.focusOptions=opts;};
assert.equal(vm.runInContext('scheduleRevealSection("#capacityResults")',sandbox),true);
assert.equal(resultsTarget.scrollOptions.block,'start');
assert.equal(resultsTarget.focusOptions.preventScroll,true);
console.log('WORKORDER_CAPACITY_FIRST_SCREEN_RESULT_TO_EDITOR_MOBILE_FOCUS_PASS');
console.log('WORKORDER_CAPACITY_EXACT_CARD_TO_UNSAVED_PLAN_OBJECT_BIND_ANDROID_VM_PASS');


// Legacy v1.9.4–v1.9.5: the Calendar marks Sunday distinctly from the green
// monthly company/IP review day, without disabling personal-plan navigation.
const policyMonthFixture={viewMode:'month',anchorDate:'2026-11-03',
 periodStart:'2026-11-01',periodEnd:'2026-11-30',
 selectedDay:'2026-11-30',dayFilter:'all',loaded:true,loading:false,
 items:[],total:0,hasMore:false,error:'',
 calendarDayPolicy:{version:'CALENDAR_WORKING_DAY_V194_V195',
  policyVersion:'SHARED_CAPACITY_MON_SAT_MONTHLY_BANK_REVIEW_V2',
  periodStart:'2026-11-01',periodEnd:'2026-11-30',
  days:Object.fromEntries(Array.from({length:30},(_,i)=>{
   const d='2026-11-'+String(i+1).padStart(2,'0');
   return [d,d==='2026-11-30'?'MONTHLY_REVIEW':d==='2026-11-29'?'SUNDAY':'WORKING_DAY'];
  }))}};
vm.runInContext('data='+JSON.stringify(data)+';tab="schedule";schedule='+JSON.stringify(policyMonthFixture)+
 ';scheduleCapacityDraft=null;capacityWorkOrderContext=null;',sandbox);
const policyCalendar=vm.runInContext('scheduleView()',sandbox);
assert.match(policyCalendar,/День фирмы · ИП \/ анализ/);
assert.match(policyCalendar,/data-schedule-day="2026-11-30" data-calendar-company-day="true"/);
assert.match(policyCalendar,/data-schedule-day="2026-11-29" data-calendar-sunday="true"/);
assert.match(policyCalendar,/data-schedule-day="2026-11-02" data-calendar-past="true"/);
assert.match(policyCalendar,/aria-label="2026-11-30, День фирмы"/);
assert.match(policyCalendar,/aria-label="2026-11-29, Выходной"/);
assert.doesNotMatch(policyCalendar,/data-schedule-day="2026-11-30" data-calendar-sunday="true"/);
assert.doesNotMatch(policyCalendar,/data-schedule-day="2026-11-29" data-calendar-company-day="true"/);
assert.match(policyCalendar,/class="calendar-policy-badge"/);
assert.doesNotMatch(policyCalendar,/data-schedule-day="2026-11-30"[^>]*disabled/);
vm.runInContext('schedule.calendarDayPolicy.policyVersion="UNKNOWN";',sandbox);
assert.doesNotMatch(vm.runInContext('scheduleView()',sandbox),/data-calendar-company-day="true"/,
 'invalid policy must not paint false company days');
console.log('CALENDAR_V194_V195_SERVER_AUTHORITY_COMPANY_DAY_EXCLUSIVE_MOBILE_VISUAL_PASS');
