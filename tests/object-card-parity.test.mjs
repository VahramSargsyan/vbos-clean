import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {objectCardOrdersRead} from '../object-card-orders.mjs';

class ApiError extends Error{
 constructor(status,message){super(message);this.status=status;}
}
const objectId='2fa681ab-9652-42b0-a32c-428167a97aa2';
const clientId='396c6cfa-ae2c-4d91-b63b-d31bad39b7fe';
const otherObject='358ff6ba-902c-4ca6-8e7f-02fdb31e9ca5';
const order=i=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,
 object_id:objectId,title:`Заказ ${i}`,status:'active',
 created_at:new Date(Date.UTC(2026,10,17)-i*60000).toISOString(),
 cursor_created_at:new Date(Date.UTC(2026,10,17)-i*60000).toISOString().replace('Z','000Z')});
const harness=({parents=[{id:objectId,client_id:clientId}],orders=[order(1)]}={})=>{
 const calls=[];
 const pool={async query(sql,args){
  calls.push({sql,args});
  return {rows:structuredClone(calls.length===1?parents:orders)};
 }};
 return {calls,run:(cursor=null)=>objectCardOrdersRead({pool,objectId,cursor,uuid:x=>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x))
   throw new ApiError(400,'Неверный UUID.');
  return x;
 },AppError:ApiError})};
};

test('legacy object card: only exact parent object orders, deterministic last 100',async()=>{
 const q=harness({orders:[order(2),order(1)]}),result=await q.run();
 assert.equal(result.objectId,objectId);
 assert.equal(result.clientId,clientId);
 assert.deepEqual(result.items.map(x=>x.title),['Заказ 2','Заказ 1']);
 assert.equal(result.hasMore,false);
 assert.equal(result.nextCursor,null);
 assert.deepEqual(q.calls[0].args,[objectId]);
 assert.deepEqual(q.calls[1].args,[objectId]);
 assert.match(q.calls[0].sql,/FROM public\.mvp_objects o JOIN public\.mvp_clients c ON c\.id=o\.client_id WHERE o\.id=\$1 LIMIT 1/);
 assert.match(q.calls[1].sql,/FROM public\.mvp_orders WHERE object_id=\$1/);
 assert.match(q.calls[1].sql,/ORDER BY created_at DESC,id DESC LIMIT 101/);
 assert.doesNotMatch(q.calls[1].sql,/\b(?:UPDATE|INSERT|DELETE)\b/i);
});

test('object page never exposes orders from another object',async()=>{
 const q=harness({orders:[{...order(1),object_id:otherObject}]});
 await assert.rejects(q.run(),e=>e.status===503);
});

test('unknown object returns 404; never queries unrelated orders',async()=>{
 const q=harness({parents:[]});
 await assert.rejects(q.run(),e=>e.status===404);
 assert.equal(q.calls.length,1);
});

test('more than 100 marks incomplete without fabricating completeness',async()=>{
 const q=harness({orders:Array.from({length:101},(_,i)=>order(i))});
 const result=await q.run();
 assert.equal(result.items.length,100);
 assert.equal(result.hasMore,true);
 assert.equal(result.limit,100);
 assert.equal(typeof result.nextCursor,'string');
 const cursor=JSON.parse(Buffer.from(result.nextCursor,'base64url').toString('utf8'));
 assert.deepEqual(cursor,[objectId,order(99).cursor_created_at,order(99).id]);
});


test('object card page 2 uses exact Object-bound keyset cursor and no duplicate first page',async()=>{
 const calls=[];
 const page1=Array.from({length:101},(_,i)=>order(i));
 const page2=[order(100),order(101)];
 const pool={async query(sql,args){
  calls.push({sql,args});
  if(calls.length===1||calls.length===3)
   return {rows:[{id:objectId,client_id:clientId,name:'Квартира',client_name:'Клиент'}]};
  return {rows:structuredClone(calls.length===2?page1:page2)};
 }};
 const validId=x=>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x))
   throw new ApiError(400,'Invalid UUID');
  return x;
 };
 const first=await objectCardOrdersRead({pool,objectId,uuid:validId,AppError:ApiError});
 assert.equal(first.items.length,100);
 assert.equal(first.hasMore,true);
 const second=await objectCardOrdersRead({pool,objectId,cursor:first.nextCursor,uuid:validId,AppError:ApiError});
 assert.deepEqual(second.items.map(x=>x.id),page2.map(x=>x.id));
 assert.equal(second.hasMore,false);
 assert.equal(second.nextCursor,null);
 assert.match(calls[3].sql,/object_id=\$1 AND \(created_at,id\)<\(\$2::timestamptz,\$3::uuid\)/);
 assert.deepEqual(calls[3].args,[objectId,order(99).cursor_created_at,order(99).id]);
 assert.equal(new Set(first.items.concat(second.items).map(x=>x.id)).size,102);
});

test('microsecond-precise PostgreSQL pagination visits all 205 same-timestamp Orders',async()=>{
 const stamp='2026-11-17T09:00:00.123456Z';
 const rows=Array.from({length:205},(_,i)=>({...order(204-i),
  created_at:'2026-11-17T09:00:00.123Z',cursor_created_at:stamp}));
 let pageReads=0;
 const pool={async query(sql,args){
  if(sql.includes('FROM public.mvp_objects o'))return {rows:[{id:objectId,client_id:clientId,name:'Object',client_name:'Client'}]};
  pageReads++;
  const selected=args.length===3?rows.filter(r=>
   r.cursor_created_at<args[1]||(r.cursor_created_at===args[1]&&r.id<args[2])):rows;
  return {rows:structuredClone(selected.slice(0,101))};
 }};
 const validId=x=>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x))
   throw new ApiError(400,'Invalid UUID');
  return x;
 };
 const pages=[],all=[];
 let cursor=null;
 for(let i=0;i<4;i++){
  const result=await objectCardOrdersRead({pool,objectId,cursor,uuid:validId,AppError:ApiError});
  pages.push(result.items.length);all.push(...result.items);
  assert.ok(result.items.every(item=>!('cursor_created_at' in item)),
   'Internal exact timestamp does not become a public field');
  if(!result.hasMore)break;
  cursor=result.nextCursor;
 }
 assert.deepEqual(pages,[100,100,5]);
 assert.equal(new Set(all.map(x=>x.id)).size,205);
 assert.equal(pageReads,3);
});

test('malformed or foreign Object cursor fails before ANY database query',async()=>{
 const validId=x=>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x))
   throw new ApiError(400,'Invalid UUID');
  return x;
 };
 const foreign=Buffer.from(JSON.stringify([otherObject,order(99).cursor_created_at,order(99).id])).toString('base64url');
 const wrongTime=Buffer.from(JSON.stringify([objectId,'not-a-date',order(99).id])).toString('base64url');
 const wrongId=Buffer.from(JSON.stringify([objectId,order(99).cursor_created_at,'not-a-uuid'])).toString('base64url');
 for(const cursor of [foreign,wrongTime,wrongId,'%%%','a'.repeat(361)]){
  let queries=0;
  await assert.rejects(objectCardOrdersRead({pool:{query:async()=>{queries++;return {rows:[]};}},
   objectId,cursor,uuid:validId,AppError:ApiError}),error=>error.status===400);
  assert.equal(queries,0,'Cursor must not touch PostgreSQL when invalid');
 }
});

test('Object UI shows on-demand exact history and rejects repeated page items',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const start=app.indexOf('async function loadObjectCardOrders(id,append=false){');
 const end=app.indexOf('async function loadObjectContacts(',start);
 assert.ok(start>=0&&end>start);
 const loader=app.slice(start,end);
 assert.match(loader,/state\.items\.concat\(source\.items\)/);
 assert.match(loader,/new Set\(items\.map\(item=>item\.id\)\)/);
 assert.match(loader,/source\.items\.some\(item=>item\.object_id!==id\)/);
 assert.match(loader,/encodeURIComponent\(state\.nextCursor\)/);
 assert.match(app,/Показать ещё 100 заказов/);
 assert.match(app,/data-object-orders-more/);
 assert.doesNotMatch(loader,/\b(?:INSERT INTO|DELETE FROM|UPDATE public)\b/);
});

test('invalid object ID is rejected before database access',async()=>{
 let calls=0;
 await assert.rejects(objectCardOrdersRead({
  pool:{query:async()=>{calls++;return {rows:[]};}},objectId:'not-a-uuid',
  uuid:()=>{throw new ApiError(400,'Bad id');},AppError:ApiError
 }),e=>e.status===400);
 assert.equal(calls,0);
});

test('object card keeps original create/order navigation and no invented object lifecycle writer',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(app,/function objectDetails\(x\)/);
 assert.match(app,/data-object-client-open/);
 assert.match(app,/async function loadObjectCardOrders\(id,append=false\)/);
 assert.match(app,/api\/objects\/orders\?id=/);
 assert.match(app,/Заказы объекта/);
 assert.match(app,/form\('order_create','\+ Новый заказ',orderFields\)/);
 assert.match(app,/name="objectId"/);
 assert.match(app,/objectOrdersCard\.items\.find\(order=>order\.id===orderDetailId\)/);
 assert.match(app,/if\(tab==='orders'&&objectReturnId\)/);
 assert.match(server,/objectCardOrdersRead\(\{pool,objectId:url\.searchParams\.get\('id'\),\s*cursor:url\.searchParams\.get\('cursor'\),uuid,AppError\}\)/);
 assert.match(app,/data-object-orders-more/);
 assert.match(app,/loadObjectCardOrders\(objectDetailId,true\)/);
 assert.ok(server.indexOf("if(!sessionValid(req))") < server.indexOf("pathname==='/api/objects/orders'"));
 assert.doesNotMatch(app,/object_archive|set_object_status|object_type_create/);
});
