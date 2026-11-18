'use strict';
/* WorkLog draft is local to the authenticated owner and order/date.
 * The PostgreSQL WorkLog writer remains the sole canonical save authority.
 */
const WORKLOG_DRAFT_FIELDS=[
 'dayDate','performerMode','workerId','startClock','endClock','location','serviceId','workType',
 'quantity','unit','nodes','meters','complexity','workDetail','points','lossMinutes','lossReason',
 'reworkStatus','reworkReason','reworkMinutes','gapReason','successorGapReason','comment','notes'
];
let worklogDraftOwner='';
function worklogDraftSetOwner(scope){worklogDraftOwner=/^[a-f0-9]{64}$/.test(String(scope||''))?String(scope):'';}
function worklogDraftKey(form){
 if(form?.dataset.act!=='work_log_full_create'||!worklogDraftOwner)return '';
 const order=String(form.elements?.orderId?.value||''),day=String(form.elements?.dayDate?.value||'');
 if(!/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(order)||!/^\d{4}-\d{2}-\d{2}$/.test(day))return '';
 return 'vbos-clean:worklog-draft:v1:'+worklogDraftOwner+':'+order+':'+day;
}
function worklogDraftRead(key){
 if(!key)return null;
 try{const s=window.localStorage.getItem(key);return s?JSON.parse(s):null;}catch{return undefined;}
}
function worklogDraftWrite(key,obj){
 try{window.localStorage.setItem(key,JSON.stringify(obj));return true;}catch{return false;}
}
function worklogDraftStatus(form,text,state='info'){
 const el=form?.querySelector('[data-full-worklog-draft-status]');
 if(el){el.textContent=text;el.dataset.state=state;}
}
function worklogDraftButtons(form,restore,remove){
 const a=form?.querySelector('[data-full-worklog-draft-restore]');
 const b=form?.querySelector('[data-full-worklog-draft-delete]');
 if(a)a.hidden=!restore;if(b)b.hidden=!remove;
}
function worklogDraftValid(d,form){
 return d&&d.v===1&&d.owner===worklogDraftOwner&&
  d.orderId===String(form.elements.orderId.value)&&d.dayDate===String(form.elements.dayDate.value)&&
  /^[a-f0-9-]{36}$/i.test(d.requestKey||'')&&d.fields&&
  typeof d.fields==='object'&&!Array.isArray(d.fields);
}
function worklogDraftLock(form,on){
 for(const el of form.querySelectorAll('input:not([type="hidden"]),select,textarea')){
  if(on){
   if(el.dataset.draftWasDisabled===undefined)el.dataset.draftWasDisabled=el.disabled?'1':'0';
   el.disabled=true;
  }else if(el.dataset.draftWasDisabled!==undefined){
   el.disabled=el.dataset.draftWasDisabled==='1';delete el.dataset.draftWasDisabled;
  }
 }
 const copy=form.querySelector('[data-full-worklog-copy]');if(copy)copy.disabled=on;
 form.dataset.draftPending=on?'1':'';
}
function worklogDraftPending(form){return form?.dataset?.draftPending==='1';}
function worklogDraftOffer(form){
 if(form?.dataset.act!=='work_log_full_create')return;
 const key=worklogDraftKey(form);
 if(!key){
  form.dataset.draftDecision='blocked';
  worklogDraftStatus(form,'Не удалось определить пользователя или заказ для черновика.','error');return;
 }
 const d=worklogDraftRead(key);form.dataset.draftKey=key;
 if(d===undefined||d&&!worklogDraftValid(d,form)){
  form.dataset.draftDecision='blocked';worklogDraftButtons(form,false,true);
  worklogDraftLock(form,true);
  worklogDraftStatus(form,'Не удалось прочитать черновик. Можно удалить его с подтверждением.','error');
 }else if(d){
  form.dataset.draftDecision='choose';worklogDraftButtons(form,true,true);
  worklogDraftLock(form,true);
  worklogDraftStatus(form,'Найден незавершённый черновик от '+String(d.savedAt||'')+
   '. Восстанови или удали его перед новым вводом.');
 }else{
  form.dataset.draftDecision='active';worklogDraftButtons(form,false,false);
 }
}
function worklogDraftRestore(form){
 const key=worklogDraftKey(form),d=worklogDraftRead(key);
 if(!worklogDraftValid(d,form)){
  worklogDraftStatus(form,'Не удалось восстановить черновик.','error');return false;
 }
 for(const name of WORKLOG_DRAFT_FIELDS){
  const el=form.elements?.namedItem?.(name);
  if(el&&Object.prototype.hasOwnProperty.call(d.fields,name))el.value=String(d.fields[name]??'');
 }
 worklogDraftLock(form,false);
 form.dataset.requestKey=d.requestKey;form.dataset.draftKey=key;
 form.dataset.draftDecision='active';fullWorkLogFormUpdated(form);
 worklogDraftButtons(form,false,true);
 const pending=d.pending&&d.pending.requestKey===d.requestKey&&
  d.pending.payload?.requestKey===d.requestKey&&d.pending.payload?.orderId===d.orderId&&
  d.pending.payload?.dayDate===d.dayDate;
 if(pending)worklogDraftLock(form,true);
 worklogDraftStatus(form,'Восстановлен незавершённый черновик. '+
  (pending?'Ответ сервера неизвестен. Нажми «Сохранить работу» для проверки прежнего запроса.':
   'Черновик сохранён на телефоне.'),'success');
 return true;
}
function worklogDraftAutosave(form){
 if(form?.dataset.act!=='work_log_full_create'||worklogDraftPending(form))return false;
 if(form.dataset.draftDecision!=='active'){
  worklogDraftStatus(form,'Сначала восстанови или удали найденный черновик.','error');return false;
 }
 const key=worklogDraftKey(form);
 if(!key){worklogDraftStatus(form,'Не удалось сохранить черновик.','error');return false;}
 const old=worklogDraftRead(key);
 if(old===undefined){worklogDraftStatus(form,'Не удалось сохранить черновик.','error');return false;}
 const fields={};
 for(const name of WORKLOG_DRAFT_FIELDS){
  const el=form.elements?.namedItem?.(name);if(el)fields[name]=String(el.value??'');
 }
 const requestKey=form.dataset.requestKey||
  (worklogDraftValid(old,form)?old.requestKey:crypto.randomUUID());
 const d={v:1,owner:worklogDraftOwner,orderId:String(form.elements.orderId.value),
  dayDate:String(form.elements.dayDate.value),requestKey,fields,
  savedAt:new Date().toISOString(),pending:null};
 if(!worklogDraftWrite(key,d)){
  worklogDraftStatus(form,'Не удалось сохранить черновик. Проверь память телефона.','error');return false;
 }
 const prev=form.dataset.draftKey;
 if(prev&&prev!==key){try{window.localStorage.removeItem(prev);}catch{}}
 form.dataset.draftKey=key;form.dataset.requestKey=requestKey;
 worklogDraftButtons(form,false,true);
 worklogDraftStatus(form,'Черновик сохранён на телефоне · '+d.savedAt,'success');
 return true;
}
function worklogDraftPrepareSubmit(form,payload){
 if(form.dataset.act!=='work_log_full_create')return payload;
 if(form.dataset.draftDecision!=='active'){
  worklogDraftStatus(form,'Восстанови или удали черновик перед отправкой.','error');return null;
 }
 const key=worklogDraftKey(form);let d=worklogDraftRead(key);
 if(worklogDraftPending(form)){
  if(!worklogDraftValid(d,form)||!d.pending||
   d.pending.requestKey!==d.requestKey||d.pending.payload?.requestKey!==d.requestKey||
   d.pending.payload?.orderId!==d.orderId||d.pending.payload?.dayDate!==d.dayDate){
   worklogDraftStatus(form,'Прежний запрос недоступен. Не отправляй новый WorkLog.','error');return null;
  }
  return {...d.pending.payload};
 }
 if(!worklogDraftAutosave(form))return null;
 d=worklogDraftRead(key);if(!worklogDraftValid(d,form))return null;
 const frozen={...payload,requestKey:d.requestKey};
 d.pending={requestKey:d.requestKey,payload:frozen,submittedAt:new Date().toISOString()};
 d.savedAt=new Date().toISOString();
 if(!worklogDraftWrite(key,d)){
  worklogDraftStatus(form,'Не удалось сохранить запрос перед отправкой. Работа не отправлена.','error');return null;
 }
 worklogDraftLock(form,true);return frozen;
}
function worklogDraftSaveFailed(form,httpStatus){
 if(form?.dataset.act!=='work_log_full_create')return;
 // 400/409: definite server rejection and rollback. Network/5xx remains ambiguous.
 if(httpStatus===400||httpStatus===409){
  const key=worklogDraftKey(form),d=worklogDraftRead(key);
  if(worklogDraftValid(d,form)&&d.pending){
   d.pending=null;d.savedAt=new Date().toISOString();
   if(worklogDraftWrite(key,d)){
    worklogDraftLock(form,false);
    worklogDraftStatus(form,'Черновик сохранён на телефоне. Исправь поля и повтори.');return;
   }
  }
 }
 worklogDraftStatus(form,'Ответ PostgreSQL не подтверждён. Прежний запрос сохранён для проверки.','error');
}
function worklogDraftAcknowledge(form){
 if(form?.dataset.act!=='work_log_full_create')return;
 const key=form.dataset.draftKey||worklogDraftKey(form),d=worklogDraftRead(key);
 if(!worklogDraftValid(d,form)||d.requestKey!==form.dataset.requestKey){
  worklogDraftStatus(form,'Работа сохранена в PostgreSQL; локальный черновик требует проверки.','error');return;
 }
 try{
  window.localStorage.removeItem(key);worklogDraftLock(form,false);
  worklogDraftButtons(form,false,false);delete form.dataset.draftKey;
  form.dataset.draftDecision='active';
  worklogDraftStatus(form,'Работа сохранена в PostgreSQL. Локальный черновик удалён.','success');
 }catch{worklogDraftStatus(form,'Работа сохранена в PostgreSQL, но черновик удалить не удалось.','error');}
}
function worklogDraftDelete(form){
 const key=worklogDraftKey(form);if(!key)return false;
 const warning=worklogDraftPending(form)?
  'Запись уже могла сохраниться в PostgreSQL. Удаление локального черновика её НЕ отменяет. Удалить?':
  'Удалить незавершённый черновик с телефона без возможности восстановления?';
 if(!confirm(warning))return false;
 try{window.localStorage.removeItem(key);}
 catch{worklogDraftStatus(form,'Не удалось удалить черновик.','error');return false;}
 worklogDraftLock(form,false);form.dataset.requestKey='';form.dataset.draftDecision='active';
 delete form.dataset.draftKey;worklogDraftButtons(form,false,false);
 form.reset();fullWorkLogFormUpdated(form);
 worklogDraftStatus(form,'Черновик удалён по подтверждению.');return true;
}
