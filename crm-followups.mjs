/**
 * CRM-07A: read-only attention preview over canonical Clean Leads and the
 * canonical Lead next_action/next_action_at. Last CRM-06A contact only helps
 * classify stale Leads. This is a read-only view, not a Calendar write path.
 */
import {crmLeadSignals} from './crm-lead-signals.mjs';
const GROUPS=['overdue','today','noNext','stale'];
const MAX_OPEN_LEADS=500;
const DAY_MS=86400000;

function localDay(value){
 const date=value instanceof Date?value:new Date(value);
 if(!Number.isFinite(date.getTime()))return '';
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yerevan',
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const part=type=>parts.find(p=>p.type===type)?.value||'';
 return part('year')+'-'+part('month')+'-'+part('day');
}
function toItem(row){
 // Reuse exact CRM10A score semantics, not a parallel model. No raw need text in API.
 const {winScore}=crmLeadSignals(row);
 return {
  leadId:row.id,title:row.title,contactName:row.contact_name||'',phone:row.phone||'',
  status:row.status,latestInteractionType:row.interaction_type||'',
  lastContactAt:row.last_contact_at||null,lastActivityAt:row.last_contact_at||row.updated_at||row.created_at||null,
  nextAction:row.next_action||'',
  nextActionOn:row.next_action_on||'',nextActionLocal:row.next_action_local||'',
  winScore:{ready:winScore.ready,score:winScore.score,band:winScore.band,bandLabel:winScore.bandLabel,coverage:winScore.coverage,calibratedProbability:false}
 };
}
const dateMs=key=>Date.parse(key+'T00:00:00Z');

export function groupCrmFollowUps(rows,{todayKey,limit=6,staleDays=7}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(todayKey))||
  !Number.isFinite(dateMs(todayKey)))throw Error('CRM07_INVALID_BUSINESS_DAY');
 if(!Number.isInteger(limit)||limit<1||limit>12)throw Error('CRM07_INVALID_LIMIT');
 if(!Number.isInteger(staleDays)||staleDays<1||staleDays>30)throw Error('CRM07_INVALID_STALE_DAYS');
 if(!Array.isArray(rows)||rows.length>MAX_OPEN_LEADS)throw Error('CRM07_UNBOUNDED_OPEN_LEADS');
 const cutoff=localDay(new Date(dateMs(todayKey)-staleDays*DAY_MS));
 const buckets=Object.fromEntries(GROUPS.map(x=>[x,[]]));
 for(const row of rows){
  // The SQL already filters terminal Leads. Keep this defense for callers/tests.
  if(!['new','contacted','qualified'].includes(row.status))continue;
  const action=String(row.next_action||'').trim();
  const due=String(row.next_action_on||'').slice(0,10);
  let bucket='';
  if(action&&due&&due<todayKey)bucket='overdue';
  else if(action&&due===todayKey)bucket='today';
  else if(!action||!due)bucket='noNext';
  else {
   const lastDay=localDay(row.last_contact_at||row.updated_at||row.created_at);
   if(lastDay&&lastDay<cutoff)bucket='stale';
  }
  if(bucket)buckets[bucket].push({...toItem(row),bucket});
 }
 const lexical=(a,b)=>String(a.leadId).localeCompare(String(b.leadId));
 const byDue=(a,b)=>(a.nextActionLocal||a.nextActionOn).localeCompare(b.nextActionLocal||b.nextActionOn)||lexical(a,b);
 const byActivity=(a,b)=>String(a.lastActivityAt||'').localeCompare(String(b.lastActivityAt||''))||lexical(a,b);
 buckets.overdue.sort(byDue);
 buckets.today.sort(byDue);
 buckets.noNext.sort(byActivity);
 buckets.stale.sort(byActivity);
 const output=Object.fromEntries(GROUPS.map(k=>[k,{count:buckets[k].length,items:buckets[k].slice(0,limit)}]));
 // CRM-09A: attention-only queue from complete classified sets, not truncated
 // per-group pages. No invented Win Score or second source/SQL read.
 const reasonFor=(key,lead)=>{
  if(key==='overdue')return 'Срок следующего контакта прошёл';
  if(key==='today')return 'Следующий контакт запланирован на сегодня';
  if(key==='noNext')return lead.nextAction?'Не указано время следующего шага':'Не назначено следующее действие';
  return 'Давно не было активности';
 };
 // Class wins over Score. Within a class, ready CRM10A scores sort high to low.
 // Unknown scores stay null and come after scored cases. Preserve CRM07 groups.
 const priorityRows=GROUPS.flatMap(key=>{
  const fallback=key==='overdue'||key==='today'?byDue:byActivity;
  return buckets[key].map(lead=>({...lead,priorityKey:key,reason:reasonFor(key,lead)}))
   .sort((a,b)=>{
    if(a.winScore.ready!==b.winScore.ready)return a.winScore.ready?-1:1;
    if(a.winScore.ready&&a.winScore.score!==b.winScore.score)return b.winScore.score-a.winScore.score;
    return fallback(a,b);
   });
 });
 const readyCount=priorityRows.filter(x=>x.winScore.ready).length;
 const priority={version:'CRM11A_ATTENTION_SCORE_V1',source:'CANONICAL_CRM10A_SIGNALS_AND_CRM07_ATTENTION',
  count:priorityRows.length,limit:6,items:priorityRows.slice(0,6),
  scoreCoverage:{ready:readyCount,unready:priorityRows.length-readyCount},
  coverage:{complete:true,scanLimit:MAX_OPEN_LEADS}};

 return {version:'CRM07A_READ_ONLY',source:'CANONICAL_LEAD_NEXT_ACTION',
  todayKey,staleDays,openLeadCount:rows.filter(x=>['new','contacted','qualified'].includes(x.status)).length,
  attentionCount:GROUPS.reduce((sum,k)=>sum+buckets[k].length,0),buckets:output,priority,
  coverage:{complete:true,scanLimit:MAX_OPEN_LEADS,itemsPerBucket:limit}};
}

const LATEST_OPEN_LEAD_SQL=`
SELECT l.id,l.title,l.contact_name,l.phone,l.status,l.created_at,l.updated_at,
 l.agreement_stage,l.source_channel,l.need_summary,
 l.next_action,l.next_action_at,to_char(l.next_action_at AT TIME ZONE 'Asia/Yerevan','YYYY-MM-DD') AS next_action_on,
 to_char(l.next_action_at AT TIME ZONE 'Asia/Yerevan','YYYY-MM-DD\"T\"HH24:MI') AS next_action_local,
 i.interaction_type,i.created_at AS last_contact_at
FROM public.mvp_leads AS l
LEFT JOIN LATERAL (
 SELECT interaction_type,created_at,id
 FROM public.mvp_crm_interactions
 WHERE entity_type='Lead' AND lead_id=l.id AND status='active'
 ORDER BY created_at DESC,id DESC
 LIMIT 1
) AS i ON true
WHERE l.status IN ('new','contacted','qualified')
ORDER BY l.created_at DESC,l.id DESC LIMIT 501`;

export async function crmFollowUpsRead({pool,url,dayYerevan,AppError}){
 const params=url.searchParams.getAll('limit');
 const limitRaw=params.length?params[0]:'6';
 if(params.length>1||!/^(?:[1-9]|1[0-2])$/.test(limitRaw))throw new AppError(400,'Покажи от 1 до 12 обращений в группе.');
 const result=await pool.query(LATEST_OPEN_LEAD_SQL);
 if(result.rows.length>MAX_OPEN_LEADS)throw new AppError(409,
  'Фокус CRM не показывает полный список: открытых обращений больше 500. Нужна постраничная обработка.');
 return groupCrmFollowUps(result.rows,{todayKey:dayYerevan(),limit:Number(limitRaw)});
}
