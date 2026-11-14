import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {financeOpeningPreviewHtml,validateFinanceDraft}
 from '../domains/finance/finance-opening-preview-view.mjs';
const funds=[
['OPERATING_RESERVE','1000'],['WARRANTY_RESERVE','2000'],
['MARKETING_SALES','2000'],['PEOPLE_TRAINING','2500'],
['TOOLS_CREW_KITS','0'],['RND_MATERIALS','1500'],
['DIGITAL_AI_VBOS','0'],['INFRASTRUCTURE','1000']
].map(([code,openingBalanceAMD],i)=>({legacyId:'FND-2026-000'+(i+1),code,openingBalanceAMD}));
const data={
 version:'FINANCE_B13_OPENING_READONLY_V1',readonly:true,
 postingEnabled:false,canSave:false,phase:'BLOCKED',
 financialWriteAuthority:'GOOGLE',asOfDate:'2026-09-30',
 sourceFreezeVerified:false,isCurrentLiveBalance:false,
 funds,opening:{cashAMD:'203000.000000',profitAMD:'588000.000000',
 workerPayableAMD:'0.000000',fundTotalAMD:'10000.000000'}
};
test('B15 Finance form exposes explicit safe categories and no Save',()=>{
 const html=financeOpeningPreviewHtml(data,'finance',{today:'2026-11-10'});
 assert.match(html,/name="category"/);
 assert.match(html,/Прочий доход/);
 assert.match(html,/Проверить черновик/);
 assert.match(html,/CSRF/);
 assert.doesNotMatch(html,/Сохранить в PostgreSQL|<button[^>]*>Провести/);
 const valid=validateFinanceDraft({
  operationType:'INCOME',category:'bonus',transactionDateKey:'2026-11-10',
  amountAMD:'25000',notes:'Проверка'
 },{mode:'finance',funds,today:'2026-11-10'});
 assert.equal(valid.category,'bonus');
 assert.throws(()=>validateFinanceDraft({
  operationType:'INCOME',category:'current_work',transactionDateKey:'2026-11-10',
  amountAMD:'25000'
 },{mode:'finance',funds,today:'2026-11-10'}),/категорию/);
});
test('B15 Capital fund form stays within source funds',()=>{
 const html=financeOpeningPreviewHtml(data,'capital',{today:'2026-11-10'});
 assert.match(html,/name="fromFundId"/);
 assert.match(html,/name="toFundId"/);
 assert.doesNotMatch(html,/name="category"/);
 const valid=validateFinanceDraft({
  operationType:'FUND_TRANSFER',transactionDateKey:'2026-10-01',
  amountAMD:'100',fromFundId:funds[1].legacyId,toFundId:funds[0].legacyId
 },{mode:'capital',funds,today:'2026-11-10'});
 assert.equal(valid.fromFund.id,funds[1].legacyId);
 assert.equal(valid.toFund.id,funds[0].legacyId);
});
test('B15 browser only submits dry-run after session-bound CSRF',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const view=readFileSync(new URL('../domains/finance/finance-opening-preview-view.mjs',import.meta.url),'utf8');
 assert.match(app,/csrf=await api\('\/api\/finance\/csrf'\)/);
 assert.match(app,/X-Finance-CSRF':csrf.token/);
 assert.match(app,/fetch\('\/api\/finance\/draft-validate'/);
 assert.match(app,/postDraft:payload=>financeDraftServerPost\(payload\)/);
 assert.match(server,/FINANCE_B15_CSRF_REJECTED/);
 assert.match(server,/financeStrictSameOrigin\(req\)/);
 assert.match(server,/validateFinanceB15ServerDraft\(pool,payload/);
 assert.doesNotMatch(server,/postNativeFinanceCapital\(pool/);
 assert.match(view,/FINANCE_B15_SERVER_DRY_RUN_V1/);
 assert.match(view,/preview.saved!==false/);
 assert.doesNotMatch(view,/localStorage|sessionStorage/);
});
