/** Clean Finance: only original frozen history; source filters never modify balances. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kinds=Object.freeze([
 ['ALL','Все операции'],['INCOME','INCOME · поступление'],['EXPENSE','EXPENSE · расход'],
 ['OWNER_TRANSFER','OWNER_TRANSFER · владельцу'],
 ['WORKER_ACCRUAL_PAYMENT','WORKER_ACCRUAL_PAYMENT · выплата']
]);
const emptyFilters=()=>({workOrderId:'',workerId:'',dateFrom:'',dateTo:''});
const goodId=x=>!x||/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(x);
const dateValid=x=>{
 if(!x)return true;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;
 const [year,month,day]=x.split('-').map(Number),t=Date.UTC(year,month-1,day);
 return year>=1900&&year<=2100&&Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===x;
};
export function sourceDay(raw){
 const s=String(raw??'');
 if(/^[0-9]{5}$/.test(s)){
  const n=Number(s);
  if(n>=10001&&n<=99999)return new Date(Date.UTC(1899,11,30)+n*86400000).toISOString().slice(0,10);
 }
 if(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s))return s;
 return 'Дата источника не распознана';
}
export function financeRowHtml(x){
 const date=sourceDay(x.transaction_date_raw);
 return '<article class="record"><strong>'+esc(x.operation_type||'Без типа')+
  '</strong><div class="meta">'+esc(date)+' · '+esc(x.legacy_transaction_id)+
  '</div><p>Сумма источника: <b>'+esc(x.amount_original??'не указана')+' '+esc(x.currency_original||'')+
  '</b></p><p class="small muted">Категория: '+esc(x.category||'—')+
  (x.legacy_order_id?' · Заказ старого VBOS: '+esc(x.legacy_order_id):'')+
  (x.legacy_worker_id?' · Работник старого VBOS: '+esc(x.legacy_worker_id):'')+
  '</p></article>';
}
export function mountFinanceHistoryPanel(root,{fetchPage}={}){
 if(!root||typeof root.addEventListener!=='function'||typeof fetchPage!=='function')
  throw Error('FINANCE_HISTORY_UI_NOT_CONFIGURED');
 let active=true,seq=0,optionsSeq=0,type='ALL',loaded=false,loading=false;
 let hasMore=false,cursor=null,items=[],error='',filtersOpen=false,filterOptionsLoaded=false;
 let optionsBusy=false,optionsError='',options={workOrders:[],workers:[]};
 let pending=emptyFilters(),applied=emptyFilters();
 const optionsHtml=(list,field,label)=>{
  const entries=list.map(item=>'<option value="'+esc(item.id)+'"'+
   (pending[field]===item.id?' selected':'')+'>'+esc(label(item))+'</option>').join('');
  return '<select data-finance-filter="'+field+'"><option value="">Все</option>'+entries+'</select>';
 };
 function draw(){
  if(!active)return;
  const types=kinds.map(([v,label])=>'<option value="'+esc(v)+'"'+
   (v===type?' selected':'')+'>'+esc(label)+'</option>').join('');
  const activeCount=Object.values(applied).filter(Boolean).length;
  const filters=filtersOpen?
   (optionsBusy?'<p role="status">Загрузка архивных справочников…</p>':
    !filterOptionsLoaded?
     '<p role="alert">'+esc(optionsError||'Нажми «Получить справочники», чтобы выбрать заказ и работника.')+
     '</p><button type="button" data-finance-options-retry>Получить справочники</button>':
     '<div class="grid">'+
      '<label>Заказ старого VBOS'+optionsHtml(options.workOrders,'workOrderId',x=>x.title+' · '+x.id)+'</label>'+
      '<label>Работник старого VBOS'+optionsHtml(options.workers,'workerId',x=>x.name+' · '+x.id)+'</label>'+
      '<label>Дата с<input data-finance-filter="dateFrom" type="date" value="'+esc(pending.dateFrom)+'"></label>'+
      '<label>Дата по<input data-finance-filter="dateTo" type="date" value="'+esc(pending.dateTo)+'"></label>'+
      '</div><p class="small muted">Даты включительно. Фильтруется только сохранённая история; это не финансовый баланс за период.</p>'+
      '<button type="button" data-finance-apply>Применить</button>'+
      '<button type="button" data-finance-reset>Сбросить фильтры</button>'):
   '';
  root.innerHTML=
   '<p class="muted">АРХИВ СТАРОГО VBOS. Только оригинальные исторические операции. Это НЕ текущие поступления, остатки, задолженность или прибыль новой базы. Не использовать для расчётов.</p>'+
   '<label>Тип источника <select data-finance-type>'+types+'</select></label>'+
   '<button type="button" data-finance-filters-toggle aria-expanded="'+filtersOpen+'">'+
    (filtersOpen?'Свернуть фильтры':'Фильтры по заказу, работнику и датам')+'</button>'+
   filters+(activeCount?'<p class="small muted">Применено фильтров: '+activeCount+' (только операции, без пересчёта балансов)</p>':'')+
   (error?'<p role="alert">'+esc(error)+'</p>':'')+
   (loaded?'<p class="small muted">Показано архивных записей: '+items.length+'</p>':'')+
   (items.length?items.map(financeRowHtml).join(''):loaded?'<p class="muted">В этом разделе исторических операций нет.</p>':'')+
   ((!loaded||hasMore||error)?'<button type="button" data-finance-load'+(loading?' disabled':'')+'>'+
    (loading?'Загрузка…':error?'Повторить':!loaded?'Показать архивные операции':'Ещё операции')+'</button>':'');
 }
 async function load(reset=false){
  if(!active)return;
  if(!reset&&loading)return;
  if(reset){seq++;loading=false;items=[];cursor=null;hasMore=false;loaded=false;}
  loading=true;error='';const current=++seq;draw();
  try{
   const params=new URLSearchParams({type,limit:'20'});
   if(cursor)params.set('cursor',cursor);
   for(const [key,value] of Object.entries(applied))if(value)params.set(key,value);
   const out=await fetchPage('/api/history/finance?'+params.toString());
   if(!active||current!==seq)return;
   if(out?.source!=='FROZEN_LEGACY_FINANCE_ARCHIVE_ONLY'||out.readonly!==true||
      out.noCurrentBalance!==true||!Array.isArray(out.items))
    throw Error('Не удалось подтвердить архивный источник.');
   if(Object.values(applied).some(Boolean)&&
     Object.keys(applied).some(k=>out.filters?.[k]!==applied[k]))
    throw Error('Ответ источника не соответствует применённым фильтрам.');
   items=items.concat(out.items);cursor=out.nextCursor||null;hasMore=out.hasMore===true;
   loaded=true;
  }catch(e){if(active&&current===seq)error=String(e?.message||'Архив недоступен');}
  finally{if(active&&current===seq){loading=false;draw();}}
 }
 async function getOptions(){
  if(!active||optionsBusy||filterOptionsLoaded)return;
  const current=++optionsSeq;optionsBusy=true;optionsError='';draw();
  try{
   const out=await fetchPage('/api/history/finance/options');
   if(!active||current!==optionsSeq)return;
   if(out?.source!=='FROZEN_LEGACY_FINANCE_FILTER_OPTIONS'||out.readonly!==true||
     !Array.isArray(out.workOrders)||out.workOrders.length!==21||
     !Array.isArray(out.workers)||out.workers.length!==2)
    throw Error('Архивные справочники не прошли проверку источника.');
   const verify=(list,field)=>{
    const seen=new Set();
    for(const x of list){
     if(typeof x?.id!=='string'||!goodId(x.id)||
       typeof x[field]!=='string'||seen.has(x.id))
      throw Error('Архивный справочник содержит некорректные ID.');
     seen.add(x.id);
    }
   };
   verify(out.workOrders,'title');verify(out.workers,'name');
   options={workOrders:out.workOrders,workers:out.workers};filterOptionsLoaded=true;
  }catch(e){if(active&&current===optionsSeq)optionsError=String(e?.message||'Справочники недоступны');}
  finally{if(active&&current===optionsSeq){optionsBusy=false;draw();}}
 }
 const onClick=e=>{
  if(e.target?.closest?.('[data-finance-load]')){void load(!loaded);return;}
  if(e.target?.closest?.('[data-finance-filters-toggle]')){
   filtersOpen=!filtersOpen;draw();if(filtersOpen&&!filterOptionsLoaded)void getOptions();return;
  }
  if(e.target?.closest?.('[data-finance-options-retry]')){void getOptions();return;}
  if(e.target?.closest?.('[data-finance-apply]')){
   if(!goodId(pending.workOrderId)||!goodId(pending.workerId)||
      !dateValid(pending.dateFrom)||!dateValid(pending.dateTo)||
      (pending.dateFrom&&pending.dateTo&&pending.dateFrom>pending.dateTo)||
      (pending.workOrderId&&!options.workOrders.some(o=>o.id===pending.workOrderId))||
      (pending.workerId&&!options.workers.some(w=>w.id===pending.workerId))){
    error='Некорректный заказ, работник или диапазон дат.';draw();return;
   }
   applied={...pending};void load(true);return;
  }
  if(e.target?.closest?.('[data-finance-reset]')){
   pending=emptyFilters();applied=emptyFilters();void load(true);
  }
 };
 const onChange=e=>{
  if(e.target?.matches?.('[data-finance-type]')){
   const next=String(e.target.value);
   if(!kinds.some(([v])=>v===next)||next===type)return;
   type=next;void load(true);return;
  }
  if(e.target?.matches?.('[data-finance-filter]')){
   const field=String(e.target.getAttribute('data-finance-filter'));
   if(Object.hasOwn(pending,field))pending[field]=String(e.target.value||'');
  }
 };
 root.addEventListener('click',onClick);root.addEventListener('change',onChange);
 draw();
 return {load,unmount(){
  active=false;seq++;optionsSeq++;
  root.removeEventListener('click',onClick);root.removeEventListener('change',onChange);
 }};
}
