/* VBOS Clean V13b.0: read-only close preview, no form that writes an order. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderClosePreview(p){
 if(!p||p.readonly!==true||p.previewOnly!==true||p.canClose!==false||
    p.source!=='CLEAN_ORDER_WITH_LEGACY_AUTHORITY_GATE'||
    !p.order||!Array.isArray(p.blockers)||!Array.isArray(p.warnings)||
    p.finance?.status!=='UNVERIFIED_IN_CLEAN')
   throw new Error('V13B_INVALID_CLOSE_PREVIEW');
 const owner=p.order.googleOwned?'Google VBOS':'Clean (создан в новой базе)';
 const counts=p.counts||{};
 const stat=[
  ['Активные задачи',counts.activeTasks],
  ['Открытые рабочие сессии',counts.openSessions],
  ['Назначения сотрудников',counts.activeAssignments],
  ['Будущие ручные планы',counts.futureManualPlans],
  ['Автоматические планы',counts.pendingAutoPlans]
 ].map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v??'—')+'</dd></div>').join('');
 const lines=(xs)=>'<ul>'+xs.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';
 return '<section class="order-close-preview-result" aria-label="Результат предварительной проверки закрытия">'
  +'<p><strong>Закрытие пока недоступно.</strong> Проверка не изменяет заказ.</p>'
  +'<p>Владелец статуса: '+esc(owner)+' · статус: '+esc(p.order.status||'—')+'</p>'
  +'<h4>Что блокирует завершение</h4>'+lines(p.blockers)
  +'<h4>Что потребуется сверить при закрытии</h4>'+lines(p.warnings)
  +'<h4>Состояние работ и расписания</h4><dl>'+stat+'</dl>'
  +'<small>Это снимок состояния на момент проверки, не разрешение на запись. Финансовые остатки не проверены.</small>'
  +'</section>';
}
