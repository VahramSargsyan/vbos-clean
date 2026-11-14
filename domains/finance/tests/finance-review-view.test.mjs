import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewRowsHtml,mountFinanceReviewPanel} from '../finance-review-view.mjs';
const items=[
 {sourceKind:'FINANCE_TRANSACTION',sourceId:'FIN-1',title:'INCOME <script>x</script>',amountBase:'100.000000',
  reviewState:'UNREVIEWED',revision:0,sourceStatus:'active'},
 {sourceKind:'FINANCE_TRANSACTION',sourceId:'FIN-2',title:'EXPENSE',amountBase:'50.000000',
  reviewState:'ARCHIVED',revision:1,sourceStatus:'active'},
 {sourceKind:'BUSINESS_MONTHLY_GAIN',sourceId:'2026-08',title:'2026-08',amountBase:'200.000000',
  reviewState:'REVIEWED',revision:1,sourceStatus:'active'},
 {sourceKind:'CAPITAL_FUND',sourceId:'FND-1',title:'Резерв',amountBase:null,
  reviewState:'UNREVIEWED',revision:0,sourceStatus:'active'}
];
const payload={source:'VERIFIED_FINANCE_REVIEW_OVERLAY',readonlySource:true,financialWriter:'GOOGLE',
 moneyAffectedByArchive:false,total:42,items};
test('owner review screen escapes source text and never implies a money write',()=>{
 const x=reviewRowsHtml(payload,{mode:'finance'});
 assert.match(x,/Архив — только отметка/);assert.match(x,/не меняются/);
 assert.match(x,/&lt;script&gt;/);assert.doesNotMatch(x,/<script>/);
 assert.match(x,/FIN-1/);assert.doesNotMatch(x,/FIN-2/);
 assert.match(x,/Проверено/);assert.match(x,/В архив/);
 assert.doesNotMatch(x,/<form|type="submit"|data-act=/);
});
test('archived filter remains reversible and capital records segregate',()=>{
 const y=reviewRowsHtml(payload,{mode:'finance',filter:'ARCHIVED'});
 assert.match(y,/FIN-2/);assert.doesNotMatch(y,/FIN-1/);
 assert.match(y,/Снять отметку/);
 const z=reviewRowsHtml(payload,{mode:'capital',filter:'ALL'});
 assert.match(z,/Резерв/);assert.doesNotMatch(z,/FIN-1/);
});
test('reject source authority mismatch or claimed mutation of financial amounts',()=>{
 for(const change of [{...payload,financialWriter:'CLEAN'}, {...payload,moneyAffectedByArchive:true},
  {...payload,source:'WRONG'}, {...payload,readonlySource:false}]){
  assert.throws(()=>reviewRowsHtml(change,{mode:'finance'}));
 }
});
test('mount performs one guarded GET and no write on initial load; stale unmount safe',async()=>{
 let calls=0,handlers={};
 const root={innerHTML:'',addEventListener:(t,fn)=>{handlers[t]=fn;},
  removeEventListener:(t,fn)=>{if(handlers[t]===fn)delete handlers[t];},
  querySelectorAll:()=>[]};
 const r=mountFinanceReviewPanel(root,{mode:'finance',fetchPage:async url=>{
  assert.equal(url,'/api/finance/reviews');calls++;return payload;
 },saveReview:()=>{throw Error('NO_WRITE_EXPECTED')}});
 await Promise.resolve();await Promise.resolve();
 assert.equal(calls,1);assert.match(root.innerHTML,/INCOME/);
 r.unmount();assert.equal(handlers.click,undefined);
});
