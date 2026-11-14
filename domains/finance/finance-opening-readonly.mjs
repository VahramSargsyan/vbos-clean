/**
 * Finance B13: owner-session-only read of an attested historical opening.
 * Never infer authority from this preview; always fail closed.
 */
export class FinanceOpeningPreviewError extends Error {
 constructor(code){super(code);this.name='FinanceOpeningPreviewError';this.status=503;this.code=code;}
}
const bad=code=>{throw new FinanceOpeningPreviewError(code);};
const EXPECTED_SNAPSHOT='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const EXPECTED_SHA='8bdfd30faa9e45785f928c2861d7e3645a9dd168bb6d678004c0df730a04871d';
const isMoney=x=>typeof x==='string'&&/^(0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(x);
function micro(value){
 if(!isMoney(value))bad('B13_INVALID_MONEY');
 const [int,frac='']=value.split('.');
 return BigInt(int)*1000000n+BigInt(frac.padEnd(6,'0'));
}
const stable=x=>String(x??'');
export function checkedOpeningPreview({gate,opening,manifest,funds,ledger,counts}){
 if(!gate||gate.phase!=='BLOCKED'||gate.financial_write_authority!=='GOOGLE'||
    gate.cutover_date_key!==null||gate.activated_at!==null||
    gate.google_frozen_confirmed!==false||gate.owner_identity_approved!==false)
  bad('B13_AUTHORITY_NOT_BLOCKED');
 if(!opening||stable(opening.source_snapshot_id)!==EXPECTED_SNAPSHOT||
    stable(opening.manifest_sha256)!==EXPECTED_SHA||
    stable(opening.as_of_date)!=='2026-09-30'||
    micro(stable(opening.opening_cash_base))!==203000000000n||
    micro(stable(opening.opening_profit_base))!==588000000000n||
    micro(stable(opening.opening_worker_payable_base))!==0n)
  bad('B13_OPENING_RECONCILIATION_FAILED');
 if(!manifest||manifest.snapshot_id!==EXPECTED_SNAPSHOT||
    manifest.google_manifest_sha256!==EXPECTED_SHA||
    manifest.owner_identity_approved!==false||
    manifest.financial_write_authority!=='GOOGLE')
  bad('B13_ARCHIVE_MANIFEST_INVALID');
 if(!counts||Number(counts.history_count)!==24||Number(counts.native_transactions)!==0||
    Number(counts.native_movements)!==0||Number(counts.opening_count)!==1||
    Number(counts.fund_count)!==8||Number(counts.fund_opening_count)!==8)
  bad('B13_SOURCE_OR_WRITER_DRIFT');
 if(!ledger||micro(stable(ledger.opening_cash_base))!==203000000000n||
    micro(stable(ledger.native_cash_delta_base))!==0n||
    micro(stable(ledger.current_cash_balance_base))!==203000000000n)
  bad('B13_LEDGER_DRIFT');
 if(!Array.isArray(funds)||funds.length!==8)bad('B13_FUND_COUNT');
 const legacyIds=new Set(),codes=new Set(),mapped=funds.map(row=>{
  const legacyId=stable(row.legacy_source_id),code=stable(row.code);
  if(!/^FND-2026-000[1-8]$/.test(legacyId)||!(/^[A-Z_]{3,100}$/).test(code)||
     legacyIds.has(legacyId)||codes.has(code)||stable(row.source_snapshot_id)!==EXPECTED_SNAPSHOT||
     stable(row.archived_code)!==code||!isMoney(stable(row.opening_balance_base))||
     micro(stable(row.opening_balance_base))!==micro(stable(row.archived_balance)))
    bad('B13_FUND_SOURCE_DRIFT');
  legacyIds.add(legacyId);codes.add(code);
  return {legacyId,code,openingBalanceAMD:stable(row.opening_balance_base)};
 });
 if(mapped.reduce((n,f)=>n+micro(f.openingBalanceAMD),0n)!==10000000000n)
  bad('B13_FUND_SUM_MISMATCH');
 return {
  version:'FINANCE_B13_OPENING_READONLY_V1',readonly:true,
  postingEnabled:false,canSave:false,phase:'BLOCKED',
  financialWriteAuthority:'GOOGLE',asOfDate:'2026-09-30',
  sourceSystem:'OWNER_ATTESTED_LEGACY_GOOGLE_OPENING',
  sourceSnapshotId:EXPECTED_SNAPSHOT,sourceFreezeVerified:false,
  isCurrentLiveBalance:false,historyTransactions:24,
  opening:{
   cashAMD:stable(opening.opening_cash_base),
   profitAMD:stable(opening.opening_profit_base),
   workerPayableAMD:stable(opening.opening_worker_payable_base),
   fundTotalAMD:'10000.000000'
  },funds:mapped.sort((a,b)=>a.legacyId.localeCompare(b.legacyId))
 };
}
export async function readFinanceOpeningPreview(db){
 if(!db||typeof db.connect!=='function')bad('B13_DB_NOT_AVAILABLE');
 const client=await db.connect();
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const gate=(await client.query(
   'SELECT phase,financial_write_authority,cutover_date_key,owner_identity_approved,google_frozen_confirmed,activated_at '+ 
   'FROM mvp_finance_native.cutover_control WHERE id=1')).rows[0];
  const opening=(await client.query(
   'SELECT source_snapshot_id,manifest_sha256,as_of_date::text AS as_of_date,'+
   'opening_cash_base::text,opening_profit_base::text,opening_worker_payable_base::text '+
   'FROM mvp_finance_native.opening_snapshot WHERE id=1')).rows[0];
  const manifest=(await client.query(
   'SELECT snapshot_id,google_manifest_sha256,owner_identity_approved,financial_write_authority '+
   'FROM mvp_finance_stage.freeze_manifests WHERE snapshot_id=$1',
   [EXPECTED_SNAPSHOT])).rows[0];
  const funds=(await client.query(
   'SELECT f.legacy_source_id,f.code,fo.source_snapshot_id,'+
   "fo.opening_balance_base::text,s.source_payload->>'code' AS archived_code,"+
   "b.source_payload->>'balanceBase' AS archived_balance "+
   'FROM mvp_finance_native.funds f '+
   'JOIN mvp_finance_native.fund_openings fo ON fo.fund_id=f.fund_id '+
   'LEFT JOIN mvp_finance_stage.source_facts s '+
   'ON s.source_kind=$1 AND s.source_id=f.legacy_source_id '+
   'LEFT JOIN mvp_finance_stage.control_snapshots b '+
   'ON b.source_kind=$2 AND b.source_id=f.legacy_source_id '+
   'ORDER BY f.legacy_source_id',
   ['CAPITAL_FUND','CAPITAL_FUND_BALANCE'])).rows;
  const ledger=(await client.query(
   'SELECT opening_cash_base::text,native_cash_delta_base::text,'+
   'current_cash_balance_base::text FROM mvp_finance_native.v_cash_ledger')).rows[0];
  const counts=(await client.query(
   'SELECT (SELECT count(*)::int FROM mvp_history.source_records '+
   'WHERE source_kind=$1) AS history_count,'+
   '(SELECT count(*)::int FROM mvp_finance_native.transactions) AS native_transactions,'+
   '(SELECT count(*)::int FROM mvp_finance_native.fund_movements) AS native_movements,'+
   '(SELECT count(*)::int FROM mvp_finance_native.opening_snapshot) AS opening_count,'+
   '(SELECT count(*)::int FROM mvp_finance_native.funds) AS fund_count,'+
   '(SELECT count(*)::int FROM mvp_finance_native.fund_openings) AS fund_opening_count',
   ['FINANCE_TRANSACTION'])).rows[0];
  const result=checkedOpeningPreview({gate,opening,manifest,funds,ledger,counts});
  await client.query('COMMIT');return result;
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release();}
}
