/* VBOS Clean historical CRM: old Leads/Clients/Objects list UX, immutable archive. */
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const types=Object.freeze(['leads','clients','objects']);
const info=Object.freeze({
 leads:Object.freeze({title:'Лиды',intro:'Новые обращения и следующие действия.',placeholder:'Поиск по имени, телефону, потребности',
  states:[['all','Все'],['open','Активные'],['transferred','Переданные'],['won','Договорились'],['lost','Потеряны'],['archived','Архив']]}),
 clients:Object.freeze({title:'Клиенты',intro:'Клиента можно создать напрямую или преобразовать из лида.',placeholder:'Поиск по имени, телефону, адресу',
  states:[['all','Все статусы'],['active','Активные'],['archived','Архив']]}),
 objects:Object.freeze({title:'Объекты',intro:'Каждый объект связан с существующим клиентом.',placeholder:'Поиск по названию, адресу, типу',
  states:[['all','Все']]})
});
const stateNames=Object.freeze({new:'Новое',contacted:'Связались',qualified:'Квалифицирован',won:'Договорились',
 lost:'Потерян',transferred:'Передан',archived:'Архив',active:'Активен',draft:'Черновик',planned:'Запланирован'});
const textRow=(name,value)=>value?'<div class="crm-archive-row"><dt>'+esc(name)+'</dt><dd>'+esc(value)+'</dd></div>':'';
export function renderHistoricalCrmPage(page,{type='leads',q='',status='all',loading=false,error=''}={}){
 if(!types.includes(type)||!page||!Array.isArray(page.items))throw Error('CRM_ARCHIVE_INVALID_VIEW');
 if(typeof q!=='string'||q.length>80||!info[type].states.some(s=>s[0]===status))throw Error('CRM_ARCHIVE_INVALID_FILTER');
 const conf=info[type];
 const switchers=types.map(key=>
  '<button type="button" data-crm-archive-type="'+key+'" class="'+(key===type?'is-active':'')+
  '" aria-pressed="'+(key===type)+'">'+esc(info[key].title)+'</button>').join('');
 const choices=conf.states.map(([key,label])=>
  '<option value="'+esc(key)+'"'+(status===key?' selected':'')+'>'+esc(label)+'</option>').join('');
 const cards=page.items.map(item=>{
  if(item.readonly!==true||typeof item.legacy_id!=='string')throw Error('CRM_ARCHIVE_ITEM_NOT_READONLY');
  const label=stateNames[item.status]||item.status||'Статус не указан';
  const sub=[type==='objects'?item.address:item.phone,type==='objects'?item.client_name:item.address].filter(Boolean).join(' · ');
  const links=type==='objects'
   ?textRow('Клиент',item.client_name||item.legacy_client_id)+textRow('Исходный лид',item.legacy_lead_id)
   :type==='clients'?textRow('Исходный лид',item.legacy_lead_id):'';
  const details='<dl class="crm-archive-detail">'+
   textRow('Исходный ID',item.legacy_id)+textRow('Статус',label)+
   textRow('Дата создания',item.created_at_source)+textRow('Изменено',item.updated_at_source)+
   textRow('Потребность',item.need_summary)+textRow('Тип объекта',item.object_type)+
   links+textRow('Примечание',item.notes)+'</dl>';
  const origin=item.shadowOnly?'Дополнительная копия · требует сверки':'Старый VBOS';
  return '<article class="crm-archive-record" data-legacy-crm-id="'+esc(item.legacy_id)+'">'+
   '<div class="crm-archive-top"><h3>'+esc(item.title||'Без названия')+'</h3>'+
   '<span class="crm-archive-status">'+esc(label)+'</span></div>'+
   (sub?'<p class="crm-archive-meta">'+esc(sub)+'</p>':'')+
   '<div class="crm-archive-tags"><span>'+esc(origin)+'</span>'+
   '<span>'+(item.native_link_verified?'Есть подтверждённая связь Clean':'Только историческая запись')+'</span></div>'+
   '<details><summary>Открыть запись</summary>'+details+'</details></article>';
 }).join('');
 return '<section class="crm-archive" aria-label="Историческая CRM">'+
  '<div class="crm-archive-header"><div><h1>Историческая CRM</h1>'+
  '<p>Записи старого VBOS · только просмотр. Рабочая CRM и финансы не меняются.</p></div>'+
  '<span class="crm-archive-label">Архив</span></div>'+
  '<nav class="crm-archive-types" aria-label="Тип архивных записей">'+switchers+'</nav>'+
  '<div class="crm-archive-screen-heading"><h2>'+esc(conf.title)+'</h2><p>'+esc(conf.intro)+'</p></div>'+
  '<form data-crm-archive-search class="crm-archive-filter">'+
  '<label><span class="sr-only">Поиск '+esc(conf.title.toLowerCase())+'</span>'+
  '<input name="q" type="search" maxlength="80" value="'+esc(q)+'" placeholder="'+esc(conf.placeholder)+'" aria-label="'+esc(conf.placeholder)+'"></label>'+
  (type==='objects'?'': '<label><span class="sr-only">Статус</span><select name="status" aria-label="Фильтр статуса">'+choices+'</select></label>')+
  '<button type="submit">Найти</button><button type="button" data-crm-archive-reset>Сбросить</button></form>'+
  (error?'<p role="alert">'+esc(error)+'</p>':'')+
  (loading?'<p role="status">Загрузка архивных записей…</p>':page.items.length?
   '<div class="crm-archive-cards">'+cards+'</div>':'<p class="crm-archive-empty">По выбранным условиям записей нет.</p>')+
  (page.hasMore&&!loading?'<button type="button" data-crm-archive-more>Показать ещё</button>':'')+
  '<p class="crm-archive-footer">Отдельный исторический просмотр. Дополнительные записи из теневой копии не считаются подтверждёнными строками действующего Google-файла.</p>'+
  '</section>';
}
export function mountHistoricalCrmPage(root,{fetchPage}={}){
 if(!root||typeof root.addEventListener!=='function'||typeof root.innerHTML!=='string')throw Error('CRM_ARCHIVE_ROOT_REQUIRED');
 if(typeof fetchPage!=='function')throw Error('CRM_ARCHIVE_AUTH_FETCH_REQUIRED');
 let type='leads',q='',status='all',items=[],cursor=null,loading=false,seq=0,unmounted=false,error='';
 const view=()=>{if(!unmounted)root.innerHTML=renderHistoricalCrmPage({items,hasMore:Boolean(cursor)},{type,q,status,loading,error});};
 const load=async(append=false)=>{
  if(loading||unmounted)return;
  const id=++seq;loading=true;error='';view();
  try{
   const args=new URLSearchParams({type,q,status,limit:'20'});
   if(append&&cursor)args.set('cursor',cursor);
   const res=await fetchPage('/api/history/crm?'+args.toString());
   if(unmounted||seq!==id)return;
   if(!res||res.version!=='CRM_HISTORICAL_BROWSER_V1'||
     res.source!=='FROZEN_LEGACY_CRM_ARCHIVE_ONLY'||res.readonly!==true||
     res.operational!==false||res.type!==type||res.q!==q||res.status!==status||
     !Array.isArray(res.items)||res.items.length>20||
     res.items.some(x=>!x.readonly||!['LEGACY_GOOGLE','OFFICIAL_SHADOW_EXTRA'].includes(x.source_system))||
     (res.hasMore&&(typeof res.nextCursor!=='string'||!res.nextCursor)))
      throw Error('CRM_ARCHIVE_UNVERIFIED_RESPONSE');
   const ids=new Set(items.map(x=>x.legacy_id));
   if(append&&res.items.some(x=>ids.has(x.legacy_id)))throw Error('CRM_ARCHIVE_DUPLICATE_PAGE');
   items=append?items.concat(res.items):res.items;
   cursor=res.hasMore?res.nextCursor:null;
  }catch{if(!unmounted&&seq===id)error='Не удалось подтвердить исторические данные. Повтори загрузку.';}
  finally{if(!unmounted&&seq===id){loading=false;view();}}
 };
 const changeType=e=>{
  const typeNext=e.target?.closest?.('[data-crm-archive-type]')?.getAttribute?.('data-crm-archive-type');
  if(typeNext&&types.includes(typeNext)&&typeNext!==type){
   seq++;loading=false;type=typeNext;q='';status='all';items=[];cursor=null;error='';void load();
  }else if(e.target?.closest?.('[data-crm-archive-more]')){void load(true);}
  else if(e.target?.closest?.('[data-crm-archive-reset]')){
   seq++;loading=false;q='';status='all';items=[];cursor=null;void load();
  }
 };
 const submit=e=>{
  if(!e.target?.matches?.('[data-crm-archive-search]'))return;
  e.preventDefault();
  const f=e.target;const name=String(f.querySelector?.('[name="q"]')?.value||'').trim();
  if(name.length>80)return;
  const selected=String(f.querySelector?.('[name="status"]')?.value||'all');
  if(!info[type].states.some(s=>s[0]===selected))return;
  seq++;loading=false;q=name;status=selected;items=[];cursor=null;void load();
 };
 root.addEventListener('click',changeType);root.addEventListener('submit',submit);
 void load();
 return {unmount(){unmounted=true;seq++;root.removeEventListener('click',changeType);root.removeEventListener('submit',submit);}};
}
