/* VBOS Clean Capacity V1F: exact legacy ConflictGuard v1.10.5 source facts.
 * Authenticated, read-only, overlap-complete PostgreSQL ScheduleItems.
 * Does not create a new writer, change save rules or calculate staffing.
 */
const SOURCE='mvp_schedule_items+mvp_schedule_order_items+mvp_schedule_lead_items';
const MAX_ITEMS=2000,MAX_PROPOSED_DAYS=92,SEARCH_DAYS=14;
const moveDay=(key,days)=>new Date(Date.parse(key+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const SQL=[
 "SELECT id,source_kind,status,start_at,end_at,title,order_id FROM (",
 "SELECT id,source_kind,status,start_at,end_at,title,order_id FROM public.mvp_schedule_items",
 "UNION ALL SELECT id,source_kind,status,start_at,end_at,title,order_id FROM public.mvp_schedule_order_items",
 "UNION ALL SELECT id,source_kind,status,start_at,end_at,title,order_id FROM public.mvp_schedule_lead_items",
 ") AS scheduled WHERE status='planned'",
 "AND start_at < (($2::date+INTERVAL '1 day') AT TIME ZONE 'Asia/Yerevan')",
 "AND end_at > ($1::date AT TIME ZONE 'Asia/Yerevan')",
 "ORDER BY start_at,id LIMIT 2001"
].join(' ');
export async function scheduleConflictSourceRead(pool,url,{safeDate,AppError}){
 const startDate=safeDate(url.searchParams.get('startDate')||'');
 const endDate=safeDate(url.searchParams.get('endDate')||'');
 const days=(Date.parse(endDate+'T00:00:00Z')-Date.parse(startDate+'T00:00:00Z'))/86400000+1;
 if(!Number.isInteger(days)||days<1||days>MAX_PROPOSED_DAYS)
   throw new AppError(400,'Период проверки плана должен быть от 1 до 92 дней.');
 const horizonDate=moveDay(endDate,SEARCH_DAYS);
 const items=(await pool.query(SQL,[startDate,horizonDate])).rows;
 if(items.length>MAX_ITEMS)throw new AppError(503,'Проверка пересечений: более 2000 записей; неполную загрузку не принимаем.');
 for(const item of items){
  if(!item.id||!['manual','work_order','crm'].includes(item.source_kind)||
     item.status!=='planned'||!Number.isFinite(new Date(item.start_at).getTime())||
     !Number.isFinite(new Date(item.end_at).getTime())||
     new Date(item.end_at).getTime()<=new Date(item.start_at).getTime())
    throw new AppError(503,'Проверка пересечений: неполные или некорректные данные расписания.');
 }
 return {version:'LEGACY_CONFLICT_GUARD_V1105_SOURCE',startDate,endDate,horizonDate,
  timezone:'Asia/Yerevan',source:SOURCE,complete:true,items};
}
