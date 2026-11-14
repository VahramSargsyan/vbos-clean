/**
 * Read-only owner journal of changes to Finance/Capital historical display text.
 * Original finance source, review marks and audit rows cannot be edited here.
 */
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const kinds={
 finance:new Set(['FINANCE_TRANSACTION','BUSINESS_MONTHLY_GAIN']),
 capital:new Set(['CAPITAL_FUND','CAPITAL_ALLOCATION_BATCH','CAPITAL_FUND_TRANSACTION'])
};
const value=x=>x===null||x===undefined||x===''?'—':String(x);
const viewTime=x=>{
 const d=new Date(x);
 if(!Number.isFinite(d.getTime()))throw Error('Неверная дата истории');
 return d.toLocaleString('ru-RU',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',
  day:'2-digit',hour:'2-digit',minute:'2-digit'});
};
export function correctionAuditRowsHtml(page,{mode='finance'}={}){
 if(!kinds[mode]||page?.source!=='VERIFIED_FINANCE_CORRECTION_AUDIT'||
  page.readonly!==true||page.financialWriter!=='GOOGLE'||page.moneyAffected!==false||
  page.mode!==mode||!Array.isArray(page.events)||page.events.length>20||
  typeof page.hasMore!=='boolean'||(page.hasMore&&!page.nextCursor))
  throw Error('Журнал исправлений не прошёл проверку источника');
 if(!page.events.length)return '<p class="muted">Исправлений пока не было.</p>';
 return page.events.map(event=>{
  if(!kinds[mode].has(event.sourceKind)||typeof event.sourceId!=='string'||
   !Number.isSafeInteger(event.revision)||event.revision<1)
   throw Error('Запись журнала не соответствует разделу');
  const timestamp=escapeHtml(viewTime(event.recordedAt));
  const title=escapeHtml(event.originalTitle||event.sourceId);
  const id=escapeHtml(event.sourceId);
  const actor=escapeHtml(event.actorLogin);
  const reset=event.nextTitle===null&&event.nextNote===null;
  return '<article class="record">'+
   '<strong>'+title+'</strong>'+
   '<p class="small muted">'+timestamp+' · версия '+event.revision+
   ' · автор: '+actor+' · ID: '+id+'</p>'+
   (reset?'<p><strong>Сброс пользовательского описания</strong></p>':
    '<p><strong>Изменение описания</strong></p>')+
   '<p>Название: <span class="muted">'+escapeHtml(value(event.priorTitle))+
   '</span> → <strong>'+escapeHtml(value(event.nextTitle))+'</strong></p>'+
   '<p>Комментарий: <span class="muted">'+escapeHtml(value(event.priorNote))+
   '</span> → <strong>'+escapeHtml(value(event.nextNote))+'</strong></p>'+
   '</article>';
 }).join('');
}
export function mountFinanceCorrectionAuditPanel(root,{mode,fetchPage}={}){
 if(!root||typeof root.addEventListener!=='function'||!kinds[mode]||
  typeof fetchPage!=='function')throw Error('FINANCE_CORRECTION_AUDIT_VIEW_UNCONFIGURED');
 let alive=true,request=0,busy=false,error='',events=[],nextCursor=null,hasMore=false;
 function draw(){
  if(!alive)return;
  const page={source:'VERIFIED_FINANCE_CORRECTION_AUDIT',readonly:true,
   financialWriter:'GOOGLE',moneyAffected:false,mode,events,hasMore,nextCursor};
  root.innerHTML='<h2>Журнал исправлений</h2>'+
   '<p class="muted">Кто и когда менял название или комментарий. Только чтение: суммы и источник не меняются.</p>'+
   (error?'<p role="alert">'+escapeHtml(error)+'</p>':'')+
   correctionAuditRowsHtml(page,{mode})+
   '<div class="actions">'+
   (hasMore?'<button type="button" data-audit-more'+(busy?' disabled':'')+'>Показать ещё</button>':'')+
   '<button type="button" data-audit-reload'+(busy?' disabled':'')+'>Обновить журнал</button>'+
   '</div>'+(busy?'<p role="status">Загрузка журнала…</p>':'');
 }
 async function load(reset=false){
  if(!alive||busy)return;
  busy=true;error='';const seq=++request;
  if(reset){events=[];nextCursor=null;hasMore=false;}
  draw();
  try{
   const cursor=reset?'':nextCursor;
   const params=new URLSearchParams({mode,limit:'10'});
   if(cursor)params.set('cursor',cursor);
   const result=await fetchPage('/api/finance/correction-audit?'+params.toString());
   if(!alive||seq!==request)return;
   correctionAuditRowsHtml(result,{mode});
   const known=new Set(events.map(x=>x.eventId));
   if(result.events.some(x=>known.has(x.eventId)))throw Error('Повтор записей в журнале');
   events=[...events,...result.events];
   nextCursor=result.nextCursor;hasMore=result.hasMore;
  }catch(err){
   if(alive&&seq===request)error=String(err?.message||'Не удалось загрузить журнал');
  }finally{if(alive&&seq===request){busy=false;draw();}}
 }
 const onClick=e=>{
  if(e.target?.closest?.('[data-audit-reload]')){void load(true);return;}
  if(e.target?.closest?.('[data-audit-more]')&&hasMore){void load(false);}
 };
 root.addEventListener('click',onClick);
 void load(true);
 return {unmount(){alive=false;request++;root.removeEventListener('click',onClick);}};
}
