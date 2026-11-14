/* CRM26A: archive-only old LeadTransfers view; no action that writes to any CRM entity. */
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch]);
const reasons={
 no_time:'Нет времени',not_my_specialty:'Не моя специализация',
 budget_mismatch:'Бюджет не подходит',too_far:'Слишком далеко',
 different_specialist_needed:'Нужен другой специалист',
 do_not_want_order:'Не хочу брать заказ',other:'Другая причина'
};
function formattedTime(value){
 const d=new Date(value);
 if(!Number.isFinite(d.getTime()))return String(value??'');
 return new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Yerevan'}).format(d);
}
export function renderLegacyTransferRows(items){
 return items.map(item=>'<article class="record" data-crm26-entry="'+esc(item.source_transfer_id)+'">'+
  '<strong>Передан: '+esc(item.recipient_name)+'</strong>'+
  '<p class="muted small">Дата: '+esc(formattedTime(item.transferred_at_source))+
  ' · Причина: '+esc(reasons[item.reason]||item.reason)+'</p>'+
  '<p class="muted small">Исходный лид: '+esc(item.source_lead_id)+
  ' · Передача: '+esc(item.source_transfer_id)+'</p>'+
  (item.source_master_id?'<p class="muted small">Исходный мастер: '+esc(item.source_master_id)+'</p>':'')+
  (item.comment?'<p class="small">'+esc(item.comment)+'</p>':'')+
  '</article>').join('');
}
export function mountLegacyTransferPanel(root,{fetchPage}){
 if(!root||typeof fetchPage!=='function')throw Error('CRM26_ROOT_REQUIRED');
 let closed=false,items=[],nextCursor=null,loaded=false,loading=false,q='',error='';
 const render=()=>{
  if(closed)return;
  root.innerHTML='<p class="muted small">Архив Google VBOS. Старые ID сохранены; это не передача в нынешней CRM. '+
    'Старые лиды не связываются с новыми автоматически.</p>'+
   '<form data-crm26-filter class="grid"><label>Поиск по старому ID или получателю'+
    '<input name="q" maxlength="80" value="'+esc(q)+'" placeholder="ID лида, мастер или получатель"></label>'+
    '<button type="submit" class="compact"'+(loading?' disabled':'')+'>Найти</button></form>'+
   '<button type="button" class="compact" data-crm26-load'+(loading?' disabled':'')+'>Показать историю</button>'+
   (error?'<p class="error" role="alert">'+esc(error)+'</p>':'')+
   (loaded?(items.length?renderLegacyTransferRows(items):
    '<p class="muted small">Исторических передач в архиве пока нет. Это не означает, что их не было в Google VBOS.</p>'):'')+
   (nextCursor?'<button type="button" class="compact" data-crm26-more'+(loading?' disabled':'')+'>Показать ещё</button>':'');
 };
 async function load(more=false,search=''){
  if(closed||loading)return;
  loading=true;error='';render();
  try{
   if(!more)q=search.trim();
   const params=new URLSearchParams({q,limit:'25'});
   if(more&&nextCursor)params.set('cursor',nextCursor);
   const page=await fetchPage('/api/crm/legacy-transfers?'+params.toString());
   if(closed)return;
   if(page.source!=='LEGACY_GOOGLE_IMMUTABLE_ARCHIVE'||page.linkedToClean!==false||!Array.isArray(page.items))
    throw Error('Недостоверный источник исторических передач.');
   items=more?items.concat(page.items):page.items;
   nextCursor=page.hasMore?page.nextCursor:null;
   loaded=true;
  }catch(err){if(!closed)error=String(err?.message||'История пока недоступна.');}
  finally{loading=false;render();}
 }
 const click=e=>{
  if(e.target.closest('[data-crm26-load]'))void load(false,q);
  else if(e.target.closest('[data-crm26-more]'))void load(true,q);
 };
 const submit=e=>{
  if(!e.target.matches('form[data-crm26-filter]'))return;
  e.preventDefault();
  void load(false,String(new FormData(e.target).get('q')||''));
 };
 root.addEventListener('click',click);root.addEventListener('submit',submit);render();
 return {unmount(){closed=true;root.removeEventListener('click',click);root.removeEventListener('submit',submit);}};
}
