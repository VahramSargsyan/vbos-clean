/**
 * VBOS Clean Finance / owner-only read adapter.
 * Isolated from shared server.mjs: no routes, no writes, no browser credentials.
 */
export class HistoryOrdersAccessError extends Error {
  constructor(status, code){super(code);this.status=status;this.code=code;this.name='HistoryOrdersAccessError';}
}
const fail=(status,code)=>{throw new HistoryOrdersAccessError(status,code);};
const goodId=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(x);
const goodBatch=x=>typeof x==='string'&&/^[A-Za-z0-9_:-]{8,160}$/.test(x);
const scopes=Object.freeze({
  finished:Object.freeze(['completed','archived']),
  unfinished:Object.freeze(['draft','planned','active']),
  all:Object.freeze(['draft','planned','active','completed','archived'])
});
const expected=Object.freeze({LEAD:33,CLIENT:17,OBJECT:19,WORKER:2,WORK_ORDER:22,CLIENT_ASSESSMENT:13,WORKER_ASSIGNMENT:1,FINANCE_TRANSACTION:24});
async function gate(db,authorizeOwner,batchId){
  if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)fail(401,'OWNER_SESSION_REQUIRED');
  if(!db||typeof db.query!=='function')fail(500,'HISTORY_DATABASE_NOT_CONFIGURED');
  if(!goodBatch(batchId))fail(503,'HISTORY_BATCH_NOT_CONFIGURED');
  const r=await db.query("SELECT b.expected_counts,r.reconciled_counts FROM mvp_history.import_batches b JOIN mvp_history.batch_receipts r ON r.batch_id=b.batch_id AND r.receipt_kind='RECONCILED_IN_ISOLATED_TEST' AND r.verified_manifest_sha256=b.evidence_manifest_sha256 WHERE b.batch_id=$1",[batchId]);
  const row=r.rows?.[0],keys=Object.keys(expected);
  if(r.rows?.length!==1||!row||Object.keys(row.expected_counts||{}).length!==keys.length||Object.keys(row.reconciled_counts||{}).length!==keys.length||
     !keys.every(k=>Number(row.expected_counts[k])===expected[k]&&Number(row.reconciled_counts[k])===expected[k]))
    fail(503,'HISTORY_NOT_RECONCILED');
}
const title="coalesce(nullif(r.source_payload->>'title',''),nullif(r.source_payload->>'description',''),'')";
const objectTitle="coalesce(nullif(o.source_payload->>'title',''),nullif(o.source_payload->>'name',''),'')";
const clientName="coalesce(nullif(c.source_payload->>'name',''),nullif(c.source_payload->>'displayName',''),'')";
const joins=" FROM mvp_history.source_records r LEFT JOIN mvp_history.source_records o ON o.source_kind='OBJECT' AND o.source_id=r.object_source_id AND o.import_batch_id=r.import_batch_id LEFT JOIN mvp_history.source_records c ON c.source_kind='CLIENT' AND c.source_id=r.client_source_id AND c.import_batch_id=r.import_batch_id";
function parse(url){
  if(!(url instanceof URL))fail(400,'INVALID_HISTORY_QUERY');
  const scope=url.searchParams.get('scope')||'finished';
  if(!Object.hasOwn(scopes,scope))fail(400,'INVALID_HISTORY_SCOPE');
  const n=url.searchParams.get('limit')??'20';
  if(!/^[1-9]\d?$/.test(n)||Number(n)>50)fail(400,'INVALID_HISTORY_LIMIT');
  const query=(url.searchParams.get('query')||'').trim();
  if(query.length>80||/[\u0000-\u001f\u007f]/.test(query))fail(400,'INVALID_HISTORY_SEARCH');
  const cursor=url.searchParams.get('cursor');
  if(cursor&&!goodId(cursor))fail(400,'INVALID_HISTORY_CURSOR');
  return {scope,limit:Number(n),query,cursor};
}
/** Page only from exact reconciled batch. No raw notes or receipts in list. */
export async function historicalOrdersPage(db,url,{authorizeOwner,batchId}={}){
  await gate(db,authorizeOwner,batchId);
  const {scope,limit,query,cursor}=parse(url),args=[batchId,scopes[scope],query];
  let where=" WHERE r.source_kind='WORK_ORDER' AND r.import_batch_id=$1 AND r.original_status=ANY($2::text[]) AND ($3='' OR strpos(lower("+title+"),lower($3))>0 OR strpos(lower("+objectTitle+"),lower($3))>0 OR strpos(lower("+clientName+"),lower($3))>0 OR strpos(lower(r.source_id),lower($3))>0)";
  if(cursor){args.push(cursor);where+=' AND r.source_id < $'+args.length;}
  args.push(limit+1);
  const sql="SELECT r.source_id AS legacy_order_id,r.source_system,r.original_status AS status,"+title+" AS title,r.client_source_id AS legacy_client_id,r.object_source_id AS legacy_object_id,"+clientName+" AS client_name,"+objectTitle+" AS object_title,coalesce(r.source_payload->>'expectedProfitAmount',r.source_payload->>'expected_profit_amount') AS planned_profit_amount,coalesce(r.source_payload->>'expectedProfitCurrency',r.source_payload->>'expected_profit_currency') AS planned_profit_currency,coalesce(r.source_payload->>'plannedStartDate',r.source_payload->>'planned_start_date') AS planned_start_raw,coalesce(r.source_payload->>'completionDate',r.source_payload->>'completion_date') AS completion_date_raw,EXISTS(SELECT 1 FROM mvp_history.source_records ca WHERE ca.source_kind='CLIENT_ASSESSMENT' AND ca.import_batch_id=r.import_batch_id AND ca.source_payload->>'workOrderId'=r.source_id AND ca.source_id=r.source_payload->>'clientAssessmentId' AND r.original_status='completed') AS has_client_assessment"+joins+where+' ORDER BY r.source_id DESC LIMIT $'+args.length;
  const rows=(await db.query(sql,args)).rows||[],items=Object.freeze(rows.slice(0,limit).map(x=>Object.freeze({...x})));
  const hasMore=rows.length>limit;
  return Object.freeze({items,scope,limit,hasMore,nextCursor:hasMore?items.at(-1)?.legacy_order_id:null,source:'VERIFIED_HISTORY_NOT_OPERATIONAL_ORDERS',readonly:true,meaning:'planned_profit_amount_is_estimate_not_realized'});
}
/** Detail is owner-only; not a live operational order. */
export async function historicalOrderDetail(db,id,{authorizeOwner,batchId}={}){
  await gate(db,authorizeOwner,batchId);
  if(!goodId(id))fail(400,'INVALID_HISTORY_ORDER_ID');
  const sql="SELECT r.source_id AS legacy_order_id,r.original_status AS status,r.source_system,r.client_source_id AS legacy_client_id,r.object_source_id AS legacy_object_id,r.lead_source_id AS legacy_lead_id,r.source_payload AS original_fields,"+clientName+" AS client_name,"+objectTitle+" AS object_title"+joins+" WHERE r.source_kind='WORK_ORDER' AND r.import_batch_id=$1 AND r.source_id=$2 LIMIT 1";
  const r=await db.query(sql,[batchId,id]);
  if(r.rows?.length!==1)fail(404,'HISTORY_ORDER_NOT_FOUND');
  return Object.freeze({...r.rows[0],readonly:true,source:'VERIFIED_HISTORY_NOT_OPERATIONAL_ORDERS'});
}

/** V13a owner-only close/ClientAssessment projection; stored facts, never an operational order write. */
export async function historicalOrderAssessment(db,id,{authorizeOwner,batchId}={}){
  await gate(db,authorizeOwner,batchId);
  if(!goodId(id))fail(400,'INVALID_HISTORY_ORDER_ID');
  const sql=`SELECT r.source_id AS legacy_order_id,r.original_status AS status,r.source_payload AS order_fields,
     a.source_id AS assessment_id,a.original_status AS assessment_status,a.source_payload AS assessment_fields
    FROM mvp_history.source_records r
    LEFT JOIN mvp_history.source_records a ON
       a.source_kind='CLIENT_ASSESSMENT'
       AND a.import_batch_id=r.import_batch_id
       AND a.source_payload->>'workOrderId'=r.source_id
    WHERE r.source_kind='WORK_ORDER' AND r.import_batch_id=$1 AND r.source_id=$2
    LIMIT 2`;
  const q=await db.query(sql,[batchId,id]);
  const rows=q.rows||[];
  if(rows.length===0)fail(404,'HISTORY_ORDER_NOT_FOUND');
  if(rows.length!==1)fail(503,'HISTORY_ASSESSMENT_LINK_AMBIGUOUS');
  const row=rows[0],order=row.order_fields||{};
  const a=row.assessment_fields||null;
  if(row.status==='completed'){
    if(!a||!row.assessment_id||row.assessment_status!=='active'||
       String(order.clientAssessmentId||'')!==String(row.assessment_id)||
       String(a.clientAssessmentId||'')!==String(row.assessment_id)||
       String(a.workOrderId||'')!==String(row.legacy_order_id)||
       String(a.clientId||'')!==String(order.clientId||'')||
       String(a.objectId||'')!==String(order.objectId||''))
      fail(503,'HISTORY_CLOSE_ASSESSMENT_LINK_INVALID');
    if(!order.closedAt||!order.financeCheckedAt||
       order.unfinishedObligationsStatus!=='NONE'||!order.clientRequestId)
      fail(503,'HISTORY_CLOSE_FIELDS_INCOMPLETE');
  }else if(a){
    fail(503,'HISTORY_NONCOMPLETED_ASSESSMENT_CONFLICT');
  }
  const closeDate=value=>{
    if(typeof value==='number'&&Number.isInteger(value)&&value>10000&&value<100000)
      return new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,10);
    if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
    return null;
  };
  const get=(name)=>a?.[name]??null;
  const assessment=a?Object.freeze({
    legacyAssessmentId:row.assessment_id,
    satisfaction:get('satisfaction'),acceptance:get('acceptance'),
    paymentBehavior:get('paymentBehavior'),communicationQuality:get('communicationQuality'),
    scopeChanges:get('scopeChanges'),workAgain:get('workAgain'),
    comment:get('comment'),score:get('score'),scoreVersion:get('scoreVersion'),
    riskLabel:get('riskLabel'),recordedAt:get('createdAt')
  }):null;
  return Object.freeze({
    readonly:true,source:'VERIFIED_HISTORY_NOT_OPERATIONAL_ORDERS',
    legacyOrderId:row.legacy_order_id,status:row.status,
    assessment,
    close:row.status==='completed'?Object.freeze({
      completionDate:closeDate(order.completionDate),
      closedAt:order.closedAt,
      financeCheckedAt:order.financeCheckedAt,
      paymentStatus:order.paymentStatus??null,
      unfinishedObligationsStatus:order.unfinishedObligationsStatus
    }):null,
    meaning:'INTERNAL_OWNER_ASSESSMENT_AND_HISTORICAL_CLOSE_NOT_CURRENT_FINANCE'
  });
}


/**
 * FINANCE_FILTER_ARCHIVE_V1: exact frozen legacy WorkOrder/Worker references.
 * No native UUIDs, notes, phone, email, amount aggregation, or writes.
 */
export async function historicalFinanceFilterOptions(db,{authorizeOwner,batchId}={}){
 await gate(db,authorizeOwner,batchId);
 const rows=(await db.query(
  "SELECT r.source_kind,r.source_id,r.source_system, "+
  "coalesce(nullif(r.source_payload->>'title',''),r.source_id) AS title, "+
  "coalesce(nullif(r.source_payload->>'name',''),r.source_id) AS name, "+
  "r.payload_sha256=encode(sha256(convert_to(r.source_payload::text,'UTF8')),'hex') AS sha_valid "+
  "FROM mvp_history.source_records r WHERE r.import_batch_id=$1 "+
  "AND r.source_kind IN ('WORK_ORDER','WORKER') AND r.source_system='LEGACY_GOOGLE' "+
  "ORDER BY r.source_kind,r.source_id LIMIT 24",
  [batchId])).rows||[];
 // One of the reconciled 22 WorkOrders is OFFICIAL_SHADOW_EXTRA, owner-confirmed,
 // with zero financial records. It is NOT a direct legacy Google source and must
 // not be presented as an original Google finance filter option.
 const originalOrderCount=expected.WORK_ORDER-1;
 if(rows.length!==originalOrderCount+expected.WORKER)fail(503,'FINANCE_FILTER_OPTIONS_INCOMPLETE');
 const workOrders=[],workers=[],keys=new Set();
 for(const r of rows){
  if(r.source_system!=='LEGACY_GOOGLE'||r.sha_valid!==true||!goodId(r.source_id)||
     !['WORK_ORDER','WORKER'].includes(r.source_kind))fail(503,'FINANCE_FILTER_OPTIONS_INTEGRITY');
  const key=r.source_kind+':'+r.source_id;
  if(keys.has(key))fail(503,'FINANCE_FILTER_OPTIONS_DUPLICATE');
  keys.add(key);
  if(r.source_kind==='WORK_ORDER')workOrders.push(Object.freeze({id:r.source_id,title:String(r.title||r.source_id).slice(0,160)}));
  else workers.push(Object.freeze({id:r.source_id,name:String(r.name||r.source_id).slice(0,160)}));
 }
 if(workOrders.length!==originalOrderCount||workers.length!==expected.WORKER)
  fail(503,'FINANCE_FILTER_OPTIONS_KINDS_INCOMPLETE');
 return Object.freeze({readonly:true,source:'FROZEN_LEGACY_FINANCE_FILTER_OPTIONS',
  workOrders:Object.freeze(workOrders),workers:Object.freeze(workers)});
}
/** ISO calendar date to Google Sheets integer serial (epoch 1899-12-30), strict UTC. */
function financeDateSerial(value){
 if(value==='')return null;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))fail(400,'INVALID_FINANCE_HISTORY_DATE');
 const [y,m,d]=value.split('-').map(Number);
 const time=Date.UTC(y,m-1,d);
 if(y<1900||y>2100||!Number.isFinite(time)||
    new Date(time).toISOString().slice(0,10)!==value)fail(400,'INVALID_FINANCE_HISTORY_DATE');
 return Math.round((time-Date.UTC(1899,11,30))/86400000);
}

/**
 * V14: legacy FinanceTransactions are archive evidence ONLY, not current money.
 * Session and frozen 8-entity source-batch checks run before any row access.
 * No balance/profit aggregation, ID remapping, raw notes or PII exposure.
 */
export async function historicalFinanceTransactionsPage(db,url,{authorizeOwner,batchId}={}){
  await gate(db,authorizeOwner,batchId);
  if(!(url instanceof URL))fail(400,'INVALID_FINANCE_HISTORY_QUERY');
  const type=url.searchParams.get('type')||'ALL';
  const types=['ALL','INCOME','EXPENSE','OWNER_TRANSFER','WORKER_ACCRUAL_PAYMENT'];
  if(!types.includes(type))fail(400,'INVALID_FINANCE_HISTORY_TYPE');
  const limitRaw=url.searchParams.get('limit')??'20';
  if(!/^[1-9]\d?$/.test(limitRaw)||Number(limitRaw)>50)fail(400,'INVALID_FINANCE_HISTORY_LIMIT');
  const cursor=url.searchParams.get('cursor')||'';
  if(cursor&&!goodId(cursor))fail(400,'INVALID_FINANCE_HISTORY_CURSOR');
  const workOrderId=url.searchParams.get('workOrderId')||'';
  const workerId=url.searchParams.get('workerId')||'';
  if((workOrderId&&!goodId(workOrderId))||(workerId&&!goodId(workerId)))
   fail(400,'INVALID_FINANCE_HISTORY_REFERENCE');
  const dateFrom=url.searchParams.get('dateFrom')||'';
  const dateTo=url.searchParams.get('dateTo')||'';
  const fromSerial=financeDateSerial(dateFrom),toSerial=financeDateSerial(dateTo);
  if(fromSerial!=null&&toSerial!=null&&fromSerial>toSerial)
   fail(400,'INVALID_FINANCE_HISTORY_DATE_RANGE');
  const filtered=Boolean(workOrderId||workerId||dateFrom||dateTo);
  const limit=Number(limitRaw);
  const sql=[
    "SELECT r.source_id AS legacy_transaction_id, r.source_system, r.original_status AS status,",
    "r.source_payload->>'transactionDateKey' AS transaction_date_raw,",
    "r.source_payload->>'operationType' AS operation_type,",
    "r.source_payload->>'category' AS category,",
    "r.source_payload->>'amountOriginal' AS amount_original,",
    "r.source_payload->>'currencyOriginal' AS currency_original,",
    "r.source_payload->>'amountBase' AS amount_base,",
    "r.source_payload->>'baseCurrency' AS base_currency,",
    "r.source_payload->>'workOrderId' AS legacy_order_id",
    "FROM mvp_history.source_records r",
    "WHERE r.source_kind='FINANCE_TRANSACTION' AND r.import_batch_id=$1",
    "AND ($2::text='ALL' OR r.source_payload->>'operationType'=$2)",
    "AND ($3::text='' OR r.source_id<$3)",
    "ORDER BY r.source_id DESC LIMIT $4"
  ].join(' ');
  // Preserve the original V14 SQL and response contract for legacy callers.
  // The new query activates only for explicit WorkOrder/Worker/date filters.
  const filteredSql=[
    "SELECT r.source_id AS legacy_transaction_id,r.source_system,r.original_status AS status,",
    "r.source_payload->>'transactionDateKey' AS transaction_date_raw,",
    "r.source_payload->>'operationType' AS operation_type,",
    "r.source_payload->>'category' AS category,",
    "r.source_payload->>'amountOriginal' AS amount_original,",
    "r.source_payload->>'currencyOriginal' AS currency_original,",
    "r.source_payload->>'amountBase' AS amount_base,",
    "r.source_payload->>'baseCurrency' AS base_currency,",
    "r.source_payload->>'workOrderId' AS legacy_order_id,",
    "r.source_payload->>'workerId' AS legacy_worker_id",
    "FROM mvp_history.source_records r",
    "WHERE r.source_kind='FINANCE_TRANSACTION' AND r.import_batch_id=$1",
    "AND ($2::text='ALL' OR r.source_payload->>'operationType'=$2)",
    "AND ($3::text='' OR r.source_id<$3)",
    "AND ($4::text='' OR r.source_payload->>'workOrderId'=$4)",
    "AND ($5::text='' OR r.source_payload->>'workerId'=$5)",
    "AND length(r.source_payload->>'transactionDateKey')=5",
    "AND translate(r.source_payload->>'transactionDateKey','0123456789','')=''",
    "AND ($6::int IS NULL OR (r.source_payload->>'transactionDateKey')::int >= $6)",
    "AND ($7::int IS NULL OR (r.source_payload->>'transactionDateKey')::int <= $7)",
    "ORDER BY r.source_id DESC LIMIT $8"
  ].join(' ');
  const args=filtered?
    [batchId,type,cursor,workOrderId,workerId,fromSerial,toSerial,limit+1]:
    [batchId,type,cursor,limit+1];
  const rows=(await db.query(filtered?filteredSql:sql,args)).rows||[];
  const items=Object.freeze(rows.slice(0,limit).map(row=>Object.freeze({...row})));
  const hasMore=rows.length>limit;
  return Object.freeze({
    items,type,limit,hasMore,
    nextCursor:hasMore?items.at(-1)?.legacy_transaction_id:null,
    readonly:true,
    source:'FROZEN_LEGACY_FINANCE_ARCHIVE_ONLY',
    financialAuthority:'LEGACY_GOOGLE',
    noCurrentBalance:true,
    filters:Object.freeze({workOrderId,workerId,dateFrom,dateTo}),
    meaning:'AMOUNTS_ARE_HISTORICAL_SOURCE_FIELDS_NOT_LIVE_BALANCES_OR_POSTINGS'
  });
}

/** Shared immutable history source attestation, reused by CRM archive readers. */
export const verifyHistoricalArchiveBatch = gate;
