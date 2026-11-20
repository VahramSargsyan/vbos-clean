import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {knowledgeStageKeys,knowledgeSort,knowledgeFilter,normalizeKnowledgePayload,
 knowledgeRead,knowledgeSave,knowledgeYear} from '../knowledge.mjs';

class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
const item=(changes={})=>({
 knowledgeId:'KNW-2026-0001',status:'active',type:'SOP',code:'1.1',title:'Первый звонок',
 sectionPath:'Работа с лидами',summary:'Приём заявки',fullText:'Спросить об адресе',
 tags:'лид',version:'1',sourceName:'Карта SOP',sourceVersion:'v0.2.62',
 sortOrder:1,priority:'MEDIUM',favorite:'false',...changes
});
test('legacy KNW ID year follows appsscript Asia/Yerevan, not UTC',()=>{
 assert.equal(knowledgeYear(new Date('2026-12-31T19:59:59.999Z')),2026);
 assert.equal(knowledgeYear(new Date('2026-12-31T20:00:00.000Z')),2027);
 assert.equal(knowledgeYear(new Date('2027-01-01T00:00:00.000Z')),2027);
});
test('legacy SOP stage keys by exact code and fallback tags, no invented stage',()=>{
 assert.deepEqual(knowledgeStageKeys(item()),['LEADS']);
 assert.deepEqual(knowledgeStageKeys(item({code:'S.1',title:'Остановка'})),['STOP']);
 assert.deepEqual(knowledgeStageKeys(item({code:'SOP-ARCH',title:'Лиды'})),[]);
 assert.deepEqual(knowledgeStageKeys(item({code:'',sectionPath:'Гарантия',tags:'лид'})),['LEADS','WARRANTY']);
 assert.deepEqual(knowledgeStageKeys(item({code:'',sectionPath:'',tags:'',title:'Несвязанная справка'})),[]);
});
test('favorite first, numeric code and sort order; filtering all original fields',()=>{
 const rows=[item({knowledgeId:'KNW-2026-0010',code:'1.10',sortOrder:0}),
 item({knowledgeId:'KNW-2026-0002',code:'1.2',sortOrder:0}),
 item({knowledgeId:'KNW-2026-0003',code:'1.3',sortOrder:9,favorite:'true'}),
 item({knowledgeId:'KNW-2026-0004',code:'S.1',status:'draft',type:'RULE',favorite:'false'})];
 assert.deepEqual(knowledgeSort(rows).map(x=>x.knowledgeId),
  ['KNW-2026-0003','KNW-2026-0002','KNW-2026-0010','KNW-2026-0004']);
 assert.equal(knowledgeFilter(rows,{favoritesOnly:true}).length,1);
 assert.equal(knowledgeFilter(rows,{stage:'STOP',status:'ALL'}).length,1);
 assert.equal(knowledgeFilter(rows,{query:'приём заявки',status:'ALL'}).length,4);
 assert.equal(knowledgeFilter(rows,{query:'об адресе',status:'active'}).length,3);
 assert.equal(knowledgeFilter(rows,{type:'RULE',status:'active'}).length,0);
});
test('legacy field contract: required title, enum protection, exact max lengths',()=>{
 const p=normalizeKnowledgePayload(item({title:'  Запуск  ',favorite:'да'}),null,AppError);
 assert.equal(p.title,'Запуск');assert.equal(p.favorite,'true');assert.equal(p.type,'SOP');
 assert.equal(p.summary,'Приём заявки');
 for(const bad of [item({title:''}),item({title:'a'.repeat(301)}),
  item({type:'ADVANCED'}),item({status:'deleted'}),item({priority:'URGENT'})]){
  assert.throws(()=>normalizeKnowledgePayload(bad,null,AppError),e=>e instanceof AppError&&e.status===400);
 }
 const long=normalizeKnowledgePayload(item({fullText:'x'.repeat(49001),code:'y'.repeat(85)}),null,AppError);
 assert.equal(long.fullText.length,49000);assert.equal(long.code.length,80);
});
test('read provides all rows in legacy order without claiming unimported 64 materials',async()=>{
 const queries=[];
 const pool={query:async sql=>{
  queries.push(sql);
  if(sql.startsWith('SELECT phase'))return {rows:[{phase:'LEGACY',source_snapshot_hash:''}]};
  return {rows:[{
   knowledge_id:'KNW-2026-0002',status:'active',type:'SOP',code:'2.1',title:'Осмотр',
   section_path:'',summary:'',full_text:'',tags:'',version:'',
   source_name:'',source_version:'',sort_order:0,priority:'MEDIUM',favorite:false,
   created_at:new Date('2026-08-12T02:03:04.000Z'),updated_at:new Date('2026-08-13T07:38:03.430Z'),client_request_id:''
  }]};
 }};
 const r=await knowledgeRead({pool,AppError});
 assert.equal(r.items[0].knowledgeId,'KNW-2026-0002');
 assert.equal(r.items[0].createdAt,'2026-08-12T02:03:04.000Z');
 assert.equal(r.items[0].updatedAt,'2026-08-13T07:38:03.430Z');
 assert.equal(r.total,1);assert.equal(r.sourceMeta.totalSeedItems,0);
 assert.equal(r.writeEnabled,false);assert.equal(r.authority,'LEGACY');
 assert.equal(queries.length,2);
});
test('write gate fails closed before any item or idempotency query',async()=>{
 const queries=[],client={query:async(sql)=>{
  queries.push(sql);
  if(sql.includes('FROM public.mvp_knowledge_authority'))return {rows:[{phase:'LEGACY',source_snapshot_hash:''}]};
  return {rows:[]};
 },release:()=>{}};
 const pool={connect:async()=>client};
 await assert.rejects(()=>knowledgeSave({pool,p:item(),key:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',AppError}),
  e=>e instanceof AppError&&e.status===409);
 assert.ok(queries.includes('BEGIN'));
 assert.ok(queries.includes('ROLLBACK'));
 assert.ok(!queries.some(q=>q.includes('INSERT INTO public.mvp_knowledge_items')));
});
test('idempotency delayed replay returns original response after another owner edit',async()=>{
 const row={knowledge_id:'KNW-2026-0064',created_at:'2026-08-13',updated_at:'2026-08-13',
  status:'active',type:'SOP',code:'1.1',title:'Старое',section_path:'',summary:'',full_text:'',
  tags:'A',version:'',source_name:'',source_version:'',sort_order:0,
  priority:'MEDIUM',favorite:false,client_request_id:''};
 const requests=new Map();
 const db={release(){},async query(sql,args=[]){
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
  if(sql.includes('FROM public.mvp_knowledge_authority'))
   return {rows:[{phase:'CLEAN',source_snapshot_hash:'a'.repeat(64)}]};
  if(sql.includes('FROM public.mvp_knowledge_items WHERE knowledge_id='))
   return {rows:[{...row}]};
  if(sql.startsWith('INSERT INTO public.mvp_knowledge_requests')){
   const [key,operation,payload_sha256]=args;
   if(requests.has(key))return {rows:[]};
   requests.set(key,{operation,payload_sha256,response:null});
   return {rows:[{request_key:key}]};
  }
  if(sql.startsWith('SELECT * FROM public.mvp_knowledge_requests'))
   return {rows:[requests.get(args[0])]};
  if(sql.startsWith('UPDATE public.mvp_knowledge_items')){
   const cols=['status','type','code','title','section_path','summary','full_text','tags',
    'version','source_name','source_version','sort_order','priority','favorite'];
   cols.forEach((name,i)=>{row[name]=args[i+1];});
   row.client_request_id=args[15];
   return {rows:[{...row}]};
  }
  if(sql.startsWith('UPDATE public.mvp_knowledge_requests SET response')){
   requests.get(args[0]).response=JSON.parse(args[1]);return {rows:[]};
  }
  throw Error('Unexpected test query '+sql.slice(0,55));
 }};
 const pool={connect:async()=>db};
 const id=row.knowledge_id,k1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  k2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const firstPayload={knowledgeId:id,title:'Первый'};
 const first=await knowledgeSave({pool,p:firstPayload,key:k1,AppError});
 assert.equal(first.data.title,'Первый');
 const second=await knowledgeSave({pool,p:{knowledgeId:id,title:'Второй',tags:'Изменено'},
  key:k2,AppError});
 assert.equal(second.data.title,'Второй');
 const replay=await knowledgeSave({pool,p:firstPayload,key:k1,AppError});
 assert.deepEqual(replay,first);
 assert.equal(row.title,'Второй');
 assert.equal(requests.size,2);
 await assert.rejects(()=>knowledgeSave({pool,p:{knowledgeId:id,title:'Неверное повторение'},
  key:k1,AppError}),e=>e.status===409);
 assert.equal(row.title,'Второй');
});

test('legacy screen is routed but editing remains visibly gated without approved source',()=>{
 const js=readFileSync(new URL('../public/knowledge.js',import.meta.url),'utf8');
 const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(index,/data-tab="knowledge">SOP/);
 assert.match(index,/<script src="\/knowledge.js" defer><\/script><script src="\/app.js" defer>/);
 assert.match(app,/tab==='knowledge'\?knowledgeView\(\)/);
 assert.match(app,/if\(tab==='knowledge'\)knowledgeMount\(\)/);
 assert.match(server,/if\(!sessionValid\(req\)\)/);
 assert.match(server,/pathname==='\/api\/knowledge\/save'/);
 assert.match(server,/readBody\(req,70000\)/);
 const listeners={};
 const scope={document:{addEventListener:(n,cb)=>{listeners[n]=cb;}},tab:'knowledge',message:()=>{}};
 runInNewContext(js,scope,{filename:'knowledge.js'});
 const html=scope.knowledgeView();
 for(const token of ['SOP / База знаний','knowledgeSearchInput','knowledgeTypeFilter',
  'knowledgeStatusFilter','knowledgeFavoritesOnly','knowledgeStageFilter','data-knowledge-new disabled'])
  assert.ok(html.includes(token),token);
 assert.equal(typeof listeners.click,'function');
});
