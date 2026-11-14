import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalOrdersPage, historicalOrderDetail, HistoryOrdersAccessError} from '../history-orders-api.mjs';

const batchId = 'FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const counts = {LEAD:33,CLIENT:17,OBJECT:19,WORKER:2,WORK_ORDER:22,CLIENT_ASSESSMENT:13,WORKER_ASSIGNMENT:1,FINANCE_TRANSACTION:24};
const base = () => {
  const calls=[];
  const db={query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('FROM mvp_history.import_batches')) return {rows:[{batch_id:batchId,expected_counts:counts,reconciled_counts:{...counts},verified_manifest_sha256:'f'.repeat(64)}]};
    if(sql.includes('AS legacy_order_id') && sql.includes('AND r.source_id=$2')) return {rows:[{legacy_order_id:args[1],title:'Exact source row',status:'active'}]};
    if(sql.includes('AS legacy_order_id')) return {rows:[
      {legacy_order_id:'WO-2026-0024',title:'Alabyan roof',status:'active'},
      {legacy_order_id:'WO-2026-0018',title:'Completed',status:'completed'}
    ]};
    throw Error('UNEXPECTED_QUERY');
  }};
  return {db,calls};
};
const u=(x='')=>new URL('https://test.local/api/history/orders'+x);
const auth=()=>true;
const opts={authorizeOwner:auth,batchId};
const rejects=(fn,status,code)=>assert.rejects(fn,e=>e instanceof HistoryOrdersAccessError&&e.status===status&&(code instanceof RegExp?code.test(e.code):e.code===code));

test('Unauthenticated page access never touches DB',async()=>{
  const {db,calls}=base();
  await rejects(()=>historicalOrdersPage(db,u(),{...opts,authorizeOwner:()=>false}),401,'OWNER_SESSION_REQUIRED');
  await rejects(()=>historicalOrdersPage(db,u(),{batchId}),401,'OWNER_SESSION_REQUIRED');
  assert.equal(calls.length,0);
});
test('Unauthenticated detail access never touches DB',async()=>{
  const {db,calls}=base();
  await rejects(()=>historicalOrderDetail(db,'WO-2026-0024',{...opts,authorizeOwner:async()=>false}),401,'OWNER_SESSION_REQUIRED');
  assert.equal(calls.length,0);
});
test('Receipt mandatory, no unapproved batch',async()=>{
  const {db}=base();
  db.query=async()=>({rows:[]});
  await rejects(()=>historicalOrdersPage(db,u(),opts),503,'HISTORY_NOT_RECONCILED');
});
test('Changed receipt counters fail closed',async()=>{
  const {db}=base();
  db.query=async()=>({rows:[{expected_counts:counts,reconciled_counts:{...counts,WORK_ORDER:21}}]});
  await rejects(()=>historicalOrdersPage(db,u(),opts),503,'HISTORY_NOT_RECONCILED');
});
test('Missing exact batch ID blocks even authorized owner',async()=>{
  const {db,calls}=base();
  await rejects(()=>historicalOrdersPage(db,u(),{authorizeOwner:auth,batchId:'bad'}),503,'HISTORY_BATCH_NOT_CONFIGURED');
  assert.equal(calls.length,0);
});
test('Finished history default excludes active jobs at SQL boundary',async()=>{
  const {db,calls}=base();
  const r=await historicalOrdersPage(db,u(),opts);
  assert.deepEqual(calls[1].args.slice(0,2),[batchId,['completed','archived']]);
  assert.equal(r.scope,'finished');
  assert.equal(r.readonly,true);
  assert.equal(r.source,'VERIFIED_HISTORY_NOT_OPERATIONAL_ORDERS');
  assert.ok(calls[1].sql.includes('r.original_status=ANY($2::text[])'));
  assert.ok(!calls[1].sql.includes('INSERT'));
});
test('Unfinished includes active Alabyan separately',async()=>{
  const {db,calls}=base();
  await historicalOrdersPage(db,u('?scope=unfinished&limit=1'),opts);
  assert.deepEqual(calls[1].args[1],['draft','planned','active']);
  assert.equal(calls[1].args.at(-1),2);
});
test('Search uses params and literal substring, not wildcard expansion',async()=>{
  const {db,calls}=base();
  await historicalOrdersPage(db,u('?query=%25_%27%3B--'),opts);
  assert.ok(calls[1].sql.includes('strpos(lower('));
  assert.equal(calls[1].args[2],"%_';--");
  assert.ok(!calls[1].sql.includes("%_';--"));
});
test('Bounded keyset pages and immutable response',async()=>{
  const {db,calls}=base();
  const r=await historicalOrdersPage(db,u('?scope=all&limit=1&cursor=WO-2026-0025'),opts);
  assert.deepEqual(calls[1].args[1],['draft','planned','active','completed','archived']);
  assert.equal(calls[1].args[3],'WO-2026-0025');
  assert.equal(calls[1].args.at(-1),2);
  assert.equal(r.items.length,1);
  assert.equal(r.hasMore,true);
  assert.equal(r.nextCursor,'WO-2026-0024');
  assert.equal(Object.isFrozen(r.items),true);
  assert.equal(Object.isFrozen(r.items[0]),true);
});
test('Invalid params rejected after auth and receipt, with no list SQL',async()=>{
  for(const query of ['?limit=51','?limit=0','?limit=abc','?scope=cancelled','?query='+encodeURIComponent('a'.repeat(81)),'?cursor=a']){
    const {db,calls}=base();
    await rejects(()=>historicalOrdersPage(db,u(query),opts),400,/^INVALID_HISTORY_/);
    assert.equal(calls.length,1);
  }
});
test('Exact detail requires valid source ID and never uses a fuzzy name',async()=>{
  const {db,calls}=base();
  const r=await historicalOrderDetail(db,'WO-2026-0024',opts);
  assert.equal(r.legacy_order_id,'WO-2026-0024');
  assert.deepEqual(calls[1].args,[batchId,'WO-2026-0024']);
  assert.ok(calls[1].sql.includes('r.source_id=$2'));
});
test('Unknown detail returns 404 without dumping records',async()=>{
  const {db}=base();
  const orig=db.query; db.query=async(s,args)=>s.includes('FROM mvp_history.import_batches')?orig(s,args):{rows:[]};
  await rejects(()=>historicalOrderDetail(db,'WO-2026-9999',opts),404,'HISTORY_ORDER_NOT_FOUND');
});
test('Source-scoped SQL excludes shared operational mvp_orders',async()=>{
  const {db,calls}=base();
  await historicalOrdersPage(db,u(),opts);
  await historicalOrderDetail(db,'WO-2026-0018',opts);
  assert.ok(calls.every(x=>!x.sql.includes('public.mvp_orders')));
  assert.ok(calls.every(x=>!x.sql.includes('source_variants')));
});
