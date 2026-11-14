import {timeEngineCapacityRead} from './time-engine.mjs';
/* Capacity V1: legacy SharedCapacityDecision_v1_11_1.js source semantics.
 * Owner-only, read-only, derived from canonical planned ScheduleItems.
 * A one-hour WorkOrder mirror is NOT evidence of complete order duration.
 */
const POLICY='SHARED_CAPACITY_MON_SAT_MONTHLY_BANK_REVIEW_V2';
const FIXED_HOLIDAYS=new Set(['01-01','01-02','01-06','01-27','01-28','03-08','04-24','05-01','05-09','05-28','07-05','09-21','12-31']);
const DAY=86400000,MAX_ROWS=2000;
const isKey=k=>/^\d{4}-\d{2}-\d{2}$/.test(String(k))&&!Number.isNaN(Date.parse(k+'T00:00:00Z'))&&new Date(k+'T00:00:00Z').toISOString().slice(0,10)===k;
const move=(k,n)=>new Date(Date.parse(k+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
const monthStart=(k,n)=>new Date(Date.UTC(+k.slice(0,4),+k.slice(5,7)-1+n,1)).toISOString().slice(0,10);
const monthEnd=k=>new Date(Date.UTC(+k.slice(0,4),+k.slice(5,7),0)).toISOString().slice(0,10);
const bankDay=k=>![0,6].includes(new Date(k+'T00:00:00Z').getUTCDay())&&!FIXED_HOLIDAYS.has(k.slice(5));
function lastBankDay(k){let d=monthEnd(k),limit=0;while(!bankDay(d)&&limit++<14)d=move(d,-1);return d;}
function policyOff(k){if(new Date(k+'T00:00:00Z').getUTCDay()===0)return 'SUNDAY';return k===lastBankDay(k)?'MONTHLY_REVIEW':null;}
// Legacy v1.9.4 / v1.9.5 Calendar uses the SAME policy as Capacity.
// Return server-verified month/week colors and labels; no client-side holiday copy.
export function capacityCalendarDayPolicy(startDate,endDate){
 if(!isKey(startDate)||!isKey(endDate)||endDate<startDate||
    (Date.parse(endDate)-Date.parse(startDate))/DAY>40)throw Error('Недопустимый период календарной политики.');
 const days={};
 for(let day=startDate;day<=endDate;day=move(day,1)){
  const off=policyOff(day);
  days[day]=off||'WORKING_DAY';
 }
 return {version:'CALENDAR_WORKING_DAY_V194_V195',policyVersion:POLICY,
  periodStart:startDate,periodEnd:endDate,days};
}

const yerDay=x=>new Date(x+14400000).toISOString().slice(0,10);
const durationProfile=d=>d<=14?{months:3,maxDays:140}:d<=30?{months:4,maxDays:190}:{months:6,maxDays:280};
const fail=(Err,msg)=>{throw new Err(503,msg);};

export function capacityProject(items,{startDate,horizonEnd,durationWorkingDays,unplannedOrders=0,AppError=Error}){
 if(!isKey(startDate)||!isKey(horizonEnd)||startDate>horizonEnd)throw new AppError(400,'Неверный период Capacity.');
 if(!Number.isInteger(durationWorkingDays)||durationWorkingDays<1||durationWorkingDays>60)throw new AppError(400,'Длительность 1–60 дней.');
 if(items.length>MAX_ROWS)fail(AppError,'Более 2000 активных планов — неполную загрузку не рассчитываем.');
 const tally=new Map();
 for(const item of items){
  if(item.status!=='planned'||!['manual','work_order','crm'].includes(item.source_kind))fail(AppError,'Неизвестная запись расписания.');
  const from=new Date(item.start_at).getTime(),to=new Date(item.end_at).getTime();
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>370*DAY)fail(AppError,'Некорректная длительность записи расписания.');
  let cursor=yerDay(from),end=yerDay(to-1);
  if(cursor<startDate)cursor=startDate;
  let count=0;
  while(cursor<=end&&cursor<=horizonEnd&&count++<371){
   const rec=tally.get(cursor)||{work:0,crm:0,total:0};rec.total++;
   if(item.source_kind==='crm')rec.crm++;else rec.work++;
   tally.set(cursor,rec);cursor=move(cursor,1);
  }
 }
 const days=[],byDate=new Map();
 for(let date=startDate;date<=horizonEnd;date=move(date,1)){
  const rec=tally.get(date)||{work:0,crm:0,total:0},off=policyOff(date);
  const busy=rec.work>0||rec.total>=2;
  const item={date,status:off||(busy?'BUSY':'OPEN_IN_SCHEDULE'),
   working:!off,busy,planned:rec.total,work:rec.work,crm:rec.crm};
  days.push(item);byDate.set(date,item);
 }
 function buffer(anchor,direction){
  let cursor=move(anchor,direction),found=0,guard=0;
  while(cursor>=startDate&&cursor<=horizonEnd&&found<14&&guard++<80){
   const p=byDate.get(cursor);if(p.working){if(p.busy)break;found++;}
   cursor=move(cursor,direction);
  }
  return found;
 }
 const windows=[];
 let proposed=startDate,iterations=0;
 while(proposed<=horizonEnd&&windows.length<3&&iterations++<durationProfile(durationWorkingDays).maxDays){
  if(policyOff(proposed)){proposed=move(proposed,1);continue;}
  const workDays=[];let at=proposed,crmInside=0,reviewInside=0,invalid=false,guard=0;
  while(at<=horizonEnd&&workDays.length<durationWorkingDays&&guard++<280){
   const d=byDate.get(at);
   if(!d.working){if(d.status==='MONTHLY_REVIEW')reviewInside++;}
   else if(d.busy){invalid=true;break;}
   else{workDays.push(at);crmInside+=d.crm;}
   at=move(at,1);
  }
  if(!invalid&&workDays.length===durationWorkingDays){
   const end=workDays.at(-1);
   windows.push({start:proposed,end,workingDays:workDays,durationWorkingDays,
    skippedDays:Math.round((Date.parse(end)-Date.parse(proposed))/DAY)+1-durationWorkingDays,
    monthlyReviewDaysInside:reviewInside,crmRemindersInside:crmInside,
    freeWorkingDaysBefore:buffer(proposed,-1),freeWorkingDaysAfter:buffer(end,1)});
   proposed=move(end,1);
  }else proposed=move(proposed,1);
 }
 return {version:'CAPACITY_SCHEDULE_V1',policyVersion:POLICY,
  source:'mvp_schedule_items+mvp_schedule_order_items+mvp_schedule_lead_items',
  sourceCoverage:'SCHEDULE_ONLY_NOT_FULL_DURATION',bookingReady:false,durationSource:'OWNER_MANUAL',
  durationWorkingDays,startDate,horizonEnd,unplannedOrders,scheduleItemsConsidered:items.length,
  fit:windows.length?'CANDIDATES_IN_SCHEDULE':'NO_CANDIDATES_IN_HORIZON',
  explanation:'Окна только по записанному плану; длительность заказов, занятость исполнителей и неперенесённая история не подтверждены.',
  days,windows};
}

const SCHEDULE_SQL=[
 "SELECT source_kind,status,start_at,end_at FROM (",
 " SELECT 'manual'::text AS source_kind,s.status,s.start_at,s.end_at FROM public.mvp_schedule_items s",
 " WHERE s.status='planned' AND s.start_at<(($2::date+INTERVAL '1 day') AT TIME ZONE 'Asia/Yerevan')",
 " AND s.end_at>($1::date AT TIME ZONE 'Asia/Yerevan')",
 " UNION ALL SELECT 'work_order'::text,s.status,s.start_at,s.end_at FROM public.mvp_schedule_order_items s",
 " WHERE s.status='planned' AND s.start_at<(($2::date+INTERVAL '1 day') AT TIME ZONE 'Asia/Yerevan')",
 " AND s.end_at>($1::date AT TIME ZONE 'Asia/Yerevan')",
 " UNION ALL SELECT 'crm'::text,s.status,s.start_at,s.end_at FROM public.mvp_schedule_lead_items s",
 " WHERE s.status='planned' AND s.start_at<(($2::date+INTERVAL '1 day') AT TIME ZONE 'Asia/Yerevan')",
 " AND s.end_at>($1::date AT TIME ZONE 'Asia/Yerevan')",
 ") source_rows LIMIT 2001"
].join(' ');
const ORDER_SQL=[
 "SELECT count(*) FILTER(WHERE o.planned_on IS NULL)::int AS unplanned,",
 "count(*) FILTER(WHERE o.planned_on IS NOT NULL AND (s.id IS NULL OR s.status<>'planned'))::int AS broken",
 "FROM public.mvp_orders o LEFT JOIN public.mvp_schedule_order_items s ON s.order_id=o.id",
 "WHERE o.status IN ('open','active')"
].join(' ');

export async function capacityRead(pool,url,{dayYerevan,safeDate,AppError}){
 const today=dayYerevan(),requested=safeDate(url.searchParams.get('startDate')||today);
 if(Date.parse(requested)-Date.parse(today)>365*DAY)throw new AppError(400,'Дата дальше одного года.');
 const start=requested<today?today:requested;
 const durationRaw=String(url.searchParams.get('durationWorkingDays')||'3');
 if(!/^(?:[1-9]|[1-5][0-9]|60)$/.test(durationRaw))throw new AppError(400,'Укажи от 1 до 60 рабочих дней.');
 const duration=Number(durationRaw);
 const horizonEnd=monthEnd(monthStart(start,durationProfile(duration).months-1));
 // v1.12.1: MANUAL duration is resolved by Time Engine, then routed into
 // the same owner-authenticated read-only Shared Capacity (no parallel search).
 return timeEngineCapacityRead({durationSource:'MANUAL',durationWorkingDays:duration},{AppError,
  readCapacity:async verifiedDuration=>{
   if(verifiedDuration!==duration)throw new AppError(503,'Time Engine вернул другую длительность.');
 const client=await pool.connect();
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const schedule=await client.query(SCHEDULE_SQL,[start,horizonEnd]);
  const integrity=await client.query(ORDER_SQL);
  if(!integrity.rows.length)fail(AppError,'Источник заказов недоступен.');
  if(Number(integrity.rows[0].broken)>0)fail(AppError,'Есть заказы с датой без синхронизированного плана. Capacity заблокирована.');
  if(schedule.rows.length>MAX_ROWS)fail(AppError,'Активных планов больше 2000; нельзя рассчитывать неполный результат.');
  const output=capacityProject(schedule.rows,{startDate:start,horizonEnd,durationWorkingDays:duration,
   unplannedOrders:Number(integrity.rows[0].unplanned),AppError});
  await client.query('COMMIT');
  return {...output,requestedStartDate:requested,readTime:new Date().toISOString()};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release();}
  }
 });
}
