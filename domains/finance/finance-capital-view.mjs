/** Existing Clean TEST only. Frozen Finance/Capital evidence, NOT live financial writer. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rubles=x=>{const n=Number(x);return Number.isFinite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:2})+' AMD':'—';};
function summaryCard(label,value,hint=''){return '<div class="card"><span>'+esc(label)+'</span><strong>'+rubles(value)+'</strong>'+(hint?'<small class="muted">'+esc(hint)+'</small>':'')+'</div>';}
/** Finance Legacy Parity B2. The original five forms are UI-only until single-writer cutover.
 * No HTTP POST, storage, local balance computation, or mutation of archived records. */
const LEGACY_FORMS=Object.freeze(['INCOME','EXPENSE','WORKER','OWNER_TRANSFER','INVEST']);
const LEGACY_INCOME=Object.freeze([
 ['current_work','Оплата текущей работы'],['advance','Аванс'],['old_debt','Старый долг'],
 ['bonus','Бонус'],['other','Другой доход']]);
const LEGACY_EXPENSE=Object.freeze([
 ['materials','Материалы'],['transport','Транспорт'],['tools','Инструменты'],
 ['subcontractor','Подрядчик'],['office','Офис'],['other','Другой расход']]);
const LEGACY_RECOGNITION=Object.freeze([
 ['EARNED_AND_RECEIVED','Заработано и получено'],['RECEIVED_ONLY','Только получено'],
 ['EARNED_ONLY','Только заработано']]);
const LEGACY_WORKER=Object.freeze([
 ['WORKER_ACCRUAL','Начисление рабочему'],['WORKER_PAYMENT','Выплата рабочему'],
 ['WORKER_ACCRUAL_PAYMENT','Начисление и выплата']]);
const LEGACY_OWNER=Object.freeze([
 ['wife','Жене'],['home','Домой'],['self','Себе'],['investments','В инвестиции'],['other','Другое']]);
const LEGACY_CURRENCY=Object.freeze([['AMD','AMD'],['USD','USD'],['EUR','EUR']]);
const LEGACY_TITLES=Object.freeze({
 INCOME:'Доход',EXPENSE:'Расход',WORKER:'Рабочий',
 OWNER_TRANSFER:'Вывод денег',INVEST:'Инвестировать'});
function legacyOptions(list,selected){
 return list.map(([id,label])=>'<option value="'+esc(id)+'"'+
  (selected===id?' selected':'')+'>'+esc(label)+'</option>').join('');
}
function legacyReferences(refs,group){
 const raw=Array.isArray(refs?.[group])?refs[group]:[];
 const ids=new Set();
 return raw.filter(x=>x&&typeof x.id==='string'&&x.id&&
   !ids.has(x.id)&&ids.add(x.id)).slice(0,500);
}
function legacyLinkOptions(items,placeholder,title){
 return '<option value="">'+esc(placeholder)+'</option>'+
  items.map(x=>'<option value="'+esc(x.id)+'"'+
   (x.object_id?' data-object-id="'+esc(x.object_id)+'"':'')+'>'+
   esc(String(x[title]||x.name||x.title||x.id))+'</option>').join('');
}
function legacyDay(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
/** Only the currently active, still-open session is eligible for Finance prefill.
 * A selected/planned order or an old date is never silently treated as the active order.
 */
export function financeLegacyActiveOrder(snapshot,today){
 const session=snapshot?.currentSession;
 if(!session||session.ended_at!==null||
    session.day_date!==today||!session.order_id)return null;
 const current=snapshot?.contextOrder;
 if(!current||current.id!==session.order_id||!current.object_id||
    !['open','active'].includes(String(current.status||'')))return null;
 return {
  id:current.id,title:String(current.title||session.order_title||current.id),
  object_id:current.object_id,objectName:String(current.object_name||''),
  objectId:current.object_id
 };
}
/** Validate untrusted response from the existing catalog or the new native workers GET. */
export function financeLegacySearchResult(kind,response,term){
 const q=String(term||'').trim();
 if(!['orders','objects','workers'].includes(kind)||!response||
    !Array.isArray(response.items)||response.items.length>50||
    typeof response.hasMore!=='boolean'||response.q!==q)throw Error('Недостоверный ответ поиска');
 if(kind==='workers'){
  if(response.source!=='CLEAN_TEST_NATIVE_WORKER_DIRECTORY'||response.readonly!==true||
     response.financeMappingVerified!==false)throw Error('Не подтверждён источник исполнителей');
 }else if(response.entity!==kind)throw Error('Не подтверждён раздел поиска');
 if(response.hasMore?typeof response.nextCursor!=='string'||!response.nextCursor:
    response.nextCursor!==null&&response.nextCursor!==undefined)
  throw Error('Неверная страница поиска');
 const ids=new Set();
 const list=response.items.map(x=>{
  if(!x||typeof x.id!=='string'||!x.id||ids.has(x.id))throw Error('Некорректный ID поиска');
  ids.add(x.id);
  const label=kind==='orders'?x.title:x.name;
  if(typeof label!=='string'||!label.trim())throw Error('Некорректное название');
  if(kind==='orders'&&typeof x.object_id!=='string')throw Error('Заказ без объекта');
  return {id:x.id,...(kind==='orders'?{title:label,object_id:x.object_id}:{name:label}),
   status:String(x.status||'')};
 });
 return {items:list,hasMore:response.hasMore,nextCursor:response.nextCursor||null};
}

/** Renders the same conditional fields as legacy Scripts.html, never a financial writer. */
export function financeLegacyFormHtml(action,{today='2026-11-13',refs={},liveEnabled=false}={}){
 if(!LEGACY_FORMS.includes(action))throw Error('FINANCE_LEGACY_ACTION_INVALID');
 const date=legacyDay(today)?today:'2026-11-13';
 const orders=legacyReferences(refs,'orders');
 const objects=legacyReferences(refs,'objects');
 const workers=legacyReferences(refs,'workers');
 const income=action==='INCOME',expense=action==='EXPENSE',worker=action==='WORKER';
 const owner=action==='OWNER_TRANSFER'||action==='INVEST';
 let special='';
 if(income)special='<label>Категория<select name="category" required>'+
  legacyOptions(LEGACY_INCOME,'current_work')+'</select></label>'+
  '<label>Как учитывать<select name="incomeRecognition" required>'+
  legacyOptions(LEGACY_RECOGNITION,'EARNED_AND_RECEIVED')+'</select></label>';
 if(expense)special='<label>Категория<select name="category" required>'+
  legacyOptions(LEGACY_EXPENSE,'other')+'</select></label>';
 if(worker)special='<label>Действие<select name="operationType" required>'+
  legacyOptions(LEGACY_WORKER,'WORKER_ACCRUAL')+'</select></label>'+
  '<label>Работник<select name="workerId" required>'+legacyLinkOptions(workers,'Выбери работника','name')+
  '</select></label>';
 if(owner)special=action==='INVEST'?
  '<input type="hidden" name="ownerDirection" value="investments">'+
  '<p class="small muted">Инвестирование списывает сумму и распределяет её по восьми фондам по действующей политике. Операция необратима через обычную кнопку отмены.</p>':
  '<label>Куда выведены деньги<select name="ownerDirection" required>'+
  legacyOptions(LEGACY_OWNER,'home')+'</select></label>';
 const search=owner?'':'<div class="finance-legacy-reference-search" data-finance-legacy-reference-search>'+
  '<strong>Поиск связанной записи</strong><div class="finance-legacy-search-fields">'+
  '<select data-finance-legacy-search-kind aria-label="Что найти">'+
  (worker?'<option value="workers">Работник</option>':'')+
  '<option value="orders">Заказ</option><option value="objects">Объект</option></select>'+
  '<input type="search" data-finance-legacy-search-query minlength="2" maxlength="80" placeholder="Имя, объект, заказ или ID" aria-label="Строка поиска">'+
  '<button type="button" data-finance-legacy-search>Найти</button></div>'+
  '<p class="small muted" data-finance-legacy-search-status aria-live="polite">Поиск по всему реестру, не только по первым 500 записям.</p>'+
  '<button type="button" class="compact" data-finance-legacy-search-more hidden>Показать ещё</button></div>';
 const relations=owner?'':('<label>Заказ<select name="workOrderId" data-finance-legacy-order>'+
  legacyLinkOptions(orders,'Без заказа','title')+'</select></label>'+
  '<label>Объект<select name="objectId" data-finance-legacy-object>'+
  legacyLinkOptions(objects,'Без объекта','name')+'</select></label>'+
  '<p class="small muted" data-finance-legacy-current-order-status aria-live="polite">Текущий заказ не выбран автоматически. При наличии активной работы он будет проверен отдельно.</p>'+
  '<p class="small muted">Связи PostgreSQL TEST не подтверждают идентичность старых финансовых ID. Поиск работает только в режиме проверки формы.</p>');
 return '<dialog class="finance-legacy-dialog" data-finance-legacy-dialog aria-labelledby="financeLegacyFormHeading">'+
  '<div class="finance-legacy-head"><h2 id="financeLegacyFormHeading">'+esc(LEGACY_TITLES[action])+
  ' · форма старого VBOS</h2><button type="button" data-finance-legacy-close aria-label="Закрыть">✕</button></div>'+
  '<div class="finance-legacy-body">'+
  (liveEnabled?'<p class="finance-legacy-warning" role="status"><strong>PostgreSQL TEST.</strong> Эта операция создаст настоящую запись в новой базе. Архив старого VBOS не меняется.</p>':
   '<p class="finance-legacy-warning" role="status"><strong>ТОЛЬКО ПРОВЕРКА ФОРМЫ.</strong> Ни одна сумма не сохраняется.</p>')+
  '<form data-finance-legacy-form autocomplete="off">'+
  '<input type="hidden" name="legacyAction" value="'+esc(action)+'">'+
  (worker?'':'<input type="hidden" name="operationType" value="'+esc(owner?'OWNER_TRANSFER':action)+'">')+
  special+
  '<label>Дата<input type="date" name="transactionDate" value="'+esc(date)+'" required></label>'+
  relations+search+
  '<label>Сумма<input type="number" name="amountOriginal" min="0.01" step="0.01" required inputmode="decimal"></label>'+
  '<label>Валюта<select name="currencyOriginal">'+legacyOptions(LEGACY_CURRENCY,'AMD')+'</select></label>'+
  '<label data-finance-legacy-fx hidden>Курс к AMD<input type="number" name="fxRate" min="0.000001" step="0.000001" value="1"></label>'+
  '<label>Комиссия в исходной валюте<input type="number" name="commissionOriginal" min="0" step="0.01" value="0"></label>'+
  '<label>Контрагент<input type="text" name="counterparty" maxlength="300"></label>'+
  '<label>Комментарий<textarea name="notes" maxlength="5000"></textarea></label>'+
  (liveEnabled?'<p class="small muted">Начисление и выплата учитываются отдельно. Все эффекты рассчитывает PostgreSQL.</p>':
  '<p class="small muted">Начисление рабочему и выплата — разные операции. Никакие финансовые эффекты в этом макете не рассчитываются.</p>')+
  '<div class="finance-legacy-form-actions">'+
  '<button type="submit"'+(liveEnabled?' class="primary"':'')+'>'+(liveEnabled?'Сохранить в PostgreSQL':'Проверить заполнение')+'</button>'+
  (liveEnabled?'':'<button type="button" disabled>Сохранить · недоступно</button>')+
  '<button type="button" data-finance-legacy-close>Отмена</button>'+
  '</div><p role="status" aria-live="polite" data-finance-legacy-result></p></form>'+
  ((!liveEnabled&&(income||expense))?'<button type="button" class="compact" data-finance-legacy-server-preview="'+esc(action)+
   '">Открыть отдельную серверную проверку простого черновика</button>':'')+
  '</div></dialog>';
}
function parseLegacyAmount(value,field,allowZero=false){
 const n=String(value??'').trim().replace(',','.');
 if(!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(n)||
   !Number.isFinite(Number(n))||(allowZero?Number(n)<0:Number(n)<=0))
  throw Error('Некорректное поле: '+field);
 return n;
}
/** Pure input check. No saving, payment, cash/profit preview, or source assumptions. */
export function validateFinanceLegacyPreview(raw,{refs={}}={}){
 if(!raw||!LEGACY_FORMS.includes(raw.legacyAction))throw Error('Неизвестная финансовая операция');
 const action=raw.legacyAction;
 const type=action==='WORKER'?String(raw.operationType||''):
  ['INVEST','OWNER_TRANSFER'].includes(action)?'OWNER_TRANSFER':action;
 if(!['INCOME','EXPENSE','OWNER_TRANSFER',...LEGACY_WORKER.map(x=>x[0])].includes(type))
  throw Error('Неизвестный тип');
 if(!legacyDay(String(raw.transactionDate||'')))throw Error('Укажи корректную дату');
 const amount=parseLegacyAmount(raw.amountOriginal,'Сумма');
 const currency=String(raw.currencyOriginal||'');
 if(!LEGACY_CURRENCY.some(([id])=>id===currency))throw Error('Неверная валюта');
 const fx=currency==='AMD'?'1':parseLegacyAmount(raw.fxRate,'Курс');
 const commission=parseLegacyAmount(raw.commissionOriginal??'0','Комиссия',true);
 const notes=String(raw.notes||''),counterparty=String(raw.counterparty||'');
 if(notes.length>5000||counterparty.length>300)throw Error('Комментарий или контрагент слишком длинные');
 let category='',recognition='',ownerDirection='',workerId='';
 if(type==='INCOME'){
  category=String(raw.category||'');recognition=String(raw.incomeRecognition||'');
  if(!LEGACY_INCOME.some(([id])=>id===category)||
     !LEGACY_RECOGNITION.some(([id])=>id===recognition))throw Error('Неверная категория дохода');
  if(recognition==='EARNED_ONLY'&&Number(commission)>0)
   throw Error('Для только заработанного дохода комиссия недопустима');
 }else if(type==='EXPENSE'){
  category=String(raw.category||'');
  if(!LEGACY_EXPENSE.some(([id])=>id===category))throw Error('Неверная категория расхода');
 }else if(type.startsWith('WORKER_')){
  workerId=String(raw.workerId||'');
  if(!workerId||!legacyReferences(refs,'workers').some(x=>x.id===workerId))
   throw Error('Выбери существующего работника');
  if(type==='WORKER_ACCRUAL'&&Number(commission)>0)
   throw Error('Для начисления рабочему комиссия недопустима');
 }else{
  ownerDirection=action==='INVEST'?'investments':String(raw.ownerDirection||'');
  if(!LEGACY_OWNER.some(([id])=>id===ownerDirection))throw Error('Неверное направление вывода');
 }
 const workOrderId=type==='OWNER_TRANSFER'?'':String(raw.workOrderId||'');
 const objectId=type==='OWNER_TRANSFER'?'':String(raw.objectId||'');
 const needsOrder=(type==='INCOME'&&['current_work','advance'].includes(category))||
  ['WORKER_ACCRUAL','WORKER_ACCRUAL_PAYMENT'].includes(type);
 const orders=legacyReferences(refs,'orders'),objects=legacyReferences(refs,'objects');
 if(needsOrder&&!workOrderId)throw Error('Для этого действия нужен заказ');
 if(workOrderId&&!orders.some(x=>x.id===workOrderId))throw Error('Заказ отсутствует в списке');
 if(objectId&&!objects.some(x=>x.id===objectId))throw Error('Объект отсутствует в списке');
 const linkedOrder=orders.find(x=>x.id===workOrderId);
 if(linkedOrder?.object_id&&objectId&&linkedOrder.object_id!==objectId)
  throw Error('Объект не соответствует заказу');
 return Object.freeze({
  operationType:type,category,incomeRecognition:recognition,ownerDirection,workerId,
  transactionDate:String(raw.transactionDate),amountOriginal:amount,currencyOriginal:currency,
  fxRate:fx,commissionOriginal:commission,workOrderId,objectId,notes,counterparty,
  previewOnly:true,saved:false
 });
}

/** Pure B22 adapter. Reuses the existing native FINANCE_CREATE writer; never maps historical Google IDs. */
export function financeLegacyNativeCreateAction(raw,{refs={},today='2026-11-23'}={}){
 const x=validateFinanceLegacyPreview(raw,{refs});
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(x.transactionDate<'2026-10-01'||x.transactionDate>today||!legacyDay(today))
  throw Error('Дата вне нового финансового периода');
 for(const field of ['workerId','workOrderId','objectId']){
  if(x[field]&&!uuid.test(x[field]))throw Error('Только подтверждённые PostgreSQL UUID');
 }
 const payload={operationType:x.operationType,transactionDate:x.transactionDate,
  amountOriginal:x.amountOriginal,currencyOriginal:x.currencyOriginal,
  commissionOriginal:x.commissionOriginal,counterparty:x.counterparty,notes:x.notes};
 if(x.currencyOriginal!=='AMD')payload.fxRate=x.fxRate;
 if(x.operationType==='INCOME'){
  payload.category=x.category;payload.incomeRecognition=x.incomeRecognition;
 }else if(x.operationType==='EXPENSE')payload.category=x.category;
 else if(x.operationType.startsWith('WORKER_'))payload.workerId=x.workerId;
 else if(x.operationType==='OWNER_TRANSFER')payload.ownerDirection=x.ownerDirection;
 if(x.workOrderId)payload.workOrderId=x.workOrderId;
 if(x.objectId)payload.objectId=x.objectId;
 return {action:'FINANCE_CREATE',payload};
}
export function financeCapitalArchiveHtml(data,mode){
 if(!data||data.source!=='VERIFIED_LEGACY_FINANCE_CAPITAL_CLEAN_TEST'||
  data.readonly!==true||data.financialWriter!=='GOOGLE'||data.currentOperationalFinance!==false)
  throw Error('Источник финансов не прошёл проверку');
 if(!['finance','capital'].includes(mode))throw Error('Неизвестный раздел');
 const header='<p class="muted"><strong>АРХИВ · только просмотр</strong>. Данные старого VBOS сохранены в Clean TEST. Это не текущий баланс новой системы. Новые операции ведутся отдельно в PostgreSQL. Исторические записи редактировать нельзя.</p>'+
  '<p class="small muted">Снимок Google: '+esc(String(data.sourceModifiedAt??'').slice(0,10))+
  '. Показатели разных типов не складываются между собой.</p>';
 if(mode==='finance'){
  const f=data.finance||{};
  const required=['earnedBase','receivedBase','economicExpenseBase','profitBase','cashBalanceBase',
   'workerPayableBase','workerPaidBase','ownerTransferBase'];
  if(f.currency!=='AMD'||required.some(key=>typeof f[key]!=='string'||!f[key].trim()||!Number.isFinite(Number(f[key]))))
   throw Error('Историческая сводка неполна');
  const actions='<h2>Операции</h2><div class="actions" aria-label="Финансовые операции">'+
   '<button type="button" class="primary" data-finance-legacy-draft="INCOME">+ Доход</button>'+
   '<button type="button" data-finance-legacy-draft="EXPENSE">+ Расход</button>'+
   '<button type="button" data-finance-legacy-draft="WORKER">+ Рабочий</button>'+
   '<button type="button" data-finance-legacy-draft="OWNER_TRANSFER">+ Вывод денег</button>'+
   '<button type="button" data-finance-legacy-draft="INVEST">+ Инвестировать</button></div>'+
   '<p class="small muted">Эти пять кнопок создают новые записи в PostgreSQL TEST, если финансовый writer разрешён. Архив ниже остаётся только для просмотра.</p>'+
   '<div data-finance-legacy-form-host></div>';
  const metrics='<h2>Итог по бизнесу · архив</h2><div class="summary">'+
   summaryCard('Заработано',f.earnedBase,'Доход, признанный работой')+
   summaryCard('Получено',f.receivedBase,'Фактически пришедшие деньги')+
   summaryCard('Расходы',f.economicExpenseBase,'Начисленный труд и комиссии учтены')+
   summaryCard('Прибыль',f.profitBase,'Заработано минус экономические расходы')+
   summaryCard('Остаток денег',f.cashBalanceBase,'Остаток источника, не текущий баланс')+
   summaryCard('Долг рабочим',f.workerPayableBase,'Начислено минус выплачено')+
   summaryCard('Выплачено рабочим',f.workerPaidBase,'Движение денег')+
   summaryCard('Выведено владельцем',f.ownerTransferBase,'Не расход заказа')+'</div>';
  return header+actions+metrics+
   '<h3>Дополнительные доходы по месяцам</h3>'+
   (data.months||[]).map(x=>'<article class="record"><strong>'+esc(x.monthKey)+'</strong>'+
    '<div>'+rubles(x.totalBusinessGainsBase)+'</div>'+
    '<details><summary>Пять источников дополнительной прибыли</summary>'+
    '<p>Комиссии за переданные работы: '+rubles(x.referralCommissionBase)+'</p>'+
    '<p>Комиссии / cashback от материалов: '+rubles(x.purchaseCommissionBase)+'</p>'+
    '<p>Организация работ: '+rubles(x.organizationMarginBase)+'</p>'+
    '<p>Налоговая оптимизация: '+rubles(x.taxOptimizationSavingsBase)+'</p>'+
    '<p>Прочий бизнес-доход: '+rubles(x.otherBusinessIncomeBase)+'</p>'+
    '</details><p class="small muted">Архив Google · '+esc(x.status||'—')+
    ' · Не прибавлять повторно к операциям и не копировать в TEST-реестр</p></article>').join('')+
   '<p class="small muted">Сохранено операций: '+esc(data.counts?.financeTransactions)+
   '. Оригинальные транзакции доступны ниже по отдельному архивному списку.</p>';
 }
 const capital=data.capital||{};
 const byId=new Map((capital.funds||[]).map(f=>[f.fundId,f.name||f.code||f.fundId]));
 return header+'<h2>Фонды капитала</h2>'+
  '<div class="summary">'+summaryCard('Распределено по историческому пакету',capital.allocatedBase)+
  '<div class="card"><span>Фондов</span><strong>'+esc(data.counts?.funds)+'</strong></div>'+
  '<div class="card"><span>Движений</span><strong>'+esc(data.counts?.fundMovements)+'</strong></div></div>'+
  '<p class="small muted">Строк распределения: '+esc(capital.allocationLines)+'. Это исходные записи, не новые операции.</p>'+
  (capital.funds||[]).map(f=>'<article class="record"><strong>'+esc(f.name||f.code||f.fundId)+'</strong>'+
   '<div class="meta">'+esc(f.code||'')+' · '+esc(f.groupType||'')+' · '+esc(f.status||'')+'</div>'+
   '<div>Остаток по источнику: <b>'+rubles(f.balanceBase)+'</b></div>'+
   '<p class="small muted">Цель: '+rubles(f.targetAmountBase)+'</p></article>').join('')+
  '<h3>Движения капитала</h3>'+
  (capital.movements||[]).map(x=>'<article class="record"><strong>'+esc(byId.get(x.toFundId)||x.toFundId)+
   '</strong><div>'+rubles(x.amountBase)+'</div><p class="small muted">'+esc(x.movementType)+' · '+esc(x.status||'')+'</p></article>').join('');
}
export function mountFinanceCapitalArchivePanel(root,{fetchPage,mode,onDraft,refs={},today='2026-11-13',fetchCurrentContext,fetchReferencePage,fetchNativeState,postNativeAction,onNativeSaved}={}){
 if(!root||typeof root.addEventListener!=='function'||typeof fetchPage!=='function')
  throw Error('FINANCE_CAPITAL_VIEW_NOT_CONFIGURED');
 if(!['finance','capital'].includes(mode))throw Error('FINANCE_CAPITAL_MODE_INVALID');
 let active=true,seq=0,loading=false,posting=false,pendingPost=null;
 const liveRefs={
  orders:legacyReferences(refs,'orders'),objects:legacyReferences(refs,'objects'),
  workers:legacyReferences(refs,'workers')
 };
 let dialogSeq=0,searchSeq=0,userTouchedOrder=false,userTouchedObject=false;
 let searchState={kind:'',term:'',cursor:null,hasMore:false};
 function mergeRefs(kind,items){
  liveRefs[kind]=legacyReferences({[kind]:[...items,...liveRefs[kind]]},kind);
 }
 function resetSelect(form,kind,selected=''){
  const name={orders:'workOrderId',objects:'objectId',workers:'workerId'}[kind];
  const control=form?.elements?.[name];if(!control)return;
  const old=selected||control.value;
  control.innerHTML=legacyLinkOptions(legacyReferences(liveRefs,kind),
   {orders:'Без заказа',objects:'Без объекта',workers:'Выбери работника'}[kind],
   kind==='orders'?'title':'name');
  if(legacyReferences(liveRefs,kind).some(x=>x.id===old))control.value=old;
 }
 async function prefillActiveOrder(token){
  if(typeof fetchCurrentContext!=='function')return;
  try{
   const snapshot=await fetchCurrentContext();
   if(!active||dialogSeq!==token)return;
   const form=formHost()?.querySelector?.('[data-finance-legacy-form]');
   const notice=form?.querySelector?.('[data-finance-legacy-current-order-status]');
   if(!form||!notice)return;
   const current=financeLegacyActiveOrder(snapshot,today);
   if(!current){notice.textContent='Нет подтверждённой активной работы за сегодня. Выбери заказ вручную.';return;}
   if(userTouchedOrder||userTouchedObject){
    notice.textContent='Текущий заказ найден, но твой ручной выбор не меняется.';return;
   }
   mergeRefs('orders',[{id:current.id,title:current.title,object_id:current.object_id}]);
   mergeRefs('objects',[{id:current.object_id,name:current.objectName||current.object_id}]);
   resetSelect(form,'orders',current.id);
   resetSelect(form,'objects',current.object_id);
   notice.textContent='Текущий заказ подставлен из активной работы: '+current.title+'. При необходимости выбери другой.';
  }catch{
   if(active&&dialogSeq===token){
    const notice=formHost()?.querySelector?.('[data-finance-legacy-current-order-status]');
    if(notice)notice.textContent='Автоподстановка недоступна. Заказ можно найти вручную.';
   }
  }
 }
 async function searchReference(append=false){
  if(typeof fetchReferencePage!=='function')return;
  const form=formHost()?.querySelector?.('[data-finance-legacy-form]');
  const selector=form?.querySelector?.('[data-finance-legacy-search-kind]');
  const field=form?.querySelector?.('[data-finance-legacy-search-query]');
  const status=form?.querySelector?.('[data-finance-legacy-search-status]');
  const more=form?.querySelector?.('[data-finance-legacy-search-more]');
  if(!selector||!field||!status||!more)return;
  const kind=selector.value,term=field.value.trim();
  if(!['orders','objects','workers'].includes(kind)||term.length<2||term.length>80){
   status.textContent='Введи от 2 до 80 символов.';more.hidden=true;return;
  }
  if(append&&(!searchState.hasMore||searchState.kind!==kind||searchState.term!==term))return;
  const cursor=append?searchState.cursor:null;
  const token=++searchSeq,dialogToken=dialogSeq;
  status.textContent='Поиск в реестре…';more.hidden=true;
  try{
   let url=kind==='workers'?'/api/finance/legacy-workers?q='+
    encodeURIComponent(term)+'&limit=25':
    '/api/catalog?entity='+kind+'&q='+encodeURIComponent(term)+'&limit=25';
   if(cursor)url+='&cursor='+encodeURIComponent(cursor);
   const response=await fetchReferencePage(url);
   if(!active||dialogSeq!==dialogToken||searchSeq!==token||form!==formHost()?.querySelector?.('[data-finance-legacy-form]'))return;
   const result=financeLegacySearchResult(kind,response,term);
   mergeRefs(kind,result.items);
   resetSelect(form,kind);
   searchState={kind,term,cursor:result.nextCursor,hasMore:result.hasMore};
   more.hidden=!result.hasMore;
   status.textContent=result.items.length?
    'Найдено на странице: '+result.items.length+
      (result.hasMore?'. Есть другие записи — нажми «Показать ещё».':'. Выбери из списка выше.'):
    'Совпадений нет. Проверь название или ID.';
  }catch(error){
   if(active&&dialogSeq===dialogToken&&searchSeq===token){
    status.textContent='Поиск не выполнен: '+String(error?.message||'Источник недоступен');
    more.hidden=true;
   }
  }
 }
 function draw(message,err=false){
  if(!active)return;
  root.innerHTML='<div class="card">'+(err?'<p role="alert">'+esc(message)+'</p>':'<p class="muted">'+esc(message)+'</p>')+
   '<button type="button" data-finance-archive-refresh'+(loading?' disabled':'')+'>'+ (loading?'Загрузка…':'Повторить загрузку')+'</button></div>';
 }
 async function load(){
  if(!active||loading)return;
  loading=true;const request=++seq;draw('Проверка сохранённого финансового источника…');
  try{
   const payload=await fetchPage('/api/finance/archive');
   if(!active||request!==seq)return;
   root.innerHTML=financeCapitalArchiveHtml(payload,mode);
  }catch(e){
   if(active&&request===seq){loading=false;draw(String(e?.message||'Финансовый архив недоступен'),true);}
  }finally{if(active&&request===seq)loading=false;}
 }
 let focusReturn=null;
 const formHost=()=>root.querySelector?.('[data-finance-legacy-form-host]');
 function closeForm(){
  dialogSeq++;searchSeq++;
  const host=formHost();const dialog=host?.querySelector?.('[data-finance-legacy-dialog]');
  if(dialog?.open&&typeof dialog.close==='function')dialog.close();
  if(host)host.innerHTML='';
  const source=focusReturn;focusReturn=null;
  if(source&&typeof source.focus==='function'&&source.isConnected!==false)source.focus();
 }
 async function showForm(action,trigger){
  const host=formHost();
  if(!host||!LEGACY_FORMS.includes(action)||posting||pendingPost)return false;
  focusReturn=trigger;
  const request=++dialogSeq;searchSeq++;
  if(typeof fetchNativeState!=='function'||typeof postNativeAction!=='function'){
   host.textContent='Запись недоступна: PostgreSQL не подключён.';return false;
  }
  let gate;
  try{gate=await fetchNativeState('/api/finance/native-workspace');}
  catch{if(active&&dialogSeq===request)host.textContent='Невозможно проверить финансовый источник.';return false;}
  if(!active||dialogSeq!==request)return false;
  if(gate?.version!=='FINANCE_B18_NATIVE_WORKSPACE_V1'||gate?.source!=='CLEAN_NATIVE_POST_CUTOVER_ONLY'||
     gate?.authority!=='POSTGRES'||gate?.phase!=='ACTIVE'||gate?.postingEnabled!==true||
     gate?.historicalArchiveImmutable!==true||gate?.asOfOpening!=='2026-09-30'||
     gate?.ledger?.isCurrentFinanceBalance!==true){
   host.textContent='Запись заблокирована. PostgreSQL не подтверждён как единственный финансовый writer.';
   return false;
  }
  userTouchedOrder=false;userTouchedObject=false;
  searchState={kind:'',term:'',cursor:null,hasMore:false};
  host.innerHTML=financeLegacyFormHtml(action,{today,refs:liveRefs,liveEnabled:true});
  const dialog=host.querySelector?.('[data-finance-legacy-dialog]');
  if(dialog){
   if(typeof dialog.showModal==='function')dialog.showModal();
   else if(typeof dialog.setAttribute==='function')dialog.setAttribute('open','');
  }
  const field=host.querySelector?.('[name="amountOriginal"]');
  if(field&&typeof field.focus==='function')field.focus();
  if(!['OWNER_TRANSFER','INVEST'].includes(action))void prefillActiveOrder(request);
  return true;
 }
 async function sendPending(){
  if(!active||posting||!pendingPost||typeof postNativeAction!=='function')return;
  posting=true;
  const form=formHost()?.querySelector?.('[data-finance-legacy-form]');
  const result=form?.querySelector?.('[data-finance-legacy-result]');
  if(result)result.textContent='Проверка записи PostgreSQL…';
  try{
   const answer=await postNativeAction(pendingPost);
   if(!answer||answer.synthetic!==false||typeof answer.sourceId!=='string'||!answer.sourceId||
      ![true,false].includes(answer.replayed))throw Error('B22_UNVERIFIED_POSTGRES_RECEIPT');
   pendingPost=null;
   if(result)result.textContent='Сохранено в PostgreSQL. Запись подтверждена сервером.';
   if(typeof onNativeSaved==='function'){
    try{await onNativeSaved();}catch{/* The signed posting receipt already succeeded. Never resend. */}
   }
   closeForm();
  }catch(error){
   const status=Number(error?.httpStatus);
   if([400,403,409,503].includes(status)){
    pendingPost=null;
    if(result)result.textContent='Запись отклонена сервером: '+String(error?.message||status)+'. Исправь поля.';
   }else if(result){
    result.textContent='Ответ не подтверждён. Нельзя создавать вторую операцию — повтори тот же запрос.';
    const retry=document.createElement('button');
    retry.type='button';retry.dataset.financeNativeRetry='1';
    retry.textContent='Повторить тот же запрос';
    result.append(retry);
   }
  }finally{posting=false;}
 }
 const onClick=e=>{
  const draft=e.target?.closest?.('[data-finance-legacy-draft]');
  if(mode==='finance'&&draft){
   const action=draft.getAttribute('data-finance-legacy-draft');
   if(!LEGACY_FORMS.includes(action))return;
   void showForm(action,draft);
   return;
  }
  if(e.target?.closest?.('[data-finance-legacy-close]')){
   if(!posting&&!pendingPost)closeForm();return;
  }
  if(e.target?.closest?.('[data-finance-native-retry]')){void sendPending();return;}
  if(e.target?.closest?.('[data-finance-legacy-search]')){void searchReference(false);return;}
  if(e.target?.closest?.('[data-finance-legacy-search-more]')){void searchReference(true);return;}
  const preview=e.target?.closest?.('[data-finance-legacy-server-preview]');
  if(preview){
   const type=preview.getAttribute('data-finance-legacy-server-preview');
   if(['INCOME','EXPENSE'].includes(type)&&typeof onDraft==='function'){
    closeForm();onDraft(type);
   }
   return;
  }
  if(e.target?.closest?.('[data-finance-archive-refresh]'))void load();
 };
 const onChange=e=>{
  const el=e.target,form=el?.closest?.('[data-finance-legacy-form]');
  if(!form)return;
  if(el.name==='currencyOriginal'){
   const same=el.value==='AMD',wrap=form.querySelector?.('[data-finance-legacy-fx]');
   if(wrap)wrap.hidden=same;
   if(form.elements?.fxRate){form.elements.fxRate.required=!same;
    if(same)form.elements.fxRate.value='1';}
  }else if(el.name==='category'&&form.elements?.incomeRecognition){
   form.elements.incomeRecognition.value=['advance','old_debt'].includes(el.value)?
    'RECEIVED_ONLY':'EARNED_AND_RECEIVED';
  }else if(el.name==='workOrderId'){
   userTouchedOrder=true;
   const order=legacyReferences(liveRefs,'orders').find(x=>x.id===el.value);
   if(order?.object_id&&form.elements?.objectId){
    const objects=legacyReferences(liveRefs,'objects');
    if(objects.some(x=>x.id===order.object_id))form.elements.objectId.value=order.object_id;
   }
  }
  if(el.name==='objectId')userTouchedObject=true;
  const operation=form.elements?.operationType?.value;
  const category=form.elements?.category?.value;
  const select=form.elements?.workOrderId;
  if(select)select.required=(operation==='INCOME'&&['current_work','advance'].includes(category))||
   ['WORKER_ACCRUAL','WORKER_ACCRUAL_PAYMENT'].includes(operation);
 };
 const onSubmit=e=>{
  if(!e.target?.matches?.('[data-finance-legacy-form]'))return;
  e.preventDefault();
  const form=e.target,status=form.querySelector?.('[data-finance-legacy-result]');
  if(!status||posting)return;
  if(pendingPost){status.textContent='Сначала повтори прежний запрос с тем же номером.';return;}
  try{
   if(typeof form.reportValidity==='function'&&!form.reportValidity())return;
   const action=financeLegacyNativeCreateAction(Object.fromEntries(new FormData(form)),
     {refs:liveRefs,today});
   if(['OWNER_TRANSFER'].includes(action.payload.operationType)){
    const isInvest=action.payload.ownerDirection==='investments';
    if(!confirm(isInvest?'Инвестировать '+action.payload.amountOriginal+' '+action.payload.currencyOriginal+
     ' с автоматическим распределением по фондам?':'Вывести '+action.payload.amountOriginal+
     ' '+action.payload.currencyOriginal+'? Вернуть вывод одной кнопкой нельзя.'))return;
   }
   pendingPost={requestKey:crypto.randomUUID(),...action};
   void sendPending();
  }catch(error){status.textContent=String(error?.message||'Неверное заполнение')+' · Ничего не сохранено.';}
 };
 root.addEventListener('click',onClick);
 root.addEventListener('change',onChange);
 root.addEventListener('submit',onSubmit);
 void load();
 return {load,unmount(){
  active=false;seq++;pendingPost=null;closeForm();
  root.removeEventListener('click',onClick);
  root.removeEventListener('change',onChange);
  root.removeEventListener('submit',onSubmit);
 }};
}
