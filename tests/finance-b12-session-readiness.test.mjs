import {test} from 'node:test';
import assert from 'node:assert/strict';
import {financeCsrfForValidatedSession,verifyFinanceCsrfForValidatedSession}
 from '../domains/finance/finance-session-csrf.mjs';
import {financeB12CutoverReadiness,FinanceB12ReadinessError}
 from '../domains/finance/finance-cutover-readiness.mjs';

const secret='EXACTLY-A-TEST-ONLY-HMAC-SECRET-LONGER-THAN-40-BYTES';
const cookie=(nonce='a'.repeat(24))=>'1700000000000.'+nonce+'.'+'e'.repeat(64);
test('B12 HMAC CSRF is bound to ONE signed-cookie value and rejects wrong headers',()=>{
 const s=cookie(),token=financeCsrfForValidatedSession(s,secret);
 assert.match(token,/^[0-9a-f]{64}$/);
 assert.equal(token,financeCsrfForValidatedSession(s,secret));
 assert.equal(verifyFinanceCsrfForValidatedSession(token,s,secret),true);
 assert.equal(verifyFinanceCsrfForValidatedSession(token,cookie('b'.repeat(24)),secret),false);
 assert.equal(verifyFinanceCsrfForValidatedSession('f'.repeat(64),s,secret),false);
 assert.equal(verifyFinanceCsrfForValidatedSession(token.toUpperCase(),s,secret),false);
 assert.equal(verifyFinanceCsrfForValidatedSession([token],s,secret),false);
 assert.equal(verifyFinanceCsrfForValidatedSession(undefined,s,secret),false);
 assert.equal(financeCsrfForValidatedSession('synthetic-owner-only',secret),null);
 assert.equal(verifyFinanceCsrfForValidatedSession(token,'not-a-cookie',secret),false);
 assert.throws(()=>financeCsrfForValidatedSession(s,'short'),/B12_CSRF_SIGNING_SECRET_MISSING/);
});
const funds=Array.from({length:8},(_,i)=>({
 legacySourceId:'LEGACY-FUND-'+i,code:'FUND_'+i,balanceBase:'0.000000'
}));
const ledger=()=>({
 readonly:true,currentOperationalFinance:false,phase:'HISTORY_ONLY',native:null,
 combined:null,history:{
  sourceSystem:'LEGACY_GOOGLE',snapshotId:'FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1',
  readonly:true,attestedAsOfDate:null,attestedManifestSha256:null,
  sourceModifiedAt:'2026-11-03T19:06:09.263Z',
  counts:{financeTransactions:24,monthlyGains:3,funds:8,
   allocationBatches:1,fundMovements:6,controlSnapshots:38},
  cashBalanceBase:'5000.000000',profitBase:'2000.000000',
  workerPayableBase:'0.000000',fundBalances:funds
 }
});
test('B12 readiness is source-labeled, blocks cutover and never invents as-of proof',()=>{
 const r=financeB12CutoverReadiness(ledger());
 assert.equal(r.archive.financeTransactions,24);
 assert.equal(r.archive.sourceFacts,18);
 assert.equal(r.archive.controlSnapshots,38);
 assert.equal(r.archive.certifiedAsOfDate,null);
 assert.equal(r.archive.sourceModifiedAt,'2026-11-03T19:06:09.263Z');
 assert.equal(r.archive.sourceModifiedAtIsCutoverProof,false);
 assert.equal(r.readyForFinancialCutover,false);
 assert.equal(r.financialWriteAuthority,'GOOGLE_UNTIL_SEPARATELY_APPROVED');
 assert.equal(r.native.hasSafeCombinedBalance,false);
 assert.equal(r.native.valueChecks.cash,null);
 assert.equal(r.proposal,null);
});
test('B12 date is only a proposal; a value match never certifies source day',()=>{
 const x=ledger();
 x.phase='UNRECONCILED';
 x.native={cutoverDateKey:'2026-11-11',openingCashBase:'5000.000000',
  cashDeltaBase:'300.000000',fundBalances:funds.map(f=>({
   ...f,openingBalanceBase:f.balanceBase}))};
 const r=financeB12CutoverReadiness(x,{proposedCutoverDateKey:'2026-11-11'});
 assert.equal(r.proposal.requiredAsOfDateKey,'2026-11-10');
 assert.equal(r.proposal.ownerApproved,false);
 assert.equal(r.proposal.sourceCertifiedForThisDate,false);
 assert.equal(r.native.valueChecks.cash,true);
 assert.equal(r.native.valueChecks.funds,true);
 assert.equal(r.readyForFinancialCutover,false);
 assert.equal(r.native.hasSafeCombinedBalance,false);
 x.native.openingCashBase='5100.000000';
 assert.equal(financeB12CutoverReadiness(x).native.valueChecks.cash,false);
});
test('B12 rejects impossible dates and unverified archives fail closed',()=>{
 for(const d of ['', '2026-02-31','2026-2-1','not-a-day','2026-13-01']){
  assert.throws(()=>financeB12CutoverReadiness(ledger(),{
   proposedCutoverDateKey:d}),FinanceB12ReadinessError);
 }
 const x=ledger();x.history.counts.financeTransactions=23;
 assert.throws(()=>financeB12CutoverReadiness(x),/B12_HISTORY_SOURCE_NOT_VERIFIED/);
});
