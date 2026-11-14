/**
 * Finance B11 — owner-authenticated source gateway + non-duplicating ledger preview.
 *
 * This file DOES NOT mount routes in server.mjs. Future integration must inject
 * existing VBOS owner-session verification, same-origin check AND dedicated
 * CSRF verification. POST is synthetic-only and B10 rejects non-local pools.
 *
 * Historical source: immutable, SHA-verified Finance/Capital archive reader.
 * New source: B9 private PostgreSQL native opening + post-cutover deltas.
 * Do not add historical balances to native opening balances a second time.
 */
import {financeCapitalArchiveRead} from './finance-capital-archive-api.mjs';
import {postNativeFinanceCapital} from './native-finance-writer.mjs';

export class FinanceOwnerGatewayError extends Error{
 constructor(status,code){super(code);this.name='FinanceOwnerGatewayError';
  this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new FinanceOwnerGatewayError(status,code);};
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const LEGACY='VERIFIED_LEGACY_FINANCE_CAPITAL_CLEAN_TEST';
const SNAP='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const MONEY=/^-?(0|[1-9]\d{0,12})(?:\.\d{1,6})?$/;
const MICRO=1000000n;
const VALID_DAY=/^\d{4}-\d{2}-\d{2}$/;
const isDay=v=>typeof v==='string'&&VALID_DAY.test(v)&&
 !Number.isNaN(Date.parse(v+'T00:00:00.000Z'))&&
 new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)===v;
function micro(v,label){
 const value=String(v??'');
 if(!MONEY.test(value))fail(503,'B11_INVALID_SOURCE_MONEY_'+label);
 const neg=value.startsWith('-'),parts=(neg?value.slice(1):value).split('.');
 const n=BigInt(parts[0])*MICRO+BigInt((parts[1]||'').padEnd(6,'0'));
 return neg?-n:n;
}
function decimal(n){
 const absolute=n<0n?-n:n;
 return (n<0n?'-':'')+String(absolute/MICRO)+'.'+
  String(absolute%MICRO).padStart(6,'0');
}
function canonicalMoney(v,label){return decimal(micro(v,label));}
const sha=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const date=v=>v instanceof Date?v.toISOString().slice(0,10):String(v??'');
function readonlyArchive(archive){
 if(!obj(archive)||archive.source!==LEGACY||archive.readonly!==true||
    archive.counts?.financeTransactions!==24||archive.counts?.funds!==8||
    archive.counts?.controlSnapshots!==38||archive.counts?.fundMovements!==6||
    archive.counts?.monthlyGains!==3||archive.counts?.allocationBatches!==1||
    !obj(archive.finance)||archive.finance.currency!=='AMD'||
    !obj(archive.capital)||!Array.isArray(archive.capital.funds)||
    archive.capital.funds.length!==8)
  fail(503,'B11_LEGACY_ARCHIVE_UNVERIFIED');
 const seen=new Set();
 const fundBalances=archive.capital.funds.map(f=>{
  if(typeof f.fundId!=='string'||!f.fundId||seen.has(f.fundId))
   fail(503,'B11_LEGACY_FUND_DUPLICATE');
  seen.add(f.fundId);
  return Object.freeze({legacySourceId:f.fundId,code:String(f.code),
   balanceBase:canonicalMoney(f.balanceBase,'historic_fund_balance')});
 });
 return Object.freeze({
  sourceSystem:'LEGACY_GOOGLE',snapshotId:SNAP,readonly:true,
  // Source timestamp describes the underlying Google material, NOT a
  // certified as-of date or an approved finance migration checkpoint.
  sourceModifiedAt:archive.sourceModifiedAt instanceof Date?
   archive.sourceModifiedAt.toISOString():
   (typeof archive.sourceModifiedAt==='string'?archive.sourceModifiedAt:null),
  counts:Object.freeze({...archive.counts}),
  cashBalanceBase:canonicalMoney(archive.finance.cashBalanceBase,'historic_cash'),
  profitBase:canonicalMoney(archive.finance.profitBase,'historic_profit'),
  workerPayableBase:canonicalMoney(archive.finance.workerPayableBase,'historic_worker_payable'),
  fundBalances:Object.freeze(fundBalances),
  // Trusted readLegacy may attach this in isolated fixture tests. The real
  // archive has no attested as-of-day, so live consolidation remains CLOSED.
  attestedAsOfDate:archive.attestedAsOfDate??null,
  attestedManifestSha256:archive.attestedManifestSha256??null
 });
}
function readProof(history,control,opening,fundRows){
 const why=[];
 if(history.snapshotId!==control.snapshot_id||
    history.snapshotId!==opening.source_snapshot_id)why.push('SOURCE_ID');
 if(!sha(control.manifest_sha256)||
    control.manifest_sha256!==opening.manifest_sha256||
    control.manifest_sha256!==history.attestedManifestSha256)why.push('SOURCE_CHECKSUM');
 const cutover=date(control.cutover_date_key),asOf=date(opening.as_of_date);
 if(!isDay(cutover)||!isDay(asOf)||
    new Date(asOf+'T00:00:00Z').getTime()+86400000!==
    new Date(cutover+'T00:00:00Z').getTime()||
    history.attestedAsOfDate!==asOf)why.push('AS_OF_CUTOVER');
 if(micro(opening.opening_cash_base,'opening_cash')!==
    micro(history.cashBalanceBase,'historical_cash'))why.push('OPENING_CASH');
 if(micro(opening.opening_profit_base,'opening_profit')!==
    micro(history.profitBase,'historical_profit'))why.push('OPENING_PROFIT');
 if(micro(opening.opening_worker_payable_base,'opening_payable')!==
    micro(history.workerPayableBase,'historical_payable'))why.push('OPENING_PAYABLE');
 const expected=new Map(history.fundBalances.map(f=>[f.legacySourceId,f]));
 const seen=new Set();
 if(fundRows.length!==8)why.push('FUND_COUNT');
 for(const row of fundRows){
  const id=row.legacy_source_id;
  if(typeof id!=='string'||!expected.has(id)||seen.has(id)){
   why.push('FUND_MAPPING');continue;
  }
  seen.add(id);
  if(String(row.code)!==expected.get(id).code||
     micro(row.opening_balance_base,'opening_fund')!==
     micro(expected.get(id).balanceBase,'history_fund'))
   why.push('FUND_OPENING');
 }
 if(seen.size!==8)why.push('FUND_MAPPING');
 if(control.owner_identity_approved!==true||control.google_frozen_confirmed!==true||
    !sha(control.crm_bridge_sha256))why.push('OWNER_CRM_FREEZE_GATE');
 return Object.freeze([...new Set(why)]);
}
/**
 * Returns a unified provenance-aware report, but one cash balance ONLY after
 * exact, independently attested historical-to-opening reconciliation.
 *
 * IMPORTANT: The accepted legacy archive does not attest an as-of-cutover day;
 * B11 deliberately refuses combined totals until a later approved bridge.
 */
export async function readFinanceB11Ledger(db,{
 authorizeOwner,readLegacy=financeCapitalArchiveRead
}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'B11_OWNER_SESSION_REQUIRED');
 if(!db||typeof db.connect!=='function')
  fail(503,'B11_DATABASE_NOT_AVAILABLE');
 const client=await db.connect();
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const result=await readFinanceB11Snapshot(client,readLegacy);
  await client.query('COMMIT');
  return result;
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release();}
}
async function readFinanceB11Snapshot(db,readLegacy){
 const legacy=readonlyArchive(await readLegacy(db,{authorizeOwner:async()=>true}));
 const resultBase={version:'B11_SOURCE_PREVIEW_V1',readonly:true,
  currentOperationalFinance:false,history:legacy,
  formula:'historical_close_as_native_opening_plus_new_native_deltas',
  neverSumLegacyAndNativeOpening:true};
 const found=await db.query(
  "SELECT to_regclass('mvp_finance_native.cutover_control') AS relation");
 if(!found.rows?.[0]?.relation)
  return Object.freeze({...resultBase,phase:'HISTORY_ONLY',native:null,
   combined:null,reason:'NATIVE_SCHEMA_NOT_INSTALLED'});
 const cr=await db.query(
  'SELECT * FROM mvp_finance_native.cutover_control WHERE id=1');
 if(cr.rows?.length!==1)fail(503,'B11_CUTOVER_CONTROL_UNVERIFIED');
 const control=cr.rows[0];
 if(!['BLOCKED','ACTIVE','PAUSED'].includes(control.phase))
  fail(503,'B11_CUTOVER_PHASE_INVALID');
 if(control.phase==='BLOCKED'){
  if(control.financial_write_authority!=='GOOGLE')
   fail(503,'B11_AUTHORITY_STATE_INVALID');
  return Object.freeze({...resultBase,phase:'HISTORY_ONLY',native:null,
   combined:null,reason:'NATIVE_WRITER_NOT_ACTIVATED'});
 }
 if(control.financial_write_authority!=='POSTGRES')
  fail(503,'B11_AUTHORITY_STATE_INVALID');
 // A pg.Client has a single sequential query stream; keep all SELECTs
 // inside the same READ ONLY REPEATABLE READ transaction without concurrency.
 const openingResult=await db.query(
  'SELECT * FROM mvp_finance_native.opening_snapshot WHERE id=1');
 const cashResult=await db.query(
  'SELECT * FROM mvp_finance_native.v_cash_ledger');
 const fundResult=await db.query(
  'SELECT legacy_source_id,code,source_snapshot_id,opening_balance_base,'+
  'native_delta_base,current_balance_base FROM mvp_finance_native.v_fund_balances');
 if(openingResult.rows?.length!==1||cashResult.rows?.length!==1)
  fail(503,'B11_NATIVE_OPENING_INCOMPLETE');
 const opening=openingResult.rows[0],cash=cashResult.rows[0],funds=fundResult.rows||[];
 const nativeCurrentCash=micro(cash.current_cash_balance_base,'native_current_cash');
 const nativeOpeningCash=micro(cash.opening_cash_base,'native_open_cash');
 const nativeDelta=micro(cash.native_cash_delta_base,'native_cash_delta');
 if(nativeOpeningCash!==micro(opening.opening_cash_base,'opening_snapshot_cash')||
    nativeCurrentCash!==nativeOpeningCash+nativeDelta)
  fail(503,'B11_NATIVE_CASH_INCONSISTENT');
 const nativeFundRows=funds.map(f=>{
  const opened=micro(f.opening_balance_base,'fund_open'),
        changed=micro(f.native_delta_base,'fund_delta'),
        current=micro(f.current_balance_base,'fund_current');
  if(opened+changed!==current)
   fail(503,'B11_NATIVE_FUND_INCONSISTENT');
  return Object.freeze({legacySourceId:f.legacy_source_id,
   code:f.code,openingBalanceBase:decimal(opened),
   nativeDeltaBase:decimal(changed),currentBalanceBase:decimal(current),
   sourceSnapshotId:f.source_snapshot_id});
 });
 const reasons=readProof(legacy,control,opening,funds);
 if(nativeFundRows.some(x=>x.sourceSnapshotId!==opening.source_snapshot_id))
  fail(503,'B11_FUND_SNAPSHOT_MISMATCH');
 const native=Object.freeze({
  sourceSystem:'CLEAN_NATIVE_FINANCE',
  cutoverDateKey:date(control.cutover_date_key),
  sourceSnapshotId:control.snapshot_id,
  status:control.phase,
  openingCashBase:decimal(nativeOpeningCash),
  cashDeltaBase:decimal(nativeDelta),
  currentCashBase:decimal(nativeCurrentCash),
  profitDeltaBase:canonicalMoney(cash.native_profit_delta_base,'native_profit_delta'),
  payableDeltaBase:canonicalMoney(cash.native_worker_payable_delta_base,'native_payable_delta'),
  fundBalances:Object.freeze(nativeFundRows)
 });
 if(reasons.length)
  return Object.freeze({...resultBase,phase:'UNRECONCILED',
   native,combined:null,reason:'CUTOVER_BRIDGE_NOT_VERIFIED',
   reconciliationIssues:reasons});
 return Object.freeze({...resultBase,phase:'RECONCILED',
  native,reconciliationIssues:Object.freeze([]),
  // Critically, use the native opening+delta and do NOT add historical cash.
  combined:Object.freeze({
   cashBalanceBase:native.currentCashBase,
   profitBase:decimal(micro(opening.opening_profit_base,'profit_open')+
    micro(native.profitDeltaBase,'profit_delta')),
   workerPayableBase:decimal(micro(opening.opening_worker_payable_base,'pay_open')+
    micro(native.payableDeltaBase,'pay_delta')),
   source:'VERIFIED_NATIVE_OPENING_PLUS_POST_CUTOVER_ONLY'
  })
 });
}
/**
 * Injectable HTTP route contract. Actual server mounting must import these
 * functions and supply its existing authenticated owner session, same-origin
 * check and future dedicated CSRF token. No fake auth callbacks in deployment.
 */
export async function financeB11OwnerGateway({
 method,path,body,db,authorizeOwner,verifyOrigin,verifyCsrf,
 readLegacy=financeCapitalArchiveRead,postWriter=postNativeFinanceCapital
}={}){
 try{
  if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
   fail(401,'B11_OWNER_SESSION_REQUIRED');
  if(method==='GET'&&path==='/api/finance/native-ledger-preview'){
   const result=await readFinanceB11Ledger(db,{
    authorizeOwner:async()=>true,readLegacy});
   return {status:200,headers:{'Cache-Control':'no-store'},body:result};
  }
  if(method==='POST'&&path==='/api/finance/native-action-preview'){
   if(typeof verifyOrigin!=='function'||await verifyOrigin()!==true)
    fail(403,'B11_ORIGIN_REQUIRED');
   if(typeof verifyCsrf!=='function'||await verifyCsrf()!==true)
    fail(403,'B11_CSRF_REQUIRED');
   if(process.env.FINANCE_B11_SYNTHETIC_ONLY!=='1')
    fail(503,'B11_LIVE_FINANCIAL_WRITER_DISABLED');
   if(!obj(body)||Object.keys(body).some(k=>!['action','requestKey','payload'].includes(k)))
    fail(400,'B11_PAYLOAD_INVALID');
   if(typeof postWriter!=='function')fail(503,'B11_WRITER_NOT_CONFIGURED');
   const result=await postWriter(db,{
    action:body.action,requestKey:body.requestKey,payload:body.payload,
    // This is merely a synthetic CI proof. Real owner auth must be linked
    // to a durable owner identity + role, never inferred from this flag.
    context:{syntheticOwnerVerified:true}
   });
   return {status:200,headers:{'Cache-Control':'no-store'},body:result};
  }
  fail(404,'B11_ROUTE_NOT_FOUND');
 }catch(error){
  const safe=error instanceof FinanceOwnerGatewayError?error:
   // Never reflect SQL, credentials or personal data into an HTTP response.
   new FinanceOwnerGatewayError(503,'B11_BACKEND_OPERATION_REJECTED');
  return {status:safe.status,headers:{'Cache-Control':'no-store'},
   body:{error:safe.code}};
 }
}
