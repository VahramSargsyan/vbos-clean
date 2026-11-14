/**
 * Manual, reversible visual classification of financial HISTORY, not an accounting action.
 * Source statuses, amounts, workOrder/client links remain unchanged.
 */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stateLabel={UNREVIEWED:'Не разобрано',REVIEWED:'Проверено',ARCHIVED:'В архиве'};
const label={FINANCE_TRANSACTION:'Операция',BUSINESS_MONTHLY_GAIN:'Доход месяца',
 CAPITAL_FUND:'Фонд',CAPITAL_ALLOCATION_BATCH:'Пакет распределения',CAPITAL_FUND_TRANSACTION:'Движение капитала'};
const groupKind={finance:new Set(['FINANCE_TRANSACTION','BUSINESS_MONTHLY_GAIN']),
 capital:new Set(['CAPITAL_FUND','CAPITAL_ALLOCATION_BATCH','CAPITAL_FUND_TRANSACTION'])};
const sum=x=>{const n=Number(x);return Number.isFinite(n)?n.toLocaleString('ru-RU',{maximumFractionDigits:2})+' AMD':'';};
export function reviewRowsHtml(payload,{mode='finance',filter='INBOX'}={}){
 if(!groupKind[mode]||payload?.source!=='VERIFIED_FINANCE_REVIEW_OVERLAY'||
  payload.readonlySource!==true||payload.financialWriter!=='GOOGLE'||payload.moneyAffectedByArchive!==false||
  !Array.isArray(payload.items)||payload.total!==42)
  throw Error('Не удалось подтвердить исходную историю');
 const items=payload.items.filter(r=>groupKind[mode].has(r.sourceKind));
 const shown=items.filter(r=>filter==='ALL'||(filter==='INBOX'?r.reviewState!=='ARCHIVED':r.reviewState===filter));
 const opts=[['INBOX','Не в архиве'],['ARCHIVED','В архиве'],['REVIEWED','Проверено'],['UNREVIEWED','Не разобрано'],['ALL','Все']];
 const options=opts.map(([k,text])=>'<option value="'+k+'"'+(k===filter?' selected':'')+'>'+text+'</option>').join('');
 const counts='<p class="small muted">Записей: '+items.length+' · В архиве: '+items.filter(r=>r.reviewState==='ARCHIVED').length+
  ' · Проверено: '+items.filter(r=>r.reviewState==='REVIEWED').length+'</p>';
 return '<h2>Ручная разборка истории</h2>'+
  '<p class="muted"><strong>Архив — только отметка для списка.</strong> Она скрывает запись из обычного списка разборки и обратима. '+
  'Исходная финансовая операция, её статус, сумма, баланс, налоговые и долговые показатели не меняются. '+
  'Это не удаление и не признание платежа.</p>'+
  counts+'<label>Показать <select data-review-filter>'+options+'</select></label>'+
  (shown.length?shown.map(r=>{
   const name=esc(r.title||r.sourceId),id=esc(r.sourceId),kind=esc(r.sourceKind);
   const amount=r.amountBase==null?'':' · '+esc(sum(r.amountBase));
   const buttons=(r.reviewState!=='REVIEWED'?'<button type="button" class="compact" data-review-next="REVIEWED">Проверено</button>':'')+
    (r.reviewState!=='ARCHIVED'?'<button type="button" class="compact" data-review-next="ARCHIVED">В архив</button>':'')+
    (r.reviewState!=='UNREVIEWED'?'<button type="button" class="compact" data-review-next="UNREVIEWED">Снять отметку</button>':'');
   return '<article class="record" data-review-kind="'+kind+'" data-review-id="'+id+'" data-review-revision="'+esc(r.revision)+'">'+
    '<strong>'+name+'</strong><div class="meta">'+esc(label[r.sourceKind]||r.sourceKind)+amount+'</div>'+
    '<p class="small muted">ID источника: '+id+' · Статус источника: '+esc(r.sourceStatus||'—')+
    ' · Моя отметка: '+esc(stateLabel[r.reviewState]||'—')+'</p>'+
    '<div class="actions">'+buttons+'</div></article>';
  }).join(''):'<p class="muted">Записей с выбранной отметкой нет.</p>');
}
export function mountFinanceReviewPanel(root,{mode,fetchPage,saveReview,confirmArchive}={}){
 if(!root||typeof root.addEventListener!=='function'||!groupKind[mode]||
  typeof fetchPage!=='function'||typeof saveReview!=='function')
  throw Error('FINANCE_REVIEW_UI_NOT_CONFIGURED');
 let alive=true,request=0,loading=false,busy=false,payload=null,filter='INBOX',error='';
 function draw(){
  if(!alive)return;
  let html=payload?reviewRowsHtml(payload,{mode,filter}):
   '<p class="muted">'+(loading?'Загрузка записей для разборки…':'Источник отметок недоступен.')+'</p>'+
   '<button type="button" data-review-refresh'+(loading?' disabled':'')+'>Повторить загрузку</button>';
  if(error)html='<p role="alert">'+esc(error)+'</p>'+html;
  if(busy)html='<p role="status">Сохранение отметки…</p>'+html;
  root.innerHTML=html;
  for(const btn of root.querySelectorAll?.('[data-review-next]')||[])btn.disabled=busy;
 }
 async function load(){
  if(!alive||loading)return;
  loading=true;error='';const seq=++request;draw();
  try{const res=await fetchPage('/api/finance/reviews');
   if(!alive||seq!==request)return;
   if(res?.source!=='VERIFIED_FINANCE_REVIEW_OVERLAY'||res.readonlySource!==true||
      res.moneyAffectedByArchive!==false||res.financialWriter!=='GOOGLE')throw Error('Источник разборки не подтверждён');
   payload=res;
  }catch(e){if(alive&&seq===request){payload=null;error=String(e?.message||'История недоступна');}}
  finally{if(alive&&seq===request){loading=false;draw();}}
 }
 async function change(item,next){
  if(busy||!alive)return;
  if(next==='ARCHIVED'&&typeof confirmArchive==='function'&&!confirmArchive(
    'Поместить запись в архив списка? Суммы и исходные статусы останутся без изменений.'))return;
  busy=true;error='';draw();
  try{
   const key=crypto.randomUUID();
   const result=await saveReview('/api/finance/review',{
    sourceKind:item.sourceKind,sourceId:item.sourceId,revision:item.revision,
    nextState:next,requestKey:key,...(next==='ARCHIVED'?{confirmed:'yes'}:{})
   });
   if(!alive)return;
   if(result?.saved!==true||result.sourcePreserved!==true||result.moneyAffectedByArchive!==false||
     result.financialWriter!=='GOOGLE')throw Error('Сервер не подтвердил сохранение отметки');
   // Update just the local classification, preserve the server's financial source fields.
   payload={...payload,items:payload.items.map(x=>x.sourceKind===item.sourceKind&&x.sourceId===item.sourceId?
    {...x,reviewState:result.item.reviewState,revision:result.item.revision}:x)};
   await load();
  }catch(e){if(alive)error=String(e?.message||'Отметка не сохранена');}
  finally{if(alive){busy=false;draw();}}
 }
 const onChange=e=>{if(e.target?.matches?.('[data-review-filter]')){filter=e.target.value;draw();}};
 const onClick=e=>{
  if(e.target?.closest?.('[data-review-refresh]')){if(!busy)void load();return;}
  const button=e.target?.closest?.('[data-review-next]');if(!button||!payload||busy)return;
  const parent=button.closest('[data-review-kind]');if(!parent)return;
  const item=payload.items.find(r=>r.sourceKind===parent.dataset.reviewKind&&r.sourceId===parent.dataset.reviewId);
  if(item)void change(item,button.dataset.reviewNext);
 };
 root.addEventListener('click',onClick);root.addEventListener('change',onChange);
 void load();
 return {unmount(){alive=false;request++;root.removeEventListener('click',onClick);root.removeEventListener('change',onChange);}};
}
