/**
 * Capital P2: native fund cockpit + full keyset read, separate from immutable
 * Google archive and existing B18 gated POST controls (never posts directly).
 */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const fmt=x=>{
 const n=Number(x);
 return Number.isFinite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:2})+' AMD':'—';
};
const names={
 OPERATING_RESERVE:'Операционный резерв',WARRANTY_RESERVE:'Гарантийный резерв',
 MARKETING_SALES:'Маркетинг и продажи',PEOPLE_TRAINING:'Обучение работников',
 TOOLS_CREW_KITS:'Инструменты и оснащение',RND_MATERIALS:'Материалы и исследования',
 DIGITAL_AI_VBOS:'Цифровизация и VBOS',INFRASTRUCTURE:'Инфраструктура'
};
// P5: legacy seed reference, not persisted user settings. Source: CapitalService.js, fe418f762011464cba0728af7ceda0c16abd5577.
const purposes={
 OPERATING_RESERVE:'Зарплаты, простой, кассовые разрывы, задержки оплаты и форс-мажоры.',
 WARRANTY_RESERVE:'Диагностика, гарантийные выезды, исправления и подтверждённые обязательства.',
 MARKETING_SALES:'Реклама, сайт, кейсы, контент, партнёрства и источники лидов.',
 PEOPLE_TRAINING:'Пробные дни, обучение помощников, экзамены, допуски и наставничество.',
 TOOLS_CREW_KITS:'Стандартизированное оснащение бригад, эргономика и контрольный инструмент.',
 RND_MATERIALS:'Испытания труб, фитингов, шлангов, технологий, протоколы и стенды.',
 DIGITAL_AI_VBOS:'AI, ПО, облако, домены, автоматизация, аналитика и данные.',
 INFRASTRUCTURE:'Training Lab, склад, мастерская, стеллажи, крупные стенды и будущая база.'
};
const statusName={active:'Активен',paused:'Приостановлен',archived:'Архив'};
const types=[['','Все движения'],['ALLOCATION','Распределение'],
 ['TRANSFER','Перевод'],['SPEND','Расход'],['REVERSAL','Сторно']];
const states=[['','Все статусы'],['active','Активные'],['reversed','Сторнированные']];
const zero=()=>({fundId:'',movementType:'',status:'',dateFrom:'',dateTo:''});
function entry(label,val,desc){
 return '<article class="capital-p2-total"><span>'+esc(label)+'</span>'+
  '<strong>'+esc(fmt(val))+'</strong><small>'+esc(desc)+'</small></article>';
}
function line(label,val){
 return '<div class="capital-p2-detail-line"><span>'+esc(label)+'</span><strong>'+
  esc(fmt(val))+'</strong></div>';
}
function choices(values,selected){
 return values.map(([key,label])=>'<option value="'+esc(key)+'"'+
  (key===selected?' selected':'')+'>'+esc(label)+'</option>').join('');
}
function fundCard(f){
 const name=names[f.code]||f.code;
 const goal=Number(f.targetBase)>0;
 const progress=goal?Math.max(0,Math.min(100,Number(f.targetProgressPct)||0)):null;
 return '<details class="capital-p2-fund" data-capital-p2-fund="'+esc(f.id)+'">'+
  '<summary><div class="capital-p2-fund-title"><strong>'+esc(name)+'</strong>'+
  '<small>'+esc(f.code)+' · '+esc(statusName[f.status]||f.status)+' · '+(f.groupType==='PROTECTIVE'?'Защитный':'Рост')+'</small>'+
  '</div><span class="capital-p2-fund-balance">'+esc(fmt(f.balanceBase))+'</span></summary>'+
  '<div class="capital-p2-fund-detail">'+
  (goal?'<p class="small">Цель '+esc(fmt(f.targetBase))+' · выполнено '+esc(f.targetProgressPct)+'%</p>'+
   '<div class="capital-p2-progress" role="progressbar" aria-label="'+esc(name)+'" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+esc(progress)+'"><div style="width:'+esc(progress)+'%"></div></div>':
   '<p class="small muted">Цель в PostgreSQL не задана; процент заполнения не рассчитывается.</p>')+
  '<p class="small muted">Доля распределения: '+esc(f.groupType==='PROTECTIVE'?15:f.allocationSharePct)+'%'+(f.groupType==='PROTECTIVE'?' базово, до цели':' от капитала роста')+'.</p>'+
  (Object.hasOwn(purposes,f.code)?'<p class="small">Назначение по исходному стандарту: '+esc(purposes[f.code])+'</p>':'')+
  '<p class="small muted">Настройки фонда только для просмотра; баланс меняется через движения.</p>'+
  line('Начальное состояние 30.09.2026',f.openingBase)+
  line('Получено распределением',f.allocatedBase)+
  line('Получено переводами',f.transferredInBase)+
  line('Переведено в другие фонды',f.transferredOutBase)+
  line('Израсходовано из фонда',f.spentBase)+
  line('Поправка сторно (со знаком)',f.reversalNetBase)+
  line('Изменение после открытия',f.nativeDeltaBase)+
  '<button type="button" data-capital-p2-select-fund="'+esc(f.id)+'">История этого фонда</button>'+
  '</div></details>';
}
function movementCard(row){
 const kind=Object.fromEntries(types)[row.type]||row.type;
 const direction=row.type==='TRANSFER'?
  (row.fromCode||'—')+' → '+(row.toCode||'—'):
  row.type==='SPEND'?'Из '+(row.fromCode||'—'):
  row.type==='ALLOCATION'?'В '+(row.toCode||'—'):
  'Сторно предыдущего движения';
 const detail=(row.effects||[]).map(f=>'<span>'+esc(f.fundCode)+' '+
  esc((String(f.deltaBase).startsWith('-')?'':'+' )+fmt(f.deltaBase))+'</span>').join(' · ');
 return '<article class="capital-p2-movement"><div class="capital-p2-movement-head">'+
  '<strong>'+esc(kind)+'</strong><strong>'+esc(fmt(row.amountBase))+'</strong></div>'+
  '<p class="small muted">'+esc(row.date)+' · '+esc(row.status==='reversed'?'Сторнировано':'Активно')+'</p>'+
  '<p class="small">'+esc(direction)+'</p>'+
  '<p class="small muted">Эффект по фондам: '+detail+'</p>'+
  (row.reversalOf?'<p class="small muted">Сторнирует операцию '+esc(row.reversalOf)+'</p>':'')+
  '<small class="muted">PostgreSQL · '+esc(row.id)+'</small></article>';
}
export function nativeCapitalP2Html({data,items=[],filters=zero(),loading=false,error='' }={}){
 if(data&&(data.version!=='CAPITAL_P2_NATIVE_OVERVIEW_V1'||
    data.source!=='CLEAN_NATIVE_POST_CUTOVER_ONLY'||data.readonly!==true||
    data.historicalIncluded!==false||data.postingEnabled!==true||
    !Array.isArray(data.funds)||data.funds.length!==8))
  throw Error('CAPITAL_P2_UNVERIFIED_SOURCE');
 const group=g=>(data?.funds||[]).filter(f=>f.groupType===g).map(fundCard).join('');
 const total=data?.summary;
 const summary=total?
  '<div class="capital-p2-totals" aria-label="Нативный капитал PostgreSQL">'+
  entry('Всего в фондах',total.totalReservedBase,'Восемь фондов, включая начальные остатки')+
  entry('Защитные фонды',total.protectiveBase,'Только группа PROTECTIVE')+
  entry('Фонды роста',total.growthBase,'Только группа GROWTH')+'</div>'+
  '<p class="small muted">Начальные остатки: '+esc(fmt(total.openingBase))+
  '. Движение новых операций: '+esc(fmt(total.nativeDeltaBase))+
  '. Эти суммы не складываются с историческим архивом Google.</p>':
  '<p role="status">Проверка нативного источника капитала…</p>';
 const funds=data?
  '<section class="capital-p2-groups" aria-label="Восемь фондов">'+
   '<div><h3>Защитные фонды</h3>'+group('PROTECTIVE')+'</div>'+
   '<div><h3>Фонды роста</h3>'+group('GROWTH')+'</div></section>':'';
 const selectFund='<option value="">Все фонды</option>'+
  (data?.funds||[]).map(f=>'<option value="'+esc(f.id)+'"'+
  (filters.fundId===f.id?' selected':'')+'>'+esc(names[f.code]||f.code)+'</option>').join('');
 const filterUi='<form data-capital-p2-filters class="capital-p2-filters" autocomplete="off">'+
  '<label>Фонд<select name="fundId">'+selectFund+'</select></label>'+
  '<label>Движение<select name="movementType">'+choices(types,filters.movementType)+'</select></label>'+
  '<label>Статус<select name="status">'+choices(states,filters.status)+'</select></label>'+
  '<label>С даты<input type="date" name="dateFrom" value="'+esc(filters.dateFrom)+'"></label>'+
  '<label>По дату<input type="date" name="dateTo" value="'+esc(filters.dateTo)+'"></label>'+
  '<div class="capital-p2-filter-actions"><button class="primary" type="submit"'+(loading?' disabled':'')+
  '>Применить</button><button type="button" data-capital-p2-reset'+(loading?' disabled':'')+
  '>Сбросить</button></div></form>';
 const records=items.length?items.map(movementCard).join(''):
  data&&!loading?'<p class="muted">Нет движений по выбранным фильтрам.</p>':'';
 return '<section class="capital-p2-root">'+
  '<h2>Текущий капитал · PostgreSQL</h2>'+
  '<p class="small muted">Нативные фонды и движения. Старый капитал Google отображается отдельно ниже как архив.</p>'+
  '<div class="capital-p2-actions" aria-label="Операции с капиталом">'+
  '<button type="button" disabled aria-describedby="capital-p5-allocation-blocked">+ Распределить капитал</button>'+
  '<button type="button" data-capital-p2-action="transfer">Переместить между фондами</button>'+
  '<button type="button" data-capital-p2-action="spend">Расход из фонда</button></div>'+
  '<p id="capital-p5-allocation-blocked" class="small muted">Ручное распределение пока недоступно: источник суммы требует согласования. Инвестиция владельца в Finance распределяется автоматически.</p>'+
  '<p role="status" data-capital-p2-action-status class="small"></p>'+
  '<h3>Обзор</h3><p class="small muted">Это управленческое распределение капитала, а не список банковских счетов.</p>'+
  summary+funds+
  '<details class="capital-p2-history" open><summary><strong>История новых движений фондов</strong></summary>'+
  '<button type="button" data-capital-p2-action="reverse">Сторнировать</button>'+
  '<p class="small muted">Сторно доступно для перевода или расхода в существующем списке последних 50 движений. Связанное инвестиционное распределение защищено.</p>'+
  filterUi+
  (error?'<p role="alert">'+esc(error)+'</p>':'')+
  '<div class="capital-p2-records" aria-live="polite">'+records+'</div>'+
  (data?.hasMore?'<button type="button" data-capital-p2-more'+(loading?' disabled':'')+
   '>Показать ещё</button>':'')+'</details>'+
  '<details class="capital-p2-history"><summary><strong>Как работает капитал</strong></summary>'+
  '<p>15% — операционный резерв, 15% — гарантийный резерв, 70% — фонды роста. Защитные фонды получают средства до цели; освобождённая доля идёт в активные фонды роста. Доли приостановленных фондов перераспределяются.</p>'+
  '<p class="small muted">Баланс фонда вручную не редактируется.</p></details></section>';
}
export function mountNativeCapitalP2(root,{fetchPage,onAction}={}){
 if(!root||typeof root.addEventListener!=='function'||typeof fetchPage!=='function'||
   typeof onAction!=='function')throw Error('CAPITAL_P2_MOUNT_NOT_CONFIGURED');
 let active=true,busy=false,queued=false,data=null,items=[],filters=zero(),error='',sequence=0;
 const render=()=>{
  if(!active)return;
  // Preserve open fund details during a refresh, including mobile scroll state.
  const opened=new Set();
  for(const d of root.querySelectorAll?.('[data-capital-p2-fund][open]')||[])
   opened.add(d.getAttribute('data-capital-p2-fund'));
  root.innerHTML=nativeCapitalP2Html({data,items,filters,loading:busy,error});
  for(const id of opened){
   const d=[...(root.querySelectorAll?.('[data-capital-p2-fund]')||[])]
    .find(x=>x.getAttribute('data-capital-p2-fund')===id);
   if(d)d.open=true;
  }
 };
 const load=async(more=false)=>{
  if(!active)return;
  if(busy){if(!more)queued=true;return;}
  busy=true;error='';const order=++sequence;render();
  try{
   const params=new URLSearchParams({limit:'20'});
   for(const [k,v] of Object.entries(filters))if(v)params.set(k,v);
   if(more&&data?.nextCursor)params.set('cursor',data.nextCursor);
   const result=await fetchPage('/api/capital/native-overview-history?'+params);
   if(!active||order!==sequence)return;
   if(result?.version!=='CAPITAL_P2_NATIVE_OVERVIEW_V1'||
     result.source!=='CLEAN_NATIVE_POST_CUTOVER_ONLY'||
     result.readonly!==true||result.historicalIncluded!==false||
     result.postingEnabled!==true||!Array.isArray(result.funds)||
     result.funds.length!==8||!Array.isArray(result.items)||!result.summary)
    throw Error('Нативный капитал не подтверждён PostgreSQL.');
   const ids=new Set(more?items.map(x=>x.id):[]);
   items=more?[...items,...result.items.filter(x=>!ids.has(x.id))]:result.items;
   data=result;
  }catch(e){if(active&&order===sequence)error=String(e?.message||'Не удалось загрузить капитал.');}
  finally{
   if(active&&order===sequence){
    busy=false;render();
    if(queued){queued=false;void load(false);}
   }
  }
 };
 const click=e=>{
  const b=e.target?.closest?.('button');if(!b||!active)return;
  const action=b.getAttribute('data-capital-p2-action');
  if(action){
   const ok=onAction(action);
   if(!ok){
    const target=root.querySelector('[data-capital-p2-action-status]');
    if(target)target.textContent='Действие пока недоступно. Проверь загрузку форм PostgreSQL ниже.';
   }
   return;
  }
  if(b.hasAttribute('data-capital-p2-select-fund')){
   const id=b.getAttribute('data-capital-p2-select-fund');
   if(!data?.funds?.some(f=>f.id===id))return;
   filters={...filters,fundId:id};items=[];data=null;void load(false);
   root.querySelector('.capital-p2-history')?.scrollIntoView?.({block:'start'});
   return;
  }
  if(b.hasAttribute('data-capital-p2-reset')){
   filters=zero();items=[];data=null;void load(false);return;
  }
  if(b.hasAttribute('data-capital-p2-more')&&data?.nextCursor)void load(true);
 };
 const submit=e=>{
  const form=e.target;
  if(!form?.hasAttribute?.('data-capital-p2-filters'))return;
  e.preventDefault();if(busy)return;
  const values=Object.fromEntries(new FormData(form));
  filters=Object.fromEntries(Object.keys(filters).map(k=>[k,String(values[k]||'').trim()]));
  items=[];data=null;void load(false);
 };
 root.addEventListener('click',click);
 root.addEventListener('submit',submit);
 void load(false);
 return {
  load:()=>load(false),
  unmount:()=>{active=false;sequence++;root.removeEventListener('click',click);
   root.removeEventListener('submit',submit);}
 };
}
