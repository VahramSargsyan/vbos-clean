/* VBOS Clean legacy Calendar Hourly v1.10.1 read adapter.
 * One read-only, overlap-complete query of original canonical ScheduleItems.
 * No calendar writer, crew availability estimate or second Capacity decision.
 */
import {schedulePeriod} from './schedule.mjs';
const MAX_ITEMS=2000;
const SOURCE='mvp_schedule_items+mvp_schedule_order_items+mvp_schedule_lead_items';
const SQL=[
"SELECT source_kind,status,start_at,end_at,item_type,title,order_id",
"FROM (",
" SELECT source_kind,status,start_at,end_at,item_type,title,order_id FROM public.mvp_schedule_items",
" UNION ALL SELECT source_kind,status,start_at,end_at,item_type,title,order_id FROM public.mvp_schedule_order_items",
" UNION ALL SELECT source_kind,status,start_at,end_at,item_type,title,order_id FROM public.mvp_schedule_lead_items",
") AS scheduled",
"WHERE status='planned'",
" AND start_at < (($2::date+INTERVAL '1 day') AT TIME ZONE 'Asia/Yerevan')",
" AND end_at > ($1::date AT TIME ZONE 'Asia/Yerevan')",
"ORDER BY start_at,source_kind LIMIT 2001"
].join(' ');
const moveDay=(key,n)=>new Date(Date.parse(key+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
async function sourceRows(pool,periodStart,periodEnd,AppError){
 const rows=(await pool.query(SQL,[periodStart,periodEnd])).rows;
 if(rows.length>MAX_ITEMS)throw new AppError(503,'Часовая шкала: более 2000 записей. Нельзя показывать неполную загрузку.');
 for(const item of rows){
  if(!['manual','work_order','crm'].includes(item.source_kind)||
    item.status!=='planned'||!Number.isFinite(new Date(item.start_at).getTime())||
    !Number.isFinite(new Date(item.end_at).getTime())||
    new Date(item.start_at).getTime()>=new Date(item.end_at).getTime())
   throw new AppError(503,'Часовая шкала: источник расписания не прошёл проверку.');
 }
 return rows;
}
// Exact old Google Hourly v1.10.1: search start date through start+14 calendar days.
// Returns source facts only; UI applies the legacy next-gap rule and Schedule owns Save.
export async function scheduleHourlyNextSourceRead(pool,url,{dayYerevan,safeDate,AppError}){
 const startDate=safeDate(url.searchParams.get('startDate')||dayYerevan());
 const endDate=moveDay(startDate,14);
 const items=await sourceRows(pool,startDate,endDate,AppError);
 return {version:'LEGACY_HOURLY_NEXT_SOURCE_V1101',startDate,endDate,
  timezone:'Asia/Yerevan',complete:true,source:SOURCE,items};
}
export async function scheduleHourlyRead(pool,url,{dayYerevan,safeDate,AppError}){
 const viewMode=String(url.searchParams.get('viewMode')||'week');
 if(!['week','month'].includes(viewMode))throw new AppError(400,'Выбери неделю или месяц.');
 const anchorDate=safeDate(url.searchParams.get('anchorDate')||dayYerevan());
 const {start:periodStart,end:periodEnd}=schedulePeriod(anchorDate,viewMode);
 const rows=await sourceRows(pool,periodStart,periodEnd,AppError);
 return {version:'LEGACY_CALENDAR_HOURLY_V1101',viewMode,anchorDate,periodStart,periodEnd,
  timezone:'Asia/Yerevan',workStart:'08:00',workEnd:'19:00',
  complete:true,source:SOURCE,items:rows};
}
