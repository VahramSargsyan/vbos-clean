import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {orderInteractionAction,orderInteractionsPage} from '../order-interactions.mjs';

class ApiError extends Error{
 constructor(status,message){super(message);this.status=status;}
}
const id='d0746f87-3931-4b41-b4f0-415bf077eab7',key='7b934973-320c-4fcd-9b2d-8040e391ab11';
function makeInput(overrides={}){
 return {entityType:'Order',entityId:id,interactionType:'call',summary:'Клиент позвонил',
  nextAction:'Перезвонить',nextActionAt:'2026-11-15T14:30',notes:'По этому объекту',...overrides};
}
function action(payload){
 let calls=0;
 return {run:()=>orderInteractionAction({pool:{connect:async()=>{calls++;return null;}},p:payload,key,
  uuid:x=>x,AppError:ApiError}),count:()=>calls};
}
test('old Object contact validates exact datetime-local without silently normalizing UTC',async()=>{
 for(const bad of ['2026-02-30T14:30','2026-11-15T24:00','2026-11-15T14:60',
  '2026-11-15','2026-11-15T14:30Z','javascript:alert(1)']){
  const q=action(makeInput({nextActionAt:bad}));
  await assert.rejects(q.run(),e=>e.status===400);
  assert.equal(q.count(),0);
 }
 for(const invalid of [
  {summary:''},{summary:'x'.repeat(1001)},{notes:'x'.repeat(5001)},
  {nextAction:''},{interactionType:'unknown'},{entityType:'Client'}
 ]){
  const q=action(makeInput(invalid));
  await assert.rejects(q.run(),e=>e.status===400);
  assert.equal(q.count(),0);
 }
});
test('order interaction list requires exact parent and bounded keyset',async()=>{
 const statements=[];
 const pool={query:async(sql,args)=>{
  statements.push({sql,args});
  if(statements.length===1)return {rowCount:1,rows:[{id}]};
  return {rowCount:0,rows:[]};
 }};
 const url=new URL('https://invalid.local/api/orders/interactions?id='+id+'&limit=20');
 const out=await orderInteractionsPage({pool,url,uuid:x=>x,AppError:ApiError});
 assert.equal(out.orderId,id);
 assert.equal(out.items.length,0);
 assert.equal(out.entityType,'Order');
 assert.deepEqual(statements[1].args,[id,21]);
 assert.match(statements[1].sql,/WHERE order_id=\$1 ORDER BY created_at DESC,id DESC LIMIT \$2/);
 assert.doesNotMatch(statements[1].sql,/\b(?:UPDATE|INSERT|DELETE)\b/i);
});
test('order contact cursor cannot be used on another order',async()=>{
 const cursor=Buffer.from(JSON.stringify([id,'2026-11-10T12:00:00.000Z',key])).toString('base64url');
 let queries=0;const pool={query:async()=>{queries++;return {rows:[],rowCount:0};}};
 const url=new URL('https://invalid.local/api/orders/interactions?id=other&cursor='+cursor);
 await assert.rejects(orderInteractionsPage({pool,url,uuid:x=>x,AppError:ApiError}),e=>e.status===400);
 assert.equal(queries,0);
});
test('order contact journal remains separate from Object contacts and WorkLogs',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const sql=readFileSync(new URL('../migrations/0033_order_contacts_CANDIDATE.sql',import.meta.url),'utf8');
 for(const phrase of ['Контакты по заказу','orderContactsView','order_interaction_add',
  'orderContactState','data-order-contact-more','loadOrderContacts']){
  assert.ok(app.includes(phrase),phrase);
 }
 assert.match(server,/if\(type==='order_interaction_add'\)return orderInteractionAction/);
 assert.match(server,/if\(pathname==='\/api\/orders\/interactions'/);
 assert.match(server,/orderInteractions:orderInteractionExport\.rows/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.mvp_order_interactions/);
 assert.match(sql,/order_id uuid NOT NULL REFERENCES public\.mvp_orders\(id\) ON DELETE RESTRICT/);
 assert.doesNotMatch(sql,/^\s*(?:DROP|TRUNCATE|DELETE|ALTER)\b/gim);
 assert.doesNotMatch(sql,/mvp_object_interactions|mvp_crm_interactions/);
});
