/**
 * Clean Finance/Capital historical OWNER display corrections (nonfinancial).
 * Two editable overlay fields; raw finance operations and audit history immutable.
 */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const group={finance:new Set(['FINANCE_TRANSACTION','BUSINESS_MONTHLY_GAIN']),
 capital:new Set(['CAPITAL_FUND','CAPITAL_ALLOCATION_BATCH','CAPITAL_FUND_TRANSACTION'])};
const states={UNREVIEWED:'Не разобрано',REVIEWED:'Проверено',ARCHIVED:'В архиве'};
function validated(payload,mode){
 if(!group[mode]||payload?.source!=='VERIFIED_FINANCE_OWNER_CORRECTIONS'||
  payload.readonlySource!==true||payload.financialWriter!=='GOOGLE'||payload.moneyAffected!==false||
  payload.total!==42||!Array.isArray(payload.items)||payload.items.length!==42||
  payload.editableFields?.join(',')!=='displayTitle,ownerNote')
  throw Error('Исправления истории не прошли проверку источника');
}
function amount(value){
 if(value===null||value===undefined||value==='')return '';
 const x=Number(value);
 return Number.isFinite(x)?x.toLocaleString('ru-RU',{maximumFractionDigits:2})+' AMD':'—';
}
const key=item=>item.sourceKind+':'+item.sourceId;
export function correctionRowsHtml(payload,{mode='finance',filter='INBOX',editorKey=null,draft=null,error=''}={}){
 validated(payload,mode);
 const all=payload.items.filter(x=>group[mode].has(x.sourceKind));
 const list=all.filter(x=>filter==='ALL'||(filter==='INBOX'?x.reviewState!=='ARCHIVED':
  filter==='ARCHIVED'?x.reviewState==='ARCHIVED':filter==='EDITED'?x.displayTitle!==null||x.ownerNote!==null:false));
 const filterOptions=[['INBOX','Не в архиве'],['EDITED','Исправленные'],['ARCHIVED','В архиве'],['ALL','Все']];
 let html='<h2>Исправить описание истории</h2>'+
  '<p class="muted"><strong>Редактируются только название для отображения и личный комментарий.</strong> '+
  'Оригинальные названия, ID, суммы, валюты, статусы, связи, прибыль и капитал не меняются. '+
  'Исправления можно сбросить; предыдущие версии сохраняются в журнале.</p>'+
  '<p class="small muted">Записей: '+all.length+' · С исправлениями: '+
  all.filter(x=>x.displayTitle!==null||x.ownerNote!==null).length+'</p>'+
  '<label>Показать <select data-correction-filter>'+
  filterOptions.map(([value,label])=>'<option value="'+value+'"'+(filter===value?' selected':'')+'>'+
  label+'</option>').join('')+'</select></label>';
 if(error)html='<p role="alert">'+esc(error)+'</p>'+html;
 if(!list.length)return html+'<p class="muted">Для этого фильтра записей нет.</p>';
 for(const item of list){
  const id=esc(item.sourceId),kind=esc(item.sourceKind),display=esc(item.displayTitle||item.originalTitle||item.sourceId);
  const edited=item.displayTitle!==null||item.ownerNote!==null;
  const active=key(item)===editorKey;
  html+='<article class="record" data-correction-kind="'+kind+'" data-correction-id="'+id+'">'+
   '<strong>'+display+'</strong><p class="small muted">Исходное название: '+
   esc(item.originalTitle||'—')+'</p><p class="small muted">ID: '+id+
   ' · Статус источника: '+esc(item.sourceStatus||'—')+
   ' · Отметка: '+esc(states[item.reviewState]||item.reviewState)+'</p>'+
   (item.amountBase!=null?'<p>Историческая сумма: <b>'+esc(amount(item.amountBase))+'</b> (не редактируется)</p>':'')+
   (item.ownerNote?'<p class="small">'+esc(item.ownerNote)+'</p>':'')+
   (edited?'<p class="small muted">Есть пользовательские исправления</p>':'');
  if(active){
   const ownerTitle=draft?.key===key(item)?draft.title:(item.displayTitle||'');
   const ownerNote=draft?.key===key(item)?draft.note:(item.ownerNote||'');
   html+='<form data-correction-form>'+
    '<label>Новое название (необязательно; максимум 180 символов)'+
    '<input name="displayTitle" maxlength="180" value="'+esc(ownerTitle)+'" placeholder="'+
    esc(item.originalTitle||'Название из исходника')+'"></label>'+
    '<label>Мой комментарий (необязательно; максимум 1000 символов)'+
    '<textarea name="ownerNote" maxlength="1000" rows="3">'+esc(ownerNote)+'</textarea></label>'+
    '<p class="small muted">Пустые поля означают оригинальное название и отсутствие комментария.</p>'+
    '<div class="actions"><button type="submit" data-correction-save>Сохранить исправления</button>'+
    '<button type="button" data-correction-close>Отмена</button>'+
    (edited?'<button type="button" data-correction-clear>Сбросить оба исправления</button>':'')+
    '</div></form>';
  }else{
   html+='<button type="button" data-correction-edit>Исправить описание</button>';
  }
  html+='</article>';
 }
 return html;
}
export function mountFinanceCorrectionsPanel(root,{mode,fetchPage,saveCorrection,confirmClear}={}){
 if(!root||typeof root.addEventListener!=='function'||!group[mode]||
  typeof fetchPage!=='function'||typeof saveCorrection!=='function')
  throw Error('FINANCE_CORRECTIONS_UI_NOT_CONFIGURED');
 let alive=true,sequence=0,loading=false,busy=false,filter='INBOX',
  payload=null,editorKey=null,editorDraft=null,error='',requestKey=null;
 function draw(){
  if(!alive)return;
  if(!payload){
   root.innerHTML=(error?'<p role="alert">'+esc(error)+'</p>':'')+
    '<p class="muted">'+(loading?'Загрузка исправлений…':'Данные исправлений пока недоступны.')+'</p>'+
    '<button type="button" data-correction-refresh'+(loading?' disabled':'')+'>Повторить загрузку</button>';
   return;
  }
  root.innerHTML=(busy?'<p role="status">Сохранение…</p>':'')+
   correctionRowsHtml(payload,{mode,filter,editorKey,draft:editorDraft,error});
  for(const control of root.querySelectorAll?.('button,input,textarea,select')||[])control.disabled=busy;
 }
 async function load(){
  if(!alive||loading)return;
  loading=true;error='';const current=++sequence;draw();
  try{
   const result=await fetchPage('/api/finance/corrections');
   if(!alive||current!==sequence)return;
   validated(result,mode);
   payload=result;
  }catch(err){
   if(alive&&current===sequence){payload=null;error=String(err?.message||'Не удалось загрузить исправления');}
  }finally{if(alive&&current===sequence){loading=false;draw();}}
 }
 function open(item){
  if(!item||busy)return;
  editorKey=key(item);editorDraft=null;requestKey=null;error='';draw();
 }
 async function submit(item,title,note,clear=false){
  if(!alive||busy||!item)return;
  const dTitle=clear?'':title,dNote=clear?'':note;
  if(clear&&typeof confirmClear==='function'&&
   !confirmClear('Сбросить пользовательское название и комментарий? Оригинальные данные останутся неизменными.'))return;
  if(dTitle.length>180||dNote.length>1000){error='Превышена допустимая длина текста';draw();return;}
  if(clear)requestKey=null;
  editorDraft={key:key(item),title:dTitle,note:dNote};
  requestKey??=crypto.randomUUID();
  busy=true;error='';draw();
  try{
   const result=await saveCorrection('/api/finance/correction',{
    sourceKind:item.sourceKind,sourceId:item.sourceId,
    displayTitle:dTitle,ownerNote:dNote,revision:item.revision,requestKey
   });
   if(!alive)return;
   if(result?.saved!==true||result.moneyAffected!==false||
    result.sourcePreserved!==true||result.financialWriter!=='GOOGLE')
    throw Error('Сервер не подтвердил безопасное исправление');
   editorKey=null;editorDraft=null;requestKey=null;
   // Refresh from server; no local shadow of source financial fields.
   await load();
  }catch(err){
   if(alive)error=String(err?.message||'Исправление не сохранено. Проверь соединение и повтори.');
  }finally{if(alive){busy=false;draw();}}
 }
 const onClick=e=>{
  const target=e.target;
  if(target?.closest?.('[data-correction-refresh]')){if(!busy)void load();return;}
  const parent=target?.closest?.('[data-correction-kind]');
  if(!parent||!payload||busy)return;
  const item=payload.items.find(x=>x.sourceKind===parent.dataset.correctionKind&&x.sourceId===parent.dataset.correctionId);
  if(target.closest('[data-correction-edit]')){open(item);return;}
  if(target.closest('[data-correction-close]')){editorKey=null;editorDraft=null;requestKey=null;error='';draw();return;}
  if(target.closest('[data-correction-clear]')){void submit(item,'','',true);}
 };
 const onChange=e=>{
  if(e.target?.matches?.('[data-correction-filter]')){filter=e.target.value;editorKey=null;editorDraft=null;requestKey=null;error='';draw();}
 };
 const onInput=e=>{
  if(!e.target?.matches?.('[name="displayTitle"],[name="ownerNote"]'))return;
  const form=e.target.closest?.('[data-correction-form]');
  const parent=form?.closest?.('[data-correction-kind]');
  if(!parent||!editorKey)return;
  editorDraft={key:editorKey,title:form.querySelector('[name="displayTitle"]')?.value??'',
   note:form.querySelector('[name="ownerNote"]')?.value??''};
  requestKey=null;
 };
 const onSubmit=e=>{
  const form=e.target;
  if(!form?.matches?.('[data-correction-form]'))return;
  e.preventDefault();
  if(!payload||busy)return;
  const parent=form.closest('[data-correction-kind]');
  if(!parent)return;
  const item=payload.items.find(x=>x.sourceKind===parent.dataset.correctionKind&&x.sourceId===parent.dataset.correctionId);
  const title=form.querySelector('[name="displayTitle"]')?.value??'';
  const note=form.querySelector('[name="ownerNote"]')?.value??'';
  void submit(item,title,note);
 };
 root.addEventListener('click',onClick);
 root.addEventListener('change',onChange);
 root.addEventListener('input',onInput);
 root.addEventListener('submit',onSubmit);
 void load();
 return {unmount(){alive=false;sequence++;root.removeEventListener('click',onClick);
  root.removeEventListener('change',onChange);root.removeEventListener('input',onInput);
  root.removeEventListener('submit',onSubmit);}};
}
