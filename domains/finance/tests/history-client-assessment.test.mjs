import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalOrdersPage,historicalOrderAssessment,HistoryOrdersAccessError} from '../history-orders-api.mjs';
import {renderHistoricalAssessment,renderHistoryOrdersPanel,mountHistoryOrdersPanel} from '../history-orders-view.mjs';

const batchId='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const counts={LEAD:33,CLIENT:17,OBJECT:19,WORKER:2,WORK_ORDER:22,CLIENT_ASSESSMENT:13,WORKER_ASSIGNMENT:1,FINANCE_TRANSACTION:24};
const order={clientId:'CL-2026-0001',objectId:'OBJ-2026-0001',clientAssessmentId:'CAS-2026-0001',clientRequestId:'REQ-2026-0001',closedAt:'2026-08-16T14:00:00Z',completionDate:46250,financeCheckedAt:'2026-08-16T13:00:00Z',paymentStatus:'SETTLED',unfinishedObligationsStatus:'NONE'};
const assessment={clientAssessmentId:'CAS-2026-0001',clientId:order.clientId,objectId:order.objectId,workOrderId:'WO-2026-0001',satisfaction:'YES',acceptance:'NO_REMARKS',paymentBehavior:'ON_TIME',communicationQuality:'EASY',scopeChanges:'NONE',workAgain:'YES',score:100,scoreVersion:'CLIENT_SCORE_V1_100',riskLabel:'LOW_RISK',comment:'<img onerror=alert(1)>',createdAt:'2026-08-16T14:00:00Z'};
const row={legacy_order_id:'WO-2026-0001',status:'completed',order_fields:order,assessment_id:assessment.clientAssessmentId,assessment_status:'active',assessment_fields:assessment};
const opts={authorizeOwner:()=>true,batchId};
const makeDb=(data=[row])=>{
 const calls=[];
 return {calls,db:{async query(sql,args){
   calls.push({sql,args});
   if(sql.includes('FROM mvp_history.import_batches'))
    return {rows:[{expected_counts:counts,reconciled_counts:{...counts}}]};
   if(sql.includes('AS assessment_fields'))return {rows:data};
   if(sql.includes('AS legacy_order_id'))return {rows:[{legacy_order_id:'WO-2026-0001',status:'completed',has_client_assessment:true}]};
   throw Error('UNEXPECTED_QUERY');
 }}};
};
const rejects=(fn,status,code)=>assert.rejects(fn,e=>e instanceof HistoryOrdersAccessError&&e.status===status&&e.code===code);
test('owner authorization precedes every history assessment query',async()=>{
 const {db,calls}=makeDb();
 await rejects(()=>historicalOrderAssessment(db,'WO-2026-0001',{...opts,authorizeOwner:()=>false}),401,'OWNER_SESSION_REQUIRED');
 assert.equal(calls.length,0);
});
test('verified completed WorkOrder returns exact recorded client fields without finances or mutations',async()=>{
 const {db,calls}=makeDb();
 const x=await historicalOrderAssessment(db,'WO-2026-0001',opts);
 assert.equal(x.readonly,true);
 assert.equal(x.assessment.score,100);
 assert.equal(x.assessment.comment,'<img onerror=alert(1)>');
 assert.equal(x.close.completionDate,'2026-08-16');
 assert.equal(x.close.paymentStatus,'SETTLED');
 assert.equal(x.meaning,'INTERNAL_OWNER_ASSESSMENT_AND_HISTORICAL_CLOSE_NOT_CURRENT_FINANCE');
 assert.equal(Object.hasOwn(x,'original_fields'),false);
 assert.deepEqual(calls[1].args,[batchId,'WO-2026-0001']);
 assert.ok(calls.every(c=>!c.sql.includes('public.mvp_orders')&&!/\b(UPDATE|INSERT|DELETE)\b/i.test(c.sql)));
});
test('invalid ID, missing order, duplicate assessments and mismatch fail closed',async()=>{
 await rejects(()=>historicalOrderAssessment(makeDb().db,'<script>',opts),400,'INVALID_HISTORY_ORDER_ID');
 await rejects(()=>historicalOrderAssessment(makeDb([]).db,'WO-2026-0001',opts),404,'HISTORY_ORDER_NOT_FOUND');
 await rejects(()=>historicalOrderAssessment(makeDb([row,row]).db,'WO-2026-0001',opts),503,'HISTORY_ASSESSMENT_LINK_AMBIGUOUS');
 await rejects(()=>historicalOrderAssessment(makeDb([{...row,assessment_fields:{...assessment,objectId:'OBJ-WRONG'}}]).db,'WO-2026-0001',opts),503,'HISTORY_CLOSE_ASSESSMENT_LINK_INVALID');
 await rejects(()=>historicalOrderAssessment(makeDb([{...row,assessment_id:null,assessment_fields:null}]).db,'WO-2026-0001',opts),503,'HISTORY_CLOSE_ASSESSMENT_LINK_INVALID');
 await rejects(()=>historicalOrderAssessment(makeDb([{...row,order_fields:{...order,financeCheckedAt:''}}]).db,'WO-2026-0001',opts),503,'HISTORY_CLOSE_FIELDS_INCOMPLETE');
});
test('unfinished or archived historical orders are not given invented assessment',async()=>{
 const x=await historicalOrderAssessment(makeDb([{legacy_order_id:'WO-2026-0001',status:'archived',order_fields:{},assessment_id:null,assessment_fields:null}]).db,'WO-2026-0001',opts);
 assert.equal(x.assessment,null);
 assert.equal(x.close,null);
 await rejects(()=>historicalOrderAssessment(makeDb([{...row,status:'active'}]).db,'WO-2026-0001',opts),503,'HISTORY_NONCOMPLETED_ASSESSMENT_CONFLICT');
});
test('existing list SQL includes reciprocal assessment evidence without exposing notes',async()=>{
 const {db,calls}=makeDb();
 const page=await historicalOrdersPage(db,new URL('http://example.test/api/history/orders'),opts);
 assert.equal(page.items[0].has_client_assessment,true);
 assert.match(calls[1].sql,/AS has_client_assessment/);
 assert.ok(!calls[1].sql.includes("a.source_payload AS assessment_fields"));
});
test('render escapes historical comment, never claims customer review or current settlement',()=>{
 const detail={readonly:true,source:'VERIFIED_HISTORY_NOT_OPERATIONAL_ORDERS',
  legacyOrderId:'WO-2026-0001',status:'completed',close:{completionDate:'2026-08-16',paymentStatus:'SETTLED',unfinishedObligationsStatus:'NONE'},
  assessment:{legacyAssessmentId:'CAS-2026-0001',...assessment}};
 const html=renderHistoricalAssessment(detail);
 assert.ok(html.includes('Внутренняя запись старого VBOS'));
 assert.ok(html.includes('не проверка текущих платежей'));
 assert.ok(html.includes('16.08.2026'));
 assert.ok(html.includes('Сохранённый балл:'));
 assert.ok(!html.includes('<img'));
 assert.ok(html.includes('&lt;img'));
 const first=renderHistoryOrdersPanel({items:[{legacy_order_id:'WO-2026-0001',title:'Завершённый',status:'completed',has_client_assessment:true}],hasMore:false});
 assert.ok(first.includes('data-history-assessment="WO-2026-0001"'));
 const no=renderHistoryOrdersPanel({items:[{legacy_order_id:'WO-2026-0002',title:'Архив',status:'archived',has_client_assessment:false}],hasMore:false});
 assert.ok(!no.includes('data-history-assessment='));
 assert.throws(()=>renderHistoricalAssessment({readonly:false}));
});
test('async historical detail is discarded after unmount or scope change',async()=>{
 const listeners=new Map();
 const root={innerHTML:'',addEventListener:(name,cb)=>{listeners.set(name,[...(listeners.get(name)||[]),cb]);},
   removeEventListener:(name,cb)=>listeners.set(name,(listeners.get(name)||[]).filter(x=>x!==cb))};
 let pageReply,detailReply;
 const view=mountHistoryOrdersPanel(root,{fetchPage:path=>new Promise(resolve=>{
   if(path.includes('/assessment?'))detailReply=resolve;
   else pageReply=resolve;
 })});
 pageReply({readonly:true,scope:'finished',items:[{legacy_order_id:'WO-2026-0001',title:'Test',status:'completed',has_client_assessment:true}],hasMore:false});
 await Promise.resolve();await Promise.resolve();
 const element={getAttribute:()=> 'WO-2026-0001'};
 const target={closest:selector=>selector==='[data-history-assessment]'?element:null};
 for(const listener of listeners.get('click'))listener({target});
 assert.equal(typeof detailReply,'function');
 view.unmount();
 detailReply({readonly:true,source:'VERIFIED_HISTORY_NOT_OPERATIONAL_ORDERS',legacyOrderId:'WO-2026-0001',assessment:{comment:'STALE'},close:{}});
 await Promise.resolve();await Promise.resolve();
 assert.ok(!root.innerHTML.includes('STALE'));
});
