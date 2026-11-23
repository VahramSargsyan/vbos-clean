/**
 * Finance B23: read-only result for an exact current PostgreSQL Order UUID.
 * Historical Google WorkOrder references never enter this query.
 */
export class OrderFinanceResultError extends Error {
 constructor(status,code){super(code);this.name='OrderFinanceResultError';this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new OrderFinanceResultError(status,code);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS=['receivedBase','advanceBase','earnedBase','cashOutBase','cashBalanceBase',
 'economicExpenseBase','profitBase','workerAccruedBase','workerPaidBase','workerPayableBase'];
const MONEY=/^-?(0|[1-9]\d*)(?:\.\d{1,6})?$/;
function pageCursor(raw,orderId){
 if(!raw)return null;
 if(typeof raw!=='string'||raw.length>360||!/^[A-Za-z0-9_-]+$/.test(raw))
  fail(400,'B23_CURSOR_INVALID');
 try{
  const c=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
  if(!c||c.orderId!==orderId||!UUID.test(c.id)||
     typeof c.at!=='string'||c.at.length>60||!Number.isFinite(Date.parse(c.at)))
   fail(400,'B23_CURSOR_INVALID');
  return c;
 }catch{fail(400,'B23_CURSOR_INVALID');}
}
function amount(value,field){
 const s=String(value??'');
 if(!MONEY.test(s))fail(503,'B23_INVALID_LEDGER_AMOUNT_'+field);
 return s;
}
const summarySQL=[
 'SELECT count(*)::int AS total_count,',
 'count(*) FILTER (WHERE status=\'active\')::int AS active_count,',
 'coalesce(sum(amount_base) FILTER (WHERE status=\'active\' AND operation_type=\'INCOME\'',
 'AND coalesce(normalized->>\'incomeRecognition\',\'\')<>\'EARNED_ONLY\'),0)::text AS received_base,',
 'coalesce(sum(amount_base) FILTER (WHERE status=\'active\' AND operation_type=\'INCOME\'',
 'AND normalized->>\'category\'=\'advance\'',
 'AND coalesce(normalized->>\'incomeRecognition\',\'\')<>\'EARNED_ONLY\'),0)::text AS advance_base,',
 'coalesce(sum(amount_base) FILTER (WHERE status=\'active\' AND operation_type=\'INCOME\'',
 'AND coalesce(normalized->>\'incomeRecognition\',\'\')<>\'RECEIVED_ONLY\'),0)::text AS earned_base,',
 'coalesce(sum(CASE WHEN status=\'active\' AND cash_effect_base<0',
 'THEN -cash_effect_base ELSE 0 END),0)::text AS cash_out_base,',
 'coalesce(sum(cash_effect_base) FILTER (WHERE status=\'active\'),0)::text AS cash_balance_base,',
 'coalesce(sum(CASE WHEN status=\'active\' AND',
 '(operation_type=\'EXPENSE\' AND coalesce(normalized->>\'category\',\'\')<>\'client_material_purchase\'',
 'OR operation_type IN (\'WORKER_ACCRUAL\',\'WORKER_ACCRUAL_PAYMENT\'))',
 'THEN amount_base ELSE 0 END + CASE WHEN status=\'active\' THEN commission_base ELSE 0 END),0)::text AS economic_expense_base,',
 'coalesce(sum(profit_effect_base) FILTER (WHERE status=\'active\'),0)::text AS profit_base,',
 'coalesce(sum(amount_base) FILTER (WHERE status=\'active\' AND operation_type IN',
 '(\'WORKER_ACCRUAL\',\'WORKER_ACCRUAL_PAYMENT\')),0)::text AS worker_accrued_base,',
 'coalesce(sum(amount_base) FILTER (WHERE status=\'active\' AND operation_type IN',
 '(\'WORKER_PAYMENT\',\'WORKER_ACCRUAL_PAYMENT\')),0)::text AS worker_paid_base,',
 'coalesce(sum(worker_payable_effect_base) FILTER (WHERE status=\'active\'),0)::text AS worker_payable_base',
 'FROM mvp_finance_native.transactions',
 'WHERE work_order_id=$1::uuid AND source_system=\'CLEAN_NATIVE_FINANCE\''
].join(' ');
const historySQL=[
 'SELECT finance_transaction_id::text AS id,',
 'transaction_date_key::text AS date,operation_type AS type,status,revision,',
 'amount_base::text AS amount_base,cash_effect_base::text AS cash_effect_base,',
 'coalesce(normalized->>\'category\',\'\') AS category,',
 'coalesce(normalized->>\'incomeRecognition\',\'\') AS income_recognition,created_at::text AS created_at',
 'FROM mvp_finance_native.transactions',
 'WHERE work_order_id=$1::uuid AND source_system=\'CLEAN_NATIVE_FINANCE\'',
 'AND ($2::timestamptz IS NULL OR',
 '(created_at,finance_transaction_id)<($2::timestamptz,$3::uuid))',
 'ORDER BY created_at DESC,finance_transaction_id DESC LIMIT $4'
].join(' ');
/** Complete exact-scope SQL totals independent of keyset-paginated history. */
export async function readOrderFinancialResult(pool,orderId,{authorizeOwner,limit=20,cursor=null}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'B23_OWNER_REQUIRED');
 if(!UUID.test(String(orderId||'')))fail(400,'B23_ORDER_UUID_INVALID');
 if(!Number.isInteger(limit)||limit<1||limit>50)fail(400,'B23_LIMIT_INVALID');
 const c=pageCursor(cursor,orderId);
 if(!pool||typeof pool.connect!=='function')fail(503,'B23_DB_UNAVAILABLE');
 const db=await pool.connect();let begun=false;
 try{
  await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
  const parent=await db.query('SELECT id::text AS id FROM public.mvp_orders WHERE id=$1::uuid LIMIT 1',[orderId]);
  if(parent.rows?.length!==1||parent.rows[0].id!==orderId)fail(404,'B23_ORDER_NOT_FOUND');
  const result=(await db.query(summarySQL,[orderId])).rows?.[0];
  if(!result||!Number.isSafeInteger(result.total_count)||!Number.isSafeInteger(result.active_count)||
     result.total_count<0||result.active_count<0||result.active_count>result.total_count)
   fail(503,'B23_INVALID_LEDGER_SUMMARY');
  const metrics={};
  for(const field of FIELDS){
   const sqlField=field.replace(/[A-Z]/g,ch=>'_'+ch.toLowerCase());
   metrics[field]=amount(result[sqlField],field);
  }
  const rows=(await db.query(historySQL,[orderId,c?.at||null,c?.id||null,limit+1])).rows||[];
  const hasMore=rows.length>limit;
  const visible=rows.slice(0,limit);
  const items=visible.map(row=>{
   if(!UUID.test(row.id)||!['active','archived'].includes(row.status))
    fail(503,'B23_INVALID_LEDGER_ROW');
   const at=String(row.created_at);
   if(at.length>60||!Number.isFinite(Date.parse(at)))fail(503,'B23_INVALID_CREATED_AT');
   return Object.freeze({id:row.id,date:String(row.date),type:String(row.type),
    category:String(row.category),status:row.status,revision:row.revision,
    amountBase:amount(row.amount_base,'rowAmount'),cashEffectBase:amount(row.cash_effect_base,'rowCash'),
    incomeRecognition:String(row.income_recognition),createdAt:at});
  });
  const last=items[items.length-1];
  const nextCursor=hasMore&&last?Buffer.from(JSON.stringify({
   orderId,id:last.id,at:last.createdAt
  })).toString('base64url'):null;
  return Object.freeze({version:'FINANCE_B23_ORDER_NATIVE_RESULT_V1',
   source:'CLEAN_NATIVE_ORDER_LEDGER',readonly:true,
   historicalIncluded:false,currency:'AMD',orderId,
   totalCount:result.total_count,activeCount:result.active_count,
   metrics:Object.freeze(metrics),items:Object.freeze(items),
   hasMore,nextCursor});
 }finally{
  if(begun)await db.query('ROLLBACK').catch(()=>{});
  db.release();
 }
}
