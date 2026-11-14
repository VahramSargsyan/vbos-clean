'use strict';
/*
 * VBOS CLEAN TODAY COMMAND CENTER V1
 * Legacy reference: Today.html v0.10.2 (2026-09-06).
 * Read-only composition of authenticated canonical /api/a1, /api/my-work,
 * /api/crm/followups and /api/schedule. Never infer money from WorkLog minutes.
 * Never synthesize ScheduleItems from WorkOrders or lead reminders.
 */
let todayDashboard={date:'',loaded:false,loading:false,work:null,crm:null,plan:null,errors:{}};
function todayStatusError(key){
 const e=todayDashboard.errors?.[key];
 return '<p class="muted small" role="status">'+esc(e?'Источник недоступен: '+e:'Загружаю данные…')+'</p>';
}
function todayRouteButton(route,text,extra=''){
 return '<button type="button" class="compact" data-today-route="'+esc(route)+'" '+extra+'>'+esc(text)+'</button>';
}
function todayMetric(title,value,detail=''){
 return '<div class="card"><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong>'+
  (detail?'<p class="muted small">'+esc(detail)+'</p>':'')+'</div>';
}
function todayScheduleItem(item){
 return '<article class="record"><strong>'+esc(item.title)+'</strong><div class="meta">'+
  esc(item.schedule_date)+' · '+esc(item.start_at?scheduleLocalTime(item.start_at).slice(11):'время не указано')+
  ' · '+esc(scheduleStatusLabel[item.status]||item.status)+
  (item.object_name?' · '+esc(item.object_name):'')+'</div></article>';
}
function todayDashboardView(){
 const day=data.today,view=todayDashboard,ready=view.loaded&&view.date===day;
 const work=ready?view.work:null,crm=ready?view.crm:null,plan=ready?view.plan:null;
 let s='<section class="today-command" aria-label="Командный центр дня">'+
  '<div class="today-head"><div><h1>Сегодня · '+esc(day)+'</h1>'+
  '<p class="muted">Главное на день: цель, внимание, план и состояние работы.</p></div>'+
  '<button type="button" class="compact" data-today-refresh'+(view.loading?' disabled':'')+'>Обновить</button></div>'+
  '<div class="today-quick-actions">'+todayRouteButton('crm','+ Новый лид','data-today-intent="newLead"')+
  todayRouteButton('myWork','Моя работа')+todayRouteButton('schedule','План')+
  todayRouteButton('finance','Деньги')+'</div>';
 s+=a1Card();
 s+='<section class="card"><div class="row"><h2>Требует внимания</h2>'+todayRouteButton('crm','Открыть CRM')+'</div>';
 if(!crm)s+=todayStatusError('crm');
 else{
  const buckets=crm.buckets||{},groups=[['overdue','Просрочено'],['today','На сегодня'],['noNext','Без следующего шага'],['stale','Зависшие']];
  s+='<div class="today-mini-grid" aria-label="Приоритеты CRM">'+groups.map(([key,name])=>
   todayMetric(name,fmt(buckets[key]?.count||0))).join('')+'</div>';
  const top=crm.priority?.items||[];
  if(!top.length)s+='<p class="muted">В CRM нет обращений, требующих внимания.</p>';
  else s+=top.slice(0,4).map(x=>'<article class="record"><strong>'+esc(x.title)+'</strong>'+
    '<p class="muted small">'+esc(x.reason||'Требуется действие')+'</p>'+
    (x.nextAction?'<p class="muted small">Следующий шаг: '+esc(x.nextAction)+
      (x.nextActionLocal?' · '+esc(x.nextActionLocal.replace('T',' ')):'')+'</p>':'')+
    '<button type="button" class="compact" data-today-lead="'+esc(x.leadId)+'">Открыть обращение</button></article>').join('');
  if(crm.priority?.count>4)s+='<p class="muted small">Показаны 4 приоритета из '+fmt(crm.priority.count)+'. Полный список — в CRM.</p>';
 }
 s+='</section>';
 s+='<section class="card"><div class="row"><h2>План: сегодня / неделя</h2>'+todayRouteButton('schedule','Открыть план')+'</div>';
 if(!plan)s+=todayStatusError('plan');
 else{
  const entries=plan.items.filter(x=>x.schedule_date===day&&x.status==='planned');
  s+='<p class="muted small">Неделя '+esc(plan.periodStart)+' — '+esc(plan.periodEnd)+
   ' · всего пунктов: '+fmt(plan.total)+' (включая завершённые и отменённые)</p>';
  s+=entries.slice(0,5).map(todayScheduleItem).join('');
  if(!entries.length)s+='<p class="muted">'+(plan.hasMore?'В загруженной части плана задач на сегодня нет. Список неполный.':'Невыполненных задач на сегодня нет.')+'</p>';
  if(entries.length>5||plan.hasMore)s+='<p class="muted small">Показаны не все пункты; полный план доступен в календаре.</p>';
 }
 s+='</section>';
 s+='<section class="card"><div class="row"><h2>Бизнес сейчас</h2>'+todayRouteButton('finance','Финансы')+'</div>'+
  '<p class="muted small">Операционный пульс за сегодня; WorkLog — не денежная выручка и не зарплата.</p>';
 if(!work||!crm)s+=!work?todayStatusError('work'):todayStatusError('crm');
 else s+='<div class="today-mini-grid">'+
   todayMetric('Работы записаны',fmt(work.todayTotals.logCount),'Из WorkLog за '+day)+
   todayMetric('Минут записано',fmt(work.todayTotals.workMinutes),'Сумма длительности WorkLog, не рабочее время персонала')+
   todayMetric('Открытых обращений',fmt(crm.openLeadCount),'Канонические CRM Leads')+
   todayMetric('Рабочий интервал',work.currentSession?'Идёт':'Нет активного','Только WorkSession владельца')+
   '</div>';
 s+='<p class="muted small">Денежные показатели смотри отдельно в «Финансах»: исторические суммы и текущую деятельность нельзя складывать.</p></section>';
 s+='<section class="card"><div class="row"><h2>Ближайшие действия</h2>'+todayRouteButton('schedule','Неделя')+'</div>';
 if(!plan)s+=todayStatusError('plan');
 else{
  const upcoming=plan.items.filter(x=>x.schedule_date>day&&x.status==='planned').slice(0,4);
  s+=upcoming.map(todayScheduleItem).join('');
  if(!upcoming.length)s+='<p class="muted">'+(plan.hasMore?'Дальнейшие действия могут быть на следующей странице плана.':'На оставшуюся неделю действий пока нет.')+'</p>';
  if(plan.hasMore)s+='<p class="muted small">Данные частичные: показаны первые 50 из '+fmt(plan.total)+' пунктов недели.</p>';
 }
 s+='</section>';
 s+='<details class="card today-more"><summary>Дополнительно · объекты, отчёты и состояние данных</summary>'+
  '<p class="muted small">Объекты в загруженном списке: '+fmt((data.objects||[]).length)+
  (data.listsTruncated?' · список ограничен первыми 500 записями':'')+'.</p>'+
  '<div class="actions">'+todayRouteButton('catalog','Поиск объектов')+todayRouteButton('report','Отчёты и экспорт')+'</div>'+
  '<h3>Источники сегодня</h3>'+
  '<p class="muted small">A1: '+esc(dailyA1?'PostgreSQL':'недоступен')+
  ' · CRM: '+esc(crm?'подтверждён':'недоступен')+
  ' · план: '+esc(plan?'подтверждён':'недоступен')+
  ' · работа: '+esc(work?'подтверждён':'недоступен')+'</p>'+
  '</details></section>';
 return s;
}
async function loadTodayDashboard(){
 if(!data||todayDashboard.loading)return;
 const day=data.today,view=todayDashboard;
 view.date=day;view.loading=true;view.loaded=false;view.errors={};
 if(tab==='today')render();
 const sources=[
  ['work','/api/my-work'],
  ['crm','/api/crm/followups?limit=6'],
  ['plan','/api/schedule?viewMode=week&anchorDate='+encodeURIComponent(day)]
 ];
 const results=await Promise.allSettled(sources.map(x=>api(x[1])));
 // Do not render data from a past login/day after logout or midnight refresh.
 if(todayDashboard!==view||!data||data.today!==day){view.loading=false;return;}
 for(let i=0;i<sources.length;i++){
  const key=sources[i][0],r=results[i];view[key]=null;
  if(r.status==='rejected'){view.errors[key]=r.reason?.message||'Ошибка запроса';continue;}
  const payload=r.value;
  const verified=key==='work'?payload?.today===day&&Number.isFinite(Number(payload?.todayTotals?.logCount))&&
   Number.isFinite(Number(payload?.todayTotals?.workMinutes)):
   key==='crm'?payload?.version==='CRM07A_READ_ONLY'&&payload.todayKey===day&&payload.coverage?.complete===true&&
    payload.priority?.coverage?.complete===true:
   payload?.viewMode==='week'&&payload?.anchorDate===day&&payload.periodStart<=day&&payload.periodEnd>=day&&
    Array.isArray(payload.items)&&Number.isFinite(Number(payload.total));
  if(!verified){view.errors[key]='Ответ источника не подтверждён';continue;}
  view[key]=payload;
 }
 view.loaded=true;view.loading=false;
 if(tab==='today')render();
}
