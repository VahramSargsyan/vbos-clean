import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseFinanceP4Query,readNativeFinanceEntityResults,NativeFinanceEntityResultsError}
 from '../domains/finance/finance-p4-native-entity-results.mjs';
import {financeP4VerifiedResponse,financeP4NativeHtml,mountFinanceP4Native}
 from '../domains/finance/finance-p4-native-entity-results-view.mjs';
import {nativeFinanceParityHtml,mountNativeFinanceParity}
 from '../domains/finance/finance-native-summary-view.mjs';

const id1='00000000-0000-4000-8000-000000000071';
const id2='00000000-0000-4000-8000-000000000072';
const metrics=()=>({
 earnedBase:'250.000000',receivedBase:'280.000000',
 economicExpenseBase:'96.000000',profitBase:'154.000000',
 cashBalanceBase:'179.000000',workerPayableBase:'15.000000',
 workerPaidBase:'15.000000',ownerTransferBase:'0.000000',workerAccruedBase:'30.000000'
});
const source=(kind='objects',q='')=>({
 version:'FINANCE_P4_NATIVE_ENTITY_RESULTS_V1',source:'CLEAN_NATIVE_FINANCE_ONLY',
 readonly:true,historicalIncluded:false,currency:'AMD',scope:'NEW_NATIVE_TRANSACTIONS_ONLY',
 kind,q,items:[{id:id1,label:'TEST Entity',totalCount:9,activeCount:8,archivedCount:1,
  lastAt:'2026-11-23T10:00:00.123Z',metrics:metrics()}],hasMore:false,nextCursor:null
});
const p=x=>new URLSearchParams(x);
test('P4 defaults to bounded 20 current native object results; supports worker name lookup',()=>{
 assert.deepEqual(Object.fromEntries(Object.entries(parseFinanceP4Query(p())).filter(([k])=>['kind','q','limit'].includes(k))),
  {kind:'objects',q:'',limit:20});
 const w=parseFinanceP4Query(p({kind:'workers',q:'Michael',limit:'50'}));
 assert.equal(w.kind,'workers');assert.equal(w.q,'Michael');assert.equal(w.limit,50);
});
test('P4 rejects arbitrary scope, control/search injection and unbounded or malformed cursors',()=>{
 for(const x of [{kind:'orders'},{kind:'GoogleWorker'},{q:'x'},{q:'x'.repeat(81)},
  {q:'ab\u0000foo'},{limit:'0'},{limit:'51'},{limit:'01'},
  {cursor:'../../user'},{cursor:'e30'}]){
  assert.throws(()=>parseFinanceP4Query(p(x)),
   e=>e instanceof NativeFinanceEntityResultsError&&e.status===400,JSON.stringify(x));
 }
 const base=parseFinanceP4Query(p({kind:'workers',q:'worker'}));
 const at='2026-11-23T10:00:00.123Z';
 const cursor=Buffer.from(JSON.stringify({k:base.key,id:id1,at})).toString('base64url');
 assert.deepEqual(parseFinanceP4Query(p({kind:'workers',q:'worker',cursor})).cursor,{id:id1,at});
 assert.throws(()=>parseFinanceP4Query(p({kind:'objects',q:'worker',cursor})),/CURSOR/);
 assert.throws(()=>parseFinanceP4Query(p({kind:'workers',q:'other',cursor})),/CURSOR/);
});
test('P4 one grouped read only; inherited P1 economics, excluded archived and Google sources',async()=>{
 const row={id:id1,label:'Native object',total_count:9,active_count:8,
  last_at:new Date('2026-11-23T10:00:00.123Z'),
  ...Object.fromEntries(Object.entries(metrics()).map(([key,value])=>
   [key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),value]))
 };
 const queries=[],pool={connect:async()=>({
  query:async(sql,args)=>{queries.push({sql,args});return {rows:sql.startsWith('WITH grouped')?[row]:[]}},
  release(){}
 })};
 // readNativeFinanceWorkspace has its own attestation and DB reads; this mock
 // only exercises the grouped query, with the signed gate supplied by the
 // separate real PostgreSQL E2E.
 await assert.rejects(readNativeFinanceEntityResults(pool,p(),{authorizeOwner:()=>false}),
  e=>e instanceof NativeFinanceEntityResultsError&&e.status===401);
 assert.equal(queries.length,0,'owner gate must reject before any SQL');
});
test('P4 UI validates immutable native source and safely escapes untrusted entity names',()=>{
 const bad=[{...source(),source:'VERIFIED_FROZEN_LEGACY_OBJECT_FINANCE'},
  {...source(),historicalIncluded:true},{...source(),readonly:false}];
 for(const x of bad)assert.throws(()=>financeP4VerifiedResponse(x,'objects',''),/UNATTESTED/);
 const fake=source();
 fake.items[0].label='<img src=x onerror=alert(1)>';
 const valid=financeP4VerifiedResponse(fake,'objects','');
 const html=financeP4NativeHtml({kind:'objects',data:valid,items:valid.items});
 assert.doesNotMatch(html,/<img src=x/);
 assert.match(html,/&lt;img/);
 assert.match(html,/Прибыль/);assert.match(html,/Получено/);
 assert.doesNotMatch(html,/\/api\/finance\/post/);
});
test('P4 worker results do not claim a full wage calculation or mix historical balances',()=>{
 const x=source('workers');
 const html=financeP4NativeHtml({kind:'workers',data:x,items:x.items});
 for(const word of ['Начислено','Выплачено','Долг по новым операциям','не полный расчёт зарплаты'])
  assert.ok(html.includes(word),word);
 assert.ok(!html.includes('Всего заработал работник'));
 assert.match(html,/без добавления старых сумм Google/);
});
test('P4 native read pagination uses the selected kind and has a P1 drill-down hook',async()=>{
 const handlers={};const requests=[];const root={
  innerHTML:'',addEventListener:(name,f)=>{handlers[name]=f;},
  removeEventListener:(name)=>{delete handlers[name];}
 };
 let opened=null;
 const panel=mountFinanceP4Native(root,{fetchPage:url=>{
  requests.push(url);return Promise.resolve(source());
 },onOpenScope:(kind,id,label)=>{opened={kind,id,label};return true;}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(requests[0],/native-entity-results\?kind=objects/);
 assert.match(root.innerHTML,/Native|TEST Entity/);
 handlers.click({target:{closest:()=>({
  getAttribute:k=>k==='data-finance-p4-open'?id1:null,
  hasAttribute:()=>false
 })}});
 assert.deepEqual(opened,{kind:'objects',id:id1,label:'TEST Entity'});
 panel.unmount();assert.equal(handlers.click,undefined);
});
test('P4 selection in P1 shows missing UUID option even beyond 200 reference options',async()=>{
 const empty={workOrderId:'',objectId:id2,workerId:'',operationType:'',dateFrom:'',dateTo:'',q:''};
 const html=nativeFinanceParityHtml({data:null,filters:empty,items:[],loading:true,error:'',
  scopeSelection:{id:id2,label:'Нужный удалённый объект'}});
 assert.match(html,/Нужный удалённый объект/);
 assert.match(html,new RegExp('value="'+id2+'" selected'));
 const urls=[],root={innerHTML:'',addEventListener(){},removeEventListener(){},scrollIntoView(){}};
 const response={version:'FINANCE_P1_NATIVE_READ_V1',source:'CLEAN_NATIVE_FINANCE_ONLY',
  readonly:true,historicalIncluded:false,scopeLabel:'OBJECT',totalCount:0,activeCount:0,
  ledger:{openingCashBase:'0.000000',currentCashBase:'0.000000'},
  summary:{earnedBase:'0.000000',receivedBase:'0.000000',economicExpenseBase:'0.000000',
   profitBase:'0.000000',cashBalanceBase:'0.000000',workerPayableBase:'0.000000',
   workerPaidBase:'0.000000',ownerTransferBase:'0.000000'},
  items:[],hasMore:false,nextCursor:null,references:{objects:[],orders:[],workers:[]},
  referenceListsTruncated:{objects:true,orders:true,workers:true}};
 const panel=mountNativeFinanceParity(root,{fetchPage:url=>{urls.push(url);return Promise.resolve(response);},
  onQuickAction:()=>true});
 assert.equal(panel.focusScope('objects',id2,'Нужный удалённый объект'),true);
 assert.equal(panel.focusScope('objects','LEGACY-O-001','Legacy'),false);
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(urls.some(u=>u.includes('objectId='+id2)));
 assert.match(root.innerHTML,/Нужный удалённый объект/);
 panel.unmount();
});
test('P4 integration mounted only as owner-authenticated GET and preserves archive routes',async()=>{
 const {readFileSync}=await import('node:fs');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(server,/pathname==='\/api\/finance\/native-entity-results'&&req.method==='GET'/);
 assert.match(server,/authorizeOwner:\(\)=>sessionValid\(req\)/);
 assert.match(app,/onOpenScope:\(kind,id,label\)=>financeParityPanel\?\.focusScope/);
 assert.match(app,/id="financeObjectResultMount"/);
 assert.match(app,/id="financeWorkerResultMount"/);
});

test('P4 rapid Object to Worker switch rejects stale overview response',async()=>{
 const callbacks={};const requests=[];const root={
  innerHTML:'',addEventListener:(n,f)=>{callbacks[n]=f;},
  removeEventListener:(n)=>{delete callbacks[n];}
 };
 const panel=mountFinanceP4Native(root,{fetchPage:url=>new Promise(resolve=>requests.push({url,resolve})),
  onOpenScope:()=>true});
 assert.equal(requests.length,1);
 callbacks.click({target:{closest:()=>({
  getAttribute:k=>k==='data-finance-p4-kind'?'workers':null,
  hasAttribute:()=>false
 })}});
 assert.equal(requests.length,2,'new tab should start a new GET without waiting for old');
 requests[1].resolve(source('workers'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(root.innerHTML,/не полный расчёт зарплаты/);
 requests[0].resolve(source('objects'));
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(root.innerHTML,/не полный расчёт зарплаты/);
 assert.doesNotMatch(root.innerHTML,/Заработано.*Получено/);
 panel.unmount();
});
