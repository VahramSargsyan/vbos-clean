/**
 * Finance P1 — mobile-first current native read. The five action buttons only
 * forward to existing Finance B22 forms; this module never posts money.
 */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=x=>Number(x||0).toLocaleString('ru-RU',{maximumFractionDigits:2})+' AMD';
const types=[['','Все операции'],['INCOME','Доход'],['EXPENSE','Расход'],
 ['WORKER_ACCRUAL','Начисление рабочему'],['WORKER_PAYMENT','Выплата рабочему'],
 ['WORKER_ACCRUAL_PAYMENT','Начисление и выплата'],['OWNER_TRANSFER','Вывод денег']];
const names={INCOME:'Доход',EXPENSE:'Расход',WORKER_ACCRUAL:'Начисление рабочему',
 WORKER_PAYMENT:'Выплата рабочему',WORKER_ACCRUAL_PAYMENT:'Начисление и выплата',
 OWNER_TRANSFER:'Вывод денег'};
const actions=[['INCOME','+ Доход'],['EXPENSE','+ Расход'],['WORKER','+ Рабочий'],
 ['OWNER_TRANSFER','+ Вывод денег'],['INVEST','+ Инвестировать']];
const empty=()=>({workOrderId:'',objectId:'',workerId:'',operationType:'',dateFrom:'',dateTo:'',q:''});
function selectedOptions(items,selected,label){
 return '<option value="">Все</option>'+items.map(x=>'<option value="'+esc(x.id)+'"'+
  (selected===x.id?' selected':'')+'>'+esc(label(x))+'</option>').join('');
}
function metric(label,value,help){
 return '<article class="finance-p1-metric"><span>'+esc(label)+'</span><strong>'+esc(fmt(value))+
  '</strong><small>'+esc(help)+'</small></article>';
}
export function nativeFinanceParityHtml(state){
 const {data,filters,items,loading,error}=state;
 if(data&&(data.source!=='CLEAN_NATIVE_FINANCE_ONLY'||data.version!=='FINANCE_P1_NATIVE_READ_V1'||
   data.readonly!==true||data.historicalIncluded!==false))
  throw Error('FINANCE_P1_SOURCE_INVALID');
 const refs=data?.references||{orders:[],objects:[],workers:[]};
 const scope=data?.scopeLabel||'GLOBAL';
 const namescope=scope==='ORDER'?'заказ':scope==='OBJECT'?'объект':scope==='WORKER'?'работник':'весь бизнес';
 const m=data?.summary||{};
 const cards=data?'<section class="finance-p1-summary" aria-label="Накопительная сводка нативных операций">'+
  metric('Заработано',m.earnedBase,'Признано по новым операциям')+
  metric('Получено',m.receivedBase,'Фактически поступило в новом учёте')+
  metric('Расходы',m.economicExpenseBase,'Экономические, включая начисленный труд')+
  metric('Прибыль',m.profitBase,'Эффект новых проводок, не старый остаток')+
  metric('Изменение денег',m.cashBalanceBase,'Денежный эффект новых проводок')+
  metric('Долг рабочим',m.workerPayableBase,'Начислено минус выплачено в новом учёте')+
  metric('Выплачено рабочим',m.workerPaidBase,'Отдельно от начислений')+
  metric('Выведено владельцем',m.ownerTransferBase,'Не расход заказа')+'</section>'+
  (scope==='GLOBAL'?'<p class="finance-p1-ledger">Текущий денежный остаток: <strong>'+
   esc(fmt(data.ledger?.currentCashBase))+'</strong> (начальный остаток '+
   esc(fmt(data.ledger?.openingCashBase))+' + денежный эффект новых операций)</p>':'')+
  '<p class="finance-p1-hint">Сводка накопительная по области «'+esc(namescope)+
   '». Даты, тип и текст фильтруют только историю ниже, не изменяя сводку.</p>':
  '<p role="status">Загружаю подтверждённый PostgreSQL-реестр…</p>';
 const opts=(list,k,label)=>selectedOptions(list,filters[k],label);
 const filtersHtml='<form data-finance-p1-filters class="finance-p1-filters" autocomplete="off">'+
  '<label>Заказ<select name="workOrderId">'+opts(refs.orders||[],'workOrderId',x=>x.title||x.id)+'</select></label>'+
  '<label>Объект<select name="objectId">'+opts(refs.objects||[],'objectId',x=>x.name||x.id)+'</select></label>'+
  '<label>Работник<select name="workerId">'+opts(refs.workers||[],'workerId',x=>x.name||x.id)+'</select></label>'+
  '<label>Тип<select name="operationType">'+types.map(([v,n])=>
   '<option value="'+esc(v)+'"'+(filters.operationType===v?' selected':'')+'>'+esc(n)+'</option>').join('')+'</select></label>'+
  '<label>С даты<input type="date" name="dateFrom" value="'+esc(filters.dateFrom)+'"></label>'+
  '<label>По дату<input type="date" name="dateTo" value="'+esc(filters.dateTo)+'"></label>'+
  '<label class="finance-p1-wide">Поиск по категории, описанию, названию заказа/объекта/работника'+
   '<input type="search" name="q" maxlength="80" value="'+esc(filters.q)+'" placeholder="Введите два символа или больше"></label>'+
  '<div class="finance-p1-filter-actions"><button type="submit" class="primary"'+(loading?' disabled':'')+
  '>Применить</button><button type="button" data-finance-p1-reset'+(loading?' disabled':'')+
  '>Сбросить</button></div></form>';
 const referenceWarning=data&&Object.values(data.referenceListsTruncated||{}).some(Boolean)?
  '<p class="small muted">В списках показаны только последние 200 записей. Поиск по тексту проверяет полную финансовую историю.</p>':'';
 const rows=items.length?items.map(row=>{
  const context=[row.orderTitle,row.objectTitle,row.workerName].filter(Boolean).join(' · ');
  const status=row.status==='archived'?'Отменена':'Активна';
  const pos=row.type==='INCOME'?'+':row.type==='WORKER_ACCRUAL'?'':'−';
  return '<article class="finance-p1-record"><div class="finance-p1-record-head"><strong>'+
   esc(names[row.type]||row.type)+'</strong><strong>'+esc(pos+fmt(row.amountBase))+
   '</strong></div><p class="small muted">'+esc(row.date)+' · '+esc(status)+
   ' · '+esc(row.category||'Без категории')+(row.currency!=='AMD'?' · '+esc(row.currency):'')+'</p>'+
   (context?'<p class="small">'+esc(context)+'</p>':'')+
   (row.notes?'<p class="small muted">'+esc(row.notes)+'</p>':'')+
   '<small class="muted">Финансовая операция PostgreSQL, версия '+esc(row.revision)+'</small></article>';
 }).join(''):data&&!loading?'<p class="muted">По заданным фильтрам новых финансовых операций нет.</p>':'';
 return '<section class="finance-p1-root">'+
  '<h2>Текущие финансы · PostgreSQL</h2>'+
  '<p class="small muted">Только операции нового учёта. Архив старого VBOS расположен ниже отдельно.</p>'+
  '<div class="finance-p1-actions" aria-label="Новая финансовая операция">'+
  actions.map(([key,label])=>'<button type="button" data-finance-p1-action="'+esc(key)+'"'+
   (loading?' disabled':'')+'>'+esc(label)+'</button>').join('')+'</div>'+
  cards+
  '<details class="finance-p1-history" open><summary><strong>История новых операций</strong> '+
  (data?'· всего '+esc(data.totalCount):'')+'</summary>'+
  filtersHtml+referenceWarning+
  (error?'<p role="alert">'+esc(error)+'</p>':'')+
  '<div class="finance-p1-records" aria-live="polite">'+(loading&&!data?'<p>Загрузка…</p>':rows)+'</div>'+
  (data?.hasMore?'<button type="button" data-finance-p1-more'+(loading?' disabled':'')+
   '>Показать ещё</button>':'')+'</details>'+
  '<p class="small muted" data-finance-p1-status role="status"></p></section>';
}
export function mountNativeFinanceParity(root,{fetchPage,onQuickAction}={}){
 if(!root||typeof root.addEventListener!=='function'||typeof fetchPage!=='function'||
  typeof onQuickAction!=='function')throw Error('FINANCE_P1_MOUNT_INVALID');
 let active=true,seq=0,loading=false,data=null,items=[],filters=empty(),error='';
 const draw=()=>{if(active)root.innerHTML=nativeFinanceParityHtml({data,items,filters,error,loading});};
 const load=async(more=false)=>{
  if(!active||loading)return;
  const n=++seq;loading=true;error='';draw();
  try{
   const query=new URLSearchParams({limit:'20'});
   for(const [k,v] of Object.entries(filters))if(v)query.set(k,v);
   if(more&&data?.nextCursor)query.set('cursor',data.nextCursor);
   const r=await fetchPage('/api/finance/native-summary-history?'+query.toString());
   if(!active||n!==seq)return;
   if(r?.version!=='FINANCE_P1_NATIVE_READ_V1'||r.source!=='CLEAN_NATIVE_FINANCE_ONLY'||
     r.readonly!==true||r.historicalIncluded!==false||
     !r.summary||!Array.isArray(r.items)||!r.references||!r.ledger)
    throw Error('Финансовый источник не подтверждён.');
   const seen=new Set(more?items.map(x=>x.id):[]);
   items=more?[...items,...r.items.filter(x=>!seen.has(x.id))]:r.items;
   data=r;
  }catch(e){if(active&&n===seq)error=String(e?.message||'Не удалось загрузить историю.');}
  finally{if(active&&n===seq){loading=false;draw();}}
 };
 const click=e=>{
  const b=e.target?.closest?.('button');if(!b||!active)return;
  const action=b.getAttribute('data-finance-p1-action');
  if(action){
   if(!onQuickAction(action)){
    const host=root.querySelector('[data-finance-p1-status]');
    if(host)host.textContent='Форма пока недоступна: проверь загрузку Finance и PostgreSQL.';
   }
   return;
  }
  if(b.hasAttribute('data-finance-p1-reset')){
   filters=empty();data=null;items=[];void load();return;
  }
  if(b.hasAttribute('data-finance-p1-more'))void load(true);
 };
 const change=e=>{
  const field=e.target;
  if(!field?.matches?.('select[name="workOrderId"],select[name="objectId"],select[name="workerId"]')||
     !field.value)return;
  const form=field.closest('form');
  for(const name of ['workOrderId','objectId','workerId'])
   if(field.name!==name&&form?.elements?.[name])form.elements[name].value='';
 };
 const submit=e=>{
  const f=e.target;if(!f?.hasAttribute?.('data-finance-p1-filters'))return;
  e.preventDefault();if(loading)return;
  const v=Object.fromEntries(new FormData(f));
  const next=Object.fromEntries(Object.keys(filters).map(k=>[k,String(v[k]||'').trim()]));
  if(next.q&&next.q.length<2){error='Для поиска введи минимум два символа.';draw();return;}
  filters=next;data=null;items=[];void load();
 };
 root.addEventListener('click',click);
 root.addEventListener('change',change);
 root.addEventListener('submit',submit);
 void load();
 return {load,unmount(){active=false;seq++;root.removeEventListener('click',click);
  root.removeEventListener('change',change);root.removeEventListener('submit',submit);}};
}
