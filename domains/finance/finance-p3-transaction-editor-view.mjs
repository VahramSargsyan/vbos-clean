/**
 * Finance P3 — one complete native transaction edit/status UI.
 * Uses ONLY the existing B17/B14 FINANCE_EDIT/CANCEL/RESTORE writer and owner POST.
 * Never changes linked WorkOrder/Object/Client/Worker IDs, source identity or investment batches.
 */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY=/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const types={INCOME:'Доход',EXPENSE:'Расход',WORKER_ACCRUAL:'Начисление рабочему',
 WORKER_PAYMENT:'Выплата рабочему',WORKER_ACCRUAL_PAYMENT:'Начисление и выплата',
 OWNER_TRANSFER:'Вывод владельцу'};
const incomes=[['current_work','Оплата работы'],['advance','Аванс'],['client_material_funds','Деньги клиента на материалы'],
 ['old_debt','Старый долг'],['bonus','Бонус'],['other','Другой доход']];
const expenses=[['materials','Материалы'],['client_material_purchase','Покупка материалов за деньги клиента'],
 ['transport','Транспорт'],['tools','Инструменты'],['subcontractor','Подрядчик'],['office','Офис'],['other','Другой расход']];
const recognitions=[['EARNED_AND_RECEIVED','Заработано и получено'],['RECEIVED_ONLY','Только получено'],['EARNED_ONLY','Только заработано']];
const directions=[['wife','Жене'],['home','Домой'],['self','Себе'],['other','Другое']];
const currencies=[['AMD','AMD'],['USD','USD'],['EUR','EUR']];
function options(vals,sel){
 return vals.map(([v,n])=>'<option value="'+esc(v)+'"'+(v===sel?' selected':'')+'>'+esc(n)+'</option>').join('');
}
function dayValid(s,today){
 if(typeof s!=='string'||!/^\d{4}-\d\d-\d\d$/.test(s)||s<'2026-10-01'||s>today)return false;
 const t=Date.parse(s+'T00:00:00Z');
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s;
}
function amount(s,zero=false){
 return typeof s==='string'&&MONEY.test(s)&&Number(s)>=(zero?0:0.000001)&&
  Number.isFinite(Number(s))&&(zero||Number(s)>0);
}
export function financeP3ValidDetail(x){
 const r=x?.record;
 if(x?.version!=='FINANCE_P3_NATIVE_DETAIL_V1'||x.source!=='CLEAN_NATIVE_FINANCE_ONLY'||
    x.readonly!==true||x.historicalIncluded!==false||x.postingEnabled!==true||
    !r||!UUID.test(r.id)||!Number.isSafeInteger(r.revision)||r.revision<1||
    !Object.hasOwn(types,r.operationType)||!['active','archived'].includes(r.status)||
    !['AMD','USD','EUR'].includes(r.currencyOriginal)||!r.date||
    typeof r.linkedFinCap!=='boolean'||typeof r.editable!=='boolean'||
    typeof r.cancellable!=='boolean'||typeof r.restorable!=='boolean')
  throw Error('FINANCE_P3_UNVERIFIED_NATIVE_DETAIL');
 if((r.status==='archived'&&(r.editable||r.cancellable))||
    (r.status==='active'&&r.restorable))
  throw Error('FINANCE_P3_STATUS_FLAGS_INVALID');
 if(r.linkedFinCap&&[r.editable,r.cancellable,r.restorable].some(Boolean))
  throw Error('FINANCE_P3_LINKED_BATCH_GUARD');
 if(r.operationType==='OWNER_TRANSFER'&&r.ownerDirection==='investments'&&
    [r.editable,r.cancellable,r.restorable].some(Boolean))
  throw Error('FINANCE_P3_INVESTMENT_GUARD');
 return r;
}
export function financeP3MutationFor(detail,form,command,today){
 const r=financeP3ValidDetail(detail);
 if(!['EDIT','CANCEL','RESTORE'].includes(command))throw Error('FINANCE_P3_COMMAND_INVALID');
 if(command!=='EDIT'){
  if(command==='CANCEL'?!r.cancellable:!r.restorable)
   throw Error('FINANCE_P3_STATUS_CHANGE_FORBIDDEN');
  return {action:command==='CANCEL'?'FINANCE_CANCEL':'FINANCE_RESTORE',
   payload:{financeTransactionId:r.id,expectedRevision:r.revision}};
 }
 if(!r.editable||r.status!=='active')throw Error('FINANCE_P3_EDIT_FORBIDDEN');
 if(!form||typeof form!=='object')throw Error('FINANCE_P3_FORM_REQUIRED');
 if(!dayValid(form.transactionDate,today)||!amount(form.amountOriginal)||
    !amount(form.commissionOriginal,true))
  throw Error('FINANCE_P3_DATE_OR_AMOUNT_INVALID');
 if(!currencies.some(([c])=>c===form.currencyOriginal))throw Error('FINANCE_P3_CURRENCY_INVALID');
 if(form.currencyOriginal!=='AMD'&&(!amount(form.fxRate)||!dayValid(form.fxRateDate,today)))
  throw Error('FINANCE_P3_FX_INVALID');
 const notes=String(form.notes??''),counterparty=String(form.counterparty??'');
 if(notes.length>5000||counterparty.length>300)throw Error('FINANCE_P3_TEXT_TOO_LONG');
 const patch={transactionDate:form.transactionDate,amountOriginal:form.amountOriginal,
  currencyOriginal:form.currencyOriginal,commissionOriginal:form.commissionOriginal,
  counterparty,notes};
 if(form.currencyOriginal!=='AMD'){
  patch.fxRate=form.fxRate;patch.fxRateDate=form.fxRateDate;patch.fxRateSource='manual';
 }
 if(r.operationType==='INCOME'){
  if(!incomes.some(([v])=>v===form.category)||!recognitions.some(([v])=>v===form.incomeRecognition))
   throw Error('FINANCE_P3_INCOME_CATEGORY_INVALID');
  if(form.category==='client_material_funds'&&form.incomeRecognition!=='RECEIVED_ONLY')
   throw Error('FINANCE_P3_CLIENT_MATERIAL_RECOGNITION');
  if(form.incomeRecognition==='EARNED_ONLY'&&Number(form.commissionOriginal)>0)
   throw Error('FINANCE_P3_UNPAID_COMMISSION');
  if(['current_work','advance','client_material_funds'].includes(form.category)&&!r.workOrderId)
   throw Error('FINANCE_P3_ORDER_REQUIRED');
  patch.category=form.category;patch.incomeRecognition=form.incomeRecognition;
 }
 if(r.operationType==='EXPENSE'){
  if(!expenses.some(([v])=>v===form.category))throw Error('FINANCE_P3_EXPENSE_CATEGORY_INVALID');
  if(form.category==='client_material_purchase'&&!r.workOrderId)
   throw Error('FINANCE_P3_ORDER_REQUIRED');
  patch.category=form.category;
 }
 if(r.operationType.startsWith('WORKER_')){
  if(!r.workerId||(['WORKER_ACCRUAL','WORKER_ACCRUAL_PAYMENT'].includes(r.operationType)&&!r.workOrderId))
   throw Error('FINANCE_P3_WORKER_LINK_REQUIRED');
  if(r.operationType==='WORKER_ACCRUAL'&&Number(form.commissionOriginal)>0)
   throw Error('FINANCE_P3_ACCRUAL_COMMISSION');
 }
 if(r.operationType==='OWNER_TRANSFER'){
  if(!directions.some(([v])=>v===form.ownerDirection))
   throw Error('FINANCE_P3_OWNER_DIRECTION_INVALID');
  patch.ownerDirection=form.ownerDirection;
 }
 return {action:'FINANCE_EDIT',payload:{financeTransactionId:r.id,
  expectedRevision:r.revision,patch}};
}
export function financeP3EditorHtml(detail,{busy=false,status='',error=false,today='2026-11-23'}={}){
 const r=financeP3ValidDetail(detail);
 const state=r.status==='archived'?'Отменена':'Активна';
 const note=r.linkedFinCap||r.ownerDirection==='investments'?
  '<p role="status" class="finance-p3-warning">Связанная инвестиция/распределение фондов: редактирование, отмена и восстановление запрещены текущим writer.</p>':'';
 const lbl=(text,name,value,type='text',extra='')=>
  '<label>'+esc(text)+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+
  '" '+extra+'></label>';
 const choice=(text,name,items,v)=>'<label>'+esc(text)+'<select name="'+name+'" required>'+options(items,v)+'</select></label>';
 const specialized=r.operationType==='INCOME'?
   choice('Категория дохода','category',incomes,r.category)+
   choice('Признание денег и прибыли','incomeRecognition',recognitions,r.incomeRecognition):
  r.operationType==='EXPENSE'?choice('Категория расхода','category',expenses,r.category):
  r.operationType==='OWNER_TRANSFER'?choice('Направление','ownerDirection',directions,r.ownerDirection):'';
 const links=[['Заказ',r.workOrderId],['Объект',r.objectId],['Клиент',r.clientId],['Работник',r.workerId]]
  .filter(([,v])=>v).map(([label,v])=>'<span>'+esc(label)+': '+esc(v)+'</span>').join('');
 const form=r.editable?
  '<form data-finance-p3-form autocomplete="off">'+specialized+
  lbl('Дата','transactionDate',r.date,'date','min="2026-10-01" max="'+esc(today)+'" required')+
  lbl('Сумма в исходной валюте','amountOriginal',r.amountOriginal,'text','inputmode="decimal" required')+
  choice('Валюта','currencyOriginal',currencies,r.currencyOriginal)+
  '<div data-finance-p3-fx'+(r.currencyOriginal==='AMD'?' hidden':'')+'>'+
  lbl('Курс к AMD','fxRate',r.fxRate,'text','inputmode="decimal"')+
  lbl('Дата курса','fxRateDate',r.fxRateDate,'date','min="2026-10-01" max="'+esc(today)+'"')+'</div>'+
  lbl('Комиссия в исходной валюте','commissionOriginal',r.commissionOriginal,'text','inputmode="decimal" required')+
  lbl('Контрагент','counterparty',r.counterparty,'text','maxlength="300"')+
  '<label>Комментарий<textarea name="notes" maxlength="5000" rows="3">'+esc(r.notes)+'</textarea></label>'+
  '<button class="primary" type="submit"'+(busy?' disabled':'')+'>Сохранить изменение</button></form>':'';
 const cmd=(r.cancellable?'<button type="button" data-finance-p3-command="CANCEL"'+(busy?' disabled':'')+
  '>Отменить операцию</button>':'')+
  (r.restorable?'<button type="button" data-finance-p3-command="RESTORE"'+(busy?' disabled':'')+
   '>Восстановить операцию</button>':'');
 return '<section class="finance-p3-editor" data-finance-p3-editor aria-label="Редактор нативной финансовой операции">'+
  '<div class="finance-p3-title"><h3>'+esc(types[r.operationType])+' · PostgreSQL</h3>'+
  '<button type="button" data-finance-p3-close'+(busy?' disabled':'')+'>Закрыть</button></div>'+
  '<p class="small muted">Статус: '+esc(state)+' · версия '+esc(r.revision)+
  '. Неизменяемые связи и тип операции показаны ниже.</p>'+
  (links?'<p class="finance-p3-links">'+links+'</p>':'')+
  '<p class="small muted">ID нативной операции: '+esc(r.id)+'</p>'+note+form+
  '<div class="finance-p3-commands">'+cmd+'</div>'+
  '<div role="'+(error?'alert':'status')+'" data-finance-p3-status>'+esc(status)+'</div>'+
  '<button type="button" data-finance-p3-retry hidden>Повторить тот же запрос</button>'+
  '</section>';
}
export function mountFinanceP3Editor(root,{fetchPage,postAction,onSaved,today}={}){
 if(!root||typeof root.addEventListener!=='function'||typeof fetchPage!=='function'||
  typeof postAction!=='function'||typeof onSaved!=='function'||
  !dayValid(today,today))throw Error('FINANCE_P3_MOUNT_INVALID');
 let live=true,seq=0,detail=null,busy=false,pending=null,feedback='',failed=false;
 function render(){
  if(!live)return;
  root.innerHTML=detail?financeP3EditorHtml(detail,{busy,status:feedback,error:failed,today}):'';
  if(pending&&!busy){
   const retry=root.querySelector('[data-finance-p3-retry]');
   if(retry)retry.hidden=false;
  }
 }
 const open=async id=>{
  if(!live||pending||busy)return false;
  if(!UUID.test(id))return false;
  const n=++seq;detail=null;feedback='';failed=false;
  root.innerHTML='<section class="finance-p3-editor" role="status">Загрузка нативной операции…</section>';
  try{
   const response=await fetchPage('/api/finance/native-transaction-detail?id='+encodeURIComponent(id));
   if(!live||n!==seq)return false;
   const record=financeP3ValidDetail(response);
   if(record.id!==id)throw Error('FINANCE_P3_RECORD_ID_MISMATCH');
   detail=response;render();
   root.scrollIntoView?.({behavior:'smooth',block:'start'});
   return true;
  }catch(e){
   if(live&&n===seq){root.innerHTML='<p role="alert">Не удалось открыть редактор нативной операции. Старый архив не редактируется.</p>';}
   return false;
  }
 };
 const close=()=>{if(!busy&&!pending){seq++;detail=null;feedback='';render();}};
 const send=async()=>{
  if(!live||busy||!pending||!detail)return;
  busy=true;feedback='Сохраняю в PostgreSQL…';failed=false;render();
  try{
   const answer=await postAction(pending);
   const r=detail.record;
   if(!answer||answer.sourceKind!=='FinanceTransaction'||answer.sourceId!==r.id||
     answer.action!==pending.action||answer.synthetic!==false||
     ![true,false].includes(answer.replayed)||
     answer.revisionBefore!==r.revision||
     answer.revisionAfter!==r.revision+1)
    throw Error('FINANCE_P3_UNVERIFIED_WRITE_RECEIPT');
   const id=r.id;
   pending=null;busy=false;
   await open(id);
   if(live){feedback='Сохранено в PostgreSQL. Версия и эффект перечитаны с сервера.';failed=false;render();}
   await onSaved();
  }catch(e){
   if(!live)return;
   const code=String(e?.message||'');
   const status=Number(e?.httpStatus);
   if(status===409||/REVISION_CONFLICT|STATUS_CONFLICT/.test(code)){
    const id=detail.record.id;pending=null;busy=false;await open(id);
    feedback='Запись уже изменилась. Проверь новую версию перед сохранением.';failed=true;render();
   }else if([400,403,503].includes(status)){
    pending=null;feedback='Операция отклонена защитой. Ничего повторно не отправлено.';failed=true;render();
   }else{
    feedback='Ответ сервера не подтверждён. Не создавай другой запрос; повтори с тем же номером.';failed=true;
    render();
   }
  }finally{busy=false;if(live)render();}
 };
 const click=e=>{
  const b=e.target?.closest?.('button');if(!b||!live)return;
  if(b.hasAttribute('data-finance-p3-close')){close();return;}
  if(b.hasAttribute('data-finance-p3-retry')){void send();return;}
  const command=b.dataset.financeP3Command;
  if(!command||!detail||pending||busy)return;
  if(!confirm(command==='CANCEL'?'Отменить эту PostgreSQL-операцию?':
   'Восстановить эту PostgreSQL-операцию?'))return;
  try{
   pending={requestKey:crypto.randomUUID(),
    ...financeP3MutationFor(detail,{},command,today)};
   void send();
  }catch(e){feedback=String(e?.message||'Недопустимый статус');failed=true;render();}
 };
 const submit=e=>{
  if(!e.target?.hasAttribute?.('data-finance-p3-form'))return;
  e.preventDefault();if(!live||!detail||pending||busy)return;
  try{
   const form=e.target;
   if(form.reportValidity&&!form.reportValidity())return;
   const values=Object.fromEntries(new FormData(form));
   pending={requestKey:crypto.randomUUID(),
    ...financeP3MutationFor(detail,values,'EDIT',today)};
   if(!confirm('Сохранить изменение существующей финансовой операции? Денежный результат будет пересчитан текущим writer.')){
    pending=null;return;
   }
   void send();
  }catch(e){feedback=String(e?.message||'Проверь поля');failed=true;render();}
 };
 const change=e=>{
  if(!live||!detail)return;
  const field=e.target,form=field?.closest?.('[data-finance-p3-form]');
  if(!form)return;
  if(field.name==='currencyOriginal'){
   const wrap=form.querySelector('[data-finance-p3-fx]');
   if(wrap){wrap.hidden=field.value==='AMD';
    for(const el of wrap.querySelectorAll('input'))el.required=!wrap.hidden;}
  }
  if(field.name==='category'&&form.elements?.incomeRecognition){
   form.elements.incomeRecognition.value=
    ['advance','old_debt','client_material_funds'].includes(field.value)?
     'RECEIVED_ONLY':'EARNED_AND_RECEIVED';
  }
 };
 root.addEventListener('click',click);root.addEventListener('submit',submit);root.addEventListener('change',change);
 return {open,close,unmount(){live=false;seq++;root.removeEventListener('click',click);
  root.removeEventListener('submit',submit);root.removeEventListener('change',change);}};
}
