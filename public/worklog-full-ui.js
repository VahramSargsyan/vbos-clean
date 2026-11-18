'use strict';
/* VBOS Clean Full WorkLog, based on accepted legacy WorkLogService.js.
 * This file renders/forms only. Server transaction is the sole authority.
 */
function fullWorkLogOptions(values,selected,empty){
 const current=String(selected??'');
 const options=(empty?'<option value="">'+esc(empty)+'</option>':'')+
  values.map(([v,n])=>'<option value="'+esc(v)+'"'+(v===current?' selected':'')+'>'+esc(n)+'</option>').join('');
 return options;
}
const FULL_WORKLOG_GAPS=[
 ['','Без разрыва / не применимо'],['lunch','Обед'],['materials','Материалы / магазин'],
 ['tool','Инструмент'],['chasing','Штроба / подготовка'],['waiting','Ожидание'],['call','Звонок'],
 ['helper','Помощник'],['project','Проект / чертёж'],['reschedule','Перенос'],
 ['coordination','Согласование'],['travel','Дорога'],['coffee','Кофе'],['other','Другое']];
// Acknowledged save receipt persists across refresh(), which replaces the form DOM.
// Never clear entered values before the server explicitly returns saved:true.
let fullWorkLogLastSaved=null;
function fullWorkLogStatus(form,text,state='info'){
 const target=form?.querySelector('[data-full-worklog-feedback]');
 if(target){target.textContent=text;target.dataset.state=state;}
}
function fullWorkLogFieldError(form,field,explanation){
 for(let node=field?.parentElement;node&&node!==form;node=node.parentElement){
  if(node.tagName==='DETAILS')node.open=true;
 }
 const label=field?.closest?.('label')?.textContent?.trim()||field?.name||'поле формы';
 const msg='Не сохранено: '+(explanation||'проверь поле «'+label+'».');
 fullWorkLogStatus(form,msg,'error');
 try{field?.focus?.();}catch{}
 try{field?.reportValidity?.();}catch{}
 return msg;
}
function fullWorkLogValidate(form){
 fullWorkLogFormUpdated(form);
 const controls=Array.from(form.elements||[]);
 const invalid=controls.find(el=>el.willValidate&&!el.checkValidity());
 if(invalid)return {ok:false,message:fullWorkLogFieldError(form,invalid)};
 const f=form.elements;
 if(Number(f.quantity?.value||0)>0&&!f.unit?.value)
  return {ok:false,message:fullWorkLogFieldError(form,f.unit,'выбери единицу измерения для количества.')};
 const toMinutes=value=>/^\d{2}:\d{2}$/.test(value||'')?
  Number(value.slice(0,2))*60+Number(value.slice(3)):NaN;
 const elapsed=toMinutes(f.endClock?.value)-toMinutes(f.startClock?.value);
 if(!(elapsed>0))
  return {ok:false,message:fullWorkLogFieldError(form,f.endClock,'время окончания должно быть позже начала.')};
 if(Number(f.lossMinutes?.value||0)>=elapsed)
  return {ok:false,message:fullWorkLogFieldError(form,f.lossMinutes,'потери должны быть меньше общего времени.')};
 return {ok:true};
}
function fullWorkLogSavePending(form,waiting){
 const button=form?.querySelector('button[type="submit"]');
 if(!button)return;
 if(waiting){
  button.dataset.originalLabel=button.textContent;
  button.disabled=true;button.textContent='Сохраняю…';
  fullWorkLogStatus(form,'Сохраняю работу в PostgreSQL…','pending');
 }else{
  button.disabled=false;
  if(button.dataset.originalLabel)button.textContent=button.dataset.originalLabel;
  delete button.dataset.originalLabel;
 }
}
function fullWorkLogSaveConfirmed(form,result,type){
 const row=result?.item;
 const orderId=row?.order_id||form?.elements?.orderId?.value;
 const title=row?.title||form?.elements?.workType?.value||'Работа';
 const text='✓ Сохранено в PostgreSQL: '+title+' · '+(row?.minutes??'?')+
  ' мин. Запись № '+String(row?.id||'').slice(0,8)+'.';
 fullWorkLogLastSaved={orderId,text,id:row?.id};
 // Do not blank an existing history edit; editing is a separate user intent.
 if(type==='work_log_full_create'&&form){
  form.reset();
  for(const name of ['startClock','endClock','location','workType','workDetail','quantity',
   'points','nodes','meters','lossReason','reworkReason','comment','notes','gapReason',
   'successorGapReason','serviceId']){
   const el=form.elements?.namedItem?.(name);
   if(el)el.value='';
  }
  fullWorkLogFormUpdated(form);
 }
 fullWorkLogStatus(form,text,'success');
 return text;
}
function fullWorkLogForm(orderId,date,record){
 const d=record?.detail||null,edit=Boolean(d&&record?.id);
 const value=(k,fallback='')=>d?.[k]??fallback;
 const time=v=>String(v||'').slice(0,5);
 const workers=(data?.workers||[]).filter(w=>w.status==='active'||w.id===d?.worker_id)
  .map(w=>[w.id,w.name||w.id]);
 const references=(data?.workLogServiceReferences||[]).filter(s=>s.status==='active'||s.service_id===d?.service_id)
  .map(s=>[s.service_id,(s.category?s.category+' · ':'')+s.service_name]);
 const mode=value('performer_mode','OWNER');
 const start=time(value('start_clock',currentYerevanTime()));
 const day=String(edit?record.day_date||date:date).slice(0,10);
 const base='<input type="hidden" name="orderId" value="'+esc(orderId)+'">'+
  (edit?'<input type="hidden" name="id" value="'+esc(record.id)+'"><input type="hidden" name="revision" value="'+esc(record.revision)+'">'+
    '<input type="hidden" name="dayDate" value="'+esc(day)+'"><p class="muted">Дата работы: '+esc(day)+'. Перенос в другой день/заказ не выполняется через эту форму.</p>':
    editText('dayDate','Дата',day,'date','required'))+
  select('performerMode','Кто выполнял',fullWorkLogOptions([
   ['OWNER','Я'],['WORKER','Помощник'],['JOINT','Я и помощник']],mode),true)+
  '<div data-full-worker'+(mode==='OWNER'?' hidden':'')+'>'+
   select('workerId','Помощник',fullWorkLogOptions(workers,value('worker_id'),'Выбери назначенного помощника'),false)+'</div>'+
  editText('startClock','Начало',start,'time','required')+
  editText('endClock','Конец',time(value('end_clock')),'time','required')+
  editText('location','Зона / помещение',value('location'),'text','required maxlength="300" placeholder="Кухня, подвал, ванная…"')+
  select('serviceId','Услуга из каталога',fullWorkLogOptions(references,value('service_id'),'Не связывать с каталогом'),false)+
  editText('workType','Вид работы',value('work_type',record?.title||''),'text','required maxlength="180" placeholder="Монтаж труб, замена стояка…"')+
  editText('quantity','Результат: количество',record?.quantity??'','number','min="0" step="0.001" inputmode="decimal"')+
  select('unit','Единица',fullWorkLogOptions([
   ['','Не выбрано'],['шт','шт'],['точки','точки'],['м','м'],['м²','м²'],
   ['узлы','узлы'],['этаж','этаж'],['комната','комната'],['другое','другое'],
   ...(!['','шт','точки','м','м²','узлы','этаж','комната','другое'].includes(record?.unit)?
      [[record?.unit,record?.unit]]:[])],record?.unit||''),false)+
  editText('nodes','Узлы',value('nodes'),'number','min="0" step="0.01"')+
  editText('meters','Метры',value('meters'),'number','min="0" step="0.01"')+
  select('complexity','Сложность',fullWorkLogOptions([1,2,3,4,5].map(n=>[String(n),String(n)]),String(value('complexity',3))),true)+
  '<p role="status" class="muted small" data-full-duration>Укажи начало и конец: чистое время рассчитается после вычета потерь.</p>'+
  '<details><summary>Дополнительно: детали, точки, потери, переделка, комментарий</summary><div class="grid">'+
   editText('workDetail','Деталь работы',value('work_detail'),'textarea','maxlength="2000"')+
   editText('points','Точки',value('points'),'number','min="0" step="0.01"')+
   editText('lossMinutes','Потери, минут',value('loss_minutes',0),'number','min="0" max="1439" step="1"')+
   '<div data-full-loss'+(!Number(value('loss_minutes',0))?' hidden':'')+'>'+
   editText('lossReason','Причина потерь',value('loss_reason'),'text','maxlength="300"')+'</div>'+
   select('reworkStatus','Переделка',fullWorkLogOptions([['no','Нет'],['yes','Да'],['disputed','Спорно']],value('rework_status','no')),true)+
   '<div data-full-rework'+(value('rework_status','no')==='no'?' hidden':'')+'>'+
    editText('reworkReason','Причина переделки',value('rework_reason'),'text','maxlength="300"')+
    editText('reworkMinutes','Переделка, минут',value('rework_minutes',0),'number','min="0" max="1440" step="1"')+'</div>'+
   select('gapReason','Причина разрыва перед работой (>15 минут)',fullWorkLogOptions(FULL_WORKLOG_GAPS,value('gap_reason')),false)+
   select('successorGapReason','Причина разрыва перед следующей работой (если меняется)',fullWorkLogOptions(FULL_WORKLOG_GAPS,''),false)+
   editText('comment','Что мешало или помогало',value('comment'),'textarea','maxlength="5000"')+
  '</div></details>'+
  editText('notes','Примечание',record?.notes||'','textarea','maxlength="5000"')+
  '<p class="muted small">Сохраняется только WorkLog. Зарплата, финансовая операция и утверждённый норматив не создаются.</p>';
 const receipt=!edit&&fullWorkLogLastSaved?.orderId===orderId?
  '<p class="full-worklog-receipt" data-full-worklog-receipt role="status">'+esc(fullWorkLogLastSaved.text)+'</p>':'';
 const header=edit?'Редактировать подробную работу':'+ Записать выполненную работу';
 return '<details class="card" data-full-worklog-panel'+(edit&&workFlowModalState.kind!=='log'?'':' open')+'>'+
  '<summary>'+esc(header)+'</summary>'+
  '<form class="grid" novalidate data-full-worklog-form data-act="'+(edit?'work_log_full_update':'work_log_full_create')+'">'+
   base+(edit?'':'<button type="button" data-full-worklog-copy class="compact">Повторить предыдущую работу</button>')+
   '<button type="submit" class="primary wide">'+(edit?'Сохранить исправления':'Сохранить работу')+'</button>'+receipt+
   (edit?'':'<div class="full-worklog-draft-tools"><p class="muted small" role="status" aria-live="polite" data-full-worklog-draft-status></p>'+
    '<button type="button" class="compact" data-full-worklog-draft-restore hidden>Восстановить черновик</button>'+
    '<button type="button" class="compact" data-full-worklog-draft-delete hidden>Удалить черновик</button></div>')+
   '<p class="full-worklog-feedback" data-full-worklog-feedback role="status" aria-live="polite"></p>'+
  '</form></details>';
}
function fullWorkLogFormUpdated(form){
 if(!form||!form.hasAttribute('data-full-worklog-form'))return;
 const els=form.elements,mode=els.performerMode.value;
 const worker=form.querySelector('[data-full-worker]');
 if(worker)worker.hidden=mode==='OWNER';
 if(els.workerId){els.workerId.required=mode!=='OWNER';if(mode==='OWNER')els.workerId.value='';}
 const loss=Number(els.lossMinutes?.value||0),lossWrap=form.querySelector('[data-full-loss]');
 if(lossWrap)lossWrap.hidden=!(loss>0);
 if(els.lossReason)els.lossReason.required=loss>0;
 const rework=els.reworkStatus?.value||'no',reworkWrap=form.querySelector('[data-full-rework]');
 if(reworkWrap)reworkWrap.hidden=rework==='no';
 if(els.reworkReason)els.reworkReason.required=rework!=='no';
 const s=els.startClock?.value||'',e=els.endClock?.value||'';
 const minutes=t=>/^\d{2}:\d{2}$/.test(t)?Number(t.slice(0,2))*60+Number(t.slice(3)):null;
 const elapsed=minutes(e)-minutes(s);
 const preview=form.querySelector('[data-full-duration]');
 if(preview)preview.textContent=Number.isFinite(elapsed)&&elapsed>0?
   'Всего: '+elapsed+' мин · потери: '+loss+' мин · чистое время: '+(elapsed-loss)+' мин'+
   (elapsed-loss<=0?' (исправь потери)':''):
   'Укажи конец позже начала в пределах одного дня.';
}
function fullWorkLogCopyPrevious(form,orderLogs){
 const candidates=[...(orderLogs?.items||[]),...(data?.logs||[])];
 const source=candidates.find(x=>x.detail&&x.order_id===form.elements.orderId?.value);
 if(!source){message('В истории этого заказа пока нет подробной работы для повторения.',true);return;}
 const d=source.detail;
 const fields={location:d.location,workType:d.work_type,serviceId:d.service_id,workDetail:d.work_detail,
  unit:source.unit,complexity:d.complexity,performerMode:d.performer_mode,workerId:d.worker_id,
  startClock:String(d.end_clock||'').slice(0,5)};
 for(const [k,v] of Object.entries(fields)){
  if(form.elements[k]&&v!==null&&v!==undefined)form.elements[k].value=String(v);
 }
 for(const k of ['quantity','points','nodes','meters','endClock','gapReason','successorGapReason',
  'lossReason','reworkReason','comment','notes'])if(form.elements[k])form.elements[k].value='';
 if(form.elements.lossMinutes)form.elements.lossMinutes.value='0';
 if(form.elements.reworkMinutes)form.elements.reworkMinutes.value='0';
 if(form.elements.reworkStatus)form.elements.reworkStatus.value='no';
 fullWorkLogFormUpdated(form);
 message('Контекст предыдущей работы перенесён. Укажи новые время окончания и результат.');
}
