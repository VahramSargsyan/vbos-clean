'use strict';
/* Legacy VBOS Knowledge.html + Scripts.html faithful screen copy.
 * Source data and writes remain blocked until guarded migration acceptance.
 */
const knowledgeStages=[
 ['ALL','Все'],['LEADS','Лиды'],['INSPECTION','Осмотр'],
 ['OFFER','Предложение и цена'],['WORK','Работа'],['QUALITY','Качество'],
 ['HANDOVER','Запуск и сдача'],['WARRANTY','Гарантия'],['IMPROVEMENTS','Итоги'],
 ['STOP','STOP']
];
const knowledgeNames=Object.fromEntries(knowledgeStages);
knowledgeNames.OTHER='Справка';
knowledgeNames.IMPROVEMENTS='Итоги и улучшения';
knowledgeNames.STOP='STOP / исключения';
const knowledgeState={loaded:false,loading:false,items:[],error:'',meta:null,
 writeEnabled:false,phase:'LEGACY',query:'',type:'ALL',status:'active',stage:'ALL',favoritesOnly:false,
 pendingFavorites:new Map()};
const knowledgeEsc=value=>String(value??'').replace(/[&<>"']/g,
 ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const knowledgeOption=(value,label,current)=>'<option value="'+knowledgeEsc(value)+'"'+
 (String(value)===String(current)?' selected':'')+'>'+knowledgeEsc(label)+'</option>';
function knowledgeDisplayTitle(raw){
 return (String(raw||'').trim()
  .replace(/\b\d{4}-\d{2}-\d{2}(?:[T\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/gi,' ')
  .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\b/g,' ')
  .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g,' ')
  .replace(/\s+[·|—–-]\s*(?=[·|—–-]|\s*$)/g,' ')
  .replace(/\s{2,}/g,' ').replace(/^[\s·|—–-]+|[\s·|—–-]+$/g,'').trim())||'Без названия';
}
function knowledgeDisplayCode(raw){
 const code=String(raw||'').trim();
 if(/^\d{4}-\d{2}-\d{2}(?:(?:T|\s)\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i.test(code))return '';
 return code;
}
function knowledgeStageKeys(item){
 const code=String(item?.code||'').trim().toUpperCase(),parts=[
  item?.sectionPath,item?.tags,item?.title].map(x=>String(x||'').trim().toLowerCase()).join(' ');
 const stages=[];
 const add=x=>{if(x&&!stages.includes(x))stages.push(x);};
 const m=code.match(/^([1-8])\./);
 if(m){add(['','LEADS','INSPECTION','OFFER','WORK','QUALITY','HANDOVER','WARRANTY','IMPROVEMENTS'][Number(m[1])]);return stages;}
 if(/^S\./.test(code))return ['STOP'];
 if(code==='SOP-ARCH'||code==='SOP-SOURCES')return stages;
 if(/входящ|лид|квалификац/.test(parts))add('LEADS');
 if(/осмотр|замер|готовност[ьи]\s+рабочего\s+фронта/.test(parts))add('INSPECTION');
 if(/расч[её]т|согласован|коммерческ|тариф|предложен|рентабельност/.test(parts))add('OFFER');
 if(/ведение\s+объекта|рабочего\s+дня|помощник|инструмент|материал|приостанов|прекращен/.test(parts))add('WORK');
 if(/качество|скрыт|опрессов|канализац|поврежден|переделк/.test(parts))add('QUALITY');
 if(/запуск|регулиров|испытан|сдач|акт\s+сдач|паспорт\s+систем|окончательн.*оплат/.test(parts))add('HANDOVER');
 if(/гарант|сервис|повторн.*выезд/.test(parts))add('WARRANTY');
 if(/закрыти[ея]\s+объекта|экономик|пост-анализ|изменени[ея]\s+систем|верс.*sop|архивирован/.test(parts))add('IMPROVEMENTS');
 if(/\bstop\b|безопасн.*останов|инцидент|исключени[ея]\s+из\s+sop/.test(parts))add('STOP');
 return stages;
}
function knowledgeView(){
 let s='<section class="knowledge-screen" aria-label="SOP / База знаний"><div class="row knowledge-heading">'+
  '<div><h1>SOP / База знаний</h1><p class="muted">Шпаргалка для сложных и уставших моментов. Здесь нет обязательного прохождения SOP и нет блокировки заказов.</p></div>'+
  '<div class="actions"><button type="button" data-knowledge-refresh>Обновить</button>'+
  '<button type="button" class="primary" data-knowledge-new'+(knowledgeState.writeEnabled?'':' disabled')+'>+ Материал</button></div></div>';
 s+='<section class="card"><div id="knowledgeSourceInfo" class="muted" aria-live="polite">Загружаю источник SOP…</div>';
 s+='<div class="knowledge-stage-chips" role="group" aria-label="Этап SOP">'+
  knowledgeStages.map(([id,title])=>'<button type="button" data-knowledge-stage="'+id+'"'+
   (knowledgeState.stage===id?' class="active"':'')+'>'+title+'</button>').join('')+'</div>';
 s+='<label class="knowledge-stage-select-wrap">Этап SOP<select id="knowledgeStageFilter" aria-label="Этап SOP">'+
  knowledgeStages.map(([id,title])=>knowledgeOption(id,id==='ALL'?'Все этапы':title,knowledgeState.stage)).join('')+'</select></label>';
 s+='<div class="knowledge-filters"><label class="knowledge-search-wide">Поиск'+
  '<input type="search" id="knowledgeSearchInput" placeholder="Например: стояк, гарантия, запуск, помощник, STOP" value="'+knowledgeEsc(knowledgeState.query)+'"></label>'+
  '<label>Тип<select id="knowledgeTypeFilter">'+
  [['ALL','Все'],['SOP','SOP'],['CHECKLIST','Чек-листы'],['RULE','Правила'],['STANDARD','Стандарты'],['EXPERIENCE','Опыт'],['REFERENCE','Справка']]
   .map(([id,title])=>knowledgeOption(id,title,knowledgeState.type)).join('')+'</select></label>'+
  '<label>Статус<select id="knowledgeStatusFilter">'+
  [['active','Действующие'],['draft','Черновики'],['archived','Архив'],['ALL','Все']]
   .map(([id,title])=>knowledgeOption(id,title,knowledgeState.status)).join('')+'</select></label>'+
  '<label class="knowledge-favorite-label"><input id="knowledgeFavoritesOnly" type="checkbox"'+
  (knowledgeState.favoritesOnly?' checked':'')+'> Только ★</label></div>'+
  '<div id="knowledgeResultSummary" class="muted" aria-live="polite"></div></section>'+
  '<div id="knowledgeList" class="knowledge-list" aria-live="polite">'+
  '<p class="muted">Загружаю SOP и базу знаний…</p></div>'+
  '<dialog id="knowledgeDialog" class="knowledge-dialog" aria-label="Материал SOP"></dialog></section>';
 return s;
}
function knowledgeVisibleItems(){
 const needle=knowledgeState.query.trim().toLowerCase();
 return knowledgeState.items.filter(item=>
  (knowledgeState.type==='ALL'||String(item.type)===knowledgeState.type)&&
  (knowledgeState.status==='ALL'||String(item.status)===knowledgeState.status)&&
  (!knowledgeState.favoritesOnly||String(item.favorite)==='true')&&
  (knowledgeState.stage==='ALL'||knowledgeStageKeys(item).includes(knowledgeState.stage))&&
  (!needle||[item.code,item.title,item.sectionPath,item.summary,item.fullText,item.tags,item.sourceName]
   .map(x=>String(x||'').toLowerCase()).join('\n').includes(needle)));
}
function knowledgeRefreshResults(){
 const root=document.querySelector('.knowledge-screen'),list=root?.querySelector('#knowledgeList');
 if(!list)return;
 root.querySelectorAll('[data-knowledge-stage]').forEach(el=>el.classList.toggle('active',el.dataset.knowledgeStage===knowledgeState.stage));
 const select=root.querySelector('#knowledgeStageFilter');
 if(select&&select.value!==knowledgeState.stage)select.value=knowledgeState.stage;
 const meta=knowledgeState.meta||{},source=root.querySelector('#knowledgeSourceInfo');
 source.innerHTML='<strong>'+knowledgeEsc(meta.sourceName||'SOP / База знаний')+'</strong>'+
  (meta.sourceVersion?' · '+knowledgeEsc(meta.sourceVersion):'')+
  '<div>'+knowledgeEsc(String(meta.detailedSopCards||0))+' подробных SOP-карточек из подтверждённого источника · '+
  knowledgeEsc(String(meta.totalSeedItems||knowledgeState.items.length))+
  ' стартовых материалов. Редактирование не меняет WorkOrder автоматически.</div>'+
  (!knowledgeState.writeEnabled?'<div role="status">Источник переноса ещё не принят. Создание, изменение и избранное заблокированы.</div>':'');
 if(knowledgeState.error){list.innerHTML='<div class="card" role="alert">'+knowledgeEsc(knowledgeState.error)+'</div>';return;}
 if(!knowledgeState.loaded){list.innerHTML='<p class="muted">Загружаю SOP и базу знаний…</p>';return;}
 const items=knowledgeVisibleItems();
 root.querySelector('#knowledgeResultSummary').textContent=
  (knowledgeState.stage==='ALL'?'Все этапы':knowledgeNames[knowledgeState.stage])+
  ' · показано '+items.length+' из '+knowledgeState.items.length;
 if(!items.length){list.innerHTML='<div class="card">Ничего не найдено. Измени этап, поиск/фильтры или добавь новый материал.</div>';return;}
 const groups=new Map();
 for(const item of items){
  const stage=knowledgeState.stage==='ALL'?knowledgeStageKeys(item)[0]||'OTHER':knowledgeState.stage;
  if(!groups.has(stage))groups.set(stage,[]);
  groups.get(stage).push(item);
 }
 const keys=[...groups.keys()].sort((a,b)=>{
  const order=knowledgeStages.slice(1).map(x=>x[0]);
  return (order.indexOf(a)<0?999:order.indexOf(a))-(order.indexOf(b)<0?999:order.indexOf(b));
 });
 list.innerHTML=keys.map(stage=>'<section class="knowledge-stage-group">'+
  '<h2>'+knowledgeEsc(knowledgeNames[stage]||'Справка')+' <span>'+groups.get(stage).length+'</span></h2>'+
  groups.get(stage).map(item=>{
   const code=knowledgeDisplayCode(item.code),f=String(item.favorite)==='true';
   return '<article class="knowledge-title-row">'+
    '<button type="button" data-knowledge-open="'+knowledgeEsc(item.knowledgeId)+'">'+
    (code?'<span class="knowledge-code">'+knowledgeEsc(code)+'</span>':'')+
    '<span>'+knowledgeEsc(knowledgeDisplayTitle(item.title))+'</span><span aria-hidden="true">›</span></button>'+
    '<button type="button" data-knowledge-favorite="'+knowledgeEsc(item.knowledgeId)+'"'+
     (!knowledgeState.writeEnabled?' disabled':'')+
     ' aria-label="'+(f?'Убрать из избранного':'Добавить в избранное')+'">'+(f?'★':'☆')+'</button></article>';
  }).join('')+'</section>').join('');
}
async function knowledgeLoad(force=false){
 if(knowledgeState.loading||knowledgeState.loaded&&!force)return;
 knowledgeState.loading=true;knowledgeState.error='';
 knowledgeRefreshResults();
 try{
  const result=await api('/api/knowledge');
  knowledgeState.items=Array.isArray(result.items)?result.items:[];
  knowledgeState.meta=result.sourceMeta||{};
  knowledgeState.writeEnabled=result.writeEnabled===true;
  knowledgeState.phase=result.authority||'LEGACY';
  knowledgeState.loaded=true;
 }catch(e){knowledgeState.error='Не удалось загрузить SOP / базу знаний. '+e.message;knowledgeState.loaded=true;}
 finally{
  knowledgeState.loading=false;
  if(tab==='knowledge'){render();}
 }
}
function knowledgeMount(){if(!knowledgeState.loaded&&!knowledgeState.loading)void knowledgeLoad();else knowledgeRefreshResults();}
function knowledgeItem(id){return knowledgeState.items.find(x=>String(x.knowledgeId)===String(id));}
function knowledgeOpenDialog(html){
 const dlg=document.querySelector('#knowledgeDialog');
 if(!dlg)return;
 if(dlg.open)dlg.close();
 dlg.innerHTML='<div class="knowledge-dialog-inner">'+
  '<button type="button" class="knowledge-dialog-close" data-knowledge-close aria-label="Закрыть окно">×</button>'+html+'</div>';
 dlg.showModal();
 dlg.querySelector('button')?.focus({preventScroll:true});
}
function knowledgeDetail(id){
 const item=knowledgeItem(id);
 if(!item){message('Материал не найден. Обнови SOP-базу.',true);return;}
 const meta='<div class="knowledge-detail-meta">'+
  '<div><strong>Тип</strong><br>'+knowledgeEsc(item.type)+'</div>'+
  '<div><strong>Статус</strong><br>'+knowledgeEsc(item.status)+'</div>'+
  '<div><strong>Этап</strong><br>'+knowledgeEsc(knowledgeStageKeys(item).map(k=>knowledgeNames[k]).join(' · ')||'Справка')+'</div>'+
  '<div><strong>Версия / источник</strong><br>'+knowledgeEsc(item.version||'—')+
  (item.sourceVersion?' · источник '+knowledgeEsc(item.sourceVersion):'')+'</div></div>';
 knowledgeOpenDialog('<h2>'+knowledgeEsc((knowledgeDisplayCode(item.code)?item.code+' · ':'')+knowledgeDisplayTitle(item.title))+'</h2>'+meta+
  (item.summary?'<section class="card"><strong>Коротко</strong><div>'+knowledgeEsc(item.summary)+'</div></section>':'')+
  '<div class="knowledge-full-text">'+knowledgeEsc(item.fullText||'Текст пока не заполнен.')+'</div>'+
  (item.tags?'<p class="muted">Теги: '+knowledgeEsc(item.tags)+'</p>':'')+
  '<div class="actions"><button type="button" data-knowledge-favorite="'+knowledgeEsc(item.knowledgeId)+'"'+
   (knowledgeState.writeEnabled?'':' disabled')+'>'+(String(item.favorite)==='true'?'★ В избранном':'☆ В избранное')+'</button>'+
  '<button type="button" class="primary" data-knowledge-edit="'+knowledgeEsc(item.knowledgeId)+'"'+
   (knowledgeState.writeEnabled?'':' disabled')+'>Редактировать</button></div>');
}
function knowledgeEditor(id=''){
 if(!knowledgeState.writeEnabled){message('Запись SOP недоступна до подтверждения миграции.',true);return;}
 const item=id?knowledgeItem(id):null;
 if(id&&!item){message('Материал не найден.',true);return;}
 const row=item||{status:'active',type:'REFERENCE',priority:'MEDIUM',favorite:'false'};
 const input=(name,title,max,extra='')=>'<label'+(extra?' class="'+extra+'"':'')+'>'+title+
  '<input name="'+name+'" value="'+knowledgeEsc(row[name]||'')+'" maxlength="'+max+'"'+
  (name==='title'?' required':'')+'></label>';
 const select=(name,label,choices)=>'<label>'+label+'<select name="'+name+'">'+
  choices.map(([a,b])=>knowledgeOption(a,b,row[name])).join('')+'</select></label>';
 const textarea=(name,label,max)=>'<label class="wide">'+label+'<textarea name="'+name+
  '" maxlength="'+max+'">'+knowledgeEsc(row[name]||'')+'</textarea></label>';
 const html='<h2>'+(id?'Редактировать материал':'Новый материал')+'</h2>'+
  '<form id="knowledgeEditForm" class="knowledge-editor-grid" data-knowledge-form>'+
  '<input type="hidden" name="knowledgeId" value="'+knowledgeEsc(row.knowledgeId||'')+'">'+
  select('type','Тип',[['SOP','SOP'],['CHECKLIST','Чек-лист'],['RULE','Правило'],['STANDARD','Стандарт'],['EXPERIENCE','Опыт'],['REFERENCE','Справка']])+
  select('status','Статус',[['active','Действует'],['draft','Черновик'],['archived','Архив']])+
  input('code','Код',80)+input('version','Версия',60)+
  input('title','Название',300,'wide')+input('sectionPath','Раздел / путь',300,'wide')+
  select('priority','Приоритет',[['LOW','Низкий'],['MEDIUM','Средний'],['HIGH','Высокий'],['CRITICAL','Критический']])+
  select('favorite','Избранное',[['false','Нет'],['true','Да']])+
  textarea('summary','Коротко',2000)+textarea('fullText','Полный текст',49000)+
  input('tags','Теги',1000,'wide')+
  '<input type="hidden" name="sourceName" value="'+knowledgeEsc(row.sourceName||'')+'">'+
  '<input type="hidden" name="sourceVersion" value="'+knowledgeEsc(row.sourceVersion||'')+'">'+
  '<input type="hidden" name="sortOrder" value="'+knowledgeEsc(row.sortOrder||0)+'">'+
  '<div class="actions wide"><button type="button" data-knowledge-close>Отмена</button>'+
  '<button type="submit" class="primary">'+(id?'Сохранить':'Создать')+'</button></div></form>';
 knowledgeOpenDialog(html);
}
async function knowledgeSubmit(form){
 if(!knowledgeState.writeEnabled)return;
 const button=form.querySelector('button[type="submit"]');
 const payload=Object.fromEntries(new FormData(form));
 const requestKey=form.dataset.requestKey||crypto.randomUUID();
 form.dataset.requestKey=requestKey;
 button.disabled=true;button.textContent='Сохраняю…';
 try{
  await api('/api/knowledge/save',{payload,requestKey});
  document.querySelector('#knowledgeDialog')?.close();
  knowledgeState.loaded=false;await knowledgeLoad(true);
  message(payload.knowledgeId?'Материал обновлён.':'Материал создан.');
 }catch(e){message('Не удалось сохранить SOP: '+e.message,true);}
 finally{if(button.isConnected){button.disabled=false;button.textContent=payload.knowledgeId?'Сохранить':'Создать';}}
}
async function knowledgeFavorite(id){
 if(!knowledgeState.writeEnabled)return;
 const item=knowledgeItem(id);
 if(!item)return;
 let pending=knowledgeState.pendingFavorites.get(id);
 if(!pending){
  pending={requestKey:crypto.randomUUID(),
   payload:{...item,favorite:String(item.favorite)==='true'?'false':'true'}};
  knowledgeState.pendingFavorites.set(id,pending);
 }
 try{
  await api('/api/knowledge/save',pending);
  knowledgeState.pendingFavorites.delete(id);
  knowledgeState.loaded=false;await knowledgeLoad(true);
  const dlg=document.querySelector('#knowledgeDialog');
  if(dlg?.open&&knowledgeItem(id))knowledgeDetail(id);
 }catch(e){message('Результат избранного не подтверждён. Обнови SOP; повтор использует прежний ключ. '+e.message,true);}
}
document.addEventListener('click',e=>{
 const t=e.target.closest('[data-knowledge-refresh],[data-knowledge-stage],[data-knowledge-open],'+
  '[data-knowledge-new],[data-knowledge-edit],[data-knowledge-favorite],[data-knowledge-close]');
 if(!t)return;
 e.preventDefault();
 if(t.hasAttribute('data-knowledge-refresh')){void knowledgeLoad(true);return;}
 if(t.hasAttribute('data-knowledge-stage')){knowledgeState.stage=t.dataset.knowledgeStage;knowledgeRefreshResults();return;}
 if(t.hasAttribute('data-knowledge-open')){knowledgeDetail(t.dataset.knowledgeOpen);return;}
 if(t.hasAttribute('data-knowledge-new')){knowledgeEditor();return;}
 if(t.hasAttribute('data-knowledge-edit')){document.querySelector('#knowledgeDialog')?.close();knowledgeEditor(t.dataset.knowledgeEdit);return;}
 if(t.hasAttribute('data-knowledge-favorite')){void knowledgeFavorite(t.dataset.knowledgeFavorite);return;}
 if(t.hasAttribute('data-knowledge-close'))document.querySelector('#knowledgeDialog')?.close();
});
document.addEventListener('input',e=>{
 if(e.target?.id==='knowledgeSearchInput'){knowledgeState.query=e.target.value;knowledgeRefreshResults();}
 if(e.target?.closest?.('[data-knowledge-form]'))delete e.target.closest('form').dataset.requestKey;
});
document.addEventListener('change',e=>{
 const id=e.target?.id;
 const fields={knowledgeStageFilter:'stage',knowledgeTypeFilter:'type',
  knowledgeStatusFilter:'status',knowledgeFavoritesOnly:'favoritesOnly'};
 if(fields[id]){knowledgeState[fields[id]]=id==='knowledgeFavoritesOnly'?e.target.checked:e.target.value;knowledgeRefreshResults();}
});
document.addEventListener('submit',e=>{
 if(!e.target.matches('[data-knowledge-form]'))return;
 e.preventDefault();void knowledgeSubmit(e.target);
});
