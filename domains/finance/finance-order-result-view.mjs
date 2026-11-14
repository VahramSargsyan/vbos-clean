/** Finance / one historic WorkOrder result, no mutation or new service. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>{
 const text=String(v??'');
 if(!/^-?\d+(?:\.\d{1,6})?$/.test(text))throw Error('INVALID_ARCHIVE_MONEY');
 const neg=text.startsWith('-'),[whole,frac='']=(neg?text.slice(1):text).split('.');
 const digits=whole.replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0');
 const tail=frac.replace(/0+$/,'');
 return (neg?'-':'')+digits+(tail?','+tail:'')+' AMD';
};
const metric=(title,value)=>'<div class="card"><span>'+esc(title)+'</span><strong>'+esc(fmt(value))+'</strong></div>';
export function financeOrderResultHtml(data){
 if(!data||data.source!=='VERIFIED_FROZEN_LEGACY_ORDER_FINANCE'||data.readonly!==true||
  data.currentOperationalFinance!==false||data.financialWriter!=='GOOGLE'||
  data.currency!=='AMD'||!Number.isInteger(data.transactionCount)||data.transactionCount<0)
  throw Error('FINANCE_ORDER_RESULT_SOURCE_UNVERIFIED');
 return '<div role="group" aria-label="Итог выбранного заказа">'+
  '<h3>'+esc(data.orderTitle||data.orderId)+'</h3>'+
  '<p class="small muted">Исторический срез старого VBOS · '+esc(data.orderId)+' · снимок '+esc(String(data.sourceModifiedAt||'').slice(0,10))+
  '. Не текущий баланс и не новый финансовый учёт.</p>'+
  (data.hasOperations?
   '<div class="summary">'+metric('Прибыль заказа',data.profitBase)+
    metric('Заработано',data.earnedBase)+metric('Получено',data.receivedBase)+
    metric('Расходы по заказу',data.economicExpenseBase)+
    metric('Долг работникам',data.workerPayableBase)+
    metric('Денежный эффект',data.cashBalanceBase)+'</div>':
   '<p class="muted">В сохранённом архиве финансовых операций этого заказа нет. Финансовый результат неизвестен, а не равен нулю.</p>')+
  '<p class="small muted">Учтено активных операций: '+esc(data.transactionCount)+
  '. Источник — только связанные финансовые записи заказа. Не прибавляй сюда отдельно месячные доходы бизнеса.</p>'+
  '</div>';
}
export function mountFinanceOrderResultPanel(root,{fetchPage}={}){
 if(!root||typeof root.addEventListener!=='function'||typeof fetchPage!=='function')
  throw Error('FINANCE_ORDER_VIEW_NOT_CONFIGURED');
 let active=true,seq=0,orders=[],selected='',result=null,busy=false,error='',loadingOrders=true,hasMore=false;
 function draw(){
  if(!active)return;
  const opts=orders.map(o=>'<option value="'+esc(o.legacy_order_id)+'"'+
   (o.legacy_order_id===selected?' selected':'')+'>'+esc(o.title||o.legacy_order_id)+
   ' · '+esc(o.legacy_order_id)+'</option>').join('');
  root.innerHTML='<h2>Финансовый результат отдельного заказа</h2>'+
   '<p class="small muted">Выбери заказ из сохранённой истории. Расчёт повторяет финансовые показатели старого VBOS и сверяется с его контрольной сводкой.</p>'+
   (loadingOrders?'<p role="status">Загрузка заказов…</p>':
    '<label>Заказ <select data-finance-order-select><option value="">Выбери заказ</option>'+opts+'</select></label>')+
   (hasMore?'<p class="small muted">Показаны первые 50 исторических заказов. Для остальных нужен адресный поиск.</p>':'')+
   (busy?'<p role="status">Расчёт финансового результата…</p>':'')+
   (error?'<p role="alert">'+esc(error)+'</p>':'')+
   (result&&!busy?financeOrderResultHtml(result):'');
 }
 async function init(){
  const n=++seq;draw();
  try{
   const page=await fetchPage('/api/history/orders?scope=all&limit=50');
   if(!active||n!==seq)return;
   if(!page||page.source!=='VERIFIED_HISTORY_NOT_OPERATIONAL_ORDERS'||page.readonly!==true||
    !Array.isArray(page.items))throw Error('Исторический список заказов не подтверждён.');
   orders=page.items.filter(o=>/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(String(o.legacy_order_id||'')));
   hasMore=page.hasMore===true;
  }catch(e){if(active&&n===seq)error=String(e?.message||'Не удалось загрузить историю заказов');}
  finally{if(active&&n===seq){loadingOrders=false;draw();}}
 }
 async function load(id){
  const n=++seq;result=null;error='';selected=id;busy=Boolean(id);draw();
  if(!id)return;
  try{
   const data=await fetchPage('/api/finance/order-result?orderId='+encodeURIComponent(id));
   if(!active||n!==seq)return;
   if(data?.orderId!==id||data.source!=='VERIFIED_FROZEN_LEGACY_ORDER_FINANCE'||
    data.readonly!==true)throw Error('Результат заказа не подтверждён источником.');
   result=data;
  }catch(e){if(active&&n===seq)error=String(e?.message||'Расчёт недоступен');}
  finally{if(active&&n===seq){busy=false;draw();}}
 }
 const onChange=e=>{
  if(!e.target?.matches?.('[data-finance-order-select]'))return;
  const id=String(e.target.value);
  if(id&&!orders.some(o=>o.legacy_order_id===id))return;
  void load(id);
 };
 root.addEventListener('change',onChange);
 void init();
 return {unmount(){active=false;seq++;root.removeEventListener('change',onChange);}};
}
