import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkedOpeningPreview,readFinanceOpeningPreview,FinanceOpeningPreviewError}
 from '../domains/finance/finance-opening-readonly.mjs';
import {financeOpeningPreviewHtml,validateFinanceDraft}
 from '../domains/finance/finance-opening-preview-view.mjs';
const snap='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const sha='8bdfd30faa9e45785f928c2861d7e3645a9dd168bb6d678004c0df730a04871d';
const codes=['OPERATING_RESERVE','WARRANTY_RESERVE','MARKETING_SALES','PEOPLE_TRAINING','TOOLS_CREW_KITS','RND_MATERIALS','DIGITAL_AI_VBOS','INFRASTRUCTURE'];
const values=['1000','2000','2000','2500','0','1500','0','1000'];
const valid=()=>({
 gate:{phase:'BLOCKED',financial_write_authority:'GOOGLE',cutover_date_key:null,
  activated_at:null,owner_identity_approved:false,google_frozen_confirmed:false},
 opening:{source_snapshot_id:snap,manifest_sha256:sha,as_of_date:'2026-09-30',
  opening_cash_base:'203000.000000',opening_profit_base:'588000.000000',
  opening_worker_payable_base:'0.000000'},
 manifest:{snapshot_id:snap,google_manifest_sha256:sha,
  owner_identity_approved:false,financial_write_authority:'GOOGLE'},
 funds:codes.map((code,i)=>({
  legacy_source_id:'FND-2026-000'+(i+1),code,source_snapshot_id:snap,
  archived_code:code,archived_balance:values[i],opening_balance_base:values[i]+'.000000'
 })),
 ledger:{opening_cash_base:'203000.000000',native_cash_delta_base:'0.000000',
  current_cash_balance_base:'203000.000000'},
 counts:{history_count:24,native_transactions:0,native_movements:0,
  opening_count:1,fund_count:8,fund_opening_count:8}
});
test('B13 exact owner-attested opening is explicitly not current money authority',()=>{
 const r=checkedOpeningPreview(valid());
 assert.equal(r.phase,'BLOCKED');
 assert.equal(r.postingEnabled,false);
 assert.equal(r.canSave,false);
 assert.equal(r.isCurrentLiveBalance,false);
 assert.equal(r.sourceFreezeVerified,false);
 assert.equal(r.opening.cashAMD,'203000.000000');
 assert.equal(r.funds.length,8);
 assert.equal(r.funds[6].openingBalanceAMD,'0.000000');
});
test('B13 fail closed on native writer, archive drift, missing fund, changed balance and double count',()=>{
 for(const mutate of [
  x=>{x.gate.phase='ACTIVE';x.gate.financial_write_authority='POSTGRES';},
  x=>{x.gate.google_frozen_confirmed=true;},
  x=>{x.opening.as_of_date='2026-10-01';},
  x=>{x.manifest.google_manifest_sha256='0'.repeat(64);},
  x=>{x.counts.native_transactions=1;},
  x=>{x.funds.pop();},
  x=>{x.funds[0].archived_balance='2000';},
  x=>{x.ledger.native_cash_delta_base='100.000000';},
  x=>{x.funds[0].legacy_source_id=x.funds[1].legacy_source_id;}
 ]){
  const input=valid();mutate(input);
  assert.throws(()=>checkedOpeningPreview(input),FinanceOpeningPreviewError);
 }
});
test('B13 database handler uses only read-only PostgreSQL transaction; missing source rolls back',async()=>{
 const data=valid(),statements=[],rows=[
  [data.gate],[data.opening],[data.manifest],data.funds,[data.ledger],[data.counts]
 ];
 let cursor=0,released=false;
 const db={connect:async()=>({query:async(sql)=>{
  statements.push(sql);
  if(sql.startsWith('BEGIN'))return {rows:[]};
  if(sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
  const out=rows[cursor++];return {rows:out};
 },release(){released=true;}})};
 const result=await readFinanceOpeningPreview(db);
 assert.equal(result.readonly,true);
 assert.equal(released,true);
 assert.equal(cursor,6);
 assert.match(statements[0],/READ ONLY/);
 assert.equal(statements.at(-1),'COMMIT');
 assert.equal(statements.filter(s=>/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i.test(s)).length,0);
 const broken=valid();broken.counts.native_transactions=1;
 const another=[],chunks=[[broken.gate],[broken.opening],[broken.manifest],broken.funds,[broken.ledger],[broken.counts]];
 let i=0;
 await assert.rejects(readFinanceOpeningPreview({connect:async()=>({
  async query(sql){another.push(sql);return {rows:sql.startsWith('BEGIN')||sql==='ROLLBACK'?[]:chunks[i++]};},
  release(){}
 })}),FinanceOpeningPreviewError);
 assert.equal(another.at(-1),'ROLLBACK');
});
test('B13 mobile finance preview accepts valid ephemeral draft and rejects dangerous values',()=>{
 const x=checkedOpeningPreview(valid());
 const money=validateFinanceDraft({operationType:'INCOME',
  transactionDateKey:'2026-10-01',amountAMD:'25000,50',notes:'Октябрь'},
  {mode:'finance',funds:x.funds,today:'2026-11-10'});
 assert.equal(money.amountAMD,'25000.50');
 assert.equal(money.operationLabel,'Поступление (черновик)');
 for(const amount of ['0','-1','1e10','1.001','NaN','1000000000','1.','001','0.00']){
  assert.throws(()=>validateFinanceDraft({operationType:'EXPENSE',
   transactionDateKey:'2026-10-10',amountAMD:amount},
   {mode:'finance',funds:x.funds,today:'2026-11-10'}));
 }
 assert.throws(()=>validateFinanceDraft({operationType:'INCOME',
  transactionDateKey:'2026-09-30',amountAMD:'100'},
  {mode:'finance',funds:x.funds,today:'2026-11-10'}));
 assert.throws(()=>validateFinanceDraft({operationType:'INCOME',
  transactionDateKey:'2026-10-04',amountAMD:'100'},
  {mode:'capital',funds:x.funds,today:'2026-11-10'}));
});
test('B13 capital transfer checks distinct known fund IDs, no journal post',()=>{
 const f=checkedOpeningPreview(valid()).funds;
 const raw={operationType:'FUND_TRANSFER',transactionDateKey:'2026-11-09',
  amountAMD:'100',fromFundId:f[0].legacyId,toFundId:f[1].legacyId};
 const p=validateFinanceDraft(raw,{mode:'capital',funds:f,today:'2026-11-10'});
 assert.equal(p.fromFund.id,f[0].legacyId);
 assert.equal(p.toFund.id,f[1].legacyId);
 assert.throws(()=>validateFinanceDraft({...raw,toFundId:raw.fromFundId},
  {mode:'capital',funds:f,today:'2026-11-10'}));
 assert.throws(()=>validateFinanceDraft({...raw,toFundId:'FND-NOT-THERE'},
  {mode:'capital',funds:f,today:'2026-11-10'}));
 assert.ok(!JSON.stringify(p).includes('saved'));
});
test('B13 HTML is mobile-friendly and has NO Save/POST route or unescaped note data',()=>{
 const data=checkedOpeningPreview(valid());
 const html=financeOpeningPreviewHtml(data,'finance',{today:'2026-11-10'});
 assert.match(html,/Подтверждено владельцем/);
 assert.match(html,/Проверить черновик/);
 assert.match(html,/inputmode="decimal"/);
 assert.doesNotMatch(html,/<button[^>]*>Сохранить/);
 assert.doesNotMatch(html,/native-action-preview|localStorage|fetch\(/);
 const capital=financeOpeningPreviewHtml(data,'capital',{today:'2026-11-10'});
 assert.match(capital,/Из фонда/);
 assert.match(capital,/В фонд/);
 assert.match(capital,/Инфраструктура/);
 assert.throws(()=>financeOpeningPreviewHtml({...data,postingEnabled:true},'finance'));
});
