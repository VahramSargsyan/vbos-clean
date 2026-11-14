'use strict';
/* VBOS Clean Plan Day Workflow V1: canonical week/month ScheduleItems and
 * read-only handoff to exact WorkOrder / My Work. Existing mutations stay owned
 * by Schedule, WorkOrder and CRM; no extra IDs, statuses or source tables. */
const scheduleStatusLabel={planned:'Запланировано',completed:'Выполнено',cancelled:'Отменено',archived:'Архив'};
const scheduleDayFilters=[['all','Все'],['planned','К выполнению'],['completed','Выполнено'],['cancelled','Отменено']];
function scheduleDaySummary(items,day){
 const counts={planned:0,completed:0,cancelled:0,overdue:0};
 for(const x of items){
  if(Object.hasOwn(counts,x.status))counts[x.status]++;
  if(x.status==='planned'&&x.schedule_date<data.today)counts.overdue++;
 }
 return counts;
}
function scheduleFilterEntries(items,kind){
 return kind==='all'?items:items.filter(x=>x.status===kind);
}
function schedulePointWord(n){
 const last2=n%100,last=n%10;
 return last2>=11&&last2<=14?'пунктов':last===1?'пункт':last>=2&&last<=4?'пункта':'пунктов';
}
const scheduleShiftDay=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
function scheduleShiftPeriod(n){
 if(schedule.loading)return;
 const base=schedule.anchorDate||data.today;
 if(schedule.viewMode==='week')schedule.anchorDate=scheduleShiftDay(base,n*7);
 else{
  const d=new Date(base.slice(0,7)+'-01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth()+n);
  schedule.anchorDate=d.toISOString().slice(0,10);
 }
 schedule.selectedDay=schedule.anchorDate;
 return loadSchedule(false);
}
const scheduleLocalTime=instant=>new Date(new Date(instant).getTime()+14400000).toISOString().slice(0,16);
function scheduleChoices(items,selected,labeler,verifiedMissingLabel=''){
 const missing=selected&&!items.some(x=>x.id===selected)?'<option value="'+esc(selected)+'" selected>'+esc(verifiedMissingLabel||'Сохранённая связь (вне текущего списка)')+'</option>':'';
 return '<option value="">Без привязки</option>'+missing+items.map(x=>'<option value="'+esc(x.id)+'" '+(x.id===selected?'selected':'')+'>'+esc(labeler(x))+'</option>').join('');
}
function scheduleItemFields(item){
 const draft=!item?scheduleLeadDraft:null;
 const capDraft=!item&&!draft?scheduleCapacityDraft:null;
 const manualDraft=!item&&!draft&&!capDraft?hourlyManual:null;
 const date=draft?.date||capDraft?.start||manualDraft?.date||schedule.selectedDay||schedule.anchorDate||data.today;
 // Clean uses datetime-local, while legacy Capacity proposes date-only ranges.
 // Keep the standard Schedule example times; owner must check actual hours before save.
 const start=item?scheduleLocalTime(item.start_at):(manualDraft?.slot?.startAt||date+'T09:00');
 const end=item?scheduleLocalTime(item.end_at):(manualDraft?.slot?.endAt||(capDraft?.end||date)+'T10:00');
 return '<input type="hidden" name="revision" value="'+esc(item?.revision||0)+'">'+
  (item?'<input type="hidden" name="id" value="'+esc(item.id)+'">':'')+
  editText('startAt','Начало',start,'datetime-local','required')+
  editText('endAt','Окончание',end,'datetime-local','required')+
  editText('itemType','Тип работы',item?.item_type||draft?.itemType||manualDraft?.category||(draft?'Осмотр':'Работа'),'text','maxlength="120" required')+
  editText('title','Задача',item?.title||draft?.title||capDraft?.title||'','text','maxlength="300" required')+
  select('objectId','Объект (необязательно)',scheduleChoices(data.objects,item?.object_id||capDraft?.objectId||null,x=>x.name,capDraft?.objectName||''),false)+
  select('orderId','Заказ (необязательно)',scheduleChoices(data.orders,item?.order_id||capDraft?.orderId||null,x=>x.title,capDraft?.title||''),false)+
  select('workerId','Исполнитель (необязательно)',scheduleChoices((data.workers||[]).filter(w=>w.status==='active'),
   item?(data.manualPlanWorkers||[]).find(a=>a.plan_id===item.id&&a.status==='active')?.worker_id||null:null,w=>w.name+(w.role_title?' · '+w.role_title:'')),false)+
  editText('notes','Примечание',item?.notes||draft?.notes||'','textarea','maxlength="5000"')+
  '<p class="muted small">Если выбран заказ, объект должен соответствовать заказу. План не создаёт новый заказ и не изменяет его дату.</p>';
}

/* Legacy Calendar Range Edit v1.8.1, Quick Shift v1.8.3,
 * Quick Duration v1.8.4, Month Actions v1.8.5.
 * These actions prefill the existing manual schedule_save editor only.
 */
function scheduleLegacyShiftDateTime(local,days){
 if(typeof local!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(local)||
    (days!==-1&&days!==1))return null;
 const date=local.slice(0,10),parsed=new Date(date+'T00:00:00Z');
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return null;
 return scheduleShiftDay(date,days)+local.slice(10);
}
function scheduleLegacyActions(item){
 const id=esc(item.id);
 const button=(action,delta,text)=>'<button type="button" class="compact" data-schedule-range-id="'+id+
  '" data-schedule-range-action="'+action+'"'+
  (delta===null?'':' data-schedule-range-delta="'+delta+'"')+'>'+text+'</button>';
 return '<div class="schedule-range-actions" role="group" aria-label="Изменить сроки плана">'+
  button('shift',-1,'Раньше на 1 день')+button('shift',1,'Позже на 1 день')+
  button('duration',-1,'Сократить на 1 день')+button('duration',1,'Продлить на 1 день')+
  button('open',null,'Изменить сроки')+'</div>';
}
function scheduleLegacyApplyRange(form,action,delta){
 if(action==='open')return {valid:true,changed:false,note:'Проверь даты и нажми «Сохранить план».'};
 if(!['shift','duration'].includes(action)||![1,-1].includes(delta))
  return {valid:false,changed:false,note:'Неизвестное действие изменения сроков.'};
 const startInput=form?.elements?.startAt,endInput=form?.elements?.endAt;
 if(!startInput||!endInput)
  return {valid:false,changed:false,note:'Поля сроков плана недоступны.'};
 const start=String(startInput.value||''),end=String(endInput.value||'');
 if(!scheduleLegacyShiftDateTime(start,1)||!scheduleLegacyShiftDateTime(end,1)||end<=start)
  return {valid:false,changed:false,note:'Некорректные исходные сроки плана.'};
 const nextStart=action==='shift'?scheduleLegacyShiftDateTime(start,delta):start;
 const nextEnd=scheduleLegacyShiftDateTime(end,delta);
 if(!nextStart||!nextEnd)return {valid:false,changed:false,note:'Не удалось прочитать даты плана.'};
 if(nextEnd<=nextStart)
  return {valid:false,changed:false,note:'План уже длится один день. Сократить его ещё на день нельзя.'};
 startInput.value=nextStart;
 endInput.value=nextEnd;
 return {valid:true,changed:true,note:action==='shift'
  ?'Сроки сдвинуты на 1 день '+(delta>0?'вперёд.':'назад.')+' Проверь даты и нажми «Сохранить план».'
  :'Длительность '+(delta>0?'увеличена':'уменьшена')+' на 1 день. Проверь дату окончания и нажми «Сохранить план».'};
}
function scheduleLegacyOpenRangeEditor(button){
 if(!schedule.loaded||schedule.loading)return false;
 const id=String(button?.dataset?.scheduleRangeId||'');
 const item=schedule.items.find(x=>x.id===id&&x.source_kind==='manual');
 if(!item)return false; // auto WorkOrder/CRM writes remain owned elsewhere
 const card=button.closest('article.schedule-item');
 const details=card?.querySelector('details.edit-panel');
 const form=details?.querySelector('form[data-act="schedule_save"]');
 if(!form||String(form.elements?.id?.value||'')!==id||
    String(form.elements?.revision?.value||'')!==String(item.revision))return false;
 const action=String(button.dataset.scheduleRangeAction||'');
 const delta=Number(button.dataset.scheduleRangeDelta);
 if(!['open','shift','duration'].includes(action))return false;
 details.open=true;
 const result=scheduleLegacyApplyRange(form,action,delta);
 if(result.changed)legacyConflictInvalidate(form);
 const note=details.querySelector('[data-schedule-range-notice]');
 if(note){note.textContent=result.note;note.hidden=false;}
 const summary=details.querySelector('summary');
 summary?.scrollIntoView?.({behavior:'smooth',block:'start'});
 summary?.focus?.({preventScroll:true}); // do not pop mobile keyboard
 return true;
}

function scheduleVisitLeadId(notes){
 const m=String(notes||'').match(/(?:^|\n)CRM LEAD ID: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\n|$)/i);
 return m?.[1]||null;
}
function scheduleItemCard(x){
 const status=scheduleStatusLabel[x.status]||x.status;
 const auto=x.source_kind==='work_order',crm=x.source_kind==='crm',managed=auto||crm;
 const sourceLeadId=crm?x.lead_id:(!auto?scheduleVisitLeadId(x.notes):null);
 const overdue=x.status==='planned'&&x.schedule_date<data.today;
 const selectedClass=x.status==='completed'?'schedule-done':overdue?'schedule-overdue':x.status==='cancelled'?'schedule-cancelled':'';
 const whenTime=scheduleLocalTime(x.start_at).slice(11)+'–'+scheduleLocalTime(x.end_at).slice(11);
 const refs=[x.object_name,x.order_title].filter(Boolean).join(' · ');
 let out='<article class="record schedule-item '+selectedClass+'"><div class="row"><strong>'+esc(x.title)+'</strong><span class="tag">'+esc(overdue?'Просрочено':status)+'</span></div>'+
  '<div class="meta">'+esc(x.schedule_date)+' · '+esc(whenTime)+' · '+esc(x.item_type)+'</div>'+
  (refs?'<p class="muted small">'+esc(refs)+'</p>':'')+
  (x.worker_names?'<p class="muted small"><strong>'+(auto?'Исполнители: ':'Исполнитель: ')+'</strong>'+esc(x.worker_names)+'</p>':'')+
  (x.notes?'<p class="muted small">'+esc(x.notes)+'</p>':'')+
  (sourceLeadId?'<button type="button" class="compact" data-schedule-open-lead="'+esc(sourceLeadId)+'">Открыть обращение в CRM</button>':'')+
  (x.order_id?'<div class="actions schedule-handoff"><button type="button" class="compact" data-schedule-open-order="'+esc(x.order_id)+'">Открыть заказ</button>'+
   (x.status==='planned'&&['open','active'].includes(x.order_status)
    ?'<button type="button" class="compact primary" data-schedule-work-order="'+esc(x.order_id)+'">К работе по заказу</button>':'')+
   '</div>':'')+
  (auto?'<p class="muted small"><b>Из заказа</b> · дата, название и статус обновляются в разделе «Заказы». Время 09:00–10:00 условное: заказ хранит только дату.</p></article>':crm?'<p class="muted small"><b>Напоминание CRM</b> · изменить или очистить можно только в карточке обращения.</p></article>':'')+
  (managed?'':scheduleLegacyActions(x)+'<details class="edit-panel"><summary>Изменить / перенести</summary><p class="muted small schedule-range-notice" data-schedule-range-notice role="status" hidden></p><form data-act="schedule_save" data-schedule-status="'+esc(x.status)+'" class="grid">'+scheduleItemFields(x)+
  '<button type="submit" class="primary wide">Сохранить план</button></form></details>'+
  '<div class="actions">');
 if(managed)return out;
 for(const statusId of ['planned','completed','cancelled']){
  if(statusId!==x.status)out+='<button type="button" class="compact" data-act="schedule_save" data-id="'+esc(x.id)+'" data-revision="'+esc(x.revision)+'" data-status="'+statusId+'">'+esc(scheduleStatusLabel[statusId])+'</button>';
 }
 out+='<button type="button" class="compact" data-act="schedule_archive" data-id="'+esc(x.id)+'" data-revision="'+esc(x.revision)+'">В архив</button></div></article>';
 return out;
}
function scheduleNewEditorView(){
 let s='';
 s+='<details class="card" data-hourly-new-editor'+
  (scheduleCapacityDraft?' id="scheduleCapacityEditor" tabindex="-1" aria-label="Подготовленный план из Capacity"':'')+
   (scheduleLeadDraft||scheduleCapacityDraft?' open':'')+
   (!scheduleLeadDraft&&!scheduleCapacityDraft&&hourlyManual.open?' open':'')+
   '><summary data-hourly-new-summary>'+
  (scheduleLeadDraft?(scheduleLeadDraft.itemType==='Связь с клиентом'?'Следующий контакт по CRM · проверь время и сохрани':'Осмотр по обращению CRM · проверь время и сохрани'):
   scheduleCapacityDraft?(scheduleCapacityDraft.workOrderId?'Capacity · план для заказа':'Capacity · запланировать выбранное окно'):'+ Добавить задачу в план')+'</summary>'+ 
  (scheduleCapacityDraft?.workOrderId?'<p class="muted small" role="status"><b>Заказ '+esc(scheduleCapacityDraft.title)+'</b> · объект: '+esc(scheduleCapacityDraft.objectName)+'. Проверены точные ID; не меняй связь заказа или объекта перед сохранением.</p>':'')+
  (scheduleCapacityDraft?'<p class="muted small" role="status">Capacity предложил период '+esc(scheduleCapacityDraft.start)+' — '+
   esc(scheduleCapacityDraft.end)+'. Проверь время, заказ, объект, исполнителя и даты. План НЕ сохранён.</p>'+
   '<button type="button" class="compact" data-cancel-capacity-draft>Отменить подготовку</button>':'')+
  (scheduleLeadDraft?'<p class="muted small">Данные подготовлены из CRM. Ничего не записано в календарь до нажатия «Создать пункт плана». Дата предложена из обращения, время 09:00–10:00 — пример: исправь на фактическое. Связь с обращением записана в примечании, а не отдельным внешним ключом базы.</p><button type="button" class="compact" data-cancel-lead-visit>Отменить подготовку задачи</button>':'')+
  hourlyManualPanelView()+
  '<form data-act="schedule_save" data-schedule-status="planned"'+(scheduleLeadDraft?' data-lead-visit-draft':'')+
   (scheduleCapacityDraft?' data-capacity-plan-draft':'')+
   (!scheduleLeadDraft&&!scheduleCapacityDraft?' data-hourly-manual-form':'')+
   ' class="grid">'+
  scheduleItemFields(null)+'<button type="submit" class="primary wide">'+
  (scheduleCapacityDraft?.workOrderId?'Сохранить план заказа':'Создать пункт плана')+'</button></form></details>';
 return s;
}
function scheduleCalendarDayKind(day){
 const source=schedule.calendarDayPolicy;
 if(!source||source.version!=='CALENDAR_WORKING_DAY_V194_V195'||
  source.policyVersion!=='SHARED_CAPACITY_MON_SAT_MONTHLY_BANK_REVIEW_V2'||
  source.periodStart!==schedule.periodStart||source.periodEnd!==schedule.periodEnd||
  !source.days||!Object.hasOwn(source.days,day))return 'UNVERIFIED';
 const status=source.days[day];
 return ['SUNDAY','MONTHLY_REVIEW','WORKING_DAY'].includes(status)?status:'UNVERIFIED';
}
function scheduleView(){
 const p=schedule,anchor=p.anchorDate||data.today;
 let s='<h1>План работ</h1><p class="muted">Ручные задачи, планы заказов и управляемые напоминания CRM показываются в одном календаре. Изменения заказа синхронизируются с его планом. Назначения сотрудников отображаются по выбранным заказам и ручным задачам.</p>';
 if(scheduleCapacityDraft)s+=scheduleNewEditorView(); // active order draft before long calendar
 if(capacityWorkOrderContext)s+=capacityPanelView(); // linked finder above calendar
 s+='<section class="card"><div class="schedule-toolbar"><button type="button" data-schedule-move="-1" aria-label="Предыдущий период">←</button>'+
  '<button type="button" data-schedule-today>Сегодня</button><button type="button" data-schedule-move="1" aria-label="Следующий период">→</button></div>'+
  '<div class="schedule-toolbar"><button type="button" data-schedule-mode="week" class="'+(p.viewMode==='week'?'primary':'')+'">Неделя</button>'+
  '<button type="button" data-schedule-mode="month" class="'+(p.viewMode==='month'?'primary':'')+'">Месяц</button></div>'+
  '<form id="scheduleAnchor" class="grid">'+editText('anchorDate','Показать дату',anchor,'date','required')+
  '<button type="submit" class="wide-button">Открыть период</button></form>';
 if(!p.loaded)return s+(p.error?'<p role="alert" class="muted schedule-load-error">Не удалось загрузить план: '+esc(p.error)+
  '</p><button type="button" data-schedule-retry>Повторить загрузку</button>':
  '<p class="muted">Загружаю расписание из PostgreSQL.</p>')+'</section>';
 s+='<p class="muted small">Период: '+esc(p.periodStart)+' — '+esc(p.periodEnd)+' · пунктов: '+fmt(p.total)+
   (p.hasMore?' · загружено '+fmt(p.items.length)+' (не все)':'')+'</p>';
 if(p.error)s+='<p role="alert" class="muted schedule-load-error">Не удалось загрузить следующую страницу: '+esc(p.error)+'</p>';
 const days=[];let day=p.periodStart;while(day<=p.periodEnd){days.push(day);day=scheduleShiftDay(day,1);}
 const count=new Map();for(const item of p.items)count.set(item.schedule_date,(count.get(item.schedule_date)||0)+1);
 const overlapCounts=scheduleOverlapCounts(); // full verified planned source; page counts are insufficient
 // Calendar weeks start on Monday. Only month mode needs empty cells before day 1.
 const mondayOffset=(new Date(p.periodStart+'T00:00:00Z').getUTCDay()+6)%7;
 const emptyCells=p.viewMode==='month'?Array.from({length:mondayOffset},()=>'<span class="schedule-day-empty" aria-hidden="true"></span>').join(''):'';
 const weekdayNames=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
 if(p.calendarDayPolicy?.version==='CALENDAR_WORKING_DAY_V194_V195')
  s+='<div class="schedule-policy-legend" role="note">🟩 День фирмы · ИП / анализ · ⬚ воскресенье — нерабочий день Capacity. Суббота рабочая. Дни остаются открываемыми для личных задач.</div>';
 s+='<div class="schedule-day-grid" role="group" aria-label="Календарь с понедельника">'+
  weekdayNames.map(name=>'<span class="schedule-weekday">'+name+'</span>').join('')+
  emptyCells+days.map(d=>{
   const label=d.slice(8),cnt=count.get(d)||0;
   const overlap=overlapCounts?.get(d)||0,kind=scheduleCalendarDayKind(d);
   const company=kind==='MONTHLY_REVIEW',sunday=kind==='SUNDAY';
   const policyText=company?'День фирмы':sunday?'Выходной':'';
   return '<button type="button" data-schedule-day="'+esc(d)+'"'+
    (company?' data-calendar-company-day="true"':sunday?' data-calendar-sunday="true"':'')+
    (kind!=='UNVERIFIED'&&d<data.today?' data-calendar-past="true"':'')+
    (overlap>=2?' data-schedule-overlap="true"':'')+
    (scheduleOverlapActive===d?' data-schedule-overlap-active="true"':'')+
    (scheduleFreeActive===d?' data-schedule-free-active="true"':'')+
    ' class="schedule-day '+(p.selectedDay===d?'selected':'')+'" aria-label="'+esc(d+(policyText?', '+policyText:''))+'">'+
    '<span>'+esc(label)+'</span>'+(cnt?'<small>'+esc(cnt)+'</small>':'')+
    (policyText?'<small class="calendar-policy-badge" title="'+esc(company?'День фирмы · ИП / анализ':'Выходной · воскресенье')+'">'+esc(company?'ИП':'Вых.')+'</small>':'')+
    scheduleOverlapBadge(d,overlapCounts)+hourlyMiniFor(d)+'</button>';
  }).join('')+'</div>';
 s+=scheduleOverlapToolbar(overlapCounts)+scheduleFreeToolbar(overlapCounts);
 if(p.hasMore)s+='<p class="muted small">В календаре показана первая страница. Открой «Показать ещё», чтобы увидеть остальные пункты периода.</p>';
 s+='</section>';
 // Shared legacy Capacity finder belongs inside Plan/Calendar, not a separate navigation route.
 if(!capacityWorkOrderContext)s+=capacityPanelView(); // free mode retains original position
 const focused=p.selectedDay&&p.selectedDay>=p.periodStart&&p.selectedDay<=p.periodEnd?p.selectedDay:anchor;
 s+='<section class="card"><h2>План на '+esc(focused)+'</h2>'+
  '<button type="button" class="compact" data-hourly-add-day="'+esc(focused)+'">'+
  (hourlySunday(focused)?'+ Личное / орг. · ':'+ Добавить в день · ')+
  esc(focused.slice(8,10)+'.'+focused.slice(5,7))+'</button>';
 const chosen=p.items.filter(x=>x.schedule_date===focused);
 const totals=scheduleDaySummary(chosen,focused),filter=scheduleDayFilters.some(([id])=>id===p.dayFilter)?p.dayFilter:'all';
 s+=hourlyDayView(focused);
 s+='<p class="muted small">'+(p.hasMore?'По загруженной части плана: ':'За выбранный день: ')+
  fmt(chosen.length)+' '+schedulePointWord(chosen.length)+' · '+fmt(totals.planned)+' к выполнению · '+
  fmt(totals.completed)+' выполнено · '+fmt(totals.cancelled)+' отменено'+
  (totals.overdue?' · '+fmt(totals.overdue)+' просрочено':'')+'</p>';
 s+='<div class="schedule-day-filters" role="group" aria-label="Фильтр плана на день">'+
  scheduleDayFilters.map(([id,name])=>'<button type="button" data-schedule-filter="'+esc(id)+
   '" aria-pressed="'+(id===filter?'true':'false')+'" class="'+(id===filter?'primary':'')+
   '">'+esc(name)+'</button>').join('')+'</div>';
 const visible=scheduleFilterEntries(chosen,filter);
 s+=visible.length?visible.map(scheduleItemCard).join(''):'<p class="muted">'+
  (p.hasMore?'На загруженной странице нет подходящих пунктов; остальная часть ещё не загружена.':
   filter==='all'?'На выбранный день пока ничего не запланировано.':'Пунктов с таким статусом на выбранный день нет.')+'</p>';
 if(p.hasMore)s+='<p class="muted small">Подсчёты по дню могут быть неполными. Используй «Показать ещё 50» ниже.</p>';
 s+='</section>';
 if(!scheduleCapacityDraft)s+=scheduleNewEditorView();
 s+='<details class="card"><summary>Все пункты периода ('+fmt(p.items.length)+')</summary>'+
  (p.items.length?p.items.map(scheduleItemCard).join(''):'<p class="muted">План пока пуст.</p>')+'</details>';
 if(p.hasMore)s+='<button type="button" class="primary wide-button" data-schedule-more>Показать ещё 50</button>';
 return s;
}
async function loadSchedule(append=false){
 if(schedule.loading)return;
 const loadingMore=append&&schedule.loaded&&schedule.hasMore&&schedule.nextCursor;
 const requestedMode=schedule.viewMode,requestedAnchor=schedule.anchorDate||data.today;
 schedule.loading=true;schedule.error='';
 if(!loadingMore){invalidateCapacity();invalidateHourlySchedule();resetHourlyManual();resetScheduleOverlap();schedule.loaded=false;schedule.items=[];schedule.hasMore=false;schedule.nextCursor=null;schedule.calendarDayPolicy=null;}
 if(tab==='schedule')render();
 try{
  const params=new URLSearchParams({viewMode:requestedMode,anchorDate:requestedAnchor});
  if(loadingMore)params.set('cursor',schedule.nextCursor);
  const result=await api('/api/schedule?'+params.toString());
  if(result?.viewMode!==requestedMode||result.anchorDate!==requestedAnchor||
   !Array.isArray(result.items)||!Number.isInteger(result.total)||result.total<result.items.length||
   typeof result.hasMore!=='boolean')throw Error('Ответ календаря не прошёл проверку источника.');
  schedule.anchorDate=result.anchorDate;schedule.periodStart=result.periodStart;schedule.periodEnd=result.periodEnd;
  schedule.calendarDayPolicy=result.calendarDayPolicy||null;
  schedule.items=loadingMore?schedule.items.concat(result.items):result.items;
  schedule.total=result.total;schedule.hasMore=result.hasMore;schedule.nextCursor=result.nextCursor;
  if(result.hasMore&&!result.nextCursor)throw Error('Отсутствует указатель следующей страницы.');
  schedule.loaded=true;
  if(!schedule.selectedDay||schedule.selectedDay<result.periodStart||schedule.selectedDay>result.periodEnd)
   schedule.selectedDay=result.anchorDate;
 }catch(e){schedule.error=e.message;message('План: '+e.message,true);}
 finally{schedule.loading=false;if(tab==='schedule'){render();if(!loadingMore&&schedule.loaded)void loadHourlySchedule();}}
}
