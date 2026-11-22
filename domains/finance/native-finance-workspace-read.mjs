/**
 * Finance B18 — owner-only read-only list of post-cutover PostgreSQL entries.
 * Historical Google finance stays immutable and separate.
 * This module never authorizes writes; B17 checks authority again under lock.
 */
import {hostedFinancePostingReadiness} from './native-finance-writer.mjs';
export class NativeFinanceWorkspaceError extends Error {
 constructor(status,code){super(code);this.name='NativeFinanceWorkspaceError';this.status=status;this.code=code;}
}
const fail=(code,status=503)=>{throw new NativeFinanceWorkspaceError(status,code);};
const SNAP='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const SHA='8bdfd30faa9e45785f928c2861d7e3645a9dd168bb6d678004c0df730a04871d';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY=/^-?(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/;
function micros(s){
 const v=String(s??'');
 if(!MONEY.test(v))fail('B18_INVALID_MONEY');
 const neg=v.startsWith('-'),[whole,frac='']=(neg?v.slice(1):v).split('.');
 const n=BigInt(whole)*1000000n+BigInt(frac.padEnd(6,'0'));
 return neg?-n:n;
}
export function validateNativeWorkspaceSource({opening,archiveCount,funds}={}){
 if(!opening||opening.source_snapshot_id!==SNAP||opening.manifest_sha256!==SHA||
    opening.as_of_date!=='2026-09-30'||
    micros(opening.opening_cash_base)!==203000000000n||
    micros(opening.opening_profit_base)!==588000000000n||
    micros(opening.opening_worker_payable_base)!==0n)
  fail('B18_OPENING_STOCK_DRIFT');
 if(Number(archiveCount)!==24||!Array.isArray(funds)||funds.length!==8)
  fail('B18_SOURCE_COUNTS_DRIFT');
 const ids=new Set(),codes=new Set();
 let total=0n;
 for(const f of funds){
  if(!UUID.test(f.fund_id)||ids.has(f.fund_id)||
     !/^FND-2026-000[1-8]$/.test(String(f.legacy_source_id))||
     typeof f.code!=='string'||codes.has(f.code)||
     !/^[A-Z_]{3,100}$/.test(f.code))
   fail('B18_FUND_MAPPING_DRIFT');
  ids.add(f.fund_id);codes.add(f.code);
  if(micros(f.opening_balance_base)<0n||micros(f.current_balance_base)<0n)
   fail('B18_NEGATIVE_FUND_BALANCE');
  total+=micros(f.opening_balance_base);
 }
 if(total!==10000000000n)fail('B18_FUND_OPENING_DRIFT');
 return true;
}
export async function readNativeFinanceWorkspace(pool,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail('B18_OWNER_REQUIRED',401);
 if(!pool||typeof pool.connect!=='function')fail('B18_DATABASE_UNAVAILABLE');
 const c=await pool.connect();
 try{
  await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const g=(await c.query(
   'SELECT phase,financial_write_authority,google_frozen_confirmed,'+
   'owner_identity_approved,cutover_date_key,snapshot_id,manifest_sha256,'+
   'crm_bridge_sha256,expected_fund_count FROM mvp_finance_native.cutover_control WHERE id=1')).rows[0];
  if(!g)fail('B18_CONTROL_MISSING');
  const opening=(await c.query(
   'SELECT source_snapshot_id,manifest_sha256,as_of_date::text,opening_cash_base::text,'+
   'opening_profit_base::text,opening_worker_payable_base::text '+
   'FROM mvp_finance_native.opening_snapshot WHERE id=1')).rows[0];
  const archive=(await c.query(
   "SELECT count(*)::int AS n FROM mvp_history.source_records WHERE source_kind='FINANCE_TRANSACTION'")).rows[0];
  const funds=(await c.query(
   'SELECT f.fund_id,f.legacy_source_id,f.code,f.status,fo.opening_balance_base::text,'+
   'v.current_balance_base::text FROM mvp_finance_native.funds f '+
   'JOIN mvp_finance_native.fund_openings fo ON fo.fund_id=f.fund_id '+
   'JOIN mvp_finance_native.v_fund_balances v ON v.fund_id=f.fund_id '+
   'ORDER BY f.legacy_source_id')).rows;
  validateNativeWorkspaceSource({opening,archiveCount:archive?.n,funds});
  const ledger=(await c.query(
   'SELECT opening_cash_base::text,current_cash_balance_base::text,'+
   'opening_profit_base::text,native_profit_delta_base::text,'+
   'opening_worker_payable_base::text,native_worker_payable_delta_base::text '+
   'FROM mvp_finance_native.v_cash_ledger')).rows[0];
  if(!ledger||micros(ledger.opening_cash_base)!==203000000000n||
     micros(ledger.opening_profit_base)!==588000000000n||
     micros(ledger.opening_worker_payable_base)!==0n)
   fail('B18_LEDGER_SOURCE_DRIFT');
  const entries=(await c.query(
   'SELECT finance_transaction_id::text,transaction_date_key::text,'+
   'operation_type,status,revision,amount_base::text,cash_effect_base::text,'+
   'profit_effect_base::text,worker_payable_effect_base::text,normalized '+
   'FROM mvp_finance_native.transactions ORDER BY created_at DESC,finance_transaction_id DESC LIMIT 100')).rows;
  const movements=(await c.query(
   'SELECT movement_id::text,movement_type,transaction_date_key::text,'+
   'from_fund_id::text,to_fund_id::text,amount_base::text,status '+
   'FROM mvp_finance_native.fund_movements '+
   'ORDER BY created_at DESC,movement_id DESC LIMIT 50')).rows;
  const orders=(await c.query(
   'SELECT o.id::text AS id,o.title,o.status,obj.name AS object_title '+
   'FROM public.mvp_orders o JOIN public.mvp_objects obj ON obj.id=o.object_id '+
   'ORDER BY o.created_at DESC,o.id DESC LIMIT 201')).rows;
  const count=(await c.query(
   'SELECT (SELECT count(*)::int FROM mvp_finance_native.transactions) AS tx,'+
   '(SELECT count(*)::int FROM mvp_finance_native.fund_movements) AS movements')).rows[0];
  const check=await hostedFinancePostingReadiness(pool,c,g);
  await c.query('COMMIT');
  return Object.freeze({
   version:'FINANCE_B18_NATIVE_WORKSPACE_V1',source:'CLEAN_NATIVE_POST_CUTOVER_ONLY',
   historicalArchiveImmutable:true,asOfOpening:'2026-09-30',
   phase:String(g.phase),authority:String(g.financial_write_authority),
   postingEnabled:check.ready===true,reason:check.reason,
   ledger:{
    openingCashAMD:ledger.opening_cash_base,currentCashAMD:ledger.current_cash_balance_base,
    openingProfitAMD:ledger.opening_profit_base,nativeProfitDeltaAMD:ledger.native_profit_delta_base,
    openingPayableAMD:ledger.opening_worker_payable_base,nativePayableDeltaAMD:ledger.native_worker_payable_delta_base,
    isCurrentFinanceBalance:check.ready===true
   },
   funds:funds.map(f=>({id:f.fund_id,legacyId:f.legacy_source_id,code:f.code,
    status:f.status,openingBalanceAMD:f.opening_balance_base,balanceAMD:f.current_balance_base})),
   entries:entries.map(t=>({
    id:t.finance_transaction_id,date:t.transaction_date_key,
    operationType:t.operation_type,status:t.status,revision:t.revision,
    amountAMD:t.amount_base,cashEffectAMD:t.cash_effect_base,
    profitEffectAMD:t.profit_effect_base,
    workerPayableEffectAMD:t.worker_payable_effect_base,
    category:String(t.normalized?.category||''),
    incomeRecognition:String(t.normalized?.incomeRecognition||''),
    amountOriginal:String(t.normalized?.amountOriginal??t.amount_base),
    currencyOriginal:String(t.normalized?.currencyOriginal||'AMD'),
    notes:String(t.normalized?.notes||''),
    workOrderId:String(t.normalized?.workOrderId||''),
    linkedToLegacy:false
   })),
   movements:movements.map(m=>({
    id:m.movement_id,type:m.movement_type,date:m.transaction_date_key,
    fromFundId:m.from_fund_id,toFundId:m.to_fund_id,
    amountAMD:m.amount_base,status:m.status
   })),
   orders:orders.slice(0,200).map(o=>({id:o.id,title:String(o.title),
    objectTitle:String(o.object_title),status:String(o.status)})),
   orderListComplete:orders.length<=200,
   counts:{transactions:count.tx,movements:count.movements},
   truncated:count.tx>100||count.movements>50
  });
 }catch(e){
  await c.query('ROLLBACK').catch(()=>{});
  if(e?.code==='42P01'||e?.code==='3F000')fail('B18_SOURCE_SCHEMA_UNAVAILABLE');
  throw e;
 }finally{c.release();}
}
