'use strict';
/* V9E: roster, attendance and independent WorkerTasks; never infer WorkLog or payroll. */
const workerStatusLabel={active:'Работает',inactive:'Неактивен',archived:'Архив'};

let workerBenchmarkCache={};
async function loadWorkerBenchmarks(workerId){
 if(workerBenchmarkCache[workerId]?.loading)return;
 workerBenchmarkCache[workerId]={loading:true};render();
 try{
  const payload=await api('/api/worker-benchmarks?workerId='+encodeURIComponent(workerId)+'&compare=previous');
  workerBenchmarkCache[workerId]={loaded:true,payload};
 }catch(e){workerBenchmarkCache[workerId]={error:String(e.message||e)};}
 render();
}
function workerBenchmarkPanel(worker){
 const snapshot=workerBenchmarkCache[worker.id],result=snapshot?.payload;
 let html='<details class="worker-benchmarks"'+(snapshot?' open':'')+'><summary>Фактическая скорость работы · наблюдения</summary>'+
  '<p class="muted small">Только завершённые задачи с положительным количеством. Это не утверждённый норматив, не баллы и не основание для зарплаты. Старая история Google не импортирована.</p>'+
  '<button type="button" class="compact" data-worker-benchmark-load="'+esc(worker.id)+'"'+(snapshot?.loading?' disabled':'')+'>90 дней · сравнить с предыдущими · обновить</button>';
 if(snapshot?.loading)html+='<p class="muted">Считаю по сохранённым задачам…</p>';
 if(snapshot?.error)html+='<p class="muted">Не удалось рассчитать: '+esc(snapshot.error)+'</p>';
 if(result){
  html+='<p class="muted small">Период '+esc(result.from)+' — '+esc(result.to)+
   ' · подходящих задач: '+fmt(result.sampleCount)+'</p>';
  if(result.compareMode==='previous')
   html+='<p class="muted small">Предыдущий период: '+esc(result.previousFrom)+' — '+esc(result.previousTo)+
    ' · измеримых задач: '+fmt(result.previousSampleCount)+'. Сравнение наблюдений, не норматив.</p>';
  if(!result.items.length)html+='<p class="muted">Пока нет задач с измеримым результатом. Это не означает нулевую производительность.</p>';
  for(const b of result.items){
   html+='<article class="record"><strong>'+esc(b.taskType)+' · '+esc(b.resultUnit)+'</strong>'+
    '<p>Средний наблюдаемый темп: '+fmt(b.observedPerHour)+' '+esc(b.resultUnit)+'/час</p>'+
    '<p class="muted small">Лучший зафиксированный темп: '+fmt(b.bestPerHour)+' '+esc(b.resultUnit)+
    '/час · задач: '+fmt(b.sampleCount)+' · результат: '+fmt(b.totalResult)+' '+esc(b.resultUnit)+
    ' · время: '+fmt(b.totalMinutes)+' мин</p>';
   if(result.compareMode==='previous'){
    if(b.previousSampleCount){
     const change=Number(b.observedChangePct),sign=change>0?'+':'';
     html+='<p class="muted small">В предыдущем периоде: '+fmt(b.previousObservedPerHour)+' '+
      esc(b.resultUnit)+'/час · задач: '+fmt(b.previousSampleCount)+
      ' · изменение наблюдаемого темпа: '+sign+fmt(change)+'%.</p>';
     if(b.previousSampleCount<3||b.sampleCount<3)
      html+='<p class="muted small">Мало замеров: динамика пока ненадёжна.</p>';
    }else html+='<p class="muted small">Нет сопоставимых задач в предыдущем периоде — изменение не рассчитывается.</p>';
   }
   html+='</article>';
  }
 }
 return html+'</details>';
}


let benchmarkProposalState={loaded:false,loading:false,error:'',payload:null};
async function loadBenchmarkProposals(){
 if(benchmarkProposalState.loading)return;
 benchmarkProposalState.loading=true;benchmarkProposalState.error='';render();
 try{
  benchmarkProposalState.payload=await api('/api/benchmark-proposals');
  benchmarkProposalState.loaded=true;
 }catch(err){benchmarkProposalState.error=String(err.message||err);}
 benchmarkProposalState.loading=false;render();
}
function benchmarkProposalsPanel(){
 const s=benchmarkProposalState,r=s.payload;
 let html='<details class="card benchmark-proposals"'+(s.loaded||s.loading||s.error?' open':'')+'>'+
  '<summary>Исторические скорости · ручное утверждение</summary>'+
  '<p class="muted small">История владельца из проверенного legacy PostgreSQL. Исходные значения предварительные (PROVISIONAL), не становятся нормативами автоматически. Не влияют на оценку сотрудников и зарплату.</p>'+
  '<button class="compact" type="button" data-benchmark-proposals-load'+(s.loading?' disabled':'')+'>Загрузить / обновить предложения</button>';
 if(s.loading)html+='<p class="muted">Загружаю данные из TEST PostgreSQL…</p>';
 if(s.error)html+='<p class="muted">Ошибка: '+esc(s.error)+'</p>';
 if(r){
  html+='<p class="muted small">Исторических предложений: '+fmt(r.items.length)+'. Каждое решение утверждается отдельно владельцем.</p>';
  if(!r.items.length)html+='<p class="muted">Предложения ещё не импортированы. Утверждённых нормативов нет.</p>';
  for(const x of r.items){
   const approved=x.approval_status==='APPROVED',revision=x.approval_revision??0;
   html+='<article class="record"><div class="row"><strong>'+esc(x.work_type)+' · '+esc(x.result_unit)+'</strong>'+
    '<span class="tag">'+(approved?'Утверждён':x.approval_status==='REVOKED'?'Отменён':'Предложение')+'</span></div>'+
    '<p>Наблюдаемая скорость: '+fmt(x.observed_rate)+' '+esc(x.result_unit)+'/час</p>'+
    '<p class="muted small">Замеров: '+fmt(x.sample_count)+' · результат '+fmt(x.total_result)+' '+esc(x.result_unit)+
    ' · '+fmt(x.total_minutes)+' мин · лучший темп '+fmt(x.best_observed)+' '+esc(x.result_unit)+'/час</p>';
   if(Number(x.sample_count)<3)html+='<p class="muted small">Мало замеров: предварительная скорость может быть ненадёжной.</p>';
   if(x.source_updated_at)html+='<p class="muted small">Источник: обновление '+esc(String(x.source_updated_at).slice(0,10))+'</p>';
   if(approved)html+='<p>Твой утверждённый норматив: <strong>'+fmt(x.approved_rate)+' '+esc(x.result_unit)+'/час</strong></p>';
   if(x.approval_status)html+='<p class="muted small">Решение №'+fmt(revision)+' · '+esc(x.approval_reason||'—')+'</p>';
   html+='<details class="edit-panel"><summary>'+(approved?'Изменить утверждённое значение':'Утвердить вручную')+'</summary>'+
    '<form class="grid" data-act="benchmark_approve">'+
    '<input type="hidden" name="benchmarkId" value="'+esc(x.benchmark_id)+'">'+
    '<input type="hidden" name="revision" value="'+esc(revision)+'">'+
    editText('approvedRate','Выбранный норматив, '+x.result_unit+'/час',approved?x.approved_rate:x.observed_rate,'text','required inputmode="decimal" maxlength="14"')+
    editText('reason','Обоснование решения','','textarea','required minlength="3" maxlength="1000"')+
    '<label class="small"><input type="checkbox" name="confirmed" value="yes" required> Лично подтверждаю выбранное значение. Без расчёта зарплаты.</label>'+
    '<button type="submit" class="primary wide">Утвердить норматив</button></form></details>';
   if(approved)html+='<details class="edit-panel"><summary>Отменить утверждение</summary>'+
    '<form class="grid" data-act="benchmark_revoke">'+
    '<input type="hidden" name="benchmarkId" value="'+esc(x.benchmark_id)+'">'+
    '<input type="hidden" name="revision" value="'+esc(revision)+'">'+
    editText('reason','Почему отменяю','','textarea','required minlength="3" maxlength="1000"')+
    '<label class="small"><input type="checkbox" name="confirmed" value="yes" required> Подтверждаю отмену</label>'+
    '<button type="submit" class="compact">Отменить норматив</button></form></details>';
   html+='</article>';
  }
  if(r.events?.length){
   html+='<details class="edit-panel"><summary>История решений · последние '+fmt(r.events.length)+'</summary>';
   for(const ev of r.events)html+='<p class="muted small">'+
    esc(ev.action==='benchmark_approve'?'Утверждение':'Отмена')+' · '+esc(ev.benchmark_id)+
    ' · версия '+fmt(ev.revision)+' · '+esc(ev.reason)+'</p>';
   if(r.eventsHasMore)html+='<p class="muted small">Показаны последние 30 решений. Все сохранены в PostgreSQL/экспорте.</p>';
   html+='</details>';
  }
 }
 return html+'</details>';
}

function workerSelectOptions(workers,exclude=[]){
 return '<option value="">Выбери сотрудника</option>'+
  workers.filter(w=>w.status==='active'&&!exclude.includes(w.id))
   .map(w=>'<option value="'+esc(w.id)+'">'+esc(w.name+(w.role_title?' · '+w.role_title:''))+'</option>').join('');
}
function workerOrderPanel(order){
 const rows=(data.workerOrderAssignments||[]).filter(x=>x.order_id===order.id&&x.status==='active');
 const roster=data.workers||[],assigned=rows.map(x=>x.worker_id);
 const existing=rows.map(a=>{
  const w=roster.find(x=>x.id===a.worker_id);
  return '<div class="record"><div class="row"><strong>'+esc(w?.name||'Сотрудник вне текущего списка')+'</strong><span class="tag">'+esc(w?workerStatusLabel[w.status]||w.status:'Связь сохранена')+'</span></div>'+
   '<button type="button" class="compact" data-act="worker_remove_order" data-worker-id="'+esc(a.worker_id)+'" data-order-id="'+esc(order.id)+'">Снять с заказа</button></div>';
 }).join('');
 const choices=workerSelectOptions(roster,assigned);
 let result='<h2>Исполнители заказа</h2>'+(rows.length?existing:'<p class="muted">Исполнители ещё не назначены.</p>');
 if(['open','active'].includes(order.status)&&roster.some(w=>w.status==='active'&&!assigned.includes(w.id)))
  result+='<form data-act="worker_assign_order" class="grid">'+
   '<input type="hidden" name="orderId" value="'+esc(order.id)+'">'+
   select('workerId','Назначить исполнителя',choices)+
   '<button type="submit" class="primary wide">Назначить на заказ</button></form>';
 else if(!['open','active'].includes(order.status))
  result+='<p class="muted small">Заказ закрыт: новые назначения заблокированы, история сохранена.</p>';
 return result;
}
function workerCard(w){
 const status=workerStatusLabel[w.status]||w.status;
 let fields=editText('name','Имя',w.name,'text','maxlength="160" required')+
  editText('phone','Телефон',w.phone,'tel','maxlength="60"')+
  editText('roleTitle','Специализация',w.role_title,'text','maxlength="160"')+
  editText('notes','Примечание',w.notes,'textarea','maxlength="5000"')+
  select('status','Статус',Object.entries(workerStatusLabel)
   .map(([value,label])=>'<option value="'+esc(value)+'" '+(value===w.status?'selected':'')+'>'+esc(label)+'</option>').join(''));
 return '<article class="record"><div class="row"><strong>'+esc(w.name)+'</strong><span class="tag">'+esc(status)+'</span></div>'+
  (w.role_title?'<p class="muted small">'+esc(w.role_title)+'</p>':'')+
  (w.phone?'<p class="muted small">Тел.: '+esc(w.phone)+'</p>':'')+
  (w.notes?'<p class="muted small">'+esc(w.notes)+'</p>':'')+
  editRecord('worker_update',w,fields)+workerBenchmarkPanel(w)+workerDayPanel(w)+'</article>';
}
function workersView(){
 const workers=data.workers||[];
 let html='<h1>Исполнители</h1>'+
  '<p class="muted">Сотрудники, назначения и фактический приход/уход. Присутствие не является выполненной работой и не создаёт начисления зарплаты.</p>'+
  '<section class="card"><p>Сотрудников: '+fmt(workers.length)+', действующих: '+fmt(workers.filter(w=>w.status==='active').length)+'</p></section>';
 html+=benchmarkProposalsPanel();
 html+=form('worker_create','+ Добавить сотрудника',
  editText('name','Имя сотрудника','','text','required maxlength="160"')+
  editText('phone','Телефон (необязательно)','','tel','maxlength="60"')+
  editText('roleTitle','Специализация','','text','maxlength="160"')+
  editText('notes','Примечание','','textarea','maxlength="5000"'));
 html+='<section class="card"><h2>Сотрудники</h2>'+
  (workers.length?workers.map(workerCard).join(''):'<p class="muted">Сотрудников пока нет. Добавь первого исполнителя.</p>')+
  '</section>';
 return html;
}

const workerDayReasonLabel={
 work_done_early:'Работа завершена раньше',no_work_front:'Нет фронта работ',
 no_materials:'Нет материалов',site_problem:'Проблема на объекте',personal_reason:'Личная причина',
 manager_decision:'Решение руководителя',unwell:'Плохое самочувствие',
 activity_not_recorded:'Задачи работника пока не учтены',other:'Другое'
};
function workerDayReasonSelect(value=''){
 return '<label>Причина окончания смены (обязательна)<select name="closeReasonCode" required>'+
 '<option value="">Выбери причину</option>'+Object.entries(workerDayReasonLabel).map(([k,name])=>
 '<option value="'+esc(k)+'" '+(k===value?'selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label>';
}
function workerTaskPanel(day,links){
 const records=(data.workerTasks||[]).filter(t=>t.worker_day_id===day.id&&t.status!=='archived')
  .sort((a,b)=>String(b.start_at).localeCompare(String(a.start_at)));
 const active=records.find(t=>t.status==='active');
 const linkedOrders=links.map(l=>(data.orders||[]).find(o=>o.id===l.work_order_id))
  .filter(o=>o&&['open','active'].includes(o.status));
 let html='<details class="worker-day-panel"><summary>Задачи смены · '+fmt(records.length)+
  (active?' · Идёт задача':'')+'</summary>'+
  '<p class="muted small">Задачи отражают фактически выполняемую работу сотрудника. Не создают WorkLog и не рассчитывают зарплату.</p>';
 if(day.status==='open'&&!active&&linkedOrders.length){
  html+='<form data-act="worker_task_start" class="grid">'+
   '<input type="hidden" name="workerDayId" value="'+esc(day.id)+'">'+
   '<input type="hidden" name="workerId" value="'+esc(day.worker_id)+'">'+
   select('orderId','Заказ задачи',linkedOrders.map(o=>'<option value="'+esc(o.id)+'">'+esc(o.title)+'</option>').join(''))+
   editText('startAt','Начало задачи',day.day_date+'T'+day.arrival_at.slice(11),'datetime-local','required')+
   editText('notes','Примечание','','textarea','maxlength="5000"')+
   '<button type="submit" class="primary wide">Начать задачу</button></form>';
 }
 if(!records.length)html+='<p class="muted">Задачи ещё не записаны.</p>';
 for(const task of records){
  html+='<article class="record"><div class="row"><strong>'+esc(task.status==='active'?'Задача в работе':task.task_type)+'</strong>'+
   '<span class="tag">'+esc(task.status==='active'?'Выполняется':'Завершена')+'</span></div>'+
   '<p>'+esc(task.start_at.slice(11))+' — '+esc(task.end_at?task.end_at.slice(11):'в работе')+
   (task.duration_minutes?' · '+fmt(task.duration_minutes)+' мин':'')+'</p>';
  if(task.status==='completed'){
   html+='<p class="muted small">Результат: '+esc(task.outcome)+
    (task.result_qty!==null?' · '+esc(task.result_qty)+' '+esc(task.result_unit):'')+
    ' · вмешательство '+fmt(task.management_minutes)+' мин'+
    (task.problem?' · была проблема':'')+(task.rework?' · переделка':'')+'</p>';
  }else if(day.status==='open'){
   html+='<form data-act="worker_task_finish" class="grid">'+
    '<input type="hidden" name="id" value="'+esc(task.id)+'">'+
    '<input type="hidden" name="revision" value="'+esc(task.revision)+'">'+
    editText('endAt','Конец задачи','','datetime-local','required')+
    editText('taskType','Вид выполненной работы','','text','required maxlength="200"')+
    editText('resultQty','Количество (если есть)','','number','min="0" step="0.001"')+
    editText('resultUnit','Единица измерения','','text','maxlength="100"')+
    editText('managementMinutes','Моё вмешательство, мин','0','number','min="0" max="1440" required')+
    select('outcome','Результат',[
     ['COMPLETED','Выполнено'],['PARTIAL','Частично'],['NOT_COMPLETED','Не выполнено'],['WITH_ERROR','С ошибкой']
    ].map(([v,n])=>'<option value="'+v+'">'+n+'</option>').join(''))+
    select('problem','Была проблема?', '<option value="no">Нет</option><option value="yes">Да</option>')+
    editText('problemType','Какая проблема','','text','maxlength="500"')+
    select('rework','Была переделка?', '<option value="no">Нет</option><option value="yes">Да</option>')+
    editText('reworkMinutes','Минуты переделки','0','number','min="0" max="1440"')+
    editText('notes','Примечание',task.notes,'textarea','maxlength="5000"')+
    '<button type="submit" class="primary wide">Завершить задачу</button></form>';
  }
  html+='</article>';
 }
 return html+'</details>';
}

function workerDayPanel(worker){
 const days=(data.workerDays||[]).filter(d=>d.worker_id===worker.id&&d.status!=='archived')
  .sort((a,b)=>String(b.day_date).localeCompare(String(a.day_date))).slice(0,6);
 const open=days.find(d=>d.status==='open');
 const links=data.workerDayOrders||[];
 const assignedIds=(data.workerOrderAssignments||[]).filter(a=>a.worker_id===worker.id&&a.status==='active').map(a=>a.order_id);
 const orders=(data.orders||[]).filter(o=>assignedIds.includes(o.id)&&['open','active'].includes(o.status));
 let html='<details class="worker-day-panel"><summary>Приход и уход · смены: '+fmt(days.length)+'</summary>'+
 '<p class="muted small">Это фактическое присутствие исполнителя, отдельно от WorkLog, задач, зарплаты и рабочего дня владельца.</p>';
 if(worker.status==='active'&&orders.length){
  const available=open?orders.filter(o=>!links.some(l=>l.worker_day_id===open.id&&l.work_order_id===o.id)):orders;
  if(available.length){
   html+='<form data-act="worker_day_arrive" class="grid">'+
    '<input type="hidden" name="workerId" value="'+esc(worker.id)+'">'+
    select('orderId',open?'Добавить заказ в открытую смену':'Заказ присутствия',
      available.map(o=>'<option value="'+esc(o.id)+'">'+esc(o.title)+'</option>').join(''))+
    (open?'<input type="hidden" name="date" value="'+esc(open.day_date)+'">'+
            '<input type="hidden" name="arrivalAt" value="'+esc(open.arrival_at)+'">'
          :editText('date','Дата прихода',data.today,'date','required')+
           editText('arrivalAt','Время прихода (дата и время)','','datetime-local','required')+
           editText('notes','Примечание','','textarea','maxlength="5000"'))+
    '<button class="primary wide" type="submit">'+(open?'Добавить заказ к смене':'Зафиксировать приход')+'</button></form>';
  }
 }else if(worker.status!=='active')html+='<p class="muted small">Новый приход недоступен неактивному исполнителю.</p>';
 else html+='<p class="muted small">Для прихода сначала назначь сотрудника на действующий заказ.</p>';
 if(!days.length)html+='<p class="muted">Смен пока нет.</p>';
 for(const day of days){
  const linked=links.filter(l=>l.worker_day_id===day.id&&l.status==='active');
  const orderNames=linked.map(l=>(data.orders||[]).find(o=>o.id===l.work_order_id)?.title||'Заказ вне текущего списка');
  html+='<article class="record"><strong>'+esc(day.day_date)+' · '+esc(day.status==='open'?'На объекте':'Завершена')+'</strong>'+
   '<p>'+esc(day.arrival_at.slice(11))+' — '+esc(day.departure_at?day.departure_at.slice(11):'ещё не ушёл')+'</p>'+
   '<p class="muted small">Заказы: '+esc(orderNames.join(', ')||'Нет связи в текущем списке')+'</p>'+
   workerTaskPanel(day,linked)+
   (day.close_reason_code?'<p class="muted small">Причина: '+esc(workerDayReasonLabel[day.close_reason_code]||day.close_reason_code)+(day.close_reason_note?' · '+esc(day.close_reason_note):'')+'</p>':'')+
   (day.status==='open'
    ?'<form data-act="worker_day_depart" class="grid">'+
     '<input type="hidden" name="id" value="'+esc(day.id)+'">'+
     '<input type="hidden" name="revision" value="'+esc(day.revision)+'">'+
     editText('departureAt','Уход (дата и время)','','datetime-local','required')+
     workerDayReasonSelect()+
     editText('closeReasonNote','Пояснение','','textarea','maxlength="2000"')+
     '<button type="submit" class="primary wide">Отметить уход</button></form>'
    :'')+
   '<details><summary>Исправить время или примечание</summary><form data-act="worker_day_correct" class="grid">'+
   '<input type="hidden" name="id" value="'+esc(day.id)+'">'+
   '<input type="hidden" name="revision" value="'+esc(day.revision)+'">'+
   editText('arrivalAt','Приход',day.arrival_at,'datetime-local','required')+
   (day.status==='closed'?editText('departureAt','Уход',day.departure_at,'datetime-local','required')+
     workerDayReasonSelect(day.close_reason_code)+editText('closeReasonNote','Пояснение причины',day.close_reason_note,'textarea','maxlength="2000"'):'')+
   editText('notes','Примечание',day.notes,'textarea','maxlength="5000"')+
   '<button type="submit" class="primary wide">Сохранить исправление</button></form></details></article>';
 }
 return html+'</details>';
}
