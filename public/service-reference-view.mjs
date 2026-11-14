/* VBOS Clean V12 read-only Google reference snapshot (NOT live price authority). */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ACTIONS=Object.freeze({
 MOUNT:'Монтаж',INSTALL:'Установка',DISMANTLE:'Демонтаж',CONNECT:'Подключение',
 REPAIR:'Ремонт',DIAGNOSE:'Диагностика',PREPARE:'Подготовка',CLEANUP:'Уборка',
 LOGISTICS:'Перенос / подъём',OTHER:'Другое',unclassified:'Не классифицировано'
});
const priceString=(raw)=>{
 if(raw===null||raw===undefined)return '';
 const s=String(raw);
 if(!/^\d+(?:\.\d{1,4})?$/.test(s))return '';
 const [integer,decimal='']=s.split('.');
 const frac=decimal.replace(/0+$/,'');
 return integer.replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0')+(frac?','+frac:'');
};
function masterPrice(p){
 const from=priceString(p.priceFrom),to=priceString(p.priceTo);
 if(!from||!p.currency)return '';
 const amount=from+(to&&to!==from?'–'+to:'');
 const cur=p.currency==='AMD'?'драм':p.currency;
 const date=/^\d{4}-\d\d-\d\d$/.test(p.validFrom||'')?' · с '+esc(p.validFrom.slice(8)+'.'+p.validFrom.slice(5,7)+'.'+p.validFrom.slice(0,4)):'';
 return '<p class="ref-price">Расценка мастера '+esc(p.masterId||'')+': '+esc(amount)+' '+esc(cur)+' / '+esc(p.unit||'')+date+'</p>';
}
export function renderReferencePanel(page,{q='',action='',busy=false,error=''}={}){
 if(!page||!Array.isArray(page.items))throw Error('INVALID_REFERENCE_PAGE');
 if(!Object.hasOwn(ACTIONS,action)&&action!=='')throw Error('INVALID_REFERENCE_ACTION');
 if(typeof q!=='string'||q.length>80)throw Error('INVALID_REFERENCE_QUERY');
 const options=[['','Все виды работ'],...Object.entries(ACTIONS)].map(([v,label])=>
  '<option value="'+esc(v)+'"'+(v===action?' selected':'')+'>'+esc(label)+'</option>').join('');
 const cards=page.items.map(s=>{
  const name=esc(s.serviceName||'Услуга без названия'),cat=esc(s.category||'Категория не указана');
  const type=esc(ACTIONS[s.actionCode]||'Не классифицировано');
  const price=(s.masterPrices||[]).map(masterPrice).filter(Boolean).join('');
  return '<article class="ref-service-card"><div class="ref-header"><strong>'+name+'</strong><span>'+type+'</span></div>'
   +'<p>'+cat+' · '+esc(s.defaultUnit||'')+'</p>'
   +(price||'<p class="ref-no-price">Расценка не зарегистрирована</p>')
   +'<small>Legacy ID: '+esc(s.serviceId||'')+'</small></article>';
 }).join('');
 return '<section class="ref-catalog" aria-label="Справочник услуг"><h2>Услуги и расценки</h2>'
  +'<p class="ref-context">Справочник старого VBOS только для просмотра. Расценки мастеров не являются общими тарифами.</p>'
  +'<form data-ref-search><label>Название, категория или ID'
  +'<input name="q" maxlength="80" placeholder="Найти услугу" value="'+esc(q)+'"></label>'
  +'<label>Вид работ<select name="action">'+options+'</select></label>'
  +'<button type="submit">Найти</button></form>'
  +(error?'<p role="alert">'+esc(error)+'</p>':'')
  +(busy?'<p role="status">Загрузка услуг…</p>':page.items.length?cards:'<p>Услуги не найдены.</p>')
  +(page.hasMore&&!busy?'<button type="button" data-ref-more>Показать ещё</button>':'')
  +'</section>';
}
export function mountReferencePanel(root,{fetchPage}={}){
 if(!root||typeof root.innerHTML!=='string'||typeof root.addEventListener!=='function')throw Error('INVALID_REFERENCE_ROOT');
 if(typeof fetchPage!=='function')throw Error('REFERENCE_AUTH_FETCH_REQUIRED');
 let items=[],q='',action='',cursor=null,busy=false,version=0,unmounted=false;
 const draw=(error='')=>{if(!unmounted)root.innerHTML=renderReferencePanel({items,hasMore:Boolean(cursor)},{q,action,busy,error});};
 async function load(append=false){
  const seq=++version;
  busy=true;draw();
  try{
   const p=new URLSearchParams({q,action,limit:'20'});
   if(append&&cursor)p.set('cursor',cursor);
   const data=await fetchPage('/api/reference/services?'+p);
   if(unmounted||seq!==version)return;
   if(!data||data.readonly!==true||!Array.isArray(data.items)||data.source!=='LEGACY_GOOGLE_REFERENCE_SNAPSHOT_NOT_AUTHORITY')
    throw Error('INVALID_REFERENCE_SERVER_PAGE');
   items=append?items.concat(data.items):data.items;
   cursor=data.hasMore?data.nextCursor:null;
   busy=false;draw();
  }catch{
   if(unmounted||seq!==version)return;
   busy=false;draw('Справочник ещё не загружен или временно недоступен.');
  }
 }
 const onSubmit=e=>{
  if(!e.target?.matches?.('[data-ref-search]'))return;
  e.preventDefault();
  const nextQ=e.target.querySelector('[name="q"]')?.value?.trim()??'';
  const nextAction=e.target.querySelector('[name="action"]')?.value??'';
  if(nextQ.length>80||(nextAction&&!Object.hasOwn(ACTIONS,nextAction)))return;
  q=nextQ;action=nextAction;cursor=null;items=[];void load();
 };
 const onClick=e=>{if(e.target?.closest?.('[data-ref-more]')&&!busy&&cursor)void load(true);};
 root.addEventListener('submit',onSubmit);root.addEventListener('click',onClick);
 draw();void load();
 return Object.freeze({unmount(){
  unmounted=true;version++;
  root.removeEventListener('submit',onSubmit);root.removeEventListener('click',onClick);
 }});
}
