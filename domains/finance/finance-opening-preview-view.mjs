/** Finance B13: mobile opening + ephemeral draft preview; NEVER posts money. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=x=>{const n=Number(x);return Number.isFinite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:2})+' ֏':'—';};
const TITLES={
 OPERATING_RESERVE:'Операционный резерв',WARRANTY_RESERVE:'Гарантийный резерв',
 MARKETING_SALES:'Маркетинг и продажи',PEOPLE_TRAINING:'Обучение сотрудников',
 TOOLS_CREW_KITS:'Инструменты и комплекты',RND_MATERIALS:'Исследования и материалы',
 DIGITAL_AI_VBOS:'Цифровые системы и VBOS',INFRASTRUCTURE:'Инфраструктура'
};
const B15_CATEGORIES={
 INCOME:[['other','Прочий доход'],['bonus','Бонус']],
 EXPENSE:[['other','Прочий расход'],['materials','Материалы'],
  ['transport','Транспорт'],['tools','Инструменты'],
  ['subcontractor','Подрядчики'],['office','Офис']]
};
function categoryOptions(op){
 return (B15_CATEGORIES[op]||[]).map(([id,name])=>
  '<option value="'+esc(id)+'">'+esc(name)+'</option>').join('');
}
function validDay(s){
 return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  !Number.isNaN(Date.parse(s+'T00:00:00.000Z'))&&
  new Date(s+'T00:00:00.000Z').toISOString().slice(0,10)===s;
}
function checked(data,mode){
 if(!data||data.version!=='FINANCE_B13_OPENING_READONLY_V1'||data.readonly!==true||
  data.postingEnabled!==false||data.canSave!==false||data.phase!=='BLOCKED'||
  data.financialWriteAuthority!=='GOOGLE'||data.asOfDate!=='2026-09-30'||
  data.sourceFreezeVerified!==false||data.isCurrentLiveBalance!==false||
  !Array.isArray(data.funds)||data.funds.length!==8||
  !['finance','capital'].includes(mode))throw Error('B13_UNVERIFIED_OPENING');
 return data;
}
export function validateFinanceDraft(raw,{mode,funds,today}={}){
 if(!['finance','capital'].includes(mode)||!Array.isArray(funds)||funds.length!==8)
  throw Error('Недоступна проверка черновика.');
 const allowed=mode==='finance'?['INCOME','EXPENSE']:['FUND_TRANSFER','FUND_SPEND'];
 const op=String(raw.operationType||'');
 if(!allowed.includes(op))throw Error('Выбери допустимый тип операции.');
 const date=String(raw.transactionDateKey||'');
 if(!validDay(date)||date<'2026-10-01'||(validDay(today)&&date>today))
  throw Error('Дата должна быть с 01.10.2026 по сегодня.');
 const amount=String(raw.amountAMD||'').trim().replace(',','.');
 if(!/^(?:[1-9]\d{0,8}|[1-9]\d{0,8}\.\d{1,2}|0\.(?:0[1-9]|[1-9]\d?))$/.test(amount))
  throw Error('Положительная сумма до 999 999 999 ֏, максимум 2 знака после запятой.');
 const notes=String(raw.notes||'').trim();
 if(notes.length>300)throw Error('Описание — максимум 300 символов.');
 const category=mode==='finance'?String(raw.category||'other'):'';
 if(mode==='finance'&&!(B15_CATEGORIES[op]||[]).some(([id])=>id===category))
  throw Error('Для проверки выбери поддерживаемую категорию. Для работ по заказу требуется подтверждённая CRM-связь.');
 const byId=new Map(funds.map(f=>[f.legacyId,f]));
 let fromFund=null,toFund=null;
 if(mode==='capital'){
  fromFund=byId.get(String(raw.fromFundId||''))||null;
  if(!fromFund)throw Error('Выбери исходный фонд.');
  if(op==='FUND_TRANSFER'){
   toFund=byId.get(String(raw.toFundId||''))||null;
   if(!toFund||fromFund.legacyId===toFund.legacyId)
    throw Error('Для перевода выбери другой фонд назначения.');
  }
 }
 const operationLabel={
  INCOME:'Поступление (черновик)',EXPENSE:'Расход (черновик)',
  FUND_TRANSFER:'Перевод между фондами (черновик)',
  FUND_SPEND:'Расход из фонда (черновик)'
 }[op];
 return {operationType:op,operationLabel,date,category,amountAMD:amount.replace(/\.00$/,''),
  notes,fromFund:fromFund?{id:fromFund.legacyId,name:TITLES[fromFund.code]||fromFund.code}:null,
  toFund:toFund?{id:toFund.legacyId,name:TITLES[toFund.code]||toFund.code}:null};
}
function options(funds){return '<option value="">Выбери фонд</option>'+
 funds.map(f=>'<option value="'+esc(f.legacyId)+'">'+esc(TITLES[f.code]||f.code)+'</option>').join('');}
export function financeOpeningPreviewHtml(data,mode,{today='2026-11-10'}={}){
 checked(data,mode);
 const f=data.funds,op=data.opening;
 const summary=mode==='finance'?
 '<div class="summary"><div class="card"><span>Денежный остаток на 30.09</span><strong>'+fmt(op.cashAMD)+'</strong></div>'+
 '<div class="card"><span>Накопленная прибыль</span><strong>'+fmt(op.profitAMD)+'</strong></div>'+
 '<div class="card"><span>Долг работникам</span><strong>'+fmt(op.workerPayableAMD)+'</strong></div></div>':
 '<div class="summary"><div class="card"><span>Начальное распределение по фондам</span><strong>'+fmt(op.fundTotalAMD)+'</strong></div>'+
 '<div class="card"><span>Фондов</span><strong>8</strong></div></div>'+
 f.map(x=>'<div class="record"><strong>'+esc(TITLES[x.code]||x.code)+'</strong>'+
 '<div class="muted">'+esc(x.code)+'</div><div>Начальный остаток: <b>'+fmt(x.openingBalanceAMD)+'</b></div></div>').join('');
 const choices=mode==='finance'?
 '<option value="INCOME">Поступление</option><option value="EXPENSE">Расход</option>':
 '<option value="FUND_TRANSFER">Перевод между фондами</option><option value="FUND_SPEND">Расход из фонда</option>';
 const categoryField=mode==='finance'?
 '<label>Категория (без привязки к заказу)<select required name="category" data-b15-category>'+
 categoryOptions('INCOME')+'</select></label>':'';
 const fundFields=mode==='capital'?
 '<label>Из фонда<select required name="fromFundId">'+options(f)+'</select></label>'+
 '<label data-b13-to-wrap>В фонд<select required name="toFundId">'+options(f)+'</select></label>':'';
 const date=validDay(today)&&today>='2026-10-01'?today:'2026-10-01';
 return '<div class="card" data-b13-root><h2>Начальные остатки · PostgreSQL TEST</h2>'+
 '<p class="muted"><strong>Подтверждено владельцем на 30.09.2026.</strong> Это перенос начального состояния, а не новый доход и не текущий живой баланс. Google остаётся источником записи; финансовый writer отключён.</p>'+
 '<p class="small muted">Источник: архив Google от 06.11.2026; полнота до 30.09 подтверждена владельцем. Самостоятельная блокировка старого writer ещё не подтверждена.</p>'+
 summary+'</div><section class="card"><h2>Подготовить операцию</h2>'+
 '<p class="muted"><strong>Проверка на сервере, без сохранения.</strong> Владелец подтверждается сессией и CSRF. Проверяется категория и условный эффект; PostgreSQL, Google и история не изменяются. Черновик исчезает при уходе с экрана.</p>'+
 '<form id="financeB13DraftForm" autocomplete="off">'+
 '<label>Вид операции<select required name="operationType">'+choices+'</select></label>'+
 '<label>Дата<input type="date" required min="2026-10-01" max="'+esc(date)+'" name="transactionDateKey" value="'+esc(date)+'"></label>'+
 '<label>Сумма, ֏<input type="text" inputmode="decimal" required name="amountAMD" maxlength="16" placeholder="Например, 25000"></label>'+categoryField+
 fundFields+
 '<label>Примечание (необязательно)<textarea name="notes" maxlength="300" rows="2" placeholder="Для чего эта операция"></textarea></label>'+
 '<div class="actions"><button class="primary" type="submit">Проверить черновик</button></div></form>'+
 '<div data-b13-result role="status" aria-live="polite" class="small muted">Операции не сохраняются. Расчёт налогов, комиссий и связанных платежей не выполняется.</div></section>';
}
export function mountFinanceOpeningPreview(root,{mode,fetchPage,postDraft,today,onReady}={}){
 if(!root||typeof root.addEventListener!=='function'||typeof fetchPage!=='function'||typeof postDraft!=='function')
  throw Error('B13_PANEL_NOT_CONFIGURED');
 if(!['finance','capital'].includes(mode))throw Error('B13_MODE');
 let active=true,serial=0,draftSerial=0,loading=false,submitting=false,payload=null;
 const showError=message=>{root.innerHTML='<div class="card"><p role="alert">'+esc(message)+'</p><button type="button" data-b13-retry>Повторить загрузку</button></div>';};
 async function load(){
  if(!active||loading)return;
  loading=true;const current=++serial;payload=null;
  root.innerHTML='<div class="card"><p class="muted">Проверка начальных остатков PostgreSQL…</p></div>';
  try{
   const loaded=await fetchPage('/api/finance/opening-preview');
   if(!active||current!==serial)return;
   checked(loaded,mode);payload=loaded;
   root.innerHTML=financeOpeningPreviewHtml(payload,mode,{today});
   if(typeof onReady==='function')onReady();
  }catch{
   if(active&&current===serial)showError('Начальные остатки недоступны: защита или источник не прошли проверку.');
  }finally{if(active&&current===serial)loading=false;}
 }
 const click=e=>{if(e.target?.closest?.('[data-b13-retry]'))void load();};
 const change=e=>{
  const field=e.target;
  if(!active||!payload||field?.name!=='operationType')return;
  const category=root.querySelector('[data-b15-category]');
  if(category)category.innerHTML=categoryOptions(field.value);
  const toWrap=root.querySelector('[data-b13-to-wrap]'),select=toWrap?.querySelector('select');
  if(toWrap&&select){toWrap.hidden=field.value!=='FUND_TRANSFER';select.disabled=toWrap.hidden;select.required=!toWrap.hidden;}
 };
 const submit=async e=>{
  if(!active||!payload||e.target?.id!=='financeB13DraftForm')return;
  e.preventDefault();
  if(submitting)return;
  const result=root.querySelector('[data-b13-result]');
  let draft,request;
  try{
   const fields=Object.fromEntries(new FormData(e.target));
   draft=validateFinanceDraft(fields,{mode,funds:payload.funds,today});
   request={
    mode,operationType:draft.operationType,
    transactionDateKey:draft.date,amountAMD:draft.amountAMD,notes:draft.notes,
    ...(mode==='finance'?{category:draft.category}:{
     fromFundId:draft.fromFund.id,
     ...(draft.toFund?{toFundId:draft.toFund.id}:{})
    })
   };
  }catch(err){result.textContent=String(err.message||'Некорректный черновик.');return;}
  const current=++draftSerial;submitting=true;
  result.textContent='Сервер проверяет черновик. Записи денег нет…';
  try{
   const preview=await postDraft(request);
   if(!active||current!==draftSerial)return;
   if(!preview||preview.version!=='FINANCE_B15_SERVER_DRY_RUN_V1'||
      preview.saved!==false||preview.canSave!==false||
      preview.postingEnabled!==false||preview.readonly!==true||
      preview.financialWriteAuthority!=='GOOGLE'||
      preview.currentLiveBalance!==false||
      preview.notAnAccountingEntry!==true||
      preview.operationType!==draft.operationType||
      preview.transactionDateKey!==draft.date)
    throw Error('Сервер вернул неподтверждённый предпросмотр.');
   const effects=preview.effects;
   if(!effects||!Array.isArray(effects.fundEffects))throw Error('Неполный ответ сервера.');
   result.innerHTML='<div class="card"><strong>ПРОВЕРЕНО СЕРВЕРОМ · НЕ СОХРАНЕНО</strong>'+
    '<p>'+esc(draft.operationLabel)+' · '+esc(draft.date)+' · '+fmt(preview.amountAMD)+'</p>'+
    (mode==='finance'?'<p>Условное изменение денег: <b>'+fmt(effects.cashDeltaAMD)+'</b></p>'+
     '<p>Условное изменение прибыли: <b>'+fmt(effects.profitDeltaAMD)+'</b></p>':
     effects.fundEffects.map(f=>'<p>'+esc(f.code)+': '+fmt(f.deltaAMD)+'</p>').join(''))+
    (draft.notes?'<p>Примечание: '+esc(draft.notes)+'</p>':'')+
    '<p class="small muted">Только расчёт по историческим остаткам на 30.09. Это НЕ текущий баланс и НЕ финансовая операция. Данные нигде не сохранены.</p></div>';
  }catch(err){
   if(active&&current===draftSerial)
    result.textContent='Сервер отклонил черновик: '+String(err.message||'проверка не пройдена');
  }finally{
   if(active&&current===draftSerial)submitting=false;
  }
 };
 root.addEventListener('click',click);
 root.addEventListener('change',change);
 root.addEventListener('submit',submit);
 void load();
 return {load,unmount(){active=false;serial++;draftSerial++;root.removeEventListener('click',click);
  root.removeEventListener('change',change);root.removeEventListener('submit',submit);}};
}
