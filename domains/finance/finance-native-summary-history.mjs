/**
 * Finance P1 — native PostgreSQL-only owner read: cumulative scope totals and
 * independently filtered keyset history. Reuse B18 attested source gate and
 * B23 accounting contributions. No writes, Google joins, or legacy ID coercion.
 */
import {createHash} from 'node:crypto';
import {readNativeFinanceWorkspace} from './native-finance-workspace-read.mjs';

export class NativeFinanceHistoryError extends Error {
 constructor(status,code){super(code);this.name='NativeFinanceHistoryError';this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new NativeFinanceHistoryError(status,code);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const MONEY=/^-?(0|[1-9]\d*)(?:\.\d{1,6})?$/;
const TYPES=new Set(['INCOME','EXPENSE','WORKER_ACCRUAL','WORKER_PAYMENT',
 'WORKER_ACCRUAL_PAYMENT','OWNER_TRANSFER']);
const FIELDS=['earnedBase','receivedBase','economicExpenseBase','profitBase',
 'cashBalanceBase','workerPayableBase','workerPaidBase','ownerTransferBase'];
function validDay(s){
 if(!s)return true;
 if(!DAY.test(s))return false;
 const t=Date.parse(s+'T00:00:00Z');
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s;
}
function money(value){
 const s=String(value??'');
 if(!MONEY.test(s))fail(503,'FINANCE_P1_INVALID_NUMERIC');
 const neg=s.startsWith('-'),[whole,frac='']=(neg?s.slice(1):s).split('.');
 const tail=frac.padEnd(6,'0');
 return (neg&&(whole!=='0'||/[1-9]/.test(tail))?'-':'')+whole+'.'+tail;
}
export function parseNativeFinanceHistoryFilters(params){
 const p=params instanceof URLSearchParams?params:new URLSearchParams(params||'');
 const get=k=>String(p.get(k)||'').trim();
 const f={workOrderId:get('workOrderId'),objectId:get('objectId'),workerId:get('workerId'),
  operationType:get('operationType'),dateFrom:get('dateFrom'),dateTo:get('dateTo'),q:get('q')};
 const selected=['workOrderId','objectId','workerId'].filter(k=>f[k]);
 if(selected.length>1)fail(400,'FINANCE_P1_SELECT_ONE_SCOPE');
 for(const k of ['workOrderId','objectId','workerId'])
  if(f[k]&&!UUID.test(f[k]))fail(400,'FINANCE_P1_NATIVE_UUID_REQUIRED');
 if(f.operationType&&!TYPES.has(f.operationType))fail(400,'FINANCE_P1_INVALID_TYPE');
 if(!validDay(f.dateFrom)||!validDay(f.dateTo)||
    (f.dateFrom&&f.dateTo&&f.dateFrom>f.dateTo))
  fail(400,'FINANCE_P1_INVALID_DATES');
 if(f.q.length>80||f.q.length===1||/[\x00-\x1f]/.test(f.q))
  fail(400,'FINANCE_P1_INVALID_SEARCH');
 const rawLimit=get('limit');
 if(rawLimit&&!/^(?:[1-9]|[1-4]\d|50)$/.test(rawLimit))
  fail(400,'FINANCE_P1_INVALID_LIMIT');
 const limit=rawLimit?Number(rawLimit):20;
 const filterKey=createHash('sha256').update(JSON.stringify(f)).digest('hex');
 const raw=get('cursor');let cursor=null;
 if(raw){
  if(raw.length>500||!/^[A-Za-z0-9_-]+$/.test(raw))fail(400,'FINANCE_P1_INVALID_CURSOR');
  try{
   const c=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
   if(!c||c.k!==filterKey||!UUID.test(c.id)||typeof c.at!=='string'||
      c.at.length>60||!Number.isFinite(Date.parse(c.at)))
    fail(400,'FINANCE_P1_INVALID_CURSOR');
   cursor={id:c.id,at:c.at};
  }catch{fail(400,'FINANCE_P1_INVALID_CURSOR');}
 }
 return {filters:f,limit,filterKey,cursor};
}
function whereFor(f,{history=false}={}){
 const args=[],conditions=["t.source_system='CLEAN_NATIVE_FINANCE'"];
 for(const [key,column] of [['workOrderId','work_order_id'],['objectId','object_id'],['workerId','worker_id']]){
  if(f[key]){args.push(f[key]);conditions.push('t.'+column+'=$'+args.length+'::uuid');}
 }
 if(history){
  if(f.operationType){args.push(f.operationType);conditions.push('t.operation_type=$'+args.length);}
  if(f.dateFrom){args.push(f.dateFrom);conditions.push('t.transaction_date_key>=$'+args.length+'::date');}
  if(f.dateTo){args.push(f.dateTo);conditions.push('t.transaction_date_key<=$'+args.length+'::date');}
  if(f.q){
   const escaped=f.q.replace(/[\\%_]/g,'\\$&');
   args.push('%'+escaped+'%');
   const n='$'+args.length;
   conditions.push("(coalesce(t.normalized->>'notes','') ILIKE "+n+" ESCAPE '\\' OR "+
    "coalesce(t.normalized->>'counterparty','') ILIKE "+n+" ESCAPE '\\' OR "+
    "coalesce(t.normalized->>'category','') ILIKE "+n+" ESCAPE '\\' OR "+
    "t.finance_transaction_id::text ILIKE "+n+" ESCAPE '\\' OR "+
    "coalesce(o.title,'') ILIKE "+n+" ESCAPE '\\' OR "+
    "coalesce(obj.name,'') ILIKE "+n+" ESCAPE '\\' OR "+
    "coalesce(w.name,'') ILIKE "+n+" ESCAPE '\\')");
  }
 }
 return {args,sql:conditions.join(' AND ')};
}
const sums=[
 "COALESCE(sum(t.amount_base) FILTER (WHERE t.status='active' AND t.operation_type='INCOME' AND coalesce(t.normalized->>'incomeRecognition','')<>'RECEIVED_ONLY'),0)::text AS earned_base",
 "COALESCE(sum(t.amount_base) FILTER (WHERE t.status='active' AND t.operation_type='INCOME' AND coalesce(t.normalized->>'incomeRecognition','')<>'EARNED_ONLY'),0)::text AS received_base",
 "COALESCE(sum(CASE WHEN t.status='active' THEN "+
 "CASE WHEN (t.operation_type='EXPENSE' AND coalesce(t.normalized->>'category','')<>'client_material_purchase') "+
 "OR t.operation_type IN ('WORKER_ACCRUAL','WORKER_ACCRUAL_PAYMENT') THEN t.amount_base ELSE 0 END "+
 "+t.commission_base ELSE 0 END),0)::text AS economic_expense_base",
 "COALESCE(sum(t.profit_effect_base) FILTER (WHERE t.status='active'),0)::text AS profit_base",
 "COALESCE(sum(t.cash_effect_base) FILTER (WHERE t.status='active'),0)::text AS cash_balance_base",
 "COALESCE(sum(t.worker_payable_effect_base) FILTER (WHERE t.status='active'),0)::text AS worker_payable_base",
 "COALESCE(sum(t.amount_base) FILTER (WHERE t.status='active' AND t.operation_type IN ('WORKER_PAYMENT','WORKER_ACCRUAL_PAYMENT')),0)::text AS worker_paid_base",
 "COALESCE(sum(t.amount_base) FILTER (WHERE t.status='active' AND t.operation_type='OWNER_TRANSFER'),0)::text AS owner_transfer_base"
];
const joins=' LEFT JOIN public.mvp_orders o ON o.id=t.work_order_id'+
 ' LEFT JOIN public.mvp_objects obj ON obj.id=t.object_id'+
 ' LEFT JOIN public.mvp_workers w ON w.id=t.worker_id';
function listSql(where,extra){
 return 'SELECT t.finance_transaction_id::text AS id,t.transaction_date_key::text AS date,'+
  't.operation_type AS type,t.status,t.revision,t.amount_base::text AS amount_base,'+
  't.cash_effect_base::text AS cash_effect_base,t.normalized,t.created_at::text AS at,'+
  't.work_order_id::text AS order_id,t.object_id::text AS object_id,t.worker_id::text AS worker_id,'+
  'o.title AS order_title,obj.name AS object_title,w.name AS worker_name '+
  'FROM mvp_finance_native.transactions t'+joins+' WHERE '+where+extra+
  ' ORDER BY t.created_at DESC,t.finance_transaction_id DESC LIMIT $';
}
/** B18 checks opening, archived count, eight funds and signed single-writer fence. */
export async function readNativeFinanceHistory(pool,params,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'FINANCE_P1_OWNER_REQUIRED');
 const {filters,limit,filterKey,cursor}=parseNativeFinanceHistoryFilters(params);
 if(!pool||typeof pool.connect!=='function')fail(503,'FINANCE_P1_DB_UNAVAILABLE');
 const gate=await readNativeFinanceWorkspace(pool,{authorizeOwner});
 if(gate.version!=='FINANCE_B18_NATIVE_WORKSPACE_V1'||gate.source!=='CLEAN_NATIVE_POST_CUTOVER_ONLY'||
    gate.authority!=='POSTGRES'||gate.phase!=='ACTIVE'||gate.postingEnabled!==true||
    gate.historicalArchiveImmutable!==true||gate.ledger?.isCurrentFinanceBalance!==true)
  fail(503,'FINANCE_P1_SOURCE_NOT_ATTESTED');
 const db=await pool.connect();let begun=false;
 try{
  await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
  const scoped=whereFor(filters),history=whereFor(filters,{history:true});
  const summaryRes=await db.query(
   'SELECT count(*)::int AS total_count,count(*) FILTER (WHERE t.status=\'active\')::int AS active_count,'+
   sums.join(',')+' FROM mvp_finance_native.transactions t WHERE '+scoped.sql,scoped.args);
  const raw=summaryRes.rows?.[0];
  if(!raw||!Number.isSafeInteger(raw.total_count)||!Number.isSafeInteger(raw.active_count))
   fail(503,'FINANCE_P1_SUMMARY_UNAVAILABLE');
  const summary={};
  for(const field of FIELDS)
   summary[field]=money(raw[field.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())]);
  const args=history.args.slice();
  args.push(cursor?.at||null);const atParam='$'+args.length;
  args.push(cursor?.id||null);const idParam='$'+args.length;
  args.push(limit+1);const countParam=args.length;
  const extra=' AND ('+atParam+'::timestamptz IS NULL OR '+
   '(t.created_at,t.finance_transaction_id)<('+atParam+'::timestamptz,'+idParam+'::uuid))';
  const rows=(await db.query(listSql(history.sql,extra)+countParam,args)).rows||[];
  const shown=rows.slice(0,limit),hasMore=rows.length>limit;
  const items=shown.map(r=>{
   if(!UUID.test(r.id)||!['active','archived'].includes(r.status)||
      !Number.isFinite(Date.parse(String(r.at))))fail(503,'FINANCE_P1_INVALID_HISTORY_ROW');
   return {id:r.id,date:String(r.date),type:r.type,status:r.status,revision:r.revision,
    amountBase:money(r.amount_base),cashEffectBase:money(r.cash_effect_base),
    category:String(r.normalized?.category||''),notes:String(r.normalized?.notes||'').slice(0,5000),
    currency:String(r.normalized?.currencyOriginal||'AMD'),
    amountOriginal:String(r.normalized?.amountOriginal??r.amount_base),
    workOrderId:r.order_id||'',objectId:r.object_id||'',workerId:r.worker_id||'',
    orderTitle:r.order_title||'',objectTitle:r.object_title||'',workerName:r.worker_name||'',
    createdAt:String(r.at)};
  });
  const last=shown[shown.length-1];
  const nextCursor=hasMore&&last?Buffer.from(JSON.stringify({
   k:filterKey,id:last.id,at:String(last.at)
  })).toString('base64url'):null;
  const [ledger,ord,obj,wrk]=await Promise.all([
   db.query('SELECT opening_cash_base::text,current_cash_balance_base::text FROM mvp_finance_native.v_cash_ledger'),
   db.query('SELECT id::text,title FROM public.mvp_orders ORDER BY created_at DESC,id DESC LIMIT 201'),
   db.query('SELECT id::text,name FROM public.mvp_objects ORDER BY created_at DESC,id DESC LIMIT 201'),
   db.query('SELECT id::text,name FROM public.mvp_workers ORDER BY created_at DESC,id DESC LIMIT 201')
  ]);
  if(ledger.rows?.length!==1)fail(503,'FINANCE_P1_LEDGER_UNAVAILABLE');
  const references={orders:(ord.rows||[]).slice(0,200),objects:(obj.rows||[]).slice(0,200),
   workers:(wrk.rows||[]).slice(0,200)};
  return Object.freeze({version:'FINANCE_P1_NATIVE_READ_V1',source:'CLEAN_NATIVE_FINANCE_ONLY',
   readonly:true,historicalIncluded:false,filters,summary,
   scopeLabel:filters.workOrderId?'ORDER':filters.objectId?'OBJECT':filters.workerId?'WORKER':'GLOBAL',
   totalCount:raw.total_count,activeCount:raw.active_count,
   ledger:{openingCashBase:money(ledger.rows[0].opening_cash_base),
    currentCashBase:money(ledger.rows[0].current_cash_balance_base)},
   items,hasMore,nextCursor,references,
   referenceListsTruncated:{orders:ord.rows.length>200,objects:obj.rows.length>200,workers:wrk.rows.length>200}});
 }catch(error){throw error;}
 finally{
  if(begun)await db.query('ROLLBACK').catch(()=>{});
  db.release();
 }
}
