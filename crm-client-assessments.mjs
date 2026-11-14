/**
 * CRM-20A: owner-only read adapter for assessments recorded at order close.
 * Historical Google snapshot stays immutable, never an operational order.
 * No writes, guessed name/phone matches or historical score backfill.
 */
import {compareStoredLegacyAssessment,computeLegacyAssessmentScoreV1} from './close-contract-parity.mjs';

const ARCHIVE_COUNTS=Object.freeze({
 LEAD:33,CLIENT:17,OBJECT:19,WORKER:2,WORK_ORDER:22,
 CLIENT_ASSESSMENT:13,WORKER_ASSIGNMENT:1,FINANCE_TRANSACTION:24
});
const SCORE_VERSION='CLIENT_SCORE_V1_100';
const MAX_ASSESSMENTS=200;
const fail=(AppError,status,message)=>{throw new AppError(status,message);};
const str=x=>x==null?'':String(x);
function dateOnly(value){
 if(typeof value==='number'&&Number.isInteger(value)&&value>10000&&value<100000)
  return new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,10);
 if(typeof value==='string'){
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  if(/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value)))return value.slice(0,10);
 }
 if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
 return '';
}
function scoreOrNull(value,AppError){
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='number'&&typeof value!=='string')
  fail(AppError,503,'Повреждён формат сохранённой оценки клиента.');
 const s=str(value).trim();
 if(!/^(?:0|[1-9]\d{0,2})(?:\.\d)?$/.test(s)||+s<0||+s>100)
  fail(AppError,503,'Некорректный сохранённый балл в истории клиента.');
 return Number(s);
}
function historicalRow(row,AppError){
 const a=row.assessment||{},o=row.order_fields||{},id=str(row.assessment_id);
 if(row.assessment_status==='archived')return null;
 const aid=str(a.clientAssessmentId),oid=str(row.order_id),cid=str(row.client_source_id);
 if(row.assessment_status!=='active'||row.assessment_system!=='LEGACY_GOOGLE'||
    row.order_system!=='LEGACY_GOOGLE'||row.order_status!=='completed'||
    !id||id!==aid||!oid||str(a.workOrderId)!==oid||
    !cid||str(a.clientId)!==cid||str(o.clientId)!==cid||
    !str(a.objectId)||str(a.objectId)!==str(o.objectId)||
    str(o.clientAssessmentId)!==id||
    !str(o.closedAt)||!str(o.financeCheckedAt)||
    o.unfinishedObligationsStatus!=='NONE'||!str(o.clientRequestId))
  fail(AppError,503,'Нарушена связь исторической оценки с завершённым заказом.');
 const score=scoreOrNull(a.score,AppError);
 let computed,parity;
 try{
  computed=computeLegacyAssessmentScoreV1(a);
  parity=compareStoredLegacyAssessment(a);
 }catch{
  fail(AppError,503,'Не удалось проверить исходные факторы исторической оценки.');
 }
 const validScore=score!==null&&computed.scoreComplete&&parity.stored&&parity.matched===true&&
  str(a.scoreVersion)===SCORE_VERSION;
 return {
  id:'legacy:'+id,source:'VERIFIED_LEGACY_ARCHIVE',legacyAssessmentId:id,
  orderId:oid,orderTitle:str(o.title||o.description||oid)||'Заказ',
  orderStatus:'completed',completionDate:dateOnly(o.completionDate),
  recordedAt:str(a.updatedAt||a.createdAt),score,riskLabel:str(a.riskLabel||'UNKNOWN'),
  scoreVersion:str(a.scoreVersion),knownFactors:computed.knownFactors,totalFactors:6,
  scoreComplete:computed.scoreComplete,verifiedForAverage:validScore,
  requiresScoreReview:score!==null&&!validScore,archivedReadOnly:true
 };
}
function nativeRow(row,AppError){
 const score=scoreOrNull(row.score,AppError);
 const complete=row.score_complete===true&&score!==null;
 const validScore=complete&&str(row.score_version)===SCORE_VERSION&&
  Number.isInteger(row.known_factors)&&row.known_factors===6;
 return {
  id:'native:'+str(row.id),source:'CLEAN_NATIVE',
  orderId:str(row.order_id),orderTitle:str(row.order_title||'Заказ'),
  orderStatus:'done',completionDate:dateOnly(row.completion_date),
  recordedAt:row.recorded_at instanceof Date?row.recorded_at.toISOString():str(row.recorded_at),
  score,riskLabel:str(row.risk_label||'UNKNOWN'),scoreVersion:str(row.score_version),
  knownFactors:Number(row.known_factors)||0,totalFactors:6,
  scoreComplete:complete,verifiedForAverage:validScore,
  requiresScoreReview:score!==null&&!validScore,archivedReadOnly:false
 };
}
const nativeSql=[
 "SELECT a.id,a.order_id,o.title AS order_title,f.completion_date::text AS completion_date,",
 "a.recorded_at,a.score,a.score_version,a.known_factors,a.score_complete,a.risk_label",
 "FROM public.mvp_native_client_assessments a",
 "JOIN public.mvp_native_order_close_facts f",
 "ON f.assessment_id=a.id AND f.order_id=a.order_id AND f.source_system='CLEAN_NATIVE'",
 "JOIN public.mvp_orders o ON o.id=a.order_id AND o.status='done'",
 "JOIN public.mvp_objects ob ON ob.id=o.object_id",
 "WHERE ob.client_id=$1",
 "ORDER BY f.completion_date DESC,a.recorded_at DESC,a.id DESC LIMIT 201"
].join(' ');
const archiveReceiptSql=[
 "SELECT b.batch_id FROM mvp_history.import_batches b",
 "JOIN mvp_history.batch_receipts r ON r.batch_id=b.batch_id",
 "AND r.receipt_kind='RECONCILED_IN_ISOLATED_TEST'",
 "AND r.verified_manifest_sha256=b.evidence_manifest_sha256",
 "WHERE b.expected_counts=$1::jsonb AND r.reconciled_counts=$1::jsonb",
 "ORDER BY b.batch_id LIMIT 2"
].join(' ');
const archiveSql=[
 "SELECT a.source_id AS assessment_id,a.original_status AS assessment_status,",
 "a.source_system AS assessment_system,a.source_payload AS assessment,",
 "a.client_source_id,o.source_id AS order_id,o.original_status AS order_status,",
 "o.source_system AS order_system,o.source_payload AS order_fields",
 "FROM public.mvp_legacy_import_map m",
 "JOIN mvp_history.source_records a ON a.source_kind='CLIENT_ASSESSMENT'",
 "AND a.client_source_id=m.source_id AND a.import_batch_id=$2",
 "LEFT JOIN mvp_history.source_records o ON o.source_kind='WORK_ORDER'",
 "AND o.import_batch_id=a.import_batch_id",
 "AND o.source_id=a.source_payload->>'workOrderId'",
 "WHERE m.source_entity='Clients'",
 "AND m.source_system='Working IP APP / M8C cutover baseline'",
 "AND m.target_id=$1 ORDER BY a.source_id DESC LIMIT 201"
].join(' ');

/** Called only after existing server owner-cookie gate. */
export async function clientAssessmentHistoryRead({pool,clientId,uuid,AppError}){
 const id=uuid(clientId);
 const parent=await pool.query('SELECT id FROM public.mvp_clients WHERE id=$1',[id]);
 if(parent.rows.length!==1)fail(AppError,404,'Клиент не найден.');
 const n=await pool.query(nativeSql,[id]);
 if(n.rows.length>MAX_ASSESSMENTS)
  fail(AppError,503,'История оценок превышает безопасный объём чтения.');
 const items=n.rows.map(row=>nativeRow(row,AppError));
 let archiveStatus='UNAVAILABLE',archiveCount=0;
 try{
  const receipt=await pool.query(archiveReceiptSql,[JSON.stringify(ARCHIVE_COUNTS)]);
  if(receipt.rows.length===1){
   const old=await pool.query(archiveSql,[id,receipt.rows[0].batch_id]);
   if(old.rows.length>MAX_ASSESSMENTS)
    fail(AppError,503,'Исторических оценок больше допустимого объёма чтения.');
   for(const row of old.rows){
    const item=historicalRow(row,AppError);
    if(item){items.push(item);archiveCount++;}
   }
   archiveStatus='VERIFIED_READONLY';
  }
 }catch(error){
  if(error?.code!=='42P01'&&error?.code!=='3F000')throw error;
 }
 if(items.length>MAX_ASSESSMENTS)
  fail(AppError,503,'История оценок превышает безопасный объём чтения.');
 items.sort((a,b)=>{
  const left=a.completionDate||a.recordedAt||'',right=b.completionDate||b.recordedAt||'';
  return right.localeCompare(left)||b.id.localeCompare(a.id);
 });
 const scored=items.filter(item=>item.verifiedForAverage&&item.score!==null);
 const average=scored.length?
  Math.round((scored.reduce((sum,item)=>sum+item.score,0)/scored.length)*10)/10:null;
 return {
  readonly:true,clientId:id,source:'CLEAN_NATIVE_PLUS_VERIFIED_LEGACY_ARCHIVE',
  archiveStatus,historicalGoogleImported:false,
  totalCount:items.length,nativeCount:items.length-archiveCount,archiveCount,
  scoredCount:scored.length,average,averageCompleteCoverage:archiveStatus==='VERIFIED_READONLY',
  items
 };
}
