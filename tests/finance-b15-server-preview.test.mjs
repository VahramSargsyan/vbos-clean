import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateFinanceB15Draft,validateFinanceB15ServerDraft,FinanceB15DraftError}
 from '../domains/finance/finance-draft-server-preview.mjs';
const funds=[
['OPERATING_RESERVE','1000'],['WARRANTY_RESERVE','2000'],
['MARKETING_SALES','2000'],['PEOPLE_TRAINING','2500'],
['TOOLS_CREW_KITS','0'],['RND_MATERIALS','1500'],
['DIGITAL_AI_VBOS','0'],['INFRASTRUCTURE','1000']
].map(([code,openingBalanceAMD],i)=>({legacyId:'FND-2026-000'+(i+1),code,openingBalanceAMD}));
const source=()=>({
 version:'FINANCE_B13_OPENING_READONLY_V1',
 readonly:true,postingEnabled:false,canSave:false,phase:'BLOCKED',
 financialWriteAuthority:'GOOGLE',asOfDate:'2026-09-30',
 sourceFreezeVerified:false,isCurrentLiveBalance:false,
 historyTransactions:24,
 opening:{cashAMD:'203000.000000',profitAMD:'588000.000000',
 workerPayableAMD:'0.000000',fundTotalAMD:'10000.000000'},
 funds:funds.map(f=>({...f}))
});
const money=(x={})=>({
 mode:'finance',operationType:'INCOME',category:'other',
 transactionDateKey:'2026-10-14',amountAMD:'25000.25',notes:'Тест черновика',...x
});
const capital=(x={})=>({
 mode:'capital',operationType:'FUND_TRANSFER',
 fromFundId:'FND-2026-0002',toFundId:'FND-2026-0001',
 transactionDateKey:'2026-10-14',amountAMD:'100',notes:'Только просмотр',...x
});
const run=p=>validateFinanceB15Draft(p,{todayKey:'2026-11-10',opening:source()});
const isError=(status,code)=>e=>e instanceof FinanceB15DraftError&&e.code===code&&e.status===status;
test('B15 income, bonus and expense use B2 canonical delta; NEVER persist',()=>{
 const n=run(money());
 assert.equal(n.version,'FINANCE_B15_SERVER_DRY_RUN_V1');
 assert.equal(n.canSave,false);assert.equal(n.saved,false);
 assert.equal(n.postingEnabled,false);assert.equal(n.persistentId,null);
 assert.equal(n.currentLiveBalance,false);
 assert.equal(n.effects.cashDeltaAMD,'25000.250000');
 assert.equal(n.effects.profitDeltaAMD,'25000.250000');
 assert.equal(n.effects.workerPayableDeltaAMD,'0.000000');
 assert.equal(run(money({category:'bonus'})).effects.cashDeltaAMD,'25000.250000');
 const expense=run(money({operationType:'EXPENSE',category:'transport',amountAMD:'10.50'}));
 assert.equal(expense.effects.cashDeltaAMD,'-10.500000');
 assert.equal(expense.effects.profitDeltaAMD,'-10.500000');
 assert.equal(expense.notAnAccountingEntry,true);
});
test('B15 categorization excludes order/client-linked entries until separate CRM bridge',()=>{
 for(const raw of [
  money({category:'current_work'}),money({category:'advance'}),
  money({category:'old_debt'}),money({category:'client_material_funds'}),
  money({operationType:'EXPENSE',category:'client_material_purchase'})
 ])assert.throws(()=>run(raw),isError(400,'B15_CATEGORY_REQUIRES_LINKED_CRM_OR_UNSUPPORTED'));
});
test('B15 exact, bounded amounts, dates and strict payload allowlist',()=>{
 for(const amt of ['0','-1','1e3','01','1.','999999999.999',
  '1000000000','NaN','Infinity','',100,undefined]){
  assert.throws(()=>run(money({amountAMD:amt})),FinanceB15DraftError);
 }
 for(const date of ['2026-09-30','2026-11-11','2026-02-31','2026-1-01','junk']){
  assert.throws(()=>run(money({transactionDateKey:date})),FinanceB15DraftError);
 }
 assert.throws(()=>run({...money(),cashEffectBase:'500'}),isError(400,'B15_UNEXPECTED_FIELDS'));
 assert.throws(()=>run({...money(),requestKey:'external'}),isError(400,'B15_UNEXPECTED_FIELDS'));
 assert.throws(()=>run(money({notes:'x'.repeat(301)})),isError(400,'B15_NOTES_INVALID'));
 assert.throws(()=>run(money({mode:'capital'})),isError(400,'B15_OPERATION_UNSUPPORTED'));
 assert.throws(()=>run(money({fromFundId:'FND-2026-0001'})),isError(400,'B15_FINANCE_CANNOT_USE_FUND_FIELDS'));
});
test('B15 Capital fund transfer conservation and non-cash spend with opening limit',()=>{
 const x=run(capital());
 assert.deepEqual(x.effects.fundEffects.map(f=>f.deltaAMD),
 ['-100.000000','100.000000']);
 assert.equal(x.effects.cashDeltaAMD,'0.000000');
 assert.equal(x.effects.profitDeltaAMD,'0.000000');
 assert.equal(x.saved,false);
 const spend=run(capital({operationType:'FUND_SPEND',toFundId:undefined,amountAMD:'5.01'}));
 assert.deepEqual(spend.effects.fundEffects.map(f=>f.deltaAMD),['-5.010000']);
 assert.throws(()=>run(capital({amountAMD:'2000.01'})),isError(400,'B15_EXCEEDS_ATTESTED_OPENING_NOT_LIVE'));
 assert.throws(()=>run(capital({fromFundId:'FND-2026-0005'})),isError(400,'B15_EXCEEDS_ATTESTED_OPENING_NOT_LIVE'));
 assert.throws(()=>run(capital({toFundId:'FND-2026-0002'})),isError(400,'B15_DESTINATION_FUND_INVALID'));
 assert.throws(()=>run(capital({toFundId:'FND-UNKNOWN'})),isError(400,'B15_DESTINATION_FUND_INVALID'));
 assert.throws(()=>run(capital({operationType:'FUND_SPEND',toFundId:'FND-2026-0001'})),
 isError(400,'B15_SPEND_CANNOT_HAVE_DESTINATION'));
});
test('B15 source FAIL-CLOSED on stale control, fund drift, nonzero ledger or new authority',()=>{
 for(const alter of [
  x=>{x.readonly=false;},x=>{x.phase='ACTIVE';},
  x=>{x.financialWriteAuthority='POSTGRES';},
  x=>{x.opening.cashAMD='203001';},
  x=>{x.opening.fundTotalAMD='9999';},
  x=>{x.funds.pop();},
  x=>{x.funds[0].openingBalanceAMD='999';},
  x=>{x.funds[0].legacyId='FND-FAKE';},
  x=>{x.historyTransactions=23;},
  x=>{x.isCurrentLiveBalance=true;}
 ]){
  const a=source();alter(a);
  assert.throws(()=>validateFinanceB15Draft(money(),{
   todayKey:'2026-11-10',opening:a
  }),e=>e instanceof FinanceB15DraftError&&e.status===503);
 }
});
test('B15 server adapter has no DB writes, returns preview only',async()=>{
 let called=0;
 const pool={connect:async()=>{throw Error('B15_MUST_DELEGATE_READONLY_TO_B13');}};
 const out=await validateFinanceB15ServerDraft(pool,money(),{
  todayKey:'2026-11-10',readOpening:async()=>{called++;return source();}
 });
 assert.equal(called,1);assert.equal(out.saved,false);
 assert.equal(out.warning,'ILLUSTRATIVE_ONLY_NOT_BOOKED_NOT_CURRENT_BALANCE');
});
