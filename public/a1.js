'use strict';
/* Daily A1 V6 — one goal per Yerevan calendar date, separate from WorkDay. */
const a1OutcomeLabels={COMPLETED:'Выполнено',PARTIAL:'Частично',NOT_COMPLETED:'Не выполнено'};
function a1Card(){
 const entry=dailyA1?.item||null;
 const date=dailyA1?.date||data?.today||'';
 let s='<section class="card a1-card"><h2>🎯 A1 — главная цель дня</h2>'+
  '<p class="muted small">Одна главная цель на '+esc(date)+'. A1 не открывает рабочий день и не записывает работу.</p>';
 if(!dailyA1){
  return s+'<p class="muted">A1 загружается из PostgreSQL.</p></section>';
 }
 if(entry){
  s+='<div class="a1-summary"><strong>'+esc(entry.goal)+'</strong><p class="muted">Почему: '+esc(entry.reason)+'</p>'+
   '<span class="tag">'+(entry.status==='completed'?'Завершена':'В работе')+'</span>';
  if(entry.status==='completed'){
   s+='<p>Итог: <b>'+esc(a1OutcomeLabels[entry.outcome]||entry.outcome)+'</b></p>'+
     (entry.outcome_note?'<p class="muted small">'+esc(entry.outcome_note)+'</p>':'');
  }
  if(entry.notes)s+='<p class="muted small">Заметки: '+esc(entry.notes)+'</p>';
  s+='</div>';
 }else{
  s+='<p class="muted">A1 на сегодня ещё не задан.</p>';
 }
 const version=entry?entry.revision:0;
 s+='<details class="edit-panel"><summary>'+(entry?'Изменить A1':'+ Задать A1')+'</summary>'+
  '<form data-act="a1_save" class="grid">'+
  '<input type="hidden" name="id" value="'+esc(entry?.id||'')+'">'+
  '<input type="hidden" name="date" value="'+esc(date)+'">'+
  '<input type="hidden" name="revision" value="'+esc(version)+'">'+
  editText('goal','A1 сегодня',entry?.goal||'','textarea','required maxlength="1000"')+
  editText('reason','Почему именно это A1',entry?.reason||'','textarea','required maxlength="2000"')+
  editText('notes','Заметки',entry?.notes||'','textarea','maxlength="5000"')+
  '<button class="primary wide" type="submit">Сохранить A1</button></form></details>';
 if(entry?.status==='open'){
  s+='<details class="edit-panel"><summary>Завершить A1</summary><form data-act="a1_complete" class="grid">'+
    '<input type="hidden" name="id" value="'+esc(entry.id)+'">'+
    '<input type="hidden" name="date" value="'+esc(date)+'">'+
    '<input type="hidden" name="revision" value="'+esc(version)+'">'+
    '<label>Результат<select name="outcome" required>'+
    '<option value="COMPLETED">Выполнено</option><option value="PARTIAL">Частично</option>'+
    '<option value="NOT_COMPLETED">Не выполнено</option></select></label>'+
    editText('outcomeNote','Комментарий к итогу','','textarea','maxlength="3000"')+
    '<button class="primary wide" type="submit">Сохранить итог A1</button></form></details>';
 }else if(entry?.status==='completed'){
  s+='<button type="button" class="wide-button" data-act="a1_reopen" data-id="'+esc(entry.id)+
   '" data-date="'+esc(date)+'" data-revision="'+esc(version)+'">Вернуть A1 в работу</button>';
 }
 return s+'</section>';
}
