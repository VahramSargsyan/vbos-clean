import {test} from 'node:test';
import assert from 'node:assert/strict';
import {financeLegacyWorkersPage,FinanceLegacyReferenceError} from '../finance-legacy-reference-search.mjs';
const id1='11111111-1111-4111-8111-111111111111';
const id2='22222222-2222-4222-8222-222222222222';
const stamp1='2026-11-10T09:00:00.000000Z';
const stamp2='2026-11-09T09:00:00.000000Z';
function fixture(rows){
 const queries=[];
 const db={async query(sql,values){
  queries.push({sql,values});
  assert.match(sql,/^SELECT id,name,status,/);
  assert.match(sql,/FROM public\.mvp_workers/);
  assert.doesNotMatch(sql,/\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  return {rows};
 }};
 return {db,queries};
}
test('owner-only read, bounded two pages, no private worker fields in browser result',async()=>{
 const f=fixture([
  {id:id1,name:'Рубен',status:'active',phone:'PRIVATE',cursor_at:stamp1},
  {id:id2,name:'Арам',status:'inactive',phone:'PRIVATE',cursor_at:stamp2}
 ]);
 const first=await financeLegacyWorkersPage(f.db,new URL('https://example.test/api/finance/legacy-workers?q=%D0%B0%D0%BC&limit=1'),{authorizeOwner:()=>true});
 assert.equal(first.readonly,true);
 assert.equal(first.financeMappingVerified,false);
 assert.equal(first.hasMore,true);
 assert.equal(first.items.length,1);
 assert.equal(JSON.stringify(first).includes('PRIVATE'),false);
 assert.equal(f.queries[0].values[0],'ам');
 assert.equal(f.queries[0].values.at(-1),2);
 const next=await financeLegacyWorkersPage(f.db,new URL('https://example.test/api/finance/legacy-workers?q=%D0%B0%D0%BC&limit=1&cursor='+first.nextCursor),{authorizeOwner:()=>true});
 assert.deepEqual(f.queries[1].values.slice(0,3),['ам',stamp1,id1]);
 assert.equal(next.items[0].name,'Рубен');
});
test('unauthenticated directory never issues SQL',async()=>{
 const f=fixture([]);
 await assert.rejects(financeLegacyWorkersPage(f.db,'/api/finance/legacy-workers',{authorizeOwner:()=>false}),
  err=>err instanceof FinanceLegacyReferenceError&&err.status===401);
 assert.equal(f.queries.length,0);
});
test('invalid term, limit and replayed cursor fail before SQL',async()=>{
 const f=fixture([]);
 for(const query of ['?q=x','?q='+('x'.repeat(81)),'?limit=100','?limit=0','?limit=0.3',
  '?q=ben&cursor=abc','?q=x%0Ayz']){
  await assert.rejects(financeLegacyWorkersPage(f.db,'/api/finance/legacy-workers'+query,{authorizeOwner:()=>true}),
   err=>err instanceof FinanceLegacyReferenceError&&err.status===400);
 }
 const good=Buffer.from(JSON.stringify(['ben',stamp1,id1])).toString('base64url');
 await assert.rejects(financeLegacyWorkersPage(f.db,'/api/finance/legacy-workers?q=other&cursor='+good,{authorizeOwner:()=>true}),{status:400});
 assert.equal(f.queries.length,0);
});
test('missing/forged worker source rows and bad cursor fail closed',async()=>{
 const bad=fixture([{id:'fake',name:'Worker',status:'active'}]);
 await assert.rejects(financeLegacyWorkersPage(bad.db,'/api/finance/legacy-workers',{authorizeOwner:()=>true}),{status:503});
 const empty=fixture([{id:id1,name:'Worker',status:'active',cursor_at:''},{id:id2,name:'B',status:'active'}]);
 await assert.rejects(financeLegacyWorkersPage(empty.db,'/api/finance/legacy-workers?limit=1',{authorizeOwner:()=>true}),{status:503});
});
