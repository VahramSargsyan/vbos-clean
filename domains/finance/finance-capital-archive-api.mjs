/**
 * Finance/Capital archive reader for the EXISTING Clean app, not F2.
 * Source is immutable Neon TEST stage, not current operational finance.
 * All queries are read-only and owner session required.
 */
export class FinanceCapitalArchiveError extends Error {
 constructor(status,code){super(code);this.status=status;this.code=code;}
}
const SNAP='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const BATCH='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const EXPECTED=Object.freeze({FINANCE_TRANSACTION:24,BUSINESS_MONTHLY_GAIN:3,CAPITAL_FUND:8,
 CAPITAL_ALLOCATION_BATCH:1,CAPITAL_FUND_TRANSACTION:6,FINANCE_BALANCE:30,CAPITAL_FUND_BALANCE:8});
const FACT_KINDS=new Set(['BUSINESS_MONTHLY_GAIN','CAPITAL_FUND','CAPITAL_ALLOCATION_BATCH','CAPITAL_FUND_TRANSACTION']);
const CONTROL_KINDS=new Set(['FINANCE_BALANCE','CAPITAL_FUND_BALANCE']);
const fail=(status,code)=>{throw new FinanceCapitalArchiveError(status,code);};
function micro(value,label){
 const raw=String(value??'');
 if(!/^-?(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(raw))fail(503,'INVALID_SOURCE_MONEY_'+label);
 const neg=raw.startsWith('-'),[whole,frac='']=(neg?raw.slice(1):raw).split('.');
 const n=BigInt(whole)*1000000n+BigInt(frac.padEnd(6,'0'));
 return neg?-n:n;
}
function decimal(v){const neg=v<0n,n=neg?-v:v;return (neg?'-':'')+String(n/1000000n)+'.'+String(n%1000000n).padStart(6,'0');}
const money=(obj,k)=>decimal(micro(obj?.[k],k));
function checkRows(rows,total,kinds){
 if(!Array.isArray(rows)||rows.length!==total)fail(503,'SOURCE_ROW_COUNT_INVALID');
 const unique=new Set();
 for(const row of rows){
  if(!kinds.has(row.source_kind)||row.sha_valid!==true||typeof row.source_id!=='string'||!row.source_id||
     !row.source_payload||typeof row.source_payload!=='object'||Array.isArray(row.source_payload))
     fail(503,'SOURCE_SHA_OR_PAYLOAD_INVALID');
  const key=row.source_kind+':'+row.source_id;
  if(unique.has(key))fail(503,'SOURCE_DUPLICATE_ID');
  unique.add(key);
 }
}
export async function financeCapitalArchiveRead(db,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)fail(401,'OWNER_SESSION_REQUIRED');
 if(!db||typeof db.query!=='function')fail(503,'ARCHIVE_DB_UNAVAILABLE');
 const m=(await db.query(
  'SELECT snapshot_id,history_batch_id,source_system,google_modified_at,expected_counts,financial_write_authority,owner_identity_approved FROM mvp_finance_stage.freeze_manifests WHERE snapshot_id=$1',
  [SNAP])).rows||[];
 if(m.length!==1)fail(503,'ARCHIVE_MANIFEST_MISSING');
 const man=m[0],e=man.expected_counts||{};
 if(man.snapshot_id!==SNAP||man.history_batch_id!==BATCH||man.source_system!=='LEGACY_GOOGLE'||
  man.financial_write_authority!=='GOOGLE'||man.owner_identity_approved!==false||
  Object.entries(EXPECTED).some(([k,n])=>Number(e[k])!==n))fail(503,'ARCHIVE_MANIFEST_UNVERIFIED');
 const facts=(await db.query(
  "SELECT source_kind,source_id,source_payload,payload_sha256=encode(sha256(convert_to(source_payload::text,'UTF8')),'hex') AS sha_valid FROM mvp_finance_stage.source_facts WHERE snapshot_id=$1 ORDER BY source_kind,source_id",
  [SNAP])).rows||[];
 const controls=(await db.query(
  "SELECT source_kind,source_id,source_payload,payload_sha256=encode(sha256(convert_to(source_payload::text,'UTF8')),'hex') AS sha_valid FROM mvp_finance_stage.control_snapshots WHERE snapshot_id=$1 ORDER BY source_kind,source_id",
  [SNAP])).rows||[];
 checkRows(facts,18,FACT_KINDS);checkRows(controls,38,CONTROL_KINDS);
 for(const kind of FACT_KINDS)if(facts.filter(x=>x.source_kind===kind).length!==EXPECTED[kind])fail(503,'FACT_KIND_COUNT_'+kind);
 for(const kind of CONTROL_KINDS)if(controls.filter(x=>x.source_kind===kind).length!==EXPECTED[kind])fail(503,'CONTROL_KIND_COUNT_'+kind);
 const h=(await db.query(
  "SELECT COUNT(*)::int AS total,COALESCE(SUM((source_payload->>'cashEffectBase')::numeric) FILTER (WHERE source_payload->>'status'='active'),0)::text AS cash,COALESCE(SUM((source_payload->>'profitEffectBase')::numeric) FILTER (WHERE source_payload->>'status'='active'),0)::text AS profit,COALESCE(SUM((source_payload->>'workerPayableEffectBase')::numeric) FILTER (WHERE source_payload->>'status'='active'),0)::text AS worker_payable FROM mvp_history.source_records WHERE source_kind='FINANCE_TRANSACTION' AND source_system='LEGACY_GOOGLE' AND import_batch_id=$1",
  [BATCH])).rows?.[0];
 if(!h||Number(h.total)!==24)fail(503,'FINANCE_HISTORY_INCOMPLETE');
 const matches=controls.filter(r=>r.source_kind==='FINANCE_BALANCE'&&r.source_id==='GLOBAL|ALL');
 if(matches.length!==1)fail(503,'GLOBAL_CONTROL_NOT_UNIQUE');
 const global=matches[0].source_payload;
 for(const [k,v] of [['cash','cashBalanceBase'],['profit','profitBase'],['worker_payable','workerPayableBase']])
  if(micro(h[k],k)!==micro(global[v],v))fail(503,'GLOBAL_LEDGER_MISMATCH');
 const funds=facts.filter(r=>r.source_kind==='CAPITAL_FUND').map(r=>r.source_payload);
 const balances=new Map(controls.filter(r=>r.source_kind==='CAPITAL_FUND_BALANCE').map(r=>[r.source_id,r.source_payload]));
 const known=new Set(funds.map(r=>r.fundId));
 if(known.size!==8||balances.size!==8||[...balances.keys()].some(k=>!known.has(k)))fail(503,'FUND_LINKS_INVALID');
 const batch=facts.find(r=>r.source_kind==='CAPITAL_ALLOCATION_BATCH').source_payload;
 let lines;
 try{lines=typeof batch.allocationsJson==='string'?JSON.parse(batch.allocationsJson):batch.allocationsJson;}
 catch{fail(503,'ALLOCATION_JSON_INVALID');}
 if(!Array.isArray(lines)||lines.length!==6)fail(503,'ALLOCATION_LINES_INVALID');
 const sums=new Map(funds.map(r=>[r.fundId,0n])),movements=new Map(funds.map(r=>[r.fundId,0n]));
 let allocated=0n;
 for(const line of lines){
  if(!known.has(line.fundId))fail(503,'ALLOCATION_PARENT_MISSING');
  const n=micro(line.amountBase,'allocation');if(n<=0n)fail(503,'ALLOCATION_AMOUNT_INVALID');
  allocated+=n;sums.set(line.fundId,sums.get(line.fundId)+n);
 }
 if(allocated!==micro(batch.totalAmountBase,'batch_amount'))fail(503,'ALLOCATION_TOTAL_MISMATCH');
 const moves=facts.filter(r=>r.source_kind==='CAPITAL_FUND_TRANSACTION').map(r=>r.source_payload);
 for(const r of moves){
  if(r.movementType!=='ALLOCATION'||r.allocationBatchId!==batch.allocationBatchId||
   !known.has(r.toFundId)||r.fromFundId)fail(503,'MOVEMENT_RELATION_INVALID');
  movements.set(r.toFundId,movements.get(r.toFundId)+micro(r.amountBase,'movement_amount'));
 }
 for(const [fundId,n] of sums)if(n!==movements.get(fundId)||n!==micro(balances.get(fundId).balanceBase,'fund_balance'))
  fail(503,'FUND_BALANCE_MISMATCH');
 const months=facts.filter(r=>r.source_kind==='BUSINESS_MONTHLY_GAIN').map(r=>r.source_payload);
 const monthlyParts=['referralCommissionBase','purchaseCommissionBase','organizationMarginBase',
  'taxOptimizationSavingsBase','otherBusinessIncomeBase'];
 for(const x of months)if(monthlyParts.reduce((sum,k)=>sum+micro(x[k],k),0n)!==micro(x.totalBusinessGainsBase,'monthly_total'))
  fail(503,'MONTHLY_SOURCE_TOTAL_MISMATCH');
 // Whitelist only. No full finance payloads, notes, personal identifiers or secret hashes to the browser.
 return Object.freeze({
  source:'VERIFIED_LEGACY_FINANCE_CAPITAL_CLEAN_TEST',readonly:true,financialWriter:'GOOGLE',
  currentOperationalFinance:false,sourceModifiedAt:man.google_modified_at,
  counts:{financeTransactions:24,monthlyGains:3,funds:8,allocationBatches:1,fundMovements:6,controlSnapshots:38},
  finance:{currency:'AMD',cashBalanceBase:money(global,'cashBalanceBase'),profitBase:money(global,'profitBase'),
   earnedBase:money(global,'earnedBase'),receivedBase:money(global,'receivedBase'),
   workerPayableBase:money(global,'workerPayableBase'),
   economicExpenseBase:money(global,'economicExpenseBase'),workerPaidBase:money(global,'workerPaidBase'),
   ownerTransferBase:money(global,'ownerTransferBase')},
  months:months.map(r=>({
    monthKey:r.monthKey,status:r.status,totalBusinessGainsBase:money(r,'totalBusinessGainsBase'),
    ...Object.fromEntries(monthlyParts.map(k=>[k,money(r,k)]))
   })).sort((a,b)=>b.monthKey.localeCompare(a.monthKey)),
  capital:{currency:'AMD',allocatedBase:decimal(allocated),allocationLines:6,
   funds:funds.map(r=>({fundId:r.fundId,code:r.code||'',name:r.name||'',groupType:r.groupType||'',
    status:r.status||'',targetAmountBase:money(r,'targetAmountBase'),
    allocationSharePct:r.allocationSharePct??null,balanceBase:money(balances.get(r.fundId),'balanceBase')}))
    .sort((a,b)=>String(a.code).localeCompare(String(b.code))),
   movements:moves.map(r=>({fundTransactionId:r.fundTransactionId,movementType:r.movementType,
     toFundId:r.toFundId,status:r.status||'',amountBase:money(r,'amountBase')}))}
 });
}
