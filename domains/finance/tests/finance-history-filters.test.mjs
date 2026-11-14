import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalFinanceFilterOptions,historicalFinanceTransactionsPage,HistoryOrdersAccessError} from '../history-orders-api.mjs';
import {mountFinanceHistoryPanel,financeRowHtml,sourceDay} from '../finance-history-view.mjs';

const counts={LEAD:33,CLIENT:17,OBJECT:19,WORKER:2,WORK_ORDER:22,
 CLIENT_ASSESSMENT:13,WORKER_ASSIGNMENT:1,FINANCE_TRANSACTION:24};
const batch='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const opts={authorizeOwner:()=>true,batchId:batch};
const url=query=>new URL('https://test.invalid/api/history/finance'+query);
const referenceRows=[
 ...Array.from({length:21},(_,i)=>({
  source_kind:'WORK_ORDER',source_id:'WO-2026-'+String(i+1).padStart(4,'0'),
  source_system:'LEGACY_GOOGLE',sha_valid:true,title:'Order '+(i+1),name:''})),
 ...Array.from({length:2},(_,i)=>({
  source_kind:'WORKER',source_id:'WRK-2026-'+String(i+1).padStart(4,'0'),
  source_system:'LEGACY_GOOGLE',sha_valid:true,title:'',name:'Worker '+(i+1)}))
];
function mockDb({rows=[],references=referenceRows,good=true}={}){
 const queries=[];
 return {queries,async query(sql,args){
  queries.push({sql,args});
  if(sql.includes('mvp_history.import_batches'))
   return {rows:good?[{expected_counts:counts,reconciled_counts:counts}]:[]};
  if(sql.includes("r.source_kind IN ('WORK_ORDER','WORKER')"))return {rows:references};
  if(sql.includes("r.source_kind='FINANCE_TRANSACTION'"))return {rows};
  throw Error('UNEXPECTED_QUERY');
 }};
}
const row=(id='FIN-2026-0001')=>({
 legacy_transaction_id:id,source_system:'LEGACY_GOOGLE',
 status:'active',transaction_date_raw:'46275',operation_type:'WORKER_ACCRUAL_PAYMENT',
 category:'worker',amount_original:'5000',currency_original:'AMD',
 amount_base:'5000',base_currency:'AMD',legacy_order_id:'WO-2026-0012',
 legacy_worker_id:'WRK-2026-0001'
});
const filters={workOrderId:'WO-2026-0012',workerId:'WRK-2026-0001',
 dateFrom:'2026-08-16',dateTo:'2026-09-10'};

test('source calendar dates map to exact Sheets serials, inclusive endpoints',async()=>{
 assert.equal(sourceDay('46250'),'2026-08-16');
 assert.equal(sourceDay('46275'),'2026-09-10');
 const db=mockDb({rows:[row()]});
 const q=url('?workOrderId=WO-2026-0012&workerId=WRK-2026-0001&dateFrom=2026-08-16&dateTo=2026-09-10&type=WORKER_ACCRUAL_PAYMENT&limit=20');
 const out=await historicalFinanceTransactionsPage(db,q,opts);
 assert.equal(out.readonly,true);assert.equal(out.noCurrentBalance,true);
 assert.deepEqual(out.filters,filters);
 assert.equal(out.items[0].legacy_worker_id,'WRK-2026-0001');
 assert.equal(db.queries.length,2);
 assert.deepEqual(db.queries[1].args,[batch,'WORKER_ACCRUAL_PAYMENT','',
  'WO-2026-0012','WRK-2026-0001',46250,46275,21]);
 const sql=db.queries[1].sql;
 assert.match(sql,/workerId/);assert.match(sql,/workOrderId/);
 assert.match(sql,/transactionDateKey/);assert.match(sql,/::int >= \$6/);
 assert.match(sql,/::int <= \$7/);assert.match(sql,/ORDER BY r\.source_id DESC LIMIT \$8/);
 assert.doesNotMatch(sql,/SELECT\s+\*|counterparty|notes|profitEffectBase|cashEffectBase/i);
});
test('explicit filters preserve cursor and page bound, independent of archive balance',async()=>{
 const db=mockDb({rows:[row('FIN-2026-0018'),row('FIN-2026-0017')]});
 const a=await historicalFinanceTransactionsPage(db,url('?workerId=WRK-2026-0001&limit=1&cursor=FIN-2026-0019'),opts);
 assert.equal(a.items.length,1);assert.equal(a.hasMore,true);
 assert.equal(a.nextCursor,'FIN-2026-0018');
 assert.equal(db.queries[1].args[2],'FIN-2026-0019');
 assert.equal(db.queries[1].args[7],2);
});
test('invalid IDs, leap dates and inverted ranges fail before source rows',async()=>{
 const invalid=[
  '?workerId=WRONG%20ID','?workOrderId=%27%20OR%201%3D1',
  '?dateFrom=2026-02-30','?dateFrom=2026-02-29',
  '?dateTo=2026-13-01','?dateFrom=01-01-2026',
  '?dateFrom=2026-09-23&dateTo=2026-09-10',
  '?dateFrom=2101-01-01','?dateTo=0001-01-01'
 ];
 for(const input of invalid){
  const db=mockDb();
  await assert.rejects(historicalFinanceTransactionsPage(db,url(input),opts),
   e=>e instanceof HistoryOrdersAccessError&&e.status===400,input);
  assert.equal(db.queries.length,1,input);
 }
 const ok=mockDb();
 await historicalFinanceTransactionsPage(ok,url('?dateFrom=2024-02-29'),opts);
 assert.equal(ok.queries[1].args[5],45351);
});
test('owner gate rejects history and filter options before SQL',async()=>{
 const db=mockDb();
 await assert.rejects(historicalFinanceFilterOptions(db,{...opts,authorizeOwner:()=>false}),
  e=>e.status===401);
 await assert.rejects(historicalFinanceTransactionsPage(db,url('?workerId=WRK-2026-0001'),
  {...opts,authorizeOwner:()=>false}),e=>e.status===401);
 assert.equal(db.queries.length,0);
});
test('frozen reference options contain 21 original Google orders and 2 workers, no notes',async()=>{
 const db=mockDb(),r=await historicalFinanceFilterOptions(db,opts);
 assert.equal(r.readonly,true);
 assert.equal(r.source,'FROZEN_LEGACY_FINANCE_FILTER_OPTIONS');
 assert.equal(r.workOrders.length,21);assert.equal(r.workers.length,2);
 assert.equal(r.workers[0].id,'WRK-2026-0001');
 assert.deepEqual(db.queries[1].args,[batch]);
 assert.doesNotMatch(db.queries[1].sql,/SELECT\s+\*|phone|notes|email/i);
 assert.match(db.queries[1].sql,/source_system='LEGACY_GOOGLE'/);
 assert.ok(Object.isFrozen(r.workOrders));
});
test('broken historic reference row/hash/duplicates fail closed',async()=>{
 for(const broken of [
  referenceRows.slice(1),
  referenceRows.map((x,i)=>i===0?{...x,sha_valid:false}:x),
  referenceRows.map((x,i)=>i===1?{...x,source_id:referenceRows[0].source_id}:x),
  referenceRows.map((x,i)=>i===0?{...x,source_system:'ANOTHER_SYSTEM'}:x)
 ]){
  const db=mockDb({references:broken});
  await assert.rejects(historicalFinanceFilterOptions(db,opts),
   e=>e instanceof HistoryOrdersAccessError&&e.status===503);
 }
});
test('worker identity is HTML-escaped in archive history row',()=>{
 const html=financeRowHtml({...row(),legacy_worker_id:'<img src=x onerror=alert(1)>'});
 assert.match(html,/&lt;img/);
 assert.doesNotMatch(html,/<img/);
 assert.match(html,/Работник старого VBOS/);
});
test('filter UI loads options only by explicit click, applies date and worker/order, resets',async()=>{
 const handlers=new Map(),calls=[];
 const root={innerHTML:'',addEventListener:(k,h)=>handlers.set(k,h),removeEventListener:(k,h)=>{if(handlers.get(k)===h)handlers.delete(k);}};
 const clicks=name=>handlers.get('click')({target:{closest:selector=>selector==='[data-finance-'+name+']'?{}:null}});
 const change=(field,value)=>handlers.get('change')({target:{
  matches:sel=>sel==='[data-finance-filter]',
  getAttribute:key=>key==='data-finance-filter'?field:null,value}});
 const fetchPage=async path=>{
  calls.push(path);
  if(path==='/api/history/finance/options')
   return {source:'FROZEN_LEGACY_FINANCE_FILTER_OPTIONS',readonly:true,
    workOrders:referenceRows.filter(x=>x.source_kind==='WORK_ORDER').map(x=>({id:x.source_id,title:x.title})),
    workers:referenceRows.filter(x=>x.source_kind==='WORKER').map(x=>({id:x.source_id,name:x.name}))};
  const params=new URL(path,'https://test.invalid').searchParams;
  return {source:'FROZEN_LEGACY_FINANCE_ARCHIVE_ONLY',readonly:true,noCurrentBalance:true,
   items:[row()],hasMore:false,nextCursor:null,
   filters:{workOrderId:params.get('workOrderId')||'',workerId:params.get('workerId')||'',
    dateFrom:params.get('dateFrom')||'',dateTo:params.get('dateTo')||''}};
 };
 const x=mountFinanceHistoryPanel(root,{fetchPage});
 assert.equal(calls.length,0);
 clicks('filters-toggle');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['/api/history/finance/options']);
 assert.match(root.innerHTML,/Работник старого VBOS/);
 change('workOrderId','WO-2026-0012');
 change('workerId','WRK-2026-0001');
 change('dateFrom','2026-08-16');
 change('dateTo','2026-09-10');
 clicks('apply');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,2);
 const q=new URL(calls[1],'https://test.invalid').searchParams;
 for(const [k,v] of Object.entries(filters))assert.equal(q.get(k),v,k);
 assert.match(root.innerHTML,/Применено фильтров: 4/);
 clicks('reset');
 await new Promise(resolve=>setImmediate(resolve));
 const reset=new URL(calls[2],'https://test.invalid').searchParams;
 assert.equal(reset.has('workerId'),false);
 assert.equal(reset.has('workOrderId'),false);
 assert.equal(reset.has('dateFrom'),false);
 assert.match(root.innerHTML,/Показано архивных записей: 1/);
 x.unmount();assert.equal(handlers.size,0);
});
test('UI rejects wrong filtered response without presenting it as valid history',async()=>{
 const handlers=new Map(),root={
  innerHTML:'',addEventListener:(k,h)=>handlers.set(k,h),removeEventListener:(k,h)=>handlers.delete(k)};
 const responses=async path=>path==='/api/history/finance/options'?
  {source:'FROZEN_LEGACY_FINANCE_FILTER_OPTIONS',readonly:true,
   workOrders:referenceRows.filter(x=>x.source_kind==='WORK_ORDER').map(x=>({id:x.source_id,title:x.title})),
   workers:referenceRows.filter(x=>x.source_kind==='WORKER').map(x=>({id:x.source_id,name:x.name}))}:
  {source:'FROZEN_LEGACY_FINANCE_ARCHIVE_ONLY',readonly:true,noCurrentBalance:true,items:[row()],hasMore:false};
 const x=mountFinanceHistoryPanel(root,{fetchPage:responses});
 const click=n=>handlers.get('click')({target:{closest:s=>s==='[data-finance-'+n+']'?{}:null}});
 click('filters-toggle');await new Promise(resolve=>setImmediate(resolve));
 handlers.get('change')({target:{matches:s=>s==='[data-finance-filter]',
  getAttribute:()=> 'workerId',value:'WRK-2026-0001'}});
 click('apply');await new Promise(resolve=>setImmediate(resolve));
 assert.match(root.innerHTML,/Ответ источника не соответствует/);
 assert.doesNotMatch(root.innerHTML,/Сумма источника: <b>/);
 x.unmount();
});
