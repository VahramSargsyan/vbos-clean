import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {orderCardWorklogsRead} from '../order-card-worklogs.mjs';

class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const order='2969bc3b-2e7e-448c-8480-563b93d177a0',object='11ea3573-1c80-49b5-94e7-0fba93e6b69c';
const client='934193af-b398-45d9-a6f9-9e3443ac04a4',other='d4b0c61c-4db7-440f-8d4e-0cd34a3dd694';
const today='2026-11-11',stamp=new Date('2026-11-11T11:31:00.000Z');
const work=(id,o=order)=>({id,order_id:o,title:'Сделанная работа',day_date:today,created_at:stamp,minutes:60,quantity:2,unit:'м',notes:''});
const invoke=({parent=true,rows=[]}={})=>{
 const calls=[];
 const pool={async query(sql,args){
  calls.push({sql,args});
  return calls.length===1?
   {rows:parent?[{id:order,object_id:object,client_id:client,object_name:'Квартира',client_name:'Клиент'}]:[]}:
   {rows:structuredClone(rows)};
 }};
 const run=(path='/api/orders/worklogs?id='+order)=>orderCardWorklogsRead({
  pool,url:new URL(path,'http://localhost'),uuid:x=>x,AppError:ApiError});
 return {run,calls};
};
test('exact Order parent provides Object/Client links and only its own WorkLogs',async()=>{
 const x=invoke({rows:[work('1'),work('2')]}),out=await x.run();
 assert.equal(out.orderId,order);assert.equal(out.objectId,object);assert.equal(out.clientId,client);
 assert.deepEqual(out.items.map(x=>x.id),['1','2']);
 assert.equal(out.coverage,'CLEAN_NATIVE_WORKLOGS_ONLY');
 assert.equal(out.hasMore,false);
 assert.deepEqual(x.calls[0].args,[order]);
 assert.deepEqual(x.calls[1].args,[order,11]);
 assert.match(x.calls[1].sql,/WHERE l.order_id=\$1 ORDER BY l.day_date DESC,l.created_at DESC,l.id DESC LIMIT \$2/);
 assert.doesNotMatch(x.calls[1].sql,/\b(?:UPDATE|INSERT|DELETE)\b/i);
});
test('unknown Order blocks history query and cross-order row is rejected',async()=>{
 const missing=invoke({parent:false});
 await assert.rejects(missing.run(),e=>e.status===404);assert.equal(missing.calls.length,1);
 const foreign=invoke({rows:[work('1',other)]});
 await assert.rejects(foreign.run(),e=>e.status===503);
});
test('last ten pagination uses order-bound opaque cursor and hasMore',async()=>{
 const x=invoke({rows:Array.from({length:11},(_,i)=>work(String(i+1)))});
 const first=await x.run();
 assert.equal(first.items.length,10);assert.equal(first.hasMore,true);
 const cursor=JSON.parse(Buffer.from(first.nextCursor,'base64url').toString('utf8'));
 assert.deepEqual(cursor,[order,today,stamp.toISOString(),'10']);
 const q=invoke();
 await q.run('/api/orders/worklogs?id='+order+'&cursor='+encodeURIComponent(first.nextCursor));
 assert.match(q.calls[1].sql,/\(l.day_date,l.created_at,l.id\)<\(\$2::date,\$3::timestamptz,\$4::uuid\)/);
 assert.deepEqual(q.calls[1].args,[order,today,stamp.toISOString(),'10',11]);
});
test('foreign cursor, malformed cursor and nonexistent id fail before DB',async()=>{
 const enc=Buffer.from(JSON.stringify([other,today,stamp.toISOString(),client])).toString('base64url');
 for(const q of ['/api/orders/worklogs?id='+order+'&cursor='+enc,
   '/api/orders/worklogs?id='+order+'&cursor=!!!']){
  const t=invoke();await assert.rejects(t.run(q),e=>e.status===400);assert.equal(t.calls.length,0);
 }
});
test('legacy WorkOrder card controls bind canonical IDs without additional writer',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 for(const text of ['Фактические работы','loadOrderCardLogs','data-order-logs-more',
  'data-order-open-object','data-object-client-open','work_start_order',
  'data-workflow-open="log"']){
  assert.ok(app.includes(text),text);
 }
 const fullUI=readFileSync(new URL('../public/worklog-full-ui.js',import.meta.url),'utf8');
 assert.ok(fullUI.includes('name="orderId"'),'canonical Order UUID must travel in the full WorkLog form');
 assert.match(server,/orderCardWorklogsRead/);
 assert.match(server,/pathname==='\/api\/orders\/worklogs'/);
 assert.match(server,/if\(!sessionValid\(req\)\)/);
 assert.doesNotMatch(server,/case 'order_worklog_create'/);
});
