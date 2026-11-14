/**
 * Owner-only worker-linked finance history, independent of current payroll.
 * The result is a frozen Google business effect, NOT employee earnings.
 */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function amount(value){
 const s=String(value??'');
 if(!/^-?\d+(?:\.\d{1,6})?$/.test(s))throw Error('Сумма архива не подтверждена');
 const minus=s.startsWith('-'),[whole,frac='']=(minus?s.slice(1):s).split('.');
 const part=frac.replace(/0+$/,'');
 return (minus?'-':'')+whole.replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0')+
  (part?','+part:'')+' AMD';
}
const metric=(label,v)=>'<div class="card"><span>'+esc(label)+'</span><strong>'+esc(amount(v))+'</strong></div>';
export function financeWorkerHistoryHtml(data){
 if(!data||data.source!=='VERIFIED_FROZEN_LEGACY_WORKER_FINANCE'||
  data.readonly!==true||data.financialWriter!=='GOOGLE'||
  data.currentOperationalFinance!==false||data.currency!=='AMD'||
  !Number.isInteger(data.transactionCount)||data.transactionCount<0||
  data.hasOperations!==(data.transactionCount>0))
  throw Error('WORKER_HISTORY_VIEW_SOURCE_UNVERIFIED');
 return '<section aria-label="Финансовый итог работника из старого архива">'+
  '<h3>'+esc(data.workerName||data.workerId)+'</h3>'+
  '<p class="small muted">Оригинальный работник: '+esc(data.workerId)+
  ' · сохранённый Google-срез '+esc(String(data.sourceModifiedAt||'').slice(0,10))+'</p>'+
  '<p class="muted"><strong>Это влияние привязанных операций на финансы бизнеса.</strong> '+
  'Не зарплата работника и не текущий расчёт долгов или прибыли.</p>'+
  (data.hasOperations?
   '<div class="summary">'+
    metric('Начислено по операциям',data.workerAccruedBase)+
    metric('Выплачено по операциям',data.workerPaidBase)+
    metric('Остаток долга по архивным операциям',data.workerPayableBase)+
    metric('Исторические расходы бизнеса',data.economicExpenseBase)+
    metric('Влияние на прибыль бизнеса',data.profitBase)+
    metric('Денежный эффект',data.cashBalanceBase)+'</div>':
   '<p class="muted">В сохранённом архиве нет операций этого работника. '+
   'Исторический финансовый результат неизвестен, а не доказанно равен нулю.</p>')+
  '<p class="small muted">Связанных активных операций: '+esc(data.transactionCount)+
  '. Только workerId: никакого соединения по имени или повторного сложения заказов.</p></section>';
}
export function mountFinanceWorkerHistoryPanel(root,{fetchPage}={}){
 if(!root||typeof root.addEventListener!=='function'||typeof fetchPage!=='function')
  throw Error('WORKER_HISTORY_VIEW_NOT_CONFIGURED');
 let active=true,seq=0,options=[],workerId='',result=null,error='',loadingOptions=true,busy=false;
 function draw(){
  if(!active)return;
  const select=options.map(w=>'<option value="'+esc(w.workerId)+'"'+
   (workerId===w.workerId?' selected':'')+'>'+esc(w.workerName)+' · '+esc(w.workerId)+'</option>').join('');
  root.innerHTML='<h2>Финансовые операции отдельного работника</h2>'+
   '<p class="small muted">Исторические операции из старого VBOS, не текущий расчёт зарплаты.</p>'+
   (loadingOptions?'<p role="status">Загрузка работников…</p>':
    '<label>Работник <select data-worker-finance-select>'+
    '<option value="">Выбери работника</option>'+select+'</select></label>')+
   (busy?'<p role="status">Сверяю результат с исходным балансом…</p>':'')+
   (error?'<p role="alert">'+esc(error)+'</p>':'')+
   (result&&!busy?financeWorkerHistoryHtml(result):'');
 }
 async function loadOptions(){
  const n=++seq;draw();
  try{
   const data=await fetchPage('/api/finance/worker-options');
   if(!active||n!==seq)return;
   if(data?.source!=='VERIFIED_FROZEN_LEGACY_WORKER_OPTIONS'||data.readonly!==true||
    data.currentOperationalFinance!==false||!Array.isArray(data.workers)||data.workers.length!==2)
    throw Error('Исторический список работников не подтверждён источником.');
   const seen=new Set();
   for(const w of data.workers){
    if(typeof w?.workerId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(w.workerId)||
      typeof w.workerName!=='string'||seen.has(w.workerId))
     throw Error('Список работников содержит неверный ID.');
    seen.add(w.workerId);
   }
   options=data.workers;
  }catch(e){if(active&&n===seq)error=String(e?.message||'Работники недоступны');}
  finally{if(active&&n===seq){loadingOptions=false;draw();}}
 }
 async function load(id){
  const n=++seq;workerId=id;result=null;error='';busy=Boolean(id);draw();
  if(!id)return;
  try{
   const data=await fetchPage('/api/finance/worker-history?workerId='+encodeURIComponent(id));
   if(!active||n!==seq)return;
   if(data?.source!=='VERIFIED_FROZEN_LEGACY_WORKER_FINANCE'||data.workerId!==id||
      data.readonly!==true||data.currentOperationalFinance!==false)
    throw Error('История финансов работника не подтверждена источником.');
   result=data;
  }catch(e){if(active&&n===seq)error=String(e?.message||'Расчёт недоступен');}
  finally{if(active&&n===seq){busy=false;draw();}}
 }
 const onChange=e=>{
  if(!e.target?.matches?.('[data-worker-finance-select]'))return;
  const id=String(e.target.value||'');
  if(id&&!options.some(w=>w.workerId===id))return;
  void load(id);
 };
 root.addEventListener('change',onChange);void loadOptions();
 return {unmount(){active=false;seq++;root.removeEventListener('change',onChange);}};
}
