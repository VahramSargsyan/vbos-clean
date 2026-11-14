/**
 * FINANCE-HISTORY-OWNER-CORRECTIONS-V1.
 * Nonfinancial owner-only display aliases and notes.
 * Never update source_records, source_facts, control_snapshots or any balance.
 */
import {createHash} from 'node:crypto';
import {financeReviewRead} from './finance-review.mjs';

const HISTORY_BATCH='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const CAPITAL_SNAPSHOT='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const KINDS=new Set([
 'FINANCE_TRANSACTION','BUSINESS_MONTHLY_GAIN','CAPITAL_FUND',
 'CAPITAL_ALLOCATION_BATCH','CAPITAL_FUND_TRANSACTION'
]);
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class FinanceCorrectionError extends Error{
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new FinanceCorrectionError(status,code);};
function validIdentity(sourceKind,sourceId){
 if(!KINDS.has(sourceKind)||typeof sourceId!=='string'||sourceId.length<1||sourceId.length>160||
  /[\u0000-\u001f\u007f]/.test(sourceId))fail(400,'INVALID_CORRECTION_SOURCE_ID');
}
function normalizeText(value,max,key){
 if(typeof value!=='string')fail(400,'INVALID_'+key);
 const text=value.normalize('NFC').trim();
 if(text.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
  fail(400,'INVALID_'+key);
 return text.length?text:null;
}
function parse(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))
  fail(400,'INVALID_CORRECTION_REQUEST');
 const permitted=new Set(['sourceKind','sourceId','displayTitle','ownerNote','revision','requestKey']);
 if(Object.keys(payload).some(key=>!permitted.has(key)))fail(400,'CORRECTION_FIELDS_OUT_OF_SCOPE');
 const sourceKind=payload.sourceKind,sourceId=payload.sourceId;
 validIdentity(sourceKind,sourceId);
 const displayTitle=normalizeText(payload.displayTitle,180,'OWNER_TITLE');
 const ownerNote=normalizeText(payload.ownerNote,1000,'OWNER_NOTE');
 const revision=Number(payload.revision);
 if(!Number.isInteger(revision)||revision<0||revision>2147483645)
  fail(400,'INVALID_CORRECTION_REVISION');
 const requestKey=String(payload.requestKey||'');
 if(!UUID_RE.test(requestKey))fail(400,'INVALID_CORRECTION_REQUEST_KEY');
 return {sourceKind,sourceId,displayTitle,ownerNote,revision,requestKey};
}
function rowKey(kind,id){return kind+':'+id;}
function project(record,correction){
 validIdentity(record.sourceKind,record.sourceId);
 return {
  sourceKind:record.sourceKind,sourceId:record.sourceId,
  originalTitle:record.title,sourceStatus:record.sourceStatus,
  reviewState:record.reviewState,sourceSystem:record.sourceSystem,
  amountBase:record.amountBase,
  displayTitle:correction?.display_title??null,
  ownerNote:correction?.owner_note??null,
  revision:Number(correction?.revision||0),
  sourcePreserved:true
 };
}
/** Authorizes before any SQL; reuses all 42 verified original source identities. */
export async function financeCorrectionRead(pool,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'OWNER_SESSION_REQUIRED');
 if(!pool||typeof pool.query!=='function')fail(503,'CORRECTION_DB_NOT_READY');
 const source=await financeReviewRead(pool,{authorizeOwner});
 if(source.source!=='VERIFIED_FINANCE_REVIEW_OVERLAY'||source.total!==42||
    source.moneyAffectedByArchive!==false||source.financialWriter!=='GOOGLE')
  fail(503,'CORRECTION_SOURCE_NOT_VERIFIED');
 const records=(await pool.query(
  'SELECT source_kind,source_id,display_title,owner_note,revision FROM public.mvp_finance_history_corrections ORDER BY source_kind,source_id LIMIT 43'
 )).rows||[];
 if(records.length>42)fail(503,'CORRECTION_OVERLAY_OVERFLOW');
 const originals=new Set(source.items.map(r=>rowKey(r.sourceKind,r.sourceId)));
 const aliases=new Map();
 for(const row of records){
  const key=rowKey(row.source_kind,row.source_id);
  if(!originals.has(key)||aliases.has(key))fail(503,'CORRECTION_ORPHAN_OR_DUPLICATE');
  aliases.set(key,row);
 }
 const items=source.items.map(row=>project(row,aliases.get(rowKey(row.sourceKind,row.sourceId))));
 return {
  source:'VERIFIED_FINANCE_OWNER_CORRECTIONS',readonlySource:true,
  financialWriter:'GOOGLE',moneyAffected:false,editableFields:['displayTitle','ownerNote'],
  total:42,corrected:records.filter(r=>r.display_title!==null||r.owner_note!==null).length,
  items
 };
}
/**
 * Atomic revisioned correction with idempotent request UUID. The overlay alone is mutable.
 * Even setting both fields to null never edits source money or source statuses.
 */
export async function financeCorrectionAction(pool,payload,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'OWNER_SESSION_REQUIRED');
 if(!pool||typeof pool.connect!=='function')fail(503,'CORRECTION_DB_NOT_READY');
 const a=parse(payload);
 const verified=await financeReviewRead(pool,{authorizeOwner});
 if(verified.source!=='VERIFIED_FINANCE_REVIEW_OVERLAY'||verified.total!==42||
   verified.moneyAffectedByArchive!==false||verified.financialWriter!=='GOOGLE')
  fail(503,'CORRECTION_SOURCE_NOT_VERIFIED');
 if(!verified.items.some(r=>r.sourceKind===a.sourceKind&&r.sourceId===a.sourceId))
  fail(404,'CORRECTION_SOURCE_ID_NOT_FOUND');
 const canonical=JSON.stringify({
  sourceKind:a.sourceKind,sourceId:a.sourceId,revision:a.revision,
  displayTitle:a.displayTitle,ownerNote:a.ownerNote
 });
 const digest=createHash('sha256').update(canonical).digest('hex');
 const conn=await pool.connect();
 try{
  await conn.query('BEGIN');
  // Unique per record serialization across concurrent browser tabs.
  await conn.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
   [a.sourceKind,a.sourceId]);
  const seen=(await conn.query(
   'SELECT payload_sha256,response FROM public.mvp_finance_history_correction_events WHERE request_key=$1',
   [a.requestKey])).rows||[];
  if(seen.length){
   if(seen[0].payload_sha256!==digest)fail(409,'CORRECTION_REQUEST_KEY_CONFLICT');
   await conn.query('COMMIT');
   return {...seen[0].response,deduplicated:true};
  }
  const prior=(await conn.query(
   'SELECT display_title,owner_note,revision FROM public.mvp_finance_history_corrections WHERE source_kind=$1 AND source_id=$2 FOR UPDATE',
   [a.sourceKind,a.sourceId])).rows?.[0]||null;
  const priorTitle=prior?.display_title??null,priorNote=prior?.owner_note??null,priorRev=Number(prior?.revision||0);
  if(priorRev!==a.revision)fail(409,'CORRECTION_REVISION_STALE');
  if(priorTitle===a.displayTitle&&priorNote===a.ownerNote)
   fail(409,'CORRECTION_NO_CHANGES');
  const actor=(await conn.query(
   "SELECT setting_value FROM public.mvp_settings WHERE setting_key='owner_login'"
  )).rows?.[0]?.setting_value;
  if(!/^[a-z0-9_.-]{3,48}$/.test(String(actor??'')))fail(503,'OWNER_ACTOR_NOT_VERIFIED');
  const next=(await conn.query(
   'INSERT INTO public.mvp_finance_history_corrections '+
    '(source_kind,source_id,display_title,owner_note,revision,updated_by_login,last_request_key) '+
    'VALUES($1,$2,$3,$4,1,$5,$6) '+
    'ON CONFLICT(source_kind,source_id) DO UPDATE SET '+
    'display_title=EXCLUDED.display_title,owner_note=EXCLUDED.owner_note, '+
    'revision=public.mvp_finance_history_corrections.revision+1, '+
    'updated_by_login=EXCLUDED.updated_by_login, '+
    'last_request_key=EXCLUDED.last_request_key,updated_at=now() '+
    'RETURNING revision,display_title,owner_note,updated_at',
   [a.sourceKind,a.sourceId,a.displayTitle,a.ownerNote,actor,a.requestKey]
  )).rows?.[0];
  if(!next||Number(next.revision)!==priorRev+1)
   fail(503,'CORRECTION_WRITE_NOT_CONFIRMED');
  const response={
   saved:true,sourcePreserved:true,moneyAffected:false,financialWriter:'GOOGLE',
   item:{sourceKind:a.sourceKind,sourceId:a.sourceId,
    displayTitle:next.display_title,ownerNote:next.owner_note,
    revision:Number(next.revision),updatedAt:next.updated_at}
  };
  await conn.query(
   'INSERT INTO public.mvp_finance_history_correction_events '+
    '(request_key,payload_sha256,source_kind,source_id,source_snapshot_id, '+
    'prior_title,next_title,prior_note,next_note,revision,actor_login,response) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',
   [a.requestKey,digest,a.sourceKind,a.sourceId,
    a.sourceKind==='FINANCE_TRANSACTION'?HISTORY_BATCH:CAPITAL_SNAPSHOT,
    priorTitle,a.displayTitle,priorNote,a.ownerNote,next.revision,actor,JSON.stringify(response)]
  );
  await conn.query('COMMIT');return response;
 }catch(error){await conn.query('ROLLBACK').catch(()=>{});throw error;}
 finally{conn.release();}
}


/**
 * Source-verified owner-only read of the append-only correction journal.
 * Existing 0018 audit schema is reused; no accounting, status or audit writes.
 * Fixed kind + monotonic event_id keyset pagination, max 20 events per read.
 */
export async function financeCorrectionAuditRead(pool,url,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'OWNER_SESSION_REQUIRED');
 if(!pool||typeof pool.query!=='function')fail(503,'CORRECTION_AUDIT_DB_NOT_READY');
 const params=url instanceof URL?url.searchParams:new URL(url,'http://localhost').searchParams;
 const mode=params.get('mode')||'finance';
 if(mode!=='finance'&&mode!=='capital')fail(400,'CORRECTION_AUDIT_MODE_INVALID');
 const requestedLimit=params.get('limit');
 if(requestedLimit!==null&&!/^(?:[1-9]|1[0-9]|20)$/.test(requestedLimit))
  fail(400,'CORRECTION_AUDIT_LIMIT_INVALID');
 const limit=requestedLimit===null?10:Number(requestedLimit);
 const cursor=params.get('cursor');
 if(cursor!==null&&(!/^[1-9][0-9]{0,18}$/.test(cursor)||
  BigInt(cursor)>9223372036854775807n))
  fail(400,'CORRECTION_AUDIT_CURSOR_INVALID');
 const canonical=await financeReviewRead(pool,{authorizeOwner});
 if(canonical.source!=='VERIFIED_FINANCE_REVIEW_OVERLAY'||canonical.total!==42||
    canonical.financialWriter!=='GOOGLE'||canonical.moneyAffectedByArchive!==false)
  fail(503,'CORRECTION_AUDIT_SOURCE_UNVERIFIED');
 const kinds=mode==='finance'?['FINANCE_TRANSACTION','BUSINESS_MONTHLY_GAIN']:
  ['CAPITAL_FUND','CAPITAL_ALLOCATION_BATCH','CAPITAL_FUND_TRANSACTION'];
 const sourceMap=new Map(canonical.items.map(x=>[rowKey(x.sourceKind,x.sourceId),x]));
 const rows=(await pool.query(
  'SELECT event_id::text AS event_id,source_kind,source_id,source_snapshot_id,'+
  'prior_title,next_title,prior_note,next_note,revision,actor_login,recorded_at '+
  'FROM public.mvp_finance_history_correction_events '+
  'WHERE source_kind=ANY($1::text[]) AND ($2::bigint IS NULL OR event_id<$2::bigint) '+
  'ORDER BY event_id DESC LIMIT $3',
  [kinds,cursor,limit+1]
 )).rows||[];
 if(rows.length>limit+1)fail(503,'CORRECTION_AUDIT_LIMIT_BROKEN');
 const events=rows.slice(0,limit).map(row=>{
  if(!kinds.includes(row.source_kind)||typeof row.source_id!=='string'||
    !sourceMap.has(rowKey(row.source_kind,row.source_id)))fail(503,'CORRECTION_AUDIT_ORPHAN');
  const expectedSnapshot=row.source_kind==='FINANCE_TRANSACTION'?HISTORY_BATCH:CAPITAL_SNAPSHOT;
  if(row.source_snapshot_id!==expectedSnapshot)fail(503,'CORRECTION_AUDIT_SNAPSHOT_MISMATCH');
  if(!/^[1-9][0-9]{0,18}$/.test(String(row.event_id))||
    !Number.isSafeInteger(Number(row.revision))||Number(row.revision)<1||
    !/^[a-z0-9_.-]{3,48}$/.test(String(row.actor_login)))fail(503,'CORRECTION_AUDIT_ROW_INVALID');
  for(const [field,cap] of [['prior_title',180],['next_title',180],
    ['prior_note',1000],['next_note',1000]]){
   const value=row[field];
   if(value!==null&&value!==undefined&&(typeof value!=='string'||value.length>cap))
    fail(503,'CORRECTION_AUDIT_TEXT_INVALID');
  }
  const timestamp=new Date(row.recorded_at);
  if(!Number.isFinite(timestamp.getTime()))fail(503,'CORRECTION_AUDIT_DATE_INVALID');
  const original=sourceMap.get(rowKey(row.source_kind,row.source_id));
  return {
   eventId:String(row.event_id),sourceKind:row.source_kind,sourceId:row.source_id,
   originalTitle:original.title,revision:Number(row.revision),
   priorTitle:row.prior_title??null,nextTitle:row.next_title??null,
   priorNote:row.prior_note??null,nextNote:row.next_note??null,
   actorLogin:row.actor_login,recordedAt:timestamp.toISOString()
  };
 });
 const hasMore=rows.length>limit;
 return {
  source:'VERIFIED_FINANCE_CORRECTION_AUDIT',readonly:true,
  moneyAffected:false,financialWriter:'GOOGLE',mode,limit,
  events,hasMore,nextCursor:hasMore?events.at(-1)?.eventId||null:null
 };
}
