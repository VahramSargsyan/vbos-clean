/**
 * Finance B12 — owner-only, read-only evidence checklist for a future cutover.
 *
 * Accepts the already source-verified B11 snapshot. A proposed day is NOT an
 * approved cutover, and the 2026-11-06 archive is NOT an as-of-cutover proof.
 * No database writes, synthetic attestation, migration or writer switch.
 */
export class FinanceB12ReadinessError extends Error{
 constructor(){super('B12_INVALID_DATE');this.code='B12_INVALID_DATE';this.status=400;}
}
const goodDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 !Number.isNaN(Date.parse(x+'T00:00:00Z'))&&
 new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const previousDay=s=>new Date(Date.parse(s+'T00:00:00Z')-86400000).toISOString().slice(0,10);
export function financeB12CutoverReadiness(ledger,{proposedCutoverDateKey=null}={}){
 if(proposedCutoverDateKey!==null&&!goodDay(proposedCutoverDateKey))
  throw new FinanceB12ReadinessError();
 if(!ledger||ledger.readonly!==true||ledger.currentOperationalFinance!==false||
    ledger.history?.sourceSystem!=='LEGACY_GOOGLE'||
    ledger.history?.readonly!==true||
    ledger.history?.counts?.financeTransactions!==24||
    ledger.history?.counts?.funds!==8||
    ledger.history?.counts?.controlSnapshots!==38||
    !Array.isArray(ledger.history?.fundBalances)||
    ledger.history.fundBalances.length!==8)
  throw Error('B12_HISTORY_SOURCE_NOT_VERIFIED');
 const historic=ledger.history,native=ledger.native||null;
 const nativeFunds=new Map((native?.fundBalances||[]).map(f=>[f.legacySourceId,f]));
 const fundChecks=historic.fundBalances.map(f=>{
  const linked=nativeFunds.get(f.legacySourceId);
  return {legacySourceId:f.legacySourceId,code:f.code,
   historicalBalanceBase:f.balanceBase,
   nativeOpeningBase:linked?.openingBalanceBase??null,
   valueMatches:linked?linked.code===f.code&&
    linked.openingBalanceBase===f.balanceBase:null};
 }).sort((a,b)=>a.code.localeCompare(b.code));
 const certifiedAsOf=goodDay(historic.attestedAsOfDate)&&
  typeof historic.attestedManifestSha256==='string'&&
  /^[0-9a-f]{64}$/.test(historic.attestedManifestSha256);
 const valueChecks={
  cash:native?historic.cashBalanceBase===native.openingCashBase:null,
  funds:native?fundChecks.length===8&&fundChecks.every(f=>f.valueMatches===true):null
 };
 return Object.freeze({
  version:'FINANCE_B12_READINESS_V1',
  readonly:true,readyForFinancialCutover:false,
  financialWriteAuthority:'GOOGLE_UNTIL_SEPARATELY_APPROVED',
  archive:{sourceSystem:'LEGACY_GOOGLE',snapshotId:historic.snapshotId,
   sourceModifiedAt:historic.sourceModifiedAt??null,
   sourceModifiedAtIsCutoverProof:false,
   financeTransactions:historic.counts.financeTransactions,
   sourceFacts:historic.counts.monthlyGains+historic.counts.funds+
    historic.counts.allocationBatches+historic.counts.fundMovements,
   controlSnapshots:historic.counts.controlSnapshots,
   sourceVerifiedAtArchiveLevel:true,
   certifiedAsOfDate:certifiedAsOf?historic.attestedAsOfDate:null,
   historicalCashBase:historic.cashBalanceBase,
   historicalProfitBase:historic.profitBase,
   historicalWorkerPayableBase:historic.workerPayableBase},
  proposal:proposedCutoverDateKey?{
   cutoverDateKey:proposedCutoverDateKey,
   requiredAsOfDateKey:previousDay(proposedCutoverDateKey),
   ownerApproved:false,sourceCertifiedForThisDate:
    certifiedAsOf&&historic.attestedAsOfDate===previousDay(proposedCutoverDateKey)
  }:null,
  native:{phase:ledger.phase,cutoverDateKey:native?.cutoverDateKey??null,
   openingCashBase:native?.openingCashBase??null,
   nativeCashDeltaBase:native?.cashDeltaBase??null,
   valueChecks,fundOpeningChecks:fundChecks,
   hasSafeCombinedBalance:ledger.phase==='RECONCILED'&&ledger.combined!==null},
  missingApprovalAndEvidence:[
   'OWNER_APPROVED_CUTOVER_DATE',
   'FRESH_IMMUTABLE_GOOGLE_AS_OF_EXPORT_AND_SHA256',
   'COMPLETE_CRM_IDENTITY_BRIDGE_AND_SHA256',
   'SIGNED_OPENING_CASH_PROFIT_PAYABLE_AND_EIGHT_FUNDS',
   'TEST_BACKUP_MIGRATION_READBACK_AND_OWNER_ACCEPTANCE',
   'EXPLICIT_FINANCIAL_WRITER_SWITCH_APPROVAL'
  ],
  note:'Historical archive verification alone never certifies the proposed as-of day or enables posting.'
 });
}
