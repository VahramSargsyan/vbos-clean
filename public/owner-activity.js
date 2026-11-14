'use strict';
/* V8 OwnerActivity: business time is not physical presence, A1 or performed work. */
const ownerClassTitle={ORGANIZATION:'Организация',BUSINESS_SYSTEM:'Компания / система'};
function ownerLocalTime(iso){
 if(!iso)return '';
 try{return new Date(new Date(iso).getTime()+4*3600000).toISOString().slice(0,16);}catch{return '';}
}
function ownerNow(){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
 return parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute;
}
function ownerRelationOptions(){
 let s='<option value="">Без привязки</option>';
 for(const [type,items,getLabel] of [
  ['Lead',data.leads,x=>x.title],
  ['Client',data.clients,x=>x.name],
  ['Object',data.objects,x=>x.name],
  ['WorkOrder',data.orders,x=>x.title]
 ]){
  for(const item of items)s+='<option value="'+esc(type+'|'+item.id)+'">'+esc(ownerClassTitle[type]||({Lead:'Лид',Client:'Клиент',Object:'Объект',WorkOrder:'Заказ'})[type])+': '+esc(getLabel(item))+'</option>';
 }
 return s;
}
function ownerActivityPane(){
 const a=ownerActivity;
 let s='<section class="card owner-activity-card"><h2>⏱ Бизнес-время владельца</h2>'+
  '<p class="muted small">Организация или развитие компании. Этот таймер не отмечает присутствие на объекте и не добавляет выполненные работы.</p>';
 if(!a.loaded)return s+'<p class="muted">Загружаю бизнес-время из PostgreSQL.</p></section>';
 s+='<div class="summary"><div class="card"><span>Организация · завершено</span><strong>'+fmt(a.totals?.ORGANIZATION||0)+' мин</strong></div>'+
    '<div class="card"><span>Компания / система · завершено</span><strong>'+fmt(a.totals?.BUSINESS_SYSTEM||0)+' мин</strong></div></div>'+
    '<p class="muted small">Сумма записанных минут за '+esc(a.date)+'. Пересечения с WorkLog или присутствием здесь не вычитаются.</p>';
 if(a.active){
  const x=a.active;
  s+='<div class="presence-active"><strong>Сейчас: '+esc(ownerClassTitle[x.activity_class]||x.activity_class)+'</strong>'+
   (x.summary?'<p>'+esc(x.summary)+'</p>':'')+
   '<p class="muted">Начало: '+esc(ownerLocalTime(x.start_at).replace('T',' '))+'</p>'+
   '<p class="muted small">Можно завершить после полуночи: сервер разделит время по календарным датам Еревана.</p></div>';
  s+='<form data-act="owner_activity_stop" class="grid">'+
   '<input type="hidden" name="id" value="'+esc(x.id)+'"><input type="hidden" name="revision" value="'+esc(x.revision)+'">'+
   editText('endTime','Время окончания',ownerNow(),'datetime-local','required')+
   editText('summary','Чем занимался',x.summary||'','text','maxlength="1000"')+
   editText('notes','Примечание',x.notes||'','textarea','maxlength="5000"')+
   '<button type="submit" class="primary wide">Стоп · сохранить бизнес-время</button></form>';
 }else{
  s+='<details class="edit-panel"><summary>+ Начать бизнес-время</summary><form data-act="owner_activity_start" class="grid">'+
   '<label>Тип<select name="activityClass" required><option value="ORGANIZATION">Организация</option><option value="BUSINESS_SYSTEM">Компания / система</option></select></label>'+
   editText('startTime','Начало',ownerNow(),'datetime-local','required')+
   editText('summary','Чем занимаюсь','','text','maxlength="1000"')+
   '<label>Связь с CRM / объектом / заказом (необязательно)<select name="relation">'+ownerRelationOptions()+'</select></label>'+
   editText('notes','Примечание','','textarea','maxlength="5000"')+
   '<button type="submit" class="primary wide">Начать отсчёт</button></form></details>';
 }
 s+='</section><section class="card"><h2>История бизнес-времени</h2>'+
  '<form id="ownerActivityFilters" class="grid">'+editText('date','Дата',a.date||data.today,'date','required')+
  '<button type="submit" class="wide-button">Показать дату</button></form>';
 if(!a.items.length)s+='<p class="muted">За эту дату записей нет.</p>';
 else{
  s+=a.items.filter(x=>x.status==='completed').map(x=>{
   let form='<details class="edit-panel"><summary>Исправить запись</summary><form data-act="owner_activity_update" class="grid">'+
    '<input type="hidden" name="id" value="'+esc(x.id)+'"><input type="hidden" name="revision" value="'+esc(x.revision)+'">'+
    '<label>Тип<select name="activityClass" required>'+
    ['ORGANIZATION','BUSINESS_SYSTEM'].map(t=>'<option value="'+t+'" '+(t===x.activity_class?'selected':'')+'>'+esc(ownerClassTitle[t])+'</option>').join('')+'</select></label>'+
    editText('startTime','Начало',ownerLocalTime(x.start_at),'datetime-local','required')+
    editText('endTime','Окончание',ownerLocalTime(x.end_at),'datetime-local','required')+
    editText('summary','Что делал',x.summary||'','text','maxlength="1000"')+
    editText('notes','Примечание',x.notes||'','textarea','maxlength="5000"')+
    '<button type="submit" class="primary wide">Сохранить исправление</button></form></details>'+
    '<button type="button" class="compact" data-act="owner_activity_archive" data-id="'+esc(x.id)+'" data-revision="'+esc(x.revision)+'">В архив</button>';
   return record(ownerClassTitle[x.activity_class]||x.activity_class,
     ownerLocalTime(x.start_at).replace('T',' ')+' — '+ownerLocalTime(x.end_at).replace('T',' ')+' · '+fmt(x.duration_minutes)+' мин',
     (x.summary?'<p>'+esc(x.summary)+'</p>':'')+
     (x.notes?'<p class="muted small">'+esc(x.notes)+'</p>':'')+form);
  }).join('');
  if(a.active && a.items.some(x=>x.id===a.active.id))s+='<p class="muted small">Активная запись показана выше.</p>';
 }
 if(a.hasMore)s+='<button type="button" class="wide-button" data-owner-more>Показать ещё 25</button>';
 s+='<p class="muted small">История до начала учёта ('+esc(a.trackingSince||'ещё нет записей')+') не означает нулевую занятость.</p></section>';
 return s;
}
async function loadOwnerActivity(append=false,date){
 if(ownerActivity.loading)return;
 ownerActivity.loading=true;
 try{
  const params=new URLSearchParams({date:date||ownerActivity.date||data.today});
  if(append&&ownerActivity.nextCursor)params.set('cursor',ownerActivity.nextCursor);
  const response=await api('/api/owner-activity?'+params.toString());
  ownerActivity.date=response.date;ownerActivity.active=response.active;
  ownerActivity.items=append?ownerActivity.items.concat(response.items):response.items;
  ownerActivity.hasMore=response.hasMore;ownerActivity.nextCursor=response.nextCursor;
  ownerActivity.totals=response.totals;ownerActivity.trackingSince=response.trackingSince;
  ownerActivity.loaded=true;
  if(tab==='myWork')render();
 }catch(e){message(e.message,true);}
 finally{ownerActivity.loading=false;}
}
