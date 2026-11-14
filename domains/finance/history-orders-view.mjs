/* VBOS Clean Finance: independent, dependency-free historical orders panel.
 * Not wired to shared PWA until authenticated API integration is authorized.
 */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusNames=Object.freeze({completed:'Завершён',archived:'Архив',active:'Активен',planned:'Запланирован',draft:'Черновик'});
const scopes=Object.freeze(['finished','unfinished']);
const fmtMoney=(value,currency)=>{
  if(value==null||value==='')return '';
  const amount=String(value).trim();
  if(!/^-?\d+(?:\.\d{1,6})?$/.test(amount))return '';
  const [whole,fraction='']=amount.split('.');
  const grouped=whole.replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0');
  const significant=fraction.replace(/0+$/,'');
  const label=grouped+(significant?','+significant:'');
  const unit=currency==='AMD'?'драм':(currency||'валюта не указана');
  return 'Ожидаемая прибыль: '+label+' '+unit+' (не фактический доход)';
};
export function historyLocalDate(value){
  if(!value)return '';
  const str=String(value);
  if(/^\d{4}-\d{2}-\d{2}$/.test(str))return str.slice(8,10)+'.'+str.slice(5,7)+'.'+str.slice(0,4);
  const parsed=new Date(str);
  if(!Number.isFinite(parsed.getTime()))return '';
  return new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit'}).format(parsed);
}

const assessmentFields=Object.freeze([
 ['satisfaction','Клиент доволен?',{YES:'Да',NO:'Нет',UNKNOWN:'Не указано'}],
 ['acceptance','Приёмка работы',{NO_REMARKS:'Без замечаний',HAS_REMARKS:'Есть замечания',REJECTED:'Не принята',UNKNOWN:'Не указано'}],
 ['paymentBehavior','Оплата клиента',{ON_TIME:'В срок',LATE:'С задержкой',UNKNOWN:'Не указано'}],
 ['communicationQuality','Общение',{EASY:'Легко',NORMAL:'Обычно',DIFFICULT:'Сложно',UNKNOWN:'Не указано'}],
 ['scopeChanges','Изменения работ',{NONE:'Нет',FEW:'Небольшие',MANY:'Значительные',UNKNOWN:'Не указано'}],
 ['workAgain','Работать снова?',{YES:'Да',NO:'Нет',UNKNOWN:'Не указано'}]
]);
const displayEnum=(code,map)=>map[String(code??'')]||String(code||'Не указано');
export function renderHistoricalAssessment(detail){
 if(!detail||detail.readonly!==true||detail.source!=='VERIFIED_HISTORY_NOT_OPERATIONAL_ORDERS')
  throw Error('INVALID_HISTORICAL_ASSESSMENT');
 const a=detail.assessment,close=detail.close;
 if(!a||!close)return '<p class="historical-assessment-empty">Оценка клиента не зарегистрирована для этого исторического заказа.</p>';
 const rows=assessmentFields.map(([key,label,map])=>
   '<div><dt>'+esc(label)+'</dt><dd>'+esc(displayEnum(a[key],map))+'</dd></div>').join('');
 const rawScore=a.score;
 const hasScore=typeof rawScore==='number'&&Number.isFinite(rawScore)||
  typeof rawScore==='string'&&/^\d+(?:\.\d+)?$/.test(rawScore.trim());
 const score=hasScore?'<p>Сохранённый балл: <strong>'+esc(rawScore)+'</strong>'
  +(a.scoreVersion?' · '+esc(a.scoreVersion):'')+'</p>':'';
 const risk=String(a.riskLabel||'').trim();
 const riskText=risk?'<p>Оценка риска в старой записи: '+esc(risk==='LOW_RISK'?'Низкий риск':risk==='UNKNOWN'?'Не указана':risk)+'</p>':'';
 const finish=historyLocalDate(close.completionDate||close.closedAt);
 const finance=String(close.paymentStatus||'').trim();
 const financeText=finance?'<p>Старый статус расчётов: '+esc(finance==='SETTLED'?'По записи закрыт':finance==='UNKNOWN'?'Не подтверждён':finance)+' (не проверка текущих платежей)</p>':'';
 const note=a.comment?'<p class="historical-assessment-comment">Комментарий: '+esc(a.comment)+'</p>':'';
 return '<section class="historical-assessment" aria-label="Сохранённая оценка взаимодействия с клиентом">'
  +'<h3>Оценка взаимодействия с клиентом</h3>'
  +'<p>Внутренняя запись старого VBOS, не публичный отзыв клиента.</p>'
  +(finish?'<p>Завершено: '+esc(finish)+'</p>':'')
  +'<p>Незавершённые обязательства: '+esc(close.unfinishedObligationsStatus==='NONE'?'Отсутствуют по старой записи':'Требует проверки')+'</p>'
  +financeText+'<dl>'+rows+'</dl>'+score+riskText+note
  +'<small>Историческая оценка · '+esc(a.legacyAssessmentId||'')+'</small></section>';
}

export function renderHistoryOrdersPanel(page,{scope='finished',query='',busy=false,error='',assessmentId='',assessmentDetail=null,assessmentBusy=false,assessmentError=''}={}){
  if(!scopes.includes(scope))throw Error('INVALID_HISTORY_VIEW_SCOPE');
  if(typeof query!=='string'||query.length>80)throw Error('INVALID_HISTORY_VIEW_QUERY');
  if(!page||!Array.isArray(page.items))throw Error('INVALID_HISTORY_PAGE');
  const buttons=[['finished','Завершённые и архивные'],['unfinished','Незавершённые из старого VBOS']]
    .map(([name,label])=>'<button type="button" data-scope="'+name+'" aria-pressed="'+(scope===name)+'"'+(scope===name?' class="selected"':'')+'>'+label+'</button>').join('');
  const cards=page.items.map(item=>{
    const status=statusNames[item.status]||'Требует проверки';
    const date=historyLocalDate(item.completion_date_raw||item.planned_start_raw);
    const money=fmtMoney(item.planned_profit_amount,item.planned_profit_currency);
    const id=esc(item.legacy_order_id||'');
    return '<article class="historical-order" data-legacy-id="'+id+'">'
      +'<div class="historical-order-top"><strong>'+esc(item.title||'Без названия')+'</strong><span>'+esc(status)+'</span></div>'
      +'<p>'+esc(item.client_name||'Клиент не указан')+' · '+esc(item.object_title||'Объект не указан')+'</p>'
      +(date?'<p>Дата: '+esc(date)+'</p>':'')
      +(money?'<p class="historical-estimate">'+esc(money)+'</p>':'')
      +'<small>Историческая запись · '+id+'</small>'
      +(item.has_client_assessment?'<button type="button" class="historical-assessment-toggle" data-history-assessment="'+id+'" aria-expanded="'+(assessmentId===item.legacy_order_id)+'">'+(assessmentId===item.legacy_order_id?'Скрыть оценку':'Оценка клиента')+'</button>':(item.status==='completed'?'<p class="historical-assessment-empty">Оценка не подтверждена источником.</p>':''))
      +(assessmentId===item.legacy_order_id?(assessmentBusy?'<p role="status">Загрузка оценки…</p>':assessmentError?'<p role="alert">'+esc(assessmentError)+'</p>':assessmentDetail?renderHistoricalAssessment(assessmentDetail):''):'')
      +'</article>';
  }).join('');
  return '<section class="historical-orders-panel" aria-label="История заказов">'
    +'<h2>История заказов</h2><p>Только просмотр. Эти записи не меняют текущие заказы и финансы.</p>'
    +'<nav class="historical-order-scopes" aria-label="Раздел истории">'+buttons+'</nav>'
    +'<form data-history-search><label>Поиск по заказу, клиенту или объекту <input name="query" maxlength="80" value="'+esc(query)+'" /></label><button type="submit">Найти</button></form>'
    +(error?'<p role="alert">'+esc(error)+'</p>':'')
    +(busy?'<p role="status">Загрузка истории…</p>':page.items.length?'<div class="historical-order-list">'+cards+'</div>':'<p>Записей по запросу нет.</p>')
    +(page.hasMore&&!busy?'<button type="button" data-history-orders-more>Показать ещё</button>':'')
    +'</section>';
}
/** Requires an already authenticated same-origin fetch function. No session tokens in DOM. */
export function mountHistoryOrdersPanel(root,{fetchPage}={}){
  if(!root||typeof root.innerHTML!=='string'||typeof root.addEventListener!=='function')throw Error('HISTORY_ROOT_REQUIRED');
  if(typeof fetchPage!=='function')throw Error('AUTHENTICATED_FETCH_REQUIRED');
  let scope='finished',query='',items=[],cursor=null,busy=false,requestSeq=0,detailSeq=0,unmounted=false;
  let assessmentId='',assessmentDetail=null,assessmentBusy=false,assessmentError='';
  const resetAssessment=()=>{detailSeq++;assessmentId='';assessmentDetail=null;assessmentBusy=false;assessmentError='';};
  const draw=(error='')=>{if(!unmounted)root.innerHTML=renderHistoryOrdersPanel({items,hasMore:Boolean(cursor)},{scope,query,busy,error,assessmentId,assessmentDetail,assessmentBusy,assessmentError});};
  const load=async(append=false)=>{
    const sequence=++requestSeq;
    if(!append)resetAssessment();
    busy=true;draw();
    try{
      const params=new URLSearchParams({scope,query,limit:'20'});
      if(append&&cursor)params.set('cursor',cursor);
      const result=await fetchPage('/api/history/orders?'+params);
      if(unmounted||sequence!==requestSeq)return;
      if(!result||result.readonly!==true||!Array.isArray(result.items)||result.scope!==scope)throw Error('INVALID_SERVER_HISTORY_PAGE');
      items=append?items.concat(result.items):result.items;
      cursor=result.hasMore?result.nextCursor:null;
      busy=false;draw();
    }catch{
      if(unmounted||sequence!==requestSeq)return;
      busy=false;draw('Не удалось получить историю. Проверь соединение и авторизацию.');
    }
  };
  const scopeClick=event=>{
    const s=event.target?.closest?.('[data-scope]')?.getAttribute('data-scope');
    if(!scopes.includes(s)||scope===s)return;
    scope=s;query='';items=[];cursor=null;resetAssessment();load();
  };
  const moreClick=event=>{if(event.target?.closest?.('[data-history-orders-more]'))load(true);};
  const searchSubmit=event=>{
    if(!event.target?.matches?.('[data-history-search]'))return;
    event.preventDefault();const value=event.target.querySelector('[name="query"]')?.value??'';
    if(value.length>80)return;
    query=value.trim();items=[];cursor=null;resetAssessment();load();
  };
  const assessmentClick=event=>{
    const elem=event.target?.closest?.('[data-history-assessment]');
    const id=elem?.getAttribute?.('data-history-assessment');
    if(typeof id!=='string'||!items.some(x=>x.legacy_order_id===id&&x.has_client_assessment))return;
    if(assessmentId===id){resetAssessment();draw();return;}
    assessmentId=id;assessmentDetail=null;assessmentBusy=true;assessmentError='';
    const sequence=++detailSeq;draw();
    void fetchPage('/api/history/orders/assessment?id='+encodeURIComponent(id)).then(result=>{
      if(unmounted||sequence!==detailSeq)return;
      if(!result||result.readonly!==true||result.source!=='VERIFIED_HISTORY_NOT_OPERATIONAL_ORDERS'||result.legacyOrderId!==id||!result.assessment||!result.close)
        throw Error('INVALID_HISTORICAL_ASSESSMENT_RESPONSE');
      assessmentDetail=result;assessmentBusy=false;draw();
    }).catch(()=>{
      if(unmounted||sequence!==detailSeq)return;
      assessmentBusy=false;assessmentError='Оценка недоступна: исторические сведения требуют проверки.';draw();
    });
  };
  root.addEventListener('click',scopeClick);
  root.addEventListener('click',assessmentClick);
  root.addEventListener('click',moreClick);
  root.addEventListener('submit',searchSubmit);
  draw();load();
  return Object.freeze({refresh:()=>load(),unmount:()=>{unmounted=true;requestSeq++;resetAssessment();root.removeEventListener('click',assessmentClick);root.removeEventListener('click',scopeClick);root.removeEventListener('click',moreClick);root.removeEventListener('submit',searchSubmit);}});
}
