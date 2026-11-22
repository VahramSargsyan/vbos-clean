'use strict';
/* VBOS Clean My Work workflow V1: object/order context is a read projection.
 * WorkDay, ObjectPresence, WorkSession, WorkLog, OwnerActivity and WorkerTask
 * are separate canonical records. No order status, payroll or finance writes.
 */
function myWorkView(){
 const w=myWork.snapshot;
 let s='<h1>Сегодняшняя работа</h1><p class="muted small">Мой день, текущий заказ и выполненные работы. Подробная запись открывается в отдельном окне, как в старом VBOS.</p>'+
  '<button type="button" class="compact" data-work-reload>Обновить данные</button>';
 if(!w)return s+'<section class="card"><p class="muted">'+esc(myWork.error||'Загружаю текущую работу…')+'</p></section>';
 const day=w.day,live=w.currentSession,today=w.today,order=w.contextOrder,visit=w.currentPresence;
 const choices=new Map();
 for(const x of [order,...w.plannedOrders,...(data.orders||[])])
  if(x?.id&&(x.id===order?.id||['open','active'].includes(x.status)))choices.set(x.id,x);
 const selected=order?.id||'';
 s+='<section class="card"><h2>Сейчас · '+esc(today)+'</h2>'+
  '<div class="summary"><div class="card"><span>Рабочий день</span><strong>'+esc(day?(label[day.status]||day.status):'Не открыт')+'</strong></div>'+
  '<div class="card"><span>Интервал</span><strong>'+esc(live?'Идёт':'Нет активного')+'</strong></div>'+
  '<div class="card"><span>Присутствие</span><strong>'+esc(visit?'На объекте':'Не отмечено')+'</strong></div></div>';
 if(!day){
  if(live||visit)s+='<p role="alert" class="muted">Открыт интервал или присутствие другого дня. Сначала исправь запись.</p>';
  else{
   if(order&&['open','active'].includes(order.status))
    s+='<button type="button" class="primary wide-button" data-act="work_start_order" data-order-id="'+esc(order.id)+'">Начать день и работу по заказу</button>'+
     '<p class="muted small">Открывает день и интервал. Присутствие и A1 отмечаются отдельно.</p>';
   s+='<button type="button" class="wide-button" data-workflow-open="start">Открыть день без заказа</button>';
  }
 }else if(day.status==='open'){
  s+='<button type="button" class="primary wide-button" data-workflow-open="finish">Завершить день</button>';
  if(live||visit)s+='<p class="muted small">Нажми «Завершить день», чтобы увидеть оставшиеся шаги. Записи не закроются автоматически.</p>';
 }
 s+='<label>Текущий заказ<select id="myWorkOrderSelect"><option value="">Выбери заказ</option>'+
  [...choices.values()].map(o=>'<option value="'+esc(o.id)+'"'+(selected===o.id?' selected':'')+'>'+
   esc(o.title+' · '+(o.object_name||data.objects?.find(x=>x.id===o.object_id)?.name||'Объект')+
    ' · '+(label[o.status]||o.status))+'</option>').join('')+'</select></label>';
 if(w.morePlannedOrders||data.listsTruncated)
  s+='<p class="muted small">Список ограничен текущими заказами. Для остальных используй «Поиск».</p>';
 if(order){
  s+='<div class="record"><strong>'+esc(order.object_name)+'</strong>'+
   '<p>'+esc(order.title)+'</p>'+
   (order.object_address?'<p class="muted small">'+esc(order.object_address)+'</p>':'')+
   (order.client_name?'<p class="muted small">Клиент: '+esc(order.client_name)+'</p>':'')+
   '<p class="muted small">Заказ: '+esc(label[order.status]||order.status)+'</p></div>';
 }else if(w.selectedOrderId){
  s+='<p class="muted">Выбранный заказ недоступен. Выбери другой; запись работы отключена.</p>';
 }else if(visit){
  s+='<p class="muted">Ты на объекте «'+esc(visit.object_name)+'», но заказ не выбран. Отметка присутствия сама заказ не назначает.</p>';
 }else s+='<p class="muted">Выбери заказ для записи работ. Рабочий день можно вести и без заказа.</p>';
 s+='<p class="muted small"><strong>A1:</strong> '+esc(dailyA1?.item?.goal||'Ещё не задана')+'</p>';
 if(workFlowLastNotice)s+='<p class="full-worklog-receipt" role="status">'+esc(workFlowLastNotice)+'</p>';
 s+='</section>';
 const hasOrderSession=Boolean(order&&(
  (live?.day_date===today&&live.order_id===order.id)||w.todaySessions?.some(item=>item.order_id===order.id)));
 s+='<section class="card" data-workflow-quick><h2>Текущий заказ и действия</h2>'+
  (order&&['open','active'].includes(order.status)&&day?.status==='open'?
   '<p class="muted">Объект: '+esc(order.object_name)+' · заказ: '+esc(order.title)+'</p>'+
   (!hasOrderSession?
    (live?
     '<p role="alert" class="muted">Уже открыт интервал по заказу «'+esc(live.order_title||'Другой заказ')+
     '»'+(live.day_date!==today?' с '+esc(live.day_date):'')+
     '. Чтобы начать работу по выбранному заказу и записывать действия, сначала заверши прежний интервал. Интервал не закроется автоматически.</p>':
     '<p class="muted small">Сначала начни работу по выбранному заказу, затем добавляй результаты.</p>'+
     '<form data-act="session_start" class="grid"><input type="hidden" name="orderId" value="'+esc(order.id)+'">'+
     '<button type="submit" class="primary wide">Начать работу по заказу</button></form>'):
    '<button type="button" class="primary wide-button" data-workflow-open="log" data-order-id="'+esc(order.id)+'">+ Записать работу</button>'):
   '<p class="muted small">Для записи работы сначала открой день и выбери действующий заказ.</p>')+
  (live?'<button type="button" class="wide-button" data-act="session_stop" data-id="'+esc(live.id)+'">Завершить рабочий интервал</button>':'')+
 '</section>';
 s+='<section class="card"><h2>📍 Присутствие на объекте</h2>'+
  '<p class="muted small">Физический приход и уход — отдельно от начала и окончания рабочего интервала.</p>';
 if(visit){
  s+='<p><strong>'+esc(visit.object_name)+'</strong> · приход '+esc(when(visit.arrived_at))+'</p>'+
   (order&&visit.object_id!==order.object_id?'<p class="muted">Ты отмечен на другом объекте. Сначала отметь уход, затем приход на выбранный объект.</p>':'')+
   '<form data-act="presence_stop" class="grid">'+
   '<input type="hidden" name="id" value="'+esc(visit.id)+'">'+
   '<input type="hidden" name="date" value="'+esc(visit.day_date)+'">'+
   '<input type="hidden" name="revision" value="'+esc(visit.revision)+'">'+
   editText('departureTime','Время ухода',currentYerevanTime(),'time','required')+
   '<button type="submit" class="wide">Отметить уход</button></form>';
 }else if(day?.status==='open'&&order&&['open','active'].includes(order.status)){
  s+='<form data-act="presence_start" class="grid">'+
   '<input type="hidden" name="date" value="'+esc(today)+'">'+
   '<input type="hidden" name="objectId" value="'+esc(order.object_id)+'">'+
   '<input type="hidden" name="orderId" value="'+esc(order.id)+'">'+
   editText('arrivalTime','Время прихода',currentYerevanTime(),'time','required')+
   '<button type="submit" class="wide">Я на объекте · отметить приход</button></form>';
 }else s+='<p class="muted">Для отметки прихода открой день и выбери активный заказ.</p>';
 s+='</section>';

 s+='<details class="card" data-workflow-secondary><summary>Подробнее: интервалы и помощники</summary>';
 s+='<section class="card"><h2>Рабочий интервал</h2>';
 if(live){
  s+='<p><strong>Идёт:</strong> '+esc(live.order_title||'Без заказа')+' · '+esc(when(live.started_at))+'</p>'+
   (live.object_name?'<p class="muted small">Объект: '+esc(live.object_name)+'</p>':'')+
   (live.day_date!==today?'<p class="muted">Внимание: незавершённый интервал начался '+esc(live.day_date)+'. Сначала заверши его.</p>':'')+
   (order&&live.order_id&&order.id!==live.order_id?'<p class="muted">Выбранный заказ отличается от заказа активного интервала. Проверь привязку WorkLog.</p>':'')+
   '<button type="button" class="primary wide-button" data-act="session_stop" data-id="'+esc(live.id)+'">Завершить интервал</button>';
 }else if(day?.status==='open'&&order&&['open','active'].includes(order.status)){
  s+='<form data-act="session_start" class="grid">'+
   '<input type="hidden" name="orderId" value="'+esc(order.id)+'">'+
   formField('description','Чем занимаешься (необязательно)','text',false,'maxlength="300" placeholder="Например, монтаж отопления"')+
   '<button type="submit" class="primary wide">Начать работу по заказу</button></form>'+
   '<p class="muted small">Не отмечает приход и не меняет статус заказа.</p>';
 }else if(day?.status==='closed')s+='<p class="muted">Рабочий день уже закрыт.</p>';
 else if(!day)s+='<p class="muted">Сначала открой рабочий день.</p>';
 else if(order)s+='<p class="muted">По завершённому или отменённому заказу новый интервал не начинается.</p>';
 else s+='<p class="muted">Выбери активный заказ, чтобы начать интервал.</p>';
 s+='</section>';


 s+='<section class="card"><h2>Исполнители текущего заказа</h2>'+
  '<p class="muted small">Назначение, присутствие и выполненная задача не приравниваются друг к другу. Зарплата не рассчитывается.</p>';
 if(!order)s+='<p class="muted">Сначала выбери заказ.</p>';
 else if(!w.assignedWorkers?.length)s+='<p class="muted">Назначенных работников нет.</p>';
 else s+=w.assignedWorkers.map(x=>record(x.name,
  (x.role_title?x.role_title+' · ':'')+
  (x.day_status==='open'?'Сегодня на смене':x.day_status==='closed'?'Смена завершена':'Приход по заказу не отмечен'),
  '<p class="muted small">Задач сейчас: '+fmt(x.active_count)+' · завершено сегодня: '+fmt(x.completed_count)+
   ' · время завершённых задач: '+fmt(x.completed_minutes)+' мин</p>'+
   (x.latest_task_type?'<p class="muted small">Последняя задача: '+esc(x.latest_task_type)+
    ' · '+esc(x.latest_task_status==='active'?'идёт':x.latest_outcome||'завершена')+
    (x.latest_result_qty!==null&&x.latest_result_qty!==undefined?' · '+esc(x.latest_result_qty)+' '+esc(x.latest_result_unit||''):'')+'</p>':
    '<p class="muted small">Фактические задачи сегодня не записаны.</p>')+
   (x.arrival_at?'<p class="muted small">Приход: '+esc(String(x.arrival_at).slice(11,16))+
    (x.departure_at?' · уход: '+esc(String(x.departure_at).slice(11,16)):'')+'</p>':'')
 )).join('');
 if(w.moreAssignedWorkers)s+='<p class="muted">Показаны 50 исполнителей; полный реестр — в разделе «Исполнители».</p>';
 s+='</section></details>';

 s+='<section class="card"><h2>Фактические работы сегодня</h2>'+
  '<p class="muted small">Всего '+fmt(w.todayTotals.logCount)+' записей · '+fmt(w.todayTotals.workMinutes)+' мин WorkLog.</p>'+
  (!w.todayLogs.length?'<p class="muted">Сегодня записей нет.</p>':
   w.todayLogs.map(x=>record(x.title,
     (x.order_title||'Без заказа')+' · '+fmt(x.minutes)+' мин'+(x.quantity!==null?' · '+fmt(x.quantity)+' '+(x.unit||''):''),
     x.notes?'<p class="muted small">'+esc(x.notes)+'</p>':'')).join(''))+
  (w.moreTodayLogs?'<p class="muted small">Показаны последние 10 записей.</p>':'')+
  '<div class="actions"><button type="button" class="wide-button" data-work-history data-history-range="today"'+(selected?' data-order-id="'+esc(selected)+'"':'')+'>Сегодня по заказу</button>'+
  '<button type="button" class="wide-button" data-work-history data-history-range="all"'+(selected?' data-order-id="'+esc(selected)+'"':'')+'>Вся история заказа</button>'+
  '<button type="button" class="wide-button" data-work-history data-history-range="all">История всех работ</button></div></section>';

 s+='<details class="card"><summary>A1 — подробности и исправления</summary>'+a1Card()+'</details>';
 s+='<details class="card"><summary>Дополнительно: посещения и исправления</summary>'+presencePane(true)+'</details>';
 s+='<details class="card"><summary>Дополнительно: бизнес-время владельца</summary>'+ownerActivityPane()+'</details>';
 s+='<details class="card"><summary>Интервалы и рабочие дни</summary>'+
  (!w.todaySessions.length?'<p class="muted">Сегодня интервалов не было.</p>':
   w.todaySessions.map(x=>record(x.order_title||'Без заказа',when(x.started_at)+' — '+(x.ended_at?when(x.ended_at):'идёт'),
    x.description?'<p class="muted small">'+esc(x.description)+'</p>':'')).join(''))+
  (w.moreTodaySessions?'<p class="muted small">Показаны последние 20 интервалов.</p>':'')+
  '<h3>Последние рабочие дни</h3>'+
  w.recentWorkdays.map(x=>record(x.day_date,(label[x.status]||x.status)+' · '+fmt(x.log_count)+' записей · '+fmt(x.work_minutes)+' мин WorkLog','')).join('')+
  '</details>';
 return s;
}
async function loadMyWork(){
 if(myWork.loading)return;
 myWork.loading=true;
 myWork.error='';
 try{
  const id=myWork.selectedOrderId;
  myWork.snapshot=await api('/api/my-work'+(id?'?orderId='+encodeURIComponent(id):''));
  myWork.loaded=true;
 }catch(err){
  myWork.snapshot=null;
  myWork.error='Не удалось загрузить рабочий контекст: '+err.message;
  message(myWork.error,true);
 }finally{
  myWork.loading=false;
  if(tab==='myWork')render();
 }
}
