'use strict';
/*
 * VBOS Clean / legacy My Work flow adapter.
 * Reference: accepted Scripts.html openWorkDayStartModal_, openWorkLogModal_,
 * openWorkDayFinishModal_, renderQuickWorkLogContext_ and MyWork.html.
 * Presentation uses an isolated dialog; canonical PostgreSQL A1, WorkDay,
 * Session, Presence and WorkLog remain independent.
 */
const workFlowModalState={kind:null,orderId:'',item:null,trigger:null};
let workFlowLastNotice='';
function workFlowModalClose({force=false}={}){
 if(!workFlowModalState.kind)return true;
 const root=document.getElementById('workFlowBackdrop');
 if(!force&&root?.querySelector('form[data-workflow-dirty="1"]')){
  if(!confirm('Несохранённые изменения будут потеряны. Закрыть окно?'))return false;
 }
 const trigger=workFlowModalState.trigger;
 workFlowModalState.kind=null;workFlowModalState.item=null;workFlowModalState.trigger=null;
 root?.remove();
 document.body.classList.remove('work-flow-modal-open');
 trigger?.focus?.({preventScroll:true});
 return true;
}
function workFlowModalOpen(kind,opts={}){
 if(workFlowModalState.kind&&!workFlowModalClose())return;
 if(!['start','finish','log','continue'].includes(kind))return;
 const w=myWork.snapshot;
 if(!w){message('Загрузи рабочий день и повтори.',true);return;}
 if(kind==='log'&&!opts.item&&(!w.day||w.day.status!=='open'||!(opts.orderId||w.contextOrder))){
  message('Сначала открой рабочий день и выбери действующий заказ.',true);return;
 }
 workFlowModalState.kind=kind;
 workFlowModalState.orderId=opts.orderId||opts.item?.order_id||w.contextOrder?.id||'';
 workFlowModalState.item=opts.item||null;
 workFlowModalState.trigger=opts.trigger||null;
 const host=document.getElementById('content');
 host?.insertAdjacentHTML('beforeend',workFlowModalHtml());
 document.body.classList.add('work-flow-modal-open');
 const dialog=document.getElementById('workFlowBackdrop');
 if(kind==='log')fullWorkLogGapSchedule(dialog?.querySelector('form[data-full-worklog-form]'),true);
 const first=dialog?.querySelector('input:not([type="hidden"]),textarea,button[data-workflow-close]');
 first?.focus?.({preventScroll:true});
}
function workFlowContinuationPrompt({orderId='',orderTitle='',source='session_stop'}={}){
 // Only after server-acknowledged Session stop; never auto-close WorkDay/A1/WorkOrder.
 const w=myWork.snapshot;
 if(!w||w.day?.status!=='open'||w.currentSession)return false;
 workFlowModalOpen('continue',{orderId,item:{orderTitle,source}});
 return workFlowModalState.kind==='continue';
}
function workFlowModalHtml(){
 const w=myWork.snapshot||{},kind=workFlowModalState.kind;
 if(!kind)return '';
 const date=w.today||data.today;
 const order=ids('orders',workFlowModalState.orderId)||w.contextOrder;
 const a1=dailyA1?.item||null;
 let heading='',body='';
 if(kind==='log'){
  heading=workFlowModalState.item?'Правка WorkLog':'Записать фактическую работу';
  const item=workFlowModalState.item;
  const id=workFlowModalState.orderId;
  body='<p class="muted">Заказ: <strong>'+esc(order?.title||item?.order_title||'Заказ')+
   '</strong></p><p class="muted small">Выбери исполнителя; подробные показатели доступны в разделе «Дополнительно».</p>'+
   fullWorkLogForm(id,item?.day_date||date,item);
 }else if(kind==='start'){
  heading='Начало рабочего дня / A1';
  const already=Boolean(a1);
  body='<p class="muted">A1 относится ко всему дню. Заказ можно выбрать или изменить отдельно.</p>'+
    (already?'<div class="card"><strong>A1: '+esc(a1.goal)+'</strong><p class="muted">Почему: '+esc(a1.reason)+'</p></div>':'')+
    '<form class="grid" data-workflow-day-start novalidate>'+
    editText('date','Дата',date,'date','required readonly')+
    (!already?editText('goal','A1 сегодня',undefined,'textarea','required maxlength="1000"')+
      editText('reason','Почему именно это A1',undefined,'textarea','required maxlength="2000"')+
      editText('notes','Заметки дня',undefined,'textarea','maxlength="5000"'):'')+
    '<p class="muted small">Сначала сохраняется A1, затем открывается WorkDay. В случае ошибки оба результата будут показаны отдельно.</p>'+
    '<button type="submit" class="primary wide">Начать день</button>'+
    '<p role="status" data-workflow-feedback aria-live="polite"></p></form>';
 }else if(kind==='continue'){
  heading='Рабочий день продолжается?';
  const orderTitle=order?.title||workFlowModalState.item?.orderTitle||'Текущий заказ';
  body=(workFlowModalState.item?.source==='close_work_order'?
   '<p>Заказ <strong>'+esc(orderTitle)+'</strong> закрыт.</p>':
   '<p>Работа по заказу <strong>'+esc(orderTitle)+'</strong> завершена для текущего интервала.</p>')+
   '<p><strong>На сегодня всё или работаешь дальше?</strong></p>'+
   '<div class="grid" data-workflow-continue-choices>'+
    '<button type="button" class="primary wide" data-workflow-day-continues>Да, рабочий день продолжается</button>'+
    '<button type="button" class="wide" data-workflow-day-is-over>Нет, на сегодня всё</button>'+
   '</div>'+
   '<p class="muted small">Завершение интервала не закрывает заказ или рабочий день. A1 остаётся общей целью дня. Выбор «Да» ничего не изменяет в сохранённых данных.</p>';
 }else{
  heading='Завершить рабочий день';
  const total=w.todayTotals||{},n=Number(total.logCount||0);
  const blocked=Boolean(w.currentSession||w.currentPresence);
  const workSummary='<div class="card"><strong>Что сделано сегодня</strong>'+
   '<p>'+n+' записей WorkLog · '+Number(total.workMinutes||0)+' минут</p>'+
   (Array.isArray(w.todayLogs)?w.todayLogs.slice(0,6).map(x=>
     '<p class="muted small">'+esc(x.title||'Работа')+' · '+esc(x.minutes||0)+' мин</p>').join(''):'')+'</div>';
  body='<p class="muted">Проверь фактические работы и результат дня перед завершением.</p>'+
    workSummary+(blocked?'<p role="alert">Сначала заверши рабочий интервал и отметь уход с объекта. Данные не будут закрыты принудительно.</p>':'')+
    '<form class="grid" data-workflow-day-finish novalidate>'+
    (a1?.status==='open'?'<p class="muted"><strong>A1:</strong> '+esc(a1.goal)+'</p>'+
     '<label>Результат A1<select name="outcome" required><option value="">Выбери результат</option>'+
     '<option value="COMPLETED">Выполнено</option><option value="PARTIAL">Частично</option>'+
     '<option value="NOT_COMPLETED">Не выполнено</option></select></label>'+
     editText('outcomeNote','Комментарий к итогу',undefined,'textarea','maxlength="3000"'):
     '<p class="muted small">A1: '+esc(a1?'завершена ранее':'не задана')+'.</p>')+
    (n===0?'<label class="workflow-check"><input type="checkbox" name="confirmNoWork" required>Подтверждаю: фактических работ за этот день не записано.</label>':'')+
    '<p class="muted small">Закрытие WorkDay и итог A1 — отдельные защищённые записи PostgreSQL. Статус каждой будет проверен.</p>'+
    '<button type="submit" class="primary wide"'+(blocked?' disabled':'')+'>Я закончил работу</button>'+
    '<p role="status" data-workflow-feedback aria-live="polite"></p></form>';
 }
 return '<div id="workFlowBackdrop" class="work-flow-backdrop" data-workflow-backdrop>'+
  '<section class="work-flow-dialog" role="dialog" aria-modal="true" aria-label="'+esc(heading)+'">'+
  '<header class="work-flow-dialog-head"><h2>'+esc(heading)+'</h2><button type="button" data-workflow-close aria-label="Закрыть">✕</button></header>'+
  '<div class="work-flow-dialog-body">'+body+'</div></section></div>';
}
async function workFlowModalSubmitDay(form,kind){
 if(form.dataset.saving==='1')return;
 const status=form.querySelector('[data-workflow-feedback]');
 const required=Array.from(form.elements||[]).find(x=>x.willValidate&&!x.checkValidity());
 if(required){
  required.focus?.();required.reportValidity?.();
  if(status)status.textContent='Не сохранено. Заполни поле «'+
   (required.closest('label')?.textContent?.trim()||required.name)+'».';
  return;
 }
 const btn=form.querySelector('button[type="submit"]');form.dataset.saving='1';
 if(btn){btn.disabled=true;btn.textContent=kind==='start'?'Открываю день…':'Закрываю день…';}
 if(status)status.textContent='Сохраняю в PostgreSQL…';
 try{
  const date=myWork.snapshot?.today||data.today,a1=dailyA1?.item;
  if(kind==='start'){
   if(!a1){
    const goal=form.elements.goal?.value||'',reason=form.elements.reason?.value||'';
    const out=await api('/api/action',{type:'a1_save',payload:{
     date,revision:0,goal,reason,notes:form.elements.notes?.value||'',
     requestKey:form.dataset.a1RequestKey||(form.dataset.a1RequestKey=crypto.randomUUID())
    }});
    if(!out.saved)throw Error('A1 не подтвердил сохранение.');
   }
   const day=await api('/api/action',{type:'day_open',payload:{
    requestKey:form.dataset.dayRequestKey||(form.dataset.dayRequestKey=crypto.randomUUID())
   }});
   if(!day.saved||day.item?.status!=='open')throw Error('Рабочий день не открылся (возможно, уже закрыт). Проверь A1 и состояние дня.');
   workFlowLastNotice='✓ Рабочий день открыт. '+(a1?'Существующая A1 сохранена.':'A1 задана.');
  }else{
   const out=await api('/api/action',{type:'day_close',payload:{
    requestKey:form.dataset.dayRequestKey||(form.dataset.dayRequestKey=crypto.randomUUID())
   }});
   if(!out.saved||out.item?.status!=='closed')throw Error('WorkDay не подтвердил закрытие.');
   workFlowLastNotice='✓ Рабочий день закрыт.';
   if(a1?.status==='open'){
    try{
     const result=await api('/api/action',{type:'a1_complete',payload:{
      id:a1.id,date,revision:a1.revision,
      outcome:form.elements.outcome?.value,outcomeNote:form.elements.outcomeNote?.value||'',
      requestKey:form.dataset.a1RequestKey||(form.dataset.a1RequestKey=crypto.randomUUID())
     }});
     if(!result.saved)throw Error('A1 не подтвердила результат.');
     workFlowLastNotice='✓ Рабочий день закрыт. Результат A1 сохранён.';
    }catch(err){
     workFlowLastNotice='Рабочий день закрыт, но итог A1 не сохранён: '+err.message+
      '. Открой A1 в разделе ниже и сохрани результат отдельно.';
    }
   }
  }
  workFlowModalClose({force:true});
  await refresh();if(tab==='myWork')await loadMyWork();
  message(workFlowLastNotice,workFlowLastNotice.startsWith('Рабочий день закрыт, но'));
 }catch(err){
  if(status)status.textContent='Не завершено: '+err.message+
   '. Проверь состояние A1 и WorkDay перед повторным нажатием.';
  message('Операция не завершена: '+err.message,true);
 }finally{
  form.dataset.saving='';
  if(btn?.isConnected){btn.disabled=false;btn.textContent=kind==='start'?'Начать день':'Я закончил работу';}
 }
}
