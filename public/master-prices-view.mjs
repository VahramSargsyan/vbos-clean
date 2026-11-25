// MS3: master-specific quotes, never payroll, tariff authority or automatic ranking.
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types={fixed:'Фиксированная',from:'От',range:'Диапазон',per_unit:'За единицу',estimate:'По оценке'};
const units={job:'Работа',item:'Штука',point:'Точка',meter:'Пог. метр',square_meter:'м²',hour:'Час',day:'День',visit:'Выезд',other:'Другое'};
const statuses={active:'Активна',inactive:'Неактивна',archived:'Архив'};
const option=(k,v,selected)=>'<option value="'+esc(k)+'"'+(k===selected?' selected':'')+'>'+esc(v)+'</option>';
const opts=(obj,v)=>Object.entries(obj).map(([k,t])=>option(k,t,v)).join('');
const amount=v=>v==null?'':String(v).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
export function quoteText(x){
 const a=amount(x.priceFrom),b=amount(x.priceTo);
 if(x.priceType==='estimate')return 'По оценке'+(a||b?' ('+[a,b].filter(Boolean).join('–')+' '+x.currency+')':'');
 return (x.priceType==='from'?'от ':'')+(x.priceType==='range'?a+'–'+b:a)+' '+x.currency+' / '+(units[x.unit]||x.unit);
}
const blank=(masterId,services)=>({masterPriceId:'',masterId,serviceId:services[0]?.serviceId||'',revision:null,status:'active',priceType:'fixed',priceFrom:'',priceTo:'',currency:'AMD',unit:services[0]?.defaultUnit||'job',validFrom:'',notes:''});
const editable=(x,masterId,services)=>Object.fromEntries(Object.keys(blank(masterId,services)).map(k=>[k,x[k]??blank(masterId,services)[k]]));
function editor(x,services,busy){
 const available=[...services];if(x.serviceId&&!available.some(s=>s.serviceId===x.serviceId))available.push({serviceId:x.serviceId,serviceName:x.serviceId+' (архивная связь)'});
 return '<form class="grid" data-ms3-save><h3>'+(x.masterPriceId?'Редактировать расценку':'Новая расценка')+'</h3>'+
 '<label>Услуга<select required name="serviceId">'+available.map(s=>option(s.serviceId,(s.category?s.category+' · ':'')+s.serviceName+' · '+s.serviceId,x.serviceId)).join('')+'</select></label>'+
 '<label>Тип цены<select name="priceType">'+opts(types,x.priceType)+'</select></label>'+
 '<label>Цена от<input inputmode="decimal" name="priceFrom" maxlength="22" value="'+esc(x.priceFrom??'')+'"></label>'+
 '<label>Цена до<input inputmode="decimal" name="priceTo" maxlength="22" value="'+esc(x.priceTo??'')+'"></label>'+
 '<label>Валюта<select name="currency">'+opts({AMD:'AMD',USD:'USD',EUR:'EUR'},x.currency)+'</select></label>'+
 '<label>Единица<select name="unit">'+opts(units,x.unit)+'</select></label>'+
 '<label>Актуальна с<input type="date" name="validFrom" value="'+esc(x.validFrom??'')+'"></label>'+
 '<label>Статус<select name="status">'+opts(statuses,x.status)+'</select></label>'+
 '<label>Заметки<textarea name="notes" maxlength="5000">'+esc(x.notes)+'</textarea></label>'+
 '<button class="primary wide" type="submit"'+(busy?' disabled':'')+'>Сохранить</button><button type="button" data-ms3-cancel'+(busy?' disabled':'')+'>Отмена</button></form>';
}
const card=(x,{masterId,enabled,history=false})=>'<article class="card"><strong>'+esc(masterId?(x.serviceName||x.serviceId):(x.masterName||x.masterId))+'</strong><p>'+esc(quoteText(x))+'</p>'+
 '<p class="muted small">'+esc([x.masterPriceId,statuses[x.status]||x.status,x.validFrom?'с '+x.validFrom:'дата создания',x.stale?'Цена старше 90 дней':'',x.current?'Действующая':''].filter(Boolean).join(' · '))+'</p>'+
 (x.notes?'<p>'+esc(x.notes)+'</p>':'')+(history?'<p>Версия '+esc(x.revision)+' · '+esc(String(x.recordedAt||'').slice(0,19))+'</p>':'')+
 (!history&&masterId&&enabled?'<button type="button" data-ms3-edit="'+esc(x.masterPriceId)+'">Редактировать</button><button type="button" data-ms3-history="'+esc(x.masterPriceId)+'">История изменений</button>':'')+'</article>';
export function renderPrices({masterId,services,serviceId,sort,page,draft,historyId,busy,error,notice}){
 const enabled=page?.writeEnabled===true,items=page?.items||[];
 const compare=!masterId;
 const info=page?.source==='VERIFIED_LEGACY_SNAPSHOT'?'Исторический снимок. Запись заблокирована.':page?'Данные Clean.':'Выберите услугу или дождитесь загрузки.';
 let html='<section class="card"><h2>'+ (compare?'Подобрать мастера по услуге':'Индивидуальные расценки')+'</h2><p class="muted">'+esc(info)+'</p><p class="muted small">Прайс — ориентир, не договор с клиентом. Валюты и единицы не пересчитываются автоматически.</p>';
 if(error)html+='<p role="alert" class="error">'+esc(error)+'</p>';
 if(notice)html+='<p role="status">'+esc(notice)+'</p>';
 if(busy)html+='<p role="status">Загрузка…</p>';
 if(compare)html+='<form class="grid" data-ms3-compare><label>Услуга<select required name="serviceId">'+option('','Выберите услугу',serviceId)+services.map(s=>option(s.serviceId,s.category+' · '+s.serviceName+' · '+s.serviceId,serviceId)).join('')+'</select></label><label>Сортировка<select name="sort">'+opts({name:'По имени',price:'По валюте, единице и цене',updated:'По обновлению'},sort)+'</select></label><button type="submit"'+(busy?' disabled':'')+'>Сравнить</button></form>';
 if(masterId&&!historyId&&!draft)html+='<button type="button" data-ms3-new'+(!enabled||busy||!services.length?' disabled':'')+'>+ Добавить цену</button>';
 if(draft&&enabled)html+=editor(draft,services,busy);
 else {
  if(historyId)html+='<h3>Предыдущие версии</h3><button type="button" data-ms3-cancel>← К расценкам</button>';
  else if(masterId)html+='<h3>Действующие, будущие и архивные цены</h3>';
  else if(serviceId)html+='<h3>Последняя действующая цена каждого мастера</h3>';
  html+=items.map(x=>card(x,{masterId,enabled,history:Boolean(historyId)})).join('');
  if(page&&!items.length&&!busy)html+='<p class="muted">Записей нет.</p>';
  if(page?.hasMore&&!busy)html+='<button type="button" data-ms3-more>Показать ещё</button>';
 }
 return html+'</section>';
}
export function mountPrices(root,{masterId='',services=[],fetchPage,save,makeKey=()=>crypto.randomUUID(),onSaved=()=>{}}={}){
 if(!root||typeof fetchPage!=='function'||typeof save!=='function')throw Error('MS3_MOUNT_REQUIRED');
 const s={masterId,services,serviceId:'',sort:'name',page:null,draft:null,historyId:'',busy:false,error:'',notice:''};
 let dead=false,seq=0,pageNo=0,key=null,attemptPayload=null;
 const draw=()=>{if(!dead)root.innerHTML=renderPrices(s);};
 async function load(append=false){
  if(!masterId&&!s.serviceId){s.page=null;draw();return;}
  const turn=++seq;s.busy=true;s.error='';if(!append){s.page=null;pageNo=0;}draw();
  try{
   const p=new URLSearchParams({sort:s.sort,page:String(append?pageNo+1:0)});
   if(masterId)p.set('masterId',masterId);else p.set('serviceId',s.serviceId);
   if(s.historyId)p.set('historyId',s.historyId);
   const next=await fetchPage('/api/masters/prices?'+p.toString());
   if(dead||turn!==seq)return;
   if(!next||!Array.isArray(next.items)||typeof next.writeEnabled!=='boolean')throw Error('Ответ расценок не подтверждён.');
   if(append){pageNo++;next.items=(s.page?.items||[]).concat(next.items);}
   s.page=next;
  }catch(e){if(!dead&&turn===seq){s.page=null;s.error=e.message||'Расценки недоступны.';}}
  finally{if(!dead&&turn===seq){s.busy=false;draw();}}
 }
 const resetDraft=()=>{s.draft=null;key=null;attemptPayload=null;};
 const submit=async e=>{
  if(!e.target?.matches?.('[data-ms3-save],[data-ms3-compare]'))return;
  e.preventDefault();e.stopPropagation();if(s.busy)return;
  const fields=Object.fromEntries(new FormData(e.target));
  if(e.target.matches('[data-ms3-compare]')){s.serviceId=fields.serviceId;s.sort=fields.sort;await load();return;}
  if(!s.draft||s.page?.writeEnabled!==true)return;
  const next={...s.draft,...fields},serialized=JSON.stringify(next);
  if(attemptPayload!==null&&attemptPayload!==serialized){s.error='Предыдущий запрос мог сохраниться. Отмени форму, обнови список и проверь запись перед новым запросом.';s.draft=next;draw();return;}
  s.draft=next;attemptPayload=serialized;key??=makeKey();s.busy=true;s.error='';s.notice='';draw();const turn=++seq;
  try{
   const out=await save('/api/masters/prices/save',{requestKey:key,payload:s.draft});
   if(dead||turn!==seq)return;
   if(!out?.entityId||out.data?.masterId!==masterId)throw Error('Ответ сохранения не подтверждён.');
   resetDraft();s.notice='Расценка сохранена.';await load();if(!dead)onSaved(out);
  }catch(err){if(!dead&&turn===seq)s.error=(err.message||'Ошибка сохранения.')+' Повтори тот же запрос или обнови список.';}
  finally{if(!dead&&turn===seq){s.busy=false;draw();}}
 };
 const click=e=>{
  const b=e.target?.closest?.('button');if(!b||s.busy)return;
  if(b.matches('[data-ms3-new]')&&s.page?.writeEnabled===true&&services.length){resetDraft();s.draft=blank(masterId,services);draw();}
  else if(b.matches('[data-ms3-edit]')&&s.page?.writeEnabled===true){const x=s.page.items.find(y=>y.masterPriceId===b.dataset.ms3Edit);if(x){resetDraft();s.draft=editable(x,masterId,services);draw();}}
  else if(b.matches('[data-ms3-history]')){resetDraft();s.historyId=b.dataset.ms3History;void load();}
  else if(b.matches('[data-ms3-cancel]')){resetDraft();s.historyId='';void load();}
  else if(b.matches('[data-ms3-more]')&&s.page?.hasMore)void load(true);
 };
 const change=e=>{
  if(!s.draft||s.busy||!e.target?.form?.matches('[data-ms3-save]')||e.target.name!=='serviceId')return;
  const selected=services.find(x=>x.serviceId===e.target.value);
  if(selected?.defaultUnit)e.target.form.elements.namedItem('unit').value=selected.defaultUnit;
 };
 root.addEventListener('submit',submit);root.addEventListener('click',click);root.addEventListener('change',change);
 if(masterId)void load();else draw();
 return {unmount(){dead=true;seq++;root.removeEventListener('submit',submit);root.removeEventListener('click',click);root.removeEventListener('change',change);}};
}
