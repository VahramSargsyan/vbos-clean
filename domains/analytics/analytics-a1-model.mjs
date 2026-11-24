// A1: pure native analytics projections; legacy AnalyticsService/OwnerActivityAnalytics semantics.
// No source writes, financial effects, secrets or implicit zero for absent money records.
export const VERSION='CLEAN_ANALYTICS_A1_V1';
export const TZ='Asia/Yerevan';
export const FORMULA='Business Result = active native Finance profit_effect_base + recorded M1 total_business_gains_base';
export const GAIN_KEYS=['referral_commission_base','purchase_commission_base','organization_margin_base','tax_optimization_savings_base','other_business_income_base'];
export class AnalyticsError extends Error {
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
export function currentMonth(now=new Date()){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit'}).formatToParts(now);
 return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value;
}
export function monthPeriod(key){
 if(typeof key!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(key))
  throw new AnalyticsError(400,'ANALYTICS_INVALID_MONTH');
 const y=Number(key.slice(0,4)),m=Number(key.slice(5));
 const k=(n)=>new Date(Date.UTC(y,m-1+n,1)).toISOString().slice(0,7);
 return {monthKey:key,year:String(y),dateFrom:key+'-01',dateUntil:k(1)+'-01',
  dateTo:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10),rollingKeys:Array.from({length:12},(_,i)=>k(i-11)),
  ytdKeys:Array.from({length:m},(_,i)=>k(i-m+1)),timezone:TZ};
}
const micro=s=>{
 const v=String(s);
 if(!/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(v))throw new AnalyticsError(503,'ANALYTICS_INVALID_MONEY');
 const neg=v.startsWith('-'),[w,f='']=(neg?v.slice(1):v).split('.');
 return (neg?-1n:1n)*(BigInt(w)*1000000n+BigInt(f.padEnd(6,'0')));
};
const dec=n=>{const neg=n<0n,a=neg?-n:n;return (neg?'-':'')+(a/1000000n)+'.'+String(a%1000000n).padStart(6,'0');};
const sumMoney=xs=>xs.length?dec(xs.reduce((a,x)=>a+micro(x),0n)):null;
const averageMoney=xs=>xs.length?dec(xs.reduce((a,x)=>a+micro(x),0n)/BigInt(xs.length)):null;
const round=n=>Math.round(n*100)/100;
const ratio=(a,b)=>b>0?round(a/b):null;
const n=x=>{const v=Number(x);return Number.isFinite(v)&&v>=0?v:0;};
const sum=(xs,k)=>round(xs.reduce((a,x)=>a+n(x[k]),0));
const optionalSum=(xs,k)=>xs.some(x=>x[k]!==null&&x[k]!==undefined&&x[k]!=='')?sum(xs,k):null;
const grouped=(xs,key)=>{const m=new Map();for(const x of xs){const k=key(x);if(!m.has(k))m.set(k,[]);m.get(k).push(x);}return m;};
const groupCounts=(xs,key)=>Array.from(grouped(xs,key),([key,rows])=>({key,count:rows.length})).sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key));
const safeGroup=(value,allowed)=>allowed.includes(value)?value:'unknown';
export function financeSnapshot(period,financeRows,gainRows,{attested=false,cutover=null,gainsAvailable=true,currentCash=null}={}){
 const fm=new Map(financeRows.map(r=>[r.month_key,r])),gm=new Map(gainRows.map(r=>[r.month_key,r]));
 const rolling=period.rollingKeys.map(key=>{
  const f=fm.get(key),g=gm.get(key),eligible=attested&&cutover&&key>=cutover.slice(0,7)&&key+'-01'>=cutover;
  const activeCount=eligible?Number(f?.active_count||0):null;
  const profit=eligible&&activeCount>0?dec(micro(f.profit_base)):null;
  const gains=gainsAvailable&&g?dec(micro(g.total_business_gains_base)):null;
  const parts=[profit,gains].filter(x=>x!==null);
  return {monthKey:key,financeProfitBase:profit,businessGainsBase:gains,
   businessResultBase:parts.length===2?sumMoney(parts):null,observedComponentsBase:sumMoney(parts),
   activeFinanceTransactionCount:activeCount,businessGainRecordCount:gainsAvailable?Number(Boolean(g)):null,
   financeStatus:!attested?'SOURCE_UNATTESTED':!eligible?'PRE_CUTOVER':activeCount?'RECORDED':'NO_RECORDS',
   gainsStatus:!gainsAvailable?'UNAVAILABLE':g?'RECORDED':'NO_RECORD',
   earnedBase:profit===null?null:dec(micro(f.earned_base)),receivedBase:profit===null?null:dec(micro(f.received_base)),
   economicExpenseBase:profit===null?null:dec(micro(f.economic_expense_base)),
   cashFlowBase:profit===null?null:dec(micro(f.cash_balance_base)),
   gains:gains===null?null:Object.fromEntries(GAIN_KEYS.map(k=>[k,dec(micro(g[k]))])),
   hasData:parts.length>0};
 });
 const ytd=rolling.filter(r=>period.ytdKeys.includes(r.monthKey)),month=rolling.at(-1);
 const totals=rows=>{
  const list=k=>rows.map(r=>r[k]).filter(x=>x!==null);
  const covered=rows.filter(r=>r.businessResultBase!==null);
  return {expectedMonths:rows.length,coveredMonths:covered.length,financeMonths:list('financeProfitBase').length,gainsMonths:list('businessGainsBase').length,
   financeProfitBase:sumMoney(list('financeProfitBase')),businessGainsBase:sumMoney(list('businessGainsBase')),
   observedComponentsBase:sumMoney(list('observedComponentsBase')),
   businessResultBase:covered.length===rows.length?sumMoney(list('businessResultBase')):null,
   averageCoveredBase:averageMoney(list('businessResultBase'))};
 };
 const annual=totals(ytd),rolling12=totals(rolling);
 const reference='750000.000000',avg=annual.averageCoveredBase;
 const goal={year:period.year,targetAverageMonthlyResultBase:null,legacyDefaultReferenceBase:reference,
  referenceAnnualBase:'9000000.000000',status:'GOAL_MIGRATION_GATE',canEdit:false,
  averageCoveredBase:avg,referenceProgressPercent:avg===null?null:ratio(Number(avg)*100,Number(reference)),
  referenceGapBase:avg===null?null:dec(micro(avg)-micro(reference)),annualTargetGapBase:null,requiredRemainingAverageBase:null,
  rolling12AverageBase:rolling12.averageCoveredBase};
 return {formula:FORMULA,source:'CLEAN_NATIVE_POST_CUTOVER_ONLY + CLEAN_TEST_MONTHLY_ONLY',
  historicalIncluded:false,attested,cutover,month,ytd:annual,rolling12,monthlyTrend:ytd,rollingTrend:rolling,goal,
  currentCashBalanceBase:attested&&currentCash!==null?dec(micro(currentCash)):null};
}
function mergedIntervals(intervals){
 const sorted=intervals.filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start).map(x=>({...x})).sort((a,b)=>a.start-b.start);
 const merged=[];
 for(const x of sorted){const last=merged.at(-1);if(last&&x.start<=last.end)last.end=Math.max(last.end,x.end);else merged.push(x);}
 return merged;
}
export function unionMinutes(intervals){return round(mergedIntervals(intervals).reduce((a,x)=>a+x.end-x.start,0)/60000);}
export function intersectionMinutes(left,right){
 const a=mergedIntervals(left),b=mergedIntervals(right);let i=0,j=0,ms=0;
 while(i<a.length&&j<b.length){ms+=Math.max(0,Math.min(a[i].end,b[j].end)-Math.max(a[i].start,b[j].start));if(a[i].end<=b[j].end)i++;else j++;}
 return round(ms/60000);
}
const interval=r=>({start:Date.parse(r.start_at),end:Date.parse(r.end_at)});
const detailed=r=>r.performer_mode!==null&&r.performer_mode!==undefined;
const physical=r=>detailed(r)&&['OWNER','JOINT'].includes(r.performer_mode);
export function ownerSnapshot(logs,activities,days){
 const field=logs.filter(physical),done=activities.filter(x=>x.status==='completed'),active=activities.filter(x=>x.status==='active');
 const dates=[...new Set([...days,...field,...done].map(x=>x.day_date))].sort();
 function metrics(f,a){
  const fi=f.map(interval),org=a.filter(x=>x.activity_class==='ORGANIZATION').map(interval),
   sys=a.filter(x=>x.activity_class==='BUSINESS_SYSTEM').map(interval);
  const spans=[unionMinutes(fi),unionMinutes(org),unionMinutes(sys)],unique=unionMinutes([...fi,...org,...sys]);
  return {fieldCleanMinutes:f.length?sum(f,'clean_minutes'):null,fieldTrackedMinutes:fi.length?spans[0]:null,
   organizationMinutes:org.length?spans[1]:null,businessSystemMinutes:sys.length?spans[2]:null,
   uniqueMinutes:fi.length+org.length+sys.length?unique:null,overlapMinutes:fi.length+org.length+sys.length?round(spans.reduce((a,b)=>a+b,0)-unique):null};
 }
 const daily=dates.map(date=>{
  const f=field.filter(x=>x.day_date===date),a=done.filter(x=>x.day_date===date);
  return {date,hasWorkDay:days.some(x=>x.day_date===date),dayType:f.length?(a.length?'MIXED':'FIELD'):a.length?'ORGANIZATIONAL':'NO_RECORDED_ACTIVITY',...metrics(f,a)};
 });
 return {...metrics(field,done),workDayCount:days.length,recordedDayCount:dates.length,completedActivities:done.length,activeActivities:active.length,
  basicLogsWithoutIntervals:logs.filter(x=>!detailed(x)).length,coverage:'RECORDED_NATIVE_INTERVALS_ONLY',
  fieldDayCount:daily.filter(x=>['FIELD','MIXED'].includes(x.dayType)).length,mixedDayCount:daily.filter(x=>x.dayType==='MIXED').length,
  organizationOnlyDayCount:daily.filter(x=>x.dayType==='ORGANIZATIONAL').length,
  days:daily};
}
const volumes=rows=>Array.from(grouped(rows.filter(r=>r.quantity!==null&&r.unit),r=>r.unit),([unit,x])=>({unit,value:sum(x,'quantity')}));
function productivity(rows){
 const full=rows.filter(detailed),clean=full.length?sum(full,'clean_minutes'):null;
 return {workLogCount:rows.length,detailedCount:full.length,basicCount:rows.length-full.length,
  cleanMinutes:clean,basicRecordedMinutes:sum(rows.filter(r=>!detailed(r)),'minutes'),
  lossMinutes:full.length?sum(full,'loss_minutes'):null,reworkMinutes:full.length?sum(full,'rework_minutes'):null,
  reworkCount:full.filter(r=>['yes','disputed'].includes(r.rework_status)).length,
  points:optionalSum(full,'points'),nodes:optionalSum(full,'nodes'),meters:optionalSum(full,'meters'),
  pointsPerHour:optionalSum(full,'points')===null?null:ratio(sum(full,'points')*60,clean),nodesPerHour:optionalSum(full,'nodes')===null?null:ratio(sum(full,'nodes')*60,clean),metersPerHour:optionalSum(full,'meters')===null?null:ratio(sum(full,'meters')*60,clean),
  quantityByUnit:volumes(rows)};
}
export function fieldSnapshot(logs,presence,days,schedule){
 const owner=logs.filter(physical),closed=presence.filter(r=>r.status==='closed');
 const seen=closed.map(interval),present=seen.length?unionMinutes(seen):null;
 // Presence is owner time; coverage is only intersection with owner WorkLog, not worker-hours.
 const field=owner.map(interval);
 const covered=present===null||!field.length?null:intersectionMinutes(field,seen);
 let reasoned=0,unexplained=0,microTransitions=0,breaks=0;
 // Owner gaps only, no JOINT duplicate per worker. Gap reason belongs to successor.
 for(const rows of grouped(owner,r=>r.day_date).values()){
  const sorted=rows.slice().sort((a,b)=>Date.parse(a.start_at)-Date.parse(b.start_at));
  let end=null;
  for(const row of sorted){const v=interval(row);if(!Number.isFinite(v.start)||!Number.isFinite(v.end)||v.end<=v.start)continue;
   if(end!==null&&v.start>end){const gap=(v.start-end)/60000;
    if(gap<=15)microTransitions+=gap;else if(row.gap_reason){reasoned+=gap;if(['lunch','coffee'].includes(row.gap_reason))breaks+=gap;}else unexplained+=gap;
   }end=Math.max(end??v.end,v.end);
  }
 }
 const base=productivity(logs),planned=schedule.length?round(schedule.reduce((a,x)=>a+(Date.parse(x.end_at)-Date.parse(x.start_at))/60000,0)):null,obj=Array.from(grouped(logs.filter(x=>x.object_id),x=>x.object_id),([objectId,rows])=>({objectId,title:rows[0].object_title,...productivity(rows)}))
  .sort((a,b)=>(b.cleanMinutes??0)-(a.cleanMinutes??0)||b.workLogCount-a.workLogCount);
 return {...base,workDayCount:days.length,objectCount:obj.length,workOrderCount:new Set(logs.filter(x=>x.order_id).map(x=>x.order_id)).size,
  presenceMinutes:present,openPresenceCount:presence.length-closed.length,loggedWithinPresenceMinutes:covered,
  nonWorkPresenceMinutes:covered===null?null:round(present-covered),loggedCoveragePercent:covered===null?null:ratio(covered*100,present),
  reasonedLongGapMinutes:owner.length?round(reasoned):null,unexplainedLongGapMinutes:owner.length?round(unexplained):null,
  microTransitionMinutes:owner.length?round(microTransitions):null,breakMinutes:owner.length?round(breaks):null,
  planFact:{scheduleItemCount:schedule.length,plannedMinutes:planned,actualCleanMinutes:base.cleanMinutes,varianceMinutes:planned===null||base.cleanMinutes===null?null:round(base.cleanMinutes-planned)},
  byObject:obj.slice(0,12),objectListTruncated:obj.length>12,coverage:'RECORDED_NATIVE_WORKLOG_AND_PRESENCE_ONLY'};
}
const statusKeys=['new','contacted','qualified','won','lost','transferred'];
const stageKeys=['new_contact','needs_discussion','estimate_required','estimate_sent','negotiation','approved','rejected'];
const sourceKeys=['repeat_client','referral','partner','facebook','instagram','google','whatsapp','signboard','other'];
export function crmSnapshot(leads,conversions,transfers){
 const converted=leads.filter(x=>x.converted===true).length,unconfirmed=leads.filter(x=>x.status==='won'&&x.converted!==true).length;
 const dates=[...new Set([...leads,...conversions,...transfers].map(x=>x.date_key).filter(Boolean))].sort();
 const eventsByDay=dates.map(date=>({date,newLeads:leads.filter(x=>x.date_key===date).length,converted:new Set(conversions.filter(x=>x.date_key===date).map(x=>x.lead_id)).size,transferred:new Set(transfers.filter(x=>x.date_key===date).map(x=>x.lead_id)).size}));
 const bySource=Array.from(grouped(leads,x=>safeGroup(x.source_channel,sourceKeys)),([source,rows])=>{
  const confirmed=rows.filter(x=>x.converted===true).length,unknown=rows.filter(x=>x.status==='won'&&x.converted!==true).length;
  return {source,total:rows.length,confirmedConverted:confirmed,unconfirmedWon:unknown,conversionPercent:unknown?null:ratio(confirmed*100,rows.length),
   statuses:groupCounts(rows,r=>safeGroup(r.status,statusKeys))};
 }).sort((a,b)=>b.total-a.total);
 return {total:leads.length,conversionEvents:new Set(conversions.map(x=>x.lead_id)).size,transferEvents:new Set(transfers.map(x=>x.lead_id)).size,
  cohortConverted:converted,cohortUnconfirmedWon:unconfirmed,conversionPercent:unconfirmed?null:ratio(converted*100,leads.length),
  active:leads.filter(x=>['new','contacted','qualified'].includes(x.status)).length,lostPeriod:null,cohortLost:leads.filter(x=>x.status==='lost').length,
  statuses:groupCounts(leads,r=>safeGroup(r.status,statusKeys)),stages:groupCounts(leads,r=>safeGroup(r.agreement_stage,stageKeys)),bySource,eventsByDay,
  semantics:'Native cohort created_at; current cohort state; conversion link created_at; active transfer transferred_at; lost event date unavailable'};
}
export function workerSnapshot(tasks){
 const rows=Array.from(grouped(tasks,x=>x.worker_id),([workerId,rs])=>{
  const done=rs.filter(x=>x.status==='completed');
  return {workerId,name:rs[0].worker_name,taskCount:rs.length,completedCount:done.length,activeCount:rs.length-done.length,
   durationMinutes:done.length?sum(done,'duration_minutes'):null,managementMinutes:done.length?sum(done,'management_minutes'):null,
   reworkMinutes:done.length?sum(done,'rework_minutes'):null,reworkCount:done.filter(x=>x.rework===true).length,averageScore:null};
 }).sort((a,b)=>(b.durationMinutes??0)-(a.durationMinutes??0)||b.taskCount-a.taskCount);
 return {workerCount:rows.length,taskCount:tasks.length,completedCount:tasks.filter(x=>x.status==='completed').length,
  rows:rows.slice(0,12),listTruncated:rows.length>12,scoreAvailable:false};
}
