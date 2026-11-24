// Owner-only, read-only month snapshot. All source projections are explicit; never /api/state or Google history.
import {AnalyticsError,VERSION,TZ,FORMULA,monthPeriod,currentMonth,financeSnapshot,fieldSnapshot,ownerSnapshot,crmSnapshot,workerSnapshot} from './analytics-a1-model.mjs';
import {nativeFinanceScopeSumsSql} from '../finance/finance-native-summary-history.mjs';
import {hostedFinancePostingReadiness} from '../finance/native-finance-writer.mjs';

const MAX_ROWS=20000;
const financeSql="SELECT to_char(t.transaction_date_key,'YYYY-MM') AS month_key,count(*) FILTER (WHERE t.status='active')::int AS active_count,"+
 nativeFinanceScopeSumsSql.join(',')+" FROM mvp_finance_native.transactions t WHERE t.source_system='CLEAN_NATIVE_FINANCE' AND t.transaction_date_key >= greatest($1::date,$3::date) AND t.transaction_date_key < $2::date GROUP BY 1 ORDER BY 1";
const gainSql="SELECT month_key,referral_commission_base::text,purchase_commission_base::text,organization_margin_base::text,tax_optimization_savings_base::text,other_business_income_base::text,total_business_gains_base::text FROM public.mvp_business_monthly_gains WHERE source_system='CLEAN_TEST_MONTHLY_ONLY' AND month_key BETWEEN $1 AND $2 ORDER BY month_key";
const queries={
 leads:"SELECT l.id::text AS lead_id,(l.created_at AT TIME ZONE 'Asia/Yerevan')::date::text AS date_key,l.status,l.agreement_stage,l.source_channel,(c.lead_id IS NOT NULL) AS converted FROM public.mvp_leads l LEFT JOIN public.mvp_crm_lead_client_links c ON c.lead_id=l.id WHERE l.created_at>=($1::date::timestamp AT TIME ZONE 'Asia/Yerevan') AND l.created_at<($2::date::timestamp AT TIME ZONE 'Asia/Yerevan') AND NOT EXISTS(SELECT 1 FROM public.mvp_legacy_import_map m WHERE m.source_entity='Leads' AND m.target_id=l.id) ORDER BY l.created_at,l.id",
 conversions:"SELECT lead_id::text,(created_at AT TIME ZONE 'Asia/Yerevan')::date::text AS date_key FROM public.mvp_crm_lead_client_links WHERE source_kind='CLEAN_NATIVE_CONVERSION' AND created_at>=($1::date::timestamp AT TIME ZONE 'Asia/Yerevan') AND created_at<($2::date::timestamp AT TIME ZONE 'Asia/Yerevan') ORDER BY created_at,lead_id",
 transfers:"SELECT lead_id::text,(transferred_at AT TIME ZONE 'Asia/Yerevan')::date::text AS date_key FROM public.mvp_crm_lead_transfers WHERE source_system='CLEAN_NATIVE' AND status='active' AND transferred_at>=($1::date::timestamp AT TIME ZONE 'Asia/Yerevan') AND transferred_at<($2::date::timestamp AT TIME ZONE 'Asia/Yerevan') ORDER BY transferred_at,lead_id",
 logs:"SELECT l.id::text AS log_id,l.day_date::text,l.order_id::text,o.object_id::text,obj.name AS object_title,l.minutes,l.quantity::text,l.unit,d.performer_mode,d.worker_id::text,(l.day_date+d.start_clock) AT TIME ZONE 'Asia/Yerevan' AS start_at,(l.day_date+d.end_clock) AT TIME ZONE 'Asia/Yerevan' AS end_at,d.clean_minutes,d.loss_minutes,d.rework_minutes,d.rework_status,d.gap_reason,d.points::text,d.nodes::text,d.meters::text FROM public.mvp_work_logs l LEFT JOIN public.mvp_work_log_details d ON d.work_log_id=l.id LEFT JOIN public.mvp_orders o ON o.id=l.order_id LEFT JOIN public.mvp_objects obj ON obj.id=o.object_id WHERE l.day_date >= $1::date AND l.day_date < $2::date ORDER BY l.day_date,d.start_clock,l.id",
 presence:"SELECT day_date::text,object_id::text,order_id::text,status,arrived_at AS start_at,departed_at AS end_at FROM public.mvp_object_presence WHERE day_date >= $1::date AND day_date < $2::date ORDER BY day_date,arrived_at,id",
 days:"SELECT day_date::text,status FROM public.mvp_work_days WHERE day_date >= $1::date AND day_date < $2::date ORDER BY day_date",
 schedule:"SELECT schedule_date::text AS day_date,object_id::text,order_id::text,status,start_at,end_at FROM public.mvp_schedule_items WHERE status NOT IN ('cancelled','archived') AND schedule_date >= $1::date AND schedule_date < $2::date ORDER BY schedule_date,start_at,id",
 activities:"SELECT day_date::text,status,activity_class,start_at,end_at,duration_minutes FROM public.mvp_owner_activities WHERE status IN ('completed','active') AND day_date >= $1::date AND day_date < $2::date ORDER BY day_date,start_at,id",
 tasks:"SELECT t.day_date::text,t.worker_id::text,w.name AS worker_name,t.object_id::text,t.order_id::text,t.status,t.start_at,t.end_at,t.duration_minutes,t.management_minutes,t.rework,t.rework_minutes,t.outcome,t.result_qty::text,t.result_unit FROM public.mvp_worker_tasks t JOIN public.mvp_workers w ON w.id=t.worker_id WHERE t.status IN ('active','completed') AND t.day_date >= $1::date AND t.day_date < $2::date ORDER BY t.day_date,t.start_at,t.id",
 financeExport:"SELECT transaction_date_key::text AS date_key,operation_type,amount_base::text,commission_base::text,profit_effect_base::text,cash_effect_base::text,worker_payable_effect_base::text,work_order_id::text AS order_id,object_id::text,worker_id::text FROM mvp_finance_native.transactions WHERE source_system='CLEAN_NATIVE_FINANCE' AND status='active' AND transaction_date_key >= greatest($1::date,$3::date) AND transaction_date_key < $2::date ORDER BY transaction_date_key,finance_transaction_id"
};
export async function readAnalyticsA1(pool,monthKey,{authorizeOwner,exportMode=false,now=new Date()}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)throw new AnalyticsError(401,'ANALYTICS_OWNER_REQUIRED');
 const period=monthPeriod(monthKey===null||monthKey===undefined?currentMonth(now):monthKey);
 if(!pool?.connect)throw new AnalyticsError(503,'ANALYTICS_DB_UNAVAILABLE');
 const db=await pool.connect(),warnings=[],raw={};
 const warn=(code,message)=>warnings.push({code,severity:'warning',message});
 let begun=false;
 try{
  await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
  await db.query("SET LOCAL statement_timeout='12s'");
  // Failure in an independent source must not masquerade as empty or abort other sources.
  async function section(name,fn){
   await db.query('SAVEPOINT analytics_source');
   try{const value=await fn();await db.query('RELEASE SAVEPOINT analytics_source');return value;}
   catch(e){
    await db.query('ROLLBACK TO SAVEPOINT analytics_source');await db.query('RELEASE SAVEPOINT analytics_source');
    if(e?.code==='ANALYTICS_LIMIT')warn(name+'_LIMIT','Слишком много записей за период. Раздел не усечён и не рассчитан.');
    else warn(name+'_UNAVAILABLE','Источник раздела недоступен или не подтверждён.');
    return null;
   }
  }
  const bounds=[period.dateFrom,period.dateUntil];
  async function read(name,args=bounds){
   const result=await db.query(queries[name]+' LIMIT '+(MAX_ROWS+1),args);
   if(result.rows.length>MAX_ROWS)throw {code:'ANALYTICS_LIMIT'};
   return result.rows;
  }
  const fs=await section('FINANCE',async()=>{
   const g=(await db.query('SELECT * FROM mvp_finance_native.cutover_control WHERE id=1')).rows[0];
   const ready=await hostedFinancePostingReadiness(pool,db,g);
   if(ready.ready!==true)throw new AnalyticsError(503,'ANALYTICS_FINANCE_UNATTESTED');
   const cutover=g.cutover_date_key instanceof Date?g.cutover_date_key.toISOString().slice(0,10):String(g.cutover_date_key);
   const rows=(await db.query(financeSql,[period.rollingKeys[0]+'-01',period.dateUntil,cutover])).rows;
   const cash=(await db.query('SELECT current_cash_balance_base::text FROM mvp_finance_native.v_cash_ledger')).rows[0];
   if(exportMode)raw.finance=await read('financeExport',[...bounds,cutover]);
   return {rows,cutover,currentCash:cash?.current_cash_balance_base??null};
  });
  const gains=await section('M1',async()=>(await db.query(gainSql,[period.rollingKeys[0],period.monthKey])).rows);
  const finance=financeSnapshot(period,fs?.rows||[],gains||[],{attested:!!fs,cutover:fs?.cutover??null,gainsAvailable:gains!==null,currentCash:fs?.currentCash??null});
  if(gains!==null)raw.gains=gains.filter(x=>x.month_key===period.monthKey);
  const crm=await section('CRM',async()=>{
   const leads=await read('leads'),conversions=await read('conversions'),transfers=await read('transfers');
   raw.leads=leads;raw.conversions=conversions;raw.transfers=transfers;
   return crmSnapshot(leads,conversions,transfers);
  });
  const logs=await section('WORKLOG',()=>read('logs')),days=await section('WORKDAY',()=>read('days')),
   presence=await section('PRESENCE',()=>read('presence')),schedule=await section('SCHEDULE',()=>read('schedule')),
   activities=await section('OWNER_ACTIVITY',()=>read('activities')),tasks=await section('WORKER_TASK',()=>read('tasks'));
  if(logs!==null)raw.logs=logs;if(days!==null)raw.days=days;if(presence!==null)raw.presence=presence;
  if(schedule!==null)raw.schedule=schedule;if(activities!==null)raw.activities=activities;if(tasks!==null)raw.tasks=tasks;
  const field=logs===null?null:fieldSnapshot(logs,presence||[],days||[],schedule||[]);
  if(field){if(days===null)field.workDayCount=null;if(schedule===null)field.planFact.scheduleItemCount=null;if(presence===null)field.openPresenceCount=null;}
  const owner=(logs===null&&activities===null)?null:ownerSnapshot(logs||[],activities||[],days||[]);
  if(owner){if(logs===null)owner.basicLogsWithoutIntervals=null;if(days===null)owner.workDayCount=null;if(activities===null){owner.activeActivities=null;owner.completedActivities=null;}if(logs===null||activities===null){owner.uniqueMinutes=null;owner.overlapMinutes=null;owner.days.forEach(d=>{d.uniqueMinutes=null;d.overlapMinutes=null;});}}
  const workers=tasks===null?null:workerSnapshot(tasks);
  if(finance.ytd.coveredMonths!==finance.ytd.expectedMonths)warn('FINANCE_PARTIAL_PERIOD','Неполное покрытие Business Result. Неизвестные месяцы не считаются нулевой прибылью.');
  warn('GOAL_MIGRATION_GATE','Сохранённая нативная цель отсутствует. 750 000 AMD — только legacy-ориентир; редактирование требует отдельного решения.');
  if(crm){warn('CRM_COHORT_SEMANTICS','Конверсия когорты подтверждается нативной связью Lead→Client. Дата отказа не хранится.');if(crm.cohortUnconfirmedWon)warn('CRM_UNCONFIRMED_WON','Есть лиды со статусом won без подтверждённой связи; процент не вычисляется.');}
  if(field?.basicCount)warn('WORKLOG_BASIC_ONLY','Часть WorkLog не содержит интервалов, исполнителя и детализации потерь; базовые минуты показаны отдельно.');
  if(owner)warn('OWNER_COVERAGE','Только записанные интервалы. Отсутствие исторической записи не доказывает отсутствие деятельности.');
  if(owner?.overlapMinutes>0)warn('OWNER_OVERLAP','Пересечения категорий учтены один раз в уникальном времени.');
  if(workers)warn('WORKER_SCORE_UNAVAILABLE','В принятой модели WorkerTask нет finalScore; средняя оценка недоступна.');
  const snapshot={version:VERSION,source:'CLEAN_POSTGRESQL_TEST',readonly:true,generatedAt:now.toISOString(),period,finance,crm,field,owner,workers,warnings};
  await db.query('COMMIT');begun=false;
  return exportMode?buildAnalyticsTxt(snapshot,raw):snapshot;
 }catch(e){if(begun)await db.query('ROLLBACK').catch(()=>{});if(e instanceof AnalyticsError)throw e;throw new AnalyticsError(503,'ANALYTICS_READ_FAILED');}
 finally{db.release();}
}
const pick=(r,keys)=>Object.fromEntries(keys.map(k=>[k,r[k]??null]));
const tagger=prefix=>{const map=new Map();return x=>{if(!x)return null;if(!map.has(x))map.set(x,prefix+'_'+(map.size+1));return map.get(x);};};
export function buildAnalyticsTxt(s,raw){
 // Original HomeExportTxtPatch is structured AI text (.txt), not full database backup.
 // Never pass raw row objects, notes, contact info, UUIDs, settings, or signed attestation.
 const object=tagger('object'),order=tagger('order'),worker=tagger('worker'),lead=tagger('lead'),unit=tagger('unit');
 const safeUnit=x=>!x?'':/^(?:шт\.?|м\.?|м2|м3|м²|м³|кг|л|час|точка|узел|pcs|m|m2|m3|kg|l|h)$/iu.test(x)?x:unit(x);
 const ids=r=>({object:object(r.object_id),order:order(r.order_id),worker:worker(r.worker_id)});
 const volume=a=>a.map(x=>({unit:safeUnit(x.unit),value:x.value}));
 const field=s.field?{...s.field,quantityByUnit:volume(s.field.quantityByUnit),byObject:s.field.byObject.map(({objectId,title,...x})=>({...x,object:object(objectId),quantityByUnit:volume(x.quantityByUnit)}))}:null;
 const workers=s.workers?{...s.workers,rows:s.workers.rows.map(({workerId,name,...x})=>({...x,worker:worker(workerId)}))}:null;
 const datasets={};
 if(raw.finance)datasets.FinanceTransactions=raw.finance.map(r=>({...pick(r,['date_key','operation_type','amount_base','commission_base','profit_effect_base','cash_effect_base','worker_payable_effect_base']),...ids(r)}));
 if(raw.gains)datasets.BusinessMonthlyGains=raw.gains.map(r=>pick(r,['month_key','referral_commission_base','purchase_commission_base','organization_margin_base','tax_optimization_savings_base','other_business_income_base','total_business_gains_base']));
 if(raw.leads)datasets.Leads=raw.leads.map(r=>({...pick(r,['date_key','status','agreement_stage','source_channel','converted']),lead:lead(r.lead_id)}));
 if(raw.conversions)datasets.LeadClientLinks=raw.conversions.map(r=>({date_key:r.date_key,lead:lead(r.lead_id)}));
 if(raw.transfers)datasets.LeadTransfers=raw.transfers.map(r=>({date_key:r.date_key,lead:lead(r.lead_id)}));
 if(raw.logs)datasets.WorkLogs=raw.logs.map(r=>({...pick(r,['day_date','minutes','quantity','performer_mode','start_at','end_at','clean_minutes','loss_minutes','rework_minutes','rework_status','gap_reason','points','nodes','meters']),unit:safeUnit(r.unit),...ids(r)}));
 if(raw.days)datasets.WorkDays=raw.days.map(r=>pick(r,['day_date','status']));
 if(raw.presence)datasets.ObjectPresence=raw.presence.map(r=>({...pick(r,['day_date','status','start_at','end_at']),...ids(r)}));
 if(raw.schedule)datasets.ScheduleItems=raw.schedule.map(r=>({...pick(r,['day_date','status','start_at','end_at']),...ids(r)}));
 if(raw.activities)datasets.OwnerActivityLogs=raw.activities.map(r=>pick(r,['day_date','status','activity_class','start_at','end_at','duration_minutes']));
 if(raw.tasks)datasets.WorkerTasks=raw.tasks.map(r=>({...pick(r,['day_date','status','start_at','end_at','duration_minutes','management_minutes','rework','rework_minutes','outcome','result_qty']),unit:safeUnit(r.result_unit),...ids(r)}));
 const dataQualityWarnings=s.warnings;
 const payload={exportVersion:'VBOS_HOME_EXPORT_V5_CLEAN_A1',appVersion:VERSION,generatedAt:s.generatedAt,
  monthKey:s.period.monthKey,mode:'AI',source:s.source,timeContext:{timezone:TZ,semantics:'day_date/date_key are Yerevan dates; ISO timestamps are instants; WorkerTask clocks are Yerevan local wall time'},
  exportContext:{contract:'MONTH_ALL_OBJECTS_EXPORT',periodPreset:'month',monthKey:s.period.monthKey,dateFrom:s.period.dateFrom,dateTo:s.period.dateTo,allObjects:true},
  formula:FORMULA,analytics:{finance:s.finance,crm:s.crm,field,ownerTime:s.owner,workers},derivedKpis:{fieldTime:field,ownerTime:s.owner},
  dataQualityWarnings,integrityWarnings:[],dataQualitySummary:{dataQualityWarningCount:dataQualityWarnings.length,integrityAudit:'NOT_PERFORMED'},
  exportNotes:{coverage:'Only confirmed native projections; unavailable datasets omitted, absence is not proven zero; no legacy financial archive or opening profit in Business Result.',
   privacy:'Month-local aliases for people/entities; no names, contact details, addresses, free-text notes or credentials. This is not a restorable backup.',
   workerScore:'Unavailable in native WorkerTask',goal:'Read-only legacy reference; no native goal'},
  datasets};
 const content=JSON.stringify(payload,null,2);
 if(Buffer.byteLength(content,'utf8')>4000000)throw new AnalyticsError(413,'ANALYTICS_EXPORT_TOO_LARGE');
 return {filename:'VBOS_'+s.period.monthKey+'_AI_EXPORT.txt',mimeType:'text/plain; charset=utf-8',content};
}
