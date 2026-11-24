/**
 * Finance B18 — mobile native-post-cutover operations.
 * Render is read-only until independently signed server source readiness.
 * No historical Google row can ever appear in an editable action.
 */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=x=>Number(x||0).toLocaleString('ru-RU',{maximumFractionDigits:2});
const VALID_DAY=/^\d{4}-\d\d-\d\d$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY=/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
const CATEGORY={
 INCOME:[['other','Прочее поступление'],['bonus','Бонус'],
  ['current_work','Оплата работы по заказу'],['advance','Аванс по заказу']],
 EXPENSE:[['other','Прочий расход'],['materials','Материалы'],
  ['transport','Транспорт'],['tools','Инструменты'],
  ['subcontractor','Субподряд'],['office','Офис']]
};
const FUND_TYPES=[['CAPITAL_TRANSFER','Перевести между фондами'],['CAPITAL_SPEND','Расход из фонда']];
const labels={INCOME:'Поступление',EXPENSE:'Расход',WORKER_ACCRUAL:'Начисление рабочему',
 WORKER_PAYMENT:'Выплата рабочему',WORKER_ACCRUAL_PAYMENT:'Начисление и выплата',
 OWNER_TRANSFER:'Вывод владельцу',TRANSFER:'Перевод фонда',SPEND:'Расход фонда',
 ALLOCATION:'Распределение',REVERSAL:'Сторно'};
const check=x=>{
 if(!x||x.version!=='FINANCE_B18_NATIVE_WORKSPACE_V1'||
    x.source!=='CLEAN_NATIVE_POST_CUTOVER_ONLY'||
    x.historicalArchiveImmutable!==true||x.asOfOpening!=='2026-09-30'||
    !Array.isArray(x.entries)||!Array.isArray(x.funds)||x.funds.length!==8||
    !Array.isArray(x.movements)||typeof x.postingEnabled!=='boolean'||
    !x.ledger||!x.counts)
  throw Error('B18_UNVERIFIED_NATIVE_SOURCE');
 if(x.postingEnabled && (x.phase!=='ACTIVE'||x.authority!=='POSTGRES'||
     x.ledger.isCurrentFinanceBalance!==true))
  throw Error('B18_UNVERIFIED_WRITE_AUTHORITY');
 return x;
};
const requiresOrder=(type,category)=>type==='INCOME'&&['current_work','advance'].includes(category);
const options=(a,selected='')=>a.map(([v,label])=>
 '<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(label)+'</option>').join('');
const fundNames={OPERATING_RESERVE:'Операционный резерв',WARRANTY_RESERVE:'Гарантийный резерв',
 MARKETING_SALES:'Маркетинг и продажи',PEOPLE_TRAINING:'Люди и обучение',
 TOOLS_CREW_KITS:'Инструменты / Crew Kits',RND_MATERIALS:'R&D / материалы',
 DIGITAL_AI_VBOS:'Digital / AI / Business OS',INFRASTRUCTURE:'Инфраструктура'};
const protective=f=>['OPERATING_RESERVE','WARRANTY_RESERVE'].includes(f.code);
function capitalMicro(value){
 const raw=String(value??'');
 // Match B6's canonical balance bound (one trillion AMD), independently of the existing form amount limit.
 if(!/^(0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(raw))throw Error('B18_INVALID_FUND_BALANCE');
 const [whole,frac='']=raw.split('.');
 const micro=BigInt(whole)*1000000n+BigInt(frac.padEnd(6,'0'));
 if(micro>1000000000000n*1000000n)throw Error('B18_INVALID_FUND_BALANCE');
 return micro;
}
function sourceAvailable(f){
 try{return ['active','paused'].includes(f.status)&&capitalMicro(f.balanceAMD)>0n;}
 catch{return false;}
}
function fundOptions(funds,source){
 return '<option value="">Выбери фонд</option>'+funds.filter(f=>source?sourceAvailable(f):f.status==='active').map(f=>
  '<option value="'+esc(f.id)+'">'+esc(Object.hasOwn(fundNames,f.code)?fundNames[f.code]:f.code)+' · '+fmt(f.balanceAMD)+' ֏</option>').join('');
}
// Preflight only; the existing locked PostgreSQL writer remains authoritative.
export function capitalMovementUiCheck(req,funds){
 const {action,payload}=req;
 if(!['CAPITAL_TRANSFER','CAPITAL_SPEND'].includes(action)||!Array.isArray(funds))
  throw Error('B18_FUND_ACTION_INVALID');
 const from=funds.find(f=>f.id===payload.fromFundId);
 if(!from||!['active','paused'].includes(from.status))throw Error('Фонд-источник недоступен.');
 if(capitalMicro(payload.amountBase)<=0n||capitalMicro(payload.amountBase)>capitalMicro(from.balanceAMD))
  throw Error('В выбранном фонде недостаточно денег.');
 if(action==='CAPITAL_TRANSFER'){
  const to=funds.find(f=>f.id===payload.toFundId);
  if(!to||to.status!=='active'||from.id===to.id)throw Error('Выбери другой активный фонд назначения.');
  return protective(from)&&!protective(to)
   ?'Перевод из защитного капитала в капитал роста против базового правила резервов. Продолжить?'
   :'Подтвердить перемещение между фондами?';
 }
 return 'Подтвердить расход из фонда?';
}
function categoryChoices(type,selected){
 return options(CATEGORY[type]||[],selected);
}
function orderOptions(orders){
 return '<option value="">Без заказа</option>'+orders.map(o=>
  '<option value="'+esc(o.id)+'">'+esc(o.title)+' · '+esc(o.objectTitle)+'</option>').join('');
}
function editor(row,today,orders=[],orderListComplete=true){
 const type=row?.operationType||'INCOME';
 const date=row?.date||today;
 const amount=row?.amountOriginal||'';
 const note=row?.notes||'';
 const simple=row&&row.status==='active'&&['INCOME','EXPENSE'].includes(type)&&
  row.currencyOriginal==='AMD'&&CATEGORY[type].some(([k])=>k===row.category);
 if(row&&!simple)return '';
 return '<form data-b18-form="finance" autocomplete="off">'+
  '<h3>'+(row?'Изменить PostgreSQL-операцию':'Новая PostgreSQL-операция')+'</h3>'+
  (row?'<input type="hidden" name="nativeId" value="'+esc(row.id)+'">'+
    '<input type="hidden" name="revision" value="'+esc(row.revision)+'">':'')+
  '<label>Тип<select name="operationType" data-b18-type required'+(row?' disabled':'')+'>'+
   options([['INCOME','Поступление'],['EXPENSE','Расход']],type)+'</select></label>'+
  '<label>Дата<input name="date" type="date" min="2026-10-01" max="'+esc(today)+
    '" value="'+esc(date)+'" required></label>'+
  '<label>Сумма, ֏<input name="amount" type="text" inputmode="decimal" maxlength="20" value="'+
   esc(amount)+'" required placeholder="Например, 15000"></label>'+
  '<label>Категория<select name="category" data-b18-category required>'+categoryChoices(type,row?.category||'')+'</select></label>'+
   (row?(row.workOrderId?'<p class="small muted">Привязанный заказ: '+esc(row.workOrderId)+' (не меняется)</p>':''):
    '<label>Заказ<select name="workOrderId" data-b18-order>'+orderOptions(orders)+'</select></label>'+
    (!orderListComplete?'<p class="muted">Список заказов неполный: отсутствующий заказ нельзя выбирать по названию.</p>':''))+
  '<label>Примечание<textarea name="notes" maxlength="300" rows="2">'+esc(note)+'</textarea></label>'+
  '<div class="actions"><button type="submit" class="primary">'+(row?'Сохранить изменение':'Сохранить операцию')+'</button>'+
   (row?'<button type="button" data-b18-cancel-editor>Закрыть редактор</button>':'')+
  '</div></form>';
}
function fundEditor(funds,today){
 return '<form data-b18-form="capital" autocomplete="off"><h3>Новая операция фонда</h3>'+
  '<label>Тип<select name="action" data-b18-fund-type required>'+options(FUND_TYPES)+'</select></label>'+
  '<label>Дата<input type="date" name="date" min="2026-10-01" max="'+esc(today)+'" value="'+esc(today)+'" required></label>'+
  '<label>Из фонда<select name="fromFundId" required>'+fundOptions(funds,true)+'</select></label>'+
  '<label data-b18-to-fund>В фонд<select name="toFundId" required>'+fundOptions(funds,false)+'</select></label>'+
  '<label>Сумма, ֏<input name="amount" type="text" inputmode="decimal" maxlength="20" required></label>'+
  '<label data-b18-purpose-label><span>Причина перемещения</span><textarea name="purpose" maxlength="300" rows="2" required></textarea></label>'+
  '<label>Комментарий<textarea name="notes" maxlength="300" rows="2"></textarea></label>'+
  '<p class="small muted">Назначение и комментарий сейчас проверяются при вводе, но не сохраняются в истории PostgreSQL.</p>'+
  '<p class="small muted" data-b18-movement-hint>Перевод создаёт отдельное движение и не редактирует баланс вручную.</p>'+
  '<button type="submit" class="primary" data-b18-movement-submit>Переместить</button></form>';
}
export function nativeWorkspaceHtml(raw,mode,{today='2026-11-10',editingId=null}={}){
 const data=check(raw);
 if(!['finance','capital'].includes(mode))throw Error('B18_MODE_INVALID');
 const writable=data.postingEnabled===true;
 const intro='<h2>Новые операции · PostgreSQL</h2>'+
  (writable?'<p><strong>Запись открыта после проверки единственного финансового источника.</strong></p>':
   '<p class="muted"><strong>Запись отключена.</strong> Пока Google не закрыт и PostgreSQL не утверждён как единственный writer, операции здесь только просматриваются.</p>')+
  '<p class="small muted">Исторические данные августа–сентября не редактируются. Начальные остатки на 30.09 сохраняются отдельно.</p>';
 let body='';
 if(mode==='finance'){
  const l=data.ledger;
  body='<p class="small muted">Начальный остаток: '+fmt(l.openingCashAMD)+' ֏. '+
   (l.isCurrentFinanceBalance&&writable?
   'Остаток по внесённым операциям: <b>'+fmt(l.currentCashAMD)+' ֏</b>.':
   'Это не текущий остаток на сегодня.')+'</p>'+
   '<h3>Новые записи ('+esc(data.counts.transactions)+')</h3>';
  if(data.truncated)body+='<p class="muted">Показаны только последние 100 записей.</p>';
  body+=data.entries.length?data.entries.map(row=>{
   const isBasic=['INCOME','EXPENSE'].includes(row.operationType)&&
     row.currencyOriginal==='AMD'&&CATEGORY[row.operationType]?.some(([k])=>k===row.category);
   const isSelected=row.id===editingId;
   const actions=!writable?'':('<div class="actions">'+
    (row.status==='active'&&isBasic?
     '<button type="button" data-b18-edit="'+esc(row.id)+'">Изменить</button>':'')+
    (row.status==='active'&&!(row.operationType==='OWNER_TRANSFER'&&row.category==='owner_transfer')?
     '<button type="button" data-b18-change="'+esc(row.id)+'" data-b18-new-status="cancel">Отменить</button>':'')+
    (row.status==='archived'?
     '<button type="button" data-b18-change="'+esc(row.id)+'" data-b18-new-status="restore">Восстановить</button>':'')+
    '</div>');
   return '<article class="record"><strong>'+esc(labels[row.operationType]||row.operationType)+
    ' · '+fmt(row.amountAMD)+' ֏</strong><div class="muted">'+esc(row.date)+
    ' · '+(row.status==='archived'?'Отменена':'Активна')+
    ' · версия '+esc(row.revision)+'</div><p>'+esc(row.notes)+'</p>'+actions+
    (writable&&isSelected?editor(row,today,data.orders||[],data.orderListComplete!==false):'')+'</article>';
  }).join(''):'<p class="muted">Новых операций пока нет.</p>';
  if(writable)body+='<section class="card">'+editor(null,today,data.orders||[],data.orderListComplete!==false)+'</section>';
 }else{
  body='<h3>Фонды</h3>'+data.funds.map(f=>'<p><strong>'+esc(f.code)+'</strong>: '+
   (writable?fmt(f.balanceAMD)+' ֏':'Начальный баланс '+fmt(f.openingBalanceAMD)+' ֏')+'</p>').join('')+
   '<h3>Новые движения фондов ('+esc(data.counts.movements)+')</h3>'+
   data.movements.map(m=>'<article class="record"><strong>'+
    esc(labels[m.type]||m.type)+' · '+fmt(m.amountAMD)+' ֏</strong>'+
    '<div class="muted">'+esc(m.date)+' · '+esc(m.status)+'</div>'+
    (writable&&m.status==='active'&&['TRANSFER','SPEND'].includes(m.type)?
     '<button type="button" data-b18-reverse="'+esc(m.id)+'">Сторнировать</button>':'')+
    '</article>').join('');
  if(writable)body+='<section class="card">'+fundEditor(data.funds,today)+'</section>';
 }
 return '<section class="card" data-b18-root>'+intro+body+
  '<div role="status" aria-live="polite" data-b18-status></div>'+
  '</section>';
}
function dayValid(date,today){
 return typeof date==='string'&&VALID_DAY.test(date)&&date>='2026-10-01'&&
  date<=today&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&
  new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
}
function moneyValid(money){
 return typeof money==='string'&&MONEY.test(money)&&Number(money)>0;
}
export function nativeWorkspaceFormAction({mode,form,record=null,orders=[],today='2026-11-10'}={}){
 if(!['finance','capital'].includes(mode)||!form||typeof form!=='object')
  throw Error('B18_INVALID_FORM');
 const date=form.date,amount=form.amount;
 if(!dayValid(date,today)||!moneyValid(amount))throw Error('B18_INVALID_DATE_OR_AMOUNT');
 const notes=String(form.notes??'');
 if(notes.length>300)throw Error('B18_NOTES_TOO_LONG');
 if(mode==='finance'){
  const type=record?.operationType||form.operationType;
  if(!CATEGORY[type]?.some(([k])=>k===form.category))throw Error('B18_CATEGORY_INVALID');
  const content={transactionDate:date,amountOriginal:amount,category:form.category,notes};
  if(!record){
   const id=String(form.workOrderId||'');
   if(requiresOrder(type,form.category)&&!id)throw Error('B19_ORDER_REQUIRED');
   if(id){
    if(!UUID.test(id)||!Array.isArray(orders)||!orders.some(o=>o.id===id))
     throw Error('B19_UNKNOWN_CANONICAL_ORDER');
    content.workOrderId=id;
   }
  }
  if(record){
   if(record.status!=='active'||!Number.isSafeInteger(record.revision)||record.revision<1||
      record.currencyOriginal!=='AMD'||record.operationType!==type)
    throw Error('B18_EDIT_SOURCE_INVALID');
   return {action:'FINANCE_EDIT',payload:{financeTransactionId:record.id,
    expectedRevision:record.revision,patch:content}};
  }
  return {action:'FINANCE_CREATE',payload:{operationType:type,...content,currencyOriginal:'AMD'}};
 }
 const action=form.action;
 if(!FUND_TYPES.some(([k])=>k===action))throw Error('B18_FUND_ACTION_INVALID');
 if(!UUID.test(form.fromFundId||''))throw Error('B18_FUND_SOURCE_INVALID');
 if(action==='CAPITAL_TRANSFER' &&
    (!UUID.test(form.toFundId||'')||form.fromFundId===form.toFundId))
  throw Error('B18_FUND_DESTINATION_INVALID');
 const purpose=String(form.purpose||'').trim();
 if(!purpose||purpose.length>300)throw Error('B18_PURPOSE_REQUIRED');
 return {action,payload:{
  fromFundId:form.fromFundId,
  ...(action==='CAPITAL_TRANSFER'?{toFundId:form.toFundId}:{}),
  amountBase:amount,transactionDateKey:date,purpose,notes
 }};
}
export function mountFinanceNativeWorkspace(root,{mode,fetchPage,postAction,today,onSource}={}){
 if(!root||typeof root.addEventListener!=='function'||typeof fetchPage!=='function'||
    typeof postAction!=='function'||!['finance','capital'].includes(mode))
  throw Error('B18_CONFIGURATION_MISSING');
 let live=true,state=null,busy=false,editingId=null,pending=null;
 const show=()=>{if(live&&state)root.innerHTML=nativeWorkspaceHtml(state,mode,{today,editingId});};
 const status=(msg,error=false)=>{
  const el=root.querySelector('[data-b18-status]');
  if(el){el.textContent=msg;el.classList.toggle('error',error);}
 };
 const load=async()=>{
  if(!live)return;
  try{
   const data=check(await fetchPage('/api/finance/native-workspace'));
   if(!live)return;state=data;editingId=null;show();
   if(typeof onSource==='function')onSource({phase:data.phase,authority:data.authority});
  }catch{
   if(live){state=null;root.innerHTML='<section class="card"><h2>Новые операции · PostgreSQL</h2><p role="alert">Источник не прошёл проверку. Запись недоступна.</p><button data-b18-retry-load>Повторить загрузку</button></section>';}
  }
 };
 const act=async(req)=>{
  if(!live||!state?.postingEnabled||busy||pending) return;
  pending={requestKey:crypto.randomUUID(),...req};
  await send();
 };
 const send=async()=>{
  if(!live||!state?.postingEnabled||!pending||busy)return;
  busy=true;
  try{
   const answer=await postAction(pending);
   if(!answer||answer.replayed!==false&&answer.replayed!==true||
      answer.synthetic!==false||!answer.sourceId)
    throw Error('B18_UNVERIFIED_WRITE_RECEIPT');
   pending=null;await load();if(live)status('Сохранено в PostgreSQL. Результат перечитан с сервера.');
  }catch(e){
   if(!live)return;
   const code=String(e?.message||'');
   if(/REVISION_CONFLICT|STATUS_CONFLICT/.test(code)||Number(e?.httpStatus)===409){
    pending=null;await load();
    if(live)status('Запись уже изменилась. Проверь свежую версию.',true);
   }else if([400,403,503].includes(Number(e?.httpStatus))){
    // Explicit reject: no money was committed, allow correction after review.
    pending=null;
    if(Number(e.httpStatus)===503){await load();
     if(live)status('Финансовая запись заблокирована источником. Ничего не сохранено.',true);
    }else if(live)status('Операция отклонена. Исправь поля и проверь ещё раз.',true);
   }else{
    status('Сохранение не подтверждено. Не повторяй вручную: используй кнопку повтора с тем же номером запроса.',true);
    let slot=root.querySelector('[data-b18-status]');
    if(slot){const button=document.createElement('button');
     button.type='button';button.dataset.b18RetryPost='1';
     button.textContent='Повторить тот же запрос';slot.append(button);}
   }
  }finally{busy=false;}
 };
 const click=e=>{
  if(!live)return;
  const target=e.target?.closest?.('button');if(!target)return;
  if(target.hasAttribute('data-b18-retry-load')){void load();return;}
  if(target.hasAttribute('data-b18-retry-post')){void send();return;}
  if(!state?.postingEnabled||busy||pending)return;
  if(target.hasAttribute('data-b18-cancel-editor')){editingId=null;show();return;}
  const id=target.dataset.b18Edit;
  if(id){const row=state.entries.find(x=>x.id===id&&x.status==='active');
   if(!row)return;editingId=id;show();return;}
  const change=target.dataset.b18Change,which=target.dataset.b18NewStatus;
  if(change){
   const row=state.entries.find(x=>x.id===change);
   if(!row||!['cancel','restore'].includes(which))return;
   if(which==='cancel'&&row.status!=='active'||which==='restore'&&row.status!=='archived')return;
   if(!confirm(which==='cancel'?'Отменить операцию?':'Восстановить операцию?'))return;
   void act({action:which==='cancel'?'FINANCE_CANCEL':'FINANCE_RESTORE',
    payload:{financeTransactionId:row.id,expectedRevision:row.revision}});return;
  }
  const reverse=target.dataset.b18Reverse;
  if(reverse){
   const m=state.movements.find(x=>x.id===reverse&&x.status==='active'&&['TRANSFER','SPEND'].includes(x.type));
   if(!m||!confirm('Сторнировать движение фонда?'))return;
   void act({action:'CAPITAL_REVERSE',payload:{fundTransactionId:m.id,
    transactionDateKey:today,reason:'Исправление ошибочной операции',notes:''}});
  }
 };
 const change=e=>{
  if(!live||!state?.postingEnabled)return;
  const field=e.target;if(field?.matches?.('[data-b18-type]')){
   const s=field.closest('form')?.querySelector('[data-b18-category]');
   if(s)s.innerHTML=categoryChoices(field.value,'');
    const select=field.closest('form')?.querySelector('[data-b18-order]');
    if(select)select.required=false;
  }
  if(field?.matches?.('[data-b18-category]')){
    const f=field.closest('form'),order=f?.querySelector('[data-b18-order]');
    if(order)order.required=requiresOrder(f.querySelector('[data-b18-type]')?.value,field.value);
   }
   if(field?.matches?.('[data-b18-fund-type]')){
   const label=field.closest('form')?.querySelector('[data-b18-to-fund]');
   if(label){label.hidden=field.value!=='CAPITAL_TRANSFER';
    const select=label.querySelector('select');if(select)select.disabled=label.hidden;}
   const form=field.closest('form'),transfer=field.value==='CAPITAL_TRANSFER';
   const purpose=form?.querySelector('[data-b18-purpose-label] span');
   const hint=form?.querySelector('[data-b18-movement-hint]');
   const button=form?.querySelector('[data-b18-movement-submit]');
   if(purpose)purpose.textContent=transfer?'Причина перемещения':'Назначение расхода';
   if(hint)hint.textContent=transfer?'Перевод создаёт отдельное движение и не редактирует баланс вручную.':'Расход уменьшает зарезервированный баланс, не удаляя историю наполнения.';
   if(button)button.textContent=transfer?'Переместить':'Записать расход';
  }
 };
 const submit=e=>{
  const form=e.target;if(!form?.hasAttribute?.('data-b18-form'))return;
  e.preventDefault();
  if(!live||!state?.postingEnabled||busy||pending)return;
  const values=Object.fromEntries(new FormData(form));
  const row=values.nativeId?state.entries.find(x=>x.id===values.nativeId&&x.id===editingId):null;
  try{
   if(values.nativeId&&!row)throw Error('B18_EDITOR_STATE_CHANGED');
   const req=nativeWorkspaceFormAction({mode,form:values,record:row,orders:state.orders||[],today});
   if(mode==='capital'&&!confirm(capitalMovementUiCheck(req,state.funds)))return;
   void act(req);
  }
  catch(error){status(String(error.message||'Неправильная операция.'),true);}
 };
 root.addEventListener('click',click);
 root.addEventListener('change',change);
 root.addEventListener('submit',submit);
 void load();
 return {load,unmount(){live=false;root.removeEventListener('click',click);
  root.removeEventListener('change',change);root.removeEventListener('submit',submit);}};
}
