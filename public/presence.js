'use strict';
/* V7: object presence is not a work interval, WorkLog or owner business-time. */
function presenceTime(iso){
 if(!iso)return '';
 try{return new Date(iso).toLocaleTimeString('en-GB',{timeZone:'Asia/Yerevan',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}
 catch{return '';}
}
function currentYerevanTime(){
 return new Date().toLocaleTimeString('en-GB',{timeZone:'Asia/Yerevan',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
}
function presencePane(historyOnly=false){
 const p=presence,day=p.day,now=data.today,isToday=(p.date||now)===now,active=p.active;
 let s='';
 if(!historyOnly){
  s+='<section class="card presence-card"><h2>📍 Посещения объектов</h2>'+
  '<p class="muted small">Приход и уход с конкретного объекта — отдельный учёт. Рабочий день, интервалы работы и WorkLog не изменяются автоматически.</p>';
 if(!p.loaded){return s+'<p class="muted">Загружаю посещения из PostgreSQL.</p></section>';}
 if(active){
  s+='<div class="presence-active"><p><strong>Сейчас на объекте:</strong> '+esc(active.object_name)+'</p>'+
   (active.object_address?'<p class="muted small">'+esc(active.object_address)+'</p>':'')+
   (active.client_name?'<p class="muted small">Клиент: '+esc(active.client_name)+'</p>':'')+
   (active.order_title?'<p class="muted small">Заказ: '+esc(active.order_title)+'</p>':'')+
   '<p class="muted">Приход: '+esc(active.day_date)+' · '+esc(presenceTime(active.arrived_at))+'</p></div>';
  s+='<form data-act="presence_stop" class="grid">'+
   '<input type="hidden" name="id" value="'+esc(active.id)+'">'+
   '<input type="hidden" name="date" value="'+esc(active.day_date)+'">'+
   '<input type="hidden" name="revision" value="'+esc(active.revision)+'">'+
   editText('departureTime','Время ухода с объекта',currentYerevanTime(),'time','required')+
   editText('notes','Примечание',active.notes||'','textarea','maxlength="2000"')+
   '<button class="primary wide" type="submit">Отметить уход</button></form>';
 }else if(isToday&&day?.status==='open'&&data.objects.length){
  const orderChoices='<option value="">Без заказа</option>'+data.orders.filter(o=>!['done','cancelled'].includes(o.status)).map(o=>'<option value="'+esc(o.id)+'">'+esc(o.title)+' · '+esc(data.objects.find(x=>x.id===o.object_id)?.name||'Объект')+'</option>').join('');
  s+=form('presence_start','+ Я на объекте',
    '<input type="hidden" name="date" value="'+esc(now)+'">'+
    select('objectId','Объект',option(data.objects,o=>o.name,'Выбери объект'))+
    select('orderId','Заказ (необязательно)',orderChoices,false)+
    editText('arrivalTime','Приход',currentYerevanTime(),'time','required')+
    editText('notes','Примечание','','textarea','maxlength="2000"'));
 }else if(isToday){
  s+='<p class="muted">Сначала открой рабочий день'+(!data.objects.length?' и создай объект в CRM':'')+'. После этого можно отметить приход на объект.</p>';
 }
 s+='</section>';
 }else if(!p.loaded){
  return '<section class="card"><p class="muted">Загружаю историю посещений…</p></section>';
 }
 s+='<section class="card"><h2>История по объектам</h2><form id="presenceFilters" class="grid">'+
  editText('date','Дата посещений',p.date||now,'date','required')+
  '<button type="submit" class="wide-button">Показать дату</button></form>';
 if(!p.items.length)s+='<p class="muted">За выбранную дату посещений нет.</p>';
 else s+=p.items.map(x=>{
  const fields='<input type="hidden" name="id" value="'+esc(x.id)+'">'+
   '<input type="hidden" name="date" value="'+esc(x.day_date)+'">'+
   '<input type="hidden" name="revision" value="'+esc(x.revision)+'">'+
   editText('arrivalTime','Приход на объект',presenceTime(x.arrived_at),'time','required')+
   (x.status==='closed'?editText('departureTime','Уход с объекта',presenceTime(x.departed_at),'time','required'):'')+
   editText('notes','Примечание',x.notes||'','textarea','maxlength="2000"');
  const panel='<details class="edit-panel"><summary>Исправить время</summary>'+
   '<form data-act="presence_update" class="grid">'+fields+
   '<button type="submit" class="primary wide">Сохранить исправление</button></form></details>';
  return record(x.object_name,(x.order_title?x.order_title+' · ':'')+
    x.day_date+' · '+presenceTime(x.arrived_at)+' — '+(x.departed_at?presenceTime(x.departed_at):'на объекте'),
    (x.object_address?'<p class="muted small">'+esc(x.object_address)+'</p>':'')+
    (x.notes?'<p class="muted small">'+esc(x.notes)+'</p>':'')+panel);
 }).join('');
 if(p.hasMore)s+='<button type="button" class="wide-button" data-presence-more>Показать ещё 25</button>';
 s+='</section>';
 return s;
}
async function loadPresence(append=false,date){
 if(presence.loading)return;
 presence.loading=true;
 try{
  const selected=date||presence.date||data.today;
  const args=new URLSearchParams({date:selected});
  if(append&&presence.nextCursor)args.set('cursor',presence.nextCursor);
  const resp=await api('/api/presence?'+args.toString());
  presence.date=resp.date;presence.day=resp.day;presence.active=resp.active;
  presence.items=append?presence.items.concat(resp.items):resp.items;
  presence.hasMore=resp.hasMore;presence.nextCursor=resp.nextCursor;presence.loaded=true;
  if(tab==='myWork')render();
 }catch(err){message(err.message,true);}
 finally{presence.loading=false;}
}
