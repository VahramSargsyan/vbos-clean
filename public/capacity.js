'use strict';
/* Capacity V1: legacy-style embedded Calendar panel. Only /api/capacity reads; no booking or writes. */
let capacity={startDate:'',durationWorkingDays:3,result:null,loading:false,loaded:false,error:''};
const capacityDurationPresets=[1,2,3,5,7]; // exact legacy Calendar Capacity Finder quick values
let scheduleCapacityDraft=null; // no DB row until the regular Schedule Save confirmation
let capacityWorkOrderContext=null; // verified indexed owner read, ephemeral and non-writing
function capacityExactWorkOrder(raw,id){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  Number.isFinite(Date.parse(x+'T00:00:00Z'))&&
  new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
 if(raw?.version!=='WORKORDER_CAPACITY_EXACT_V191_192'||raw.source!=='MVP_ORDERS_OBJECTS_ID'||
  raw.bookingReady!==false||raw.orderId!==id||
  !uuid.test(raw.orderId)||!uuid.test(raw.objectId)||
  !['open','active'].includes(raw.status)||typeof raw.title!=='string'||
  !raw.title.trim()||typeof raw.objectName!=='string'||
  !raw.objectName.trim()||(raw.plannedStartDate!==null&&!day(raw.plannedStartDate)))return null;
 return {orderId:raw.orderId,objectId:raw.objectId,title:raw.title,
  objectName:raw.objectName,plannedStartDate:raw.plannedStartDate,status:raw.status};
}

// Replace the state object so an older asynchronous search cannot restore stale windows.
function invalidateCapacity(){capacity={...capacity,loaded:false,result:null,error:'',loading:false};}
const capacityDayLabel={SUNDAY:'Выходной · воскресенье',MONTHLY_REVIEW:'День фирмы · ИП',BUSY:'Занято по плану',OPEN_IN_SCHEDULE:'Нет блокирующего плана'};
function capacityPanelView(){
 const c=capacity,start=c.startDate||schedule.selectedDay||data.today,days=c.result?.days||[],windows=c.result?.windows||[];
 let s='<section class="card capacity-in-plan" id="capacityFinder" tabindex="-1" aria-label="Capacity в календаре">'+
 '<h2>'+(capacityWorkOrderContext?'Найти место для заказа':'Capacity · свободные окна')+'</h2>'+ 
 '<p class="muted small">Time Engine → Shared Capacity · MANUAL: введённые рабочие дни, без автоматического расчёта трудозатрат.</p>'+
 (capacityWorkOrderContext?'<div class="capacity-order-context" role="status"><strong>'+esc(capacityWorkOrderContext.title)+'</strong><p class="muted small">Заказ '+esc(capacityWorkOrderContext.orderId)+' · объект: '+esc(capacityWorkOrderContext.objectName)+(capacityWorkOrderContext.plannedStartDate?' · ориентир: '+esc(capacityWorkOrderContext.plannedStartDate):'')+'</p><button type="button" class="compact" data-capacity-clear-order>Убрать заказ</button><p class="muted small">Длительность задай вручную. Окна — предложения, не подтверждение загрузки сотрудников.</p></div>':'<p class="muted small">Свободный режим: личные и организационные планы. Для клиентского заказа открой «Найти место» в его карточке.</p>')+
 '<p class="muted">Подбор рабочих дат внутри календаря по сохранённому плану. Наличие работников и полная длительность заказов не подтверждены.</p>'+
 '<form id="capacitySearch" class="grid">'+
 editText('startDate','Начать поиск не раньше',start,'date','required')+
 editText('durationWorkingDays','Продолжительность · рабочих дней (1–60)',c.durationWorkingDays,'number','min="1" max="60" step="1" required')+
 '<div class="capacity-quick-days" role="group" aria-label="Быстрый выбор рабочих дней">'+
 capacityDurationPresets.map(days=>'<button type="button" class="compact" data-capacity-quick="'+days+
 '" aria-pressed="'+(c.durationWorkingDays===days?'true':'false')+'"'+(c.loading?' disabled':'')+
 '>'+days+(days===1?' день':'')+'</button>').join('')+'</div>'+
 '<button class="primary wide" type="submit"'+(c.loading?' disabled':'')+'>Найти окна</button></form>'+
 '<p class="muted small">Режим старого Shared Capacity: понедельник–суббота, кроме воскресений и последнего банковского рабочего дня каждого месяца. Отдельное напоминание CRM не занимает весь день; два одновременных плана блокируют день.</p>';
 if(c.loading)return s+'<p role="status">Проверяю сохранённое расписание…</p></section>';
 if(c.error)return s+'<p role="alert">Capacity недоступна: '+esc(c.error)+'</p><p class="muted small">Свободные даты не рассчитаны. Проверь данные плана и повтори поиск.</p></section>';
 if(!c.loaded||!c.result)return s+'</section>';
 const r=c.result;
 s+='<div class="capacity-results" id="capacityResults" tabindex="-1" aria-label="Результаты подбора Capacity">'+
  '<p role="status" class="muted small">'+(r.time?.readyForCapacity===true
   ?'Time Engine подтвердил '+fmt(r.time.durationWorkingDays)+' рабочих дней · источник MANUAL · расчёт окон: Shared Capacity.'
   :'Time Engine: длительность не подтверждена. Повтори поиск перед планированием.')+'</p>'+
  '<h3>Найдено вариантов: '+fmt(windows.length)+'</h3>'+
  (capacityWorkOrderContext?'<p class="muted small">Выбери подходящие даты. Редактор плана откроется сразу перед календарём; сохранение отдельно.</p>':'')+
  '<p class="muted small">Проверено: '+esc(r.startDate)+' — '+esc(r.horizonEnd)+
  ' · записей плана: '+fmt(r.scheduleItemsConsidered)+
  ' · длительность введена вручную: '+fmt(r.durationWorkingDays)+' рабочих дней.</p>';
 if(r.unplannedOrders)s+='<p role="status" class="capacity-warning">Нераспланированных активных заказов: '+fmt(r.unplannedOrders)+'. Они могут занимать время, поэтому найденные окна нельзя считать гарантированно свободными.</p>';
 s+='<p class="capacity-warning">Это кандидаты, не бронирование. Часовая проекция заказа не показывает полную длительность его выполнения. Перед обещанием срока проверь загрузку команды.</p>';
 if(!windows.length)s+='<p class="muted">Полностью свободного окна такой длительности по сохранённому плану не найдено в текущем горизонте.</p>';
 else s+=windows.map((w,i)=>'<article class="record capacity-window"><strong>Вариант '+(i+1)+' · '+esc(w.start)+(w.start===w.end?'':' — '+esc(w.end))+'</strong>'+
  '<p class="muted small">'+fmt(w.durationWorkingDays)+' рабочих дней · выходных/дней фирмы внутри: '+fmt(w.skippedDays)+
  ' · напоминаний CRM: '+fmt(w.crmRemindersInside)+
  ' · свободных рабочих дней до: '+fmt(w.freeWorkingDaysBefore)+' · после: '+fmt(w.freeWorkingDaysAfter)+'</p>'+
  '<div class="actions"><button type="button" class="compact" data-capacity-open-day="'+esc(w.start)+'">Показать день в календаре</button>'+
  '<button type="button" class="compact" data-capacity-plan-start="'+esc(w.start)+
  '" data-capacity-plan-end="'+esc(w.end)+'">'+(capacityWorkOrderContext?'Выбрать даты →':'Запланировать сюда')+'</button></div></article>').join('');
 s+='</div><details class="capacity-day-details"><summary>Состояние ближайших дней · по расписанию</summary>'+
 '<div class="capacity-day-list">'+days.slice(0,35).map(d=>'<div class="capacity-day '+(d.status==='BUSY'?'capacity-busy':d.working?'capacity-open':'capacity-off')+'">'+
 '<strong>'+esc(d.date)+'</strong><span>'+esc(capacityDayLabel[d.status]||d.status)+'</span>'+
 '<small>'+fmt(d.work)+' рабочих планов · '+fmt(d.crm)+' CRM</small></div>').join('')+'</div>'+
 (days.length>35?'<p class="muted small">Показаны первые 35 дней из '+fmt(days.length)+'. Поиск окон выполнен по всему указанному горизонту.</p>':'')+
 '</details></section>';
 return s;
}
async function loadCapacity(){
 if(!data||capacity.loading)return;
 const state=capacity,day=data.today,start=state.startDate||schedule.selectedDay||day,duration=state.durationWorkingDays;
 state.loading=true;state.error='';state.loaded=false;state.result=null;
 if(tab==='schedule')render();
 try{
  const p=new URLSearchParams({startDate:start,durationWorkingDays:String(duration)});
  const result=await api('/api/capacity?'+p);
  if(result?.version!=='CAPACITY_SCHEDULE_V1'||result.sourceCoverage!=='SCHEDULE_ONLY_NOT_FULL_DURATION'||
     result.timeBridgeVersion!=='CALENDAR_TIME_ENGINE_MANUAL_V1121'||
     result.time?.version!=='v1.12.0'||result.time?.resolutionMode!=='EXPLICIT_SOURCE_V1'||
     result.time?.durationSource!=='MANUAL'||result.time?.readyForCapacity!==true||
     result.time?.coverage!=='EXPLICIT_MANUAL_WORKING_DAYS'||
     result.time?.sourceStatus!=='CONFIRMED_INPUT'||
     result.time?.sourceRef!=='CALENDAR_CAPACITY_FINDER_V1121'||
     result.time?.durationWorkingDays!==duration||
     result.bookingReady!==false||result.durationWorkingDays!==duration||
     !Array.isArray(result.days)||!Array.isArray(result.windows)||result.windows.length>3)
    throw Error('Ответ Capacity не прошёл проверку источника.');
  if(capacity!==state||!data||data.today!==day)return;
  state.result=result;state.loaded=true;
 }catch(e){if(capacity===state&&data&&data.today===day)state.error=e.message;}
 finally{state.loading=false;if(capacity===state&&data&&tab==='schedule')render();}
}
