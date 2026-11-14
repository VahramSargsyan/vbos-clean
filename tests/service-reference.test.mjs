import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceCatalogPage,REFERENCE_BATCH,REFERENCE_SOURCE_MANIFEST,REFERENCE_SOURCE_MODIFIED,ReferenceCatalogError,ACTION_LABELS} from '../service-reference.mjs';
import {renderReferencePanel,mountReferencePanel} from '../public/service-reference-view.mjs';

const url=q=>new URL('http://localhost/api/reference/services'+(q?'?'+q:''));
const fixture=(rows=[{serviceId:'SRV-TEST-0001',serviceName:'Установка',category:'Сантехника',defaultUnit:'item',actionCode:'INSTALL',masterPrices:[{masterPriceId:'MPR-TEST-0001',masterId:'MST-TEST-0001',priceType:'range',priceFrom:'3000.0000',priceTo:'5000.0000',currency:'AMD',unit:'item',validFrom:'2026-08-16'}]}])=>{
 const calls=[];
 return {db:{async query(sql,params){calls.push({sql,params});if(calls.length===1)return {rows:[{services_count:37,prices_count:1}]};return {rows};}},calls};
};
test('no DB I/O before owner auth',async()=>{
 let calls=0;const db={query:()=>{calls++;throw Error('must not read');}};
 await assert.rejects(referenceCatalogPage(db,url(),{authorizeOwner:()=>false}),e=>e instanceof ReferenceCatalogError&&e.status===401);
 assert.equal(calls,0);
});
test('wrong or unverified receipt closes access',async()=>{
 const db={query:async()=>({rows:[]})};
 await assert.rejects(referenceCatalogPage(db,url(),{authorizeOwner:()=>true}),e=>e.status===503);
 const f=fixture();
 await assert.rejects(referenceCatalogPage(f.db,url(),{authorizeOwner:()=>true,batchId:'other'}),e=>e.status===503);
 assert.equal(f.calls.length,0);
});
test('bounds, fixed source batch and parameterized search cursor',async()=>{
 const {db,calls}=fixture();
 const res=await referenceCatalogPage(db,url('q=%3Cbad%3E&action=INSTALL&cursor=SRV-TEST-0000&limit=1'),{authorizeOwner:()=>true});
 assert.equal(res.readonly,true);assert.equal(res.items.length,1);assert.equal(res.expectedServices,37);
 assert.equal(res.source,'LEGACY_GOOGLE_REFERENCE_SNAPSHOT_NOT_AUTHORITY');
 assert.deepEqual(calls[0].params,[REFERENCE_BATCH,REFERENCE_SOURCE_MANIFEST,REFERENCE_SOURCE_MODIFIED]);
 assert.deepEqual(calls[1].params,[REFERENCE_BATCH,'<bad>','INSTALL','SRV-TEST-0000',2]);
 assert.match(calls[1].sql,/s\.status='active'/);
 assert.match(calls[1].sql,/mp\.status='active'/);
 assert.ok(!calls[1].sql.includes('<bad>'),'SQL not interpolated from query');
 assert.equal(ACTION_LABELS.INSTALL,'Установка');
});
test('invalid filters denied without list fetch',async()=>{
 for(const query of ['limit=51','limit=0','limit=1e3','action=MAKE_UP','cursor=%3Cscript%3E','q='+encodeURIComponent('x'.repeat(81))]){
  const {db,calls}=fixture();
  await assert.rejects(referenceCatalogPage(db,url(query),{authorizeOwner:()=>true}),e=>e.status===400,query);
  assert.equal(calls.length,1,'source receipt check only');
 }
});
test('unverified source count, not empty success',async()=>{
 let db={query:async()=>({rows:[{services_count:36,prices_count:1}]})};
 await assert.rejects(referenceCatalogPage(db,url(),{authorizeOwner:()=>true}),e=>e.status===503);
});
test('UI escapes legacy strings and treats price as master-specific only',()=>{
 const s=renderReferencePanel({items:[{serviceId:'SRV-1',serviceName:'<script>alert(1)</script>',category:'A&B',defaultUnit:'item',actionCode:'',masterPrices:[{masterId:'MST-0001',priceFrom:'3000.0000',priceTo:'5000.0000',currency:'AMD',unit:'item',validFrom:'2026-08-16'}]}],hasMore:false});
 assert.doesNotMatch(s,/<script>/);
 assert.match(s,/&lt;script&gt;/);
 assert.match(s,/A&amp;B/);
 assert.match(s,/Не классифицировано/);
 assert.match(s,/Расценка мастера MST-0001/);
 assert.match(s,/3\u00a0000–5\u00a0000/);
 assert.doesNotMatch(s,/фактическ(?:ий|ая) доход/);
 assert.match(s,/не являются общими тарифами/);
});
test('UI refuses scriptable search and stale async mounts',async()=>{
 assert.throws(()=>renderReferencePanel({items:[]},{action:'evil'}));
 const handlers=new Map();
 const root={innerHTML:'',addEventListener:(k,fn)=>handlers.set(k,fn),removeEventListener:(k,fn)=>{if(handlers.get(k)===fn)handlers.delete(k);}};
 let reply;const panel=mountReferencePanel(root,{fetchPage:()=>new Promise(r=>{reply=r;})});
 assert.match(root.innerHTML,/Загрузка услуг/);
 panel.unmount();
 reply({readonly:true,source:'LEGACY_GOOGLE_REFERENCE_SNAPSHOT_NOT_AUTHORITY',items:[{serviceName:'STALE'}]});
 await Promise.resolve();await Promise.resolve();
 assert.doesNotMatch(root.innerHTML,/STALE/);
 assert.equal(handlers.size,0);
});
