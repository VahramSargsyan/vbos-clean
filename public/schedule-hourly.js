'use strict';
/* Legacy PlanningCapacityCalendarHourlyCapacity v1.10.1 + DayTimeline v1.10.2:
 * exact 08:00–19:00 local interval display. Derived from saved ScheduleItems,
 * never from a per-worker capacity estimate or a new calendar writer.
 */
let hourlySchedule={loaded:false,loading:false,items:[],error:'',viewMode:'',periodStart:'',periodEnd:''};
const HOUR_START=480,HOUR_END=1140,HOUR_SPAN=660;
const hourlyLocal=instant=>new Date(new Date(instant).getTime()+14400000).toISOString().slice(0,16);
const hourlyTimeMinutes=text=>Number(text.slice(11,13))*60+Number(text.slice(14,16));
const hourlyClock=minute=>String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
const hourlySunday=key=>new Date(key+'T00:00:00Z').getUTCDay()===0;
function hourlyCategory(item){
 if(item.source_kind==='crm')return 'crm';
 if(item.source_kind==='work_order'||item.order_id)return 'client';
 const type=String(item.item_type||'').toLowerCase();
 return type.includes('лич')||type.includes('personal')?'personal':'firm';
}
function hourlyIntervalsFor(items,key){
 if(hourlySunday(key))return [];
 const found=[];
 for(const item of items){
  if(item.status!=='planned')continue;
  const start=hourlyLocal(item.start_at),end=hourlyLocal(item.end_at);
  if(start.slice(0,10)>key||end.slice(0,10)<key)continue;
  const from=start.slice(0,10)===key?hourlyTimeMinutes(start):HOUR_START;
  const until=end.slice(0,10)===key?hourlyTimeMinutes(end):HOUR_END;
  const left=Math.max(HOUR_START,from),right=Math.min(HOUR_END,until);
  if(right>left)found.push({start:left,end:right,kind:hourlyCategory(item),title:item.title});
 }
 return found.sort((a,b)=>a.start-b.start||a.end-b.end);
}
function hourlyMerged(intervals){
 const merged=[];
 for(const i of intervals){
  const last=merged.at(-1);
  if(!last||i.start>last.end)merged.push({start:i.start,end:i.end});
  else last.end=Math.max(last.end,i.end);
 }
 return merged;
}
function hourlyFree(intervals){
 const gaps=[],busy=hourlyMerged(intervals);let cursor=HOUR_START;
 for(const b of busy){
  if(b.start>cursor)gaps.push({start:cursor,end:b.start});
  cursor=Math.max(cursor,b.end);
 }
 if(cursor<HOUR_END)gaps.push({start:cursor,end:HOUR_END});
 return gaps;
}
function hourlyBar(interval,mini=false){
 const left=((interval.start-HOUR_START)/HOUR_SPAN*100).toFixed(3);
 const width=((interval.end-interval.start)/HOUR_SPAN*100).toFixed(3);
 const title=mini?'':(' title="'+esc(String(interval.title||'Работа')+' · '+hourlyClock(interval.start)+'–'+hourlyClock(interval.end))+'"');
 return '<i class="legacy-hour-bar legacy-hour-'+interval.kind+'" aria-hidden="true" style="left:'+left+'%;width:'+width+'%"'+title+'></i>';
}
function hourlyReady(){
 return hourlySchedule.loaded&&hourlySchedule.periodStart===schedule.periodStart&&
  hourlySchedule.periodEnd===schedule.periodEnd&&hourlySchedule.viewMode===schedule.viewMode;
}
function hourlyMiniFor(key){
 if(!hourlyReady()||hourlySunday(key))return '';
 const intervals=hourlyIntervalsFor(hourlySchedule.items,key);
 return intervals.length?'<span class="legacy-hour-mini" aria-hidden="true">'+
  intervals.map(i=>hourlyBar(i,true)).join('')+'</span>':'';
}
function hourlyDayView(key){
 let s='<div class="legacy-hourly-day" role="region" aria-label="Часовая загрузка '+esc(key)+'">'+
 '<div class="legacy-hourly-title"><strong>Часовая загрузка</strong><span>08:00–19:00</span></div>';
 if(hourlySunday(key))return s+'<p class="muted small">Воскресенье — выходной. Рабочую загрузку не рассчитываем.</p></div>';
 if(!hourlyReady()){
  const text=hourlySchedule.error?('Часовая шкала недоступна: '+hourlySchedule.error):
    'Загружаю интервалы из полного расписания…';
  return s+'<p class="muted small" role="status">'+esc(text)+'</p></div>';
 }
 const intervals=hourlyIntervalsFor(hourlySchedule.items,key),merged=hourlyMerged(intervals),
  gaps=hourlyFree(intervals),busy=merged.reduce((sum,i)=>sum+i.end-i.start,0);
 const open=gaps.length?gaps.map(i=>hourlyClock(i.start)+'–'+hourlyClock(i.end)).join(' · '):'нет свободных окон';
 s+='<p class="muted small">Занято: '+esc(String(Math.round(busy/6)/10))+' ч из 11 ч. '+
  'У заказов время 09:00–10:00 может быть условным — это не полная длительность заказа.</p>'+
  '<div class="legacy-hour-track" role="img" aria-label="Занятые интервалы 08:00–19:00">'+
  intervals.map(i=>hourlyBar(i)).join('')+'</div>'+
  '<p class="legacy-hour-free"><b>Свободно по часам:</b> '+esc(open)+'</p>'+
  '<div class="legacy-hour-legend"><span class="legacy-hour-legend-personal">Личное</span>'+
  '<span class="legacy-hour-legend-firm">Фирма</span><span class="legacy-hour-legend-client">Заказ</span>'+
  '<span class="legacy-hour-legend-crm">CRM</span></div></div>';
 return s;
}
function invalidateHourlySchedule(){
 hourlySchedule={loaded:false,loading:false,items:[],error:'',viewMode:'',periodStart:'',periodEnd:''};
}
async function loadHourlySchedule(){
 if(!data||tab!=='schedule'||!schedule.loaded)return;
 if(hourlyReady()||hourlySchedule.loading)return;
 const active=hourlySchedule,day=data.today;
 const mode=schedule.viewMode,anchor=schedule.anchorDate||data.today,
  periodStart=schedule.periodStart,periodEnd=schedule.periodEnd;
 active.loading=true;active.error='';
 try{
  const query=new URLSearchParams({viewMode:mode,anchorDate:anchor});
  const result=await api('/api/schedule/hourly?'+query);
  if(result?.version!=='LEGACY_CALENDAR_HOURLY_V1101'||result.complete!==true||
   result.periodStart!==periodStart||result.periodEnd!==periodEnd||result.viewMode!==mode||
   result.timezone!=='Asia/Yerevan'||result.workStart!=='08:00'||result.workEnd!=='19:00'||
   !Array.isArray(result.items)||result.items.length>2000||
   result.items.some(x=>!['manual','work_order','crm'].includes(x.source_kind)||
     x.status!=='planned'||!Number.isFinite(new Date(x.start_at).getTime())||
     !Number.isFinite(new Date(x.end_at).getTime())))
   throw Error('Ответ часовой шкалы не прошёл проверку источника.');
  if(hourlySchedule!==active||!data||day!==data.today||tab!=='schedule'||
    schedule.periodStart!==periodStart||schedule.periodEnd!==periodEnd)return;
  active.items=result.items;active.periodStart=periodStart;active.periodEnd=periodEnd;
  active.viewMode=mode;active.loaded=true;
 }catch(e){
  if(hourlySchedule===active)active.error=e.message;
 }finally{
  active.loading=false;
  if(hourlySchedule===active&&data&&tab==='schedule')render();
 }
}


/* Google Hourly Capacity v1.10.1: next free hour in canonical new manual Plan.
 * Uses the existing verified interval model and 15-day source facts, never writes.
 */
const hourlyQuickDurations=[30,60,120,240];
let hourlyManual={open:false,date:'',duration:60,category:'',slot:null,loading:false,note:'',token:0};
function resetHourlyManual(){
 hourlyManual={open:false,date:'',duration:60,category:'',slot:null,loading:false,note:'',token:0};
}
function hourlyNowYerevan(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(now);
 const value=key=>String(parts.find(x=>x.type===key)?.value||'');
 return {day:value('year')+'-'+value('month')+'-'+value('day'),
  minute:Number(value('hour'))*60+Number(value('minute'))};
}
function hourlyFirstNextGap(items,key,duration,notBefore=HOUR_START){
 if(hourlySunday(key))return null;
 const merged=hourlyMerged(hourlyIntervalsFor(items,key));
 let cursor=Math.max(HOUR_START,notBefore);
 for(const busy of merged){
  if(busy.end<=cursor)continue;
  if(busy.start-cursor>=duration)return {date:key,start:cursor,end:cursor+duration};
  cursor=Math.max(cursor,busy.end);
 }
 return HOUR_END-cursor>=duration?{date:key,start:cursor,end:cursor+duration}:null;
}
function hourlyNextSlot(items,preferredDate,duration,now=new Date()){
 if(!Number.isInteger(duration)||duration<15||duration>480||duration%15!==0)throw Error('Недопустимая длительность.');
 const y=hourlyNowYerevan(now);
 const start=preferredDate>=y.day?preferredDate:y.day;
 for(let i=0;i<=14;i++){
  const key=scheduleShiftDay(start,i);
  if(hourlySunday(key))continue;
  const from=key===y.day?Math.ceil(Math.max(HOUR_START,y.minute)/15)*15:HOUR_START;
  const gap=hourlyFirstNextGap(items,key,duration,from);
  if(gap)return gap;
 }
 return null;
}
function hourlyManualPanelView(){
 if(scheduleLeadDraft||scheduleCapacityDraft)return '';
 const h=hourlyManual;
 return '<div class="legacy-hourly-assistant" data-hourly-assistant aria-label="Следующее свободное время">'+
  '<strong>Следующее свободное время</strong>'+
  '<div class="legacy-hourly-picks" role="group" aria-label="Тип ручной задачи">'+
  [['Личное','👤 Личное'],['Организационное','🏢 Дела фирмы']].map(([kind,label])=>
   '<button type="button" class="compact" data-hourly-category="'+esc(kind)+'" aria-pressed="'+(h.category===kind)+'">'+label+'</button>').join('')+'</div>'+
  '<div class="legacy-hourly-picks" role="group" aria-label="Длительность">'+
  hourlyQuickDurations.map(n=>'<button type="button" class="compact" data-hourly-duration="'+n+
   '" aria-pressed="'+(h.duration===n)+'">'+(n<60?n+' мин':(n/60)+' ч')+'</button>').join('')+'</div>'+
  '<button type="button" class="compact" data-hourly-find'+(h.loading?' disabled':'')+'>Найти время</button>'+
  '<p class="muted small" data-hourly-status role="status">'+esc(h.note||'Подсказка по расписанию 08:00–19:00, шаг 15 минут, поиск до 14 дней вперёд.')+'</p>'+
  '<p class="muted small">У заказов время может быть условным. Перед сохранением проверь реальную длительность работы.</p></div>';
}
function hourlyUpdateManualDom(){
 const host=document.querySelector('[data-hourly-assistant]');
 if(!host)return;
 const status=host.querySelector('[data-hourly-status]');
 if(status)status.textContent=hourlyManual.note;
 const find=host.querySelector('[data-hourly-find]');
 if(find)find.disabled=hourlyManual.loading;
 const form=document.querySelector('form[data-hourly-manual-form]');
 if(form&&hourlyManual.slot){
  const a=form.elements?.startAt,b=form.elements?.endAt;
  if(a&&b){a.value=hourlyManual.slot.startAt;b.value=hourlyManual.slot.endAt;}
 }
}
async function hourlyFindManual(){
 if(!data||tab!=='schedule'||!schedule.loaded||scheduleLeadDraft||scheduleCapacityDraft||hourlyManual.loading)return;
 const state=hourlyManual,now=hourlyNowYerevan();
 const proposed=state.date||schedule.selectedDay||data.today;
 const startDate=proposed>=now.day?proposed:now.day;
 const duration=state.duration;
 if(!hourlyQuickDurations.includes(duration))return;
 state.loading=true;state.slot=null;state.note='Ищу следующее свободное окно '+duration+' мин. в 08:00–19:00…';
 hourlyUpdateManualDom();
 try{
  const result=await api('/api/schedule/hourly/search?'+new URLSearchParams({startDate}));
  const expectedEnd=scheduleShiftDay(startDate,14);
  if(result?.version!=='LEGACY_HOURLY_NEXT_SOURCE_V1101'||
   result.startDate!==startDate||result.endDate!==expectedEnd||
   result.timezone!=='Asia/Yerevan'||result.complete!==true||
   result.source!=='mvp_schedule_items+mvp_schedule_order_items+mvp_schedule_lead_items'||
   !Array.isArray(result.items)||result.items.length>2000||
   result.items.some(x=>!['manual','work_order','crm'].includes(x.source_kind)||
     x.status!=='planned'||!Number.isFinite(new Date(x.start_at).getTime())||
     !Number.isFinite(new Date(x.end_at).getTime())||
     new Date(x.end_at)<=new Date(x.start_at)))
   throw Error('Источник часового расписания неполон.');
  if(hourlyManual!==state||!data||tab!=='schedule')return;
  const found=hourlyNextSlot(result.items,startDate,duration);
  if(found){
   state.slot={date:found.date,startAt:found.date+'T'+hourlyClock(found.start),
    endAt:found.date+'T'+hourlyClock(found.end)};
   state.date=found.date;
   state.note='Предложено: '+hourlyClock(found.start)+'–'+hourlyClock(found.end)+
    (found.date!==startDate?' · перенесено на '+found.date:'')+
    '. Это подсказка, проверь перед сохранением.';
  }else state.note='В ближайшие 14 дней подходящего окна не найдено. Время можно указать вручную.';
 }catch(error){
  if(hourlyManual===state)state.note='Поиск времени недоступен: '+String(error.message||error).slice(0,200)+'. Укажи вручную.';
 }finally{
  state.loading=false;
  if(hourlyManual===state)hourlyUpdateManualDom();
 }
}
