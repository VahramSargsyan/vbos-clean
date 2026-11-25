import test from 'node:test';
import assert from 'node:assert/strict';
import {pricePayload,masterPricesRead,masterPriceSave} from '../master-prices.mjs';
import {renderPrices,quoteText} from '../public/master-prices-view.mjs';
class E extends Error{constructor(status,message){super(message);this.status=status}}
const masterId='12345678-1234-4234-8234-123456789012',key='12345678-1234-4234-8234-123456789013',serviceId='SRV-2026-0001',priceId='MPR-2026-0002';
const good={masterId,serviceId,status:'active',priceType:'range',priceFrom:'2,50',priceTo:'3.0000',currency:'AMD',unit:'item',validFrom:'2026-11-25',notes:''};
const control={phase:'CLEAN',master_snapshot_hash:'a'.repeat(64),dependency_receipt_hash:'b'.repeat(64)};
const row={master_id:masterId,service_id:serviceId,master_price_id:priceId,status:'active',price_type:'range',price_from:'2.5000',price_to:'3.0000',currency:'AMD',unit:'item',revision:1};
test('MS3 exact decimal, dates, all legacy types and strict keys',()=>{
 assert.equal(pricePayload(good,E).priceFrom,'2.5000');
 assert.equal(pricePayload({...good,priceType:'estimate',priceFrom:'',priceTo:''},E).priceFrom,null);
 for(const type of ['fixed','from','per_unit'])assert.equal(pricePayload({...good,priceType:type,priceTo:''},E).priceTo,null);
 for(const bad of [{...good,priceTo:'2.4999'},{...good,priceFrom:'-1'},{...good,priceFrom:'1e4'},{...good,priceFrom:'1.00001'},{...good,validFrom:'2026-02-30'},{...good,currency:'RUB'},{...good,source_system:'CLEAN_NATIVE'},{...good,masterId:'MST-1'}])assert.throws(()=>pricePayload(bad,E),e=>e.status===400);
});
test('MS3 current comparison deduplicates effective prices, excludes archived masters, groups currency/unit; snapshots read only',async()=>{
 const calls=[];let phase='LEGACY';const pool={async query(sql,args){calls.push({sql,args});if(sql.includes('FROM public.mvp_masters_services_authority'))return {rows:[{...control,phase}]};if(sql.includes('FROM public.mvp_service_reference_batches'))return {rows:[{}]};return {rows:[{...row,master_uuid:masterId,is_current:true}]};}};
 const get=()=>masterPricesRead({pool,url:new URL('http://local/api/masters/prices?serviceId='+serviceId+'&sort=price'),AppError:E});
 const old=await get();assert.equal(old.writeEnabled,false);assert.equal(old.items[0].masterId,masterId);
 const sql=calls.at(-1).sql;assert.match(sql,/row_number\(\) OVER\(PARTITION BY m\.id,p\.service_id/);assert.match(sql,/WHERE rn=1/);assert.match(sql,/m\.status<>'archived'/);assert.match(sql,/Asia\/Yerevan/);assert.match(sql,/ORDER BY currency,unit/);
 phase='CLEAN';calls.length=0;assert.equal((await get()).writeEnabled,true);assert.match(calls.at(-1).sql,/mvp_master_prices_catalog p/);assert.doesNotMatch(calls.at(-1).sql,/mvp_master_prices_reference/);
});
test('MS3 authority, parent identity, stale revision, history and replay',async()=>{
 let phase='LEGACY',prior=null,old=null,archived=false;const calls=[];
 const db={async query(sql,args){calls.push({sql,args});if(sql.includes('FROM public.mvp_masters_services_authority'))return {rows:[{...control,phase}]};
 if(sql.startsWith('SELECT id,status'))return {rows:[{id:masterId,status:archived?'archived':'active'}]};
 if(sql.startsWith('SELECT service_id,status'))return {rows:[{service_id:serviceId,status:'active'}]};
 if(sql.startsWith('SELECT payload_sha256'))return {rows:prior?[prior]:[]};
 if(sql.startsWith('SELECT * FROM public.mvp_master_prices_catalog'))return {rows:old?[old]:[]};
 if(sql.startsWith('INSERT INTO public.mvp_master_prices_catalog_sequences'))return {rows:[{year:2026,last_value:2}]};
 if(sql.startsWith('INSERT INTO public.mvp_master_prices_catalog('))return {rows:[row]};
 if(sql.startsWith('UPDATE public.mvp_master_prices_catalog SET'))return {rows:[{...row,revision:2}]};
 if(sql.startsWith('INSERT INTO public.mvp_master_prices_catalog_requests'))prior={payload_sha256:args[1],response:JSON.parse(args[2])};
 return {rows:[]};},release(){}};
 const save=p=>masterPriceSave({pool:{connect:async()=>db},p,key,AppError:E});
 await assert.rejects(save(good),e=>e.status===409);assert.equal(calls.some(x=>x.sql.startsWith('INSERT')),false);
 phase='CLEAN';archived=true;await assert.rejects(save(good),e=>e.status===409);archived=false;
 const made=await save(good);assert.equal(made.entityId,priceId);calls.length=0;assert.deepEqual(await save(good),made);assert.equal(calls.some(x=>x.sql.startsWith('INSERT')),false);
 prior=null;old={...row};await assert.rejects(save({...good,masterPriceId:priceId,revision:2}),e=>e.status===409);
 const result=await save({...good,masterPriceId:priceId,revision:1});assert.equal(result.data.revision,2);
 const before=calls.findIndex(x=>x.sql.startsWith('INSERT INTO public.mvp_master_prices_catalog_history'));const after=calls.findIndex(x=>x.sql.startsWith('UPDATE public.mvp_master_prices_catalog SET'));assert.ok(before>=0&&before<after);
 assert.doesNotMatch(calls[after].sql.split(' WHERE ')[0],/source_|master_id=|master_price_id=/);
});
test('MS3 UI escapes source and does not enable snapshot writes or convert currency',()=>{
 const x={masterPriceId:priceId,serviceName:'<script>',priceType:'range',priceFrom:'2.5000',priceTo:'3.0000',currency:'AMD',unit:'item',status:'active'};
 assert.match(quoteText(x),/2\.5–3 AMD/);
 const html=renderPrices({masterId,services:[],page:{items:[x],writeEnabled:false,source:'VERIFIED_LEGACY_SNAPSHOT'}});
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/data-ms3-new disabled/);assert.doesNotMatch(html,/data-ms3-edit=/);
});
