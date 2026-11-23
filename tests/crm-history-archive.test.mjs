import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {historicalCrmArchivePage,parseHistoricalCrmQuery,CrmHistoricalArchiveError} from '../crm-historical-archive.mjs';
import {renderHistoricalCrmPage,mountHistoricalCrmPage} from '../public/crm-history-archive-view.mjs';

const batch='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const counts={LEAD:33,CLIENT:17,OBJECT:19,WORKER:2,WORK_ORDER:22,CLIENT_ASSESSMENT:13,WORKER_ASSIGNMENT:1,FINANCE_TRANSACTION:24};
const url=s=>new URL('https://example.test/api/history/crm?'+s);
const record=(id='LEAD-example')=>({
 legacy_id:id,source_system:'LEGACY_GOOGLE',status:'new',
 title:'Работа на объекте',phone:'',address:'',need_summary:'Плановые работы',
 notes:'Примечание',legacy_client_id:null,legacy_object_id:null,legacy_lead_id:null,
 native_link_verified:false,hash_valid:true,readonly:true
});
class AppError extends Error{}
function db(rows=[record()],receipt=true){
 const calls=[];
 return {calls,pool:{query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.includes('FROM mvp_history.import_batches b JOIN mvp_history.batch_receipts'))
   return {rows:receipt?[{expected_counts:counts,reconciled_counts:counts}]:[]};
  if(sql.includes('FROM mvp_history.source_records r'))
   return {rows:structuredClone(rows)};
  throw new Error('UNEXPECTED_ARCHIVE_QUERY');
 }}};
}
const get=async(p,options={},path='type=leads')=>historicalCrmArchivePage(p,url(path),{
 authorizeOwner:()=>true,batchId:batch,...options
});
test('CRM history: strict owner and reconciled batch receipt before any source read',async()=>{
 const p=db();await assert.rejects(get(p,{authorizeOwner:()=>false}),e=>e.status===401);
 assert.equal(p.calls.length,0);
 const b=db([],false);await assert.rejects(get(b),e=>e.status===503);
 assert.equal(b.calls.length,1);
 await assert.rejects(get(db(),{batchId:'INVALID'}),e=>e.status===503);
});
test('CRM history: parameterized search, cursor, status and exact source projection',async()=>{
 const p=db([record('LEAD-55'),record('LEAD-54')]);
 const r=await get(p,{},'type=leads&q=hello%20world&status=open&limit=1');
 assert.equal(r.version,'CRM_HISTORICAL_BROWSER_V1');
 assert.equal(r.source,'FROZEN_LEGACY_CRM_ARCHIVE_ONLY');
 assert.equal(r.readonly,true);assert.equal(r.operational,false);
 assert.equal(r.items.length,1);assert.equal(r.hasMore,true);assert.equal(r.nextCursor,'LEAD-55');
 assert.equal(r.items[0].hash_valid,undefined);
 assert.equal(r.sourceBatchState,'STAGED');
 const q=p.calls.at(-1);
 assert.deepEqual(q.args,[batch,'LEAD','Leads','hello world','open','',2]);
 assert.match(q.sql,/source_id<\$6/);
 assert.match(q.sql,/sha256\(convert_to/);
 assert.match(q.sql,/m\.source_entity=\$3/);
 assert.doesNotMatch(q.sql,/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
 const p2=db([]);await get(p2,{},'type=objects&status=planned&cursor=OBJ-100');
 assert.deepEqual(p2.calls.at(-1).args,[batch,'OBJECT','Objects','','planned','OBJ-100',21]);
});
test('CRM history rejects invalid source kind, search injection, old cursor and unsupported statuses',async()=>{
 for(const text of ['type=workers','type=WORK_ORDER','type=objects&status=won',
   'type=clients&status=open','type=leads&status=invalid',
   'type=leads&q='+encodeURIComponent('a'.repeat(81)),
   'type=leads&q='+encodeURIComponent('abc\nxx'),
   'type=leads&cursor=no','type=leads&limit=51','type=leads&limit=0']){
  assert.throws(()=>parseHistoricalCrmQuery(url(text)),CrmHistoricalArchiveError,text);
 }
});
test('CRM history refuses forged hash or unknown source and never displays unverified content',async()=>{
 for(const bad of [{hash_valid:false},{source_system:'UNKNOWN'}]){
  const p=db([{...record(),...bad}]);
  await assert.rejects(get(p),e=>e.status===503);
 }
 const p=db([{...record(),source_system:'OFFICIAL_SHADOW_EXTRA'}]);
 const r=await get(p);
 assert.equal(r.items[0].shadowOnly,true);
 assert.equal(r.items[0].native_link_verified,false);
});
test('CRM archive visual keeps legacy search, list/card/detail grammar and escapes owner data',()=>{
 const x={...record('LEAD-80'),title:'<script>alert("x")</script>',notes:'<img src=x onerror=alert(1)>',
  source_system:'OFFICIAL_SHADOW_EXTRA',shadowOnly:true};
 const html=renderHistoricalCrmPage({items:[x],hasMore:false});
 assert.match(html,/Историческая CRM/);
 assert.match(html,/Лиды/);
 assert.match(html,/Поиск по имени, телефону, потребности/);
 assert.match(html,/data-crm-archive-search/);
 assert.match(html,/Открыть запись/);
 assert.match(html,/Дополнительная копия · требует сверки/);
 assert.ok(!html.includes('<script>')&&!html.includes('<img'));
 assert.ok(html.includes('&lt;script&gt;')&&html.includes('&lt;img'));
 assert.doesNotMatch(html,/data-act=|data-action="lead_|Сохранить в PostgreSQL/);
 const client=renderHistoricalCrmPage({items:[],hasMore:false},{type:'clients'});
 assert.match(client,/Поиск по имени, телефону, адресу/);
 const object=renderHistoricalCrmPage({items:[],hasMore:true},{type:'objects'});
 assert.match(object,/Поиск по названию, адресу, типу/);
 assert.match(object,/Показать ещё/);
 assert.doesNotMatch(object,/<select name="status"/);
});
test('CRM historical page mount uses GET and ignores stale response after unmount',async()=>{
 const seen=[],listeners={};
 const root={innerHTML:'',addEventListener:(type,fn)=>{listeners[type]=fn},
  removeEventListener:(type)=>{delete listeners[type]}};
 let resolve;
 const p=mountHistoricalCrmPage(root,{fetchPage:path=>{
  seen.push(path);return new Promise(r=>{resolve=r;});
 }});
 assert.match(seen[0],/^\/api\/history\/crm\?type=leads/);
 assert.match(root.innerHTML,/Загрузка архивных записей/);
 p.unmount();
 resolve({version:'CRM_HISTORICAL_BROWSER_V1',source:'FROZEN_LEGACY_CRM_ARCHIVE_ONLY',
  readonly:true,operational:false,type:'leads',status:'all',q:'',
  items:[record()],hasMore:false});
 await Promise.resolve();await Promise.resolve();
 assert.equal(Object.keys(listeners).length,0);
 assert.doesNotMatch(root.innerHTML,/LEAD-example/);
});
test('CRM history navigation and read-only route preserve existing work and finance screens',()=>{
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(server,/pathname==='\/api\/history\/crm'&&req.method==='GET'/);
 assert.match(server,/if\(!sessionValid\(req\)\)throw new AppError\(401/);
 assert.match(server,/historicalCrmArchivePage\(pool/);
 assert.match(server,/CRM_HISTORICAL_BROWSER_V1|CrmHistoricalArchiveError/);
 assert.match(html,/data-tab="historyCrm"/);
 assert.match(html,/crm-history-archive.css/);
 assert.match(app,/mountHistoricalCrm/);
 assert.match(app,/crm-history-archive-view.mjs/);
 assert.match(app,/historyCrmPanel\.unmount/); // corrected below if name mismatch
 assert.match(app,/tab==='historyOrders'\?historyOrdersView\(\)/);
});
