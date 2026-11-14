/**
 * FINANCE_OBJECT_RESULT_ARCHIVE_V1 — original FinanceService OBJECT scope.
 * Existing frozen Google source only; no native ledger, no imports, no writes.
 */
import {financeCapitalArchiveRead} from './finance-capital-archive-api.mjs';
import {legacyObjectFinanceSummary} from './finance-order-result.mjs';

export class FinanceObjectResultError extends Error {
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new FinanceObjectResultError(status,code);};
const BATCH='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const SNAP='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const idValid=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(x);
const validSourceRow=x=>x?.sha_valid===true&&x.source_system==='LEGACY_GOOGLE'&&
 x.source_payload&&typeof x.source_payload==='object'&&!Array.isArray(x.source_payload);
async function verifiedArchive(db,authorizeOwner){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'OWNER_SESSION_REQUIRED');
 if(!db||typeof db.query!=='function')fail(503,'FINANCE_OBJECT_DB_UNAVAILABLE');
 const archive=await financeCapitalArchiveRead(db,{authorizeOwner:()=>true});
 if(archive.readonly!==true||archive.financialWriter!=='GOOGLE'||
  archive.currentOperationalFinance!==false||archive.counts?.financeTransactions!==24)
  fail(503,'FINANCE_OBJECT_ARCHIVE_UNVERIFIED');
 return archive;
}
function objectTitle(payload,id){
 const title=String(payload?.title||payload?.name||'').trim();
 return title.slice(0,160)||id;
}
/** 19 original Object IDs from the same verified batch. Does not use native UUIDs. */
export async function financeObjectOptionsRead(db,{authorizeOwner}={}){
 const archive=await verifiedArchive(db,authorizeOwner);
 const q=await db.query(
  "SELECT source_id,source_system,source_payload,payload_sha256=encode(sha256(convert_to(source_payload::text,'UTF8')),'hex') AS sha_valid FROM mvp_history.source_records WHERE source_kind='OBJECT' AND import_batch_id=$1 ORDER BY source_id LIMIT 20",
  [BATCH]);
 const rows=q.rows||[],ids=new Set();
 if(rows.length!==19)fail(503,'FINANCE_OBJECT_SOURCE_COUNT_MISMATCH');
 const items=rows.map(row=>{
  if(!validSourceRow(row)||!idValid(row.source_id)||ids.has(row.source_id))
   fail(503,'FINANCE_OBJECT_SOURCE_INTEGRITY');
  ids.add(row.source_id);
  return Object.freeze({objectId:row.source_id,title:objectTitle(row.source_payload,row.source_id)});
 });
 return Object.freeze({source:'VERIFIED_FROZEN_LEGACY_OBJECT_OPTIONS',
  readonly:true,currentOperationalFinance:false,sourceModifiedAt:archive.sourceModifiedAt,
  items:Object.freeze(items)});
}
/** One Object may contain many orders; scope joins directly on FinanceTransaction.objectId. */
export async function financeObjectResultRead(db,objectId,{authorizeOwner}={}){
 // Authenticate first. Invalid IDs cannot expose existence of frozen objects.
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'OWNER_SESSION_REQUIRED');
 if(!idValid(objectId))fail(400,'FINANCE_OBJECT_ID_INVALID');
 const archive=await verifiedArchive(db,()=>true);
 const q=await db.query(
  "SELECT source_id,source_system,source_payload,payload_sha256=encode(sha256(convert_to(source_payload::text,'UTF8')),'hex') AS sha_valid FROM mvp_history.source_records WHERE source_kind='OBJECT' AND import_batch_id=$1 AND source_id=$2 LIMIT 2",
  [BATCH,objectId]);
 if(q.rows?.length!==1)fail(404,'FINANCE_OBJECT_NOT_FOUND');
 const object=q.rows[0];
 if(!validSourceRow(object))fail(503,'FINANCE_OBJECT_SOURCE_INTEGRITY');
 const t=await db.query(
  "SELECT source_payload,original_status,source_system,payload_sha256=encode(sha256(convert_to(source_payload::text,'UTF8')),'hex') AS sha_valid FROM mvp_history.source_records WHERE source_kind='FINANCE_TRANSACTION' AND import_batch_id=$1 AND source_system='LEGACY_GOOGLE' AND source_payload->>'objectId'=$2 ORDER BY source_id LIMIT 25",
  [BATCH,objectId]);
 const rows=t.rows||[];
 if(rows.length>24)fail(503,'FINANCE_OBJECT_TRANSACTION_LIMIT');
 const transactions=rows.map(row=>{
  if(!validSourceRow(row)||row.original_status!==row.source_payload.status)
   fail(503,'FINANCE_OBJECT_TRANSACTION_INTEGRITY');
  return row.source_payload;
 });
 const c=await db.query(
  "SELECT source_payload,payload_sha256=encode(sha256(convert_to(source_payload::text,'UTF8')),'hex') AS sha_valid FROM mvp_finance_stage.control_snapshots WHERE snapshot_id=$1 AND source_kind='FINANCE_BALANCE' AND source_id=$2 LIMIT 2",
  [SNAP,'OBJECT|'+objectId]);
 if((c.rows||[]).length>1||((c.rows||[]).length===1&&c.rows[0].sha_valid!==true))
  fail(503,'FINANCE_OBJECT_CONTROL_INTEGRITY');
 const metrics=legacyObjectFinanceSummary(objectId,transactions,c.rows?.[0]?.source_payload||null);
 const relatedOrders=new Set(transactions.filter(x=>x.status==='active')
  .map(x=>String(x.workOrderId||'')).filter(Boolean));
 return Object.freeze({
  source:'VERIFIED_FROZEN_LEGACY_OBJECT_FINANCE',readonly:true,
  financialWriter:'GOOGLE',currentOperationalFinance:false,
  sourceModifiedAt:archive.sourceModifiedAt,
  objectId,objectTitle:objectTitle(object.source_payload,objectId),
  currency:'AMD',...metrics,hasOperations:metrics.transactionCount>0,
  relatedOrderCount:relatedOrders.size,
  meaning:'HISTORICAL_ACCUMULATED_OBJECT_FINANCE_NOT_CURRENT_BALANCE'
 });
}
