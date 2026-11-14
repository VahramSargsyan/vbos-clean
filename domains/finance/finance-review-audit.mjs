/**
 * FINANCE REVIEW AUDIT V1 — history of manual marks (reviewed/archived/restored).
 * Owner-only, read-only view over existing immutable 0017 review event receipts.
 * Original Finance/Capital source, financial authority and review states are unchanged.
 */
import {financeReviewRead} from './finance-review.mjs';

export class FinanceReviewAuditError extends Error {
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new FinanceReviewAuditError(status,code);};
const kindsByMode=Object.freeze({
 finance:['FINANCE_TRANSACTION','BUSINESS_MONTHLY_GAIN'],
 capital:['CAPITAL_FUND','CAPITAL_ALLOCATION_BATCH','CAPITAL_FUND_TRANSACTION']
});
const states=new Set(['UNREVIEWED','REVIEWED','ARCHIVED']);
const BATCH='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const SNAP='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const validCursor=v=>/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;

/** Projection is deliberately finite; do not expose raw JSON receipts or financial rows. */
export function financeReviewAuditProject(rows,{mode,limit,cursor,sourceItems}){
 if(!kindsByMode[mode]||!Array.isArray(rows)||rows.length>limit+1||
    !Array.isArray(sourceItems)||sourceItems.length!==42)
  fail(503,'REVIEW_AUDIT_SOURCE_UNVERIFIED');
 const kinds=kindsByMode[mode],sources=new Map();
 for(const item of sourceItems){
  const key=item.sourceKind+':'+item.sourceId;
  if(sources.has(key))fail(503,'REVIEW_AUDIT_DUPLICATE_SOURCE');
  sources.set(key,item);
 }
 const events=[],seen=new Set();
 let previous=cursor===null?null:BigInt(cursor);
 for(const row of rows){
  const eventId=String(row.event_id??'');
  if(!validCursor(eventId))fail(503,'REVIEW_AUDIT_EVENT_ID_INVALID');
  const seq=BigInt(eventId);
  if((previous!==null&&seq>=previous)||seen.has(eventId))
   fail(503,'REVIEW_AUDIT_EVENT_ORDER_INVALID');
  previous=seq;seen.add(eventId);
  if(!kinds.includes(row.source_kind)||typeof row.source_id!=='string'||
     !states.has(row.prior_state)||!states.has(row.next_state)||
     row.prior_state===row.next_state)fail(503,'REVIEW_AUDIT_ROW_INVALID');
  const original=sources.get(row.source_kind+':'+row.source_id);
  if(!original||original.sourceSystem!=='LEGACY_GOOGLE'||original.sourcePreserved!==true)
   fail(503,'REVIEW_AUDIT_ORPHAN_SOURCE');
  const snapshot=row.source_kind==='FINANCE_TRANSACTION'?BATCH:SNAP;
  if(row.source_snapshot_id!==snapshot)
   fail(503,'REVIEW_AUDIT_SNAPSHOT_MISMATCH');
  const revision=Number(row.revision);
  if(!Number.isSafeInteger(revision)||revision<1||
     !/^[a-z0-9_.-]{3,48}$/.test(String(row.actor_login??'')))
   fail(503,'REVIEW_AUDIT_METADATA_INVALID');
  const recorded=new Date(row.recorded_at);
  if(!Number.isFinite(recorded.getTime()))fail(503,'REVIEW_AUDIT_DATE_INVALID');
  if(events.length<limit){
   events.push(Object.freeze({
    eventId,sourceKind:row.source_kind,sourceId:row.source_id,
    originalTitle:String(original.title||original.sourceId).slice(0,180),
    previousState:row.prior_state,nextState:row.next_state,
    revision,actorLogin:row.actor_login,recordedAt:recorded.toISOString()
   }));
  }
 }
 const hasMore=rows.length>limit;
 return Object.freeze({
  source:'VERIFIED_FINANCE_REVIEW_AUDIT',readonly:true,
  financialWriter:'GOOGLE',moneyAffected:false,mode,limit,
  events:Object.freeze(events),hasMore,
  nextCursor:hasMore?events.at(-1)?.eventId||null:null
 });
}

/** Before querying events, the existing immutable 42-source read gate must pass. */
export async function financeReviewAuditRead(pool,url,{authorizeOwner,verifiedRead=financeReviewRead}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'OWNER_SESSION_REQUIRED');
 if(!pool||typeof pool.query!=='function')fail(503,'REVIEW_AUDIT_DB_NOT_READY');
 const params=url instanceof URL?url.searchParams:new URL(url,'http://localhost').searchParams;
 const mode=params.get('mode')||'finance';
 if(!kindsByMode[mode])fail(400,'REVIEW_AUDIT_MODE_INVALID');
 const rawLimit=params.get('limit');
 if(rawLimit!==null&&!/^(?:[1-9]|1[0-9]|20)$/.test(rawLimit))
  fail(400,'REVIEW_AUDIT_LIMIT_INVALID');
 const limit=rawLimit===null?10:Number(rawLimit),cursor=params.get('cursor');
 if(cursor!==null&&!validCursor(cursor))fail(400,'REVIEW_AUDIT_CURSOR_INVALID');
 const source=await verifiedRead(pool,{authorizeOwner});
 if(source?.source!=='VERIFIED_FINANCE_REVIEW_OVERLAY'||source?.readonlySource!==true||
    source.financialWriter!=='GOOGLE'||source.moneyAffectedByArchive!==false||
    source.total!==42||!Array.isArray(source.items)||source.items.length!==42)
  fail(503,'REVIEW_AUDIT_SOURCE_UNVERIFIED');
 const rows=(await pool.query(
  'SELECT event_id::text AS event_id,source_kind,source_id,source_snapshot_id,'+
  'prior_state,next_state,revision,actor_login,recorded_at '+
  'FROM public.mvp_finance_history_review_events '+
  'WHERE source_kind=ANY($1::text[]) AND ($2::bigint IS NULL OR event_id<$2::bigint) '+
  'ORDER BY event_id DESC LIMIT $3',
  [kindsByMode[mode],cursor,limit+1]
 )).rows||[];
 return financeReviewAuditProject(rows,{mode,limit,cursor,sourceItems:source.items});
}
