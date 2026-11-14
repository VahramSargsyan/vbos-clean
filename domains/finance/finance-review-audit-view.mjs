/** Read-only timeline of REVIEWED / ARCHIVED / UNREVIEWED owner decisions. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const modes={finance:new Set(['FINANCE_TRANSACTION','BUSINESS_MONTHLY_GAIN']),
 capital:new Set(['CAPITAL_FUND','CAPITAL_ALLOCATION_BATCH','CAPITAL_FUND_TRANSACTION'])};
const state={UNREVIEWED:'Не разобрано',REVIEWED:'Проверено',ARCHIVED:'В архиве'};
const validCursor=x=>typeof x==='string'&&/^[1-9][0-9]{0,18}$/.test(x);
function time(value){
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))throw Error('REVIEW_AUDIT_INVALID_DATE');
 return date.toLocaleString('ru-RU',{timeZone:'Asia/Yerevan',year:'numeric',
  month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
}
export function financeReviewAuditRowsHtml(payload,{mode='finance'}={}){
 if(!modes[mode]||payload?.source!=='VERIFIED_FINANCE_REVIEW_AUDIT'||
  payload.readonly!==true||payload.financialWriter!=='GOOGLE'||payload.moneyAffected!==false||
  payload.mode!==mode||!Array.isArray(payload.events)||payload.events.length>20||
  typeof payload.hasMore!=='boolean'||(payload.hasMore&&!validCursor(payload.nextCursor)))
  throw Error('Журнал отметок не прошёл проверку источника');
 if(payload.events.length===0)return '<p class="muted">Пока нет отметок проверки или архивирования.</p>';
 return payload.events.map(event=>{
  if(!modes[mode].has(event.sourceKind)||!validCursor(event.eventId)||
     typeof event.sourceId!=='string'||!state[event.previousState]||!state[event.nextState]||
     event.previousState===event.nextState||
     !Number.isSafeInteger(event.revision)||event.revision<1||
     typeof event.actorLogin!=='string')
    throw Error('Неверное событие журнала отметок');
  const transition=esc(state[event.previousState])+' → <strong>'+esc(state[event.nextState])+'</strong>';
  return '<article class="record">'+
   '<strong>'+esc(event.originalTitle||event.sourceId)+'</strong>'+
   '<p class="small muted">'+esc(time(event.recordedAt))+' · версия '+event.revision+
   ' · автор: '+esc(event.actorLogin)+'</p>'+
   '<p>'+transition+'</p>'+
   '<p class="small muted">ID источника: '+esc(event.sourceId)+
   ' · вид: '+esc(event.sourceKind)+'</p></article>';
 }).join('');
}
export function mountFinanceReviewAuditPanel(root,{mode,fetchPage}={}){
 if(!root||typeof root.addEventListener!=='function'||!modes[mode]||
  typeof fetchPage!=='function')throw Error('REVIEW_AUDIT_VIEW_UNCONFIGURED');
 let active=true,seq=0,busy=false,events=[],hasMore=false,nextCursor=null,error='',loaded=false;
 function draw(){
  if(!active)return;
  const page={source:'VERIFIED_FINANCE_REVIEW_AUDIT',readonly:true,
   financialWriter:'GOOGLE',moneyAffected:false,mode,events,hasMore,nextCursor};
  root.innerHTML='<h2>Журнал отметок проверки</h2>'+
   '<p class="muted">Кто и когда отмечал запись как проверенную, переносил в архив списка или снимал отметку. Только история действий; финансовые операции и суммы не изменяются.</p>'+
   (error?'<p role="alert">'+esc(error)+'</p>':'')+
   (loaded?financeReviewAuditRowsHtml(page,{mode}):'')+
   (busy?'<p role="status">Загрузка журнала…</p>':'')+
   '<div class="actions">'+
   (hasMore?'<button type="button" data-review-audit-more'+(busy?' disabled':'')+'>Показать ещё</button>':'')+
   '<button type="button" data-review-audit-reload'+(busy?' disabled':'')+'>Обновить журнал</button></div>';
 }
 async function load(reset=false){
  if(!active||busy)return;
  const n=++seq;busy=true;error='';
  if(reset){events=[];hasMore=false;nextCursor=null;loaded=false;}
  draw();
  try{
   const params=new URLSearchParams({mode,limit:'10'});
   if(nextCursor&&!reset)params.set('cursor',nextCursor);
   const result=await fetchPage('/api/finance/review-audit?'+params);
   if(!active||n!==seq)return;
   financeReviewAuditRowsHtml(result,{mode});
   const known=new Set(events.map(x=>x.eventId));
   if(result.events.some(x=>known.has(x.eventId)))
    throw Error('Повтор событий журнала отметок');
   events=[...events,...result.events];
   hasMore=result.hasMore;nextCursor=result.nextCursor;loaded=true;
  }catch(e){if(active&&n===seq)error=String(e?.message||'Не удалось прочитать журнал');}
  finally{if(active&&n===seq){busy=false;draw();}}
 }
 const onClick=e=>{
  if(e.target?.closest?.('[data-review-audit-reload]')){void load(true);return;}
  if(e.target?.closest?.('[data-review-audit-more]')&&hasMore){void load(false);}
 };
 root.addEventListener('click',onClick);
 void load(true);
 return {unmount(){active=false;seq++;root.removeEventListener('click',onClick);}};
}
