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
const order=i=>({id:`order-${i}`,object_id:objectId,title:`Заказ ${i}`,status:'active'});
const harness=({parents=[{id:objectId,client_id:clientId}],orders=[order(1)]}={})=>{
 const calls=[];
 const pool={async query(sql,args){
  calls.push({sql,args});
  return {rows:structuredClone(calls.length===1?parents:orders)};
 }};
 return {calls,run:()=>objectCardOrdersRead({pool,objectId,uuid:x=>{
  if(x!==objectId)throw new ApiError(400,'Неверный объект.');
  return x;
 },AppError:ApiError})};
};

test('legacy object card: only exact parent object orders, deterministic last 100',async()=>{
 const q=harness({orders:[order(2),order(1)]}),result=await q.run();
 assert.equal(result.objectId,objectId);
 assert.equal(result.clientId,clientId);
 assert.deepEqual(result.items.map(x=>x.title),['Заказ 2','Заказ 1']);
 assert.equal(result.hasMore,false);
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
 assert.match(app,/function loadObjectCardOrders\(id\)/);
 assert.match(app,/api\/objects\/orders\?id=/);
 assert.match(app,/Заказы объекта/);
 assert.match(app,/form\('order_create','\+ Новый заказ',orderFields\)/);
 assert.match(app,/name="objectId"/);
 assert.match(app,/objectOrdersCard\.items\.find\(order=>order\.id===orderDetailId\)/);
 assert.match(app,/if\(tab==='orders'&&objectReturnId\)/);
 assert.match(server,/objectCardOrdersRead\(\{pool,objectId:url\.searchParams\.get\('id'\),uuid,AppError\}\)/);
 assert.ok(server.indexOf("if(!sessionValid(req))") < server.indexOf("pathname==='/api/objects/orders'"));
 assert.doesNotMatch(app,/object_archive|set_object_status|object_type_create/);
});
