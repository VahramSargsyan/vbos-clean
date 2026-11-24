/**
 * Finance P4 — mobile object/worker results from verified NEW native money only.
 * Read-only overview. Drill-down reuses P1 exact scoped native summary/history.
 * Historical Google objects/workers never remap by name.
 */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY=/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
function fmt(x){
 const s=String(x??'');
 if(!MONEY.test(s))throw Error('FINANCE_P4_MONEY_SOURCE_INVALID');
 const neg=s.startsWith('-'),[whole,fraction='']=(neg?s.slice(1):s).split('.');
 const decimal=fraction.replace(/0+$/,'');
 return (neg?'-':'')+whole.replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0')+
  (decimal?','+decimal:'')+' AMD';
}
const summaries=Object.freeze({
 objects:[['earnedBase','Заработано'],['receivedBase','Получено'],
  ['economicExpenseBase','Расходы'],['profitBase','Прибыль'],
  ['cashBalanceBase','Денежный эффект']],
 workers:[['workerAccruedBase','Начислено'],['workerPaidBase','Выплачено'],
  ['workerPayableBase','Долг по новым операциям'],['economicExpenseBase','Расходы бизнеса по связанным операциям']]
});
export function financeP4VerifiedResponse(x,kind,q){
 if(x?.version!=='FINANCE_P4_NATIVE_ENTITY_RESULTS_V1'||x.source!=='CLEAN_NATIVE_FINANCE_ONLY'||
    x.readonly!==true||x.historicalIncluded!==false||x.currency!=='AMD'||
    x.scope!=='NEW_NATIVE_TRANSACTIONS_ONLY'||x.kind!==kind||x.q!==q||
    !Array.isArray(x.items)||x.items.length>20||typeof x.hasMore!=='boolean'||
    (x.hasMore?typeof x.nextCursor!=='string'||!x.nextCursor:x.nextCursor!==null))
  throw Error('FINANCE_P4_UNATTESTED_RESULT');
 const ids=new Set();
 for(const r of x.items){
  if(!r||!UUID.test(r.id)||ids.has(r.id)||typeof r.label!=='string'||!r.label.trim()||
     !Number.isSafeInteger(r.totalCount)||r.totalCount<1||
     !Number.isSafeInteger(r.activeCount)||r.activeCount<0||r.activeCount>r.totalCount||
     r.archivedCount!==r.totalCount-r.activeCount||
     !r.metrics||typeof r.metrics!=='object')throw Error('FINANCE_P4_INVALID_ENTITY_ROW');
  for(const [key] of summaries[kind])fmt(r.metrics[key]);
  ids.add(r.id);
 }
 return x;
}
export function financeP4NativeHtml({kind='objects',q='',items=[],data=null,loading=false,error=''}={}){
 if(!Object.hasOwn(summaries,kind))throw Error('FINANCE_P4_VIEW_KIND_INVALID');
 const title=kind==='objects'?'Объекты':'Работники';
 const subtitle=kind==='objects'?
  'Заработано, получено, экономические расходы и прибыль только по новым операциям объекта.':
  'Начислено, выплачено и долг из новых операций. Это не полный расчёт зарплаты или табель.';
 const rows=items.map(item=>{
  const cards=summaries[kind].map(([key,label])=>
   '<div class="finance-p4-metric"><span>'+esc(label)+'</span><strong>'+esc(fmt(item.metrics[key]))+
   '</strong></div>').join('');
  return '<article class="finance-p4-row" aria-label="Нативный финансовый результат">'+
   '<div class="finance-p4-row-head"><h4>'+esc(item.label)+'</h4>'+
   '<span class="small muted">'+esc(item.activeCount)+' активных · '+
   esc(item.archivedCount)+' отменённых</span></div>'+
   '<div class="finance-p4-metrics">'+cards+'</div>'+
   '<button type="button" data-finance-p4-open="'+esc(item.id)+'"'+(loading?' disabled':'')+
   '>Открыть историю и все показатели</button></article>';
 }).join('');
 return '<section class="finance-p4-root" aria-label="Финансовые результаты объектов и работников">'+
  '<h2>Результаты объектов и работников · PostgreSQL</h2>'+
  '<p class="small muted">Только текущий новый финансовый учёт, без добавления старых сумм Google. '+
  'Объекты и работники с нулём новых операций пока не показываются.</p>'+
  '<div class="finance-p4-tabs" role="group" aria-label="Раздел финансовой аналитики">'+
  '<button type="button" data-finance-p4-kind="objects" aria-pressed="'+(kind==='objects')+'">Объекты</button>'+
  '<button type="button" data-finance-p4-kind="workers" aria-pressed="'+(kind==='workers')+'">Работники</button></div>'+
  '<p class="small muted">'+esc(subtitle)+'</p>'+
  '<form data-finance-p4-search class="finance-p4-search" autocomplete="off">'+
  '<label>Поиск '+esc(kind==='objects'?'объекта':'работника')+
  '<input type="search" name="q" maxlength="80" value="'+esc(q)+
  '" placeholder="Не менее 2 символов"></label>'+
  '<button type="submit"'+(loading?' disabled':'')+'>Найти</button>'+
  '<button type="button" data-finance-p4-reset'+(loading?' disabled':'')+'>Сбросить</button></form>'+
  (error?'<p role="alert">'+esc(error)+'</p>':'')+
  '<div class="finance-p4-list" aria-live="polite">'+
  (rows||(!loading&&data?'<p class="muted">В этой группе новых финансовых операций не найдено.</p>':
   '<p role="status">Загружаю результаты '+esc(title.toLowerCase())+'…</p>'))+'</div>'+
  (data?.hasMore?'<button type="button" data-finance-p4-more'+(loading?' disabled':'')+
   '>Показать ещё</button>':'')+
  '<p class="small muted">Суммы накопительные в пределах каждой нативной записи и не включают начальные остатки. '+
  'По кнопке открывается уже существующая история P1; архив старого VBOS расположен отдельно ниже.</p></section>';
}
export function mountFinanceP4Native(root,{fetchPage,onOpenScope}={}){
 if(!root||typeof root.addEventListener!=='function'||typeof fetchPage!=='function'||
  typeof onOpenScope!=='function')throw Error('FINANCE_P4_MOUNT_INVALID');
 let active=true,seq=0,kind='objects',q='',data=null,items=[],loading=false,error='',queued=false;
 const render=()=>{if(active)root.innerHTML=financeP4NativeHtml({kind,q,items,data,loading,error});};
 const load=async(more=false)=>{
  if(!active)return;
  if(loading){if(!more)queued=true;return;}
  const n=++seq;loading=true;error='';render();
  try{
   const p=new URLSearchParams({kind,limit:'20'});if(q)p.set('q',q);
   if(more&&data?.nextCursor)p.set('cursor',data.nextCursor);
   const response=financeP4VerifiedResponse(await fetchPage('/api/finance/native-entity-results?'+p.toString()),kind,q);
   if(!active||n!==seq)return;
   const seen=new Set(more?items.map(x=>x.id):[]);
   items=more?[...items,...response.items.filter(x=>!seen.has(x.id))]:response.items;
   data=response;
  }catch(e){if(active&&n===seq)error='Результаты не загружены: '+String(e?.message||'Ошибка источника');}
  finally{if(active&&n===seq){loading=false;render();if(queued){queued=false;void load();}}}
 };
 const click=e=>{
  const b=e.target?.closest?.('button');if(!b||!active)return;
  const next=b.getAttribute('data-finance-p4-kind');
  if(next){
   if(!Object.hasOwn(summaries,next)||next===kind)return;
   // Discard an old in-flight category GET; it must not overwrite this tab.
   if(loading){seq++;loading=false;queued=false;}
   kind=next;q='';data=null;items=[];void load();return;
  }
  if(b.hasAttribute('data-finance-p4-reset')){q='';data=null;items=[];void load();return;}
  if(b.hasAttribute('data-finance-p4-more')){if(data?.hasMore)void load(true);return;}
  const id=b.getAttribute('data-finance-p4-open');
  if(id){
   const entry=items.find(x=>x.id===id);
   if(!entry||!onOpenScope(kind,id,entry.label)){
    error='Подробная история P1 пока недоступна. Повтори после загрузки Финансов.';render();
   }
  }
 };
 const submit=e=>{
  if(!e.target?.hasAttribute?.('data-finance-p4-search'))return;
  e.preventDefault();if(!active||loading)return;
  const v=String(new FormData(e.target).get('q')||'').trim();
  if(v&&v.length<2){error='Введи минимум два символа.';render();return;}
  q=v;data=null;items=[];void load();
 };
 root.addEventListener('click',click);root.addEventListener('submit',submit);
 void load();
 return {load,unmount(){active=false;seq++;queued=false;
  root.removeEventListener('click',click);root.removeEventListener('submit',submit);}};
}
