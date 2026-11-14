import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalFinanceTransactionsPage,HistoryOrdersAccessError} from '../history-orders-api.mjs';
import {financeRowHtml,mountFinanceHistoryPanel,sourceDay} from '../finance-history-view.mjs';

const counts={LEAD:33,CLIENT:17,OBJECT:19,WORKER:2,WORK_ORDER:22,CLIENT_ASSESSMENT:13,WORKER_ASSIGNMENT:1,FINANCE_TRANSACTION:24};
const batch='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const item=(id)=>({
 legacy_transaction_id:id,source_system:'LEGACY_GOOGLE',status:'active',
 transaction_date_raw:'46250',operation_type:'INCOME',category:'Fixture',
 amount_original:'12500.000000',currency_original:'AMD',amount_base:'12500.000000',
 base_currency:'AMD',legacy_order_id:'WO-SYNTHETIC'
});
function mockDb(rows=[item('FT-2026-0002'),item('FT-2026-0001')],good=true){
 const calls=[];
 return {
  calls,
  async query(sql,args){
   calls.push({sql,args});
   if(sql.includes('mvp_history.import_batches'))
    return {rows:good?[{expected_counts:counts,reconciled_counts:counts}]:[]};
   if(sql.includes("r.source_kind='FINANCE_TRANSACTION'"))return {rows};
   throw Error('UNEXPECTED_QUERY');
  }
 };
}
const page=(params='')=>new URL('https://test.invalid/api/history/finance'+params);
const opts={authorizeOwner:()=>true,batchId:batch};
test('owner authorization runs before all SQL, including failed requests',async()=>{
 const db=mockDb();await assert.rejects(
  historicalFinanceTransactionsPage(db,page(),{...opts,authorizeOwner:()=>false}),
  error=>error instanceof HistoryOrdersAccessError&&error.status===401
 );assert.equal(db.calls.length,0);
});
test('source gate fails closed on missing or mismatched receipt',async()=>{
 const db=mockDb([],false);
 await assert.rejects(historicalFinanceTransactionsPage(db,page(),opts),e=>e.status===503);
 assert.equal(db.calls.length,1);
});
test('source query is bounded, parameterized and strips raw PII/notes',async()=>{
 const db=mockDb();
 const out=await historicalFinanceTransactionsPage(db,page('?type=INCOME&limit=1'),opts);
 assert.equal(out.source,'FROZEN_LEGACY_FINANCE_ARCHIVE_ONLY');
 assert.equal(out.financialAuthority,'LEGACY_GOOGLE');
 assert.equal(out.readonly,true);assert.equal(out.noCurrentBalance,true);
 assert.equal(out.items.length,1);assert.equal(out.hasMore,true);
 assert.equal(out.nextCursor,'FT-2026-0002');assert.ok(Object.isFrozen(out.items[0]));
 const sql=db.calls[1].sql;
 assert.deepEqual(db.calls[1].args,[batch,'INCOME','',2]);
 assert.match(sql,/source_kind='FINANCE_TRANSACTION'/);
 assert.match(sql,/ORDER BY r\.source_id DESC LIMIT \$4/);
 assert.doesNotMatch(sql,/SELECT\s+\*|counterparty|notes|profitEffectBase|cashEffectBase/i);
});
test('bad type, cursor and unbounded limits reject without query to source rows',async()=>{
 for(const bad of ['?type=ALTER','?cursor=%27%20OR%201','?limit=51','?limit=0','?limit=500']){
  const db=mockDb();
  await assert.rejects(historicalFinanceTransactionsPage(db,page(bad),opts),e=>e.status===400,bad);
  assert.equal(db.calls.length,1,bad);
 }
});
test('missing batch config rejects before history rows',async()=>{
 const db=mockDb();
 await assert.rejects(historicalFinanceTransactionsPage(db,page(),{authorizeOwner:()=>true,batchId:''}),e=>e.status===503);
 assert.equal(db.calls.length,0);
});
test('finance list output preserves exact original decimal strings and source date normalization',()=>{
 assert.equal(sourceDay('46250').length,10);
 assert.equal(sourceDay('bad'),'Дата источника не распознана');
 const html=financeRowHtml({...item('FT-1'),category:'<img src=x onerror=alert(1)>',
  amount_original:'<script>x</script>',legacy_order_id:'WO-<b>'});
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(html.includes('&lt;img'));
 assert.ok(!html.includes('<script>'));
 assert.ok(!html.includes('<img'));
});
test('mobile report panel loads archive only on explicit request, preserves paging and unmounts',async()=>{
 const listeners=new Map();
 const root={innerHTML:'',addEventListener:(n,cb)=>listeners.set(n,cb),
  removeEventListener:(n,cb)=>{if(listeners.get(n)===cb)listeners.delete(n);}};
 const urls=[],responses=[
  {source:'FROZEN_LEGACY_FINANCE_ARCHIVE_ONLY',readonly:true,noCurrentBalance:true,items:[item('FT-2')],hasMore:true,nextCursor:'FT-2'},
  {source:'FROZEN_LEGACY_FINANCE_ARCHIVE_ONLY',readonly:true,noCurrentBalance:true,items:[item('FT-1')],hasMore:false,nextCursor:null}
 ];
 const ctl=mountFinanceHistoryPanel(root,{fetchPage:async url=>{urls.push(url);return responses.shift();}});
 assert.equal(urls.length,0);assert.match(root.innerHTML,/НЕ текущие/);
 await ctl.load(true);await ctl.load(false);
 assert.equal(urls.length,2);assert.match(urls[1],/cursor=FT-2/);
 assert.match(root.innerHTML,/Показано архивных записей: 2/);
 ctl.unmount();assert.equal(listeners.size,0);
});
test('UI refuses falsely operational API response and remains explicit archive',async()=>{
 const root={innerHTML:'',addEventListener(){},removeEventListener(){}};
 const ctl=mountFinanceHistoryPanel(root,{fetchPage:async()=>({source:'LIVE_BALANCE',items:[item('FT-1')],readonly:false})});
 await ctl.load(true);
 assert.match(root.innerHTML,/Не удалось подтвердить архивный источник/);
 assert.doesNotMatch(root.innerHTML,/Сумма источника:/);
 ctl.unmount();
});
