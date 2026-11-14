/* VBOS Clean V13b.0: owner-only WorkOrder CLOSE PREVIEW.
 * Diagnostic snapshot only. Google owns imported WorkOrders.
 * No source writes, new tables, finance claims, or "canClose=true" response.
 */
const goodUuid=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
const denied=(AppError,status,message)=>{throw new AppError(status,message);};

export async function orderClosePreview(pool,url,{authorizeOwner,AppError}={}){
 if(typeof AppError!=='function')throw new Error('V13B_APPERROR_REQUIRED');
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
   denied(AppError,401,'Войди в приложение.');
 if(!pool||typeof pool.query!=='function')denied(AppError,500,'База заказов недоступна.');
 if(!(url instanceof URL))denied(AppError,400,'Неверный запрос предварительной проверки.');
 const id=url.searchParams.get('id')||'';
 if(!goodUuid(id))denied(AppError,400,'Неверный идентификатор заказа.');
 // One PostgreSQL statement. No customer phone, notes, worker names, financial amounts or raw source payload.
 // Point-in-time snapshot: MUST NEVER authorize a later write by itself.
 const sql=[
  'SELECT o.id::text AS id,o.title,o.status,o.revision,',
  "EXISTS(SELECT 1 FROM public.mvp_legacy_import_map m WHERE m.target_id=o.id AND m.source_entity='WorkOrders' AND m.source_system='Working IP APP / M8C cutover baseline') AS google_owned,",
  "(SELECT count(*)::int FROM public.mvp_worker_tasks t WHERE t.order_id=o.id AND t.status='active') AS active_tasks,",
  '(SELECT count(*)::int FROM public.mvp_sessions s WHERE s.order_id=o.id AND s.ended_at IS NULL) AS open_sessions,',
  "(SELECT count(*)::int FROM public.mvp_worker_order_assignments a WHERE a.order_id=o.id AND a.status='active') AS active_assignments,",
  "(SELECT count(*)::int FROM public.mvp_schedule_items m WHERE m.order_id=o.id AND m.status='planned' AND m.schedule_date >= (now() AT TIME ZONE 'Asia/Yerevan')::date) AS future_manual_plans,",
  "(SELECT count(*)::int FROM public.mvp_schedule_order_items p WHERE p.order_id=o.id AND p.status='planned') AS pending_auto_plans,",
  'statement_timestamp() AS checked_at FROM public.mvp_orders o WHERE o.id=$1::uuid LIMIT 1'
 ].join(' ');
 const r=await pool.query(sql,[id]),o=r.rows?.[0];
 if(!o)denied(AppError,404,'Заказ не найден.');
 const int=x=>{const n=Number(x);if(!Number.isSafeInteger(n)||n<0)throw new Error('V13B_BAD_COUNT');return n;};
 const googleOwned=o.google_owned===true;
 const counts=Object.freeze({
   activeTasks:int(o.active_tasks),openSessions:int(o.open_sessions),
   activeAssignments:int(o.active_assignments),
   futureManualPlans:int(o.future_manual_plans),
   pendingAutoPlans:int(o.pending_auto_plans)
 });
 const blockers=[];
 if(googleOwned)blockers.push('Источник статуса — старый Google VBOS. Закрытие этого заказа в Clean запрещено.');
 if(o.status==='done'||o.status==='cancelled')
   blockers.push('Заказ уже помечен как завершённый или отменённый; повторно закрыть его нельзя.');
 if(counts.activeTasks>0)blockers.push('Есть активные задания работников: '+counts.activeTasks+'.');
 if(counts.openSessions>0)blockers.push('Есть незавершённые рабочие сессии: '+counts.openSessions+'.');
 // Finance/ClientAssessment writer has NOT been migrated. Do not advertise eligibility.
 blockers.push('Полная транзакция закрытия, проверка финансов и сохранение оценки клиента ещё не подключены.');
 const warnings=[];
 if(counts.activeAssignments>0)warnings.push('При закрытии потребуется снять назначения работников: '+counts.activeAssignments+'.');
 if(counts.futureManualPlans>0)warnings.push('Будущие ручные планы необходимо сверить: '+counts.futureManualPlans+'.');
 if(counts.pendingAutoPlans>0)warnings.push('Автоматическое расписание требует обновления при закрытии.');
 warnings.push('Остаток расчётов с клиентом не подтверждён: финансовые данные заказа недоступны для проверки в Clean.');
 return Object.freeze({
  readonly:true,previewOnly:true,canClose:false,
  source:'CLEAN_ORDER_WITH_LEGACY_AUTHORITY_GATE',
  order:{id:o.id,title:o.title,status:o.status,revision:o.revision,googleOwned},
  counts,blockers,warnings,
  finance:{status:'UNVERIFIED_IN_CLEAN'},
  checkedAt:o.checked_at,
  note:'Предварительная проверка не закрывает заказ и не является разрешением на закрытие.'
 });
}
