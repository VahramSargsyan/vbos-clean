/**
 * Owner review/archival ORGANIZATION overlay on frozen Finance/Capital history.
 * "ARCHIVED" is a visibility mark only: does not change source status or sums.
 */
import {createHash} from 'node:crypto';
import {financeCapitalArchiveRead} from './finance-capital-archive-api.mjs';
export class FinanceReviewError extends Error {
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new FinanceReviewError(status,code);};
const BATCH='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const SNAP='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const KINDS=new Set(['FINANCE_TRANSACTION','BUSINESS_MONTHLY_GAIN','CAPITAL_FUND','CAPITAL_ALLOCATION_BATCH','CAPITAL_FUND_TRANSACTION']);
const STATES=new Set(['UNREVIEWED','REVIEWED','ARCHIVED']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function identity(kind,id){
 if(!KINDS.has(kind)||typeof id!=='string'||id.length<1||id.length>160||
    /[\x00-\x1f\x7f]/.test(id))fail(400,'BAD_FINANCE_SOURCE_ID');
}
function readLabel(kind,payload,id){
 switch(kind){
  case 'FINANCE_TRANSACTION': return String(payload.operationType||'Операция');
  case 'BUSINESS_MONTHLY_GAIN':return String(payload.monthKey||id);
  case 'CAPITAL_FUND':return String(payload.name||payload.code||id);
  case 'CAPITAL_ALLOCATION_BATCH':return 'Распределение '+id;
  case 'CAPITAL_FUND_TRANSACTION':return String(payload.movementType||'Движение')+' · '+String(payload.toFundId||'');
  default: return id;
 }
}
function readAmount(kind,payload){
 const field=kind==='FINANCE_TRANSACTION'?'amountBase':
  kind==='BUSINESS_MONTHLY_GAIN'?'totalBusinessGainsBase':
  kind==='CAPITAL_ALLOCATION_BATCH'?'totalAmountBase':
  kind==='CAPITAL_FUND_TRANSACTION'?'amountBase':null;
 const raw=field?String(payload[field]??''):'';
 if(raw&&!/^-?\d+(?:\.\d{1,6})?$/.test(raw))fail(503,'SOURCE_AMOUNT_UNSAFE');
 return raw||null;
}
function project(row,state){
 const {source_kind:kind,source_id:id,source_payload:p}=row;
 if(!p||typeof p!=='object'||Array.isArray(p))fail(503,'INVALID_HISTORY_SOURCE_PAYLOAD');
 identity(kind,id);
 return {sourceKind:kind,sourceId:id,sourceStatus:String(row.source_status||''),
  title:readLabel(kind,p,id).slice(0,180),amountBase:readAmount(kind,p),
  reviewState:state?.review_state||'UNREVIEWED',revision:Number(state?.revision||0),
  sourceSystem:'LEGACY_GOOGLE',sourcePreserved:true};
}
/** Owner cookie must be validated by the calling HTTP route and here before all queries. */
export async function financeReviewRead(pool,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)fail(401,'OWNER_SESSION_REQUIRED');
 if(!pool||typeof pool.query!=='function')fail(503,'REVIEW_DB_NOT_CONFIGURED');
 await financeCapitalArchiveRead(pool,{authorizeOwner});
 const finance=(await pool.query(
  "SELECT source_kind,source_id,original_status AS source_status,source_payload,payload_sha256 FROM mvp_history.source_records WHERE import_batch_id=$1 AND source_kind='FINANCE_TRANSACTION' AND source_system='LEGACY_GOOGLE' ORDER BY source_id",
  [BATCH])).rows||[];
 const others=(await pool.query(
  "SELECT source_kind,source_id,source_status,source_payload,payload_sha256 FROM mvp_finance_stage.source_facts WHERE snapshot_id=$1 AND source_system='LEGACY_GOOGLE' ORDER BY source_kind,source_id",
  [SNAP])).rows||[];
 if(finance.length!==24||others.length!==18||finance.some(r=>!/^[0-9a-f]{64}$/.test(r.payload_sha256||''))||
    others.some(r=>!/^[0-9a-f]{64}$/.test(r.payload_sha256||'')))
  fail(503,'REVIEW_SOURCE_INCOMPLETE');
 const marks=(await pool.query(
  "SELECT source_kind,source_id,review_state,revision FROM public.mvp_finance_history_review ORDER BY source_kind,source_id LIMIT 43")).rows||[];
 if(marks.length>42)fail(503,'REVIEW_MARKS_OVERFLOW');
 const map=new Map(marks.map(x=>[x.source_kind+':'+x.source_id,x]));
 const source=[...finance,...others];
 const keys=new Set(source.map(x=>x.source_kind+':'+x.source_id));
 if(keys.size!==42||marks.some(x=>!keys.has(x.source_kind+':'+x.source_id)))fail(503,'REVIEW_ORPHAN_SOURCE');
 return {source:'VERIFIED_FINANCE_REVIEW_OVERLAY',readonlySource:true,financialWriter:'GOOGLE',
  moneyAffectedByArchive:false,total:42,
  counts:{unreviewed:source.filter(x=>!map.has(x.source_kind+':'+x.source_id)||map.get(x.source_kind+':'+x.source_id).review_state==='UNREVIEWED').length,
   reviewed:marks.filter(x=>x.review_state==='REVIEWED').length,
   archived:marks.filter(x=>x.review_state==='ARCHIVED').length},
  items:source.map(x=>project(x,map.get(x.source_kind+':'+x.source_id)))
   .sort((a,b)=>a.sourceKind.localeCompare(b.sourceKind)||b.sourceId.localeCompare(a.sourceId))};
}
function parseAction(p){
 if(!p||typeof p!=='object'||Array.isArray(p))fail(400,'REVIEW_PAYLOAD_INVALID');
 const sourceKind=String(p.sourceKind??''),sourceId=p.sourceId,nextState=String(p.nextState??'');
 identity(sourceKind,sourceId);
 if(!STATES.has(nextState))fail(400,'REVIEW_STATE_INVALID');
 const revision=Number(p.revision);
 if(!Number.isInteger(revision)||revision<0||revision>2147483645)fail(400,'REVIEW_REVISION_INVALID');
 const requestKey=String(p.requestKey||'');
 if(!uuid.test(requestKey))fail(400,'REVIEW_REQUEST_KEY_INVALID');
 if(nextState==='ARCHIVED'&&p.confirmed!=='yes')fail(400,'ARCHIVE_REQUIRES_EXPLICIT_CONFIRMATION');
 return {sourceKind,sourceId,nextState,revision,requestKey};
}
/**
 * Transactional explicit review overlay only, never updates source_facts/source_records.
 * Concurrent actions serialize by legacy source ID; request keys provide safe replay.
 */
export async function financeReviewAction(pool,p,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)fail(401,'OWNER_SESSION_REQUIRED');
 if(!pool||typeof pool.connect!=='function')fail(503,'REVIEW_DB_NOT_CONFIGURED');
 const a=parseAction(p);
 await financeCapitalArchiveRead(pool,{authorizeOwner});
 const digest=createHash('sha256').update(JSON.stringify(a)).digest('hex');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[a.sourceKind,a.sourceId]);
  const exists=a.sourceKind==='FINANCE_TRANSACTION'?
   await client.query(
    "SELECT source_id FROM mvp_history.source_records WHERE source_kind='FINANCE_TRANSACTION' AND source_system='LEGACY_GOOGLE' AND import_batch_id=$1 AND source_id=$2",
    [BATCH,a.sourceId]):
   await client.query(
    "SELECT source_id FROM mvp_finance_stage.source_facts WHERE snapshot_id=$1 AND source_system='LEGACY_GOOGLE' AND source_kind=$2 AND source_id=$3 AND payload_sha256=encode(sha256(convert_to(source_payload::text,'UTF8')),'hex')",
    [SNAP,a.sourceKind,a.sourceId]);
  if(exists.rows.length!==1)fail(404,'REVIEW_ORIGINAL_SOURCE_NOT_FOUND');
  const seen=await client.query(
    "SELECT payload_sha256,response FROM public.mvp_finance_history_review_events WHERE request_key=$1",[a.requestKey]);
  if(seen.rows.length){
   if(seen.rows[0].payload_sha256!==digest)fail(409,'REVIEW_REQUEST_KEY_REUSED');
   await client.query('COMMIT');
   return {...seen.rows[0].response,deduplicated:true};
  }
  const old=(await client.query(
   "SELECT review_state,revision FROM public.mvp_finance_history_review WHERE source_kind=$1 AND source_id=$2 FOR UPDATE",
   [a.sourceKind,a.sourceId])).rows?.[0];
  const prior=old?.review_state||'UNREVIEWED',rev=Number(old?.revision||0);
  if(rev!==a.revision)fail(409,'REVIEW_STALE_REVISION_RELOAD');
  if(prior===a.nextState)fail(409,'REVIEW_ALREADY_IN_STATE');
  const login=(await client.query("SELECT setting_value FROM public.mvp_settings WHERE setting_key='owner_login'")).rows?.[0]?.setting_value;
  if(!/^[a-z0-9_.-]{3,48}$/.test(String(login??'')))fail(503,'REVIEW_OWNER_ID_MISSING');
  const q=await client.query(
   "INSERT INTO public.mvp_finance_history_review(source_kind,source_id,review_state,revision,updated_by_login,last_request_key) VALUES($1,$2,$3,1,$4,$5) ON CONFLICT(source_kind,source_id) DO UPDATE SET review_state=EXCLUDED.review_state,revision=public.mvp_finance_history_review.revision+1,updated_by_login=EXCLUDED.updated_by_login,last_request_key=EXCLUDED.last_request_key,updated_at=now() RETURNING source_kind,source_id,review_state,revision,updated_at",
   [a.sourceKind,a.sourceId,a.nextState,login,a.requestKey]);
  const item=q.rows[0];
  const response={saved:true,sourcePreserved:true,moneyAffectedByArchive:false,
   financialWriter:'GOOGLE',item:{sourceKind:item.source_kind,sourceId:item.source_id,
    reviewState:item.review_state,revision:Number(item.revision),updatedAt:item.updated_at}};
  await client.query(
   "INSERT INTO public.mvp_finance_history_review_events(request_key,payload_sha256,source_kind,source_id,source_snapshot_id,prior_state,next_state,revision,actor_login,response) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)",
   [a.requestKey,digest,a.sourceKind,a.sourceId,a.sourceKind==='FINANCE_TRANSACTION'?BATCH:SNAP,
    prior,a.nextState,item.revision,login,JSON.stringify(response)]);
  await client.query('COMMIT');return response;
 }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}
 finally{client.release();}
}
