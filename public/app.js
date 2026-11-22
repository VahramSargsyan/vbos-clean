'use strict';
const $=s=>document.querySelector(s);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=x=>Number(x||0).toLocaleString('ru-RU');
const short=x=>String(x||'').slice(0,10);
const when=x=>{try{return new Date(x).toLocaleString('ru-RU',{timeZone:'Asia/Yerevan',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}catch{return '';}}
let data=null,tab='today',busy=false;
let crmClientLeadContext=null; // UI-only Client context; Object relation is a separate persisted feature
let egModule=null,egLoading=false,egError='',egInputs={},egResult=null;
let edModule=null,edLoading=false,edError='',edDraft=null,edAnchor=null,edResult=null,edMessage='';
let efModule=null,efLoading=false,efError='',efFloor=null;
let schedule={viewMode:'week',anchorDate:'',selectedDay:'',dayFilter:'all',items:[],periodStart:'',periodEnd:'',total:0,hasMore:false,nextCursor:null,loaded:false,loading:false,error:''};
let scheduleLeadDraft=null; // ephemeral prefill, never a saved plan until owner submits
let workOrderCapacityOpenSeq=0; // prevent stale async order-context navigation
let clientDetailId=null,objectDetailId=null,orderDetailId=null,clientReturn=null,objectReturnId=null,objectReturnTab=null;
let objectOrdersCard={id:null,items:[],loading:false,loaded:false,error:'',hasMore:false,nextCursor:null};
let clientPortfolio=null;
function clientPortfolioNew(id){
 const page=()=>({q:'',status:'all',items:[],nextCursor:null,hasMore:false,loaded:false,loading:false,error:''});
 return {id,counts:null,objects:page(),orders:page()};
}
async function loadClientPortfolio(id,kind,append=false){
 if(!id||!['objects','orders'].includes(kind))return;
 if(!clientPortfolio||clientPortfolio.id!==id)clientPortfolio=clientPortfolioNew(id);
 const state=clientPortfolio,p=state[kind];
 if(p.loading||(!append&&(p.loaded||p.error))||append&&!p.nextCursor)return;
 p.loading=true;p.error='';
 try{
  const qs=new URLSearchParams({id,kind,q:p.q,status:p.status,limit:'12'});
  if(append&&p.nextCursor)qs.set('cursor',p.nextCursor);
  const out=await api('/api/clients/portfolio?'+qs.toString());
  if(clientPortfolio!==state||state[kind]!==p)return;
  if(out.clientId!==id||out.kind!==kind||!out.counts||!Array.isArray(out.items)||
   out.items.some(x=>x.client_id!==id))throw Error('Связи портфеля клиента не подтверждены.');
  p.items=append?p.items.concat(out.items):out.items;
  p.nextCursor=out.nextCursor;p.hasMore=Boolean(out.hasMore);p.loaded=true;
  state.counts=out.counts;
 }catch(error){if(clientPortfolio===state&&state[kind]===p)p.error=error.message;}
 finally{
  if(clientPortfolio===state&&state[kind]===p){
   p.loading=false;
   if(clientDetailId===id&&(tab==='clients'||(tab==='catalog'&&catalog.entity==='clients')))render();
  }
 }
}
function clientPortfolioSection(x,kind){
 const p=clientPortfolio?.id===x.id?clientPortfolio[kind]:null;
 const options=kind==='orders'?'<label>Статус заказа<select name="status">'+
  [['all','Все'],['open','Открытые'],['active','В работе'],['done','Завершённые'],['cancelled','Отменённые']]
   .map(([v,t])=>'<option value="'+v+'"'+((p?.status||'all')===v?' selected':'')+'>'+t+'</option>').join('')+
  '</select></label>':'';
 const filter='<form data-client-portfolio-filter="'+kind+'" class="grid">'+
  '<label>Поиск по '+(kind==='objects'?'названию или адресу дома':'заказу, объекту или адресу')+
  '<input name="q" type="search" maxlength="80" value="'+esc(p?.q||'')+'" placeholder="Найти…"></label>'+
  options+'<button type="submit">Показать</button></form>';
 const items=p?.items||[];
 const entries=items.map(item=>'<button type="button" class="client-list-card" data-client-portfolio-open="'+kind+
   '" data-client-portfolio-id="'+esc(item.id)+'">'+
   '<span class="client-list-info"><strong class="client-list-name">'+esc(kind==='objects'?item.name:item.title)+'</strong>'+
   '<span class="client-list-phone">'+esc(kind==='objects'?(item.address||'Адрес не указан'):(item.object_name||'Объект не указан'))+'</span>'+
   (kind==='orders'?'<span class="entity-list-extra">'+esc(label[item.status]||item.status||'')+'</span>':'')+
   '</span><span class="client-list-open">Открыть</span></button>').join('');
 return filter+(!p||p.loading&&!p.loaded?'<p class="muted">Загружаю записи клиента…</p>':
  p.error?'<p role="alert">'+esc(p.error)+'</p><button type="button" data-client-portfolio-retry="'+kind+'">Повторить</button>':
  !items.length?'<p class="muted">По заданным условиям записей нет.</p>':
  '<div class="client-hub-related">'+entries+'</div>')+
  (p?.hasMore?'<button type="button" data-client-portfolio-more="'+kind+'"'+(p.loading?' disabled':'')+'>Показать ещё 12</button>':'');
}
let objectContactState={id:null,items:[],loading:false,loaded:false,error:'',hasMore:false,nextCursor:null};
let orderContactState={id:null,items:[],loading:false,loaded:false,error:'',hasMore:false,nextCursor:null};
let orderLogs={id:null,items:[],loaded:false,loading:false,error:'',hasMore:false,nextCursor:null,context:null};
let history={filters:{mode:'day',day:'',from:'',to:'',orderId:''},items:[],nextCursor:null,hasMore:false,loaded:false,loading:false};
let historicalOrdersPanel=null,historicalOrdersModulePromise=null;
let financeHistoryPanel=null,financeHistoryModulePromise=null;
let financeArchivePanel=null,financeArchiveModulePromise=null;
let financeDraftIntent='';
let financeOpeningPanel=null,financeOpeningModulePromise=null;
let financeNativePanel=null,financeNativeModulePromise=null;
let financeOrderPanel=null,financeOrderModulePromise=null;
let financeWorkerPanel=null,financeWorkerModulePromise=null;
let financeObjectPanel=null,financeObjectModulePromise=null;
let financeMonthlyPanel=null,financeMonthlyModulePromise=null;
let financeReviewPanel=null,financeReviewModulePromise=null;
let financeReviewAuditPanel=null,financeReviewAuditModulePromise=null;
let financeCorrectionPanel=null,financeCorrectionModulePromise=null;
let financeAuditPanel=null,financeAuditModulePromise=null;
let referencePanel=null,referenceModulePromise=null;
let closePreviewModulePromise=null,closePreviewModule=null,closePreviewState={id:null,loading:false,result:null,error:''},closePreviewSeq=0;
let nativeCloseViewPromise=null,nativeCloseView=null,nativeCloseReceipt={id:null,busy:false,result:null,error:''},nativeCloseReceiptSeq=0;
let catalog={entity:'clients',q:'',status:'',tier:'',referral:'',items:[],nextCursor:null,hasMore:false,loaded:false,loading:false};
let crmMasters={items:[],loaded:false,loading:false,error:'',q:'',status:'',nextCursor:null,hasMore:false,opened:false};
let crmTransferOpenLeadId=null;
let myWork={snapshot:null,loading:false,loaded:false,selectedOrderId:'',error:''};
let dailyA1=null;
let ownerActivity={date:'',active:null,items:[],totals:{ORGANIZATION:0,BUSINESS_SYSTEM:0},trackingSince:null,nextCursor:null,hasMore:false,loaded:false,loading:false};
let presence={date:'',day:null,active:null,items:[],nextCursor:null,hasMore:false,loaded:false,loading:false};
function editText(name,labelText,value,kind='text',extra=''){
 return '<label>'+esc(labelText)+(kind==='textarea'
  ?'<textarea name="'+name+'" '+extra+'>'+esc(value)+'</textarea>'
  :'<input name="'+name+'" type="'+kind+'" value="'+esc(value)+'" '+extra+'>')+'</label>';
}
function editRecord(type,item,fields,versionField='revision'){
 const key=versionField==='row_version'?'rowVersion':versionField;
 return '<details class="edit-panel"><summary>Изменить</summary><form data-act="'+type+'" class="grid">'+
 '<input type="hidden" name="id" value="'+esc(item.id)+'"><input type="hidden" name="'+key+'" value="'+esc(item[versionField])+'">'+fields+
 '<button type="submit" class="primary wide">Сохранить изменения</button></form></details>';
}
const label={new:'Новый',contacted:'Связались',qualified:'В работе',won:'Успешно',lost:'Отказ',transferred:'Передан',open:'Открыт',active:'В работе',done:'Завершён',cancelled:'Отменён',closed:'Закрыт'};
function setMenuOpen(open,{restoreFocus=true}={}){
 const panel=$('#appPanel'),nav=$('#tabs'),backdrop=$('#menuBackdrop'),toggle=$('#menuToggle');
 const show=Boolean(open&&!panel.hidden);
 nav.hidden=!show;backdrop.hidden=!show;
 toggle.setAttribute('aria-expanded',String(show));
 toggle.setAttribute('aria-label',show?'Закрыть меню':'Открыть меню');
 document.body.classList.toggle('menu-open',show);
 if(restoreFocus)(show?$('#menuClose'):toggle).focus();
}
function message(x,error=false){const e=$('#notice');if(e){e.textContent=x||'';e.classList.toggle('error',error);}}
async function api(url,payload){
 const init={credentials:'same-origin',headers:{'Accept':'application/json'}};
 if(payload!==undefined){init.method='POST';init.headers['Content-Type']='application/json';init.body=JSON.stringify(payload);}
 const r=await fetch(url,init);let j;try{j=await r.json();}catch{throw Error('Ответ сервера не распознан. Проверь историю перед повтором.');}
 if(!r.ok){const error=Error(j.error||'HTTP '+r.status);error.status=r.status;throw error;}
 return j;
}
/** Finance B15: only protected dry-run request. CSRF is acquired just-in-time. */
async function financeDraftServerPost(payload){
 const csrf=await api('/api/finance/csrf');
 if(!csrf||csrf.version!=='FINANCE_B12_CSRF_V1'||
    csrf.financialWriterEnabled!==false||
    typeof csrf.token!=='string'||!/^[0-9a-f]{64}$/.test(csrf.token))
  throw Error('Подтверждение безопасной сессии недоступно.');
 const response=await fetch('/api/finance/draft-validate',{
  method:'POST',credentials:'same-origin',
  headers:{'Accept':'application/json','Content-Type':'application/json',
   'X-Finance-CSRF':csrf.token},
  body:JSON.stringify(payload)
 });
 let body;
 try{body=await response.json();}
 catch{throw Error('Ответ проверки черновика не распознан. Ничего не сохранено.');}
 if(!response.ok)throw Error(body.error||'Проверка черновика отклонена.');
 return body;
}

/** One authenticated native finance POST; the server and DB reject unapproved authority. */
async function financeNativePostAction(payload){
 const csrf=await api('/api/finance/csrf');
 if(!csrf||csrf.version!=='FINANCE_B12_CSRF_V1'||
     typeof csrf.token!=='string'||!/^[0-9a-f]{64}$/.test(csrf.token))
  throw Error('Финансовая сессия не подтверждена. Запись не выполнена.');
 const response=await fetch('/api/finance/post',{
  method:'POST',credentials:'same-origin',
  headers:{'Accept':'application/json','Content-Type':'application/json',
   'X-Finance-CSRF':csrf.token},
  body:JSON.stringify(payload)
 });
 let answer;
 try{answer=await response.json();}
 catch{throw Error('Ответ сохранения не получен. Проверь историю до повторения.');}
 if(!response.ok){
  const error=new Error(answer.error||'Сохранение отклонено.');
  error.httpStatus=response.status;throw error;
 }
 return answer;
}
function option(items,getName,empty='Не выбрано'){return '<option value="">'+esc(empty)+'</option>'+items.map(x=>'<option value="'+esc(x.id)+'">'+esc(getName(x))+'</option>').join('');}
function ids(table,id){return (data?.[table]||[]).find(x=>x.id===id);}
function record(heading,description,body){return '<article class="record"><strong>'+esc(heading)+'</strong><div class="meta">'+esc(description||'')+'</div>'+(body||'')+'</article>';}
function formField(name,labelText,kind='text',required=false,extra=''){
 const type=kind==='textarea'?'<textarea name="'+name+'" '+extra+'></textarea>':kind==='select'?extra:'<input name="'+name+'" type="'+kind+'" '+extra+(required?' required':'')+'>';
 return '<label>'+esc(labelText)+type+'</label>';
}
function form(name,title,fields){
 return '<details class="card"><summary>'+esc(title)+'</summary><form data-act="'+esc(name)+'" class="grid">'+fields+'<button type="submit" class="primary wide">Сохранить в PostgreSQL</button></form></details>';
}
function select(name,labelText,choices,required=true){return '<label>'+esc(labelText)+'<select name="'+name+'" '+(required?'required':'')+'>'+choices+'</select></label>';}
function statusButtons(item,type,choices){
 return '<div class="actions">'+choices.filter(s=>s!==item.status&&(type!=='lead_status'||s!=='won')).map(s=>'<button class="compact" data-act="'+type+'" data-id="'+esc(item.id)+'" data-revision="'+item.revision+'" data-status="'+s+'">'+esc(label[s]||s)+'</button>').join('')+'</div>';
}


/* CRM-21A advisory duplicate hint. This client-side preview is never an
 * authority: the transactional PostgreSQL guard checks ALL canonical Clients.
 */
function clientDuplicateHintMarkup(){
 return '<p class="small muted" role="status" data-client-duplicate-hint hidden></p>';
}
function refreshClientDuplicateHint(phoneInput){
 const form=phoneInput.closest('form[data-act="client_create"],form[data-act="client_update"]');
 if(!form)return;
 const target=form.querySelector('[data-client-duplicate-hint]');
 if(!target)return;
 const ownId=form.dataset.act==='client_update'?form.querySelector('[name=id]')?.value:'';
 const normalized=crmPhoneKey(phoneInput.value);
 const matches=normalized?(data?.clients||[]).filter(x=>x.id!==ownId&&x.status!=='archived'&&
  crmPhoneKey(x.phone)===normalized):[];
 if(!matches.length){target.hidden=true;target.innerHTML='';return;}
 target.hidden=false;
 target.innerHTML='<strong>Возможно, клиент уже существует ('+matches.length+').</strong> '+
  'Проверь карточку перед сохранением. Сервер проверит всю базу. '+
  matches.slice(0,3).map(x=>'<button type="button" class="compact" data-client-duplicate-open="'+
   esc(x.id)+'">Открыть: '+esc(x.name)+'</button>').join(' ');
}

function crmPhoneKey(phone){
 let digits=String(phone||'').replace(/[^0-9]/g,'');
 if(digits.startsWith('00')&&digits.length>10)digits=digits.slice(2);
 if(digits.length===9&&digits.startsWith('0'))digits='374'+digits.slice(1);
 return digits;
}
function crmIntakeTag(x){
 const intake=(data.leadIntakes||[]).find(row=>row.lead_id===x.id);
 if(!intake)return '';
 const client=ids('clients',intake.client_id);
 return '<p class="small muted">Клиент при обращении: '+esc(client?.name||'ID '+intake.client_id)+
  ' · статус лида: '+esc(label[x.status]||x.status)+'</p>'+
  '<button type="button" data-crm-open-client="'+esc(intake.client_id)+'">Открыть связанного клиента</button>';
}
function crmLeadConversion(x){
 const link=(data.leadClientLinks||[]).find(row=>row.lead_id===x.id);
 if(link){
  const client=ids('clients',link.client_id);
  const connectedOrders=(data.orders||[]).filter(o=>o.lead_id===x.id);
  const orderList=connectedOrders.length?
   '<p class="muted small">Заказы по обращению:</p>'+connectedOrders.map(o=>
    '<button type="button" class="compact" data-crm-open-order="'+esc(o.id)+'">'+
     esc(o.title||'Заказ')+' · '+esc(label[o.status]||o.status)+'</button>').join(''):
   '<p class="muted small">Заказ ещё не создан. Следующий шаг — одна кнопка, без перехода к объектам.</p>';
  return '<section class="card" data-crm-won-handoff>'+
    '<h3>✓ Договорились</h3>'+
    '<p class="muted small">Клиент: '+esc(client?.name||link.client_id)+'. Связь с лидом сохранена.</p>'+
    '<button type="button" class="primary wide" data-crm-won-order-open="'+esc(x.id)+'">+ Создать заказ</button>'+
    '<p class="muted small">В этом окне выберешь существующий объект или создашь новый вместе с заказом.</p>'+
    '<button type="button" class="compact" data-crm-open-client="'+esc(link.client_id)+'">Открыть клиента</button>'+
    orderList+'</section>';
 }
 if(x.status==='won')return '<p class="muted">Лид помечен успешным без подтверждённой связи с клиентом. Автоматически менять связи нельзя.</p>';
 if(x.status==='lost'||x.status==='transferred')return '';
 const intake=(data.leadIntakes||[]).find(row=>row.lead_id===x.id);
 const normalized=crmPhoneKey(x.phone);
 const matches=normalized?(data.clients||[]).filter(c=>crmPhoneKey(c.phone)===normalized):[];
 const hint=intake?'<p class="small muted">Этот лид уже привязан к клиенту. Связь нельзя заменить.</p>':
  matches.length?'<p class="small muted">Есть клиент с похожим номером. Выбери существующего, чтобы не создавать дубликат.</p>':
  '<p class="small muted">Если клиента нет, он будет создан по имени контакта.</p>';
 const eligible=(data.clients||[]).filter(c=>c.status!=='archived'&&!(data.archivedLegacyClientIds||[]).includes(c.id));
 const choices=option(eligible,c=>c.name+' · '+(c.phone||'без телефона'),'Создать нового клиента');
 return '<details class="card" data-crm-convert open><summary>✓ Договорились → создать заказ</summary>'+
   '<p class="muted">Сначала подтвердим клиента, затем сразу откроем создание заказа. За объектом в другой раздел идти не нужно.</p>'+hint+
   '<form data-act="lead_convert" class="grid">'+
   '<input type="hidden" name="leadId" value="'+esc(x.id)+'">'+
   '<input type="hidden" name="revision" value="'+esc(x.revision)+'">'+
   (intake?'<input type="hidden" name="clientId" value="'+esc(intake.client_id)+'">':
    select('clientId','Существующий клиент (если уже есть)',choices,false)+
    formField('newClientName','Имя нового клиента','text',false,'maxlength="160" placeholder="'+esc(x.contact_name||'Контакт из лида')+'"'))+
   '<button type="submit" class="primary wide">Подтвердить и перейти к заказу</button>'+
   '</form></details>';
}

const crmWonOrderModal={leadId:null,trigger:null};
function crmWonOrderModalHtml(leadId){
 const lead=(data?.leads||[]).find(x=>x.id===leadId);
 const link=(data?.leadClientLinks||[]).find(row=>row.lead_id===leadId);
 if(!lead||!link||lead.status!=='won')return '';
 const client=ids('clients',link.client_id);
 const all=(data.objects||[]).filter(o=>o.client_id===link.client_id&&o.status!=='archived');
 const allowed=link.object_id?all.filter(x=>x.id===link.object_id):all;
 if(link.object_id&&!allowed.length)return '<div id="crmWonOrderModal" class="work-flow-backdrop"><section class="work-flow-dialog" role="dialog" aria-modal="true" aria-label="Создать заказ">'+
   '<header class="work-flow-dialog-head"><h2>Создать заказ</h2><button type="button" data-crm-won-order-close aria-label="Закрыть">✕</button></header>'+
   '<div class="work-flow-dialog-body"><p role="alert">Связанный объект не загружен. Обнови карточку лида и проверь доступ к объекту.</p></div></section></div>';
 const canNew=!link.object_id;
 const mode=allowed.length?'existing':'new';
 const options='<option value="">Выбери объект</option>'+allowed.map(o=>
  '<option value="'+esc(o.id)+'"'+(o.id===link.object_id?' selected':'')+'>'+
   esc(o.name||o.address||o.id)+'</option>').join('');
 const duplicates=(data.orders||[]).filter(o=>o.lead_id===leadId);
 return '<div id="crmWonOrderModal" class="work-flow-backdrop" data-crm-won-order-backdrop>'+
  '<section class="work-flow-dialog" role="dialog" aria-modal="true" aria-label="Новый заказ после договорённости">'+
  '<header class="work-flow-dialog-head"><h2 tabindex="-1">Договорились → новый заказ</h2>'+
  '<button type="button" data-crm-won-order-close aria-label="Закрыть">✕</button></header>'+
  '<form data-act="crm_won_order_create" class="crm-won-order-form" data-crm-won-order-form>'+
  '<div class="work-flow-dialog-body crm-won-order-fields">'+
  '<p class="muted">Клиент: <strong>'+esc(client?.name||link.client_id)+'</strong>. Обращение: '+esc(lead.title)+'</p>'+
  (duplicates.length?'<p class="muted small">По этому лиду уже есть '+duplicates.length+
    ' заказ(ов). Не создавай второй заказ на ту же работу случайно.</p>':'')+
  '<input type="hidden" name="leadId" value="'+esc(lead.id)+'">'+
  '<fieldset class="crm-won-order-object-choice"><legend>Объект заказа</legend>'+
  (allowed.length?'<label class="crm-won-order-mode-option"><input type="radio" name="objectMode" value="existing"'+(mode==='existing'?' checked':'')+'><span>Выбрать существующий</span></label>':'')+
  (canNew?'<label class="crm-won-order-mode-option"><input type="radio" name="objectMode" value="new"'+(mode==='new'?' checked':'')+'><span>+ Создать новый объект</span></label>':
    '<p class="muted small">Объект уже привязан к этому лиду. Для заказа по другому объекту нужно новое обращение.</p>')+
  '</fieldset>'+
  '<div data-crm-won-existing'+(mode==='new'?' hidden':'')+'>'+
   '<label>Объект клиента *<select name="objectId"'+(mode==='existing'?' required':' disabled')+'>'+options+'</select></label>'+
  '</div>'+
  (canNew?'<div data-crm-won-new'+(mode==='existing'?' hidden':'')+'>'+
    '<label>Название нового объекта *<input name="objectName" maxlength="160" placeholder="Квартира, дом, магазин…"'+(mode==='new'?' required':' disabled')+'></label>'+
   '</div>':'')+
  '<label>Название заказа *<input name="title" maxlength="180" value="'+esc(lead.title)+'" required></label>'+
  (canNew?'<p class="crm-won-order-tip">Для нового объекта достаточно названия. Остальные поля можно заполнить позже.</p>':'')+
  '<details class="crm-won-order-extra"><summary>Дополнительно · адрес, тип, дата, примечание</summary>'+
   (canNew?'<div data-crm-won-new-details'+(mode==='existing'?' hidden':'')+'>'+
     '<label>Адрес объекта<input name="objectAddress" maxlength="300"'+(mode==='existing'?' disabled':'')+'></label>'+
     '<label>Тип объекта<input name="objectType" maxlength="100"'+(mode==='existing'?' disabled':'')+'></label>'+
    '</div>':'')+
   '<label>Плановая дата (если есть)<input name="plannedOn" type="date"></label>'+
   '<label>Примечание к заказу<textarea name="notes" maxlength="5000"></textarea></label>'+
  '</details>'+
  '</div><div class="crm-won-order-actions">'+
   '<button type="submit" class="primary wide">Создать заказ</button>'+
   '<p role="status" data-crm-won-feedback class="muted small" aria-live="polite"></p>'+
  '</div></form></section></div>';
}
function crmWonOrderToggle(form){
 const mode=form?.querySelector('input[name="objectMode"]:checked')?.value||'';
 for(const [part,enabled] of [['[data-crm-won-existing]',mode==='existing'],['[data-crm-won-new]',mode==='new'],['[data-crm-won-new-details]',mode==='new']]){
  const block=form.querySelector(part);
  if(!block)continue;
  block.hidden=!enabled;
  block.querySelectorAll('input,select').forEach(el=>{
   el.disabled=!enabled;
   if(el.name==='objectId'||el.name==='objectName')el.required=enabled;
  });
 }
}
function crmWonOrderFeedback(text,error=false){
 const el=document.querySelector('#crmWonOrderModal [data-crm-won-feedback]');
 if(el){el.textContent=text;el.style.color=error?'var(--danger,#b33)':'';}
}
function crmWonOrderClose(force=false){
 const root=document.getElementById?.('crmWonOrderModal');
 if(!root)return true;
 const form=root.querySelector('form');
 if(!force&&form?.dataset.dirty==='1'&&!confirm('Несохранённые данные заказа будут потеряны. Закрыть?'))return false;
 root.remove();
 document.body.classList.remove('work-flow-modal-open');
 const trigger=crmWonOrderModal.trigger;
 crmWonOrderModal.leadId=null;crmWonOrderModal.trigger=null;
 trigger?.focus?.({preventScroll:true});
 return true;
}
function crmWonOrderOpen(leadId,trigger=null){
 if(document.getElementById('crmWonOrderModal')&&!crmWonOrderClose())return;
 const html=crmWonOrderModalHtml(leadId);
 if(!html){message('Связь лида и клиента не загружена. Обнови карточку.',true);return;}
 crmWonOrderModal.leadId=leadId;crmWonOrderModal.trigger=trigger;
 $('#appPanel').insertAdjacentHTML('beforeend',html);
 const root=document.getElementById?.('crmWonOrderModal');
 root.addEventListener('click',e=>{
  if(e.target.closest('[data-crm-won-order-close]')||e.target===root)crmWonOrderClose();
 });
 root.addEventListener('change',e=>{
  if(e.target.name==='objectMode'){
   const form=root.querySelector('form');
   crmWonOrderToggle(form);
   if(form)form.dataset.dirty='1';
  }
 });
 root.addEventListener('invalid',e=>{
  const field=e.target;
  if(!field?.closest?.('[data-crm-won-order-form]'))return;
  const extra=field.closest('details');
  if(extra)extra.open=true;
  const hint=field.name==='objectName'?'Укажи название нового объекта.':
   field.name==='objectId'?'Выбери объект клиента.':
   field.name==='title'?'Укажи название заказа.':'Проверь обязательное поле.';
  crmWonOrderFeedback(hint,true);
 },true);
 root.addEventListener('input',()=>{const form=root.querySelector('form');if(form)form.dataset.dirty='1';});
 root.addEventListener('submit',async e=>{
  e.preventDefault();
  const form=e.target;
  if(!form.matches('[data-crm-won-order-form]'))return;
  crmWonOrderToggle(form);
  if(!form.reportValidity())return;
  const btn=form.querySelector('button[type="submit"]');
  if(btn){btn.disabled=true;btn.textContent='Создаю заказ…';}
  crmWonOrderFeedback('Сохраняю объект и заказ в PostgreSQL…');
  try{
   await sendAction('crm_won_order_create',Object.fromEntries(new FormData(form)),form);
  }finally{
   if(btn?.isConnected){btn.disabled=false;btn.textContent='Создать заказ';}
  }
 });
 document.body.classList.add('work-flow-modal-open');
 root.querySelector('.work-flow-dialog-head h2')?.focus?.({preventScroll:true});
}
function leadEdit(x){
 return editRecord('lead_update',x,
  editText('title','Запрос',x.title,'text','required maxlength="160"')+
  editText('contactName','Контакт',x.contact_name,'text','maxlength="160"')+
  editText('phone','Телефон',x.phone,'tel','maxlength="60"')+
  editText('notes','Примечание',x.notes,'textarea'));
}
// CRM-15A: exact legacy enum values; blank classification is unknown.
function clientProfileChoice(field,title,current,options){
 return '<label>'+esc(title)+'<select name="'+esc(field)+'">'+options.map(([val,label])=>'<option value="'+esc(val)+'"'+(String(current??'')===val?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>';
}
function clientProfileFields(x={}){
 return editText('email','Email',x.email||'','email','maxlength="200"')+
  editText('address','Адрес',x.address||'','text','maxlength="500"')+
  clientProfileChoice('status','Статус',x.status||'active',[['active','Активный'],['inactive','Неактивный'],['archived','Архивный']])+
  clientProfileChoice('clientTier','Уровень клиента',x.client_tier||'',[['','Не оценён'],['regular','Обычный'],['good','Хороший'],['vip','VIP']])+
  clientProfileChoice('referralStatus','Рекомендательный статус',x.referral_status||'',[['','Не оценён'],['none','Нет'],['one','Одна рекомендация'],['active','Рекомендует активно']])+
  editText('clientLabelNote','Обоснование классификации',x.client_label_note||'','textarea','maxlength="5000"');
}
function clientEdit(x){
 return editRecord('client_update',x,editText('name','Имя',x.name,'text','required maxlength="160"')+
  editText('phone','Телефон',x.phone,'tel','maxlength="60"')+clientDuplicateHintMarkup()+clientProfileFields(x)+
  editText('notes','Примечание',x.notes,'textarea','maxlength="5000"'));
}
function objectEdit(x){
 return editRecord('object_update',x,editText('name','Название',x.name,'text','required maxlength="160"')+
  editText('address','Адрес',x.address,'text','maxlength="300"')+
  editText('objectType','Тип объекта',x.object_type||'','text','maxlength="100"')+
  editText('notes','Примечание',x.notes,'textarea'),'row_version');
}
function orderEdit(x){
 return editRecord('order_update',x,editText('title','Заказ / задание',x.title,'text','required maxlength="180"')+
  editText('plannedOn','Плановая дата',short(x.planned_on),'date')+
  editText('notes','Примечание',x.notes,'textarea'));
}

function todayView(){return todayDashboardView();}
/* Kept as a non-default rollback-only reference. Today V1 moves transactional
 * day/session/WorkLog actions to My Work, without deleting their handlers. */
function todayLegacyWorkView(){
 const d=data.days.find(x=>short(x.day_date)===data.today);
 const live=data.sessions.find(x=>!x.ended_at);
 const finished=data.sessions.filter(x=>short(data.days.find(d=>d.id===x.day_id)?.day_date)===data.today);
 const todayLogs=data.logs.filter(x=>short(x.day_date)===data.today);
 const minutes=todayLogs.reduce((a,x)=>a+Number(x.minutes||0),0);
 const orderOptions=option(data.orders.filter(x=>x.status!=='cancelled'),x=>x.title,'Без привязки к заказу');
 const planned=data.orders.filter(x=>['open','active'].includes(x.status)&&(short(x.planned_on)===data.today||x.status==='active'));

 let s='<h1>Сегодня · '+esc(data.today)+'</h1><button type="button" class="primary wide-button" data-open-my-work>Моя работа · открыть рабочий экран</button><button type="button" class="wide-button" data-open-schedule>План · неделя и месяц</button><div class="summary"><div class="card"><span>Записано работ</span><strong>'+todayLogs.length+'</strong></div><div class="card"><span>Минут выполнено</span><strong>'+minutes+'</strong></div></div>';
 s+=a1Card();
 s+='<div class="card"><div class="row"><div><h2>Рабочий день</h2><span class="tag">'+esc(d?label[d.status]:'Не открыт')+'</span></div>';
 if(!d)s+='<button class="primary" data-act="day_open">Открыть день</button>';
 else if(d.status==='open'&&!live)s+='<button data-act="day_close">Завершить день</button>';
 s+='</div>';
 if(d?.status==='open'){
  if(live)s+='<p>Сейчас: <b>'+esc(ids('orders',live.order_id)?.title||'Без заказа')+'</b> · с '+esc(when(live.started_at))+'</p><button class="primary" data-act="session_stop" data-id="'+esc(live.id)+'">Завершить интервал</button>';
  else s+='<form data-act="session_start" class="grid">'+select('orderId','Заказ',orderOptions,false)+formField('description','Чем занимаешься')+'<button type="submit" class="primary wide">Начать рабочий интервал</button></form>';
 }else if(d?.status==='closed')s+='<p class="muted">Рабочий день закрыт. Завтра откроется новый.</p>';
 s+='</div>';
 s+='<section class="card"><h2>Задания на сегодня</h2>'+
   (!planned.length
     ?'<p class="muted">Пока нет запланированных заданий. Создай заказ с сегодняшней датой во вкладке «Заказы».</p>'
     :planned.map(x=>record(
       x.title,
       (ids('objects',x.object_id)?.name||'Объект не указан')+' · '+(label[x.status]||x.status),
       '<div class="actions">'+
         (!live&&d?.status!=='closed'
           ?'<button class="primary compact" data-act="work_start_order" data-order-id="'+esc(x.id)+'">Начать работу</button>'
           :'<span class="muted small">'+(live?'Сначала заверши текущий интервал':'Рабочий день закрыт')+'</span>')+
       '</div>'
     )).join('')
   )+'</section>';
 s+=form('log_create','+ Записать выполненную работу',select('orderId','Заказ',orderOptions,false)+formField('title','Что выполнено','text',true,'maxlength="180" placeholder="Например, монтаж труб"')+formField('minutes','Время, минут','number',true,'min="1" max="1440"')+formField('quantity','Объём','number',false,'min="0" step="0.001"')+formField('unit','Единица','text',false,'placeholder="м, шт, м²"')+formField('notes','Примечание','textarea'));
 s+='<section class="card"><h2>Сегодняшние работы</h2>'+(!todayLogs.length?'<p class="muted">Пока нет записей.</p>':todayLogs.map(x=>record(x.title,(ids('orders',x.order_id)?.title||'Без заказа')+' · '+fmt(x.minutes)+' мин'+(x.quantity!==null?' · '+fmt(x.quantity)+' '+x.unit:''),'<p class="small muted">'+esc(x.notes)+'</p>')).join(''))+'</section>';
 s+='<section class="card"><h2>Интервалы сегодня</h2>'+(!finished.length?'<p class="muted">Пока нет интервалов.</p>':finished.map(x=>record(ids('orders',x.order_id)?.title||'Без заказа',when(x.started_at)+' — '+(x.ended_at?when(x.ended_at):'идёт'),'<p class="small">'+esc(x.description)+'</p>')).join(''))+'</section>';
 return s;
}
function crmVisitDraft(lead){
 const intake=(data.leadIntakes||[]).find(x=>x.lead_id===lead.id);
 const converted=(data.leadClientLinks||[]).find(x=>x.lead_id===lead.id);
 const client=ids('clients',intake?.client_id||converted?.client_id);
 const date=scheduleShiftDay(data.today,1);
 const lines=['CRM LEAD ID: '+lead.id];
 if(client)lines.push('Клиент: '+client.name);
 if(lead.contact_name)lines.push('Контакт: '+lead.contact_name);
 if(lead.phone)lines.push('Телефон: '+lead.phone);
 if(lead.notes)lines.push('Данные обращения: '+lead.notes);
 return {leadId:lead.id,date,title:('Осмотр · '+lead.title).slice(0,300),notes:lines.join('\n').slice(0,5000)};
}
function crm04LatestResult(notes){
 const re=/\[CRM04 RECORD \| ([0-9a-f-]{36}) \| ([0-9a-f]{64})\]\nДата осмотра: (\d{4}-\d{2}-\d{2})\nРезультат: ([^\n]*)\nСледующее действие: ([^\n]*)\nСледующий контакт: (\d{4}-\d{2}-\d{2}|не назначен)\n\[\/CRM04 RECORD\]/gi;
 const matches=[...String(notes||'').matchAll(re)],found=matches.at(-1);
 return found?{visitDate:found[3],observations:found[4],nextAction:found[5],followUpOn:found[6]==='не назначен'?'':found[6],count:matches.length}:null;
}
function crm04ResultCard(lead){
 const record=crm04LatestResult(lead.notes);
 let s='<div class="card"><h3>Осмотр и следующий контакт</h3>';
 if(record){
  s+='<p class="small muted">Записан результат · '+esc(record.visitDate)+
   ' · записей осмотра: '+record.count+'</p><p><strong>Результат:</strong> '+esc(record.observations)+
   '</p><p><strong>Следующий шаг:</strong> '+esc(record.nextAction)+'</p>'+
   '<p class="small muted">Повторная связь: '+esc(record.followUpOn||'дата не назначена')+'</p>'+
   (record.followUpOn?'<button type="button" class="compact" data-plan-followup="'+esc(lead.id)+'">Запланировать следующий контакт</button>':'');
 }
 if(lead.status!=='lost'){
  s+='<details class="edit-panel"><summary>'+ (record?'Добавить результат другого осмотра':'Записать результат осмотра')+
   '</summary><form data-act="lead_visit_record" class="grid">'+
   '<input type="hidden" name="leadId" value="'+esc(lead.id)+'">'+
   '<input type="hidden" name="revision" value="'+esc(lead.revision)+'">'+
   '<label>Дата осмотра<input type="date" name="visitDate" value="'+esc(data.today)+'" required></label>'+
   '<label>Что выяснили на объекте<textarea name="observations" maxlength="500" required></textarea></label>'+
   '<label>Следующее действие<input type="text" name="nextAction" maxlength="200" required placeholder="Например, рассчитать стоимость"></label>'+
   '<label>Дата следующего контакта (необязательно)<input type="date" name="followUpOn"></label>'+
   '<p class="small muted">Результат добавляется к примечаниям лида. Статус не меняется. Дата контакта не создаёт событие в календаре автоматически.</p>'+
   '<button type="submit" class="primary wide">Сохранить результат осмотра</button></form></details>';
 }
 return s+'</div>';
}
function crm04FollowupDraft(lead){
 const latest=crm04LatestResult(lead.notes);
 if(!latest?.followUpOn)return null;
 const intake=(data.leadIntakes||[]).find(x=>x.lead_id===lead.id);
 const conversion=(data.leadClientLinks||[]).find(x=>x.lead_id===lead.id);
 const client=ids('clients',intake?.client_id||conversion?.client_id);
 const lines=['CRM LEAD ID: '+lead.id];
 if(client)lines.push('Клиент: '+client.name);
 if(lead.contact_name)lines.push('Контакт: '+lead.contact_name);
 if(lead.phone)lines.push('Телефон: '+lead.phone);
 lines.push('Следующий шаг: '+latest.nextAction);
 lines.push('По результатам осмотра от '+latest.visitDate);
 return {leadId:lead.id,date:latest.followUpOn,title:('Связаться · '+lead.title).slice(0,300),
  itemType:'Связь с клиентом',notes:lines.join('\n').slice(0,5000)};
}
// CRM-05A: owner-only internal estimate preview, lazy loaded per Lead.
let estimateUI={leadId:null,loaded:false,loading:false,error:'',result:null,editor:null};

/**
 * CRM-17A: the calculator is preview-only until the owner adds lines into the
 * existing editable Estimate. No new write API; accepted Estimates stay immutable.
 */
let plumbingUI={module:null,loading:false,error:'',inputs:null,preview:null};
async function ensurePlumbingCalculator(){
 if(plumbingUI.module||plumbingUI.loading)return;
 plumbingUI.loading=true;
 try{plumbingUI.module=await import('/estimate-plumbing.mjs');plumbingUI.error='';}
 catch(e){plumbingUI.error='Расчётчик недоступен: '+String(e.message||e);}
 finally{plumbingUI.loading=false;if((tab==='crm'&&estimateUI.leadId)||tab==='estimator')render();}
}
function plumbingDraftInputs(){
 const form=$('#plumbingEstimatorInputs');
 if(!form)throw Error('Форма расчёта пока недоступна.');
 const v=Object.fromEntries(new FormData(form).entries());
 return {cardKey:v.plumbingCard,tariff:v.plumbingTariff,quantity:v.plumbingQuantity,
  coldWaterPoints:v.plumbingCold,hotWaterPoints:v.plumbingHot,
  sewerPoints:v.plumbingSewer,chasingMeters:v.plumbingChasing,
  install:v.plumbingInstall==='on',includeMaterials:v.plumbingMaterials==='on',
  applyFixedReferencePrices:v.plumbingPrices==='on'};
}
function plumbingCalculatorView(){
 const unit=plumbingUI.module;
 if(!unit)return '<section class="card" aria-label="Калькулятор сантехнических работ"><h3>Калькулятор сантехнических работ</h3>'+
  '<p class="muted">'+esc(plumbingUI.error||'Подключаю проверенные старые правила…')+'</p></section>';
 const inputs=plumbingUI.inputs||{cardKey:'WC',tariff:'ECONOM',quantity:'1',coldWaterPoints:'0',
  hotWaterPoints:'0',sewerPoints:'0',chasingMeters:'0',install:true,includeMaterials:true,applyFixedReferencePrices:false};
 const opts=unit.listPlumbingItems().map(x=>'<option value="'+esc(x.cardKey)+'"'+
  (inputs.cardKey===x.cardKey?' selected':'')+'>'+esc(x.displayName)+'</option>').join('');
 const field=(name,title,value)=>'<label>'+title+'<input name="'+name+'" type="text" inputmode="decimal" required value="'+esc(value)+'"></label>';
 const check=(name,title,on)=>'<label class="plumbing-choice"><input type="checkbox" name="'+name+'" value="on"'+(on?' checked':'')+'>'+title+'</label>';
 const preview=plumbingUI.preview?.result;
 let detail='';
 if(preview){
  const rows=preview.lines.map(x=>'<p class="muted small">'+esc(x.kind==='WORK'?'Работа':'Материал')+': '+
   esc(x.description)+' · '+esc(x.quantity)+' '+esc(x.unit)+
   ' · '+(x.suggestedUnitPriceAMD===null?'без подтверждённой цены':
    'справочно '+estimateAMD(x.suggestedUnitPriceAMD))+
   (x.priceMode==='FROM'?' · цена «от»':(x.unitPriceAMD!==''?' · цена применена по подтверждению':''))+
   '</p>').join('');
  const notes=preview.warnings.map(x=>'<p class="muted small">'+esc(x)+'</p>').join('');
  detail='<section aria-label="Предварительный результат" class="card">'+
   '<strong>Расчёт для '+esc(preview.displayName)+'</strong>'+rows+notes+
   '<p class="muted small">Это только предварительные строки. До добавления и сохранения черновик сметы не меняется.</p>'+
   '<button type="button" class="primary wide" data-plumbing-add>Добавить '+preview.lines.length+' позиций в черновик</button></section>';
 }
 return '<section class="card" aria-label="Калькулятор сантехнических работ"><h3>Калькулятор сантехнических работ</h3>'+
  '<p class="muted small">Источник: старый Estimator (30.08.2026). Цены исторические, не актуальный прайс. Материалы — по готовым узлам, без цен и длины трасс.</p>'+
  '<form id="plumbingEstimatorInputs" class="grid">'+
  '<label>Прибор<select name="plumbingCard">'+opts+'</select></label>'+
  '<label>Тариф<select name="plumbingTariff">'+
   [['ECONOM','Economy'],['STANDARD_PLUS','Standard+'],['VIP','VIP']].map(x=>
    '<option value="'+x[0]+'"'+(inputs.tariff===x[0]?' selected':'')+'>'+x[1]+'</option>').join('')+
  '</select></label>'+
  field('plumbingQuantity','Количество приборов',inputs.quantity)+
  field('plumbingCold','Точки холодной воды',inputs.coldWaterPoints)+
  field('plumbingHot','Точки горячей воды',inputs.hotWaterPoints)+
  field('plumbingSewer','Точки канализации',inputs.sewerPoints)+
  field('plumbingChasing','Штробление, м',inputs.chasingMeters)+
  '<div class="wide">'+
  check('plumbingInstall','Добавить работу по установке прибора',inputs.install)+
  check('plumbingMaterials','Предложить материалы по готовой карточке',inputs.includeMaterials)+
  check('plumbingPrices','Я проверил справочные FIXED-цены и разрешаю подставить их в черновик (цены «от» останутся пустыми)',inputs.applyFixedReferencePrices)+
  '</div><button type="button" class="compact wide" data-plumbing-preview>Рассчитать · предпросмотр</button></form>'+detail+'</section>';
}


// CRM-17B — separate in-app page and old Estimator multi-card three-stage wizard.
// No pop-up tab: this is the same in-app navigation as legacy estimatorV150.
let estimateWorkspaceOpen=false;
function plumbingNewWizard(){
 return {step:1,cards:{},config:{},tariff:'STANDARD_PLUS',includeMaterials:true,
  useFixedPrices:false,chasing:false,chasingMeters:'1.000',chasingPrice:'',
   extraMaterials:false,extraMaterialsAmount:'0',extraMaterialsNote:'',preview:null,
  quotePrices:{},pricedResult:null};
}
let plumbingWizard=plumbingNewWizard();
let plumbingDraftPanelOpen=false;
function plumbingScrollToActiveStep(){
 const wizard=$('[data-plumbing-wizard]');
 if(!wizard)return;
 const heading=wizard.querySelector('h2');
 if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});}
 wizard.scrollIntoView({block:'start',behavior:'auto'});
}
function plumbingShowStepError(error){
 const text='Расчёт не выполнен: '+String(error?.message||error||'неизвестная ошибка');
 const local=$('[data-pw-error]');
 if(local){
  local.textContent=text;
  local.hidden=false;
  local.scrollIntoView({block:'center',behavior:'auto'});
 }else message(text,true);
}

function plumbingPriceEditorMarkup(result){
 const mod=plumbingUI.module,w=plumbingWizard;
 const rows=mod.plumbingQuoteRows(result),prices=w.quotePrices||{};
 const sourceValue=(key,fallback='')=>Object.hasOwn(prices,key)?prices[key]:fallback;
 const input=(name,value,caption)=>
  '<label>'+esc(caption)+'<input name="'+name+'" type="text" inputmode="numeric" autocomplete="off" '+
  'placeholder="Цена AMD/ед." maxlength="10" value="'+esc(value)+'"></label>';
 const works=rows.works.map((r,i)=>
  '<div class="plumbing-price-line"><div><strong>'+esc(r.name)+'</strong>'+
  '<small>'+esc(r.quantity)+' '+esc(r.unit)+(r.referenceUnitPriceAMD===null?' · нет справочной цены':
   ' · справочно '+estimateAMD(r.referenceUnitPriceAMD)+(r.priceMode==='FROM'?' (от)':''))+
  '</small></div>'+input('pwWorkPrice_'+i,sourceValue(r.key,r.currentUnitPriceAMD),'Цена работы, AMD/ед.')+'</div>').join('');
 const mats=rows.materials.map((r,i)=>
  '<div class="plumbing-price-line"><div><strong>'+esc(r.name)+'</strong>'+
  '<small>'+esc(r.quantity)+' '+esc(r.unit)+'</small></div>'+
  input('pwMaterialPrice_'+i,sourceValue(r.key,r.currentUnitPriceAMD??''),'Цена материала, AMD/ед.')+'</div>').join('');
 const priced=w.pricedResult;
 const priceStatus=priced?
  '<div class="plumbing-priced-status" role="status"><strong>'+
   (priced.totals.pricingComplete?'Все позиции оценены':'Оценено '+priced.totals.pricedCount+' из '+priced.totals.lineCount)+
   '</strong> · '+estimateAMD(priced.totals.knownTotalAMD)+
   (priced.totals.unpricedCount?' · Без цены: '+priced.totals.unpricedCount:'')+'</div>':'';
 return '<details class="plumbing-price-editor"'+(priced?' open':'')+'>'+
  '<summary><strong>Указать цены работ и материалов</strong><span class="muted small">Для этой сметы · AMD</span></summary>'+
  '<div class="plumbing-price-body"><p class="muted small">Фактические закупочные цены отсутствуют в исходной базе. '+
  'Заполняй проверенную цену за единицу самостоятельно. Пустая цена означает «не оценено», не ноль. '+
  'Одна цена одинакового материала действует на все выбранные карточки только в этом расчёте.</p>'+
  '<form id="pwPriceEditor"><h3>Работы</h3>'+works+'<h3>Материалы</h3>'+
   (mats||'<p class="muted small">Нет материалов с готовым рецептом.</p>')+
   '<p class="error" role="alert" data-pw-price-error hidden></p>'+
   '<button class="primary wide" type="button" data-pw-reprice>Пересчитать по моим ценам</button></form>'+priceStatus+
   '</div></details>';
}
function plumbingCaptureQuotePrices(){
 const f=$('#pwPriceEditor'),mod=plumbingUI.module,result=plumbingWizard.preview;
 if(!f||!result||!mod)throw Error('Редактор цен недоступен.');
 const rows=mod.plumbingQuoteRows(result),prices={};
 for(const [i,r] of rows.works.entries()){
  const input=f.elements.namedItem('pwWorkPrice_'+i);
  if(!input)throw Error('Не найдена цена работы: '+r.name);
  prices[r.key]=String(input.value||'').trim();
 }
 for(const [i,r] of rows.materials.entries()){
  const input=f.elements.namedItem('pwMaterialPrice_'+i);
  if(!input)throw Error('Не найдена цена материала: '+r.name);
  prices[r.key]=String(input.value||'').trim();
 }
 const priced=mod.plumbingApplyQuotePrices(result,prices);
 plumbingWizard.quotePrices=prices;
 plumbingWizard.pricedResult=priced;
 return priced;
}
function plumbingPriceError(error){
 const text='Цена не принята: '+String(error?.message||error);
 const place=$('[data-pw-price-error]');
 if(place){place.textContent=text;place.hidden=false;place.scrollIntoView({block:'center',behavior:'auto'});}
 else plumbingShowStepError(error);
}

function plumbingWizardMarkup(){
 const mod=plumbingUI.module;
 if(!mod)return '<section class="card"><p class="muted">'+esc(plumbingUI.error||'Подключаю старые инженерные правила…')+'</p></section>';
 const cardCatalog=typeof estimatorCardCatalog==='function'?estimatorCardCatalog():[];
 const w=plumbingWizard,items=mod.listPlumbingItems(cardCatalog);
 const progress='<nav class="plumbing-steps" aria-label="Этапы Estimator">'+
  ['1. Карточки','2. Действия','3. Итог'].map((x,i)=>
   '<span'+(w.step===i+1?' class="active"':'')+'>'+x+'</span>').join('')+'</nav>';
 const note='<p class="muted small">Исторический Estimator · справочные цены 30.08.2026. Без автоматической оценки трасс и текущих закупочных цен.</p>';
 const check=(name,title,on)=>'<label class="plumbing-choice"><input type="checkbox" name="'+name+'"'+(on?' checked':'')+'>'+title+'</label>';
 const actionCheck=(name,title,on)=>'<label class="plumbing-choice"><input type="checkbox" data-pw-action name="'+name+'"'+(on?' checked':'')+'>'+title+'</label>';
 const priceInput=(name,title,value)=>'<label>'+title+'<input type="text" inputmode="numeric" autocomplete="off" maxlength="10" name="'+name+'" placeholder="Цена AMD/ед." value="'+esc(value??'')+'"></label>';
 if(w.step===1){
  const rows=items.map(item=>{
   const prev=w.cards[item.cardKey];
   return '<article class="plumbing-pick" data-pw-item="'+esc(item.cardKey)+'" data-pw-name="'+esc(item.displayName.toLocaleLowerCase('ru'))+'">'+
    '<label class="plumbing-choice"><input type="checkbox" data-pw-pick="'+esc(item.cardKey)+'"'+(prev?' checked':'')+'><strong>'+esc(item.displayName)+'</strong></label>'+
    '<label>Количество<input type="number" data-pw-qty="'+esc(item.cardKey)+'" min="1" max="50" step="1" value="'+esc(prev?.quantity||1)+'"></label>'+
    '<p class="muted small">Рецепт: '+esc(item.materialStatus)+(item.priceMode==='FROM'?' · цена установки «от»':'')+'</p></article>';
  }).join('');
  return '<section class="card" data-plumbing-wizard>'+progress+'<h2>Выбери все услуги и количество</h2>'+note+
   '<form id="pwSelect"><div class="grid"><label>Поиск<input type="search" data-pw-search placeholder="Найти прибор"></label>'+
   '<label>Общий тариф<select name="pwTariff">'+
    [['ECONOM','Economy'],['STANDARD_PLUS','Standard+'],['VIP','VIP']].map(p=>
     '<option value="'+p[0]+'"'+(w.tariff===p[0]?' selected':'')+'>'+p[1]+'</option>').join('')+
   '</select></label></div><div class="plumbing-pick-grid">'+rows+'</div>'+
   check('pwChasing','Отдельно добавить штробление',w.chasing)+
   check('pwExtraMaterials','Доп. материалы · ручная сумма',w.extraMaterials)+
   '<p class="error" role="alert" data-pw-error hidden></p>'+
   '<button type="button" data-pw-next class="primary wide">Подтвердить выбор → Действия</button></form></section>';
 }
 if(w.step===2){
  const list=Object.entries(w.cards).map(([key,row])=>{
   const item=items.find(x=>x.cardKey===key),standard=mod.plumbingStandardForCard(key,cardCatalog);
   const cfg=w.config[key]||{water:standard.supportsWater,sewer:standard.supportsSewer,install:true,waterPrice:'',sewerPrice:'',installPrice:''};
   return '<article class="plumbing-pick" data-pw-actions="'+esc(key)+'"><h3>'+esc(item.displayName)+' × '+esc(row.quantity)+'</h3>'+
    '<p class="muted small">'+(standard.pointStatus==='FIXED'?
     'На прибор: вода '+esc(standard.waterPoints)+' точек; канализация '+esc(standard.sewerPoints)+' точек.':
     'Стандартные точки не определены. Монтаж воды/канализации недоступен.')+'</p>'+
    '<label class="plumbing-choice"><input type="checkbox" data-pw-all'+
     (Boolean(cfg.install)&&(!standard.supportsWater||Boolean(cfg.water))&&(!standard.supportsSewer||Boolean(cfg.sewer))?' checked':'')+'> Всё</label>'+
    (standard.supportsWater?actionCheck('pwWater_'+key,'Монтаж воды',cfg.water):'')+
    (standard.supportsSewer?actionCheck('pwSewer_'+key,'Монтаж канализации',cfg.sewer):'')+
    actionCheck('pwInstall_'+key,'Установка прибора',cfg.install)+
    '<details class="plumbing-action-prices"><summary>Цена только для этого расчёта (необязательно)</summary>'+
    (standard.supportsWater?priceInput('pwWaterPrice_'+key,'Монтаж воды · AMD/точка',cfg.waterPrice):'')+
    (standard.supportsSewer?priceInput('pwSewerPrice_'+key,'Монтаж канализации · AMD/точка',cfg.sewerPrice):'')+
    priceInput('pwInstallPrice_'+key,'Установка прибора · AMD/шт',cfg.installPrice)+
    '</details></article>';
  }).join('');
  return '<section class="card" data-plumbing-wizard>'+progress+'<h2>Настройка выбранных карточек</h2>'+note+
   '<form id="pwConfig"><div class="plumbing-pick-grid">'+list+'</div>'+
   (w.chasing?'<div class="plumbing-special-fields"><label>Штробление, метров<input name="pwChasingMeters" inputmode="decimal" value="'+esc(w.chasingMeters)+'" required></label>'+
    priceInput('pwChasingPrice','Цена штробления · AMD/м (необязательно)',w.chasingPrice)+'</div>':'')+
   (w.extraMaterials?'<div class="plumbing-special-fields"><h3>Доп. материалы</h3><label>Сумма, AMD<input name="pwExtraAmount" type="text" inputmode="numeric" value="'+esc(w.extraMaterialsAmount)+'" required></label>'+
    '<label>Что входит (необязательно)<textarea name="pwExtraNote" maxlength="180">'+esc(w.extraMaterialsNote)+'</textarea></label></div>':'')+
   check('pwMaterials','Добавить материалы по готовым карточкам',w.includeMaterials)+
   check('pwFixed','Подставить проверенные цены общего прайса и старые фиксированные (исторические цены «от» останутся пустыми)',w.useFixedPrices)+
   '<p class="error" role="alert" data-pw-error hidden></p>'+
   '<div class="actions"><button type="button" data-pw-prev>← Изменить выбор</button>'+
   '<button type="button" data-pw-calculate class="primary">Рассчитать → Итог</button></div></form></section>';
 }
 const result=w.preview;
 if(!result)return '<section class="card"><button type="button" data-pw-prev>← Вернуться к расчёту</button></section>';
 const compact=mod.summarizePlumbingEstimateBatch(result);
 const amount=estimateAMD,priced=w.pricedResult;
 const totals='<div class="plumbing-summary-grid" aria-label="'+
  (priced?'Итоги по введённым ценам':'Предварительные справочные итоги')+'">'+
  '<div class="plumbing-summary-box"><span>Работы</span><strong>'+amount(priced?priced.totals.laborKnownAMD:compact.laborReferenceAMD)+'</strong></div>'+
  '<div class="plumbing-summary-box"><span>Доп. материалы</span><strong>'+amount(priced?priced.totals.materialsKnownAMD:compact.extraMaterialsAMD)+'</strong></div>'+
  '<div class="plumbing-summary-box"><span>Итого</span><strong>'+amount(priced?priced.totals.knownTotalAMD:compact.referenceTotalAMD)+'</strong></div></div>';
 const materialRows=compact.materials.map(m=>
  '<div class="plumbing-material-row"><span>'+esc(m.name)+'</span><strong>'+
  esc(Number(m.quantity).toFixed(3))+' '+esc(m.unit)+'</strong></div>').join('');
 const materialList='<details class="plumbing-materials-summary"><summary><span>Материалы из карточек</span>'+
  '<strong>'+compact.materialPositions+' поз.</strong></summary>'+
  '<div class="plumbing-materials-body">'+(materialRows||'<p class="muted small">Нет готового рецепта материалов.</p>')+
  '<p class="muted small">Это количество по узлам; цены и длины трасс пока неизвестны.</p></div></details>';
 const groupCards=result.groups.map((group,i)=>{
  const snapshot=compact.groups[i],rows=(group.lines||[]).map(line=>
   '<div class="plumbing-result-detail-row"><span>'+esc(line.description)+'</span>'+
   '<span>'+esc(line.quantity)+' '+esc(line.unit)+'</span>'+
   '<span>'+(line.suggestedUnitPriceAMD===null?'Цена не указана':
    amount(line.suggestedUnitPriceAMD)+(line.priceMode==='FROM'?' · от':''))+'</span></div>').join('');
  return '<details class="plumbing-compact-result-card"><summary>'+
   '<span class="plumbing-result-title"><strong>'+esc(group.displayName)+' × '+esc(group.quantity)+'</strong>'+
   '<small>Нажми, чтобы посмотреть подробно</small></span>'+
   '<strong class="plumbing-result-price">'+
   (group.cardKey==='SPECIAL:EXTRA_MATERIALS'?
     amount(priced?priced.groupMaterialKnownAMD[i]:snapshot.referenceMaterialsAMD):
     (priced?
      (priced.groupWorkKnownAMD[i]==='0.000'&&priced.groupUnpricedCount[i]?'Не оценено':
       amount(priced.groupWorkKnownAMD[i])+(priced.groupUnpricedCount[i]?' *':'')):
      (snapshot.referenceWorkAMD===0&&snapshot.unpricedWorkLines?'Не оценено':
       amount(snapshot.referenceWorkAMD)+(snapshot.unpricedWorkLines?' *':''))))+
   '</strong></summary>'+
   '<div class="plumbing-compact-detail">'+rows+'</div></details>';
 }).join('');
 const existingLines=estimateUI.editor?.lines?.length||0;
 const transferBlocked=existingLines+result.lines.length>50;
 const requiresDraft=!(estimateUI.result?.estimate?.status==='draft'&&estimateUI.editor);
 const transferWarning=transferBlocked?
  '<p class="error" role="status">Предпросмотр показан полностью, но '+result.lines.length+
  ' новых строк не помещаются в черновик ('+existingLines+' уже сохранены, лимит 50). Уменьши выбор.</p>':'';
 const disclaimer=priced?
  '<p class="muted small"><strong>Промежуточный итог по введённым ценам.</strong> '+
   (priced.totals.pricingComplete?'Все строки имеют указанную цену.':
    'Без цены осталось '+priced.totals.unpricedCount+' строк; сумма не окончательная.')+
   ' Цены сохранены только после добавления и отдельного сохранения черновика.</p>':
  '<p class="muted small"><strong>Справочно по старым тарифам.</strong> Это не окончательная смета. '+
  (compact.fromWorkLines?'Цены «от»: '+compact.fromWorkLines+'. ':'')+
  (compact.unpricedWorkLines?'Работы без цены: '+compact.unpricedWorkLines+' (не включены в итог). ':'')+
  'Материалы без подтверждённых закупочных цен в итог не включены.</p>';
 return '<section class="card" data-plumbing-wizard>'+progress+'<h2>Результат расчёта</h2>'+
  totals+materialList+groupCards+plumbingPriceEditorMarkup(result)+disclaimer+
  transferWarning+(requiresDraft?'<p class="muted" role="status">Расчёт готов. Чтобы сохранить его, выбери лид и создай черновик сметы. Позиции пока не записаны в PostgreSQL.</p>':'')+
  '<p class="error" role="alert" data-pw-error hidden></p>'+
  '<div class="actions"><button type="button" data-pw-edit>← Изменить действия</button>'+
   '<button type="button" class="primary" data-pw-add'+(transferBlocked?' disabled aria-disabled="true"':requiresDraft?' disabled aria-disabled="true"':'')+
   '>Добавить все позиции в черновик</button><button type="button" data-pw-new>Новый расчёт</button></div></section>';
}
function plumbingCaptureSelection(){
 const f=$('#pwSelect');if(!f)throw Error('Экран выбора недоступен.');
 const cards={};
 f.querySelectorAll('[data-pw-pick]').forEach(node=>{
  if(!node.checked)return;
  const key=node.dataset.pwPick;
  const qty=f.querySelector('[data-pw-qty="'+key+'"]')?.value||'';
  if(!/^\d{1,2}$/.test(qty)||+qty<1||+qty>50)throw Error('Неверное количество: '+key+' (1–50).');
  cards[key]={quantity:qty};
 });
 const chasing=f.querySelector('[name=pwChasing]')?.checked===true;
 const extraMaterials=f.querySelector('[name=pwExtraMaterials]')?.checked===true;
 if(!Object.keys(cards).length&&!chasing&&!extraMaterials)throw Error('Выбери карточку, штробление или доп. материалы.');
 plumbingWizard.cards=cards;plumbingWizard.tariff=f.querySelector('[name=pwTariff]').value;
 plumbingWizard.chasing=chasing;plumbingWizard.extraMaterials=extraMaterials;plumbingWizard.preview=null;
}
function plumbingCaptureConfig(){
 const f=$('#pwConfig');if(!f)throw Error('Экран действий недоступен.');
 const next={};
 for(const key of Object.keys(plumbingWizard.cards)){
  next[key]={water:f.querySelector('[name="pwWater_'+key+'"]')?.checked===true,
   sewer:f.querySelector('[name="pwSewer_'+key+'"]')?.checked===true,
   install:f.querySelector('[name="pwInstall_'+key+'"]')?.checked===true,
   waterPrice:f.querySelector('[name="pwWaterPrice_'+key+'"]')?.value??'',
   sewerPrice:f.querySelector('[name="pwSewerPrice_'+key+'"]')?.value??'',
   installPrice:f.querySelector('[name="pwInstallPrice_'+key+'"]')?.value??''};
 }
 plumbingWizard.config=next;
 plumbingWizard.includeMaterials=f.querySelector('[name=pwMaterials]')?.checked===true;
 plumbingWizard.useFixedPrices=f.querySelector('[name=pwFixed]')?.checked===true;
 plumbingWizard.chasingMeters=f.querySelector('[name=pwChasingMeters]')?.value||'1.000';
 plumbingWizard.chasingPrice=f.querySelector('[name=pwChasingPrice]')?.value??'';
 plumbingWizard.extraMaterialsAmount=f.querySelector('[name=pwExtraAmount]')?.value??'0';
 plumbingWizard.extraMaterialsNote=f.querySelector('[name=pwExtraNote]')?.value??'';
}
function plumbingWorkspace(lead){
 return '<div class="crm-detail-page" data-estimate-workspace="'+esc(lead.id)+'">'+
  '<div class="crm-detail-top"><button type="button" data-estimate-back>'+
  ((typeof tab!=='undefined'&&tab==='estimator')?'← К выбору лида':'← К карточке лида')+'</button>'+
  '<span class="muted small">Отдельный экран Estimator · '+esc(lead.title)+'</span></div>'+
  '<h1>Рассчитать смету</h1>'+
  (estimateUI.loaded!==false&&(!estimateUI.result?.estimate||estimateUI.result.estimate.status==='draft')?plumbingWizardMarkup():'')+
  '<details class="card plumbing-draft-expander"'+(plumbingDraftPanelOpen||!estimateUI.result?.estimate?' open':'')+
  '><summary><strong>'+(estimateUI.result?.estimate?.status==='accepted'?'Смета согласована':'Внутренняя смета · черновик')+
  '</strong><span class="muted small">Открыть детали и сохранение</span></summary>'+
  estimateView(lead)+'</details></div>';
}


// EST-PARITY-NAV: first-class navigation from the original Estimator.
// Preview never writes; associating a Lead enables the existing owner-only
// PostgreSQL Estimate draft/save flow without adding a financial writer.
var estimatorSubtab='calculator';
var estimatorCardState={loaded:false,loading:false,error:'',items:[],editor:null,requestKey:null,saving:false};
function estimatorCardCatalog(){return estimatorCardState.loaded?estimatorCardState.items:[];}
async function loadEstimatorCards(force=false){
 if(estimatorCardState.loading||(!force&&estimatorCardState.loaded))return;
 estimatorCardState.loading=true;estimatorCardState.error='';
 try{
  const response=await api('/api/estimator/cards');
  if(!response?.ready||!Array.isArray(response.items)||response.items.length<12||
     response.items.some(x=>!x||typeof x.cardKey!=='string'||typeof x.displayName!=='string'))
   throw Error('Ответ каталога карточек не подтверждён.');
  estimatorCardState.items=response.items;estimatorCardState.loaded=true;
 }catch(error){estimatorCardState.error=String(error.message||error);}
 finally{
  estimatorCardState.loading=false;
  if(tab==='estimator'&&estimatorSubtab==='cards')render();
 }
}
function estimatorStartEditor(cardKey=''){
 const source=cardKey?estimatorCardState.items.find(c=>c.cardKey===cardKey):null;
 if(cardKey&&!source){message('Карточка не найдена. Обнови список.',true);return;}
 if(source?.status==='archived'){message('Архивная карточка доступна только для просмотра.',true);return;}
 estimatorCardState.requestKey=null;
 estimatorCardState.editor=source?{...source,materials:(source.materials||[]).map(x=>({...x}))}:
  {cardKey:'',revision:0,sourceType:'USER',status:'active',displayName:'',category:'OTHER',
   unit:'шт',supportsWater:false,supportsSewer:false,supportsInstall:true,
   waterPoints:0,sewerPoints:0,notes:'',recipeMode:'OWNER_OVERRIDE',materials:[]};
 render();
 $('#estimatorCardEditor')?.scrollIntoView({block:'start',behavior:'smooth'});
}
function estimatorCaptureCardEditor(){
 const form=$('#estimatorCardForm'),editor=estimatorCardState.editor;
 if(!form||!editor)throw Error('Редактор карточки недоступен.');
 editor.displayName=form.elements.namedItem('displayName')?.value||'';
 editor.category=form.elements.namedItem('category')?.value||'OTHER';
 editor.unit=form.elements.namedItem('unit')?.value||'шт';
 editor.supportsWater=form.elements.namedItem('supportsWater')?.checked===true;
 editor.supportsSewer=form.elements.namedItem('supportsSewer')?.checked===true;
 editor.supportsInstall=form.elements.namedItem('supportsInstall')?.checked===true;
 editor.waterPoints=form.elements.namedItem('waterPoints')?.value||'0';
 editor.sewerPoints=form.elements.namedItem('sewerPoints')?.value||'0';
 editor.notes=form.elements.namedItem('notes')?.value||'';
 editor.recipeMode=editor.sourceType==='SYSTEM'?(form.elements.namedItem('recipeMode')?.value||'SOURCE'):'OWNER_OVERRIDE';
 editor.materials=(editor.materials||[]).map((_,i)=>({
  name:form.elements.namedItem('materialName_'+i)?.value||'',
  quantity:form.elements.namedItem('materialQty_'+i)?.value||'',
  unit:form.elements.namedItem('materialUnit_'+i)?.value||'шт',
  section:form.elements.namedItem('materialSection_'+i)?.value||''
 }));
 return editor;
}
function estimatorCardEditorMarkup(){
 const d=estimatorCardState.editor;
 if(!d)return '';
 const isSystem=d.sourceType==='SYSTEM';
 const field=(name,title,value,other='')=>'<label>'+esc(title)+'<input name="'+name+'" '+other+' value="'+esc(value??'')+'"></label>';
 const check=(name,title,flag)=>'<label class="plumbing-choice"><input type="checkbox" name="'+name+'"'+(flag?' checked':'')+'>'+title+'</label>';
 const materialsLocked=isSystem&&d.recipeMode==='SOURCE';
 const matRows=(d.materials||[]).map((m,i)=>
  '<article class="estimator-material-edit">'+
   field('materialName_'+i,'Материал',m.name,'maxlength="120"'+(materialsLocked?' disabled':''))+
   '<div class="grid">'+field('materialQty_'+i,'Количество на прибор',m.quantity,'inputmode="decimal"'+(materialsLocked?' disabled':''))+
   field('materialUnit_'+i,'Единица',m.unit,'maxlength="30"'+(materialsLocked?' disabled':''))+'</div>'+
   field('materialSection_'+i,'Раздел',m.section,'maxlength="80"'+(materialsLocked?' disabled':''))+
   '<button type="button" data-estimator-material-remove="'+i+'"'+(materialsLocked?' disabled':'')+'>Удалить материал</button></article>'
 ).join('');
 return '<section class="card estimator-card-editor" id="estimatorCardEditor" aria-label="Редактор карточки">'+
  '<h2>'+(d.cardKey?'Изменить карточку':'Новая карточка')+'</h2>'+
  (isSystem?'<p class="muted">Системный код '+esc(d.cardKey)+' сохраняется. Изменения записываются отдельной настройкой владельца.</p>':'')+
  '<form id="estimatorCardForm" class="grid">'+
   field('displayName','Название',d.displayName,'maxlength="120" required')+
   field('category','Категория (например SANITARY)',d.category,'maxlength="40"')+
   field('unit','Единица прибора',d.unit,'maxlength="30"')+
   '<div class="wide estimator-card-actions">'+check('supportsWater','Монтаж воды',d.supportsWater)+
    check('supportsSewer','Монтаж канализации',d.supportsSewer)+
    check('supportsInstall','Установка прибора',d.supportsInstall)+'</div>'+
   field('waterPoints','Точек воды на один прибор',d.waterPoints,'inputmode="numeric"')+
   field('sewerPoints','Точек канализации на прибор',d.sewerPoints,'inputmode="numeric"')+
   '<label class="wide">Примечание<textarea name="notes" maxlength="1000">'+esc(d.notes||'')+'</textarea></label>'+
   (isSystem?'<label class="wide">Рецепт материалов<select name="recipeMode">'+
    '<option value="SOURCE"'+(d.recipeMode==='SOURCE'?' selected':'')+'>Исходный системный рецепт</option>'+
    '<option value="OWNER_OVERRIDE"'+(d.recipeMode==='OWNER_OVERRIDE'?' selected':'')+'>Мой список материалов</option></select></label>':
    '<p class="muted wide">Для своей карточки можно создать собственный список материалов.</p>')+
   '<div class="wide"><h3>Материалы на один прибор</h3>'+matRows+
    '<button type="button" data-estimator-material-add'+(materialsLocked?' disabled':'')+'>+ Добавить материал</button>'+
    '<p class="muted small">Не включай расход трасс и закупочную цену, пока они не проверены.</p></div>'+
   '<div class="actions wide"><button type="button" class="primary" data-estimator-card-save'+(estimatorCardState.saving?' disabled':'')+
    '>Сохранить карточку</button><button type="button" data-estimator-card-cancel>Отмена</button></div>'+
   '</form></section>';
}
async function estimatorSubmitCard(type,payload){
 if(estimatorCardState.saving)return;
 estimatorCardState.saving=true;
 const key=estimatorCardState.requestKey||crypto.randomUUID();
 estimatorCardState.requestKey=key;
 try{
  const out=await api('/api/action',{type,payload:{...payload,requestKey:key}});
  if(!out.saved)throw Error('Сервер не подтвердил изменение карточки.');
  estimatorCardState.requestKey=null;estimatorCardState.editor=null;
  estimatorCardState.loaded=false;
  await loadEstimatorCards(true);
  if(tab==='estimator'){render();message('Карточка сохранена в PostgreSQL.');}
 }catch(error){message('Карточка не сохранена: '+String(error.message||error)+'. Проверь запись перед повтором.',true);}
 finally{estimatorCardState.saving=false;}
}


// EST-PRICES-01. Owner-wide Estimate pricebook is separate from owner-per-quote prices.
var estimatorPriceState={loaded:false,loading:false,error:'',profiles:[],rules:[],
 module:null,selectedCardKey:'WC',requestKey:null,saving:false};
function estimatorPricebookSnapshot(){
 return {profiles:estimatorPriceState.profiles,rules:estimatorPriceState.rules};
}
async function loadEstimatorPricebook(force=false){
 if(estimatorPriceState.loading||(!force&&estimatorPriceState.loaded))return;
 estimatorPriceState.loading=true;estimatorPriceState.error='';
 try{
  const [module,response]=await Promise.all([
   import('/estimate-pricebook.mjs'),api('/api/estimator/pricebook')
  ]);
  if(!response?.ready||!Array.isArray(response.profiles)||response.profiles.length!==3||
     !Array.isArray(response.rules)||response.profiles.some(x=>!x?.tariffCode))
   throw Error('Каталог цен не прошёл проверку ответа.');
  estimatorPriceState.module=module;
  estimatorPriceState.profiles=response.profiles;
  estimatorPriceState.rules=response.rules;
  estimatorPriceState.loaded=true;
 }catch(error){
  estimatorPriceState.error=String(error?.message||error);
  estimatorPriceState.loaded=false;
 }finally{
  estimatorPriceState.loading=false;
  if(tab==='estimator'&&estimatorSubtab==='prices')render();
 }
}
function estimatorPriceRule(actionType,cardKey=''){
 if(!estimatorPriceState.loaded||!estimatorPriceState.module)return null;
 return estimatorPriceState.module.pricebookRule(estimatorPricebookSnapshot(),actionType,cardKey);
}
function estimatorPriceRowMarkup(actionType,cardKey,title){
 const scope=actionType==='FIXTURE_INSTALL'?'CARD_ACTION':'GLOBAL_ACTION';
 const rule=estimatorPriceRule(actionType,cardKey),book=estimatorPricebookSnapshot();
 const isCard=scope==='CARD_ACTION',ref=plumbingUI.module?.estimatorLegacyEconomyPrice(actionType,cardKey)??null;
 const bookModule=estimatorPriceState.module;
 const panel=(tariff)=>{
  const data=bookModule.resolveEstimatorUnitPrice(book,{actionType,cardKey,tariff,
   legacyEconomy:ref,legacyPriceMode:'NOT_CONFIGURED'});
  return data.price===null?'Не настроена':estimateAMD(data.price)+
   (data.floorEffective?' · минимум':'')+
   (data.origin==='LEGACY_REFERENCE'?' · историческая':'');
 };
 const val=(v)=>v===null||v===undefined?'':String(v);
 const makeInput=(name,label,value,placeholder='')=>'<label>'+esc(label)+
  '<input name="'+name+'" type="text" inputmode="numeric" maxlength="10" value="'+esc(val(value))+
  '" placeholder="'+esc(placeholder)+'"></label>';
 const key=(isCard?cardKey:actionType);
 return '<section class="estimator-price-rule" data-est-price-rule="'+esc(key)+'" data-action-type="'+esc(actionType)+'"'+
  ' data-card-key="'+esc(cardKey)+'"><h3>'+esc(title)+'</h3>'+
  '<p class="muted small">Справка: '+(ref===null?'цена не задана':estimateAMD(ref))+
  ' · текущая версия '+esc(rule?.revision??0)+'</p>'+
  '<div class="estimator-price-fields">'+
   makeInput('economy','Economy база (AMD)',rule?.economyBaseAMD,'историческая цена')+
   makeInput('standard','Standard+ минимум (AMD)',rule?.standardFloorAMD,'без минимума')+
   makeInput('vip','VIP минимум (AMD)',rule?.vipFloorAMD,'без минимума')+
  '</div><p class="muted small">Расчёт: Economy '+esc(panel('ECONOM'))+
  ' · Standard+ '+esc(panel('STANDARD_PLUS'))+' · VIP '+esc(panel('VIP'))+'</p>'+
  '<button type="button" data-est-price-save="'+esc(actionType)+'" data-est-price-card="'+esc(cardKey)+
  '" class="primary"'+(estimatorPriceState.saving?' disabled':'')+'>Сохранить цену</button></section>';
}
function estimatorPriceEditorMarkup(){
 const state=estimatorPriceState,book=estimatorPricebookSnapshot();
 if(!state.loaded||!state.module)return '<section class="card"><h2>Редактор цен</h2><p role="status">'+
  esc(state.error||'Загружаю общий прайс…')+'</p><button type="button" data-est-price-retry>'+
  'Повторить загрузку</button></section>';
 const profileRows=['ECONOM','STANDARD_PLUS','VIP'].map(code=>{
  const p=state.module.pricebookProfile(book,code);
  return '<div class="estimator-price-rule" data-est-price-profile="'+code+'"><h3>'+
   ({ECONOM:'Economy',STANDARD_PLUS:'Standard+',VIP:'VIP'}[code])+'</h3>'+
   '<div class="estimator-price-fields">'+
   '<label>Коэффициент к Economy<input name="multiplier" inputmode="decimal" value="'+esc(p.multiplier)+
   '"'+(code==='ECONOM'?' readonly':'')+'></label>'+
   '<label>Округление (AMD)<input name="roundingStep" inputmode="numeric" value="'+esc(p.roundingStep)+'"></label>'+
   '</div><button type="button" data-est-profile-save="'+code+'"'+(state.saving?' disabled':'')+
   '>Сохранить коэффициент</button><p class="muted small">Версия '+esc(p.revision)+'</p></div>';
 }).join('');
 const globals=[
  ['WATER','Монтаж воды · AMD/точка'],
  ['SEWER','Монтаж канализации · AMD/точка'],
  ['CHASING','Штробление · AMD/м']
 ].map(([code,title])=>estimatorPriceRowMarkup(code,'',title)).join('');
 const options=plumbingUI.module?.listPlumbingItems(estimatorCardCatalog())||[];
 const key=options.some(x=>x.cardKey===state.selectedCardKey)?state.selectedCardKey:options[0]?.cardKey||'WC';
 state.selectedCardKey=key;
 const selected=options.find(x=>x.cardKey===key);
 const cardSelect='<label>Карточка установки<select data-est-price-card-select>'+
  options.map(x=>'<option value="'+esc(x.cardKey)+'"'+(key===x.cardKey?' selected':'')+'>'+
   esc(x.displayName)+'</option>').join('')+'</select></label>';
 return '<section class="card" aria-label="Редактор общих цен">'+
  '<h2>Общий прайс Estimator</h2>'+
  '<p class="muted">Цены сохраняются в PostgreSQL и применяются только к новым расчётам.'+
  ' Сохранённые сметы не пересчитываются. Цена, введённая вручную для сметы, всегда имеет приоритет.</p>'+
  '<p class="muted small">Economy — база; Standard+/VIP = максимум (Economy × коэффициент с округлением, вручную заданный минимум). При снижении базовой цены сохранённый минимум снова действует автоматически.</p>'+
  '<h3>Коэффициенты тарифов</h3>'+profileRows+
  '<h3>Общие виды работ</h3>'+globals+
  '<h3>Установка прибора</h3>'+cardSelect+
  (selected?estimatorPriceRowMarkup('FIXTURE_INSTALL',key,selected.displayName):'<p>Нет активных карточек.</p>')+
  '<p class="muted small">Системные значения от 30.08.2026 остаются историческим справочником до установки собственной цены. Подтверди применение цены при расчёте.</p></section>';
}
async function estimatorSubmitPrice(type,payload){
 if(estimatorPriceState.saving)return;
 estimatorPriceState.saving=true;
 const requestKey=estimatorPriceState.requestKey||crypto.randomUUID();
 estimatorPriceState.requestKey=requestKey;
 try{
  const result=await api('/api/action',{type,payload:{...payload,requestKey}});
  if(!result.saved)throw Error('Сервер не подтвердил сохранение цены.');
  estimatorPriceState.requestKey=null;
  estimatorPriceState.loaded=false;
  plumbingWizard.preview=null;plumbingWizard.pricedResult=null;plumbingWizard.step=1;
  await loadEstimatorPricebook(true);
  if(!estimatorPriceState.loaded)throw Error(estimatorPriceState.error||'Не удалось проверить сохранённый прайс.');
  message('Прайс сохранён в PostgreSQL. Новые расчёты будут учитывать изменение.');
 }catch(error){
  message('Не удалось подтвердить сохранение цен: '+String(error?.message||error)+
   '. Проверь прайс перед повтором.',true);
 }finally{estimatorPriceState.saving=false;}
}

function estimatorSaveVisibleWizard(){
 if(plumbingWizard.step===1&&$('#pwSelect')){
  const form=$('#pwSelect');
  const anyCard=[...form.querySelectorAll('[data-pw-pick]')].some(node=>node.checked);
  const anySpecial=form.querySelector('[name=pwChasing]')?.checked||form.querySelector('[name=pwExtraMaterials]')?.checked;
  if(anyCard||anySpecial)plumbingCaptureSelection();
  else{
   plumbingWizard.cards={};plumbingWizard.tariff=form.querySelector('[name=pwTariff]').value;
   plumbingWizard.chasing=false;plumbingWizard.extraMaterials=false;
  }
 }
 else if(plumbingWizard.step===2&&$('#pwConfig'))plumbingCaptureConfig();
 else if(plumbingWizard.step===3&&$('#pwPriceEditor')&&plumbingWizard.preview&&plumbingUI.module){
  const f=$('#pwPriceEditor'),rows=plumbingUI.module.plumbingQuoteRows(plumbingWizard.preview),values={};
  rows.works.forEach((row,i)=>{values[row.key]=String(f.elements.namedItem('pwWorkPrice_'+i)?.value??'').trim();});
  rows.materials.forEach((row,i)=>{values[row.key]=String(f.elements.namedItem('pwMaterialPrice_'+i)?.value??'').trim();});
  plumbingWizard.quotePrices=values;plumbingWizard.pricedResult=null;
 }
 estimateCaptureForm();
}
function estimatorView(){
 const active=estimatorSubtab;
 const nav='<nav class="estimator-legacy-tabs" aria-label="Вкладки калькуляции">'+
  [['calculator','Расчёт'],['prices','Цены'],['cards','Карточки']].map(([code,title])=>
   '<button type="button" data-estimator-subtab="'+code+'" class="'+(active===code?'active':'')+
   '" aria-current="'+(active===code?'page':'false')+'">'+title+'</button>').join('')+'</nav>';
 const head='<header class="estimator-section-head"><h1>Калькуляция</h1>'+
  '<p class="muted">Смета сантехнических работ · старый Estimator</p></header>'+nav;
 const mod=plumbingUI.module;
 if(!mod)return head+'<section class="card"><p class="muted" role="status">'+
  esc(plumbingUI.error||'Загружаю карточки и правила расчёта…')+'</p>'+
  (plumbingUI.error?'<button type="button" data-estimator-retry>Повторить загрузку</button>':'')+'</section>';
 const items=mod.listPlumbingItems(typeof estimatorCardCatalog==='function'?estimatorCardCatalog():[]);
 if(active==='prices'){
  if(typeof estimatorPriceState!=='undefined'){
   if(estimatorPriceState.loaded)return head+estimatorPriceEditorMarkup();
   return head+'<section class="card" aria-label="Общий прайс"><h2>Общий прайс Estimator</h2>'+
    '<p class="muted" role="status">'+esc(estimatorPriceState.error||'Загружаю цены из PostgreSQL…')+'</p>'+
    '<button type="button" data-est-price-retry>Повторить загрузку</button></section>';
  }
  const rate=(key,tariff)=>{
   const res=mod.calculatePlumbingEstimate({cardKey:key,tariff,quantity:1,
    coldWaterPoints:0,hotWaterPoints:0,sewerPoints:0,chasingMeters:0,
    install:true,includeMaterials:false,applyFixedReferencePrices:false});
   const line=res.lines.find(x=>x.sourceAction==='FIXTURE_INSTALL');
   return line?.suggestedUnitPriceAMD===null?'—':
    estimateAMD(line.suggestedUnitPriceAMD)+(line?.priceMode==='FROM'?' · от':'');
  };
  const rows=items.filter(x=>!x.cardKey.startsWith('USR:')).map(x=>'<tr><th scope="row">'+esc(x.displayName)+'</th>'+
   ['ECONOM','STANDARD_PLUS','VIP'].map(t=>'<td>'+esc(rate(x.cardKey,t))+'</td>').join('')+'</tr>').join('');
  return head+'<section class="card" aria-label="Справочные цены"><h2>Цены и тарифы</h2>'+
   '<p class="muted">Исторические цены от 30.08.2026, не текущий прайс и не подтверждённые стоимости. Изменять цену для одной сметы можно на этапе «Действия» и в итоговом редакторе.</p>'+
   '<p class="muted">Economy × 1 · Standard+ × 1,25 · VIP × 1,5. Штробление — ручная цена за метр.</p>'+
   '<div class="estimator-price-scroll"><table><thead><tr><th>Прибор</th><th>Economy</th><th>Standard+</th><th>VIP</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
   '<p class="muted small">Общий редактируемый прайс старого VBOS ещё не перенесён. Здесь нет сохранения глобальных цен.</p></section>';
 }
 if(active==='cards'){
  const state=typeof estimatorCardState!=='undefined'?estimatorCardState:{loaded:false,loading:false,error:'',items:[],editor:null};
  const list=state.loaded?state.items:items.map(x=>({...x,sourceType:'SYSTEM',status:'active',revision:0}));
  const cards=list.map(x=>{
   const archived=x.status==='archived';
   const p=archived?x:mod.plumbingStandardForCard(x.cardKey,typeof estimatorCardCatalog==='function'?estimatorCardCatalog():[]);
   return '<article class="estimator-source-card"><h3>'+esc(x.displayName)+'</h3>'+
    '<p class="muted">'+(x.sourceType==='USER'?'Моя карточка':'Системная карточка')+
    ' · '+esc(x.category||'')+(archived?' · Архив':'')+'</p>'+
    '<p class="muted">Вода: '+(p.supportsWater?esc(p.waterPoints)+' точек':'нет')+
    ' · Канализация: '+(p.supportsSewer?esc(p.sewerPoints)+' точек':'нет')+
    ' · Материалы: '+esc(x.materialStatus||'NOT_CONFIGURED')+'</p>'+
    (archived?'':('<button type="button" data-estimator-use-card="'+esc(x.cardKey)+'">Выбрать в расчёт</button>'))+
    (state.loaded&&!archived?'<button type="button" data-estimator-card-edit="'+esc(x.cardKey)+'">Редактировать</button>':'')+
    (state.loaded&&x.sourceType==='USER'&&!archived?'<button type="button" data-estimator-card-archive="'+esc(x.cardKey)+'">Архивировать</button>':'')+
    (state.loaded&&x.sourceType==='SYSTEM'&&x.hasOverride?'<button type="button" data-estimator-card-reset="'+esc(x.cardKey)+'">Вернуть системные значения</button>':'')+
    '</article>';
  }).join('');
  return head+'<section class="card" aria-label="Карточки приборов"><h2>Карточки</h2>'+
   '<p class="muted">Системные карточки старого Estimator сохраняют код. Мои карточки и материалы можно редактировать отдельно.</p>'+
   (state.error?'<p class="error" role="alert">'+esc(state.error)+'</p>':'')+
   (state.loading?'<p class="muted">Загружаю карточки…</p>':'')+
   (state.loaded?'<button type="button" class="primary" data-estimator-card-new>+ Новый прибор</button>':'')+
   '<div class="estimator-card-grid">'+cards+'</div></section>'+
   (state.editor?estimatorCardEditorMarkup():'');
 }
 const lead=estimateUI.leadId?(data.leads||[]).find(x=>x.id===estimateUI.leadId):null;
 if(lead)return head+plumbingWorkspace(lead);
 const leads=data.leads||[];
 const chooser='<section class="card estimator-lead-chooser" aria-label="Лид для сохранения">'+
  '<h2>Сохранение и открытие сметы</h2>'+
  '<p class="muted">Можно рассчитать сразу. Чтобы сохранить результат и открыть его позже, выбери лид: для каждого лида хранится одна смета.</p>'+
  (leads.length?'<label>Выбери лид<select id="estimatorLeadId">'+
    '<option value="">Выбрать обращение…</option>'+
    leads.map(l=>'<option value="'+esc(l.id)+'">'+esc(l.title)+' · '+esc(label[l.status]||l.status)+'</option>').join('')+
    '</select></label><button class="primary" type="button" data-estimator-bind>Открыть смету лида</button>':
   '<p class="muted">Лидов пока нет. Создай обращение через CRM, затем вернись сюда для сохранения.</p>')+
  '<button type="button" data-estimator-create-lead>+ Новый лид в CRM</button></section>';
 return head+chooser+plumbingWizardMarkup();
}

function estimateAMD(x){
 const s=String(x??'0').trim(),m=s.match(/^(-?)(\d+)(?:\.(\d+))?$/);
 if(!m)return '—';
 const n=m[2].replace(/\B(?=(\d{3})+(?!\d))/g,' ');
 const decimal=(m[3]||'').replace(/0+$/,'');
 return (m[1]||'')+n+(decimal?','+decimal:'')+' AMD';
}
function estimateCaptureForm(){
 const f=$('#estimateDraftEditor');if(!f||!estimateUI.editor)return;
 const d=Object.fromEntries(new FormData(f).entries());
 const editor=estimateUI.editor;
 editor.title=d.title??editor.title;editor.notes=d.notes??editor.notes;
 editor.lines=editor.lines.map((line,i)=>({
  lineKey:line.lineKey,
  kind:d['estKind_'+i]||line.kind,
  description:d['estDescription_'+i]??line.description,
  quantity:d['estQuantity_'+i]??line.quantity,
  unit:d['estUnit_'+i]??line.unit,
  unitPriceAMD:d['estPrice_'+i]??line.unitPriceAMD??''
 }));
}
function estimateView(lead){
 if(estimateUI.leadId!==lead.id)return '';
 if(estimateUI.loading)return '<section class="card"><h3>Внутренняя смета</h3><p>Загружаю черновик…</p></section>';
 if(estimateUI.error)return '<section class="card"><h3>Смета пока недоступна</h3><p class="error">'+esc(estimateUI.error)+'</p><button type="button" data-estimate-retry>Повторить чтение</button></section>';
 if(!estimateUI.loaded)return '';
 const result=estimateUI.result||{},estimate=result.estimate;
 if(!estimate){
  if(lead.status==='lost')return '<section class="card"><p>У отклонённого обращения нет сметы. Создание отключено.</p></section>';
  return '<section class="card"><h3>Новый черновик сметы</h3><p class="muted small">Только внутренний расчёт. Без НДС, скидок, счёта, отправки клиенту или создания заказа.</p>'+
   '<form class="grid" data-act="estimate_create"><input type="hidden" name="leadId" value="'+esc(lead.id)+'">'+
   '<label>Название сметы<input name="title" maxlength="180" required value="'+esc('Смета · '+lead.title)+'"></label>'+
   '<label>Примечание<textarea name="notes" maxlength="4000" placeholder="Уточнения после осмотра"></textarea></label>'+
   '<button type="submit" class="primary wide">Создать черновик</button></form></section>';
 }
 const editor=estimateUI.editor;
 if(!editor)return '<section class="card">Загрузка черновика…</section>';
 const totals=result.totals||{};
 const summary='<div class="summary"><div class="card"><span>Работы · оценено</span><strong>'+estimateAMD(totals.laborKnownAMD)+'</strong></div>'+
  '<div class="card"><span>Материалы · оценено</span><strong>'+estimateAMD(totals.materialsKnownAMD)+'</strong></div>'+
  '<div class="card"><span>Промежуточный итог</span><strong>'+estimateAMD(totals.knownTotalAMD)+'</strong></div></div>';
 if(estimate.status==='accepted'){
  const items=(result.lines||[]).map((line,i)=>'<p class="muted small">'+(i+1)+'. '+esc(line.description)+
   ' · '+esc(line.quantity)+' '+esc(line.unit)+' × '+estimateAMD(line.unitPriceAMD)+
   ' = '+estimateAMD(line.lineTotalAMD)+'</p>').join('');
  return '<section class="card"><h3>Смета согласована</h3>'+
   '<p class="muted small">Версия '+esc(estimate.acceptedRevision||estimate.revision)+
   ' · Согласовано: '+esc(when(estimate.acceptedAt))+
   ' · Изменение согласованной сметы заблокировано.</p>'+summary+items+
   '<p><strong>Согласованный итог: '+estimateAMD(estimate.acceptedTotalAMD)+'</strong></p>'+
   (estimate.workOrderId?'<p>Создан открытый заказ: '+esc(estimate.workOrderId)+'</p>'+
    '<button type="button" data-estimate-order-open="'+esc(estimate.workOrderId)+'">Открыть заказ</button>':'<p class="error">Связанный заказ не найден. Обратись к диагностике.</p>')+
   '<p class="muted small">Никаких автоматических платежей, НДС, скидок и календарных назначений не создаётся.</p></section>';
 }
 const linked=(data.leadClientLinks||[]).find(link=>link.lead_id===lead.id);
 const eligibleObjects=linked?(data.objects||[]).filter(obj=>obj.client_id===linked.client_id&&(!linked.object_id||linked.object_id===obj.id)):[];
 const eligible=lead.status==='won'&&eligibleObjects.length>0&&totals.pricingComplete;
 const acceptPanel='<section class="card" aria-label="Согласование сметы"><h3>Согласование и создание заказа</h3>'+
  (eligible?'<form data-act="estimate_accept_handoff" class="grid">'+
   '<input type="hidden" name="estimateId" value="'+esc(estimate.id)+'">'+
   '<input type="hidden" name="revision" value="'+esc(estimate.revision)+'">'+
   select('objectId','Объект клиента',option(eligibleObjects,obj=>obj.name,'Выбери объект клиента'))+
   '<input type="hidden" name="confirm" value="ACCEPT_AND_CREATE_OPEN_ORDER">'+
   '<p class="muted small">Только после явного подтверждения будет создан один открытый заказ без даты, оплаты и проводок.</p>'+
   '<button class="primary wide" type="submit">Согласовать и создать заказ</button></form>':
   '<p class="muted small">Для согласования нужен завершённый лид со связанным клиентом, его объектом и полностью оценённая смета. Сначала сохрани последние изменения сметы.</p>')+'</section>';
 const lineForms=editor.lines.map((line,i)=>
  '<div class="card"><strong>Позиция '+(i+1)+'</strong>'+
  '<label>Тип<select name="estKind_'+i+'"><option value="WORK"'+(line.kind==='WORK'?' selected':'')+'>Работа</option><option value="MATERIAL"'+(line.kind==='MATERIAL'?' selected':'')+'>Материал</option></select></label>'+
  '<label>Наименование<input name="estDescription_'+i+'" maxlength="240" required value="'+esc(line.description)+'"></label>'+
  '<label>Количество<input type="text" inputmode="decimal" name="estQuantity_'+i+'" required value="'+esc(line.quantity)+'" placeholder="1 или 1.250"></label>'+
  '<label>Единица<input name="estUnit_'+i+'" maxlength="24" required value="'+esc(line.unit)+'"></label>'+
  '<label>Цена за единицу, AMD (можно оставить пустой)<input type="text" inputmode="numeric" name="estPrice_'+i+'" value="'+esc(line.unitPriceAMD??'')+'" placeholder="Не оценено"></label>'+
  '<button type="button" class="compact" data-estimate-remove="'+i+'">Удалить позицию из черновика</button></div>').join('');
 return '<section class="card"><h3>Внутренняя смета · черновик</h3>'+
  '<p class="muted small">Версия '+esc(estimate.revision)+' · AMD · Только внутренний расчёт. Статус лида и заказ не меняются.</p>'+
  summary+
  '<p class="'+(totals.pricingComplete?'muted':'error')+'">Позиции: '+(totals.lineCount||0)+'. Не оценено: '+(totals.unpricedCount||0)+'. '+
  (totals.pricingComplete?'Все строки имеют указанную цену.':'Итог не окончательный, пока есть строки без цены или нет строк.')+'</p>'+
  '<form id="estimateDraftEditor" data-act="estimate_save" class="grid">'+
  '<input type="hidden" name="estimateId" value="'+esc(estimate.id)+'">'+
  '<input type="hidden" name="revision" value="'+esc(estimate.revision)+'">'+
  '<label>Название<input name="title" maxlength="180" required value="'+esc(editor.title)+'"></label>'+
  '<label>Примечание<textarea name="notes" maxlength="4000">'+esc(editor.notes)+'</textarea></label>'+
  lineForms+
  '<button type="button" data-estimate-add class="compact"'+(editor.lines.length>=50?' disabled':'')+'>+ Добавить работу или материал</button>'+
  '<p class="muted small">Цена только вручную. При сохранении предыдущая версия остаётся в истории базы. НДС/скидки/оплата не рассчитываются.</p>'+
  '<button type="submit" class="primary wide">Сохранить изменения сметы</button></form></section>'+acceptPanel;
}
async function loadLeadEstimate(){
 const id=estimateUI.leadId;if(!id||estimateUI.loading)return;
 estimateUI.loading=true;estimateUI.error='';render();
 try{
  const result=await api('/api/estimates?leadId='+encodeURIComponent(id));
  if(estimateUI.leadId!==id)return;
  estimateUI.result=result;estimateUI.loaded=true;
  estimateUI.editor=result.estimate?{
   title:result.estimate.title,notes:result.estimate.notes||'',
   lines:(result.lines||[]).map(x=>({lineKey:x.lineKey,kind:x.kind,description:x.description,
    quantity:x.quantity,unit:x.unit,unitPriceAMD:x.unitPriceAMD??''}))
  }:null;
  if(result.estimate?.status==='draft'){void ensurePlumbingCalculator();void loadEstimatorCards();}
 }catch(e){if(estimateUI.leadId===id)estimateUI.error=e.message;}
 finally{if(estimateUI.leadId===id){estimateUI.loading=false;render();}}
}
// CRM-06A: one lazy, owner-only interaction history per opened Lead or Client.
let crmInteractionState={entityType:'',entityId:'',items:[],hasMore:false,nextCursor:null,loaded:false,loading:false,error:''};

/* CRM-23A — verified historic Google contact archive, never native CRM writes. */
let crmLegacyInteractionState={clientId:'',opened:false,loaded:false,loading:false,error:'',result:null};
function crmLegacyInteractionView(clientId){
 const a=crmLegacyInteractionState,active=a.opened&&a.clientId===clientId;
 let out='<section class="card" data-crm23-legacy-interactions><h2>Контакты старого VBOS</h2>'+
  '<p class="muted small">Архивные звонки и заметки показываются только при подтверждённой связи с клиентом. '+
  'Они доступны для просмотра, не изменяют текущий CRM и не создают повторных контактов.</p>'+
  '<button type="button" class="compact" data-crm23-open="'+esc(clientId)+'">'+
  (active?'Скрыть архив':'Показать старую историю')+'</button>';
 if(!active)return out+'</section>';
 if(a.loading)out+='<p class="muted">Загружаю архивные контакты…</p>';
 if(a.error)out+='<p class="error" role="alert">'+esc(a.error)+'</p>';
 const r=a.result;
 if(!a.loaded||!r)return out+'</section>';
 if(r.status!=='VERIFIED_READONLY'){
  return out+'<p class="muted" role="status">Старый архив контактов ещё не импортирован и не проверен. '+
   'Новые контакты из PostgreSQL сохраняются отдельно.</p></section>';
 }
 out+='<p class="small muted">В исходном архиве '+esc(r.archiveActivities)+
   ' реальных контактов; '+esc(r.unlinkedActivities)+
   ' пока не имеют подтверждённой связи с клиентом. Неизвестные связи не угадываются.</p>';
 if(!r.items.length)return out+'<p class="muted">Для этого клиента нет подтверждённых старых контактов.</p></section>';
 out+='<div class="crm23-archive-items">'+r.items.map(x=>
  '<details class="card crm23-archive-item"><summary><strong>'+
  esc(({call:'Звонок',message:'Сообщение',meeting:'Встреча',site_visit:'Осмотр',note:'Заметка',other:'Контакт'})[x.interactionType]||'Контакт')+
  ' · '+esc(x.contactOn)+'</strong><span>Архив</span></summary>'+
  '<p>'+esc(x.summary)+'</p>'+
  (x.nextAction?'<p class="small">Тогда планировалось: '+esc(x.nextAction)+
   (x.nextActionAt?' · '+esc(x.nextActionAt):'')+'</p>':'')+
  (x.notes?'<p class="small muted">'+esc(x.notes)+'</p>':'')+
  '<p class="muted small">Источник: старый VBOS · '+esc(x.historyStage==='before_client'?'До оформления клиента':x.historyStage==='repeat_lead'?'Повторное обращение':'Контакт клиента')+
  ' · только чтение</p></details>'
 ).join('')+'</div>';
 return out+'</section>';
}
async function loadCrm23LegacyInteractions(){
 const a=crmLegacyInteractionState;
 if(!a.opened||!a.clientId||a.loading)return;
 a.loading=true;a.error='';render();
 try{
  const r=await api('/api/crm/legacy-interactions?clientId='+encodeURIComponent(a.clientId));
  if(crmLegacyInteractionState!==a)return;
  if(r.clientId!==a.clientId||r.readonly!==true||
     r.source!=='LEGACY_GOOGLE_VERIFIED_READONLY'||!Array.isArray(r.items)||
     r.verifiedClientLinksOnly!==true||r.nativeHistoryUnaffected!==true)
    throw Error('Невозможно подтвердить источник исторических контактов.');
  a.result=r;a.loaded=true;
 }catch(e){if(crmLegacyInteractionState===a)a.error=e.message;}
 finally{if(crmLegacyInteractionState===a){a.loading=false;render();}}
}


/* CRM-20A: owner-only, lazy, READ-ONLY ClientAssessment history.
 * No calculation backfill or Google writes from the Client card.
 */
let clientAssessmentState={clientId:'',opened:false,loading:false,loaded:false,error:'',result:null};
function clientAssessmentView(clientId){
 const state=clientAssessmentState,active=state.opened&&state.clientId===clientId;
 let html='<section class="card" data-client-assessment-card><h2>Оценки клиента по заказам</h2>'+
  '<p class="muted small">Сохранённые оценки при закрытии заказов. Исторические оценки из старого VBOS доступны только для просмотра.</p>'+
  '<button type="button" class="compact" data-client-assessment-open="'+esc(clientId)+'">'+
   (active?'Скрыть историю оценок':'Открыть историю оценок')+'</button>';
 if(!active)return html+'</section>';
 if(state.loading)html+='<p class="muted">Загружаю сохранённые оценки…</p>';
 if(state.error)html+='<p class="error" role="alert">'+esc(state.error)+'</p>';
 const r=state.result;
 if(!state.loaded||!r)return html+'</section>';
 const risk={LOW_RISK:'Низкий риск',MEDIUM_RISK:'Средний риск',
  HIGH_RISK:'Высокий риск',UNKNOWN:'Не определён'};
 const average=r.average!==null&&r.average!==undefined?
  String(r.average).replace('.',',')+'/100':'Не рассчитана';
 html+='<div class="summary client-assessment-summary">'+
  '<div class="card"><span>Средний балл</span><strong>'+esc(average)+'</strong></div>'+
  '<div class="card"><span>Всего оценок</span><strong>'+esc(r.totalCount)+'</strong></div>'+
  '<div class="card"><span>Для среднего</span><strong>'+esc(r.scoredCount)+'</strong></div></div>';
 html+='<p class="muted small">Старый архив: '+esc(r.archiveCount)+
   ' · Новые оценки Clean: '+esc(r.nativeCount)+
   '. В среднее входят только полные, проверенные оценки. Недостающие баллы не восстанавливаются автоматически.</p>';
 if(r.archiveStatus!=='VERIFIED_READONLY')
  html+='<p class="error" role="alert">Исторический архив не подтверждён или временно недоступен. '+
   'Показана только новая история, средняя может быть неполной.</p>';
 if(!r.items.length)html+='<p class="muted">Сохранённых оценок по завершённым заказам пока нет.</p>';
 else html+='<div class="client-assessment-history">'+r.items.map(item=>{
  const riskText=risk[item.riskLabel]||'Не определён';
  const score=item.score===null?'Не рассчитан':String(item.score)+'/100';
  const desc=item.completionDate?'Завершён: '+esc(item.completionDate):'Дата завершения не указана';
  const origin=item.source==='VERIFIED_LEGACY_ARCHIVE'?'Архив старого VBOS · только просмотр':
   'Закрыт в VBOS Clean';
  const review=item.requiresScoreReview?' · Балл требует сверки по исходным факторам':
   (!item.scoreComplete?' · Неполная оценка':'');
  return '<details class="card client-assessment-item"><summary><strong>'+esc(item.orderTitle)+'</strong>'+
   '<span>'+esc(score)+'</span></summary>'+
   '<p class="muted small">'+desc+' · '+esc(origin)+'</p>'+
   '<p class="small">Риск: '+esc(riskText)+
   ' · Факторы: '+esc(item.knownFactors)+'/'+esc(item.totalFactors)+
   ' · Версия: '+esc(item.scoreVersion||'Не указана')+'</p>'+
   (review?'<p class="muted small">'+esc(review)+'</p>':'')+
   '</details>';
 }).join('')+'</div>';
 return html+'</section>';
}
async function loadClientAssessments(){
 const state=clientAssessmentState;
 if(!state.opened||!state.clientId||state.loading)return;
 state.loading=true;state.error='';render();
 try{
  const response=await api('/api/crm/client-assessments?clientId='+encodeURIComponent(state.clientId));
  if(clientAssessmentState!==state)return;
  if(response.clientId!==state.clientId||response.readonly!==true||
    response.source!=='CLEAN_NATIVE_PLUS_VERIFIED_LEGACY_ARCHIVE'||!Array.isArray(response.items))
   throw Error('Ответ сервера не соответствует выбранному клиенту.');
  state.result=response;state.loaded=true;
 }catch(error){if(clientAssessmentState===state)state.error=error.message;}
 finally{if(clientAssessmentState===state){state.loading=false;render();}}
}

function crmInteractionView(entityType,entityId){
 const active=crmInteractionState.entityType===entityType&&crmInteractionState.entityId===entityId;
 const state=crmInteractionState;
 let out='<section class="card" data-crm-interaction-card><h2>'+
  (entityType==='Client'?'Единая история клиента':'История контактов')+'</h2>'+
  (entityType==='Client'?'<p class="muted small">Контакты клиента и подтверждённо связанных обращений — в одном списке. Исторические Google-взаимодействия ещё не импортированы.</p>':'')+
  '<button class="compact" type="button" data-crm-interaction-open="'+esc(entityId)+
  '" data-crm-interaction-type="'+esc(entityType)+'">'+(active?'Скрыть историю':'Открыть историю и записать контакт')+'</button>';
 if(!active)return out+'</section>';
 if(state.loading&&!state.loaded)out+='<p class="muted">Загружается история контактов…</p>';
 if(state.error)out+='<p class="muted" role="alert">'+esc(state.error)+'</p>';
 if(state.loaded){
  const latest=state.items[0];
  out+='<p class="muted small">Последний назначенный следующий контакт: '+
   (latest?.nextActionOn?esc(latest.nextActionOn)+' · '+esc(latest.nextAction):'не указан в последней записи')+'</p>';
  out+='<form data-act="crm_interaction_add" class="grid">'+
   '<input type="hidden" name="entityType" value="'+esc(entityType)+'">'+
   '<input type="hidden" name="entityId" value="'+esc(entityId)+'">'+
   '<label>Вид контакта<select name="interactionType">'+
   [['call','Звонок'],['message','Сообщение'],['meeting','Переговоры'],['site_visit','Осмотр'],['note','Заметка'],['other','Другое']]
    .map(x=>'<option value="'+x[0]+'">'+x[1]+'</option>').join('')+'</select></label>'+
   '<label>Дата контакта<input type="date" name="contactOn" required value="'+esc(data?.today||'')+'"></label>'+
   '<label>Результат разговора<textarea name="summary" maxlength="1000" required></textarea></label>'+
   '<label>Следующее действие<input name="nextAction" maxlength="500" placeholder="Например, позвонить клиенту"></label>'+
   '<label>Дата следующего контакта<input type="date" name="nextActionOn"></label>'+
   '<label>Дополнительные заметки<textarea name="notes" maxlength="5000"></textarea></label>'+
   '<button class="primary wide" type="submit">Сохранить контакт в PostgreSQL</button></form>'+
   '<h3>Сохранённые взаимодействия</h3>';
  out+=state.items.length?state.items.map(x=>
   '<div class="card">'+(entityType==='Client'?
    '<p class="small muted">'+esc(({after_client:'Контакт клиента',converted_lead:'Связанный лид · преобразование',repeat_lead:'Повторное обращение'})[x.historyStage]||'Контакт')+
    (x.leadTitle?' · '+esc(x.leadTitle):'')+'</p>':'')+
   '<strong>'+esc(({call:'Звонок',message:'Сообщение',meeting:'Переговоры',site_visit:'Осмотр',note:'Заметка',other:'Другое'})[x.interactionType]||x.interactionType)+
   ' · '+esc(x.contactOn)+'</strong><p>'+esc(x.summary)+'</p>'+
   (x.nextAction?'<p class="small">Далее: '+esc(x.nextAction)+(x.nextActionOn?' · '+esc(x.nextActionOn):'')+'</p>':'')+
   (x.notes?'<p class="small muted">'+esc(x.notes)+'</p>':'')+
   '<p class="small muted">Записано: '+esc(when(x.createdAt))+'</p></div>'
  ).join(''):'<p class="muted">История ещё пуста.</p>';
  if(state.hasMore)out+='<button class="compact" type="button" data-crm-interaction-more'+(state.loading?' disabled':'')+'>Показать предыдущие контакты</button>';
  if(state.loading)out+='<p class="muted">Загружается…</p>';
 }
 return out+'</section>';
}
async function loadCrmInteractions(append=false){
 const state=crmInteractionState;
 if(!state.entityId||state.loading)return;
 state.loading=true;state.error='';render();
 try{
  let path='/api/crm/interactions?entityType='+encodeURIComponent(state.entityType)+
   '&entityId='+encodeURIComponent(state.entityId)+'&limit=20'+
   (state.entityType==='Client'?'&unified=1':'');
  if(append&&state.nextCursor)path+='&cursor='+encodeURIComponent(state.nextCursor);
  const out=await api(path);
  if(crmInteractionState!==state)return;
  if(out.entityId!==state.entityId||out.entityType!==state.entityType||
    (state.entityType==='Client'&&(out.unified!==true||out.coverage!=='CLEAN_LINKED_INTERACTIONS_ONLY')))
   throw Error('Ответ сервера относится к другой карточке или источнику истории.');
  state.items=append?state.items.concat(out.items):out.items;
  state.hasMore=out.hasMore;state.nextCursor=out.nextCursor;state.loaded=true;
 }catch(e){if(crmInteractionState===state)state.error=e.message;}
 finally{if(crmInteractionState===state){state.loading=false;render();}}
}



/* CRM-13A: legacy mobile workbench interaction model, canonical Clean authority.
   Select a focus category; quick actions OPEN a form, never auto-save CRM facts. */
let crmFocusFilter='noNext';
let crmAdvancedOpen=false;
let crmArchiveOpen=false;
let crmQuickAction={leadId:null,context:null,kind:null};
let crmDetailId=null;
let crmListScrollY=0;
let crmReminderEditorLeadId=null;
let crmFollowupState={loaded:false,loading:false,result:null,error:''};
const crmFollowupGroups=[
 ['overdue','Просрочено'],['today','Сегодня'],
 ['noNext','Без шага'],['stale','Зависшие']
];
function crmQuickForm(leadId,context){
 const q=crmQuickAction;
 if(q.leadId!==leadId||q.context!==context)return '';
 const kinds={call:['call','Позвонил',''],message:['message','Написал',''],no_answer:['call','Не ответил','Не ответил']};
 const chosen=kinds[q.kind];
 if(!chosen)return '';
 // CRM06A explicitly requires summary. A quick-button click only opens an
 // editable form; the existing audited action commits only after Save.
 return '<form class="crm-quick-form grid" data-act="crm_interaction_add" data-crm-quick-form-id="'+esc(leadId)+
  '" data-crm-quick-form-context="'+esc(context)+'" aria-label="Записать контакт">'+
  '<input type="hidden" name="entityType" value="Lead">'+
  '<input type="hidden" name="entityId" value="'+esc(leadId)+'">'+
  '<input type="hidden" name="interactionType" value="'+esc(chosen[0])+'">'+
  '<label>Дата контакта<input type="date" name="contactOn" value="'+esc(data?.today||'')+'" required></label>'+
  '<label class="wide">Результат: '+esc(chosen[1])+
  '<textarea name="summary" maxlength="1000" required placeholder="Что сообщил клиент?">'+esc(chosen[2])+'</textarea></label>'+
  '<p class="muted small wide">Пока ничего не записано. Контакт появится в истории только после сохранения.</p>'+
  '<div class="actions wide"><button class="primary" type="submit">Сохранить контакт</button>'+
  '<button type="button" data-crm-quick-cancel>Отмена</button></div></form>';
}
function crmQuickButtons(leadId,context){
 const kinds=[['call','Позвонил'],['message','Написал'],['no_answer','Не ответил']];
 return '<div class="crm-quick-actions">'+kinds.map(([kind,title])=>
  '<button type="button" data-crm-quick-lead="'+esc(leadId)+'" data-crm-quick-context="'+esc(context)+
  '" data-crm-quick-kind="'+esc(kind)+'">'+esc(title)+'</button>').join('')+
  '<button type="button" data-crm-reminder-open="'+esc(leadId)+'">Назначить напоминание</button></div>'+
  crmQuickForm(leadId,context);
}
function crmWorkbenchLead(item,context){
 // Focus and Priority use the SAME compact, read-only overview row.
 // The complete action set stays on the existing isolated Lead detail page.
 const lead=(data?.leads||[]).find(x=>x.id===item.leadId)||
  {id:item.leadId,title:item.title,contact_name:item.contactName||'',status:item.status||'new'};
 return crmCompactLeadRow(lead,{
  context,title:lead.title||item.title,contactName:item.contactName||'',
  score:item.winScore,status:lead.status||item.status||'new'
 });
}
function crmFollowupView(){
 const state=crmFollowupState;
 let out='<section class="card crm-focus-section" aria-label="Фокус CRM">'+
  '<div class="row"><div><h2>Фокус CRM</h2><p class="muted small">Кого нужно связаться и почему</p></div>'+
  '<button type="button" class="compact" data-crm-followup-refresh'+(state.loading?' disabled':'')+'>Обновить</button></div>';
 if(state.error)out+='<p role="alert" class="muted">'+esc(state.error)+'</p>';
 if(state.loading&&!state.loaded)out+='<p class="muted">Проверяем обращения…</p>';
 if(state.loaded&&state.result){
  const result=state.result;
  out+='<p class="muted small">Открытых лидов: '+fmt(result.openLeadCount)+
   ' · требуют внимания: '+fmt(result.attentionCount)+'</p>';
  out+='<div class="crm-focus-grid" role="group" aria-label="Группы внимания">'+
   crmFollowupGroups.map(([key,title])=>{
    const count=result.buckets[key]?.count||0;
    return '<button type="button" class="crm-focus-tile" data-crm-focus-filter="'+esc(key)+'" aria-pressed="'+(crmFocusFilter===key?'true':'false')+'">'+
     '<span>'+esc(title)+'</span><strong>'+fmt(count)+'</strong></button>';
   }).join('')+'</div>';
  const key=crmFollowupGroups.some(([id])=>id===crmFocusFilter)?crmFocusFilter:'noNext';
  const group=result.buckets[key];
  out+='<div class="crm-focus-results"><h3>'+esc(crmFollowupGroups.find(([k])=>k===key)[1])+' · '+fmt(group.count)+'</h3>';
  if(!group.items.length)out+='<p class="muted">В выбранной группе пока нет обращений.</p>';
  else out+=group.items.map(lead=>'<div class="crm-focus-item">'+
   crmWorkbenchLead(lead,'focus')+'</div>').join('');
  if(group.count>group.items.length)out+='<p class="muted small">Показаны '+group.items.length+' из '+fmt(group.count)+
   '. Другие обращения доступны в общем списке и поиске.</p>';
  out+='</div>';
 }else if(!state.loading)out+='<p class="muted small">Нажми «Обновить», чтобы проверить обращения в PostgreSQL.</p>';
 return out+'</section>';
}
function crmCapacitySignpost(){
 return '<section class="card crm-capacity-section" aria-label="Capacity">'+
  '<h2>Покрытие свободной Capacity</h2>'+
  '<p class="muted">В Clean пока нет проверенного расчёта свободных рабочих дней для CRM. Здесь не показываем вымышленные 14/30 дней и не оцениваем длительность заказа без источника.</p>'+
  '<button type="button" data-open-schedule>Открыть календарь работ</button>'+
  '<p class="muted small">Приоритет лида и возможность выполнить работу — разные показатели.</p></section>';
}
function crmPriorityView(){
 const state=crmFollowupState;
 let out='<section class="card crm-priority-section" aria-label="Приоритет сейчас"><div class="row"><div>'+
  '<h2>Приоритет сейчас</h2><p class="muted small">Сначала срочность, затем подтверждённый Win Score</p></div>'+
  '<button type="button" class="compact" data-crm-followup-refresh'+(state.loading?' disabled':'')+'>Обновить</button></div>';
 const priority=state.result?.priority;
 if(state.loaded&&priority?.version==='CRM11A_ATTENTION_SCORE_V1'&&priority?.source==='CANONICAL_CRM10A_SIGNALS_AND_CRM07_ATTENTION'&&priority.coverage?.complete===true){
  out+='<p class="muted small">Балл рассчитан: '+fmt(priority.scoreCoverage.ready)+
   ' · без этапа сделки: '+fmt(priority.scoreCoverage.unready)+'</p>';
  if(!priority.items.length)out+='<p class="muted">Сейчас нет обращений, требующих внимания.</p>';
  for(const item of priority.items){
   // Win Score is a 0–100 heuristic only; raw need summary is not exposed.
   out+=crmWorkbenchLead(item,'priority');
  }
  if(priority.count>priority.items.length)out+='<p class="muted small">Показаны '+fmt(priority.items.length)+' из '+fmt(priority.count)+
   ' обращений по приоритету.</p>';
 }else if(state.error)out+='<p class="muted">Ошибка списка: '+esc(state.error)+'</p>';
 else out+='<p class="muted">Приоритет появится после загрузки Фокуса CRM.</p>';
 return out+'</section>';
}
async function loadCrmFollowups(){
 const state=crmFollowupState;
 if(state.loading)return;
 state.loading=true;state.error='';
 if(tab==='crm')render();
 try{
  const result=await api('/api/crm/followups?limit=6');
  if(crmFollowupState!==state)return;
  if(result.version!=='CRM07A_READ_ONLY'||result.coverage?.complete!==true)throw Error('Список CRM не подтверждён сервером.');
  state.result=result;state.loaded=true;
 }catch(err){if(crmFollowupState===state)state.error=err.message;}
 finally{if(crmFollowupState===state){state.loading=false;if(tab==='crm')render();}}
}


/* CRM-08A: canonical current next action belongs to Lead, not CRM06 history. */
function crmReminderLocalTime(instant){
 if(!instant)return '';
 const t=new Date(instant);
 return Number.isFinite(t.getTime())?new Date(t.getTime()+14400000).toISOString().slice(0,16):'';
}
function crmReminderCard(lead){
 const active=['new','contacted','qualified'].includes(lead.status);
 const savedTime=crmReminderLocalTime(lead.next_action_at);
 let out='<details class="card" data-crm-reminder-details><summary>Следующее действие · '+esc(lead.next_action||'Не назначено')+
  (savedTime?' · '+esc(savedTime.replace('T',' ')):'')+'</summary>'+
  '<p class="muted small">Это текущее напоминание обращения. Дата и время создают один связанный пункт в календаре. История контактов хранится отдельно.</p>';
 if(active){
  out+='<form data-act="crm_reminder_save" class="grid">'+
   '<input type="hidden" name="leadId" value="'+esc(lead.id)+'">'+
   '<input type="hidden" name="revision" value="'+esc(lead.revision)+'">'+
   editText('nextAction','Следующее действие',lead.next_action||'','text','maxlength="500"')+
   editText('nextActionAt','Дата и время (необязательно)',savedTime,'datetime-local')+
   '<button type="submit" class="primary wide">Сохранить следующий контакт</button></form>';
  if(lead.next_action||lead.next_action_at)
   out+='<button type="button" class="compact" data-crm-reminder-clear="'+esc(lead.id)+'">Очистить действие и убрать напоминание</button>';
 }else out+='<p class="muted small">Обращение закрыто. Напоминания по нему не назначаются.</p>';
 return out+'</details>';
}


/* CRM-10A: owner-entered stage/source/need with on-demand factual Win Score. */
let crmSignalView={leadId:null,loading:false,signal:null,history:null,error:''};
const crmStageOptions=[
 ['new_contact','Новый контакт'],['needs_discussion','Нужно обсудить'],
 ['estimate_required','Нужна смета'],['estimate_sent','Смета отправлена'],
 ['negotiation','Переговоры'],['approved','Согласовано'],['rejected','Отказ']
];
const crmSourceOptions=[
 ['repeat_client','Повторный клиент'],['referral','Сарафан'],['partner','Партнёр'],
 ['facebook','Facebook'],['instagram','Instagram'],['google','Google'],
 ['whatsapp','WhatsApp'],['signboard','Вывеска'],['other','Другое']
];
function crmSignalChoices(name,labelText,choices,value){
 return '<label>'+esc(labelText)+'<select name="'+esc(name)+'"><option value="">Не указано</option>'+
  choices.map(([key,text])=>'<option value="'+esc(key)+'"'+(value===key?' selected':'')+'>'+esc(text)+'</option>').join('')+
  '</select></label>';
}
function crmLeadSignalCard(lead){
 const editable=['new','contacted','qualified'].includes(lead.status);
 const info=crmSignalView.leadId===lead.id?crmSignalView:null;
 let out='<section class="card" aria-label="Сигналы CRM"><h3>Сигналы · Win Score</h3>'+
  '<p class="muted small">Оценка по подтверждённым фактам, не вероятность продажи. Без этапа сделки балл не рассчитывается.</p>'+
  '<button type="button" class="compact" data-crm-signal-load="'+esc(lead.id)+'"'+(info?.loading?' disabled':'')+'>'+
   (info?.loading?'Загружаем сигналы…':'Показать сигналы и объяснение')+'</button>';
 if(info?.error)out+='<p role="alert" class="muted">'+esc(info.error)+'</p>';
 if(info?.signal){
  const signal=info.signal;
  const score=signal.winScore||{};
  out+='<p><strong>'+(score.ready?'Win Score '+esc(score.score)+'/100 · '+esc(score.bandLabel||''):'Win Score пока не рассчитан')+
   '</strong></p><p class="muted small">'+esc(score.coverage==='STAGE_REQUIRED'?'Укажи этап сделки, чтобы рассчитать балл.':
    score.coverage==='TERMINAL_LEAD'?'Обращение закрыто — балл не участвует в приоритизации.':
    'Модель CRM_WIN_SCORE_V1_100 · эвристика, не калиброванный процент')+'</p>';
  out+='<ul class="small">'+(score.reasons||[]).map(reason=>
    '<li>'+esc(reason.label)+' · '+(reason.points>0?'+':'')+esc(reason.points)+' баллов</li>').join('')+'</ul>';
  out+='<p class="muted small">Контакты: '+(signal.hasBusinessContact?'зафиксирован':'не найден в CRM-06A')+
   '. Показатель контакта — наличие, а не полное количество.</p>';
  const history=info.history;
  out+='<section aria-label="История Win Score"><h4>История Win Score</h4>';
  if(!history?.ready){
   out+='<p class="muted small">История пока недоступна ('+esc(history?.status||'UNAVAILABLE')+'). Текущая оценка остаётся доступной.</p>';
  }else{
   out+='<p class="muted small">Наблюдения начаты: '+esc(when(history.trackingSince))+
    '. История до этой даты неизвестна и не восстанавливается автоматически.</p>';
   if(!history.items?.length)out+='<p class="muted small">Снимков пока нет. Первый появится после сохранения изменения CRM с известным этапом сделки.</p>';
   else{
    if(history.latestScoreMovement){
     const d=Number(history.latestScoreMovement.delta);
     out+='<p class="muted small">Последнее изменение балла среди показанных: '+
      (d>0?'+':'')+esc(d)+' · '+esc(when(history.latestScoreMovement.at))+'</p>';
    }else out+='<p class="muted small">Подтверждённых изменений балла среди показанных снимков нет.</p>';
    out+='<ol class="small">'+history.items.map(item=>{
     const done=item.lead_status==='won'||item.lead_status==='lost';
     const value=done?(item.lead_status==='won'?'Завершён успешно':'Отказ · завершено'):
      item.score==null?'Без оценки':'Score '+esc(item.score)+'/100';
     const delta=item.score_delta==null?'':(' · изменение '+(item.score_delta>0?'+':'')+esc(item.score_delta));
     return '<li>'+esc(when(item.captured_at))+' · '+value+delta+
      ' · '+esc(item.capture_source)+'</li>';
    }).join('')+'</ol>';
    if(history.hasMore)out+='<p class="muted small">Показаны последние '+history.limit+' снимков; более ранние сохранены в PostgreSQL.</p>';
   }
  }
  out+='</section>';
 }
 if(editable){
  out+='<details class="edit-panel"><summary>Указать этап, источник и потребность</summary>'+
   '<form data-act="crm_signal_save" class="grid">'+
   '<input type="hidden" name="leadId" value="'+esc(lead.id)+'">'+
   '<input type="hidden" name="revision" value="'+esc(lead.revision)+'">'+
   crmSignalChoices('agreementStage','Этап сделки',crmStageOptions,lead.agreement_stage||'')+
   crmSignalChoices('sourceChannel','Источник обращения',crmSourceOptions,lead.source_channel||'')+
   editText('needSummary','Что нужно клиенту',lead.need_summary||'','textarea','maxlength="1000"')+
   '<button type="submit" class="primary wide">Сохранить данные сделки</button></form></details>';
 }
 return out+'</section>';
}
async function loadCrmLeadSignals(leadId){
 if(!data?.leads?.some(x=>x.id===leadId))return;
 const current={leadId,loading:true,signal:null,history:null,error:''};crmSignalView=current;
 if(tab==='crm')render();
 try{
  const out=await api('/api/crm/lead-signals?leadId='+encodeURIComponent(leadId));
  if(crmSignalView!==current)return;
  if(out.version!=='CRM10A_LEAD_SIGNALS'||out.signal?.leadId!==leadId)throw Error('Сервер вернул сигналы другого обращения.');
  current.signal=out.signal;
  current.history=out.history||{ready:false,status:'UNAVAILABLE',items:[]};
 }catch(err){if(crmSignalView===current)current.error=err.message;}
 finally{if(crmSignalView===current){current.loading=false;if(tab==='crm')render();}}
}


/* CRM-14A: dedicated in-app Lead view. Never expand the full editor in the
   CRM list, and do not open an extra browser tab/window on mobile. */
function openCrmLeadDetail(id,{reminder=false}={}){
 if(tab!=='crm'||!data?.leads?.some(x=>x.id===id)){
  message('Обращение не найдено в загруженном списке.',true);return;
 }
 if(!crmDetailId)crmListScrollY=window.scrollY||0;
 crmDetailId=id;
 crmReminderEditorLeadId=reminder?id:null;
 crmQuickAction={leadId:null,context:null,kind:null};
 message('');render();
 if(reminder){
  const editor=document.querySelector('[data-crm-detail-page] details[data-crm-reminder-details]');
  if(editor){editor.setAttribute('open','');editor.scrollIntoView({block:'start'});}
 }else window.scrollTo(0,0);
 // Use the existing authorized one-Lead GET: score and history remain factual.
 if(crmSignalView.leadId!==id||!crmSignalView.signal)void loadCrmLeadSignals(id);
}
function backToCrmLeads(){
 crmDetailId=null;
 crmReminderEditorLeadId=null;
 crmQuickAction={leadId:null,context:null,kind:null};
 message('');render();
 window.scrollTo(0,crmListScrollY);
}
function crmLeadScoreFromFocus(id){
 const result=crmFollowupState.result;
 if(!result)return null;
 // The canonical read-only response may include a lead in either section.
 const priority=result.priority?.items?.find(x=>x.leadId===id);
 if(priority?.winScore)return priority.winScore;
 for(const group of Object.values(result.buckets||{})){
  const row=group.items?.find(x=>x.leadId===id);
  if(row?.winScore)return row.winScore;
 }
 return null; // Never manufacture a score for an unscored/out-of-window lead.
}
function crmCompactClientIdentity(lead,fallback=''){
 // Resolve ONLY explicit persisted intake/conversion links, never name/phone guesses.
 const id=lead.id;
 const intake=(data?.leadIntakes||[]).find(x=>x.lead_id===id);
 const link=(data?.leadClientLinks||[]).find(x=>x.lead_id===id);
 const clientId=intake?.client_id||link?.client_id||'';
 const client=clientId?(data?.clients||[]).find(x=>x.id===clientId):null;
 if(client?.name)return {name:client.name,kind:'Клиент'};
 const contact=lead.contact_name||fallback;
 if(contact)return {name:contact,kind:'Контакт'};
 return {name:clientId?'Клиент вне загруженного списка':'Контакт не указан',
  kind:clientId?'Клиент':'Контакт'};
}
function crmCompactLeadRow(lead,{context='list',title=lead.title,contactName='',score=null,status=lead.status}={}){
 const identity=crmCompactClientIdentity(lead,contactName);
 const scoreValue=score?.ready===true&&typeof score.score==='number'&&
  Number.isFinite(score.score)&&score.score>=0&&score.score<=100?score.score:null;
 const action=context==='list'?'data-crm-lead-open':'data-crm-followup-lead';
 const marker=context==='list'?'data-crm-lead-card':'data-crm-work-lead';
 const statusText=label[status]||status||'Новый';
 const description=(title||'Без названия')+' · '+statusText;
 const scoreText=scoreValue===null?'Не рассчитан':String(scoreValue)+' из 100';
 return '<button type="button" class="crm-compact-lead" '+marker+'="'+esc(lead.id)+
  '" '+action+'="'+esc(lead.id)+'" aria-label="Открыть обращение. '+esc(identity.kind)+': '+
  esc(identity.name)+'. '+esc(title||'Обращение')+'. Win Score: '+esc(scoreText)+'">'+
  '<span class="crm-compact-info">'+
   '<strong class="crm-compact-name">'+esc(identity.name)+'</strong>'+
   '<span class="crm-compact-description">'+esc(description)+'</span></span>'+
  '<span class="crm-compact-score"'+(scoreValue===null?' data-unscored':'')+'>'+
   '<strong>'+ (scoreValue===null?'—':esc(scoreValue)+'%')+'</strong>'+
   '<span>Win Score</span></span></button>';
}
function crmLeadEntry(x){
 return crmCompactLeadRow(x,{score:crmLeadScoreFromFocus(x.id)});
}

/* CRM-25A: external Masters directory. Workers remain a separate entity. */
const masterStatuses=[['active','Активен'],['unavailable','Недоступен'],['archived','В архиве']];
const masterQualities=[['','Без оценки'],['normal','Обычный'],['good','Хороший'],['problematic','Проблемный']];
const masterMessengers=[['none','Нет'],['whatsapp','WhatsApp'],['viber','Viber'],['telegram','Telegram'],['other','Другой']];
function masterSelect(name,labelText,values,selected){
 return select(name,labelText,values.map(([v,text])=>
  '<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(text)+'</option>').join(''));
}
function crmMasterFields(m={}){
 return formField('name','Имя мастера','text',true,'maxlength="300" value="'+esc(m.name||'')+'"')+
  formField('phone','Телефон','tel',false,'maxlength="100" value="'+esc(m.phone||'')+'"')+
  formField('email','Email','email',false,'maxlength="200" value="'+esc(m.email||'')+'"')+
  formField('serviceArea','Регион работы','text',false,'maxlength="500" value="'+esc(m.service_area||'')+'"')+
  masterSelect('status','Статус',masterStatuses,m.status||'active')+
  masterSelect('qualityTier','Оценка работы',masterQualities,m.quality_tier||'')+
  masterSelect('messengerType','Мессенджер',masterMessengers,m.messenger_type||'none')+
  formField('messengerContact','Контакт мессенджера','text',false,'maxlength="300" value="'+esc(m.messenger_contact||'')+'"')+
  '<label>Примечания<textarea name="notes" maxlength="5000">'+esc(m.notes||'')+'</textarea></label>';
}
function crmMastersDirectory(){
 let out='<details class="card" data-crm-master-directory'+(crmMasters.opened?' open':'')+'><summary>Внешние мастера · справочник</summary>'+
  '<p class="muted small">Это внешние специалисты, не работники компании. '+
  'Исторические записи Google только для просмотра до согласованного перехода полномочий.</p>'+
  '<button type="button" class="compact" data-crm-master-load'+(crmMasters.loading?' disabled':'')+'>Обновить справочник</button>';
 if(crmMasters.error)out+='<p class="error" role="alert">'+esc(crmMasters.error)+'</p>';
 if(crmMasters.loaded){
  out+='<form id="crmMasterFilters" class="grid">'+
   editText('q','Поиск мастера или региона',crmMasters.q,'search','maxlength="80"')+
   select('status','Статус','<option value="">Все</option>'+
    masterStatuses.map(([v,t])=>'<option value="'+esc(v)+'"'+(crmMasters.status===v?' selected':'')+'>'+esc(t)+'</option>').join(''),false)+
   '<button class="compact" type="submit">Найти</button></form>'+
   (crmMasters.items.length?crmMasters.items.map(m=>{
    let out='<section class="card" data-crm-master-item="'+esc(m.id)+'"><strong>'+esc(m.name)+'</strong>'+
     '<p class="muted small">'+esc(masterStatuses.find(x=>x[0]===m.status)?.[1]||m.status)+
     ' · '+esc(m.service_area||'Регион не указан')+
     (m.phone?' · '+esc(m.phone):'')+'</p>'+
     '<p class="muted small">Оценка: '+esc(masterQualities.find(x=>x[0]===m.quality_tier)?.[1]||'Без оценки')+
     ' · '+esc(m.source_system==='LEGACY_GOOGLE'?'Источник: прежний VBOS':'Источник: VBOS Clean')+'</p>';
    if(m.source_system==='CLEAN_NATIVE'){
     out+='<details><summary>Изменить мастера</summary><form class="grid" data-act="crm_master_update">'+
      '<input type="hidden" name="masterId" value="'+esc(m.id)+'">'+
      '<input type="hidden" name="revision" value="'+esc(m.revision)+'">'+crmMasterFields(m)+
      '<button type="submit" class="primary wide">Сохранить мастера</button></form></details>';
    }
    return out+'</section>';
   }).join(''):'<p class="muted small">Совпадений нет.</p>')+
   (crmMasters.hasMore?'<button type="button" class="compact" data-crm-master-more>Показать ещё мастеров</button>':'');
 }
 out+=form('crm_master_create','+ Новый внешний мастер',crmMasterFields())+'</details>';
 return out;
}
async function loadCrmMasters(append=false){
 if(crmMasters.loading)return;
 crmMasters.loading=true;crmMasters.error='';
 try{
  const params=new URLSearchParams({limit:'50',q:crmMasters.q,status:crmMasters.status});
  if(append&&crmMasters.nextCursor)params.set('cursor',crmMasters.nextCursor);
  const result=await api('/api/crm/masters?'+params.toString());
  crmMasters.items=append?crmMasters.items.concat(result.items):result.items;
  crmMasters.hasMore=result.hasMore;crmMasters.nextCursor=result.nextCursor;crmMasters.loaded=true;
 }catch(err){crmMasters.error=err.message;}
 finally{crmMasters.loading=false;if(tab==='crm')render();}
}

/* CRM-22A manual external Master/recipient transfer; never map Workers. */
const leadTransferReasons=[
 ['no_time','Нет времени'],['not_my_specialty','Не моя специализация'],
 ['budget_mismatch','Бюджет не подходит'],['too_far','Слишком далеко'],
 ['different_specialist_needed','Нужен другой специалист'],
 ['do_not_want_order','Не хочу брать заказ'],['other','Другая причина']
];
function crmLeadTransferCard(lead){
 const t=(data?.leadTransfers||[]).find(x=>x.lead_id===lead.id);
 const reasonLabel=code=>leadTransferReasons.find(x=>x[0]===code)?.[1]||code;
 if(t)return '<section class="card" data-crm-transfer-receipt><h2>Передача лида</h2>'+
  '<p><strong>Передан: '+esc(t.recipient_name)+'</strong></p>'+
  '<p class="muted small">Причина: '+esc(reasonLabel(t.reason))+
  ' · Дата: '+esc(when(t.transferred_at))+'</p>'+
  (t.master_id?'<p class="muted small">Мастер выбран из внешнего справочника · ID: '+esc(t.master_id)+'</p>':'')+
  (t.comment?'<p class="small">'+esc(t.comment)+'</p>':'')+
  '<p class="muted small">История передачи · только VBOS Clean · повторно передавать нельзя. '+
  'Старые передачи Google ещё не импортированы.</p></section>';
 if(lead.status==='transferred')return '<section class="card"><h2>Передача лида</h2>'+
  '<p class="error">Лид передан, но квитанция не загружена. Обнови экран.</p></section>';
 if(!['new','contacted','qualified','lost'].includes(lead.status))return '';
 const choices='<option value="">Выбери причину</option>'+
  leadTransferReasons.map(([code,name])=>'<option value="'+esc(code)+'">'+esc(name)+'</option>').join('');
 const masters=crmMasters.loaded?
  select('masterId','Внешний мастер из справочника',option(
   crmMasters.items.filter(x=>x.status!=='archived'),
   x=>x.name+' · '+(x.service_area||'регион не указан')+(x.status==='unavailable'?' (недоступен)':''),
   'Получатель вручную (не выбирать мастера)'),false):
  '<p class="muted small">Справочник ещё не загружен. Можно передать по имени вручную.</p>';
 return '<details class="card" data-crm-lead-transfer'+(crmTransferOpenLeadId===lead.id?' open':'')+'><summary>↗ Передать лид мастеру</summary>'+
  '<p class="muted small">Выбери внешнего мастера либо введи имя вручную. Работник компании — не внешний мастер. '+
  'Передача необратима и отменяет запланированные напоминания.</p>'+
  '<form data-act="lead_transfer" class="grid">'+
   '<input type="hidden" name="leadId" value="'+esc(lead.id)+'">'+
   '<input type="hidden" name="revision" value="'+esc(lead.revision)+'">'+
   masters+
   '<button type="button" class="compact" data-crm-master-load'+(crmMasters.loading?' disabled':'')+'>Загрузить мастеров</button>'+
   (crmMasters.hasMore?'<p class="muted small">Показана часть справочника. Остальных найди через поиск в разделе «Внешние мастера».</p>':'')+
   formField('recipientName','Получатель вручную (если мастер не выбран)','text',true,'maxlength="300"')+
   '<label>Почему передан<select name="reason" required>'+choices+'</select></label>'+
   formField('comment','Комментарий','textarea',false,'maxlength="5000"')+
   '<button type="submit" class="primary wide">Подтвердить передачу</button>'+
  '</form></details>';
}
function crmLeadDetails(x){
 // All forms are the original CRM06/08/10/12 and Lead canonical writers.
 // Both Lead edit and explicit signal edit start opened on the standalone page.
 const leadFields=leadEdit(x).replace('<details class="edit-panel">','<details class="edit-panel" open>');
 const signals=crmLeadSignalCard(x).replace('<details class="edit-panel">','<details class="edit-panel" open>');
 const reminder=crmReminderEditorLeadId===x.id?crmReminderCard(x).replace('data-crm-reminder-details>','data-crm-reminder-details open>'):crmReminderCard(x);
 const active=['new','contacted','qualified'].includes(x.status);
 return '<div class="crm-detail-page" data-crm-detail-page="'+esc(x.id)+'">'+
  '<div class="crm-detail-top"><button type="button" data-crm-back>← К лидам</button>'+
   '<span class="muted small">Карточка обращения · редактирование</span></div>'+
  '<header class="card crm-detail-header"><h1>'+esc(x.title)+'</h1>'+
   '<span class="tag" data-status="'+esc(x.status)+'">'+esc(label[x.status]||x.status)+'</span>'+
   '<p class="muted small">'+esc(x.contact_name||'Контакт не указан')+
   (x.phone?' · '+esc(x.phone):'')+'</p></header>'+
  '<section class="card" aria-label="Основные данные лида"><h2>Основные данные</h2>'+
   '<p class="muted small">Изменения имени, контакта и заметок сохраняются отдельно от этапа сделки и напоминания.</p>'+
   (x.status==='transferred'?'<p class="muted small">Лид передан и закрыт для редактирования.</p>':leadFields)+'</section>'+
  '<section class="card" aria-label="Статус и действия"><h2>Статус и действия</h2>'+
   (x.status==='transferred'?'':statusButtons(x,'lead_status',['new','contacted','qualified','lost']))+
   (active?crmQuickButtons(x.id,'detail'):'')+
   crmIntakeTag(x)+
   (active?'<div class="actions"><button type="button" class="compact" data-plan-lead="'+esc(x.id)+'">Запланировать осмотр</button></div>':'')+
   crmLeadConversion(x)+'</section>'+crmLeadTransferCard(x)+
  reminder+signals+
  '<section class="card" aria-label="История контактов">'+crmInteractionView('Lead',x.id)+'</section>'+
  '<section class="card" aria-label="Осмотр и смета"><h2>Осмотр и смета</h2>'+
   '<div class="actions"><button type="button" class="compact" data-estimate-open="'+esc(x.id)+'">'+
    'Рассчитать'+'</button></div>'+
   crm04ResultCard(x)+'</section>'+
  '<div class="crm-detail-bottom"><button type="button" data-crm-back>← К лидам</button></div></div>';
}
function crmClientLeadContextView(){
 const id=crmClientLeadContext?.clientId;
 const client=(data?.clients||[]).find(item=>item.id===id)||
  (crmClientLeadContext?.clientSnapshot?.id===id?crmClientLeadContext.clientSnapshot:null);
 // Catalog result supplies display context beyond the /api/state 500-row window.
 // The existing PostgreSQL writer validates Client existence and archive state.
 const back='<button type="button" class="client-back" data-crm-client-lead-back>← К клиенту</button>';
 if(!client||client.status==='archived'||(data?.archivedLegacyClientIds||[]).includes(id))
  return '<div class="client-detail">'+back+
   '<section class="card"><h1>Новое обращение</h1><p role="alert">Клиент не найден или архивирован. Вернись к его карточке и обнови данные.</p></section></div>';
 const fields='<input type="hidden" name="clientId" value="'+esc(client.id)+'">'+
  formField('title','Лид / запрос','text',true,'maxlength="160" placeholder="Например, осмотр системы отопления"')+
  formField('contactName','Контактное лицо','text',false,'maxlength="160" value="'+esc(client.name)+'"')+
  formField('phone','Телефон','tel',false,'maxlength="60" value="'+esc(client.phone||'')+'"')+
  formField('notes','Примечание','textarea');
 return '<div class="client-detail" data-crm-client-lead-context="'+esc(client.id)+'">'+back+
  '<section class="card"><h1>Новое обращение</h1>'+
  '<p class="entity-detail-meta">Существующий клиент: <strong>'+esc(client.name)+'</strong></p>'+
  '<p class="muted small">Клиент будет связан с новым лидом без создания дубля. Контактное лицо и телефон можно уточнить. Объект сейчас не привязывается: для этого нужен отдельный сохраняемый контекст.</p>'+
  '<form data-act="lead_create" data-client-lead-form class="grid">'+fields+
  '<button type="submit" class="primary wide">Создать обращение</button></form></section></div>';
}
function crmView(){
 if(estimateWorkspaceOpen){
  const lead=data.leads.find(x=>x.id===estimateUI.leadId);
  return lead?plumbingWorkspace(lead):'<section class="card"><button type="button" data-estimate-back>← К лидам</button><p>Лид не найден.</p></section>';
 }
 if(crmClientLeadContext)return crmClientLeadContextView();
 if(crmDetailId){
  const selected=data.leads.find(x=>x.id===crmDetailId);
  return selected?crmLeadDetails(selected):
   '<section class="card"><h1>Обращение недоступно</h1>'+
    '<p class="muted">Обнови список — данные этого лида сейчас не загружены.</p>'+
    '<button type="button" data-crm-back>← К лидам</button></section>';
 }
 const leadFields=select('clientId','Выбрать существующего клиента (если обращение повторное)',
  option(data.clients.filter(c=>c.status!=='archived'&&!(data.archivedLegacyClientIds||[]).includes(c.id)),
   x=>x.name+' · '+(x.phone||'без телефона'),'Новый контакт / клиента пока нет'),false)+
  '<p class="small muted">Повторный клиент сохраняется без дублирования, а лид останется открытым. Следующий шаг и время назначаются отдельно — тогда напоминание появится в календаре.</p>'+
  formField('title','Лид / запрос','text',true,'maxlength="160" placeholder="Например, осмотр объекта"')+
  formField('contactName','Контактное лицо')+formField('phone','Телефон','tel')+
  formField('notes','Примечание','textarea');
 let s='<h1>CRM · Обращения</h1><p class="muted small">Компактный список: нажми на строку, чтобы открыть действия и детали.</p>';
 s+='<div class="crm-new-lead">'+form('lead_create','+ Новый лид',leadFields)+'</div>';
 s+='<section class="card crm-all-leads" aria-label="Все лиды"><h2>Все лиды · '+fmt(data.leads.length)+'</h2>'+
  '<div class="actions"><button type="button" data-crm24-search="leads">Поиск и фильтры по всем лидам</button></div>'+
  '<p class="muted small">Win Score — эвристический балл 0–100, не вероятность продажи. «—» означает, что подтверждённый балл недоступен.</p>'+
  '<div class="crm-compact-list">'+
  (!data.leads.length?'<p class="muted">Обращений пока нет. Создай первый лид.</p>':data.leads.map(crmLeadEntry).join(''))+
  '</div>'+
  (data.listsTruncated?'<p class="muted small">Показана только загруженная часть базы; остальные обращения доступны через поиск.</p>':'')+
  '</section>';
 s+='<details class="card crm-secondary-panel" data-crm-advanced'+(crmAdvancedOpen?' open':'')+'>'+
  '<summary>Фокус, приоритет и планирование</summary>'+
  crmFollowupView()+crmCapacitySignpost()+crmPriorityView()+'</details>';
 s+='<details class="card crm-secondary-panel" data-crm-legacy-archive'+(crmArchiveOpen?' open':'')+'>'+
  '<summary>История передач из старого VBOS</summary>'+
  '<p class="muted small">Архив Google VBOS. Старые ID сохранены; старые лиды не связываются с новыми автоматически.</p>'+
  '<div id="crmLegacyTransfersMount" role="region" aria-label="Архив передач Google VBOS">'+
  '<p class="muted small">Архив доступен для просмотра.</p></div></details>';
 s+=crmMastersDirectory();
 return s;
}
function clientListCard(x){
 return '<button type="button" class="client-list-card" data-client-open="'+esc(x.id)+'" aria-label="Открыть карточку '+esc(x.name)+'">'+
  '<span class="client-list-info"><strong class="client-list-name">'+esc(x.name)+'</strong><span class="client-list-phone">'+esc(x.phone||'Телефон не указан')+'</span></span>'+
  '<span class="client-list-open" aria-hidden="true">Открыть</span></button>';
}
function clientRelatedCard(kind,x,title,subtitle,meta=''){
 return '<button type="button" class="client-list-card" data-client-related="'+esc(kind)+'" data-client-related-id="'+esc(x.id)+'" aria-label="Открыть '+esc(title)+'">'+
  '<span class="client-list-info"><strong class="client-list-name">'+esc(title)+'</strong><span class="client-list-phone">'+esc(subtitle)+'</span>'+
  (meta?'<span class="entity-list-extra">'+esc(meta)+'</span>':'')+'</span>'+
  '<span class="client-list-open" aria-hidden="true">Открыть</span></button>';
}
function clientDetails(x){
 const ownedObjects=(data.objects||[]).filter(o=>o.client_id===x.id);
 const ownedIds=new Set(ownedObjects.map(o=>o.id));
 const ownedOrders=(data.orders||[]).filter(o=>ownedIds.has(o.object_id));
 const counts=clientPortfolio?.id===x.id?clientPortfolio.counts:null;
 const objectFields='<input type="hidden" name="clientId" value="'+esc(x.id)+'">'+
  formField('name','Название объекта','text',true,'maxlength="160" placeholder="Например, квартира"')+
  formField('address','Адрес объекта','text',false,'maxlength="300"')+
  formField('objectType','Тип объекта','text',false,'maxlength="100"')+
  formField('notes','Примечание','textarea');
 const relatedLeadIds=new Set([...(data.leadClientLinks||[]),...(data.leadIntakes||[])].filter(link=>link.client_id===x.id).map(link=>link.lead_id));
 const relatedLeads=(data.leads||[]).filter(lead=>relatedLeadIds.has(lead.id));
 const convertedLeads=(data.leadClientLinks||[]).filter(link=>link.client_id===x.id).map(link=>data.leads.find(row=>row.id===link.lead_id)).filter(Boolean);
 const orderFields=ownedObjects.length?
  select('objectId','Объект клиента',option(ownedObjects,o=>o.name,'Выбери объект клиента'))+
  select('leadId','Источник заказа · завершённый лид',option(convertedLeads,lead=>lead.title,'Без связи с лидом (старый путь)'),false)+
  formField('title','Заказ / задание','text',true,'maxlength="180"')+
  formField('plannedOn','Плановая дата','date',false,'value="'+esc(data.today)+'"')+
  formField('notes','Примечание','textarea'):'';
 let s='<div class="client-detail client-hub">'+
  '<button type="button" class="client-back" data-client-back>← К списку клиентов</button>'+
  '<section class="card client-detail-card"><h1>'+esc(x.name)+'</h1>'+
  '<p class="client-detail-phone">'+esc(x.phone||'Телефон не указан')+'</p>'+
  (x.status!=='archived'&&!(data.archivedLegacyClientIds||[]).includes(x.id)?
   '<div class="actions"><button type="button" class="primary" data-client-new-lead="'+esc(x.id)+'">+ Новое обращение</button></div>':
   '<p class="muted small">Архивный клиент: новое обращение недоступно.</p>')+
  '<p class="muted small">Статус: '+esc((data.archivedLegacyClientIds||[]).includes(x.id)?'Архивный в старом VBOS':(({active:'Активный',inactive:'Неактивный',archived:'Архивный'})[x.status]||'Неизвестен'))+
  ' · Уровень: '+esc(({regular:'Обычный',good:'Хороший',vip:'VIP'})[x.client_tier]||'Не оценён')+
  ' · Рекомендации: '+esc(({none:'Нет',one:'Одна',active:'Активно'})[x.referral_status]||'Не оценено')+'</p>'+
  (x.email?'<p class="muted small">Email: '+esc(x.email)+'</p>':'')+
  (x.address?'<p class="muted small">Адрес: '+esc(x.address)+'</p>':'')+
  (x.client_label_note?'<p class="muted small">Обоснование: '+esc(x.client_label_note)+'</p>':'')+
  (x.notes?'<h2>Заметки</h2><p class="client-detail-notes">'+esc(x.notes)+'</p>':'')+
  '<div class="summary client-hub-summary"><div class="card"><span>Объекты</span><strong>'+(counts?fmt(counts.objects):'…')+'</strong></div>'+
  '<div class="card"><span>Заказы</span><strong>'+(counts?fmt(counts.orders):'…')+'</strong></div>'+
  '<div class="card"><span>Активные</span><strong>'+(counts?fmt(counts.activeOrders):'…')+'</strong></div></div>'+
  '<p class="small muted">ID клиента: '+esc(x.id)+'</p>'+
  '<h2>Данные клиента</h2>'+clientEdit(x)+'</section>';
 s+='<section class="card"><h2>Объекты клиента</h2>'+
  clientPortfolioSection(x,'objects')+
  form('object_create','+ Создать объект для '+x.name,objectFields)+'</section>';
 s+='<section class="card"><h2>Заказы клиента</h2>'+
  clientPortfolioSection(x,'orders')+
  (ownedObjects.length?form('order_create','+ Повторная работа для существующего клиента',orderFields):
   '<p class="muted small">Для создания заказа сначала добавь объект этому клиенту.</p>')+'</section>';
 s+='<p class="muted small">Новые обращения сначала регистрируй в «Лидах». Прямой заказ оставлен для повторной работы. Списки и счётчики выше загружаются из PostgreSQL независимо от первых 500 записей.</p>';
 s+=clientAssessmentView(x.id);
 if(data.listsTruncated)s+='<p class="muted small">Показаны связи из первых 500 загруженных записей разделов. Для поиска остальных используй «Поиск».</p>';
 s+='<section class="card"><h2>Связанные обращения</h2>'+
  (!relatedLeads.length?'<p class="muted">Подтверждённых связанных лидов в текущей базе нет.</p>':
   relatedLeads.map(lead=>'<button type="button" class="client-list-card" data-client-lead-open="'+esc(lead.id)+'"><strong>'+esc(lead.title)+'</strong> · '+esc(lead.status)+'</button>').join(''))+
  (data.listsTruncated?'<p class="muted small">Часть базы может быть за пределами загруженного списка.</p>':'')+'</section>';
 s+=crmInteractionView('Client',x.id);
 s+=crmLegacyInteractionView(x.id);
 s+='<section class="card"><h2>Связи</h2><p class="muted small">Клиент → объект → заказ. Старые Google-лиды и оценки клиента не объединяются по имени и телефону без отдельной проверенной миграции.</p></section>';
 return s+'</div>';
}
function clientsView(){
 if(clientDetailId){
  const selected=ids('clients',clientDetailId);
  if(selected)return clientDetails(selected);
  clientDetailId=null;
 }
 const clientFields=formField('name','Имя клиента','text',true)+formField('phone','Телефон','tel')+clientDuplicateHintMarkup()+clientProfileFields()+formField('notes','Примечание','textarea');
 let s='<h1>Клиенты</h1><p class="muted">Загружено клиентов: '+data.clients.length+'</p>'+   '<div class="actions"><button type="button" data-crm24-search="clients">Поиск и фильтры по всей базе клиентов</button></div>';
 s+=form('client_create','+ Новый клиент',clientFields);
 s+='<div class="client-list">'+(!data.clients.length?'<div class="card">Пока нет клиентов.</div>':data.clients.map(clientListCard).join(''))+'</div>';
 return s;
}
function entityListCard(kind,x,title,subtitle,extra=''){
 return '<button type="button" class="client-list-card" data-record-open="'+esc(kind)+'" data-record-id="'+esc(x.id)+'" aria-label="Открыть карточку '+esc(title)+'">'+
  '<span class="client-list-info"><strong class="client-list-name">'+esc(title)+'</strong><span class="client-list-phone">'+esc(subtitle)+'</span>'+
  (extra?'<span class="entity-list-extra">'+esc(extra)+'</span>':'')+'</span>'+
  '<span class="client-list-open" aria-hidden="true">Открыть</span></button>';
}
function objectListCard(x){
 const client=ids('clients',x.client_id)?.name||x.client_name||'Клиент не указан';
 return entityListCard('objects',x,x.name,x.address||'Адрес не указан','Клиент: '+client);
}
function orderListCard(x){
 const objectName=ids('objects',x.object_id)?.name||x.object_name||'Объект не указан';
 return entityListCard('orders',x,x.title,objectName,(label[x.status]||x.status||'Статус не указан')+(x.planned_on?' · '+short(x.planned_on):''));
}
async function loadObjectCardOrders(id,append=false){
 if(!id)return;
 if(objectOrdersCard.id!==id){
  objectOrdersCard={id,items:[],loading:false,loaded:false,error:'',hasMore:false,nextCursor:null};
 }
 const state=objectOrdersCard;
 if(state.loading||(!append&&(state.loaded||state.error))||
    (append&&(!state.loaded||!state.hasMore||!state.nextCursor)))return;
 state.loading=true;
 if(!append)state.error='';
 try{
  const path='/api/objects/orders?id='+encodeURIComponent(id)+
   (append?'&cursor='+encodeURIComponent(state.nextCursor):'');
  const source=await api(path);
  if(objectOrdersCard!==state)return;
  if(source.objectId!==id||!Array.isArray(source.items)||
     source.items.some(item=>item.object_id!==id)||
     Boolean(source.hasMore)!==Boolean(source.nextCursor))
   throw Error('Не подтверждена связь заказов с объектом или страница истории.');
  const items=append?state.items.concat(source.items):source.items;
  if(new Set(items.map(item=>item.id)).size!==items.length)
   throw Error('В истории объекта обнаружены повторяющиеся заказы.');
  state.items=items;state.hasMore=Boolean(source.hasMore);
  state.nextCursor=source.nextCursor||null;state.loaded=true;
 }catch(error){if(objectOrdersCard===state)state.error=error.message;}
 finally{
  if(objectOrdersCard===state){
   state.loading=false;
   if(objectDetailId===id&&(tab==='objects'||(tab==='catalog'&&catalog.entity==='objects')))render();
  }
 }
}
async function loadObjectContacts(id,append=false){
 if(!id)return;
 if(objectContactState.id!==id){
  objectContactState={id,items:[],loaded:false,loading:false,error:'',hasMore:false,nextCursor:null};
 }
 const state=objectContactState;
 if(state.loading||(!append&&(state.loaded||state.error)))return;
 state.loading=true;state.error='';
 try{
  const url='/api/objects/interactions?id='+encodeURIComponent(id)+'&limit=20'+
   (append&&state.nextCursor?'&cursor='+encodeURIComponent(state.nextCursor):'');
  const result=await api(url);
  if(objectContactState!==state)return;
  if(result.objectId!==id||result.entityType!=='Object'||!Array.isArray(result.items)||
     result.items.some(x=>x.entityType!=='Object'||x.entityId!==id))
   throw Error('История контактов относится к другому объекту.');
  state.items=append?state.items.concat(result.items):result.items;
  state.hasMore=Boolean(result.hasMore);state.nextCursor=result.nextCursor;
  state.loaded=true;
 }catch(error){if(objectContactState===state)state.error=error.message;}
 finally{
  if(objectContactState===state){
   state.loading=false;
   if(objectDetailId===id&&(tab==='objects'||(tab==='catalog'&&catalog.entity==='objects')))render();
  }
 }
}
function objectContactsView(x){
 const state=objectContactState,active=state.id===x.id;
 const rows=active&&state.loaded?state.items:[];
 let out='<section class="card" aria-label="История контактов объекта">'+
  '<h2>История контактов</h2>'+
  '<details><summary>+ Контакт</summary><form data-act="object_interaction_add" class="grid">'+
  '<input type="hidden" name="entityType" value="Object">'+
  '<input type="hidden" name="entityId" value="'+esc(x.id)+'">'+
  '<label>Тип контакта<select name="interactionType">'+
  [['call','Звонок'],['message','Сообщение'],['meeting','Переговоры'],['site_visit','Осмотр'],['note','Заметка'],['other','Другое']]
   .map(item=>'<option value="'+item[0]+'">'+item[1]+'</option>').join('')+'</select></label>'+
  '<label>Краткое описание *<input name="summary" maxlength="1000" required></label>'+
  '<label>Следующее действие<input name="nextAction" maxlength="500"></label>'+
  '<label>Дата и время следующего действия<input type="datetime-local" name="nextActionAt"></label>'+
  '<label>Подробности<textarea name="notes" maxlength="5000"></textarea></label>'+
  '<button type="submit" class="primary wide">Добавить контакт</button></form></details>';
 if(!active||state.loading&&!state.loaded)out+='<p class="muted">Загружаю историю контактов…</p>';
 if(active&&state.error)out+='<p role="alert">'+esc(state.error)+'</p>';
 if(active&&state.loaded){
  out+=rows.length?rows.map(item=>
   '<article class="record"><strong>'+
   esc(({call:'Звонок',message:'Сообщение',meeting:'Переговоры',site_visit:'Осмотр',note:'Заметка',other:'Другое'})[item.interactionType]||item.interactionType)+
   '</strong><p>'+esc(item.summary)+'</p>'+
   (item.nextAction?'<p>Следующее действие: '+esc(item.nextAction)+(item.nextActionAt?' · '+esc(item.nextActionAt):'')+'</p>':'')+
   (item.notes?'<p class="muted">'+esc(item.notes)+'</p>':'')+
   '<p class="muted small">Записано: '+esc(when(item.createdAt))+'</p></article>').join(''):
   '<p class="muted">Контактов по объекту пока нет.</p>';
  if(state.hasMore)out+='<button type="button" class="compact" data-object-contact-more="'+esc(x.id)+'"'+(state.loading?' disabled':'')+'>Показать предыдущие контакты</button>';
 }
 return out+'</section>';
}
function objectDetails(x){
 const client=ids('clients',x.client_id)?.name||x.client_name||'Клиент не указан';
 const scoped=objectOrdersCard.id===x.id,loaded=scoped&&objectOrdersCard.loaded;
 const orders=loaded?objectOrdersCard.items:[];
 const relatedLeadIds=new Set((data.leadClientLinks||[])
  .filter(link=>link.client_id===x.client_id).map(link=>link.lead_id));
 const linkedLeads=(data.leads||[]).filter(lead=>lead.status==='won'&&relatedLeadIds.has(lead.id));
 const orderFields='<input type="hidden" name="objectId" value="'+esc(x.id)+'">'+
  select('leadId','Связанный завершённый лид',option(linkedLeads,lead=>lead.title,'Без связи с лидом'),false)+
  formField('title','Название заказа','text',true,'maxlength="180"')+
  formField('plannedOn','Плановая дата начала','date',false,'value="'+esc(data.today)+'"')+
  formField('notes','Заметки','textarea');
 const ordersBlock=!scoped||(objectOrdersCard.loading&&!loaded)?
  '<p class="muted">Загружаю заказы объекта…</p>':
  (objectOrdersCard.error?'<p role="alert">'+esc(objectOrdersCard.error)+'</p>':'')+
  (!orders.length?(objectOrdersCard.error?'':'<p class="muted">На этом объекте пока нет заказов.</p>'):
   '<div class="client-hub-related">'+orders.map(order=>
    entityListCard('orders',order,order.title,label[order.status]||order.status,
     order.planned_on?short(order.planned_on):'')).join('')+'</div>')+
  (loaded&&objectOrdersCard.hasMore?
   '<button type="button" class="compact" data-object-orders-more="'+esc(x.id)+'"'+
    (objectOrdersCard.loading?' disabled':'')+'>Показать ещё 100 заказов</button>':'')+
  (loaded&&objectOrdersCard.loading?'<p class="muted small">Загружаю следующую страницу…</p>':'');
 return '<div class="client-detail"><button type="button" class="client-back" data-record-back>'+(clientReturn?'← К карточке клиента':'← К списку объектов')+'</button>'+
  '<section class="card client-detail-card"><h1>'+esc(x.name)+'</h1>'+
  '<p class="entity-detail-meta">Клиент: '+esc(client)+'</p>'+
  (x.client_id?'<button type="button" class="compact" data-object-client-open="'+esc(x.client_id)+'">Открыть клиента</button>':'')+
  '<p class="entity-detail-meta">Адрес: '+esc(x.address||'Не указан')+'</p>'+
  '<p class="entity-detail-meta">Тип объекта: '+esc(x.object_type||'Не указан')+'</p>'+
  (x.notes?'<h2>Примечания</h2><p class="client-detail-notes">'+esc(x.notes)+'</p>':'')+
  '<h2>Редактирование объекта</h2>'+objectEdit(x)+'</section>'+
  '<section class="card"><h2>Заказы объекта</h2>'+ordersBlock+
  form('order_create','+ Новый заказ',orderFields)+'</section>'+objectContactsView(x)+'</div>';
}
async function loadOrderCardLogs(id,append=false){
 if(!id)return;
 if(orderLogs.id!==id){
  orderLogs={id,items:[],loaded:false,loading:false,error:'',hasMore:false,nextCursor:null,context:null};
 }
 const state=orderLogs;
 if(state.loading||(!append&&(state.loaded||state.error)))return;
 state.loading=true;state.error='';
 try{
  const path='/api/orders/worklogs?id='+encodeURIComponent(id)+
   (append&&state.nextCursor?'&cursor='+encodeURIComponent(state.nextCursor):'');
  const out=await api(path);
  if(orderLogs!==state)return;
  if(out.orderId!==id||out.coverage!=='CLEAN_NATIVE_WORKLOGS_ONLY'||
     !Array.isArray(out.items)||out.items.some(x=>x.order_id!==id))
   throw Error('История работ не подтверждена для этого заказа.');
  state.items=append?state.items.concat(out.items):out.items;
  state.hasMore=Boolean(out.hasMore);state.nextCursor=out.nextCursor;
  state.context={objectId:out.objectId,clientId:out.clientId,
   objectName:out.objectName,clientName:out.clientName};
  state.loaded=true;
 }catch(error){if(orderLogs===state)state.error=error.message;}
 finally{
  if(orderLogs===state){
   state.loading=false;
   if(orderDetailId===id&&(tab==='orders'||(tab==='catalog'&&catalog.entity==='orders')))render();
  }
 }
}
function orderWorklogsView(x){
 const state=orderLogs,active=state.id===x.id;
 let html='<section class="card" aria-label="Фактические работы заказа"><h2>Фактические работы</h2>'+
  '<p class="muted small">Последние WorkLog этого заказа, по 10 записей. Отображаются записи Clean PostgreSQL; история Google не подменяется.</p>';
 if(!active||state.loading&&!state.loaded)html+='<p class="muted">Загружаю выполненные работы…</p>';
 if(active&&state.error)html+='<p role="alert">'+esc(state.error)+'</p>';
 if(active&&state.loaded){
  html+=state.items.length?state.items.map(log=>
   '<article class="record"><strong>'+esc(log.title)+'</strong>'+
   '<p class="small muted">'+esc(short(log.day_date))+' · '+fmt(log.minutes)+' мин'+
   (log.quantity!==null?' · '+fmt(log.quantity)+' '+esc(log.unit||''):'')+'</p>'+
   (log.detail?'<p class="small muted">'+esc(log.detail.location)+' · '+esc(log.detail.start_clock?.slice(0,5))+'–'+esc(log.detail.end_clock?.slice(0,5))+
      ' · чистое время '+esc(log.detail.clean_minutes)+' мин</p>':'<p class="small muted">Подробности сокращённой записи отсутствуют.</p>')+
   (log.notes?'<p>'+esc(log.notes)+'</p>':'')+'</article>').join(''):
   '<p class="muted">Для этого заказа пока нет записанных работ в Clean.</p>';
  if(state.hasMore)html+='<button type="button" class="compact" data-order-logs-more="'+esc(x.id)+'"'+(state.loading?' disabled':'')+'>Показать предыдущие 10</button>';
 }
 return html+'</section>';
}
async function loadOrderContacts(id,append=false){
 if(!id)return;
 if(orderContactState.id!==id)
  orderContactState={id,items:[],loading:false,loaded:false,error:'',hasMore:false,nextCursor:null};
 const state=orderContactState;
 if(state.loading||(!append&&(state.loaded||state.error))||append&&!state.nextCursor)return;
 state.loading=true;state.error='';
 try{
  const url='/api/orders/interactions?id='+encodeURIComponent(id)+'&limit=20'+
   (append&&state.nextCursor?'&cursor='+encodeURIComponent(state.nextCursor):'');
  const out=await api(url);
  if(orderContactState!==state)return;
  if(out.orderId!==id||out.entityType!=='Order'||!Array.isArray(out.items)||
    out.items.some(item=>item.entityType!=='Order'||item.entityId!==id))
    throw Error('История контактов не относится к выбранному заказу.');
  state.items=append?state.items.concat(out.items):out.items;
  state.hasMore=Boolean(out.hasMore);state.nextCursor=out.nextCursor;
  state.loaded=true;
 }catch(error){if(orderContactState===state)state.error=error.message;}
 finally{
  if(orderContactState===state){
   state.loading=false;
   if(orderDetailId===id&&(tab==='orders'||(tab==='catalog'&&catalog.entity==='orders')))render();
  }
 }
}
function orderContactsView(x){
 const state=orderContactState,active=state.id===x.id,rows=active&&state.loaded?state.items:[];
 let html='<section class="card" aria-label="История контактов заказа">'+
  '<h2>Контакты по заказу</h2>'+
  '<p class="muted small">Переговоры и договорённости именно по этому заказу. Это не фактические работы и не контакты всего объекта. Дата следующего действия пока не создаёт напоминание.</p>'+
  '<details><summary>+ Контакт по заказу</summary><form data-act="order_interaction_add" class="grid">'+
  '<input type="hidden" name="entityType" value="Order">'+
  '<input type="hidden" name="entityId" value="'+esc(x.id)+'">'+
  '<label>Тип контакта<select name="interactionType">'+
  [['call','Звонок'],['message','Сообщение'],['meeting','Переговоры'],['site_visit','Осмотр'],['note','Заметка'],['other','Другое']]
   .map(item=>'<option value="'+item[0]+'">'+item[1]+'</option>').join('')+'</select></label>'+
  '<label>Краткое описание *<input name="summary" maxlength="1000" required></label>'+
  '<label>Следующее действие<input name="nextAction" maxlength="500"></label>'+
  '<label>Дата и время следующего действия<input type="datetime-local" name="nextActionAt"></label>'+
  '<label>Подробности<textarea name="notes" maxlength="5000"></textarea></label>'+
  '<button type="submit" class="primary wide">Добавить контакт</button></form></details>';
 if(!active||state.loading&&!state.loaded)html+='<p class="muted">Загружаю контакты заказа…</p>';
 if(active&&state.error)html+='<p role="alert">'+esc(state.error)+'</p>';
 if(active&&state.loaded){
  html+=rows.length?rows.map(item=>
   '<article class="record"><strong>'+
   esc(({call:'Звонок',message:'Сообщение',meeting:'Переговоры',site_visit:'Осмотр',note:'Заметка',other:'Другое'})[item.interactionType]||item.interactionType)+
   '</strong><p>'+esc(item.summary)+'</p>'+
   (item.nextAction?'<p>Следующее действие: '+esc(item.nextAction)+(item.nextActionAt?' · '+esc(item.nextActionAt):'')+'</p>':'')+
   (item.notes?'<p class="muted">'+esc(item.notes)+'</p>':'')+
   '<p class="muted small">Записано: '+esc(when(item.createdAt))+'</p></article>').join(''):
   '<p class="muted">Контактов по этому заказу пока нет.</p>';
  if(state.hasMore)html+='<button type="button" class="compact" data-order-contact-more="'+esc(x.id)+'"'+(state.loading?' disabled':'')+'>Показать предыдущие контакты</button>';
 }
 return html+'</section>';
}
function orderDetails(x){
 const googleOwned=(data?.legacyGoogleOrderIds||[]).includes(x.id);
 const originalGoogleStatus=(data?.legacyGoogleOrderStatusById||{})[x.id]||'';
 const obj=ids('objects',x.object_id);
 const objectName=obj?.name||x.object_name||'Объект не указан';
 const logContext=orderLogs.id===x.id&&orderLogs.loaded?orderLogs.context:null;
 const clientId=logContext?.clientId||obj?.client_id||'';
 const objectNameExact=logContext?.objectName||objectName;
 const client=logContext?.clientName||ids('clients',clientId)?.name||x.client_name||'';
 const operational=['open','active'].includes(x.status);

 return '<div class="client-detail"><button type="button" class="client-back" data-record-back>'+(objectReturnId?'← К объекту':clientReturn?'← К карточке клиента':'← К списку заказов')+'</button>'+
  '<section class="card client-detail-card"><h1>'+esc(x.title)+'</h1>'+
  '<p class="entity-detail-meta">Объект: '+esc(objectNameExact)+'</p>'+
  (client?'<p class="entity-detail-meta">Клиент: '+esc(client)+'</p>':'')+
  '<div class="actions"><button type="button" class="compact" data-order-open-object="'+esc(x.object_id)+'">Открыть объект</button>'+
  (clientId?'<button type="button" class="compact" data-object-client-open="'+esc(clientId)+'">Открыть клиента</button>':'')+'</div>'+
  '<p class="entity-detail-meta">Статус: '+esc(label[x.status]||x.status||'Не указан')+'</p>'+
  (x.planned_on?'<p class="entity-detail-meta">Плановая дата: '+esc(short(x.planned_on))+'</p>':'')+
  (x.notes?'<h2>Примечания</h2><p class="client-detail-notes">'+esc(x.notes)+'</p>':'')+
  (['open','active'].includes(x.status)?'<div class="actions order-capacity-action"><button type="button" class="primary" data-workorder-capacity="'+esc(x.id)+'">📅 Найти место</button><p class="muted small">Подобрать даты выполнения через Capacity; сам заказ при этом не меняется.</p></div>':'')+
  (googleOwned
   ? '<p class="entity-detail-meta">Исходный статус Google: '+esc(({planned:'Запланирован',active:'Активный',completed:'Завершён',archived:'Архивный'})[originalGoogleStatus]||originalGoogleStatus||'Не указан')+'</p>'+
     '<p class="muted">Импортировано из Google VBOS. Исходный статус и карточка заказа изменяются только в старом VBOS. Здесь можно назначать исполнителей и записывать новую работу.</p>'
   : '<h2>Статус заказа</h2>'+(x.status==='done'?'<p class="muted">Заказ закрыт. Изменение статуса заблокировано.</p>':statusButtons(x,'order_status',['open','active','cancelled']))+
     '<p class="muted small">Прямой переход в «Завершён» заблокирован до подключения защищённой процедуры закрытия.</p>'+
     (x.status==='done'?'':'<h2>Редактирование заказа</h2>'+orderEdit(x)))+
  workerOrderPanel(x)+
  (operational?'<div class="actions"><button type="button" class="primary compact" data-act="work_start_order" data-order-id="'+esc(x.id)+'">Начать работу по заказу</button></div>'+
   '<button type="button" class="primary wide-button" data-workflow-open="log" data-order-id="'+esc(x.id)+'">+ Записать работу</button>':'')+
  orderWorklogsView(x)+orderContactsView(x)+
  '<section class="order-close-preview card" aria-label="Проверка закрытия заказа"><h2>Закрытие заказа</h2>'
  +'<p class="muted">Предварительная проверка: заказ и расчёты не меняются.</p>'
  +'<button type="button" data-close-preview="'+esc(x.id)+'"'+(closePreviewState.id===x.id&&closePreviewState.loading?' disabled':'')+'>Проверить закрытие</button>'
  +(closePreviewState.id===x.id?(closePreviewState.loading?'<p role="status">Проверяем задачи и расписание…</p>':
    closePreviewState.error?'<p role="alert">'+esc(closePreviewState.error)+'</p>':
    closePreviewState.result&&closePreviewModule?closePreviewModule.renderClosePreview(closePreviewState.result):''):'')
  +(!googleOwned&&['open','active'].includes(x.status)&&closePreviewState.id===x.id&&closePreviewState.result&&nativeCloseView
    ?nativeCloseView.renderNativeCloseForm(x,data.today):'')
  +(!googleOwned&&x.status==='done'
    ?'<button type="button" data-native-close-receipt="'+esc(x.id)+'">Показать подтверждение закрытия</button>'
      +(nativeCloseReceipt.id===x.id?(nativeCloseReceipt.busy?'<p role="status">Загрузка подтверждения…</p>':
       nativeCloseReceipt.error?'<p role="alert">'+esc(nativeCloseReceipt.error)+'</p>':
       nativeCloseReceipt.result&&nativeCloseView?nativeCloseView.renderNativeCloseReceipt(nativeCloseReceipt.result):''):'')
    :'')
  +'</section></section></div>';
}
function objectsView(){
 if(objectDetailId){
  const selected=ids('objects',objectDetailId);
  if(selected)return objectDetails(selected);
  objectDetailId=null;
 }
 const fields=select('clientId','Клиент',option(data.clients,x=>x.name,'Выбери клиента'))+formField('name','Объект','text',true,'placeholder="Например, квартира в Арабкире"')+
  formField('address','Адрес')+formField('objectType','Тип объекта','text',false,'maxlength="100"')+
  formField('notes','Примечание','textarea');
 let s='<h1>Объекты</h1><p class="muted">Всего объектов: '+data.objects.length+'</p>';
 s+=data.clients.length?form('object_create','+ Добавить объект',fields):'<div class="card">Сначала создай клиента в разделе «Клиенты».</div>';
 s+='<div class="client-list">'+(!data.objects.length?'<div class="card">Пока нет объектов.</div>':data.objects.map(objectListCard).join(''))+'</div>';
 return s;
}
function ordersView(){
 if(orderDetailId){
  const selected=ids('orders',orderDetailId)||objectOrdersCard.items.find(order=>order.id===orderDetailId);
  if(selected)return orderDetails(selected);
  orderDetailId=null;
 }
 const fields=select('objectId','Объект',option(data.objects,x=>x.name,'Выбери объект'))+select('leadId','Связанный лид',option(data.leads,x=>x.title),false)+formField('title','Задание / заказ','text',true,'placeholder="Например, тёплый пол — 1-й этаж"')+formField('plannedOn','Плановая дата','date',false,'value="'+esc(data.today)+'"')+formField('notes','Примечание','textarea');
 let s='<h1>Заказы и задания</h1><p class="muted">Всего заказов: '+data.orders.length+'</p>';
 s+=data.objects.length?form('order_create','+ Создать заказ',fields):'<div class="card">Для первого заказа создай клиента и объект.</div>';
 s+='<div class="client-list">'+(!data.orders.length?'<div class="card">Пока нет заказов.</div>':data.orders.map(orderListCard).join(''))+'</div>';
 return s;
}
function historyView(){
 const f=history.filters;
 const orders='<option value="">Все заказы</option>'+data.orders.map(o=>'<option value="'+esc(o.id)+'" '+(f.orderId===o.id?'selected':'')+'>'+esc(o.title)+'</option>').join('');
 let s='<h1>История работ</h1><section class="card"><form id="historyFilters" class="grid">'+
 select('mode','Просмотр','<option value="day" '+(f.mode==='day'?'selected':'')+'>За один день</option><option value="period" '+(f.mode==='period'?'selected':'')+'>За период</option>')+
 editText('day','Выбранный день',f.day||data.today,'date')+
 editText('from','Начало периода',f.from,'date')+
 editText('to','Конец периода',f.to,'date')+
 select('orderId','Заказ',orders,false)+
 '<button type="submit" class="primary wide">Показать работы</button></form></section>';
 if(!history.loaded)s+='<p class="muted">Выбери даты и нажми «Показать работы».</p>';
 else if(!history.items.length)s+='<section class="card"><p class="muted">За выбранные даты работы не найдены.</p></section>';
 else s+='<section class="card"><h2>Найденные записи</h2>'+history.items.map(x=>{
  const linkedOrder=x.order_id&&!data.orders.some(o=>o.id===x.order_id)
    ?'<option value="'+esc(x.order_id)+'" selected>Заказ из истории</option>':'';
  const opts='<option value="">Без заказа</option>'+linkedOrder+data.orders.map(o=>'<option value="'+esc(o.id)+'" '+(x.order_id===o.id?'selected':'')+'>'+esc(o.title)+'</option>').join('');
  const fields=editText('dayDate','Дата работы',short(x.day_date),'date','required')+
   select('orderId','Заказ',opts,false)+
   editText('title','Выполненная работа',x.title,'text','required maxlength="180"')+
   editText('minutes','Время, минут',x.minutes,'number','required min="1" max="1440"')+
   editText('quantity','Объём',x.quantity??'','number','min="0" step="0.001"')+
   editText('unit','Единица',x.unit,'text','maxlength="30"')+
   editText('notes','Примечание',x.notes,'textarea');
  return '<details class="record history-record"><summary><b>'+esc(x.title)+'</b><span class="meta">'+esc(short(x.day_date))+' · '+fmt(x.minutes)+' мин'+(x.quantity!==null?' · '+fmt(x.quantity)+' '+esc(x.unit):'')+'</span></summary>'+
  '<p class="small muted">Заказ: '+esc(x.order_title||'Без заказа')+'</p>'+ 
  (x.detail?'<p class="small muted">'+esc(x.detail.location)+' · '+esc(x.detail.start_clock?.slice(0,5))+'–'+esc(x.detail.end_clock?.slice(0,5))+
    ' · чистое время '+esc(x.detail.clean_minutes)+' мин · '+esc(x.detail.performer_mode)+'</p>':
   '<p class="small muted">Сокращённая запись: исполнитель, часы и потери не указаны.</p>')+
  '<p class="small muted">Примечание: '+esc(x.notes||'—')+'</p>'+
  '<p class="small muted">Запись: '+esc(x.id)+' · версия '+esc(x.revision)+'</p>'+
  (x.detail?'<button type="button" class="wide-button" data-workflow-edit-log="'+esc(x.id)+'">Изменить работу</button>':editRecord('log_update',x,fields))+'</details>';
 }).join('')+'</section>';
 if(history.hasMore)s+='<button class="primary wide-button" data-history-more '+(history.loading?'disabled':'')+'>Показать ещё 25</button>';
 return s;
}
async function loadHistory(append=false){
 if(history.loading)return;
 history.loading=true;
 let success=false;
 try{
  const f=history.filters;
  const day=f.day||data.today;
  const params=new URLSearchParams({from:f.mode==='period'?f.from:day,to:f.mode==='period'?f.to:day,limit:'25'});
  if(f.orderId)params.set('orderId',f.orderId);
  if(append&&history.nextCursor)params.set('cursor',history.nextCursor);
  const out=await api('/api/history?'+params.toString());
  history.items=append?history.items.concat(out.items):out.items;
  history.nextCursor=out.nextCursor;
  history.hasMore=out.hasMore;
  history.loaded=true;success=true;
 }catch(e){message(e.message,true);}
 finally{history.loading=false;if(success)render();}
}

function catalogFilterSelect(name,title,options,value){
 return select(name,title,'<option value="">Все</option>'+
  options.map(([id,text])=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(text)+'</option>').join(''),false);
}
function catalogView(){
 if(catalog.entity==='clients'&&clientDetailId){
  const selected=catalog.items.find(x=>x.id===clientDetailId);
  if(selected)return clientDetails(selected);
  clientDetailId=null;
 }
 if(catalog.entity==='objects'&&objectDetailId){
  const selected=catalog.items.find(x=>x.id===objectDetailId);
  if(selected)return objectDetails(selected);
  objectDetailId=null;
 }
 if(catalog.entity==='orders'&&orderDetailId){
  const selected=catalog.items.find(x=>x.id===orderDetailId);
  if(selected)return orderDetails(selected);
  orderDetailId=null;
 }
 const choices=[['clients','Клиенты'],['objects','Объекты'],['orders','Заказы'],['leads','Лиды']];
 const filters=catalog.entity==='clients'?
  catalogFilterSelect('status','Статус клиента',[['active','Активный'],['inactive','Неактивный'],['archived','Архивный в PostgreSQL']],catalog.status)+
  catalogFilterSelect('tier','Уровень клиента',[['unset','Не оценён'],['regular','Обычный'],['good','Хороший'],['vip','VIP']],catalog.tier)+
  catalogFilterSelect('referral','Рекомендации',[['unset','Не оценено'],['none','Нет'],['one','Одна'],['active','Активно']],catalog.referral):
  catalog.entity==='leads'?
  catalogFilterSelect('status','Статус лида',[['new','Новый'],['contacted','Связались'],['qualified','В работе'],['won','Успешно'],['lost','Отказ'],['transferred','Передан']],catalog.status):'';
 let s='<h1>Поиск по базе</h1><section class="card"><form id="catalogFilters" class="grid">'+
  select('entity','Раздел',choices.map(([id,name])=>'<option value="'+id+'" '+(catalog.entity===id?'selected':'')+'>'+name+'</option>').join(''))+
  editText('q','Название, телефон, адрес или UUID',catalog.q,'search','maxlength="80" placeholder="Пусто — последние 25 записей"')+
  filters+'<button class="primary wide" type="submit">Найти записи</button></form>'+
  '<p class="muted small">Поиск и фильтры выполняются по всей базе PostgreSQL, не только по первым 500 записям. Архивный статус старого Google VBOS не подменяет статус PostgreSQL.</p></section>';
 if(!catalog.loaded)s+='<p class="muted">Выбери раздел и нажми «Найти записи».</p>';
 else if(!catalog.items.length)s+='<div class="card">Совпадений нет.</div>';
 else s+='<section class="card"><h2>Результаты поиска</h2>'+catalog.items.map(x=>{
  if(catalog.entity==='clients')return clientListCard(x);
  if(catalog.entity==='objects')return objectListCard(x);
  if(catalog.entity==='orders')return orderListCard(x);
  let title='',details='',body='';
  if(catalog.entity==='leads'){
   title=x.title;details=(x.contact_name||'')+' · '+(x.phone||'')+' · '+(label[x.status]||x.status);
   body=(x.notes?'<p class="muted small">'+esc(x.notes)+'</p>':'')+
     statusButtons(x,'lead_status',['new','contacted','qualified','lost'])+crmLeadConversion(x)+leadEdit(x);
  }
  return record(title,details,body+'<p class="muted small">ID: '+esc(x.id)+'</p>');
 }).join('')+'</section>';
 if(catalog.hasMore)s+='<button class="primary wide-button" data-catalog-more '+(catalog.loading?'disabled':'')+'>Показать ещё 25</button>';
 return s;
}
async function loadCatalog(append=false){
 if(catalog.loading)return;
 catalog.loading=true;let success=false;
 try{
  const params=new URLSearchParams({entity:catalog.entity,q:catalog.q,limit:'25'});
  for(const key of ['status','tier','referral'])if(catalog[key])params.set(key,catalog[key]);
  if(append&&catalog.nextCursor)params.set('cursor',catalog.nextCursor);
  const out=await api('/api/catalog?'+params.toString());
  catalog.items=append?catalog.items.concat(out.items):out.items;
  catalog.nextCursor=out.nextCursor;catalog.hasMore=out.hasMore;
  catalog.loaded=true;success=true;
 }catch(err){message(err.message,true);}
 finally{catalog.loading=false;if(success)render();}
}

function reportView(){
 const item=data.legacyReport, r=item?.report||{},g=r.monthly_business_gains_amd||{};
 let s='<h1>Отчёты</h1><div class="card"><h2>Новая база</h2><p class="muted">Текущие новые данные: '+data.leads.length+' лидов, '+data.clients.length+' клиентов, '+data.orders.length+' заказов, '+data.logs.length+' рабочих записей.</p><a class="download" href="/api/export">Сохранить резервную копию JSON</a></div>';
 s+='<section class="card"><span class="tag">АРХИВ · СТАРЫЙ VBOS</span><h2>'+esc(item?.label||'Архивный финансовый отчёт')+'</h2><p class="muted">Снимок на '+esc(short(item?.source_date))+' · только просмотр. Это не деньги и не прибыль нового приложения.</p>';
 if(item)s+='<div class="summary"><div class="card"><span>Денежный остаток · AMD</span><strong>'+fmt(r.cash_balance_amd)+'</strong></div><div class="card"><span>Признанная прибыль · AMD</span><strong>'+fmt(r.recognized_profit_amd)+'</strong></div><div class="card"><span>Поступления · AMD</span><strong>'+fmt(r.received_amd)+'</strong></div><div class="card"><span>Начисленный доход · AMD</span><strong>'+fmt(r.earned_amd)+'</strong></div><div class="card"><span>Доп. доходы бизнеса · AMD</span><strong>'+fmt(r.monthly_business_gains_total_amd)+'</strong></div><div class="card"><span>Фонды капитала · AMD</span><strong>'+fmt(r.capital_funds_total_amd)+'</strong></div></div><hr><h3>Дополнительные доходы по месяцам</h3>'+Object.entries(g).map(([m,v])=>'<div class="row record"><span>'+esc(m)+'</span><b>'+fmt(v)+' AMD</b></div>').join('')+'<p class="small muted">Разные показатели не складываются между собой. Старые финансовые операции сохранены отдельно в Neon TEST. Это исторический снимок, не текущий финансовый учёт.</p>';
 else s+='<p class="muted">Архивный отчёт пока не загружен.</p>';
 s+='</section>'+financeHistoryView()+'<details class="card"><summary>Сменить пароль</summary><form id="passwordForm"><label>Текущий пароль<input name="oldPassword" type="password" required></label><label>Новый пароль (от 10 символов)<input name="newPassword" type="password" minlength="10" required></label><button class="primary">Изменить пароль и выйти</button></form></details>';
 return s;
}
function engineeringView(){
 let s='';
 if(edError)s+='<section class="card"><h2>Чертёж</h2><p>Не удалось загрузить модуль черчения.</p></section>';
 else if(!edModule)s+='<section class="card"><h2>Чертёж</h2><p>Загрузка редактора…</p></section>';
 else try{
  if(efModule&&efFloor)s+=efModule.floorOverviewHtml(efFloor,edDraft?.roomId||'');
  else s+='<section class="card"><p>Загрузка структуры этажа…</p></section>';
  s+=edModule.renderDrawing(edDraft,efFloor?.rooms?.length>1?null:edResult,edAnchor,edMessage,efFloor?.rooms||[]);
 }
 catch{s+='<section class="card"><h2>Чертёж</h2><p>Геометрия не прошла проверку. Загрузите сохранённый корректный JSON.</p></section>';}
 if(egModule&&!egError)s+='<details class="card"><summary>Ручной калькулятор (без чертежа)</summary>'+egModule.calculatorHtml({values:egInputs,result:egResult})+'</details>';
 return s;
}
async function loadEngineeringCalculation(){
 if(egModule||egLoading)return;
 egLoading=true;egError='';
 try{egModule=await import('/engineering-calculator.mjs');}
 catch{egError='MODULE_UNAVAILABLE';}
 finally{egLoading=false;if(tab==='engineering')render();}
}
async function loadEngineeringDrawing(){
 if(edModule||edLoading)return;
 edLoading=true;edError='';
 try{edModule=await import('/engineering-drawing-ui.mjs');edDraft=edModule.newDrawing('CLEAN-DRAFT-'+crypto.randomUUID());}
 catch{edError='DRAWING_MODULE_UNAVAILABLE';}
 finally{edLoading=false;if(tab==='engineering')render();}
}
async function loadEngineeringFloor(){
 if(efModule||efLoading)return;
 efLoading=true;efError='';
 try{efModule=await import('/engineering-floor-ui.mjs');efFloor=efModule.newFloor('CLEAN-DRAFT-'+crypto.randomUUID());}
 catch{efError='FLOOR_MODULE_UNAVAILABLE';}
 finally{efLoading=false;if(tab==='engineering')render();}
}
function saveCurrentRoomToFloor(next=false){
 if(!efModule||!edModule||!edDraft||!efFloor)throw Error('FLOOR_MODULE_UNAVAILABLE');
 const form=$('#engineeringDrawingParameters');
 // Re-read the current form exactly once: do not save stale parameters.
 const candidate=form?edModule.commitDraftForm(edDraft,Object.fromEntries(new FormData(form))):edDraft;
 const nextFloor=efModule.putFloorRoom(efFloor,candidate);
 efFloor=nextFloor;
 edDraft=next?edModule.newDrawing('CLEAN-DRAFT-'+crypto.randomUUID()):candidate;
 edAnchor=null;edResult=null;
 if(!next)drawingRecalculate();
}
function clearDrawingSession(){
 edModule=null;edLoading=false;edError='';edDraft=null;edAnchor=null;edResult=null;edMessage='';
 efModule=null;efLoading=false;efError='';efFloor=null;
 egModule=null;egLoading=false;egError='';egInputs={};egResult=null;
}
function drawingRecalculate(){
 if(!edModule||!edDraft)return;
 try{edResult=edModule.calculateFromDrawing(edDraft);}
 catch(e){edResult={status:'INVALID',invalidInputs:[String(e.message)]};}
}
function serviceReferenceView(){
 return '<section class="card"><div id="serviceReferenceMount" role="region" aria-label="Справочник услуг"><p class="muted">Загрузка справочника…</p></div></section>';
}
async function mountServiceReference(){
 const root=$('#serviceReferenceMount');
 if(!data||tab!=='serviceReference'||!root)return;
 try{
  const mod=await (referenceModulePromise??=import('/service-reference-view.mjs'));
  if(!data||tab!=='serviceReference'||root!==$('#serviceReferenceMount'))return;
  referencePanel=mod.mountReferencePanel(root,{fetchPage:path=>api(path)});
 }catch{
  if(data&&tab==='serviceReference'&&root===$('#serviceReferenceMount'))
   root.textContent='Экран справочника услуг пока недоступен.';
 }
}
function historyOrdersView(){
 return '<section class="card"><div id="historyOrdersMount" role="region" aria-label="Исторические заказы"><p class="muted">Загрузка исторических заказов…</p></div></section>';
}
async function mountHistoricalOrders(){
 const root=$('#historyOrdersMount');
 if(!data||tab!=='historyOrders'||!root)return;
 try{
  const source=await (historicalOrdersModulePromise??=import('/history-orders-view.mjs'));
  if(!data||tab!=='historyOrders'||root!==$('#historyOrdersMount'))return;
  historicalOrdersPanel=source.mountHistoryOrdersPanel(root,{fetchPage:path=>api(path)});
 }catch{
  if(data&&tab==='historyOrders'&&root===$('#historyOrdersMount'))
   root.textContent='Не удалось загрузить экран исторических заказов.';
 }
}
function financeCapitalView(mode){
 if(mode==='finance')return '<h1>Финансы</h1>'+
   '<section class="card" id="financeNativeMount" role="region" aria-label="Новые операции PostgreSQL"><p class="muted">Загрузка новых операций…</p></section>'+
  '<section class="card" aria-label="Финансовая сводка и операции"><div id="financeArchiveMount" role="region" aria-label="Историческая финансовая сводка"><p class="muted">Загрузка проверенной сводки…</p></div></section>'+
  '<details class="card" id="financeDraftDetails"><summary>Черновик операции · деньги не сохраняются</summary><section id="financeOpeningMount" role="region" aria-label="Проверка черновика PostgreSQL"><p class="muted">Проверка начальных остатков…</p></section></details>'+
  '<details class="card" open><summary>История операций</summary>'+financeHistoryView()+'</details>'+
  '<details class="card"><summary>Итоги заказов, объектов и работников</summary>'+
  '<section class="card"><div id="financeOrderResultMount" role="region" aria-label="Финансовый результат отдельного заказа"><p class="muted">Загрузка заказов…</p></div></section>'+
  '<section class="card"><div id="financeObjectResultMount" role="region" aria-label="Финансовый итог объекта"><p class="muted">Загрузка объектов…</p></div></section>'+
  '<section class="card"><div id="financeWorkerResultMount" role="region" aria-label="Финансовый итог работника"><p class="muted">Загрузка работников…</p></div></section></details>'+
  '<details class="card"><summary>Дополнительная прибыль бизнеса за месяц</summary><section id="financeMonthlyMount" role="region" aria-label="Месячная прибыль бизнеса"><p class="muted">Читаю TEST-реестр…</p></section></details>'+
  '<details class="card"><summary>Сверка, архивные отметки и исправления</summary>'+
  '<section class="card"><div id="financeReviewMount" role="region" aria-label="Ручная разборка финансового архива"><p class="muted">Загрузка отметок…</p></div></section>'+
  '<section class="card"><div id="financeReviewAuditMount" role="region" aria-label="Журнал отметок проверки"><p class="muted">Загрузка журнала отметок…</p></div></section>'+
  '<section class="card"><div id="financeCorrectionMount" role="region" aria-label="Исправление описаний истории"><p class="muted">Загрузка исправлений…</p></div></section>'+
  '<section class="card"><div id="financeAuditMount" role="region" aria-label="Журнал исправлений истории"><p class="muted">Загрузка журнала…</p></div></section></details>';
 return '<h1>Капитал · фонды</h1>'+
   '<section class="card" id="financeNativeMount" role="region" aria-label="Новые операции PostgreSQL"><p class="muted">Загрузка новых операций…</p></section>'+
  '<section id="financeOpeningMount" role="region" aria-label="Начальное состояние PostgreSQL и черновик операции"><p class="muted">Проверка начальных остатков…</p></section>'+
  '<section class="card"><div id="financeArchiveMount" role="region" aria-label="Сохранённый финансовый архив"><p class="muted">Проверка источника…</p></div></section>'+
  '<section class="card"><div id="financeReviewMount" role="region" aria-label="Ручная разборка финансового архива"><p class="muted">Загрузка отметок…</p></div></section>'+
  '<section class="card"><div id="financeReviewAuditMount" role="region" aria-label="Журнал отметок проверки"><p class="muted">Загрузка журнала отметок…</p></div></section>'+
  '<section class="card"><div id="financeCorrectionMount" role="region" aria-label="Исправление описаний истории"><p class="muted">Загрузка исправлений…</p></div></section>'+
  '<section class="card"><div id="financeAuditMount" role="region" aria-label="Журнал исправлений истории"><p class="muted">Загрузка журнала…</p></div></section>';
}
async function mountFinanceOrderResult(){
 const root=$('#financeOrderResultMount');
 if(!data||tab!=='finance'||!root)return;
 try{
  const mod=await (financeOrderModulePromise??=import('/finance-order-result-view.mjs'));
  if(!data||tab!=='finance'||root!==$('#financeOrderResultMount'))return;
  financeOrderPanel=mod.mountFinanceOrderResultPanel(root,{fetchPage:path=>api(path)});
 }catch{
  if(data&&tab==='finance'&&root===$('#financeOrderResultMount'))
   root.textContent='Финансовый результат заказа сейчас недоступен.';
 }
}
async function mountFinanceWorkerHistory(){
 const root=$('#financeWorkerResultMount');
 if(!data||tab!=='finance'||!root)return;
 try{
  const mod=await (financeWorkerModulePromise??=import('/finance-worker-history-view.mjs'));
  if(!data||tab!=='finance'||root!==$('#financeWorkerResultMount'))return;
  financeWorkerPanel=mod.mountFinanceWorkerHistoryPanel(root,{fetchPage:path=>api(path)});
 }catch{
  if(data&&tab==='finance'&&root===$('#financeWorkerResultMount'))
   root.textContent='Финансовый архив работника пока недоступен.';
 }
}
async function mountFinanceObjectResult(){
 const root=$('#financeObjectResultMount');
 if(!data||tab!=='finance'||!root)return;
 try{
  const mod=await (financeObjectModulePromise??=import('/finance-object-result-view.mjs'));
  if(!data||tab!=='finance'||root!==$('#financeObjectResultMount'))return;
  financeObjectPanel=mod.mountFinanceObjectResultPanel(root,{fetchPage:path=>api(path)});
 }catch{
  if(data&&tab==='finance'&&root===$('#financeObjectResultMount'))
   root.textContent='Финансовый итог объекта сейчас недоступен.';
 }
}
async function mountFinanceMonthlyGains(){
 const root=$('#financeMonthlyMount');
 if(!data||tab!=='finance'||!root)return;
 try{
  const mod=await (financeMonthlyModulePromise??=import('/business-monthly-gains-view.mjs'));
  if(!data||tab!=='finance'||root!==$('#financeMonthlyMount'))return;
  financeMonthlyPanel=mod.mountBusinessGainEditor(root,{fetchPage:(path,payload)=>api(path,payload)});
 }catch{
  if(data&&tab==='finance'&&root===$('#financeMonthlyMount'))
   root.textContent='Новый месячный TEST-реестр недоступен.';
 }
}
function openLegacyFinanceDraft(type){
 if(tab!=='finance'||!['INCOME','EXPENSE'].includes(type))return;
 financeDraftIntent=type;
 const details=$('#financeDraftDetails');if(details)details.open=true;
 applyLegacyFinanceDraft();
}
function applyLegacyFinanceDraft(){
 if(tab!=='finance'||!financeDraftIntent)return;
 const form=$('#financeB13DraftForm');if(!form)return;
 const field=form.elements?.operationType;
 if(!field)return;
 field.value=financeDraftIntent;
 field.dispatchEvent(new Event('change',{bubbles:true}));
 financeDraftIntent='';
 const details=$('#financeDraftDetails');
 if(details&&typeof details.scrollIntoView==='function')details.scrollIntoView({block:'start'});
 const amount=form.elements?.amountAMD;
 if(amount&&typeof amount.focus==='function')amount.focus({preventScroll:true});
}
async function mountFinanceOpening(){
 const root=$('#financeOpeningMount'),mode=tab;
 if(!data||!['finance','capital'].includes(mode)||!root)return;
 try{
  const mod=await (financeOpeningModulePromise??=import('/finance-opening-preview-view.mjs'));
  if(!data||tab!==mode||root!==$('#financeOpeningMount'))return;
  financeOpeningPanel=mod.mountFinanceOpeningPreview(root,{
   mode,fetchPage:path=>api(path),postDraft:payload=>financeDraftServerPost(payload),today:data.today,
    onReady:applyLegacyFinanceDraft
  });
 }catch{
  if(data&&tab===mode&&root===$('#financeOpeningMount'))
   root.textContent='Новые начальные остатки пока недоступны.';
 }
}

async function mountFinanceNative(){
 const root=$('#financeNativeMount'),mode=tab;
 if(!data||!['finance','capital'].includes(mode)||!root)return;
 try{
  const mod=await (financeNativeModulePromise??=import('/finance-native-workspace-view.mjs'));
  if(!data||tab!==mode||root!==$('#financeNativeMount'))return;
  financeNativePanel=mod.mountFinanceNativeWorkspace(root,{
   mode,today:data.today,fetchPage:path=>api(path),
   postAction:payload=>financeNativePostAction(payload)
  });
 }catch{
  if(data&&tab===mode&&root===$('#financeNativeMount'))
   root.textContent='Новый финансовый реестр пока недоступен.';
 }
}
async function mountFinanceCapitalArchive(){
 const root=$('#financeArchiveMount'),mode=tab;
 if(!data||!['finance','capital'].includes(mode)||!root)return;
 try{
  const source=await (financeArchiveModulePromise??=import('/finance-capital-view.mjs'));
  if(!data||tab!==mode||root!==$('#financeArchiveMount'))return;
  financeArchivePanel=source.mountFinanceCapitalArchivePanel(root,{mode,fetchPage:path=>api(path),onDraft:openLegacyFinanceDraft,
   today:data.today,refs:{orders:data.orders||[],objects:data.objects||[],workers:data.workers||[]},
   fetchCurrentContext:()=>api('/api/my-work'),fetchReferencePage:path=>api(path)});
 }catch{
  if(data&&tab===mode&&root===$('#financeArchiveMount'))
   root.textContent='Не удалось загрузить сохранённый финансовый архив.';
 }
}
async function mountFinanceReview(){
 const root=$('#financeReviewMount'),mode=tab;
 if(!data||!['finance','capital'].includes(mode)||!root)return;
 try{
  const mod=await (financeReviewModulePromise??=import('/finance-review-view.mjs'));
  if(!data||tab!==mode||root!==$('#financeReviewMount'))return;
  financeReviewPanel=mod.mountFinanceReviewPanel(root,{mode,
   fetchPage:path=>api(path),saveReview:(path,payload)=>api(path,payload),
   confirmArchive:message=>window.confirm(message)});
 }catch{
  if(data&&tab===mode&&root===$('#financeReviewMount'))
   root.textContent='Разборка истории пока недоступна.';
 }
}
async function mountFinanceReviewAudit(){
 const root=$('#financeReviewAuditMount'),mode=tab;
 if(!data||!['finance','capital'].includes(mode)||!root)return;
 try{
  const mod=await (financeReviewAuditModulePromise??=import('/finance-review-audit-view.mjs'));
  if(!data||tab!==mode||root!==$('#financeReviewAuditMount'))return;
  financeReviewAuditPanel=mod.mountFinanceReviewAuditPanel(root,{mode,
   fetchPage:path=>api(path)});
 }catch{
  if(data&&tab===mode&&root===$('#financeReviewAuditMount'))
   root.textContent='Журнал отметок пока недоступен.';
 }
}
async function mountFinanceCorrections(){
 const root=$('#financeCorrectionMount'),mode=tab;
 if(!data||!['finance','capital'].includes(mode)||!root)return;
 try{
  const mod=await (financeCorrectionModulePromise??=import('/finance-corrections-view.mjs'));
  if(!data||tab!==mode||root!==$('#financeCorrectionMount'))return;
  financeCorrectionPanel=mod.mountFinanceCorrectionsPanel(root,{
   mode,fetchPage:path=>api(path),saveCorrection:(path,payload)=>api(path,payload),
   confirmClear:message=>window.confirm(message)
  });
 }catch{
  if(data&&tab===mode&&root===$('#financeCorrectionMount'))
   root.textContent='Редактирование описаний сейчас недоступно.';
 }
}
async function mountFinanceAudit(){
 const root=$('#financeAuditMount'),mode=tab;
 if(!data||!['finance','capital'].includes(mode)||!root)return;
 try{
  const mod=await (financeAuditModulePromise??=import('/finance-correction-audit-view.mjs'));
  if(!data||tab!==mode||root!==$('#financeAuditMount'))return;
  financeAuditPanel=mod.mountFinanceCorrectionAuditPanel(root,{mode,fetchPage:path=>api(path)});
 }catch{
  if(data&&tab===mode&&root===$('#financeAuditMount'))
   root.textContent='Журнал исправлений пока недоступен.';
 }
}
function financeHistoryView(){
 return '<section class="card"><h2>Архив финансовых операций</h2><div id="financeHistoryMount" role="region" aria-label="Исторические финансовые операции"><p class="muted">Только история старого VBOS, не текущий баланс.</p></div></section>';
}
async function mountFinanceHistory(){
 const root=$('#financeHistoryMount');
 if(!data||!['report','finance'].includes(tab)||!root)return;
 try{
  const mod=await (financeHistoryModulePromise??=import('/finance-history-view.mjs'));
  if(!data||!['report','finance'].includes(tab)||root!==$('#financeHistoryMount'))return;
  financeHistoryPanel=mod.mountFinanceHistoryPanel(root,{fetchPage:path=>api(path)});
 }catch{
  if(data&&['report','finance'].includes(tab)&&root===$('#financeHistoryMount'))
   root.textContent='Архив финансовых операций сейчас недоступен.';
 }
}
let legacyTransfersPanel=null,legacyTransfersViewPromise=null;
async function mountLegacyTransfers(){
 const root=$('#crmLegacyTransfersMount');
 if(!data||tab!=='crm'||crmDetailId||estimateWorkspaceOpen||!root)return;
 try{
  const mod=await (legacyTransfersViewPromise??=import('/crm-legacy-transfers-view.mjs'));
  if(!data||tab!=='crm'||crmDetailId||estimateWorkspaceOpen||root!==$('#crmLegacyTransfersMount'))return;
  legacyTransfersPanel=mod.mountLegacyTransferPanel(root,{fetchPage:path=>api(path)});
 }catch{
  if(data&&tab==='crm'&&root===$('#crmLegacyTransfersMount'))
   root.textContent='История старых передач сейчас недоступна.';
 }
}
// Reveal the result of a deliberate user action without opening the mobile keyboard.
function scheduleRevealSection(selector){
 if(tab!=='schedule')return false;
 const target=document.querySelector(selector);
 if(!target)return false;
 target.scrollIntoView?.({behavior:'smooth',block:'start'});
 target.focus?.({preventScroll:true});
 return true;
}
function render(){
 if(financeOpeningPanel){financeOpeningPanel.unmount();financeOpeningPanel=null;}
 if(financeNativePanel){financeNativePanel.unmount();financeNativePanel=null;}
 if(financeMonthlyPanel){financeMonthlyPanel.unmount();financeMonthlyPanel=null;}
 if(financeOrderPanel){financeOrderPanel.unmount();financeOrderPanel=null;}if(financeWorkerPanel){financeWorkerPanel.unmount();financeWorkerPanel=null;}
 if(financeObjectPanel){financeObjectPanel.unmount();financeObjectPanel=null;}
 if(financeAuditPanel){financeAuditPanel.unmount();financeAuditPanel=null;}
 if(financeCorrectionPanel){financeCorrectionPanel.unmount();financeCorrectionPanel=null;}
 if(financeReviewPanel){financeReviewPanel.unmount();financeReviewPanel=null;}
 if(financeReviewAuditPanel){financeReviewAuditPanel.unmount();financeReviewAuditPanel=null;}
 if(financeArchivePanel){financeArchivePanel.unmount();financeArchivePanel=null;}
 if(financeHistoryPanel){financeHistoryPanel.unmount();financeHistoryPanel=null;}
 if(historicalOrdersPanel){historicalOrdersPanel.unmount();historicalOrdersPanel=null;}
 if(referencePanel){referencePanel.unmount();referencePanel=null;}
 if(legacyTransfersPanel){legacyTransfersPanel.unmount();legacyTransfersPanel=null;}
 if(!data)return;
 if(tab!=='finance')financeDraftIntent='';
 if(tab!=='crm'){estimateWorkspaceOpen=false;if(crmDetailId){crmDetailId=null;crmReminderEditorLeadId=null;}}
 $('#tabs').querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 $('#content').innerHTML=tab==='today'?todayView():tab==='myWork'?myWorkView():tab==='schedule'?scheduleView():tab==='crm'?crmView():tab==='estimator'?estimatorView():tab==='clients'?clientsView():tab==='objects'?objectsView():tab==='orders'?ordersView():tab==='workers'?workersView():tab==='serviceReference'?serviceReferenceView():tab==='historyOrders'?historyOrdersView():tab==='history'?historyView():tab==='catalog'?catalogView():tab==='engineering'?engineeringView():tab==='finance'||tab==='capital'?financeCapitalView(tab):reportView();
 if(tab==='myWork'&&workFlowModalState.kind){
  // render() replaces #content; a recreated WorkLog must be owner-scoped again.
  // Never silently apply a saved draft: offer explicit recovery before input or replay.
  $('#content').insertAdjacentHTML('beforeend',workFlowModalHtml());
  const refreshedFullLog=document.getElementById('workFlowBackdrop')?.querySelector('form[data-full-worklog-form]');
  if(refreshedFullLog){
   worklogDraftOffer(refreshedFullLog);
   if(refreshedFullLog.dataset.draftDecision==='active'||
      refreshedFullLog.dataset.act==='work_log_full_update')
    fullWorkLogGapSchedule(refreshedFullLog,true);
  }
 }
 if(tab==='crm'&&!crmDetailId&&!estimateWorkspaceOpen)void mountLegacyTransfers();
 if(tab==='historyOrders')void mountHistoricalOrders();
 if(tab==='report'||tab==='finance')void mountFinanceHistory();
 if(tab==='finance')void mountFinanceOrderResult();
 if(tab==='finance')void mountFinanceWorkerHistory();
 if(tab==='finance')void mountFinanceObjectResult();
 if(tab==='finance')void mountFinanceMonthlyGains();
 if(tab==='finance'||tab==='capital'){void mountFinanceOpening();void mountFinanceNative();void mountFinanceCapitalArchive();void mountFinanceReview();void mountFinanceReviewAudit();void mountFinanceCorrections();void mountFinanceAudit();}
 if(tab==='serviceReference')void mountServiceReference();
 if(clientDetailId&&(tab==='clients'||(tab==='catalog'&&catalog.entity==='clients'))){
  void loadClientPortfolio(clientDetailId,'objects');
  void loadClientPortfolio(clientDetailId,'orders');
 }
 if(objectDetailId&&(tab==='objects'||(tab==='catalog'&&catalog.entity==='objects'))){
  void loadObjectCardOrders(objectDetailId);
  void loadObjectContacts(objectDetailId);
 }
 if(orderDetailId&&(tab==='orders'||(tab==='catalog'&&catalog.entity==='orders'))){
  void loadOrderCardLogs(orderDetailId);
  void loadOrderContacts(orderDetailId);
 }
 if(data.listsTruncated)message('Основные списки показывают первые 500 записей. Для остальных используй «Поиск» и «Историю».',true);
}
async function refresh(){
 const [state,a1]=await Promise.all([api('/api/state'),api('/api/a1')]);data=state;worklogDraftSetOwner(state.draftOwnerScope);dailyA1=a1;$('#loginPanel').hidden=true;$('#appPanel').hidden=false;$('#logout').hidden=false;$('#menuToggle').hidden=false;setMenuOpen(false,{restoreFocus:false});render();if(tab==='today')void loadTodayDashboard();
}
async function sendAction(type,payload,form){
 if(busy)return;
 const fromClientLead=type==='lead_create'&&Boolean(form?.hasAttribute?.('data-client-lead-form'));
 const isFullLog=Boolean(form?.hasAttribute?.('data-full-worklog-form'));
 busy=true;
 if(isFullLog)fullWorkLogSavePending(form,true);
 let id=payload.requestKey||form?.dataset.requestKey||crypto.randomUUID();
 if(form)form.dataset.requestKey=id;
 try{
  const out=await api('/api/action',{type,payload:{...payload,requestKey:id}});
  if(!out.saved)throw Error('Сервер не подтвердил сохранение.');
  if(fromClientLead){crmClientLeadContext=null;crmDetailId=null;}
  if(type==='crm_won_order_create')crmWonOrderClose(true);
  if(isFullLog){
   worklogDraftAcknowledge(form);
   fullWorkLogSaveConfirmed(form,out,type);
   if(workFlowModalState.kind==='log'){
    workFlowLastNotice=fullWorkLogLastSaved?.text||'✓ Работа сохранена в PostgreSQL.';
    workFlowModalClose({force:true});
   }
  }
  if(form)form.dataset.requestKey='';
  if(type==='schedule_save'&&form?.hasAttribute('data-lead-visit-draft'))scheduleLeadDraft=null;
  if(type==='schedule_save'&&form?.hasAttribute('data-capacity-plan-draft'))scheduleCapacityDraft=null;
  if(type==='schedule_save'&&form?.hasAttribute('data-hourly-manual-form'))resetHourlyManual();
  if(['estimate_create','estimate_save','estimate_accept_handoff'].includes(type)){estimateUI.loaded=false;estimateUI.editor=null;}
  if(type==='worker_task_finish')workerBenchmarkCache={};
  if(['order_create','crm_won_order_create'].includes(type))objectOrdersCard={id:null,items:[],loading:false,loaded:false,error:'',hasMore:false,nextCursor:null};
 if(['order_create','crm_won_order_create','order_update','order_status','object_create','object_update'].includes(type))clientPortfolio=null;
  if(['log_create','log_update','work_log_full_create','work_log_full_update'].includes(type))orderLogs={id:null,items:[],loaded:false,loading:false,error:'',hasMore:false,nextCursor:null,context:null};
  if(type==='object_interaction_add')objectContactState={id:null,items:[],loading:false,loaded:false,error:'',hasMore:false,nextCursor:null};
 if(type==='order_interaction_add')orderContactState={id:null,items:[],loading:false,loaded:false,error:'',hasMore:false,nextCursor:null};
  if(['crm_reminder_save','crm_interaction_add','lead_status','lead_convert','lead_visit_record','lead_update'].includes(type))crmSignalView={leadId:null,loading:false,signal:null,history:null,error:''};
  if(['benchmark_approve','benchmark_revoke'].includes(type))benchmarkProposalState={loaded:false,loading:false,error:'',payload:null};
  try{
   await refresh();
   if(fromClientLead&&out.item?.id){
    const exact=(data?.leads||[]).some(lead=>lead.id===out.item.id);
    if(exact){crmDetailId=out.item.id;render();}
    else message('Обращение сохранено. Для открытия используй поиск по ID: '+out.item.id);
   }
   if(['log_update','work_log_full_update','work_log_full_create'].includes(type)){
    history.loaded=false;history.items=[];
    if(tab==='history')await loadHistory(false);
   }
   if(type==='crm_interaction_add'){crmQuickAction={leadId:null,context:null,kind:null};await loadCrmInteractions(false);}
   if(type==='lead_convert'&&crmInteractionState.entityType==='Lead'&&crmInteractionState.entityId===payload.leadId)await loadCrmInteractions(false);
   if(['crm_master_create','crm_master_update'].includes(type)){crmMasters.opened=true;await loadCrmMasters(false);}
   if(type==='crm_signal_save'){crmSignalView={leadId:null,loading:false,signal:null,history:null,error:''};if(tab==='crm')await loadCrmLeadSignals(payload.leadId);}
   if(['crm_reminder_save','lead_status','lead_convert'].includes(type))schedule.loaded=false;
  // A saved schedule/order/reminder change invalidates advisory Capacity windows.
  if(['schedule_save','schedule_archive','order_create','order_update','order_status','crm_reminder_save','lead_status','lead_convert'].includes(type)){
   invalidateCapacity();
  }
   if(tab==='crm'&&['crm_interaction_add','lead_create','lead_update','lead_status','lead_convert','lead_visit_record','crm_reminder_save','crm_signal_save'].includes(type))await loadCrmFollowups();
   if(type==='lead_convert'&&out.clientId&&tab==='crm')crmWonOrderOpen(payload.leadId);
   if(type==='crm_won_order_create'){
    tab='orders';orderDetailId=out.orderId;crmDetailId=null;crmReminderEditorLeadId=null;
    render();
    message('✓ Заказ создан и связан с лидом, клиентом и объектом.');
   }
   if(tab==='myWork'){await loadMyWork();await loadPresence(false);await loadOwnerActivity(false);}
   if(['session_stop','close_work_order'].includes(type)){
    if(tab!=='myWork')await loadMyWork();
    workFlowContinuationPrompt({
     orderId:out.item?.order_id||(type==='close_work_order'?out.item?.id:'')||'',
     orderTitle:out.item?.title||'',
     source:type
    });
   }
    if(tab==='schedule')await loadSchedule(false);
    if((tab==='crm'||tab==='estimator')&&['estimate_create','estimate_save','estimate_accept_handoff'].includes(type))await loadLeadEstimate();
    if(tab==='catalog'&&catalog.loaded)await loadCatalog(false);
    if(tab==='workers'&&['benchmark_approve','benchmark_revoke'].includes(type))await loadBenchmarkProposals();
   if(type!=='crm_won_order_create'&&type!=='lead_convert')message('Изменения сохранены в PostgreSQL.');
  }catch(e){
   message('PostgreSQL подтвердил сохранение. Не удалось обновить экран: '+e.message,true);
  }
 }catch(e){
  const detail=e.message+' Если запрос оборвался, сначала проверь список и затем повтори с тем же ключом.';
  if(type==='crm_won_order_create')crmWonOrderFeedback('Не сохранено: '+detail,true);
  if(isFullLog){worklogDraftSaveFailed(form,e.status,e.message);fullWorkLogStatus(form,'Не сохранено: '+detail,'error');}
  message(detail,true);
 }
 finally{
  if(isFullLog)fullWorkLogSavePending(form,false);
  busy=false;
 }
}
$('#menuToggle').addEventListener('click',()=>setMenuOpen($('#tabs').hidden));
$('#menuClose').addEventListener('click',()=>setMenuOpen(false));
$('#menuBackdrop').addEventListener('click',()=>setMenuOpen(false));
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&document.getElementById?.('crmWonOrderModal')){crmWonOrderClose();return;}
 if(e.key==='Escape'&&workFlowModalState.kind){workFlowModalClose();return;}
 if(e.key==='Escape'&&!$('#tabs').hidden)setMenuOpen(false);
});
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b){crmWonOrderClose(true);workFlowModalClose({force:true});tab=b.dataset.tab;crmClientLeadContext=null;crmDetailId=null;crmReminderEditorLeadId=null;clientDetailId=null;objectDetailId=null;orderDetailId=null;clientReturn=null;objectReturnId=null;objectReturnTab=null;setMenuOpen(false);message('');render();if(tab==='today')void loadTodayDashboard();if(tab==='crm'&&!crmFollowupState.loaded)void loadCrmFollowups();if(tab==='history'&&!history.loaded)loadHistory();if(tab==='catalog'&&!catalog.loaded)loadCatalog();if(tab==='myWork'){loadMyWork();loadPresence(false);loadOwnerActivity(false);}if(tab==='schedule'){capacity.loaded=false;capacity.result=null;capacity.error='';loadSchedule(false);}else resetHourlyManual();if(tab==='engineering'){loadEngineeringCalculation();loadEngineeringDrawing();loadEngineeringFloor();}if(tab==='estimator'){estimatorSubtab='calculator';void ensurePlumbingCalculator();void loadEstimatorCards();void loadEstimatorPricebook();}}});
$('#content').addEventListener('change',async e=>{
  if(tab==='estimator'&&e.target?.matches?.('[data-est-price-card-select]')){
   estimatorPriceState.selectedCardKey=e.target.value;render();return;
  }
  if(tab==='estimator'&&e.target?.name==='recipeMode'&&e.target?.form?.id==='estimatorCardForm'){
   try{estimatorCaptureCardEditor();render();}catch(error){message(String(error.message||error),true);}
   return;
  }
 const timeStart=tab==='schedule'&&e.target.closest('form[data-hourly-manual-form] input[name="startAt"]');
 if(timeStart&&!scheduleLeadDraft&&!scheduleCapacityDraft&&hourlyManual.open){
  const date=String(timeStart.value||'').slice(0,10);
  if(/^\d{4}-\d{2}-\d{2}$/.test(date)&&date!==hourlyManual.date){
   hourlyManual.date=date;hourlyManual.slot=null;void hourlyFindManual();
  }
  return;
 }
 const masterSelector=e.target.closest('form[data-act="lead_transfer"] select[name="masterId"]');
 if(masterSelector){
  const receiver=masterSelector.form.querySelector('input[name="recipientName"]');
  if(receiver){receiver.value='';receiver.disabled=Boolean(masterSelector.value);receiver.required=!masterSelector.value;}
  return;
 }
 if(tab==='catalog'&&e.target.name==='entity'&&e.target.form?.id==='catalogFilters'){
  const entity=e.target.value;
  if(!['clients','leads','objects','orders'].includes(entity))return;
  catalog={...catalog,entity,q:(e.target.form.elements.namedItem('q')?.value||'').trim(),
   status:'',tier:'',referral:'',items:[],nextCursor:null,hasMore:false,loaded:false};
  message('');render();return;
 }
 if(tab==='myWork'&&e.target?.id==='myWorkOrderSelect'){
  myWork.selectedOrderId=e.target.value||'';
  myWork.snapshot=null;myWork.loaded=false;
  message('');render();
  await loadMyWork();return;
 }
 if(tab==='engineering'&&efModule&&edModule&&e.target.matches('[data-ef-import]')){
  const file=e.target.files?.[0];if(!file)return;
  try{
   if(file.size>200000)throw Error('Размер этажа больше 200 КБ.');
   const imported=efModule.importFloor(await file.text());
   efFloor=imported;
   edDraft=imported.rooms.length?edModule.validateDrawing(imported.rooms[0]):edModule.newDrawing('CLEAN-DRAFT-'+crypto.randomUUID());
   edAnchor=null;drawingRecalculate();
   edMessage='Этаж восстановлен из JSON. Проверь связи стен и расчёт.';
  }catch(err){edMessage='Импорт этажа отклонён: '+err.message;}
  render();return;
 }
 if(tab!=='engineering'||!edModule||!e.target.matches('[data-ed-import]'))return;
 const file=e.target.files?.[0];if(!file)return;
 try{if(file.size>25000)throw Error('Максимальный размер JSON — 25 КБ.');
  edDraft=edModule.importDrawing(await file.text());edAnchor=null;drawingRecalculate();edMessage='Чертёж загружен из локального файла.';}
 catch(err){edMessage='Импорт отклонён: '+err.message;}
 render();
});
$('#content').addEventListener('toggle',e=>{
 const detail=e.target;
 if(detail.matches?.('details[data-crm-advanced]'))crmAdvancedOpen=detail.open;
 if(detail.matches?.('details[data-crm-legacy-archive]'))crmArchiveOpen=detail.open;
},true);
$('#content').addEventListener('submit',async e=>{
 e.preventDefault();
 const f=e.target;
 if(f.matches('[data-workflow-day-start]')){await workFlowModalSubmitDay(f,'start');return;}
 if(f.matches('[data-workflow-day-finish]')){await workFlowModalSubmitDay(f,'finish');return;}
 if(f.matches('[data-workflow-finish-presence-stop]')){
  const visit=myWork.snapshot?.currentPresence;
  if(!visit||visit.id!==f.elements.namedItem('id')?.value||visit.day_date!==myWork.snapshot.today){
   message('Присутствие изменилось. Обнови день.',true);return;
  }
  const payload=Object.fromEntries(new FormData(f));
  workFlowModalClose({force:true});await sendAction('presence_stop',payload,f);return;
 }
 if(tab==='schedule'&&f.id==='capacitySearch'){
  const v=Object.fromEntries(new FormData(f));
  const duration=Number(v.durationWorkingDays);
  if(!Number.isInteger(duration)||duration<1||duration>60||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v.startDate||''))){
   message('Укажи корректную дату и 1–60 рабочих дней.',true);return;
  }
  capacity.startDate=v.startDate;capacity.durationWorkingDays=duration;
  await loadCapacity();
  scheduleRevealSection(capacity.loaded&&capacity.result?'#capacityResults':'#capacityFinder');
  return;
 }
 if(tab==='engineering'&&edModule&&edDraft&&f.id==='engineeringDrawingParameters'){
  try{edDraft=edModule.commitDraftForm(edDraft,Object.fromEntries(new FormData(f)));drawingRecalculate();edMessage=edResult?.status==='COMPLETE'?'Теплопотери автоматически пересчитаны из чертежа.':'Параметры приняты. Для расчёта заполни недостающие данные.';}
  catch(err){edMessage='Параметры не приняты: '+err.message;}
  render();return;
 }
 if(tab==='engineering'&&edModule&&edDraft&&f.id==='engineeringDrawingOpening'){
  try{edDraft=edModule.addOpening(edDraft,Object.fromEntries(new FormData(f)));drawingRecalculate();edMessage='Проём добавлен; площадь стены и потери пересчитаны.';}
  catch(err){edMessage='Ошибка проёма: '+err.message;}
  render();return;
 }
 if(f.id==='engineeringCalculationForm'){
  if(!egModule)return;
  egInputs=Object.fromEntries(new FormData(f));
  try{egResult=egModule.calculateRoomHeating(egInputs);}
  catch{egResult={status:'INVALID',note:'Ошибка расчёта. Проверьте введённые значения.'};}
  render();
  return;
 }
 if(f.id==='passwordForm'){
  const o=Object.fromEntries(new FormData(f));try{await api('/api/password',o);clientDetailId=null;objectDetailId=null;orderDetailId=null;clientReturn=null;crmClientLeadContext=null;data=null;worklogDraftSetOwner('');crmFollowupState={loaded:false,loading:false,result:null,error:''};dailyA1=null;workerBenchmarkCache={};benchmarkProposalState={loaded:false,loading:false,error:'',payload:null};schedule.loaded=false;schedule.items=[];schedule.dayFilter='all';schedule.error='';capacity={startDate:'',durationWorkingDays:3,result:null,loading:false,loaded:false,error:''};capacityWorkOrderContext=null;workOrderCapacityOpenSeq++;scheduleCapacityDraft=null;resetHourlyManual();ownerActivity.loaded=false;ownerActivity.active=null;ownerActivity.items=[];presence.loaded=false;presence.active=null;presence.items=[];myWork.snapshot=null;myWork.loaded=false;myWork.selectedOrderId='';myWork.error='';clearDrawingSession();setMenuOpen(false,{restoreFocus:false});$('#menuToggle').hidden=true;$('#loginPanel').hidden=false;$('#appPanel').hidden=true;$('#logout').hidden=true;alert('Пароль изменён. Войди с новым.');}catch(err){message(err.message,true);}return;
 }
 if(f.id==='crmMasterFilters'){
  const fields=Object.fromEntries(new FormData(f));
  crmMasters.q=String(fields.q||'').trim();crmMasters.status=fields.status||'';
  crmMasters.opened=true;crmMasters.nextCursor=null;await loadCrmMasters(false);return;
 }
 const portfolioForm=f.dataset.clientPortfolioFilter;
 if(portfolioForm&&clientDetailId&&['objects','orders'].includes(portfolioForm)){
  const fields=Object.fromEntries(new FormData(f));
  if(!clientPortfolio||clientPortfolio.id!==clientDetailId)clientPortfolio=clientPortfolioNew(clientDetailId);
  const p=clientPortfolio[portfolioForm];
  clientPortfolio[portfolioForm]={...p,q:String(fields.q||'').trim(),
   status:portfolioForm==='orders'?(fields.status||'all'):'all',
   items:[],nextCursor:null,hasMore:false,loaded:false,loading:false,error:''};
  await loadClientPortfolio(clientDetailId,portfolioForm);return;
 }
 if(f.id==='historyFilters'){
  const fields=Object.fromEntries(new FormData(f).entries());
  if(fields.mode==='period'&&(!fields.from||!fields.to)){message('Для периода укажи обе даты.',true);return;}
  history.filters=fields;
  await loadHistory(false);
  return;
 }
 if(f.id==='scheduleAnchor'){
   const date=Object.fromEntries(new FormData(f).entries()).anchorDate;
   schedule.anchorDate=date;schedule.selectedDay=date;await loadSchedule(false);return;
  }
  if(f.id==='ownerActivityFilters'){
 const d=Object.fromEntries(new FormData(f).entries()).date;
 await loadOwnerActivity(false,d);return;
}
if(f.id==='presenceFilters'){
   const v=Object.fromEntries(new FormData(f).entries());
   await loadPresence(false,v.date);return;
  }
  if(f.id==='catalogFilters'){
   const fields=Object.fromEntries(new FormData(f).entries());
   if(fields.q.trim().length===1){message('Для поиска укажи минимум 2 символа.',true);return;}
   clientDetailId=null;objectDetailId=null;orderDetailId=null;clientReturn=null;
   catalog.entity=fields.entity;catalog.q=fields.q.trim();
   catalog.status=fields.status||'';catalog.tier=fields.tier||'';catalog.referral=fields.referral||'';
   catalog.nextCursor=null;
   await loadCatalog(false);return;
  }
  const type=f.dataset.act;if(!type)return;
 if(type==='lead_create'&&f.hasAttribute('data-client-lead-form')&&
  (!crmClientLeadContext||new FormData(f).get('clientId')!==crmClientLeadContext.clientId)){
  message('Выбранный клиент изменился. Вернись к его карточке и начни обращение заново.',true);return;
 }
 if(type==='estimate_accept_handoff'&&!confirm('Согласовать сохранённую смету и создать один новый заказ? Это не создаёт оплату или запись в календаре.'))return;
 if(type==='lead_transfer'&&!confirm('Передать лид получателю и завершить обращение? Повторно передать будет нельзя.'))return;
 if(type==='estimate_save'){
  if(!f.reportValidity())return;
  estimateCaptureForm();
  const editor=estimateUI.editor;
  if(!editor){message('Смета не загружена.',true);return;}
  const estimate=estimateUI.result?.estimate;
  if(!estimate){message('Черновик сметы не найден.',true);return;}
  await sendAction('estimate_save',{
   estimateId:estimate.id,revision:estimate.revision,title:editor.title,notes:editor.notes,
   lines:editor.lines.map(x=>({...x,unitPriceAMD:String(x.unitPriceAMD??'').trim()}))
  },f);return;
 }
  if(type==='close_work_order'&&!confirm('Закрыть этот новый заказ Clean? Операция сохранит оценку и ручную финансовую проверку. Статус полной оплаты останется неподтверждённым.'))return;
  if(['benchmark_approve','benchmark_revoke'].includes(type)&&!confirm(type==='benchmark_approve'?'Подтвердить сохранение выбранного норматива?':'Отменить действующий норматив?'))return;
 const isFullLog=f.hasAttribute('data-full-worklog-form');
 if(isFullLog){
  if(!worklogDraftPending(f)){
   const check=fullWorkLogValidate(f);
   if(!check.ok){message(check.message,true);return;}
  }
 }else if(!f.reportValidity())return;
 let payload=Object.fromEntries(new FormData(f).entries());
 if(isFullLog){
  const frozen=worklogDraftPrepareSubmit(f,payload);
  if(!frozen){message('Черновик не подготовлен для безопасной отправки.',true);return;}
  payload=frozen;
 }
 if(type==='lead_transfer')payload.confirm='TRANSFER_LEAD';
 if(type==='close_work_order'){
   const fields=['satisfaction','acceptance','paymentBehavior','communicationQuality','scopeChanges','workAgain'];
   const a={};for(const field of fields){a[field]=payload['a_'+field];delete payload['a_'+field];}
   a.comment=payload.assessmentComment||'';delete payload.assessmentComment;
   payload.clientAssessment=a;
   if(payload.financeChecked!=='yes'||payload.unfinishedObligationsStatus!=='NONE'){
    message('Подтверди финансовую проверку и отсутствие незавершённых обязательств.',true);return;
   }
 }
  if(type==='owner_activity_start'){
  const relation=String(payload.relation||'');delete payload.relation;
  if(relation){const separator=relation.indexOf('|');if(separator<1){message('Некорректная связь CRM.',true);return;}
   payload.relatedEntityType=relation.slice(0,separator);payload.relatedEntityId=relation.slice(separator+1);}
 }
 if(type==='schedule_save'&&f.hasAttribute('data-capacity-plan-draft')&&scheduleCapacityDraft?.workOrderId&&
   (payload.orderId!==scheduleCapacityDraft.orderId||payload.objectId!==scheduleCapacityDraft.objectId)){
  message('План заказа: связь WorkOrder → Object изменена. Восстанови исходный заказ и объект или отмени подготовку.',true);return;
 }
 if(type==='schedule_save'&&tab==='schedule'&&await legacyConflictBeforeSave(f,payload))return;
 await sendAction(type,payload,f);
});
$('#content').addEventListener('input',e=>{
 const dialogForm=e.target.closest('#workFlowBackdrop form');
 if(dialogForm)dialogForm.dataset.workflowDirty='1';
 const full=e.target.closest('form[data-full-worklog-form]');
 if(full){fullWorkLogFormUpdated(full);fullWorkLogGapSchedule(full);worklogDraftAutosave(full);}
 const scheduleForm=e.target.closest('form[data-act="schedule_save"]');
 if(scheduleForm)legacyConflictInvalidate(scheduleForm);
 const phone=e.target.closest('form[data-act="client_create"] input[name="phone"],form[data-act="client_update"] input[name="phone"]');
 if(phone)refreshClientDuplicateHint(phone);
 const inp=e.target.closest('input[data-pw-search]');
 if(!inp)return;
 const q=String(inp.value||'').trim().toLocaleLowerCase('ru');
 $('#pwSelect')?.querySelectorAll('[data-pw-item]').forEach(card=>{
  card.hidden=!String(card.dataset.pwName||'').includes(q);
 });
});
$('#content').addEventListener('change',e=>{
 const full=e.target.closest('form[data-full-worklog-form]');
 if(full){fullWorkLogFormUpdated(full);fullWorkLogGapSchedule(full);worklogDraftAutosave(full);}
 const scheduleForm=e.target.closest('form[data-act="schedule_save"]');
 if(scheduleForm)legacyConflictInvalidate(scheduleForm);
 const pw=e.target.closest('input[data-pw-all],input[data-pw-action]');
 if(pw){
  const card=pw.closest('[data-pw-actions]');
  if(card){
   const actions=[...card.querySelectorAll('input[data-pw-action]')];
   const all=card.querySelector('input[data-pw-all]');
   if(pw.hasAttribute('data-pw-all'))actions.forEach(input=>{input.checked=pw.checked;});
   else if(all)all.checked=actions.length>0&&actions.every(input=>input.checked);
  }
 }
});
$('#content').addEventListener('click',async e=>{
 const editLog=e.target.closest('button[data-workflow-edit-log]');
 if(editLog){const id=editLog.dataset.workflowEditLog;
  const item=[...(history.items||[]),...(data.logs||[])].find(x=>x.id===id);
  if(!item||!item.detail){message('Подробная работа не найдена в истории. Обнови список.',true);return;}
  if(tab!=='myWork'){tab='myWork';render();await loadMyWork();}
  workFlowModalOpen('log',{item,orderId:item.order_id,trigger:editLog});return;
 }
 const stopForFinish=e.target.closest('button[data-workflow-finish-stop-session]');
 if(stopForFinish){
  const live=myWork.snapshot?.currentSession;
  if(!live||live.id!==stopForFinish.dataset.id||live.day_date!==myWork.snapshot?.today){
   message('Интервал изменился. Обнови экран.',true);return;
  }
  workFlowModalClose({force:true});await sendAction('session_stop',{id:live.id},stopForFinish);return;
 }
 const keepDay=e.target.closest('button[data-workflow-day-continues]');
 if(keepDay){
  workFlowModalClose({force:true});
  if(tab!=='myWork'){tab='myWork';render();await loadMyWork();}
  message('Рабочий день продолжается. Выбери следующий заказ.');
  return;
 }
 const endDay=e.target.closest('button[data-workflow-day-is-over]');
 if(endDay){workFlowModalOpen('finish',{trigger:endDay});return;}
 if(e.target.closest('button[data-workflow-close]')){workFlowModalClose();return;}
 if(e.target.matches?.('[data-workflow-backdrop]')){workFlowModalClose();return;}
 const open=e.target.closest('button[data-workflow-open]');
 if(open){
  const orderId=open.dataset.orderId||'';
  if(open.dataset.workflowOpen==='log'&&!myWork.snapshot){
   if(orderId)myWork.selectedOrderId=orderId;
   await loadMyWork();
  }
  workFlowModalOpen(open.dataset.workflowOpen,{orderId,trigger:open});return;
 }
 const restoreDraft=e.target.closest('button[data-full-worklog-draft-restore]');
 if(restoreDraft){worklogDraftRestore(restoreDraft.closest('form'));return;}
 const deleteDraft=e.target.closest('button[data-full-worklog-draft-delete]');
 if(deleteDraft){worklogDraftDelete(deleteDraft.closest('form'));return;}
 const copy=e.target.closest('button[data-full-worklog-copy]');
 if(copy){fullWorkLogCopyPrevious(copy.closest('form'),orderLogs);worklogDraftAutosave(copy.closest('form'));return;}
 if(tab==='schedule'&&legacyConflictHandleClick(e.target))return;
 if(e.target.closest('button[data-crm-master-load]')){
  const openLead=e.target.closest('[data-crm-detail-page]');
  if(openLead)crmTransferOpenLeadId=openLead.dataset.crmDetailPage;
  if(e.target.closest('[data-crm-master-directory]'))crmMasters.opened=true;
  await loadCrmMasters(false);return;
 }
 if(e.target.closest('button[data-crm-master-more]')){crmMasters.opened=true;await loadCrmMasters(true);return;}
 const allSearch=e.target.closest('button[data-crm24-search]');
 if(allSearch){
  const entity=allSearch.dataset.crm24Search;
  if(!['clients','leads'].includes(entity))return;
  catalog={...catalog,entity,q:'',status:'',tier:'',referral:'',
   items:[],nextCursor:null,hasMore:false,loaded:false};
  clientDetailId=null;crmDetailId=null;tab='catalog';message('');render();return;
 }
 const manualSummary=e.target.closest('summary[data-hourly-new-summary]');
 if(tab==='schedule'&&manualSummary&&!scheduleLeadDraft&&!scheduleCapacityDraft){
  e.preventDefault();
  const opening=!hourlyManual.open;
  if(opening){
   hourlyManual.open=true;hourlyManual.date=schedule.selectedDay||data.today;
   hourlyManual.slot=null;hourlyManual.note='';
  }else resetHourlyManual();
  render();
  if(opening&&!hourlySunday(hourlyManual.date))void hourlyFindManual();
  return;
 }
 const addSelectedDay=e.target.closest('button[data-hourly-add-day]');
 if(tab==='schedule'&&addSelectedDay){
  const date=addSelectedDay.dataset.hourlyAddDay;
  if(!schedule.loaded||date<schedule.periodStart||date>schedule.periodEnd)return;
  if(scheduleLeadDraft||scheduleCapacityDraft){
   message('Сначала сохрани или отмени подготовленную задачу CRM/Capacity.',true);return;
  }
  resetHourlyManual();hourlyManual.open=true;hourlyManual.date=date;
  if(hourlySunday(date))hourlyManual.note='Воскресенье — выходной. Личное/организационное время можно указать вручную.';
  render();
  // The editor follows the day's entries. Reveal it on mobile after the add-day action.
  const editor=document.querySelector('details[data-hourly-new-editor][open]');
  if(editor){
   editor.scrollIntoView?.({block:'start',behavior:'auto'});
   editor.querySelector('summary')?.focus?.({preventScroll:true});
  }
  if(!hourlySunday(date))void hourlyFindManual();
  return;
 }
 const manualCategory=e.target.closest('button[data-hourly-category]');
 if(tab==='schedule'&&manualCategory&&!scheduleLeadDraft&&!scheduleCapacityDraft){
  const category=manualCategory.dataset.hourlyCategory;
  if(!['Личное','Организационное'].includes(category))return;
  hourlyManual.category=category;
  const input=document.querySelector('form[data-hourly-manual-form] input[name="itemType"]');
  if(input)input.value=category;
  const host=document.querySelector('[data-hourly-assistant]');
  host?.querySelectorAll('[data-hourly-category]')?.forEach(button=>
   button.setAttribute('aria-pressed',String(button.dataset.hourlyCategory===category)));
  return;
 }
 const manualDuration=e.target.closest('button[data-hourly-duration]');
 if(tab==='schedule'&&manualDuration&&!scheduleLeadDraft&&!scheduleCapacityDraft){
  const duration=Number(manualDuration.dataset.hourlyDuration);
  if(!hourlyQuickDurations.includes(duration)||hourlyManual.loading)return;
  hourlyManual.duration=duration;hourlyManual.slot=null;
  const host=document.querySelector('[data-hourly-assistant]');
  host?.querySelectorAll('[data-hourly-duration]')?.forEach(button=>
   button.setAttribute('aria-pressed',String(Number(button.dataset.hourlyDuration)===duration)));
  void hourlyFindManual();return;
 }
 if(tab==='schedule'&&e.target.closest('button[data-hourly-find]')){
  void hourlyFindManual();return;
 }
 const capacityQuick=e.target.closest('button[data-capacity-quick]');
 if(tab==='schedule'&&capacityQuick){
  const value=Number(capacityQuick.dataset.capacityQuick);
  if(!capacity.loading&&capacityDurationPresets.includes(value)){
   capacity.durationWorkingDays=value;capacity.loaded=false;capacity.result=null;capacity.error='';
   render(); // legacy presets set input only; finding candidates still requires explicit search
  }
  return;
 }
 if(tab==='schedule'&&e.target.closest('button[data-cancel-capacity-draft]')){
  scheduleCapacityDraft=null;render();return;
 }
 if(tab==='schedule'&&e.target.closest('button[data-capacity-clear-order]')){
  if(scheduleCapacityDraft?.workOrderId){message('Сначала сохрани или отмени подготовленный план заказа.',true);return;}
  capacityWorkOrderContext=null;capacity.startDate='';invalidateCapacity();render();return;
 }
 const capacityPlan=e.target.closest('button[data-capacity-plan-start]');
 if(tab==='schedule'&&capacityPlan){
  const start=capacityPlan.dataset.capacityPlanStart,end=capacityPlan.dataset.capacityPlanEnd;
  if(!capacity.result?.windows?.some(x=>x.start===start&&x.end===end)){
   message('Предложенное окно устарело. Повтори поиск Capacity.',true);return;
  }
  if(scheduleLeadDraft){message('Сначала сохрани или отмени подготовленный план из CRM.',true);return;}
  if(scheduleCapacityDraft&&(scheduleCapacityDraft.start!==start||scheduleCapacityDraft.end!==end)){
   message('Сначала сохрани или отмени предыдущую подготовку Capacity.',true);return;
  }
  resetHourlyManual();
  const order=capacityWorkOrderContext;
  scheduleCapacityDraft={start,end,...(order?{workOrderId:order.orderId,orderId:order.orderId,
   objectId:order.objectId,title:order.title,objectName:order.objectName}:{})};
  schedule.selectedDay=start;message('');
  if(schedule.loaded&&start>=schedule.periodStart&&start<=schedule.periodEnd){
   render();scheduleRevealSection('#scheduleCapacityEditor');return;
  }
  schedule.viewMode='week';schedule.anchorDate=start;schedule.loaded=false;
  render();await loadSchedule(false);
  if(schedule.loaded&&scheduleCapacityDraft)scheduleRevealSection('#scheduleCapacityEditor');
  return;
 }
 const capacityDay=e.target.closest('button[data-capacity-open-day]');
 if(tab==='schedule'&&capacityDay){
  const date=capacityDay.dataset.capacityOpenDay;
  if(!capacity.result?.windows?.some(x=>x.start===date))return;
  schedule.selectedDay=date;message('');
  if(schedule.loaded&&date>=schedule.periodStart&&date<=schedule.periodEnd){
   render();return;
  }
  schedule.viewMode='week';schedule.anchorDate=date;
  schedule.loaded=false;render();await loadSchedule(false);return;
 }
 if(tab==='today'&&e.target.closest('button[data-today-refresh]')){
  await loadTodayDashboard();return;
 }
 const todayRoute=e.target.closest('button[data-today-route]');
 if(tab==='today'&&todayRoute){
  const dest=todayRoute.dataset.todayRoute;
  if(!['myWork','schedule','crm','finance','catalog','report'].includes(dest))return;
  tab=dest;message('');
  if(dest==='schedule'){schedule.viewMode='week';schedule.anchorDate=data.today;schedule.selectedDay=data.today;schedule.loaded=false;}
  if(dest==='catalog'){catalog.entity='objects';catalog.loaded=false;}
  render();
  if(dest==='myWork'){await loadMyWork();await loadPresence(false);await loadOwnerActivity(false);}
  if(dest==='schedule')await loadSchedule(false);
  if(dest==='crm'&&todayRoute.dataset.todayIntent==='newLead'){
   const panel=document.querySelector('.crm-new-lead details');
   if(panel){panel.setAttribute('open','');panel.querySelector('input[name="title"]')?.focus({preventScroll:true});}
  }
  if(dest==='crm'&&!crmFollowupState.loaded)await loadCrmFollowups();
  if(dest==='catalog')await loadCatalog(false);
  return;
 }
 const todayLead=e.target.closest('button[data-today-lead]');
 if(tab==='today'&&todayLead){
  const id=todayLead.dataset.todayLead;
  tab='crm';message('');render();
  if(!crmFollowupState.loaded)await loadCrmFollowups();
  if(data.leads?.some(x=>x.id===id))openCrmLeadDetail(id);
  else message('Обращение за пределами первых 500. Открой его через поиск.',true);
  return;
 }
 const focusTile=e.target.closest('button[data-crm-focus-filter]');
 if(focusTile){
  const next=focusTile.dataset.crmFocusFilter;
  if(!crmFollowupGroups.some(([key])=>key===next))return;
  crmFocusFilter=next;crmQuickAction={leadId:null,context:null,kind:null};render();return;
 }
 const quick=e.target.closest('button[data-crm-quick-lead]');
 if(quick){
  const id=quick.dataset.crmQuickLead,kind=quick.dataset.crmQuickKind,context=quick.dataset.crmQuickContext;
  if(!data?.leads?.some(x=>x.id===id&&['new','contacted','qualified'].includes(x.status))||
   !['call','message','no_answer'].includes(kind)||!['focus','priority','list','detail'].includes(context)){
   message('Действие недоступно для этого обращения.',true);return;
  }
  crmQuickAction={leadId:id,kind,context};render();
  const editor=[...document.querySelectorAll('form[data-crm-quick-form-id]')]
   .find(x=>x.dataset.crmQuickFormId===id&&x.dataset.crmQuickFormContext===context);
  editor?.scrollIntoView({behavior:'smooth',block:'center'});
  editor?.querySelector('[name="summary"]')?.focus({preventScroll:true});
  return;
 }
 if(e.target.closest('button[data-crm-quick-cancel]')){
  crmQuickAction={leadId:null,context:null,kind:null};render();return;
 }
 const openReminder=e.target.closest('button[data-crm-reminder-open]');
 if(openReminder){openCrmLeadDetail(openReminder.dataset.crmReminderOpen,{reminder:true});return;}
 if(e.target.closest('button[data-crm-back]')){
  if(tab==='crm')backToCrmLeads();
  return;
 }
 const openExisting=e.target.closest('button[data-crm-lead-open]');
 if(openExisting){openCrmLeadDetail(openExisting.dataset.crmLeadOpen);return;}
 const signalLoad=e.target.closest('button[data-crm-signal-load]');
 if(signalLoad){await loadCrmLeadSignals(signalLoad.dataset.crmSignalLoad);return;}
 const reminderClear=e.target.closest('button[data-crm-reminder-clear]');
 if(reminderClear){
  const lead=data?.leads?.find(x=>x.id===reminderClear.dataset.crmReminderClear);
  if(!lead){message('Обращение не найдено.',true);return;}
  await sendAction('crm_reminder_save',{leadId:lead.id,revision:lead.revision,nextAction:'',nextActionAt:''},reminderClear);
  return;
 }
 if(e.target.closest('button[data-crm-followup-refresh]')){await loadCrmFollowups();return;}
 const attentionOpen=e.target.closest('button[data-crm-followup-lead]');
 if(attentionOpen){openCrmLeadDetail(attentionOpen.dataset.crmFollowupLead);return;}
 const assessmentOpen=e.target.closest('button[data-client-assessment-open]');
 if(assessmentOpen){
  const id=assessmentOpen.dataset.clientAssessmentOpen;
  if(!data?.clients?.some(client=>client.id===id)){
   message('Клиент не загружен. Обнови список.',true);return;
  }
  if(clientAssessmentState.opened&&clientAssessmentState.clientId===id){
   clientAssessmentState={clientId:'',opened:false,loaded:false,loading:false,error:'',result:null};
   render();return;
  }
  clientAssessmentState={clientId:id,opened:true,loaded:false,loading:false,error:'',result:null};
  await loadClientAssessments();return;
 }
 const archiveOpen=e.target.closest('button[data-crm23-open]');
 if(archiveOpen){
  const id=archiveOpen.dataset.crm23Open;
  if(!data?.clients?.some(c=>c.id===id)){
   message('Клиент не загружен. Обнови список.',true);return;
  }
  if(crmLegacyInteractionState.opened&&crmLegacyInteractionState.clientId===id){
   crmLegacyInteractionState={clientId:'',opened:false,loaded:false,loading:false,error:'',result:null};
   render();return;
  }
  crmLegacyInteractionState={clientId:id,opened:true,loaded:false,loading:false,error:'',result:null};
  await loadCrm23LegacyInteractions();return;
 }
 const interactionOpen=e.target.closest('button[data-crm-interaction-open]');
 if(interactionOpen){
  const type=interactionOpen.dataset.crmInteractionType,id=interactionOpen.dataset.crmInteractionOpen;
  if(!data||!['Lead','Client'].includes(type))return;
  const source=type==='Lead'?data.leads:data.clients;
  if(!source.some(x=>x.id===id)){message('Карточка не загружена. Обнови список.',true);return;}
  if(crmInteractionState.entityType===type&&crmInteractionState.entityId===id){
   crmInteractionState={entityType:'',entityId:'',items:[],hasMore:false,nextCursor:null,loaded:false,loading:false,error:''};render();return;
  }
  crmInteractionState={entityType:type,entityId:id,items:[],hasMore:false,nextCursor:null,loaded:false,loading:false,error:''};
  await loadCrmInteractions();return;
 }
 if(e.target.closest('button[data-crm-interaction-more]')){await loadCrmInteractions(true);return;}
 if(tab==='estimator'){
  if(e.target.closest('button[data-est-price-retry]')){
   void loadEstimatorPricebook(true);return;
  }
  const profileSave=e.target.closest('button[data-est-profile-save]');
  if(profileSave){
   if(!estimatorPriceState.loaded){message('Сначала загрузи прайс.',true);return;}
   const code=profileSave.dataset.estProfileSave;
   const profile=estimatorPriceState.module.pricebookProfile(estimatorPricebookSnapshot(),code);
   const panel=profileSave.closest('[data-est-price-profile]');
   const val=name=>panel?.querySelector('[name="'+name+'"]')?.value;
   await estimatorSubmitPrice('estimator_tariff_save',{
    tariffCode:code,revision:profile.revision,multiplier:val('multiplier'),
    roundingStep:val('roundingStep')});
   return;
  }
  const priceSave=e.target.closest('button[data-est-price-save]');
  if(priceSave){
   if(!estimatorPriceState.loaded){message('Сначала загрузи прайс.',true);return;}
   const actionType=priceSave.dataset.estPriceSave,cardKey=priceSave.dataset.estPriceCard||'';
   const panel=priceSave.closest('[data-est-price-rule]');
   const rule=estimatorPriceRule(actionType,cardKey);
   const val=name=>panel?.querySelector('[name="'+name+'"]')?.value??'';
   await estimatorSubmitPrice('estimator_price_save',{
    scopeType:actionType==='FIXTURE_INSTALL'?'CARD_ACTION':'GLOBAL_ACTION',
    actionType,cardKey,revision:rule?.revision??0,
    economyBaseAMD:val('economy'),standardFloorAMD:val('standard'),
    vipFloorAMD:val('vip')});
   return;
  }
  if(e.target.closest('button[data-estimator-card-new]')){estimatorStartEditor();return;}
  const cardEdit=e.target.closest('button[data-estimator-card-edit]');
  if(cardEdit){estimatorStartEditor(cardEdit.dataset.estimatorCardEdit);return;}
  if(e.target.closest('button[data-estimator-card-cancel]')){
   estimatorCardState.editor=null;estimatorCardState.requestKey=null;render();return;
  }
  if(e.target.closest('button[data-estimator-material-add]')){
   try{
    const draft=estimatorCaptureCardEditor();
    if(draft.materials.length>=100)throw Error('Максимум 100 материалов.');
    if(draft.sourceType==='SYSTEM'&&draft.recipeMode==='SOURCE')
     throw Error('Сначала выбери «Мой список материалов».');
    draft.materials.push({name:'',quantity:'1.000',unit:'шт',section:''});
    render();
   }catch(error){message(String(error.message||error),true);}return;
  }
  const materialRemove=e.target.closest('button[data-estimator-material-remove]');
  if(materialRemove){
   try{
    const draft=estimatorCaptureCardEditor(),i=Number(materialRemove.dataset.estimatorMaterialRemove);
    if(!Number.isInteger(i)||i<0||i>=draft.materials.length)throw Error('Позиция материала не найдена.');
    if(draft.sourceType==='SYSTEM'&&draft.recipeMode==='SOURCE')throw Error('Сначала выбери свой рецепт.');
    draft.materials.splice(i,1);render();
   }catch(error){message(String(error.message||error),true);}return;
  }
  if(e.target.closest('button[data-estimator-card-save]')){
   try{
    const form=$('#estimatorCardForm');
    if(!form?.reportValidity())return;
    const d=estimatorCaptureCardEditor();
    await estimatorSubmitCard('estimator_card_save',{
     cardKey:d.cardKey,revision:d.revision,displayName:d.displayName,category:d.category,
     unit:d.unit,supportsWater:d.supportsWater,supportsSewer:d.supportsSewer,
     supportsInstall:d.supportsInstall,waterPoints:d.waterPoints,
     sewerPoints:d.sewerPoints,notes:d.notes,recipeMode:d.recipeMode,materials:d.materials
    });
   }catch(error){message(String(error.message||error),true);}return;
  }
  const cardArchive=e.target.closest('button[data-estimator-card-archive]');
  if(cardArchive){
   const d=estimatorCardState.items.find(x=>x.cardKey===cardArchive.dataset.estimatorCardArchive);
   if(!d||d.sourceType!=='USER'||d.status!=='active')return;
   if(!window.confirm('Архивировать пользовательскую карточку? Старые сметы сохранятся.'))return;
   await estimatorSubmitCard('estimator_card_archive',{cardKey:d.cardKey,revision:d.revision});return;
  }
  const cardReset=e.target.closest('button[data-estimator-card-reset]');
  if(cardReset){
   const d=estimatorCardState.items.find(x=>x.cardKey===cardReset.dataset.estimatorCardReset);
   if(!d||d.sourceType!=='SYSTEM'||!d.hasOverride)return;
   if(!window.confirm('Вернуть исходные настройки системной карточки? Старые сметы не изменятся.'))return;
   await estimatorSubmitCard('estimator_card_reset',{cardKey:d.cardKey,revision:d.revision});return;
  }
 }
 const estimatorSubtabButton=e.target.closest('button[data-estimator-subtab]');
 if(estimatorSubtabButton){
  const choice=estimatorSubtabButton.dataset.estimatorSubtab;
  if(!['calculator','prices','cards'].includes(choice))return;
  try{estimatorSaveVisibleWizard();}catch(error){plumbingShowStepError(error);return;}
  estimatorSubtab=choice;render();if(choice==='prices')void loadEstimatorPricebook();window.scrollTo(0,0);return;
 }
 if(e.target.closest('button[data-estimator-retry]')){
  plumbingUI.error='';void ensurePlumbingCalculator();return;
 }
 if(e.target.closest('button[data-estimator-create-lead]')){
  tab='crm';crmDetailId=null;estimateWorkspaceOpen=false;message('');render();return;
 }
 if(e.target.closest('button[data-estimator-bind]')){
  const leadId=$('#estimatorLeadId')?.value||'';
  if(!data?.leads?.some(x=>x.id===leadId)){message('Сначала выбери лид для сметы.',true);return;}
  try{estimatorSaveVisibleWizard();}catch(error){plumbingShowStepError(error);return;}
  estimateUI={leadId,loaded:false,loading:false,error:'',result:null,editor:null};
  plumbingDraftPanelOpen=false;message('');render();window.scrollTo(0,0);
  await loadLeadEstimate();return;
 }
 const estimatorCard=e.target.closest('button[data-estimator-use-card]');
 if(estimatorCard){
  const code=String(estimatorCard.dataset.estimatorUseCard||'').toUpperCase();
  if(!plumbingUI.module?.listPlumbingItems(estimatorCardCatalog()).some(x=>x.cardKey===code))return;
  if(estimateUI.result?.estimate?.status==='accepted'){
   message('Согласованную смету нельзя редактировать. Выбери другой лид.',true);return;
  }
  plumbingWizard.cards[code]??={quantity:'1'};
  plumbingWizard.step=1;plumbingWizard.preview=null;plumbingWizard.pricedResult=null;
  estimatorSubtab='calculator';render();plumbingScrollToActiveStep();return;
 }
 const estimatorBack=e.target.closest('button[data-estimate-back]');
 if(estimatorBack){
  estimateCaptureForm();
  if(tab==='estimator'){
   estimateUI={leadId:null,loaded:false,loading:false,error:'',result:null,editor:null};
   plumbingWizard=plumbingNewWizard();plumbingDraftPanelOpen=false;
  }
  estimateWorkspaceOpen=false;
  message('');render();
  window.scrollTo(0,0);
  return;
 }
 if(e.target.closest('button[data-pw-next]')){
  try{plumbingCaptureSelection();estimateCaptureForm();plumbingWizard.step=2;render();plumbingScrollToActiveStep();}
  catch(err){plumbingShowStepError(err);}
  return;
 }
 if(e.target.closest('button[data-pw-prev]')){
  if(plumbingWizard.step===2){
   try{plumbingCaptureConfig();}catch(err){message(String(err.message||err),true);return;}
  }
  plumbingWizard.step=1;plumbingWizard.preview=null;estimateCaptureForm();render();plumbingScrollToActiveStep();return;
 }
 if(e.target.closest('button[data-pw-calculate]')){
  try{
   if(!plumbingUI.module)throw Error('Источник расчёта не загружен.');
   if(!estimatorPriceState.loaded)throw Error('Общий прайс ещё не загружен. Открой «Цены» и проверь подключение.');
   plumbingCaptureConfig();
   const w=plumbingWizard;
   const cards=Object.entries(w.cards).map(([cardKey,r])=>({
    cardKey,quantity:r.quantity,...w.config[cardKey]
   }));
   const result=plumbingUI.module.calculatePlumbingEstimateBatch({
    tariff:w.tariff,cards,cardCatalog:estimatorCardCatalog(),pricebook:estimatorPricebookSnapshot(),
    chasing:w.chasing,chasingMeters:w.chasingMeters,
    chasingPrice:w.chasingPrice,extraMaterials:w.extraMaterials,
    extraMaterialsAmount:w.extraMaterialsAmount,extraMaterialsNote:w.extraMaterialsNote,
    includeMaterials:w.includeMaterials,applyFixedReferencePrices:w.useFixedPrices
   });
   estimateCaptureForm();w.preview=result;w.quotePrices={};w.pricedResult=null;w.step=3;render();
   message('');plumbingScrollToActiveStep();
  }catch(err){plumbingShowStepError(err);}
  return;
 }
 if(e.target.closest('button[data-pw-edit]')){
  estimateCaptureForm();plumbingWizard.step=2;plumbingWizard.preview=null;render();plumbingScrollToActiveStep();return;
 }
 if(e.target.closest('button[data-pw-new]')){
  if(!window.confirm('Новый расчёт? Текущий предпросмотр будет очищен. Сохранённая смета не изменится.'))return;
  estimateCaptureForm();plumbingWizard=plumbingNewWizard();render();plumbingScrollToActiveStep();return;
 }
 if(e.target.closest('button[data-pw-reprice]')){
  try{
   estimateCaptureForm();
   plumbingCaptureQuotePrices();
   message('');render();
   $('#pwPriceEditor')?.scrollIntoView({block:'start',behavior:'auto'});
  }catch(err){plumbingPriceError(err);}
  return;
 }
 if(e.target.closest('button[data-pw-add]')){
  try{
   const estimate=estimateUI.result?.estimate,editor=estimateUI.editor;
   if(!estimateWorkspaceOpen||!estimate||estimate.status!=='draft'||!editor)
    throw Error('Доступен только активный черновик.');
   const result=plumbingWizard.step===3?plumbingWizard.preview:null;
   if(!result?.lines?.length)throw Error('Нет подтверждённого результата расчёта.');
   const verified=plumbingCaptureQuotePrices();
   estimateCaptureForm();
   if(editor.lines.length+verified.lines.length>50)throw Error('Лимит 50 строк сметы. Уменьши выбор.');
   editor.lines.push(...verified.lines.map(row=>({
    lineKey:crypto.randomUUID(),kind:row.kind,description:row.description,
    quantity:row.quantity,unit:row.unit,unitPriceAMD:row.unitPriceAMD
   })));
   plumbingWizard=plumbingNewWizard();
   plumbingDraftPanelOpen=true;
   render();
   message('Позиции добавлены в редактор. Проверь суммы и нажми «Сохранить изменения сметы».');
   $('#estimateDraftEditor')?.scrollIntoView({block:'start',behavior:'smooth'});
  }catch(err){plumbingShowStepError(err);}
  return;
 }
 const quoteOpen=e.target.closest('button[data-estimate-open]');
 if(quoteOpen){
  void loadEstimatorPricebook();
  const leadId=quoteOpen.dataset.estimateOpen;
  if(!data?.leads?.some(x=>x.id===leadId)){message('Лид не найден.',true);return;}
  estimateUI={leadId,loaded:false,loading:false,error:'',result:null,editor:null};
  plumbingUI.preview=null;plumbingUI.inputs=null;
  plumbingWizard=plumbingNewWizard();plumbingDraftPanelOpen=false;estimateWorkspaceOpen=true;
  render();window.scrollTo(0,0);await loadLeadEstimate();return;
 }
 if(e.target.closest('button[data-estimate-retry]')){estimateUI.loading=false;await loadLeadEstimate();return;}

 const plumbingPreview=e.target.closest('button[data-plumbing-preview]');
 if(plumbingPreview){
  try{
   if(!plumbingUI.module)throw Error('Расчётчик ещё не загружен.');
   const inputs=plumbingDraftInputs();
   const result=plumbingUI.module.calculatePlumbingEstimate(inputs);
   plumbingUI.inputs=inputs;
   plumbingUI.preview={inputKey:JSON.stringify(inputs),result};
   estimateCaptureForm();render();
  }catch(error){message('Расчёт не выполнен: '+String(error.message||error),true);}
  return;
 }
 const plumbingAdd=e.target.closest('button[data-plumbing-add]');
 if(plumbingAdd){
  try{
   const inputs=plumbingDraftInputs();
   if(!plumbingUI.preview||JSON.stringify(inputs)!==plumbingUI.preview.inputKey)
    throw Error('Параметры изменились. Сначала пересчитай предпросмотр.');
   const ed=estimateUI.editor,est=estimateUI.result?.estimate;
   if(!ed||est?.status!=='draft')throw Error('Доступен только редактируемый черновик.');
   const rows=plumbingUI.preview.result.lines;
   if(ed.lines.length+rows.length>50)throw Error('В смете не может быть больше 50 позиций.');
   estimateCaptureForm();
   ed.lines.push(...rows.map(x=>({lineKey:crypto.randomUUID(),kind:x.kind,
    description:x.description,quantity:x.quantity,unit:x.unit,unitPriceAMD:x.unitPriceAMD})));
   plumbingUI.preview=null;
   render();message('Расчётные позиции добавлены. Проверь цены и сохрани черновик сметы.');
  }catch(error){message('Не удалось добавить позиции: '+String(error.message||error),true);}
  return;
 }
 const addLine=e.target.closest('button[data-estimate-add]');
 if(addLine){
  estimateCaptureForm();
  if(!estimateUI.editor||estimateUI.editor.lines.length>=50)return;
  estimateUI.editor.lines.push({lineKey:crypto.randomUUID(),kind:'WORK',description:'',quantity:'1.000',unit:'шт',unitPriceAMD:''});
  render();return;
 }
 const removeLine=e.target.closest('button[data-estimate-remove]');
 if(removeLine){
  estimateCaptureForm();
  const n=Number(removeLine.dataset.estimateRemove);
  if(!estimateUI.editor||!Number.isInteger(n)||n<0||n>=estimateUI.editor.lines.length)return;
  estimateUI.editor.lines.splice(n,1);render();return;
 }
 if(e.target.closest('button[data-cancel-lead-visit]')){scheduleLeadDraft=null;render();return;}
 const followUp=e.target.closest('button[data-plan-followup]');
 if(followUp){
  const lead=data?.leads?.find(x=>x.id===followUp.dataset.planFollowup);
  if(!lead){message('Обращение не найдено.',true);return;}
  scheduleLeadDraft=crm04FollowupDraft(lead);
  if(!scheduleLeadDraft){message('Дата контакта не указана. Запиши результат осмотра.',true);return;}
  schedule.anchorDate=scheduleLeadDraft.date;schedule.selectedDay=scheduleLeadDraft.date;
  schedule.loaded=false;tab='schedule';message('');render();await loadSchedule(false);return;
 }
 const fromLead=e.target.closest('button[data-plan-lead]');
 if(fromLead){
  const lead=data?.leads?.find(x=>x.id===fromLead.dataset.planLead);
  if(!lead||lead.status==='lost'){message('Обращение недоступно для планирования.',true);return;}
  scheduleCapacityDraft=null; // explicit CRM planning supersedes an unsaved Capacity preview
  resetHourlyManual();scheduleLeadDraft=crmVisitDraft(lead);
  schedule.anchorDate=scheduleLeadDraft.date;schedule.selectedDay=scheduleLeadDraft.date;
  schedule.loaded=false;tab='schedule';message('');
  render();await loadSchedule(false);return;
 }
 const toLead=e.target.closest('button[data-schedule-open-lead]');
 if(toLead){
  const id=toLead.dataset.scheduleOpenLead;
  if(!schedule.items.some(x=>x.lead_id===id||(!x.lead_id&&scheduleVisitLeadId(x.notes)===id))){
   message('Обращение не найдено в загруженном плане.',true);return;
  }
  if(data?.leads?.some(x=>x.id===id)){
   tab='crm';crmDetailId=null;crmReminderEditorLeadId=null;message('');render();
   openCrmLeadDetail(toLead.dataset.scheduleOpenLead);
   if(!crmFollowupState.loaded)void loadCrmFollowups();return;
  }
  tab='catalog';catalog.entity='leads';catalog.q=id;catalog.loaded=false;catalog.items=[];catalog.nextCursor=null;
  message('');render();await loadCatalog(false);return;
 }
 const scheduleWork=e.target.closest('button[data-schedule-work-order]');
 if(tab==='schedule'&&scheduleWork){
  const id=scheduleWork.dataset.scheduleWorkOrder;
  if(!schedule.items.some(x=>x.order_id===id&&x.status==='planned'&&['open','active'].includes(x.order_status))){
   message('Работа по этому заказу сейчас недоступна. Обнови план.',true);return;
  }
  myWork.selectedOrderId=id;myWork.snapshot=null;myWork.loaded=false;
  tab='myWork';message('');render();await loadMyWork();await loadPresence(false);await loadOwnerActivity(false);return;
 }
 const scheduleOrder=e.target.closest('button[data-schedule-open-order]');
 if(tab==='schedule'&&scheduleOrder){
  const id=scheduleOrder.dataset.scheduleOpenOrder;
  if(!schedule.items.some(x=>x.order_id===id)){message('Заказ не найден в загруженном плане.',true);return;}
  if(data.orders.some(x=>x.id===id)){
   tab='orders';orderDetailId=id;objectDetailId=null;message('');render();return;
  }
  tab='catalog';catalog.entity='orders';catalog.q=id;catalog.items=[];catalog.nextCursor=null;catalog.loaded=false;
  message('');render();await loadCatalog(false);return;
 }
 const receiptBtn=e.target.closest('button[data-native-close-receipt]');
 if(receiptBtn){
  const id=receiptBtn.dataset.nativeCloseReceipt;
  if(id!==orderDetailId||!data?.orders?.some(x=>x.id===id&&x.status==='done'))return;
  const seq=++nativeCloseReceiptSeq;
  nativeCloseReceipt={id,busy:true,result:null,error:''};render();
  try{
   nativeCloseView=await (nativeCloseViewPromise??=import('/native-close-view.mjs'));
   const result=await api('/api/orders/close-fact?id='+encodeURIComponent(id));
   if(seq!==nativeCloseReceiptSeq||orderDetailId!==id||!data)return;
   if(!result||result.readonly!==true||result.source!=='CLEAN_NATIVE_MANUAL_FINANCE_ATTESTATION'||result.financeIsSettled!==false)
    throw Error('История закрытия не прошла проверку.');
   nativeCloseReceipt={id,busy:false,result,error:''};
  }catch(e){
   if(seq!==nativeCloseReceiptSeq||orderDetailId!==id||!data)return;
   nativeCloseReceipt={id,busy:false,result:null,error:e.message};
  }
  render();return;
 }
 const closeButton=e.target.closest('button[data-close-preview]');
 if(closeButton){
  const id=closeButton.dataset.closePreview;
  if(!id||id!==orderDetailId||!data?.orders?.some(o=>o.id===id))return;
  const seq=++closePreviewSeq;
  closePreviewState={id,loading:true,result:null,error:''};render();
  try{
   closePreviewModule=await (closePreviewModulePromise??=import('/order-close-preview-view.mjs'));
   nativeCloseView=await (nativeCloseViewPromise??=import('/native-close-view.mjs'));
   const out=await api('/api/orders/close-preview?id='+encodeURIComponent(id));
   if(!out||out.readonly!==true||out.previewOnly!==true||out.canClose!==false||
      out.order?.id!==id||out.source!=='CLEAN_ORDER_WITH_LEGACY_AUTHORITY_GATE')
    throw Error('Результат проверки не прошёл проверку безопасности.');
   if(seq!==closePreviewSeq||orderDetailId!==id||!data)return;
   closePreviewState={id,loading:false,result:out,error:''};
  }catch(err){
   if(seq!==closePreviewSeq||orderDetailId!==id||!data)return;
   closePreviewState={id,loading:false,result:null,error:'Проверка пока недоступна. '+String(err?.message||'')};
  }
  render();return;
 }
 if(tab==='workers'&&e.target.closest('[data-benchmark-proposals-load]')){await loadBenchmarkProposals();return;}
 const workerMetric=e.target.closest('[data-worker-benchmark-load]');
 if(tab==='workers'&&workerMetric){await loadWorkerBenchmarks(workerMetric.dataset.workerBenchmarkLoad);return;}
 if(tab==='engineering'&&efModule&&efFloor&&edModule){
  const put=e.target.closest('[data-ef-commit]');
  const next=e.target.closest('[data-ef-next]');
  if(put||next){
   try{saveCurrentRoomToFloor(Boolean(next));edMessage=next?'Комната добавлена. Теперь черти следующую в свободной зоне плана.':'Комната добавлена или обновлена в плане этажа.';}
   catch(err){edMessage='Не удалось обновить этаж: '+err.message;}
   render();return;
  }
  const edit=e.target.closest('[data-ef-edit]');
  if(edit){
   const room=efFloor.rooms.find(x=>x.roomId===edit.dataset.efEdit);
   if(room){edDraft=edModule.validateDrawing(room);edAnchor=null;drawingRecalculate();edMessage='Открыта сохранённая комната. После правок снова добавь / обнови её в плане.';render();}
   return;
  }
  const remove=e.target.closest('[data-ef-remove]');
  if(remove){
   try{efFloor=efModule.removeFloorRoom(efFloor,remove.dataset.efRemove);
    if(edDraft?.roomId===remove.dataset.efRemove){edDraft=edModule.newDrawing('CLEAN-DRAFT-'+crypto.randomUUID());edAnchor=null;edResult=null;}
    edMessage='Комната удалена из плана.';}
   catch(err){edMessage='Нельзя удалить: '+err.message;}
   render();return;
  }
  if(e.target.closest('[data-ef-export]')){
   try{
    const json=efModule.exportFloor(efFloor),blob=new Blob([json],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='vbos-clean-floor-'+efFloor.floorId+'.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    edMessage='План этажа сохранён в JSON. В него входят только добавленные / обновлённые комнаты.';}
   catch(err){edMessage='Экспорт не выполнен: '+err.message;}
   render();return;
  }
 }
 if(tab==='engineering'&&edModule&&edDraft){
  const canvas=e.target.closest('[data-ed-canvas]');
  if(canvas){
   // Keep edited thermal form values before replacing DOM with a new drawing.
   const params=$('#engineeringDrawingParameters');
   if(params)try{edDraft=edModule.commitDraftForm(edDraft,Object.fromEntries(new FormData(params)));}catch(err){edMessage=err.message;render();return;}
   const p=edModule.pointFromTap(e.clientX,e.clientY,canvas.getBoundingClientRect());
   if(!edAnchor){edAnchor=p;edMessage='Выбери противоположный угол.';}
   else{try{edDraft=edModule.drawRect(edDraft,edAnchor,p);edAnchor=null;drawingRecalculate();edMessage='Контур построен. Проверь роли стен, добавь проёмы и рассчитай.';}
    catch(err){edAnchor=null;edMessage='Ошибка контура: '+err.message;}}
   render();return;
  }
  if(e.target.closest('[data-ed-reset]')){edDraft={...edDraft,corners:null,openings:[],wallRoles:['UNKNOWN','UNKNOWN','UNKNOWN','UNKNOWN']};edAnchor=null;edResult=null;edMessage='Контур очищен; исходные настройки сохранены.';render();return;}
  if(e.target.closest('[data-ed-export]')){
   try{const json=edModule.exportDrawing(edDraft),blob=new Blob([json],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='vbos-clean-engineering-drawing-'+edDraft.projectId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    edMessage='Чертёж выгружен в JSON. Это твоя резервная точка до подключения PostgreSQL.';}
   catch(err){edMessage=err.message;}render();return;
  }
  const removal=e.target.closest('[data-ed-remove]');
  if(removal){const i=Number(removal.dataset.edRemove);if(Number.isInteger(i)&&i>=0&&i<edDraft.openings.length){edDraft={...edDraft,openings:edDraft.openings.filter((_,j)=>j!==i)};drawingRecalculate();render();}return;}
 }
  const portfolioMore=e.target.closest('button[data-client-portfolio-more]');
  if(portfolioMore&&clientDetailId){await loadClientPortfolio(clientDetailId,portfolioMore.dataset.clientPortfolioMore,true);return;}
  const portfolioRetry=e.target.closest('button[data-client-portfolio-retry]');
  if(portfolioRetry&&clientDetailId&&clientPortfolio?.id===clientDetailId){
   const kind=portfolioRetry.dataset.clientPortfolioRetry;
   if(['objects','orders'].includes(kind)){clientPortfolio[kind].error='';await loadClientPortfolio(clientDetailId,kind);}
   return;
  }
  const portfolioOpen=e.target.closest('button[data-client-portfolio-open]');
  if(portfolioOpen&&clientDetailId&&clientPortfolio?.id===clientDetailId){
   const kind=portfolioOpen.dataset.clientPortfolioOpen,id=portfolioOpen.dataset.clientPortfolioId;
   if(!['objects','orders'].includes(kind)||!clientPortfolio[kind].items.some(x=>x.id===id))return;
   clientReturn={tab,clientId:clientDetailId};
   clientDetailId=null;objectDetailId=null;orderDetailId=null;
   tab='catalog';catalog={entity:kind,q:id,status:'',tier:'',referral:'',
    items:[],nextCursor:null,hasMore:false,loaded:false,loading:false};
   await loadCatalog(false);
   if(!catalog.items.some(x=>x.id===id)){message('Запись не найдена. Проверь поиск.',true);return;}
   if(kind==='objects')objectDetailId=id;else orderDetailId=id;
   message('');render();return;
  }
  const convertedOrder=e.target.closest('button[data-crm-open-order]');
  if(convertedOrder){
   const id=convertedOrder.dataset.crmOpenOrder;
   if(!ids('orders',id)){message('Заказ не найден в загруженном списке. Найди его через поиск по ID.',true);return;}
   tab='orders';orderDetailId=id;crmDetailId=null;crmReminderEditorLeadId=null;message('');render();return;
  }
  const crmNewOrder=e.target.closest('button[data-crm-won-order-open]');
 if(crmNewOrder){crmWonOrderOpen(crmNewOrder.dataset.crmWonOrderOpen,crmNewOrder);return;}
 const clientLeadBack=e.target.closest('button[data-crm-client-lead-back]');
 if(clientLeadBack&&crmClientLeadContext){
  const id=crmClientLeadContext.clientId,source=crmClientLeadContext.sourceTab;
  crmClientLeadContext=null;tab=source==='catalog'?'catalog':'clients';
  clientDetailId=id;crmDetailId=null;crmReminderEditorLeadId=null;message('');render();return;
 }
 const clientNewLead=e.target.closest('button[data-client-new-lead]');
 if(clientNewLead){
  const id=clientNewLead.dataset.clientNewLead;
  const chosen=(data?.clients||[]).find(client=>client.id===id)||
   (tab==='catalog'&&catalog.entity==='clients'?catalog.items.find(client=>client.id===id):null);
  if(!chosen||chosen.status==='archived'||(data.archivedLegacyClientIds||[]).includes(id)){
   message('Этот клиент не найден или архивирован. Обнови список.',true);return;
  }
  if(clientDetailId!==id){message('Сначала открой карточку выбранного клиента.',true);return;}
  crmClientLeadContext={clientId:id,sourceTab:tab,
   clientSnapshot:{id:chosen.id,name:chosen.name,phone:chosen.phone,status:chosen.status}};
  tab='crm';crmDetailId=null;crmReminderEditorLeadId=null;
  clientDetailId=null;objectDetailId=null;orderDetailId=null;message('');render();return;
 }
 const linkedClient=e.target.closest('button[data-crm-open-client]');
  if(linkedClient){const id=linkedClient.dataset.crmOpenClient;if(ids('clients',id)){tab='clients';crmDetailId=null;crmReminderEditorLeadId=null;clientDetailId=id;message('');render();}return;}
  const duplicateOpen=e.target.closest('button[data-client-duplicate-open]');
  if(duplicateOpen){
   const chosen=(data?.clients||[]).find(x=>x.id===duplicateOpen.dataset.clientDuplicateOpen);
   if(!chosen){message('Клиент не найден среди загруженных. Обнови список.',true);return;}
   tab='clients';clientDetailId=chosen.id;objectDetailId=null;orderDetailId=null;
   message('');render();return;
  }
  const openClient=e.target.closest('button[data-client-open]');
  if(openClient){
    const id=openClient.dataset.clientOpen;
    const exists=tab==='clients'?ids('clients',id):tab==='catalog'&&catalog.entity==='clients'?catalog.items.find(x=>x.id===id):null;
    if(exists){clientDetailId=id;message('');render();}
    return;
  }
  if(e.target.closest('button[data-client-back]')){clientDetailId=null;clientReturn=null;message('');render();return;}
  const clientLead=e.target.closest('button[data-client-lead-open]');
  if(clientLead&&clientDetailId){
   const id=clientLead.dataset.clientLeadOpen;
   if((data?.leads||[]).some(lead=>lead.id===id)){
    clientDetailId=null;tab='crm';crmDetailId=id;message('');render();
   }
   return;
  }
  const related=e.target.closest('button[data-client-related]');
  if(related){
   const kind=related.dataset.clientRelated,id=related.dataset.clientRelatedId;
   const valid=(kind==='objects'||kind==='orders')&&(data?.[kind]||[]).some(x=>x.id===id);
   if(valid&&clientDetailId){
    clientReturn={tab,clientId:clientDetailId};
    tab=kind;
    objectDetailId=kind==='objects'?id:null;
    orderDetailId=kind==='orders'?id:null;
    message('');render();
   }
   return;
  }
  const estimateOrder=e.target.closest('button[data-estimate-order-open]');
  if(estimateOrder){
   const id=estimateOrder.dataset.estimateOrderOpen;
   if((data?.orders||[]).some(order=>order.id===id)){
    tab='orders';orderDetailId=id;crmDetailId=null;message('');render();
   }else message('Заказ не загружен. Открой поиск по заказам.',true);
   return;
  }
  const workOrderCapacity=e.target.closest('button[data-workorder-capacity]');
  if(workOrderCapacity){
   const id=String(workOrderCapacity.dataset.workorderCapacity||'');
   const from=tab==='orders'?data?.orders:tab==='catalog'&&catalog.entity==='orders'?catalog.items:null;
   const selected=from?.find(x=>x.id===id);
   if(!selected||orderDetailId!==id||!['open','active'].includes(selected.status)){
    message('Заказ недоступен для планирования.',true);return;
   }
   if(scheduleLeadDraft||scheduleCapacityDraft){
    message('Сначала сохрани или отмени предыдущий подготовленный план CRM/Capacity.',true);return;
   }
   const mySeq=++workOrderCapacityOpenSeq,currentTab=tab;
   workOrderCapacity.disabled=true;
   try{
    const raw=await api('/api/orders/capacity-context?id='+encodeURIComponent(id));
    if(mySeq!==workOrderCapacityOpenSeq||tab!==currentTab||orderDetailId!==id||!data)return;
    const verified=capacityExactWorkOrder(raw,id);
    if(!verified)throw Error('Точная связь заказа и объекта не подтверждена.');
    capacityWorkOrderContext=verified;
    capacity.startDate=verified.plannedStartDate||data.today;
    invalidateCapacity();
    schedule.viewMode='week';
    schedule.anchorDate=capacity.startDate;schedule.selectedDay=capacity.startDate;
    tab='schedule';orderDetailId=null;message('');render();
    await loadSchedule(false);
    scheduleRevealSection('#capacityFinder');
   }catch(error){if(mySeq===workOrderCapacityOpenSeq)message('Не удалось открыть Capacity для заказа: '+error.message,true);}
   finally{workOrderCapacity.disabled=false;}
   return;
  }
  const objectClient=e.target.closest('button[data-object-client-open]');
  if(objectClient){
   const id=objectClient.dataset.objectClientOpen;
   objectReturnId=null;
   if(ids('clients',id)){
    tab='clients';clientDetailId=id;objectDetailId=null;clientReturn=null;message('');render();
   }else{
    tab='catalog';clientDetailId=null;objectDetailId=null;clientReturn=null;
    catalog={entity:'clients',q:id,status:'',tier:'',referral:'',items:[],nextCursor:null,hasMore:false,loaded:false,loading:false};
    await loadCatalog(false);
    if(catalog.items.some(item=>item.id===id)){clientDetailId=id;message('');render();}
    else message('Клиент не найден. Проверь поиск.',true);
   }
   return;
  }
  const moreObjectOrders=e.target.closest('button[data-object-orders-more]');
  if(moreObjectOrders&&objectDetailId===moreObjectOrders.dataset.objectOrdersMore&&
     (tab==='objects'||(tab==='catalog'&&catalog.entity==='objects'))){
   await loadObjectCardOrders(objectDetailId,true);return;
  }
  const moreObjectContacts=e.target.closest('button[data-object-contact-more]');
  if(moreObjectContacts&&objectDetailId===moreObjectContacts.dataset.objectContactMore){
   await loadObjectContacts(objectDetailId,true);return;
  }
  const orderContactMore=e.target.closest('button[data-order-contact-more]');
  if(orderContactMore&&orderDetailId===orderContactMore.dataset.orderContactMore){await loadOrderContacts(orderDetailId,true);return;}
  const orderMore=e.target.closest('button[data-order-logs-more]');
  if(orderMore&&orderDetailId===orderMore.dataset.orderLogsMore){await loadOrderCardLogs(orderDetailId,true);return;}
  const orderObject=e.target.closest('button[data-order-open-object]');
  if(orderObject&&orderDetailId){
   const id=orderObject.dataset.orderOpenObject;
   const context=orderLogs.id===orderDetailId?orderLogs.context:null;
   if(context&&context.objectId!==id){message('Связь заказа и объекта не подтверждена.',true);return;}
   orderDetailId=null;
   if(ids('objects',id)){
    tab='objects';objectDetailId=id;message('');render();
   }else{
    tab='catalog';objectDetailId=null;
    catalog={entity:'objects',q:id,status:'',tier:'',referral:'',items:[],nextCursor:null,hasMore:false,loaded:false,loading:false};
    await loadCatalog(false);
    if(catalog.items.some(item=>item.id===id)){objectDetailId=id;message('');render();}
    else message('Объект не найден. Проверь поиск.',true);
   }
   return;
  }
  const openRecord=e.target.closest('button[data-record-open]');
  if(openRecord){
   const kind=openRecord.dataset.recordOpen,id=openRecord.dataset.recordId;
   const source=tab===kind?data?.[kind]:tab==='catalog'&&catalog.entity===kind?catalog.items:
    kind==='orders'&&objectDetailId===objectOrdersCard.id?objectOrdersCard.items:null;
   if((kind==='objects'||kind==='orders')&&source?.some(x=>x.id===id)){
    if(kind==='objects'){objectDetailId=id;orderDetailId=null;objectReturnId=null;}
    else{if(objectDetailId&&objectOrdersCard.id===objectDetailId){objectReturnId=objectDetailId;objectReturnTab=tab;}
     tab='orders';orderDetailId=id;objectDetailId=null;}
    message('');render();
   }
   return;
  }
  if(e.target.closest('button[data-record-back]')){
   if(tab==='orders'&&objectReturnId){tab=objectReturnTab||'objects';objectDetailId=objectReturnId;orderDetailId=null;objectReturnId=null;objectReturnTab=null;message('');render();return;}
   objectDetailId=null;orderDetailId=null;objectReturnId=null;
   if(clientReturn){const previous=clientReturn;clientReturn=null;tab=previous.tab;clientDetailId=previous.clientId;}
   message('');render();return;
  }
 if(e.target.closest('button[data-open-schedule]')){
   tab='schedule';schedule.anchorDate=data.today;schedule.selectedDay=data.today;message('');render();await loadSchedule(false);return;
  }
  const rangeEdit=e.target.closest('button[data-schedule-range-action]');
  if(tab==='schedule'&&rangeEdit){scheduleLegacyOpenRangeEditor(rangeEdit);return;}
  const overlapStep=e.target.closest('button[data-schedule-overlap-step]');
  if(tab==='schedule'&&overlapStep){
   const step=Number(overlapStep.dataset.scheduleOverlapStep);
   const target=scheduleOverlapNext(step,scheduleOverlapCounts());
   if(!target||target<schedule.periodStart||target>schedule.periodEnd)return;
   schedule.selectedDay=target;resetHourlyManual();render();
   document.querySelector('button[data-schedule-day="'+target+'"]')
    ?.scrollIntoView?.({behavior:'smooth',block:'center',inline:'nearest'});
   return;
  }
  const freeStep=e.target.closest('button[data-schedule-free-step]');
  if(tab==='schedule'&&freeStep){
   const step=Number(freeStep.dataset.scheduleFreeStep);
   const target=scheduleFreeNext(step,scheduleOverlapCounts());
   if(!target||target<schedule.periodStart||target>schedule.periodEnd)return;
   schedule.selectedDay=target;resetHourlyManual();render();
   document.querySelector('button[data-schedule-day="'+target+'"]')
    ?.scrollIntoView?.({behavior:'smooth',block:'center',inline:'nearest'});
   return;
  }
  const planFilter=e.target.closest('button[data-schedule-filter]');
  if(tab==='schedule'&&planFilter){
   const chosen=planFilter.dataset.scheduleFilter;
   if(scheduleDayFilters.some(([id])=>id===chosen)){schedule.dayFilter=chosen;render();}
   return;
  }
  if(tab==='schedule'&&e.target.closest('button[data-schedule-retry]')){await loadSchedule(false);return;}
  const move=e.target.closest('button[data-schedule-move]');
  if(move){if(!schedule.loading)await scheduleShiftPeriod(Number(move.dataset.scheduleMove));return;}
  if(e.target.closest('button[data-schedule-today]')){if(!schedule.loading){schedule.anchorDate=data.today;schedule.selectedDay=data.today;await loadSchedule(false);}return;}
  const mode=e.target.closest('button[data-schedule-mode]');
  if(mode){if(!schedule.loading&&['week','month'].includes(mode.dataset.scheduleMode)){
   schedule.viewMode=mode.dataset.scheduleMode;schedule.selectedDay=schedule.anchorDate||data.today;await loadSchedule(false);}return;}
  const day=e.target.closest('button[data-schedule-day]');
  if(day){if(!schedule.loading&&day.dataset.scheduleDay>=schedule.periodStart&&day.dataset.scheduleDay<=schedule.periodEnd){
   schedule.selectedDay=day.dataset.scheduleDay;resetHourlyManual();render();}return;}
  if(e.target.closest('button[data-schedule-more]')){if(!schedule.loading&&schedule.hasMore)await loadSchedule(true);return;}
  if(e.target.closest('button[data-open-my-work]')){
  tab='myWork';message('');render();await loadMyWork();await loadPresence(false);await loadOwnerActivity(false);return;
 }
 if(e.target.closest('button[data-work-reload]')){await loadMyWork();await loadPresence(false);await loadOwnerActivity(false);return;}
 const workHistoryButton=e.target.closest('button[data-work-history]');
 if(workHistoryButton){
  const all=workHistoryButton.dataset.historyRange==='all',date=myWork.snapshot?.today||data.today;
  history.filters={mode:all?'period':'day',day:date,from:all?'0001-01-01':'',to:all?date:'',orderId:workHistoryButton.dataset.orderId||''};
  tab='history';message('');render();await loadHistory(false);return;
 }
 if(e.target.closest('button[data-presence-more]')){await loadPresence(true);return;}
 if(e.target.closest('button[data-owner-more]')){await loadOwnerActivity(true);return;}
 const more=e.target.closest('button[data-history-more]');if(more){await loadHistory(true);return;}
  if(e.target.closest('button[data-catalog-more]')){await loadCatalog(true);return;}
 const b=e.target.closest('button[data-act]');if(!b||busy)return;
 const type=b.dataset.act;
 if(type==='day_open'||type==='day_close'){
  tab='myWork';render();await loadMyWork();
  workFlowModalOpen(type==='day_open'?'start':'finish');return;
 }
 if(type==='work_start_order'&&b.dataset.myWorkQuickStart==='1'){
  const order=myWork.snapshot?.contextOrder;
  if(!order||order.id!==b.dataset.orderId||myWork.snapshot?.day){
   message('Заказ или рабочий день изменился. Обнови экран.',true);return;
  }
  if(!confirm('Открыть рабочий день и начать интервал по заказу «'+order.title+'»? Приход на объект отмечается отдельно.'))return;
 }
 const payload={id:b.dataset.id,orderId:b.dataset.orderId,workerId:b.dataset.workerId,revision:b.dataset.revision,status:b.dataset.status,date:b.dataset.date};
 if(type==='day_close'&&!confirm('Завершить сегодняшний рабочий день?'))return;
  if(type==='schedule_archive'&&!confirm('Поместить этот план в архив? Запись сохранится в базе.'))return;
 await sendAction(type,payload,b);
});
$('#loginForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;
 try{await api('/api/login',{login:e.target.elements.login.value,password:e.target.elements.password.value});e.target.reset();await refresh();message('Новая рабочая база подключена.');}
 catch(err){const el=e.target.querySelector('p');if(el)el.remove();const p=document.createElement('p');p.textContent=err.message;p.className='muted';e.target.append(p);}
 finally{btn.disabled=false;}
});
$('#logout').addEventListener('click',async()=>{try{await api('/api/logout',{});}finally{crmWonOrderClose(true);if(historicalOrdersPanel){historicalOrdersPanel.unmount();historicalOrdersPanel=null;}if(financeAuditPanel){financeAuditPanel.unmount();financeAuditPanel=null;}if(financeCorrectionPanel){financeCorrectionPanel.unmount();financeCorrectionPanel=null;}if(financeReviewPanel){financeReviewPanel.unmount();financeReviewPanel=null;}if(financeReviewAuditPanel){financeReviewAuditPanel.unmount();financeReviewAuditPanel=null;}if(financeWorkerPanel){financeWorkerPanel.unmount();financeWorkerPanel=null;}if(financeArchivePanel){financeArchivePanel.unmount();financeArchivePanel=null;}if(financeHistoryPanel){financeHistoryPanel.unmount();financeHistoryPanel=null;}if(referencePanel){referencePanel.unmount();referencePanel=null;}closePreviewSeq++;closePreviewState={id:null,loading:false,result:null,error:''};nativeCloseReceiptSeq++;nativeCloseReceipt={id:null,busy:false,result:null,error:''};tab='today';crmDetailId=null;crmReminderEditorLeadId=null;crmListScrollY=0;clientDetailId=null;objectDetailId=null;orderDetailId=null;clientReturn=null;crmInteractionState={entityType:'',entityId:'',items:[],hasMore:false,nextCursor:null,loaded:false,loading:false,error:''};crmFollowupState={loaded:false,loading:false,result:null,error:''};todayDashboard={date:'',loaded:false,loading:false,work:null,crm:null,plan:null,errors:{}};data=null;worklogDraftSetOwner('');dailyA1=null;workerBenchmarkCache={};benchmarkProposalState={loaded:false,loading:false,error:'',payload:null};schedule.loaded=false;schedule.items=[];schedule.dayFilter='all';schedule.error='';capacity={startDate:'',durationWorkingDays:3,result:null,loading:false,loaded:false,error:''};capacityWorkOrderContext=null;workOrderCapacityOpenSeq++;scheduleCapacityDraft=null;resetHourlyManual();ownerActivity.loaded=false;ownerActivity.active=null;ownerActivity.items=[];presence.loaded=false;presence.active=null;presence.items=[];myWork.snapshot=null;myWork.loaded=false;myWork.selectedOrderId='';myWork.error='';clearDrawingSession();setMenuOpen(false,{restoreFocus:false});$('#menuToggle').hidden=true;$('#loginPanel').hidden=false;$('#appPanel').hidden=true;$('#logout').hidden=true;}});
$('#setupForm').addEventListener('submit',async e=>{
 e.preventDefault();const f=e.target,btn=f.querySelector('button');if(!f.reportValidity())return;
 if(f.elements.password.value!==f.elements.confirmPassword.value){message('Пароли не совпадают.',true);return;}
 btn.disabled=true;
 try{
  await api('/api/setup',{claimCode:f.elements.claimCode.value,login:f.elements.login.value,password:f.elements.password.value});
  f.reset();
  $('#setupPanel').hidden=true;
  await refresh();
  message('Учётная запись создана. Ты вошёл в новый VBOS.');
 }catch(err){message(err.message,true);}
 finally{btn.disabled=false;}
});
async function boot(){
 try{
  const setup=await api('/api/bootstrap');
  if(setup.setupRequired){
    $('#loginPanel').hidden=true;
    $('#setupPanel').hidden=false;
    $('#appPanel').hidden=true;
    return;
  }
  $('#setupPanel').hidden=true;
  await refresh().catch(()=>{setMenuOpen(false,{restoreFocus:false});$('#menuToggle').hidden=true;$('#loginPanel').hidden=false;$('#appPanel').hidden=true;$('#logout').hidden=true;});
 }catch(err){
  $('#loginPanel').hidden=false;
  message('Не удалось соединиться с сервером: '+err.message,true);
 }
}
let installPrompt;
window.addEventListener('beforeinstallprompt',e=>{
 e.preventDefault();installPrompt=e;$('#installApp').hidden=false;
});
$('#installApp').addEventListener('click',async()=>{
 if(!installPrompt)return;
 installPrompt.prompt();
 try{await installPrompt.userChoice;}finally{installPrompt=null;$('#installApp').hidden=true;}
});
window.addEventListener('appinstalled',()=>{$('#installApp').hidden=true;installPrompt=null;});
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{});}
boot();
