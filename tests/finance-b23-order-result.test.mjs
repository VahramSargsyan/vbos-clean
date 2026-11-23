import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readOrderFinancialResult} from '../domains/finance/finance-native-order-result.mjs';

const order='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const tx='33333333-3333-4333-8333-333333333333';
const zero={
 received_base:'0.000000',advance_base:'0.000000',earned_base:'0.000000',
 cash_out_base:'0.000000',cash_balance_base:'0.000000',
 economic_expense_base:'0.000000',profit_base:'0.000000',
 worker_accrued_base:'0.000000',worker_paid_base:'0.000000',
 worker_payable_base:'0.000000'
};
const receipt={id:tx,date:'2026-11-23',type:'INCOME',category:'advance',
 income_recognition:'RECEIVED_ONLY',status:'active',revision:1,
 amount_base:'10000.000000',cash_effect_base:'10000.000000',
 created_at_exact:'2026-11-23 10:00:00.123456+00'};
function setup({found=true,history=[receipt],summary=null}={}){
 const calls=[];let released=false;
 const pool={async connect(){return {async query(sql,params=[]){
  calls.push({sql,params});
  if(sql.startsWith('BEGIN')||sql==='ROLLBACK')return {rows:[]};
  if(sql.includes('FROM public.mvp_orders'))return {rows:found?[{id:order}]:[]};
  if(sql.includes('count(*)::int AS total_count'))
   return {rows:[summary||{total_count:history.length,active_count:history.length,
    ...zero,received_base:'10000.000000',advance_base:'10000.000000',
    cash_balance_base:'10000.000000'}]};
  if(sql.includes('finance_transaction_id::text AS id'))return {rows:history};
  throw Error('UNEXPECTED_QUERY');
 },release(){released=true;}}}};
 return {pool,calls,get released(){return released;}};
}
test('owner and exact native UUID gate precede every database connection',async()=>{
 let connections=0;
 const pool={async connect(){connections++;throw Error('NO_DB_EXPECTED');}};
 await assert.rejects(readOrderFinancialResult(pool,order,{authorizeOwner:()=>false}),
  e=>e.status===401&&e.code==='B23_OWNER_REQUIRED');
 for(const bad of ['LEGACY_ORDER_123','',other.slice(0,-1)]){
  await assert.rejects(readOrderFinancialResult(pool,bad,{authorizeOwner:()=>true}),
   e=>e.status===400&&e.code==='B23_ORDER_UUID_INVALID');
 }
 assert.equal(connections,0);
});
test('unmatched canonical Order is 404 before finance lookup',async()=>{
 const x=setup({found:false});
 await assert.rejects(readOrderFinancialResult(x.pool,order,{authorizeOwner:()=>true}),
  e=>e.status===404&&e.code==='B23_ORDER_NOT_FOUND');
 assert.equal(x.calls.some(v=>v.sql.includes('mvp_finance_native.transactions')),false);
 assert.ok(x.calls.some(v=>v.sql==='ROLLBACK'));
 assert.equal(x.released,true);
});
test('scope uses stored Order FK and native writer source, not names or legacy references',async()=>{
 const x=setup();const out=await readOrderFinancialResult(x.pool,order,{authorizeOwner:()=>true});
 assert.equal(out.orderId,order);assert.equal(out.currency,'AMD');
 assert.equal(out.readonly,true);assert.equal(out.historicalIncluded,false);
 assert.equal(out.source,'CLEAN_NATIVE_ORDER_LEDGER');
 assert.equal(out.metrics.receivedBase,'10000.000000');
 assert.equal(out.metrics.advanceBase,'10000.000000');
 assert.deepEqual(out.items.map(i=>i.id),[tx]);
 assert.ok(x.released);
 const queries=x.calls.filter(c=>c.sql.includes('mvp_finance_native.transactions'));
 assert.equal(queries.length,2);
 for(const q of queries){
  assert.match(q.sql,/work_order_id=\$1::uuid/);
  assert.match(q.sql,/source_system='CLEAN_NATIVE_FINANCE'/);
  assert.deepEqual(q.params[0],order);
  assert.doesNotMatch(q.sql,/mvp_history|source_records|client_name|order_title/);
 }
 assert.match(queries[0].sql,/status='active'/);
 assert.match(queries[0].sql,/commission_base/);
 assert.match(queries[0].sql,/worker_payable_effect_base/);
 assert.match(queries[1].sql,/LIMIT \$4/);
 assert.match(queries[1].sql,/created_at::text AS created_at_exact/);
 assert.match(queries[1].sql,/ORDER BY created_at DESC,finance_transaction_id DESC/);
 assert.match(x.calls[0].sql,/REPEATABLE READ READ ONLY/);
});
test('history pagination never truncates aggregate totals and cursor is order-bound',async()=>{
 const rows=[receipt,{...receipt,id:other,created_at_exact:'2026-11-22 10:00:00.123455+00'}];
 const x=setup({history:rows,summary:{...zero,total_count:210,active_count:205,
  received_base:'123000.000000'}});
 const a=await readOrderFinancialResult(x.pool,order,{authorizeOwner:()=>true,limit:1});
 assert.equal(a.totalCount,210);assert.equal(a.metrics.receivedBase,'123000.000000');
 assert.equal(a.items.length,1);assert.equal(a.hasMore,true);assert.ok(a.nextCursor);
 await assert.rejects(readOrderFinancialResult(x.pool,other,{authorizeOwner:()=>true,cursor:a.nextCursor}),
  e=>e.status===400&&e.code==='B23_CURSOR_INVALID');
 const second=await readOrderFinancialResult(x.pool,order,{authorizeOwner:()=>true,cursor:a.nextCursor,limit:1});
 assert.equal(second.items.length,1);
 const historyCall=x.calls.filter(v=>v.sql.includes('finance_transaction_id::text AS id')).pop();
 assert.equal(historyCall.params[0],order);assert.equal(historyCall.params[3],2);
 assert.equal(historyCall.params[2],tx);
 assert.equal(historyCall.params[1],'2026-11-23 10:00:00.123456+00');
});
test('zero linked records are distinguishable from a populated zero-balance result',async()=>{
 const x=setup({history:[],summary:{...zero,total_count:0,active_count:0}});
 const res=await readOrderFinancialResult(x.pool,order,{authorizeOwner:()=>true});
 assert.equal(res.totalCount,0);assert.equal(res.items.length,0);
 assert.equal(res.metrics.cashBalanceBase,'0.000000');
});
test('Order card retains original work/contact/status actions and adds read-only finance',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 for(const key of ['orderFinanceView(x)+orderWorklogsView(x)+orderContactsView(x)',
  'data-order-finance-more','data-order-finance-retry','loadOrderFinance(orderDetailId)',
  'data-order-open-object','data-order-logs-more','data-order-contact-more',
  'work_start_order','data-workflow-open="log"'])
  assert.ok(app.includes(key),key);
 assert.match(server,/readOrderFinancialResult\(pool/);
 assert.match(server,/pathname==='\/api\/finance\/order-native-result'/);
 assert.doesNotMatch(server,/case 'finance_order_result_create'/);
});
