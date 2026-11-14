import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {guardedClientAction} from '../crm-client-duplicates.mjs';

const legacy=readFileSync(new URL('../../../CrmService.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const allowed=(value,options)=>{if(!options.includes(value))throw Error('INVALID_ENUM');return value;};
const text=(value,max=160)=>{
 const s=String(value??'').trim();
 if(s.length>max)throw Error('TOO_LONG');return s;
};
const name=(value,max)=>{const s=text(value,max);if(!s)throw Error('MISSING_NAME');return s;};
const rev=value=>{const n=Number(value);if(!Number.isInteger(n)||n<1)throw Error('INVALID_REV');return n;};
const uuid=s=>String(s);
class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
const context={uuid,safeRevision:rev,requireText:name,optText:text,allow:allowed,AppError};
test('legacy direct Client duplicate policy uses canonical phone (00/0/374) and excludes archived',()=>{
 assert.match(legacy,/function normalizePhoneForMatch_\(/);
 assert.match(legacy,/digits\.indexOf\('00'\)===0\s*&&\s*digits\.length>10/);
 assert.match(legacy,/digits\.length===9\s*&&\s*digits\.charAt\(0\)==='0'/);
 assert.match(legacy,/function findNonArchivedClientsByPhone_\(/);
 assert.match(legacy,/function findCanonicalNonArchivedClientsByPhone_\(/);
 assert.match(legacy,/String\(client\.status\)!=='archived'/);
 assert.match(legacy,/function saveClientService_\(/);
 assert.match(legacy,/findActiveClientByPhone_\(changes\.phone,existing\.clientId\)/);
});
test('guarded transaction holds exact lead conversion advisory namespace BEFORE checking candidate list and insert',()=>{
 const s=readFileSync(new URL('../crm-client-duplicates.mjs',import.meta.url),'utf8');
 assert.match(s,/pg_advisory_xact_lock\(151106,hashtext\(\$1::text\)\)/);
 assert.match(s,/public\.mvp_crm_phone_canonical/);
 assert.match(s,/status<>'archived'/);
 assert.match(s,/AND id<>\$2/);
 assert.ok(s.indexOf('pg_advisory_xact_lock')<s.indexOf("SELECT id,name,phone FROM public.mvp_clients"));
 assert.match(s,/ON CONFLICT\(request_key\) DO UPDATE SET request_key=EXCLUDED\.request_key/);
 assert.match(s,/WHERE id=\$1 AND revision=\$2/);
 assert.match(s,/ROLLBACK/);
});
function fakePool({matches=[],previous=[],record=null}={}){
 const actions=[];
 const query=async(sql,args=[])=>{
  actions.push({sql,args});
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
  if(sql.startsWith('SELECT public.mvp_crm_phone_canonical')){
   const digits=String(args[0]||'').replace(/\D/g,'');let n=digits;
   if(n.startsWith('00')&&n.length>10)n=n.slice(2);
   if(n.length===9&&n.startsWith('0'))n='374'+n.slice(1);
   return {rows:[{normalized:n}]};
  }
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
  if(sql.startsWith('SELECT * FROM public.mvp_clients'))return {rows:previous};
  if(sql.startsWith('SELECT id,revision,status'))return {rows:record?[record]:[]};
  if(sql.startsWith('SELECT id,name,phone'))return {rows:matches};
  if(sql.startsWith('INSERT INTO public.mvp_clients'))return {rows:[{id:'new-id',phone:args[2]}]};
  if(sql.startsWith('UPDATE public.mvp_clients'))return {rows:[{id:args[0],revision:args[1]+1}]};
  throw Error('Unexpected query: '+sql);
 };
 return {actions,pool:{connect:async()=>({query,release:()=>actions.push({sql:'RELEASE'})})}};
}
test('existing one/multiple Client blocks create without any write and leaves owner hints',async()=>{
 for(const count of [1,2]){
  const matches=Array.from({length:count},(_,i)=>({id:'existing-'+i,name:'Client '+i,phone:'37494111222'}));
  const db=fakePool({matches});
  await assert.rejects(()=>guardedClientAction({pool:db.pool,type:'client_create',p:{
   name:'New',phone:'094111222'},key:'request-1',...context}),e=>e.status===409&&/клиент/i.test(e.message));
  assert.equal(db.actions.some(x=>x.sql.startsWith('INSERT INTO public.mvp_clients')),false);
  assert.ok(db.actions.some(x=>x.sql==='ROLLBACK'));
  assert.ok(db.actions.some(x=>x.sql==='RELEASE'));
 }
});
test('create replay of same key returns canonical existing row and never reassigns it',async()=>{
 const existing={id:'existing-id',name:'Saved',phone:'094111222'};
 const db=fakePool({previous:[existing],matches:[existing]});
 const got=await guardedClientAction({pool:db.pool,type:'client_create',p:{name:'Other',
  phone:'+374 94 111 222'},key:'same-key',...context});
 assert.equal(got.item.id,'existing-id');assert.equal(got.deduplicatedRequest,true);
 assert.equal(db.actions.some(x=>x.sql.startsWith('INSERT INTO public.mvp_clients')),false);
 assert.ok(db.actions.some(x=>x.sql==='COMMIT'));
});
test('editing own phone excludes self; archived transition allowed; conflicting updates do not overwrite',async()=>{
 const owned={id:'self-id',revision:2,status:'active'};
 const db=fakePool({record:owned});
 const result=await guardedClientAction({pool:db.pool,type:'client_update',p:{
  id:'self-id',revision:2,name:'Client',phone:'+374 94 111 222',notes:'',
 },key:'request',...context});
 assert.equal(result.saved,true);
 const match=db.actions.find(x=>x.sql.startsWith('SELECT id,name,phone'));
 assert.deepEqual(match.args,['37494111222','self-id']);
 const dup=fakePool({record:owned,matches:[{id:'other-id',name:'Other'}]});
 await assert.rejects(()=>guardedClientAction({pool:dup.pool,type:'client_update',p:{
  id:'self-id',revision:2,name:'Client',phone:'094111222',notes:'',
 },key:'request',...context}),e=>e.status===409);
 assert.equal(dup.actions.some(x=>x.sql.startsWith('UPDATE public.mvp_clients')),false);
 const archived=fakePool({record:owned,matches:[{id:'other-id',name:'Other'}]});
 const res=await guardedClientAction({pool:archived.pool,type:'client_update',p:{
  id:'self-id',revision:2,name:'Client',phone:'094111222',status:'archived'
 },key:'request',...context});
 assert.equal(res.saved,true);
 assert.equal(archived.actions.some(x=>x.sql.startsWith('SELECT id,name,phone')),false);
});
test('Client UI warns before save, offers explicit open, does not pretend loaded list is authority',()=>{
 assert.match(server,/if\(type==='client_create'\|\|type==='client_update'\)return guardedClientAction/);
 assert.match(ui,/data-client-duplicate-hint/);
 assert.match(ui,/refreshClientDuplicateHint/);
 assert.match(ui,/data-client-duplicate-open/);
 assert.match(ui,/Сервер проверит всю базу/);
 assert.match(ui,/crmPhoneKey\(x\.phone\)===normalized/);
 assert.match(ui,/x\.status!=='archived'/);
});
