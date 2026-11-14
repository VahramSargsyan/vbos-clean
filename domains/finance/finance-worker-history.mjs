/**
 * FINANCE_WORKER_HISTORY_V1 — verified historical WORKER finance scope.
 * Only frozen original Google Worker ID and linked FinanceTransaction.workerId.
 * No payroll, timesheet, worker earnings, current debt or money posting.
 */
import {financeCapitalArchiveRead} from './finance-capital-archive-api.mjs';
import {legacyWorkerFinanceSummary} from './finance-order-result.mjs';

export class FinanceWorkerHistoryError extends Error{
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new FinanceWorkerHistoryError(status,code);};
const BATCH='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const SNAP='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const goodId=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(v);
async function guard(db,authorizeOwner){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'OWNER_SESSION_REQUIRED');
 if(!db||typeof db.query!=='function')fail(503,'WORKER_HISTORY_DB_UNAVAILABLE');
 const archive=await financeCapitalArchiveRead(db,{authorizeOwner:()=>true});
 if(archive?.readonly!==true||archive.financialWriter!=='GOOGLE'||
  archive.currentOperationalFinance!==false||archive.counts?.financeTransactions!==24)
  fail(503,'WORKER_HISTORY_ARCHIVE_UNVERIFIED');
 return archive;
}
function validSource(row){
 return row?.source_system==='LEGACY_GOOGLE'&&row.sha_valid===true&&
  row.source_payload&&typeof row.source_payload==='object'&&!Array.isArray(row.source_payload);
}
function label(row){
 return String(row.source_payload?.name||row.source_payload?.title||row.source_id).trim().slice(0,160);
}
/** List exactly the two immutable source workers; never remap by name to Clean UUIDs. */
export async function financeWorkerOptionsRead(db,{authorizeOwner}={}){
 const archive=await guard(db,authorizeOwner);
 const q=await db.query(
  "SELECT source_id,source_system,source_payload, "+
  "payload_sha256=encode(sha256(convert_to(source_payload::text,'UTF8')),'hex') AS sha_valid "+
  "FROM mvp_history.source_records WHERE source_kind='WORKER' AND source_system='LEGACY_GOOGLE' "+
  "AND import_batch_id=$1 ORDER BY source_id LIMIT 3",
  [BATCH]);
 const rows=q.rows||[],seen=new Set();
 if(rows.length!==2)fail(503,'WORKER_HISTORY_SOURCE_COUNT_MISMATCH');
 const workers=rows.map(row=>{
  if(!validSource(row)||!goodId(row.source_id)||seen.has(row.source_id))
   fail(503,'WORKER_HISTORY_SOURCE_INTEGRITY');
  seen.add(row.source_id);
  return Object.freeze({workerId:row.source_id,workerName:label(row)});
 });
 return Object.freeze({source:'VERIFIED_FROZEN_LEGACY_WORKER_OPTIONS',readonly:true,
  currentOperationalFinance:false,sourceModifiedAt:archive.sourceModifiedAt,
  workers:Object.freeze(workers)});
}
export async function financeWorkerHistoryRead(db,workerId,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'OWNER_SESSION_REQUIRED');
 if(!goodId(workerId))fail(400,'FINANCE_WORKER_ID_INVALID');
 const archive=await guard(db,()=>true);
 const w=await db.query(
  "SELECT source_id,source_system,source_payload, "+
  "payload_sha256=encode(sha256(convert_to(source_payload::text,'UTF8')),'hex') AS sha_valid "+
  "FROM mvp_history.source_records WHERE source_kind='WORKER' AND source_system='LEGACY_GOOGLE' "+
  "AND import_batch_id=$1 AND source_id=$2 LIMIT 2",
  [BATCH,workerId]);
 if(w.rows?.length!==1)fail(404,'FINANCE_WORKER_NOT_FOUND');
 const worker=w.rows[0];
 if(!validSource(worker))fail(503,'WORKER_HISTORY_SOURCE_INTEGRITY');
 const tx=await db.query(
  "SELECT source_id,source_system,original_status,source_payload, "+
  "payload_sha256=encode(sha256(convert_to(source_payload::text,'UTF8')),'hex') AS sha_valid "+
  "FROM mvp_history.source_records WHERE source_kind='FINANCE_TRANSACTION' "+
  "AND source_system='LEGACY_GOOGLE' AND import_batch_id=$1 "+
  "AND source_payload->>'workerId'=$2 ORDER BY source_id LIMIT 25",
  [BATCH,workerId]);
 const rows=tx.rows||[];
 if(rows.length>24)fail(503,'WORKER_HISTORY_TOO_MANY_TRANSACTIONS');
 const transactions=rows.map(row=>{
  if(!validSource(row)||row.original_status!==row.source_payload.status)
   fail(503,'WORKER_HISTORY_TRANSACTION_INTEGRITY');
  return row.source_payload;
 });
 const c=await db.query(
  "SELECT source_payload,payload_sha256=encode(sha256(convert_to(source_payload::text,'UTF8')),'hex') AS sha_valid "+
  "FROM mvp_finance_stage.control_snapshots WHERE snapshot_id=$1 AND source_kind='FINANCE_BALANCE' "+
  "AND source_id=$2 LIMIT 2",
  [SNAP,'WORKER|'+workerId]);
 const controls=c.rows||[];
 if(controls.length>1||(controls.length===1&&controls[0].sha_valid!==true))
  fail(503,'WORKER_HISTORY_CONTROL_INTEGRITY');
 const result=legacyWorkerFinanceSummary(workerId,transactions,controls[0]?.source_payload||null);
 return Object.freeze({
  source:'VERIFIED_FROZEN_LEGACY_WORKER_FINANCE',readonly:true,
  financialWriter:'GOOGLE',currentOperationalFinance:false,
  workerId,workerName:label(worker),sourceModifiedAt:archive.sourceModifiedAt,
  currency:'AMD',...result,hasOperations:result.transactionCount>0,
  meaning:'HISTORICAL_BUSINESS_EFFECT_OF_WORKER_LINKED_TRANSACTIONS_NOT_CURRENT_PAYROLL'
 });
}
