import {test} from 'node:test';
import assert from 'node:assert/strict';
import {financeReviewAuditRowsHtml,mountFinanceReviewAuditPanel} from '../finance-review-audit-view.mjs';

const baseline={
 source:'VERIFIED_FINANCE_REVIEW_AUDIT',readonly:true,financialWriter:'GOOGLE',
 moneyAffected:false,mode:'finance',limit:10,hasMore:false,nextCursor:null,events:[]
};
const e=(eventId='4')=>({
 eventId,sourceKind:'FINANCE_TRANSACTION',sourceId:'FIN-1',
 originalTitle:'Операция <img src=x onerror=alert(1)>',
 previousState:'UNREVIEWED',nextState:'REVIEWED',revision:1,
 actorLogin:'owner-ci',recordedAt:'2026-11-08T19:00:00Z'
});
test('journal shows reviewer, local time, previous and next status; XSS escapes source',()=>{
 const html=financeReviewAuditRowsHtml({...baseline,events:[e()]},{mode:'finance'});
 assert.match(html,/Не разобрано/);
 assert.match(html,/Проверено/);
 assert.match(html,/owner-ci/);
 assert.match(html,/&lt;img/);
 assert.doesNotMatch(html,/<img/);
 assert.match(html,/FIN-1/);
 assert.doesNotMatch(html,/изменить|удалить|Провести платёж/i);
});
test('journal is empty when no review actions have occurred',()=>{
 const html=financeReviewAuditRowsHtml(baseline,{mode:'finance'});
 assert.match(html,/Пока нет отметок/);
});
test('rejects wrong mode or wrong source/security fields and event corruption',()=>{
 for(const data of [
  {...baseline,mode:'capital'},
  {...baseline,financialWriter:'CLEAN'},
  {...baseline,readonly:false},
  {...baseline,moneyAffected:true},
  {...baseline,events:[{...e(),sourceKind:'CAPITAL_FUND'}]},
  {...baseline,events:[{...e(),revision:-1}]},
  {...baseline,events:[{...e(),previousState:'WRONG'}]},
  {...baseline,events:[{...e(),recordedAt:'bad'}]},
  {...baseline,hasMore:true,nextCursor:null}
 ]){
  assert.throws(()=>financeReviewAuditRowsHtml(data,{mode:'finance'}));
 }
});
test('review event pagination and reload use only owner-read requests',async()=>{
 const listeners=new Map(),calls=[];
 const root={
  innerHTML:'',
  addEventListener:(name,handler)=>listeners.set(name,handler),
  removeEventListener:(name,handler)=>{if(listeners.get(name)===handler)listeners.delete(name);}
 };
 const fetchPage=async path=>{
  calls.push(path);
  const url=new URL(path,'https://test.invalid');
  return calls.length===1?{...baseline,events:[e('4')],hasMore:true,nextCursor:'4'}:
   calls.length===2?{...baseline,events:[e('3')]}:
   {...baseline,events:[]};
 };
 const ui=mountFinanceReviewAuditPanel(root,{mode:'finance',fetchPage});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,1);
 assert.match(root.innerHTML,/Показать ещё/);
 listeners.get('click')({target:{closest:sel=>sel==='[data-review-audit-more]'?{}:null}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,2);
 assert.equal(new URL(calls[1],'https://test.invalid').searchParams.get('cursor'),'4');
 assert.match(root.innerHTML,/Журнал отметок проверки/);
 listeners.get('click')({target:{closest:sel=>sel==='[data-review-audit-reload]'?{}:null}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,3);
 assert.match(root.innerHTML,/Пока нет отметок/);
 assert.ok(calls.every(x=>x.startsWith('/api/finance/review-audit?')));
 ui.unmount();assert.equal(listeners.size,0);
});
test('duplicated event in next page rejected instead of showing repeated actions',async()=>{
 const listeners=new Map(),root={innerHTML:'',
  addEventListener:(key,cb)=>listeners.set(key,cb),
  removeEventListener:(key)=>listeners.delete(key)};
 let n=0;
 const fetchPage=async()=>{n++;return n===1?
  {...baseline,events:[e('4')],hasMore:true,nextCursor:'4'}:
  {...baseline,events:[e('4')]};};
 const ui=mountFinanceReviewAuditPanel(root,{mode:'finance',fetchPage});
 await new Promise(resolve=>setImmediate(resolve));
 listeners.get('click')({target:{closest:sel=>sel==='[data-review-audit-more]'?{}:null}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(root.innerHTML,/Повтор событий/);
 ui.unmount();
});
