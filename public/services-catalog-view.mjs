// MS2 owner catalog. The historic reference panel is independent and unchanged.
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const UNITS={job:'Работа',item:'Штука',point:'Точка',meter:'Пог. метр',square_meter:'м²',hour:'Час',day:'День',visit:'Выезд',other:'Другое'};
const ACTIONS={MOUNT:'Монтаж',INSTALL:'Установка',DISMANTLE:'Демонтаж',CONNECT:'Подключение',REPAIR:'Ремонт',DIAGNOSE:'Диагностика',PREPARE:'Подготовка',CLEANUP:'Уборка',LOGISTICS:'Перенос / подъём',OTHER:'Другое'};
const opts=(pairs,value)=>pairs.map(([k,v])=>'<option value="'+esc(k)+'"'+(k===value?' selected':'')+'>'+esc(v)+'</option>').join('');
const statuses=[['active','Активна'],['archived','Архив']];
const blank=()=>({serviceId:'',revision:null,status:'active',category:'',serviceName:'',defaultUnit:'job',notes:'',actionCode:''});
const editor=x=>'<form data-ms2-save class="grid"><h3>'+(x.serviceId?'Редактировать услугу':'Новая услуга')+'</h3>'+
 '<label>Категория<input required name="category" maxlength="200" value="'+esc(x.category)+'"></label>'+
 '<label>Название<input required name="serviceName" maxlength="300" value="'+esc(x.serviceName)+'"></label>'+
 '<label>Единица<select name="defaultUnit">'+opts(Object.entries(UNITS),x.defaultUnit)+'</select></label>'+
 '<label>Статус<select name="status">'+opts(statuses,x.status)+'</select></label>'+
 '<label>Вид работ<select name="actionCode">'+opts([['','Не классифицировано'],...Object.entries(ACTIONS)],x.actionCode||'')+'</select></label>'+
 '<label>Заметки<textarea name="notes" maxlength="5000">'+esc(x.notes)+'</textarea></label>'+
 '<button type="submit" class="primary wide">Сохранить</button><button type="button" data-ms2-cancel>Отмена</button></form>';
export function renderServiceCatalog({page,filters,selected,draft,busy,error,notice}){
 const allowed=page?.writeEnabled===true,items=page?.items||[];
 const info=page?.source==='CLEAN_SERVICES_CATALOG'?'Действующий каталог Clean':page?'Проверенный исторический снимок. Запись заблокирована до совместного перехода.':'Каталог пока не загружен.';
 const cards=items.map(x=>'<article class="ref-service-card"><div class="ref-header"><strong>'+esc(x.serviceName)+'</strong><span>'+esc(x.status==='archived'?'Архив':(ACTIONS[x.actionCode]||'Не классифицировано'))+'</span></div><p>'+esc(x.category)+' · '+esc(UNITS[x.defaultUnit]||x.defaultUnit)+'</p><small>'+esc(x.serviceId)+'</small><button type="button" data-ms2-open="'+esc(x.serviceId)+'">Открыть</button></article>').join('');
 let detail='';
 if(selected)detail='<section class="card"><button type="button" data-ms2-cancel>← К услугам</button><h2>'+esc(selected.serviceName)+'</h2><p>'+esc(selected.serviceId)+' · '+esc(selected.category)+' · '+esc(UNITS[selected.defaultUnit]||selected.defaultUnit)+'</p><p>'+esc(selected.status==='archived'?'Архив':'Активна')+' · '+esc(ACTIONS[selected.actionCode]||'Не классифицировано')+'</p><p>'+esc(selected.notes||'Нет заметок')+'</p>'+(allowed?'<button type="button" data-ms2-edit>Редактировать</button>':'')+'</section>';
 return '<section class="ref-catalog"><h2>Услуги</h2><p class="ref-context">'+esc(info)+'</p>'+
 (error?'<p role="alert" class="error">'+esc(error)+'</p>':'')+(notice?'<p role="status">'+esc(notice)+'</p>':'')+(busy?'<p role="status">Загрузка услуг…</p>':'')+
 (draft&&allowed?editor(draft):selected?detail:
 '<button type="button" data-ms2-new '+(!allowed||busy?'disabled':'')+'>+ Новая услуга</button>'+
 '<form data-ms2-search class="grid"><label>Поиск<input name="q" maxlength="80" value="'+esc(filters.q)+'"></label>'+
 '<label>Статус<select name="status">'+opts([['','Все'],...statuses],filters.status)+'</select></label>'+
 '<label>Категория<select name="category">'+opts([['','Все категории'],...(page?.categories||[]).map(x=>[x,x])],filters.category)+'</select></label>'+
 '<label>Вид работ<select name="action">'+opts([['','Все виды'],['unclassified','Не классифицировано'],...Object.entries(ACTIONS)],filters.action)+'</select></label>'+
 '<button type="submit">Найти</button><button type="button" data-ms2-reset>Сбросить</button></form>'+
 (cards||(!busy&&page?'<p>Услуги не найдены.</p>':''))+(page?.hasMore&&!busy?'<button type="button" data-ms2-more>Показать ещё</button>':''))+'</section>';
}
export function mountServiceCatalog(root,{fetchPage,save,makeKey=()=>crypto.randomUUID()}={}){
 if(!root||typeof fetchPage!=='function'||typeof save!=='function')throw Error('MS2_MOUNT_REQUIRED');
 const init=()=>({q:'',status:'active',category:'',action:''});
 const state={filters:init(),page:null,selected:null,draft:null,busy:false,error:'',notice:''};
 let dead=false,seq=0,key=null;
 const draw=()=>{if(!dead)root.innerHTML=renderServiceCatalog(state);};
 async function load(append=false){
  const turn=++seq;state.busy=true;state.error='';draw();
  try{const p=new URLSearchParams({...state.filters,limit:'50'});if(append&&state.page?.nextCursor)p.set('cursor',state.page.nextCursor);
   const next=await fetchPage('/api/masters/services?'+p.toString());
   if(dead||turn!==seq)return;
   if(!next||!Array.isArray(next.items)||!Array.isArray(next.categories)||typeof next.writeEnabled!=='boolean')throw Error('Ответ каталога не распознан.');
   state.page={...next,items:append?(state.page?.items||[]).concat(next.items):next.items};
  }catch(e){if(dead||turn!==seq)return;state.page=null;state.error=e.message||'Каталог недоступен.';}
  finally{if(!dead&&turn===seq){state.busy=false;draw();}}
 }
 const onSubmit=async e=>{
  if(!e.target?.matches?.('[data-ms2-search],[data-ms2-save]'))return;
  e.preventDefault();e.stopPropagation();if(state.busy)return;
  const fields=Object.fromEntries(new FormData(e.target));
  if(e.target.matches('[data-ms2-search]')){state.filters=fields;state.selected=null;state.draft=null;await load();return;}
  if(!state.draft||state.page?.writeEnabled!==true)return;
  state.draft={...state.draft,...fields};key??=makeKey();state.busy=true;state.error='';state.notice='';draw();
  const turn=++seq;
  try{
   const out=await save('/api/masters/services/save',{payload:state.draft,requestKey:key});
   if(dead||turn!==seq)return;
   if(!out?.entityId||!out.data)throw Error('Ответ сохранения не подтверждён.');
   state.selected=out.data;state.draft=null;key=null;state.notice='Услуга сохранена.';await load();
  }catch(e){if(!dead&&turn===seq)state.error=(e.message||'Ошибка сохранения.')+' Повторное сохранение использует тот же ключ запроса.';}
  finally{if(!dead&&turn===seq){state.busy=false;draw();}}
 };
 const onClick=e=>{
  const button=e.target?.closest?.('button');if(!button||state.busy)return;
  if(button.matches('[data-ms2-new]')&&state.page?.writeEnabled===true){state.selected=null;state.draft=blank();key=null;state.error='';draw();}
  else if(button.matches('[data-ms2-open]')){state.selected=state.page?.items.find(x=>x.serviceId===button.dataset.ms2Open)||null;state.draft=null;key=null;draw();}
  else if(button.matches('[data-ms2-edit]')&&state.page?.writeEnabled===true&&state.selected){state.draft={...blank(),...Object.fromEntries(Object.keys(blank()).map(k=>[k,state.selected[k]??blank()[k]]))};key=null;draw();}
  else if(button.matches('[data-ms2-cancel]')){state.draft=null;state.selected=null;key=null;state.error='';state.notice='';void load();}
  else if(button.matches('[data-ms2-reset]')){state.filters=init();void load();}
  else if(button.matches('[data-ms2-more]')&&state.page?.hasMore)void load(true);
 };
 root.addEventListener('submit',onSubmit);root.addEventListener('click',onClick);void load();
 return {unmount(){dead=true;seq++;root.removeEventListener('submit',onSubmit);root.removeEventListener('click',onClick);}};
}
