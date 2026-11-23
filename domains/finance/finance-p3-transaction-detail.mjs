/**
 * Finance P3 — one canonical native transaction read for editing.
 * No money writes. B18's signed source check is mandatory before the detail read.
 * Historical Google FinanceTransaction and legacy identifiers are never eligible.
 */
import {readNativeFinanceWorkspace} from './native-finance-workspace-read.mjs';
export class NativeFinanceTransactionDetailError extends Error {
 constructor(status,code){super(code);this.name='NativeFinanceTransactionDetailError';this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new NativeFinanceTransactionDetailError(status,code);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY=/^-?(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/;
const types=new Set(['INCOME','EXPENSE','WORKER_ACCRUAL','WORKER_PAYMENT','WORKER_ACCRUAL_PAYMENT','OWNER_TRANSFER']);
function micro(x){
 const s=String(x??'');
 if(!MONEY.test(s))fail(503,'FINANCE_P3_SOURCE_MONEY_INVALID');
 const neg=s.startsWith('-'),[a,b='']=(neg?s.slice(1):s).split('.');
 const n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));
 return neg?-n:n;
}
function same(x,y){return micro(x)===micro(y);}
export async function readNativeFinanceTransactionDetail(pool,id,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'FINANCE_P3_OWNER_REQUIRED');
 if(typeof id!=='string'||!UUID.test(id))fail(400,'FINANCE_P3_NATIVE_UUID_REQUIRED');
 const gate=await readNativeFinanceWorkspace(pool,{authorizeOwner});
 if(gate.version!=='FINANCE_B18_NATIVE_WORKSPACE_V1'||
    gate.source!=='CLEAN_NATIVE_POST_CUTOVER_ONLY'||
    gate.historicalArchiveImmutable!==true||gate.postingEnabled!==true||
    gate.authority!=='POSTGRES'||gate.phase!=='ACTIVE')
  fail(503,'FINANCE_P3_SIGNED_SOURCE_UNAVAILABLE');
 const client=await pool.connect();let begun=false;
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');begun=true;
  const rows=(await client.query(
   'SELECT t.finance_transaction_id::text AS id,t.source_system,t.transaction_date_key::text AS date,'+
   't.status,t.revision,t.operation_type,t.normalized,t.client_id::text AS client_id,'+
   't.object_id::text AS object_id,t.work_order_id::text AS work_order_id,'+
   't.worker_id::text AS worker_id,t.amount_base::text AS amount_base,'+
   't.commission_base::text AS commission_base,t.cash_effect_base::text AS cash_effect_base,'+
   't.profit_effect_base::text AS profit_effect_base,'+
   't.worker_payable_effect_base::text AS payable_effect_base,'+
   'EXISTS(SELECT 1 FROM mvp_finance_native.fincap_batches b '+
   'WHERE b.finance_transaction_id=t.finance_transaction_id) AS linked_fincap '+
   'FROM mvp_finance_native.transactions t WHERE t.finance_transaction_id=$1',[id])).rows;
  if(rows.length!==1)fail(404,'FINANCE_P3_NATIVE_RECORD_NOT_FOUND');
  const r=rows[0],n=r.normalized;
  if(r.source_system!=='CLEAN_NATIVE_FINANCE'||!n||typeof n!=='object'||Array.isArray(n)||
     !['active','archived'].includes(r.status)||!Number.isSafeInteger(r.revision)||r.revision<1||
     !types.has(r.operation_type)||n.operationType!==r.operation_type||
     n.transactionDateKey!==r.date||
     !same(n.amountBase,r.amount_base)||!same(n.commissionBase,r.commission_base)||
     !same(n.cashEffectBase,r.cash_effect_base)||
     !same(n.profitEffectBase,r.profit_effect_base)||
     !same(n.workerPayableEffectBase,r.payable_effect_base)||
     (n.clientId||null)!==(r.client_id||null)||
     (n.objectId||null)!==(r.object_id||null)||
     (n.workOrderId||null)!==(r.work_order_id||null)||
     (n.workerId||null)!==(r.worker_id||null))
   fail(503,'FINANCE_P3_NATIVE_SOURCE_DRIFT');
  const links=['client_id','object_id','work_order_id','worker_id'];
  if(links.some(k=>r[k]!==null&&!UUID.test(r[k]))||
     !['AMD','USD','EUR'].includes(n.currencyOriginal)||
     !Number.isFinite(Number(n.amountOriginal))||Number(n.amountOriginal)<=0)
   fail(503,'FINANCE_P3_SOURCE_FORMAT_INVALID');
  const locked=Boolean(r.linked_fincap)||
   (r.operation_type==='OWNER_TRANSFER'&&n.ownerDirection==='investments');
  const record={
   id:r.id,revision:r.revision,date:r.date,status:r.status,operationType:r.operation_type,
   category:String(n.category||''),incomeRecognition:String(n.incomeRecognition||''),
   ownerDirection:String(n.ownerDirection||''),currencyOriginal:n.currencyOriginal,
   amountOriginal:String(n.amountOriginal),amountBase:r.amount_base,
   fxRate:String(n.fxRate??'1'),fxRateDate:String(n.fxRateDate||r.date),
   commissionOriginal:String(n.commissionOriginal??'0'),
   counterparty:String(n.counterparty||''),notes:String(n.notes||''),
   workOrderId:r.work_order_id||'',objectId:r.object_id||'',clientId:r.client_id||'',
   workerId:r.worker_id||'',linkedFinCap:Boolean(r.linked_fincap),
   editable:r.status==='active'&&!locked,
   cancellable:r.status==='active'&&!locked,
   restorable:r.status==='archived'&&!locked
  };
  await client.query('COMMIT');begun=false;
  return Object.freeze({
   version:'FINANCE_P3_NATIVE_DETAIL_V1',source:'CLEAN_NATIVE_FINANCE_ONLY',
   readonly:true,historicalIncluded:false,postingEnabled:true,record:Object.freeze(record)
  });
 }catch(error){
  if(begun)await client.query('ROLLBACK').catch(()=>{});
  if(['42P01','3F000','42501'].includes(error?.code))
   fail(503,'FINANCE_P3_SOURCE_UNAVAILABLE');
  throw error;
 }finally{client.release();}
}
