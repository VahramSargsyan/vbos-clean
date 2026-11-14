/** Existing Clean Finance page: immutable historical object summary, owner-only. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function money(value){
 const raw=String(value??'');
 if(!/^-?\d+(?:\.\d{1,6})?$/.test(raw))throw Error('FINANCE_OBJECT_INVALID_AMOUNT');
 const negative=raw.startsWith('-'),[whole,frac='']=(negative?raw.slice(1):raw).split('.');
 const suffix=frac.replace(/0+$/,'');
 return (negative?'-':'')+whole.replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0')+
  (suffix?','+suffix:'')+' AMD';
}
const card=(title,value)=>'<div class="card"><span>'+esc(title)+'</span><strong>'+esc(money(value))+'</strong></div>';
export function financeObjectResultHtml(data){
 if(!data||data.source!=='VERIFIED_FROZEN_LEGACY_OBJECT_FINANCE'||
    data.readonly!==true||data.currentOperationalFinance!==false||
    data.financialWriter!=='GOOGLE'||data.currency!=='AMD'||
    !Number.isInteger(data.transactionCount)||data.transactionCount<0||
    !Number.isInteger(data.relatedOrderCount)||data.relatedOrderCount<0||
    data.hasOperations!==(data.transactionCount>0))
  throw Error('FINANCE_OBJECT_VIEW_SOURCE_UNVERIFIED');
 return '<div role="group" aria-label="Результат выбранного объекта">'+
  '<h3>'+esc(data.objectTitle||data.objectId)+'</h3>'+
  '<p class="small muted">Финансовый итог объекта из сохранённого Google-архива · '+esc(data.objectId)+
  ' · снимок '+esc(String(data.sourceModifiedAt||'').slice(0,10))+
  '. Не текущий баланс и не новая финансовая запись.</p>'+
  (data.hasOperations?
    '<div class="summary">'+card('Прибыль объекта',data.profitBase)+
     card('Заработано',data.earnedBase)+card('Получено',data.receivedBase)+
     card('Экономические расходы',data.economicExpenseBase)+
     card('Долг работникам',data.workerPayableBase)+
     card('Денежный эффект',data.cashBalanceBase)+'</div>':
    '<p class="muted">В сохранённом архиве для объекта нет финансовых операций. Результат неизвестен, не равен доказанному нулю.</p>')+
  '<p class="small muted">Активных операций: '+esc(data.transactionCount)+
  '. Связанных заказов с операциями: '+esc(data.relatedOrderCount)+
  '. Суммы считаются напрямую по objectId, без повторного сложения заказов.</p>'+
  '</div>';
}
export function mountFinanceObjectResultPanel(root,{fetchPage}={}){
 if(!root||typeof root.addEventListener!=='function'||typeof fetchPage!=='function')
  throw Error('FINANCE_OBJECT_VIEW_NOT_CONFIGURED');
 let active=true,seq=0,items=[],selected='',result=null,busy=false,error='',loading=true;
 function draw(){
  if(!active)return;
  const options=items.map(o=>'<option value="'+esc(o.objectId)+'"'+
   (selected===o.objectId?' selected':'')+'>'+esc(o.title)+' · '+esc(o.objectId)+'</option>').join('');
  root.innerHTML='<h2>Финансовый результат отдельного объекта</h2>'+
   '<p class="small muted">Выбери объект из старого VBOS. Показатели накопительные и относятся только к сохранённым операциям этого объекта.</p>'+
   (loading?'<p role="status">Загрузка объектов…</p>':
    '<label>Объект <select data-finance-object-select><option value="">Выбери объект</option>'+options+'</select></label>')+
   (busy?'<p role="status">Расчёт объекта…</p>':'')+
   (error?'<p role="alert">'+esc(error)+'</p>':'')+
   (result&&!busy?financeObjectResultHtml(result):'');
 }
 async function init(){
  const n=++seq;draw();
  try{
   const response=await fetchPage('/api/finance/object-options');
   if(!active||n!==seq)return;
   if(!response||response.source!=='VERIFIED_FROZEN_LEGACY_OBJECT_OPTIONS'||
     response.readonly!==true||response.currentOperationalFinance!==false||
     !Array.isArray(response.items)||response.items.length!==19)
    throw Error('Список объектов не подтверждён источником.');
   const ids=new Set();
   for(const item of response.items){
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(String(item.objectId||''))||
      typeof item.title!=='string'||ids.has(item.objectId))
     throw Error('Список объектов повреждён.');
    ids.add(item.objectId);
   }
   items=response.items;
  }catch(e){if(active&&n===seq)error=String(e?.message||'Список объектов недоступен');}
  finally{if(active&&n===seq){loading=false;draw();}}
 }
 async function load(id){
  const n=++seq;result=null;error='';selected=id;busy=Boolean(id);draw();
  if(!id)return;
  try{
   const data=await fetchPage('/api/finance/object-result?objectId='+encodeURIComponent(id));
   if(!active||n!==seq)return;
   if(data?.objectId!==id||data.source!=='VERIFIED_FROZEN_LEGACY_OBJECT_FINANCE'||
     data.readonly!==true||data.currentOperationalFinance!==false)
    throw Error('Финансовая сводка объекта не подтверждена источником.');
   result=data;
  }catch(e){if(active&&n===seq)error=String(e?.message||'Расчёт объекта недоступен');}
  finally{if(active&&n===seq){busy=false;draw();}}
 }
 const onChange=e=>{
  if(!e.target?.matches?.('[data-finance-object-select]'))return;
  const id=String(e.target.value);
  if(id&&!items.some(item=>item.objectId===id))return;
  void load(id);
 };
 root.addEventListener('change',onChange);void init();
 return {unmount(){active=false;seq++;root.removeEventListener('change',onChange);}};
}
