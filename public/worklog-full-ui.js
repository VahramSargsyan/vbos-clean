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

/* WorkLog v1.7.32 legacy taxonomy UI: only serviceId enters the existing writer. */
const FULL_WORKLOG_ACTIONS=Object.freeze({
 MOUNT:'Монтаж',INSTALL:'Установка',DISMANTLE:'Демонтаж',CONNECT:'Подключение',
 REPAIR:'Ремонт',DIAGNOSE:'Диагностика',PREPARE:'Подготовка',CLEANUP:'Уборка',
 LOGISTICS:'Перенос / подъём',OTHER:'Другое'
});
function fullWorkLogTaxCode(row){return String(row?.action_code||'').trim().toUpperCase()||'__UNRESOLVED__';}
function fullWorkLogTaxRows(selectedId=''){
 const id=String(selectedId||'');
 return (data?.workLogServiceReferences||[]).filter(row=>row.status==='active'||String(row.service_id)===id);
}
function fullWorkLogTaxCategories(rows){
 return [...new Set(rows.map(row=>String(row.category||'').trim()).filter(Boolean))]
  .sort((a,b)=>a.localeCompare(b,'ru')).map(value=>[value,value]);
}
function fullWorkLogTaxActions(rows,category){
 if(!category)return [];
 const found=new Set(rows.filter(row=>String(row.category||'').trim()===category).map(fullWorkLogTaxCode));
 const order=[...Object.keys(FULL_WORKLOG_ACTIONS),...found];
 return [...new Set(order)].filter(code=>found.has(code)).map(code=>[
  code,FULL_WORKLOG_ACTIONS[code]||(code==='__UNRESOLVED__'?'Не классифицировано (legacy)':code)]);
}
function fullWorkLogTaxServices(rows,category,action,selectedId){
 const id=String(selectedId||'');
 const options=rows.filter(row=>(
  category&&action&&String(row.category||'').trim()===category&&fullWorkLogTaxCode(row)===action
 )||(id&&String(row.service_id)===id));
 options.sort((a,b)=>String(a.service_name||'').localeCompare(String(b.service_name||''),'ru'));
 return fullWorkLogOptions(options.map(row=>[
  String(row.service_id),String(row.service_name||row.service_id)+(row.status==='active'?'':' · Архив')
 ]),id,'Не связывать с каталогом');
}
function fullWorkLogTaxPreselect(form,id){
 const serviceId=String(id||'');
 if(!form||!serviceId)return false;
 const catEl=form.querySelector('[data-full-worklog-tax-category]');
 const actEl=form.querySelector('[data-full-worklog-tax-action]');
 const svcEl=form.elements?.serviceId;
 if(!catEl||!actEl||!svcEl)return false;
 const rows=fullWorkLogTaxRows(serviceId);
 const item=rows.find(row=>String(row.service_id)===serviceId);
 if(!item)return false;
 const category=String(item.category||'').trim(),action=fullWorkLogTaxCode(item);
 catEl.innerHTML=fullWorkLogOptions(fullWorkLogTaxCategories(rows),category,'Не связывать с каталогом');
 catEl.value=category;
 actEl.innerHTML=fullWorkLogOptions(fullWorkLogTaxActions(rows,category),action,
  category?'Выбери вид работ':'Сначала выбери категорию');
 actEl.value=action;actEl.disabled=!category;
 svcEl.innerHTML=fullWorkLogTaxServices(rows,category,action,serviceId);
 svcEl.value=serviceId;
 return true;
}

function fullWorkLogTaxSync(form,changed='service'){
 if(!form)return;
 const catEl=form.querySelector('[data-full-worklog-tax-category]');
 const actEl=form.querySelector('[data-full-worklog-tax-action]');
 const svcEl=form.elements?.serviceId;
 if(!catEl||!actEl||!svcEl)return;
 let cat=catEl.value,act=actEl.value,id=String(svcEl.value||'');
 const rows=fullWorkLogTaxRows(id);
 if(changed==='category'){act='';id='';}
 else if(changed==='action')id='';
 else if(changed==='service'&&id){
  const item=rows.find(row=>String(row.service_id)===id);
  if(item){cat=String(item.category||'').trim();act=fullWorkLogTaxCode(item);}
 }
 const cats=fullWorkLogTaxCategories(rows);
 if(!cats.some(row=>row[0]===cat)){cat='';act='';id='';}
 catEl.innerHTML=fullWorkLogOptions(cats,cat,'Не связывать с каталогом');
 catEl.value=cat;
 const acts=fullWorkLogTaxActions(rows,cat);
 if(!acts.some(row=>row[0]===act)){act='';id='';}
 actEl.innerHTML=fullWorkLogOptions(acts,act,cat?'Выбери вид работ':'Сначала выбери категорию');
 actEl.value=act;actEl.disabled=!cat;
 svcEl.innerHTML=fullWorkLogTaxServices(rows,cat,act,id);
 svcEl.value=id;
}
if(typeof document!=='undefined')document.addEventListener('change',event=>{
 const target=event.target;
 if(!target?.matches?.('[data-full-worklog-tax-category], [data-full-worklog-tax-action], form[data-full-worklog-form] [name="serviceId"]'))return;
 const form=target.closest('form[data-full-worklog-form]');if(!form)return;
 form.dataset.workflowDirty='1';
 fullWorkLogTaxSync(form,target.matches('[data-full-worklog-tax-category]')?'category':
  target.matches('[data-full-worklog-tax-action]')?'action':'service');
},true);


/* Advisory only: this reuses the canonical, owner-authenticated WorkLog gap read.
 * No hidden frontend guess is treated as proof; writer remains authoritative.
 */
const FULL_WORKLOG_GAP_LIMIT=15;
function fullWorkLogGapSignature(form){
 const f=form?.elements;
 if(!f?.orderId?.value||!/^\d{4}-\d{2}-\d{2}$/.test(f.dayDate?.value||''))return '';
 const start=f.startClock?.value||'',end=f.endClock?.value||'';
 const minute=v=>/^\d{2}:\d{2}$/.test(v)?Number(v.slice(0,2))*60+Number(v.slice(3)):NaN;
 if(!Number.isFinite(minute(start))||(end&&(!(minute(end)>minute(start)))))return '';
 const mode=f.performerMode?.value||'OWNER',workerId=f.workerId?.value||'';
 if(mode!=='OWNER'&&!workerId)return '';
 const query=new URLSearchParams({orderId:f.orderId.value,dayDate:f.dayDate.value,
  startClock:start,performerMode:mode});
 if(end)query.set('endClock',end);
 if(mode!=='OWNER')query.set('workerId',workerId);
 if(f.id?.value)query.set('recordId',f.id.value);
 return query.toString();
}
function fullWorkLogGapReset(form){
 if(!form?.dataset)return;
 if(form._fullGapTimer)clearTimeout(form._fullGapTimer);
 form._fullGapSeq=(form._fullGapSeq||0)+1;
 form.dataset.fullGapSignature='';
 form.dataset.fullGapState='idle';
 for(const selector of ['[data-full-gap-before]','[data-full-gap-after]',
  '[data-full-gap-feedback]','[data-full-gap-retry]']){
  const target=form.querySelector(selector);if(target)target.hidden=true;
 }
 if(form.elements?.gapReason)form.elements.gapReason.required=false;
 if(form.elements?.successorGapReason)form.elements.successorGapReason.required=false;
}
function fullWorkLogGapApply(form,context){
 // Reject malformed success responses before mutating form fields: Number(null) is zero.
 const before=context?.gapMinutes,after=context?.successorGapMinutes;
 const threshold=context?.thresholdMinutes;
 if(!Number.isFinite(before)||before<0||!Number.isFinite(after)||after<0||
    threshold!==FULL_WORKLOG_GAP_LIMIT||typeof context?.hasEndClock!=='boolean')
  throw Error('Сервер вернул некорректный расчёт пауз.');
 const needsBefore=before>threshold,needsAfter=Boolean(context?.hasEndClock)&&after>threshold;
 const originalBefore=form.elements?.gapReason?.value;
 const originalAfter=form.elements?.successorGapReason?.value;
 const beforeWrap=form.querySelector('[data-full-gap-before]'),
  afterWrap=form.querySelector('[data-full-gap-after]');
 if(beforeWrap)beforeWrap.hidden=!needsBefore;
 if(afterWrap)afterWrap.hidden=!needsAfter;
 const beforeClock=form.querySelector('[data-full-gap-minutes]'),
  afterClock=form.querySelector('[data-full-successor-gap-minutes]');
 if(beforeClock)beforeClock.textContent='Пауза между работами: '+before+' мин. Укажи причину.';
 if(afterClock)afterClock.textContent='До следующей работы: '+after+' мин. '+
   (context?.successorReasonPresent?'Причина уже есть в следующей записи.':'Укажи причину.');
 if(form.elements?.gapReason){
  form.elements.gapReason.required=needsBefore;
  if(!needsBefore)form.elements.gapReason.value='';
 }
 if(form.elements?.successorGapReason){
  form.elements.successorGapReason.required=needsAfter&&!context.successorReasonPresent;
  if(!needsAfter)form.elements.successorGapReason.value='';
 }
 const feedback=form.querySelector('[data-full-gap-feedback]');
 if(feedback){feedback.hidden=true;feedback.textContent='';}
 const retry=form.querySelector('[data-full-gap-retry]');if(retry)retry.hidden=true;
 // Canonical gap rechecks can clear obsolete reasons programmatically.
 // Persist that correction so a reload cannot resurrect invalid selections.
 if(typeof worklogDraftAutosave==='function'&&form.dataset?.draftDecision==='active'&&
   (originalBefore!==form.elements?.gapReason?.value||
    originalAfter!==form.elements?.successorGapReason?.value))
  worklogDraftAutosave(form);
}
function fullWorkLogGapSchedule(form,immediate=false,force=false){
 if(!form?.dataset||!form.hasAttribute?.('data-full-worklog-form'))return;
 const signature=fullWorkLogGapSignature(form);
 if(!signature){fullWorkLogGapReset(form);return;}
 if(!force&&form.dataset.fullGapSignature===signature&&
  ['pending','ready','error'].includes(form.dataset.fullGapState))return;
 if(form._fullGapTimer)clearTimeout(form._fullGapTimer);
 form.dataset.fullGapSignature=signature;
 form.dataset.fullGapState='pending';
 const seq=form._fullGapSeq=(form._fullGapSeq||0)+1;
 const feedback=form.querySelector('[data-full-gap-feedback]');
 const retry=form.querySelector('[data-full-gap-retry]');if(retry)retry.hidden=true;
 if(feedback){feedback.hidden=false;feedback.textContent='Проверяем паузы между работами…';}
 form._fullGapTimer=setTimeout(async()=>{
  if(form.isConnected===false||seq!==form._fullGapSeq)return;
  try{
   const context=await api('/api/worklogs/full-context?'+signature);
   if(form.isConnected===false||seq!==form._fullGapSeq||
      signature!==fullWorkLogGapSignature(form))return;
   if(!context?.ready||context.overlap)throw Error(context?.overlap?
     'Время пересекается с другой работой этого исполнителя.':
     'Проверка рабочего дня недоступна.');
   fullWorkLogGapApply(form,context);
   form.dataset.fullGapState='ready';
  }catch(error){
   if(form.isConnected===false||seq!==form._fullGapSeq)return;
   form.dataset.fullGapState='error';
   if(feedback){feedback.hidden=false;
    feedback.textContent='Не удалось проверить паузы: '+String(error?.message||error);}
   if(retry)retry.hidden=false;
  }
 },immediate?0:300);
}
if(typeof document!=='undefined')document.addEventListener('click',event=>{
 const button=event.target?.closest?.('[data-full-gap-retry]');
 if(!button)return;
 const form=button.closest('form[data-full-worklog-form]');
 if(form)fullWorkLogGapSchedule(form,true,true);
},true);

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
 if(['pending','error'].includes(form.dataset?.fullGapState))
  return {ok:false,message:fullWorkLogFieldError(form,form.elements?.startClock,
   form.dataset.fullGapState==='pending'?
   'проверяем паузы, повтори сохранение после завершения проверки.':
   'пауза не проверена. Нажми «Повторить проверку пауз».')};
 const controls=Array.from(form.elements||[]);
 const invalid=controls.find(el=>el.willValidate&&!el.checkValidity());
 if(invalid){
  const help={workType:'напиши, что именно сделал. Вид работ из каталога не заменяет описание.',
   location:'укажи зону или помещение, где выполнялась работа.',
   endClock:'укажи фактическое время окончания.',
   startClock:'укажи фактическое время начала.'};
  return {ok:false,message:fullWorkLogFieldError(form,invalid,help[invalid.name])};
 }
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
  fullWorkLogTaxSync(form,'service');
  fullWorkLogGapReset(form);
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
 const references=fullWorkLogTaxRows(value('service_id'));
 const selectedReference=references.find(s=>String(s.service_id)===String(value('service_id')))||null;
 const selectedCategory=String(selectedReference?.category||'').trim();
 const selectedAction=selectedReference?fullWorkLogTaxCode(selectedReference):'';
 const mode=value('performer_mode','OWNER');
 const start=time(value('start_clock',currentYerevanTime()));
 const day=String(edit?record.day_date||date:date).slice(0,10);
 const base='<p class="muted small" data-full-worklog-required-help>Обязательно: время начала и конца, помещение и конкретное выполненное действие. Количество и остальные показатели можно не заполнять; при количестве нужна единица.</p>'+
  '<input type="hidden" name="orderId" value="'+esc(orderId)+'">'+
  (edit?'<input type="hidden" name="id" value="'+esc(record.id)+'"><input type="hidden" name="revision" value="'+esc(record.revision)+'">'+
    '<input type="hidden" name="dayDate" value="'+esc(day)+'"><p class="muted">Дата работы: '+esc(day)+'. Перенос в другой день/заказ не выполняется через эту форму.</p>':
    editText('dayDate','Дата',day,'date','required'))+
  select('performerMode','Кто выполнял',fullWorkLogOptions([
   ['OWNER','Я'],['WORKER','Помощник'],['JOINT','Я и помощник']],mode),true)+
  '<div data-full-worker'+(mode==='OWNER'?' hidden':'')+'>'+
   select('workerId','Помощник',fullWorkLogOptions(workers,value('worker_id'),'Выбери назначенного помощника'),false)+'</div>'+
  editText('startClock','Начало *',start,'time','required')+
  editText('endClock','Конец *',time(value('end_clock')),'time','required')+
  '<section class="full-worklog-gap" data-full-gap-before'+(value('gap_reason')?'':' hidden')+'>'+
   '<p class="full-worklog-gap-summary" data-full-gap-minutes>Пауза больше 15 минут. Укажи причину.</p>'+
   select('gapReason','Почему была пауза?',fullWorkLogOptions(FULL_WORKLOG_GAPS,value('gap_reason')),false)+
  '</section>'+
  '<section class="full-worklog-gap" data-full-gap-after hidden>'+
   '<p class="full-worklog-gap-summary" data-full-successor-gap-minutes></p>'+
   select('successorGapReason','Причина паузы до следующей работы',fullWorkLogOptions(FULL_WORKLOG_GAPS,''),false)+
  '</section>'+
  '<p class="full-worklog-gap-feedback muted small" data-full-gap-feedback role="status" aria-live="polite" hidden></p>'+
  '<button type="button" data-full-gap-retry hidden>Повторить проверку пауз</button>'+
  '<label>Категория<select data-full-worklog-tax-category>'+
   fullWorkLogOptions(fullWorkLogTaxCategories(references),selectedCategory,'Не связывать с каталогом')+
  '</select></label>'+
  '<label>Вид работ из каталога (не описание)<select data-full-worklog-tax-action'+(selectedCategory?'':' disabled')+'>'+
   fullWorkLogOptions(fullWorkLogTaxActions(references,selectedCategory),selectedAction,
    selectedCategory?'Выбери вид работ':'Сначала выбери категорию')+
  '</select></label>'+
  select('serviceId','Услуга',fullWorkLogTaxServices(references,selectedCategory,selectedAction,value('service_id')),false)+
  editText('location','Зона / помещение *',value('location'),'text','required maxlength="300" placeholder="Кухня, подвал, ванная…"')+
  '<p class="muted small" data-full-worklog-detail-help>Напиши, что именно сделал, например: «Смонтировал трубы водоснабжения в туалете». Выбор «Монтаж» выше сам по себе не записывает выполненное действие.</p>'+
  editText('workType','Фактическая работа *',value('work_type',record?.title||''),'text','required maxlength="180" placeholder="Что сделал: монтаж труб, замена стояка…"')+
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
   (edit?'':'<button type="button" data-full-worklog-copy class="compact">Повторить предыдущую работу</button>')+base+
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
 const fields={location:d.location,workType:d.work_type,workDetail:d.work_detail,
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
 if(!fullWorkLogTaxPreselect(form,d.service_id||'')){
  if(form.elements.serviceId)form.elements.serviceId.value='';
  if(d.service_id)message('Каталожная услуга предыдущей работы недоступна в текущем списке. Проверь выбор вручную.',true);
 }
 fullWorkLogTaxSync(form,'service');
 fullWorkLogFormUpdated(form);
 fullWorkLogGapSchedule(form);
 message('Контекст предыдущей работы перенесён. Укажи новые время окончания и результат.');
}
