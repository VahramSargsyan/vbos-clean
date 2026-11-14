const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields=[
 ['satisfaction','Клиент доволен?',[['YES','Да'],['PARTIAL','Частично'],['NO','Нет'],['UNKNOWN','Неизвестно']]],
 ['acceptance','Приёмка',[['NO_REMARKS','Без замечаний'],['MINOR_REMARKS','Есть замечания'],['NOT_ACCEPTED_REWORK','Переделка'],['UNKNOWN','Неизвестно']]],
 ['paymentBehavior','Оплата',[['ON_TIME','В срок'],['DELAYED','Позже срока'],['PROBLEM','Проблема'],['UNKNOWN','Неизвестно']]],
 ['communicationQuality','Общение',[['EASY','Легко'],['NORMAL','Нормально'],['DIFFICULT','Сложно'],['CONFLICT','Конфликт'],['UNKNOWN','Неизвестно']]],
 ['scopeChanges','Изменения работ',[['NONE','Нет'],['FEW','Немного'],['MANY','Много'],['UNKNOWN','Неизвестно']]],
 ['workAgain','Работать снова?',[['YES','Да'],['YES_WITH_CONDITIONS','С условиями'],['NO','Нет'],['UNKNOWN','Неизвестно']]]
];
export function renderNativeCloseForm(order,today){
 if(!order||!['open','active'].includes(order.status))throw Error('NATIVE_CLOSE_FORM_INVALID');
 const selectors=fields.map(([id,label,options])=>'<label>'+esc(label)+'<select name="a_'+id+'" required><option value="">Выбери</option>'+options.map(([v,t])=>'<option value="'+v+'">'+esc(t)+'</option>').join('')+'</select></label>').join('');
 return '<details class="native-close-form-panel"><summary>Закрыть новый заказ Clean</summary>'
  +'<p>Закрытие требует ручной проверки расчётов. Clean не подтверждает полную оплату.</p>'
  +'<form data-act="close_work_order" class="grid">'
  +'<input name="orderId" type="hidden" value="'+esc(order.id)+'"><input name="revision" type="hidden" value="'+esc(order.revision)+'">'
  +'<label>Дата завершения<input type="date" name="completionDate" required value="'+esc(today)+'"></label>'
  +'<label>Источник ручной финансовой проверки<textarea name="financeReference" required minlength="8" maxlength="500"></textarea></label>'
  +'<label><input type="checkbox" name="financeChecked" value="yes" required> Я проверил расчёты вне Clean</label>'
  +'<label><input type="checkbox" name="unfinishedObligationsStatus" value="NONE" required> Незавершённых обязательств нет</label>'
  +'<h3>Оценка взаимодействия с клиентом</h3>'+selectors
  +'<label>Комментарий<textarea name="assessmentComment" maxlength="5000"></textarea></label>'
  +'<label>Примечание к закрытию<textarea name="closeNote" maxlength="5000"></textarea></label>'
  +'<button type="submit" class="primary wide">Подтвердить закрытие</button></form></details>';
}
export function renderNativeCloseReceipt(data){
 if(!data||data.readonly!==true||data.source!=='CLEAN_NATIVE_MANUAL_FINANCE_ATTESTATION'||data.financeIsSettled!==false||!data.fact)throw Error('INVALID_NATIVE_CLOSE_RECEIPT');
 const f=data.fact;
 const fmt=x=>{const d=new Date(x);return Number.isFinite(d.getTime())?d.toLocaleString('ru-RU',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'Дата не подтверждена';};
 return '<section class="native-close-receipt"><h3>Сохранённое закрытие</h3>'
 +'<p>Дата: '+esc(f.completionDate)+'</p>'
 +'<p>Проверил: '+esc(f.closedByLogin)+'</p>'
 +'<p>Финансовая проверка: '+esc(fmt(f.financeCheckedAt))+'</p>'
 +'<p>Закрыто: '+esc(fmt(f.closedAt))+'</p>'
 +'<p>Источник финансовой проверки: '+esc(f.financeReference)+'</p>'
 +'<p><strong>Статус оплаты не подтверждён в Clean.</strong></p>'
 +'<p>Снято назначений: '+esc(f.removedWorkerAssignments)+'</p></section>';
}
