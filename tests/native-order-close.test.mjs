import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeOrderCloseAction} from '../native-order-close.mjs';
import {renderNativeCloseForm,renderNativeCloseReceipt} from '../public/native-order-close-view.mjs';

class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
const uuid=id=>{if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id))throw new AppError(400,'ID');return id;};
const safeDate=v=>{if(!/^\d{4}-\d\d-\d\d$/.test(v))throw new AppError(400,'date');return v;};
const safeRevision=v=>{if(!Number.isInteger(v)||v<1)throw new AppError(400,'revision');return v;};
const id='a88a2c31-01d3-4dd2-b6e6-41c08a9bb2d6';
const assessment={satisfaction:'YES',acceptance:'NO_REMARKS',paymentBehavior:'ON_TIME',communicationQuality:'EASY',scopeChanges:'NONE',workAgain:'YES',comment:''};
const payload=()=>({orderId:id,revision:1,completionDate:'2026-11-05',financeChecked:'yes',financeReference:'Выписка банка 05.11',unfinishedObligationsStatus:'NONE',clientAssessment:assessment});
const connect=()=>{throw Error('DATABASE_ACCESS_BEFORE_VALIDATION')};
const run=p=>nativeOrderCloseAction({pool:{connect},p,key:'23d031ca-456b-43f5-bd03-ddf1db9adf93',uuid,safeDate,safeRevision,AppError});
test('missing manual attestation is denied before connection',async()=>{
 await assert.rejects(run({...payload(),financeChecked:'no'}),e=>e.status===400);
 await assert.rejects(run({...payload(),financeReference:'no'}),e=>e.status===400);
 await assert.rejects(run({...payload(),unfinishedObligationsStatus:'REMAINS'}),e=>e.status===409);
});
test('six factors require exact enumerations and no inferred default',async()=>{
 await assert.rejects(run({...payload(),clientAssessment:{...assessment,acceptance:'GOOD'}}),e=>e.status===400);
 await assert.rejects(run({...payload(),clientAssessment:{...assessment,satisfaction:undefined}}),e=>e.status===400);
});
test('mobile form is native-only and requires both acknowledgements',()=>{
 const html=renderNativeCloseForm({id,status:'open',revision:1},'2026-11-05');
 assert.match(html,/data-act="close_work_order"/);
 assert.match(html,/name="financeChecked"[^>]+required/);
 assert.match(html,/name="unfinishedObligationsStatus"[^>]+required/);
 assert.match(html,/name="a_satisfaction"/);
 assert.match(html,/не подтверждает полную оплату/);
 assert.throws(()=>renderNativeCloseForm({id,status:'done'},'2026-11-05'));
});
test('stored finance evidence escapes markup, preserves reviewer and check time',()=>{
 const html=renderNativeCloseReceipt({readonly:true,source:'CLEAN_NATIVE_MANUAL_FINANCE_ATTESTATION',financeIsSettled:false,fact:{
  closedByLogin:'owner<script>',financeReference:'<img onerror=1>',closedAt:'2026-11-05T10:00:00Z',financeCheckedAt:'2026-11-05T10:00:00Z',completionDate:'2026-11-05',removedWorkerAssignments:1
 }});
 assert.match(html,/&lt;img/);
 assert.match(html,/owner&lt;script&gt;/);
 assert.doesNotMatch(html,/<img|<script/);
 assert.match(html,/не подтверждён в Clean/);
 assert.match(html,/Проверил/);
 assert.throws(()=>renderNativeCloseReceipt({financeIsSettled:true}));
});
test('source never re-enables old one-click done or bypasses migration guard',()=>{
 const js=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const schedule=readFileSync(new URL('../order-schedule.mjs',import.meta.url),'utf8');
 const ddl=readFileSync(new URL('../migrations/0013_native_order_close_MANUAL_FINANCE_TEST_ONLY.sql',import.meta.url),'utf8');
 assert.ok(js.includes("type==='close_work_order'"));
 assert.ok(js.includes("pathname==='/api/orders/close-fact'"));
 assert.ok(schedule.includes("if(type==='order_status'&&p.status==='done')"));
 assert.ok(ddl.includes('MVP_GOOGLE_ORDER_CLOSE_FORBIDDEN'));
 assert.ok(ddl.includes('MVP_CLOSE_PROTOCOL_REQUIRED'));
 assert.ok(ddl.includes('mvp_native_closed_active_guard'));
});
