/* VBOS Clean Capacity V1F: legacy ConflictGuard v1.10.5 parity.
 * Advisory pre-save check for manual Schedule forms only. The existing
 * schedule_save action remains the sole PostgreSQL writer.
 */
const LEGACY_CONFLICT_WORK_START=480,LEGACY_CONFLICT_WORK_END=1140;
const LEGACY_CONFLICT_STEP=15,LEGACY_CONFLICT_DAYS=14;
const legacyConflictStates=new WeakMap();
const legacyConflictClock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const legacyConflictDay=(key,n)=>new Date(Date.parse(key+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const legacyConflictSunday=key=>new Date(key+'T00:00:00Z').getUTCDay()===0;
const legacyConflictLocal=x=>new Date(new Date(x).getTime()+14400000).toISOString().slice(0,16);
const legacyConflictMinutes=clock=>Number(clock.slice(0,2))*60+Number(clock.slice(3,5));
const legacyConflictEsc=x=>String(x??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);

function legacyConflictRange(form,payload){
 const start=String(payload.startAt||''),end=String(payload.endAt||'');
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end))return null;
 return {startDate:start.slice(0,10),endDate:end.slice(0,10),
  start:legacyConflictMinutes(start.slice(11)),end:legacyConflictMinutes(end.slice(11)),
  scheduleItemId:String(payload.id||''),workOrderId:String(payload.orderId||''),
  status:String(payload.status||form?.dataset?.scheduleStatus||'planned')};
}
function legacyConflictSignature(payload){
 return JSON.stringify(Object.keys(payload).sort().map(k=>[k,String(payload[k]??'')]));
}
function legacyConflictProposed(range){
 const days=[];
 for(let day=range.startDate,count=0;day<=range.endDate&&count<92;day=legacyConflictDay(day,1),count++){
  if(range.workOrderId&&legacyConflictSunday(day))continue;
  const from=day===range.startDate?range.start:0;
  const to=day===range.endDate?range.end:1440;
  if(to>from)days.push({date:day,start:from,end:to});
 }
 return days;
}
function legacyConflictExistingInterval(item,key){
 const from=legacyConflictLocal(item.start_at),to=legacyConflictLocal(item.end_at);
 const startDate=from.slice(0,10),endDate=to.slice(0,10);
 if(item.order_id&&legacyConflictSunday(key))return null;
 if(key<startDate||key>endDate)return null;
 const start=startDate===key?legacyConflictMinutes(from.slice(11)):0;
 const end=endDate===key?legacyConflictMinutes(to.slice(11)):1440;
 return end>start?{start,end}:null;
}
function legacyConflictOverlaps(items,range){
 if(!range||range.status!=='planned')return [];
 const out=[],seen=new Set();
 for(const day of legacyConflictProposed(range)){
  for(const item of items){
   if(String(item.id)===range.scheduleItemId)continue;
   const other=legacyConflictExistingInterval(item,day.date);
   if(!other||Math.max(day.start,other.start)>=Math.min(day.end,other.end))continue;
   const key=String(item.id)+'|'+day.date;
   if(seen.has(key))continue;
   seen.add(key);
   out.push({date:day.date,start:Math.max(day.start,other.start),
    end:Math.min(day.end,other.end),item});
  }
 }
 return out.sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start);
}
function legacyConflictNearest(items,range){
 if(!range||range.startDate!==range.endDate)return null;
 const duration=range.end-range.start;
 if(duration<=0||duration>LEGACY_CONFLICT_WORK_END-LEGACY_CONFLICT_WORK_START)return null;
 for(let d=0;d<=LEGACY_CONFLICT_DAYS;d++){
  const key=legacyConflictDay(range.startDate,d);
  if(legacyConflictSunday(key))continue;
  const busy=items.filter(item=>String(item.id)!==range.scheduleItemId)
   .map(item=>legacyConflictExistingInterval(item,key)).filter(Boolean)
   .map(x=>({start:Math.max(LEGACY_CONFLICT_WORK_START,x.start),
     end:Math.min(LEGACY_CONFLICT_WORK_END,x.end)}))
   .filter(x=>x.end>x.start).sort((a,b)=>a.start-b.start||a.end-b.end);
  const merged=[];
  for(const x of busy){
   const last=merged[merged.length-1];
   if(!last||x.start>last.end)merged.push({...x});
   else last.end=Math.max(last.end,x.end);
  }
  let cursor=d===0?Math.max(LEGACY_CONFLICT_WORK_START,
   Math.ceil(range.start/LEGACY_CONFLICT_STEP)*LEGACY_CONFLICT_STEP):LEGACY_CONFLICT_WORK_START;
  for(const block of merged){
   if(block.end<=cursor)continue;
   if(block.start-cursor>=duration)return {date:key,start:cursor,end:cursor+duration};
   cursor=Math.max(cursor,block.end);
  }
  if(LEGACY_CONFLICT_WORK_END-cursor>=duration)return {date:key,start:cursor,end:cursor+duration};
 }
 return null;
}
function legacyConflictValidSource(result,range){
 const horizon=legacyConflictDay(range.endDate,LEGACY_CONFLICT_DAYS);
 return result?.version==='LEGACY_CONFLICT_GUARD_V1105_SOURCE'&&
  result.complete===true&&result.timezone==='Asia/Yerevan'&&
  result.startDate===range.startDate&&result.endDate===range.endDate&&
  result.horizonDate===horizon&&
  result.source==='mvp_schedule_items+mvp_schedule_order_items+mvp_schedule_lead_items'&&
  Array.isArray(result.items)&&result.items.length<=2000&&
  result.items.every(item=>item.id&&['manual','work_order','crm'].includes(item.source_kind)&&
   item.status==='planned'&&Number.isFinite(new Date(item.start_at).getTime())&&
   Number.isFinite(new Date(item.end_at).getTime())&&
   new Date(item.end_at)>new Date(item.start_at));
}
function legacyConflictPanel(form){
 let panel=form.querySelector('[data-schedule-conflict-alert]');
 if(!panel){
  panel=document.createElement('div');
  panel.className='schedule-conflict-alert';
  panel.setAttribute('data-schedule-conflict-alert','1');
  panel.setAttribute('role','alert');
  const submit=form.querySelector('button[type="submit"]');
  if(submit)form.insertBefore(panel,submit);
  else form.append(panel);
 }
 panel.hidden=false;
 return panel;
}
function legacyConflictClear(form){
 const panel=form?.querySelector?.('[data-schedule-conflict-alert]');
 if(panel){panel.hidden=true;panel.textContent='';}
}
function legacyConflictUnlock(form){
 const button=form?.querySelector?.('button[type="submit"]');
 if(button?.dataset?.scheduleConflictLock==='1'){
  button.disabled=false;
  button.textContent=button.dataset.scheduleConflictLabel||'Сохранить';
  delete button.dataset.scheduleConflictLock;
  delete button.dataset.scheduleConflictLabel;
 }
}
function legacyConflictInvalidate(form){
 const state=legacyConflictStates.get(form);
 if(state){state.seq++;state.approved='';}
 legacyConflictUnlock(form);
 legacyConflictClear(form);
}
function legacyConflictError(form,error){
 const panel=legacyConflictPanel(form);
 panel.innerHTML='<strong>Не удалось проверить пересечения</strong>'+
  '<p class="muted small">'+legacyConflictEsc(error)+
  '. Для безопасности сохранение не продолжаю автоматически. Можно повторить Save.</p>';
 panel.scrollIntoView?.({behavior:'auto',block:'center'});
}
function legacyConflictShow(form,conflicts,slot){
 const panel=legacyConflictPanel(form),many=conflicts.length;
 panel.innerHTML='<strong>⚠ Пересечение по времени · '+many+'</strong>'+
  '<div class="schedule-conflict-list">'+conflicts.slice(0,6).map(c=>
   '<div class="schedule-conflict-item"><b>'+
   legacyConflictEsc(c.item.title||c.item.id||'Запись')+'</b><br>'+
   legacyConflictEsc(c.date)+' · '+legacyConflictClock(c.start)+'–'+
   legacyConflictClock(c.end)+'</div>').join('')+
  (many>6?'<p class="muted small">Ещё конфликтов: '+(many-6)+'</p>':'')+'</div>'+
  '<div class="schedule-conflict-actions">'+
  (slot?'<button type="button" class="compact" data-schedule-conflict-nearest="'+
   legacyConflictEsc(slot.date+'T'+legacyConflictClock(slot.start)+'|'+
   slot.date+'T'+legacyConflictClock(slot.end))+'">Предложить '+
   legacyConflictEsc(slot.date)+' · '+legacyConflictClock(slot.start)+'–'+
   legacyConflictClock(slot.end)+'</button>':'')+
  '<button type="button" class="compact" data-schedule-conflict-override>Сохранить всё равно</button></div>'+
  '<p class="muted small">Проверка предупреждает о пересечении, но не создаёт второй save-path. '+
  '«Сохранить всё равно» передаёт запись в существующий канонический Save.</p>';
 panel.scrollIntoView?.({behavior:'auto',block:'center'});
}
async function legacyConflictBeforeSave(form,payload){
 if(form.dataset.scheduleConflictBypass==='1'){
  delete form.dataset.scheduleConflictBypass;
  legacyConflictClear(form);
  return false;
 }
 const range=legacyConflictRange(form,payload);
 if(!range||range.status!=='planned')return false;
 const daySpan=(Date.parse(range.endDate+'T00:00:00Z')-
  Date.parse(range.startDate+'T00:00:00Z'))/86400000+1;
 if(!Number.isInteger(daySpan)||daySpan<1||daySpan>92){
  legacyConflictError(form,'Период проверки должен быть от 1 до 92 дней');return true;
 }
 let state=legacyConflictStates.get(form);
 if(!state){state={seq:0,approved:''};legacyConflictStates.set(form,state);}
 const mine=++state.seq,signature=legacyConflictSignature(payload);
 state.approved='';
 legacyConflictClear(form);
 const button=form.querySelector('button[type="submit"]');
 if(button&&!button.disabled){
  button.dataset.scheduleConflictLock='1';
  button.dataset.scheduleConflictLabel=button.textContent||'Сохранить';
  button.textContent='Проверяю пересечения…';
  button.disabled=true;
 }
 try{
  const url='/api/schedule/conflicts?'+new URLSearchParams({
   startDate:range.startDate,endDate:range.endDate});
  const response=await api(url);
  if(mine!==state.seq||form.isConnected===false)return true;
  if(signature!==legacyConflictSignature(Object.fromEntries(new FormData(form).entries())))return true;
  if(!legacyConflictValidSource(response,range))throw Error('Источник расписания неполон');
  const conflicts=legacyConflictOverlaps(response.items,range);
  if(!conflicts.length)return false;
  state.approved=signature;
  legacyConflictShow(form,conflicts,legacyConflictNearest(response.items,range));
  return true;
 }catch(error){
  if(mine===state.seq&&form.isConnected!==false)
   legacyConflictError(form,String(error.message||error).slice(0,200));
  return true;
 }finally{
  if(mine===state.seq)legacyConflictUnlock(form);
 }
}
function legacyConflictHandleClick(target){
 const nearest=target.closest('button[data-schedule-conflict-nearest]');
 const override=target.closest('button[data-schedule-conflict-override]');
 if(!nearest&&!override)return false;
 const form=(nearest||override).closest('form[data-act="schedule_save"]');
 if(!form)return true;
 if(nearest){
  const pair=nearest.dataset.scheduleConflictNearest.split('|');
  if(pair.length!==2)return true;
  const a=form.elements?.startAt,b=form.elements?.endAt;
  if(!a||!b)return true;
  a.value=pair[0];b.value=pair[1];
  legacyConflictInvalidate(form); // user must explicitly Save again
  return true;
 }
 const state=legacyConflictStates.get(form);
 const payload=Object.fromEntries(new FormData(form).entries());
 if(!state?.approved||state.approved!==legacyConflictSignature(payload)){
  legacyConflictInvalidate(form);
  return true;
 }
 if(!form.reportValidity())return true;
 form.dataset.scheduleConflictBypass='1';
 const submit=form.querySelector('button[type="submit"]');
 if(typeof form.requestSubmit==='function')form.requestSubmit(submit||undefined);
 else {delete form.dataset.scheduleConflictBypass;legacyConflictError(form,'Отправка формы недоступна');}
 return true;
}
