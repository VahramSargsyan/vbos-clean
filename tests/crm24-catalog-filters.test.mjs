import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalogSearch} from '../catalog.mjs';

class ApiError extends Error {
 constructor(status,message){super(message);this.status=status;}
}
const rowId='a461b0f1-3917-4bb7-aa45-7ba550bb9bcd';
const nextId='99257f09-67a9-41a6-99dd-08346a5c5715';
const stamp='2026-11-08T10:12:11.123456Z';
const make=(query,rows=[])=>{
 const calls=[];
 const pool={async query(sql,args){calls.push({sql,args});return {rows:structuredClone(rows)};}};
 const target=new URL('http://localhost/api/catalog?'+query);
 return {calls,run:()=>catalogSearch(target,{pool,AppError:ApiError,uuid:x=>x})};
};

test('CRM24 client filters are parameterized and apply before PostgreSQL pagination',async()=>{
 const q=make('entity=clients&q=Armenian&status=active&tier=vip&referral=one');
 const r=await q.run(),{sql,args}=q.calls[0];
 assert.equal(r.status,'active');
 assert.equal(r.tier,'vip');
 assert.equal(r.referral,'one');
 assert.match(sql,/strpos\(lower\(concat_ws\('/);
 assert.match(sql,/t\.status=\$2/);
 assert.match(sql,/t\.client_tier=\$3/);
 assert.match(sql,/t\.referral_status=\$4/);
 assert.match(sql,/ORDER BY t\.created_at DESC,t\.id DESC LIMIT \$5/);
 assert.deepEqual(args,['Armenian','active','vip','one',26]);
 assert.deepEqual(r.items,[]);
});

test('CRM24 lead status, empty classifications, UUID and legacy unfiltered search',async()=>{
 const q=make('entity=leads&status=transferred&q=Example');
 await q.run();
 assert.match(q.calls[0].sql,/t\.status=\$2/);
 assert.deepEqual(q.calls[0].args,['Example','transferred',26]);

 const missing=make('entity=clients&tier=unset&referral=unset');
 await missing.run();
 assert.match(missing.calls[0].sql,/t\.client_tier=\$1/);
 assert.match(missing.calls[0].sql,/t\.referral_status=\$2/);
 assert.deepEqual(missing.calls[0].args,['','',26]);

 const exact=make('entity=clients&q='+rowId+'&status=active');
 await exact.run();
 assert.match(exact.calls[0].sql,/t\.id=\$1::uuid/);
 assert.match(exact.calls[0].sql,/t\.status=\$2/);
 assert.deepEqual(exact.calls[0].args,[rowId,'active',26]);

 const existing=make('entity=objects&q=room');
 await existing.run();
 assert.ok(!existing.calls[0].sql.includes('t.status='));
});

test('CRM24 filtered keyset binds ALL filter values; pages cannot cross selection',async()=>{
 const rows=[{id:rowId,cursor_at:stamp,name:'One'},{id:nextId,cursor_at:stamp,name:'Two'}];
 const page=make('entity=clients&q=Armenian&status=active&tier=vip&referral=one&limit=1',rows);
 const p=await page.run();
 assert.equal(p.items.length,1);
 assert.equal(p.items[0].cursor_at,undefined);
 assert.equal(p.hasMore,true);
 assert.ok(p.nextCursor);
 const decoded=JSON.parse(Buffer.from(p.nextCursor,'base64url').toString('utf8'));
 assert.equal(decoded.length,5);
 assert.equal(decoded[2],JSON.stringify(['active','vip','one']));
 const later=make('entity=clients&q=Armenian&status=active&tier=vip&referral=one&limit=1&cursor='+p.nextCursor);
 await later.run();
 assert.match(later.calls[0].sql,/\(t\.created_at,t\.id\)<\(\$5::timestamptz,\$6::uuid\)/);
 assert.equal(later.calls[0].args[4],stamp);
 assert.equal(later.calls[0].args[5],rowId);
 for(const suffix of [
  'status=inactive&tier=vip&referral=one',
  'status=active&tier=regular&referral=one',
  'status=active&tier=vip&referral=active'
 ]) {
  const bad=make('entity=clients&q=Armenian&'+suffix+'&cursor='+p.nextCursor);
  await assert.rejects(bad.run(),e=>e.status===400);
  assert.equal(bad.calls.length,0);
 }
});

test('CRM24 V3 unfiltered 4-part cursor remains accepted',async()=>{
 const q=make('entity=leads&q=Armenian&limit=1',[{id:rowId,cursor_at:stamp},{id:nextId,cursor_at:stamp}]);
 const first=await q.run();
 assert.equal(JSON.parse(Buffer.from(first.nextCursor,'base64url').toString('utf8')).length,4);
 const old=make('entity=leads&q=Armenian&limit=1&cursor='+first.nextCursor);
 await old.run();
 assert.equal(old.calls[0].args.at(-2),rowId);
 const stale=make('entity=leads&q=Armenian&status=new&cursor='+first.nextCursor);
 await assert.rejects(stale.run(),e=>e.status===400);
});

test('CRM24 unsupported combinations, injection and cursor mutation fail closed',async()=>{
 for(const query of [
  'entity=leads&tier=vip','entity=orders&status=active',
  'entity=objects&referral=one','entity=clients&status=won',
  'entity=clients&tier=somebody','entity=clients&referral=bad',
  'entity=leads&status=transferred%27%20OR%201%3D1',
  'entity=clients&q=z','entity=clients&limit=501','entity=clients&cursor=bad'
 ]){
  const q=make(query);
  await assert.rejects(q.run(),e=>e.status===400,query);
  assert.equal(q.calls.length,0,query);
 }
});

test('CRM24 mobile filters, category resets and direct CRM/Client entry points',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/function catalogFilterSelect/);
 assert.match(app,/catalogFilterSelect\('status','Статус клиента'/);
 assert.match(app,/catalogFilterSelect\('tier','Уровень клиента'/);
 assert.match(app,/catalogFilterSelect\('referral','Рекомендации'/);
 assert.match(app,/catalogFilterSelect\('status','Статус лида'/);
 assert.match(app,/data-crm24-search="clients"/);
 assert.match(app,/data-crm24-search="leads"/);
 assert.match(app,/for\(const key of \['status','tier','referral'\]\)/);
 assert.match(app,/catalog\.nextCursor=null/);
 assert.match(app,/catalog\.status=fields\.status\|\|''/);
 assert.doesNotMatch(app,/data-crm24-search.*api\/action/);
});
