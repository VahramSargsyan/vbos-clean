import test from 'node:test';
import assert from 'node:assert/strict';
import {orderClosePreview} from '../order-close-preview.mjs';
import {renderClosePreview} from '../public/order-close-preview-view.mjs';
import {readFileSync} from 'node:fs';

class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
const id='5b89c984-72b5-4c39-bb3d-7f2012f29b46';
const u=x=>new URL('https://test.local/api/orders/close-preview'+(x||'?id='+id));
const template=()=>({id,title:'Testing <script>bad()</script>',status:'active',revision:2,google_owned:true,
 active_tasks:0,open_sessions:0,active_assignments:1,future_manual_plans:1,
 pending_auto_plans:1,checked_at:'2026-11-05T09:40:00Z'});
const mock=(data=template())=>{
 const calls=[];
 const pool={query:async(sql,params)=>{calls.push({sql,params});return {rows:data?[data]:[]}}};
 return {pool,calls};
};
const opts={authorizeOwner:()=>true,AppError};
test('owner auth must run before any DB read',async()=>{
 const {pool,calls}=mock();
 await assert.rejects(orderClosePreview(pool,u(),{...opts,authorizeOwner:()=>false}),x=>x.status===401);
 await assert.rejects(orderClosePreview(pool,u(),{AppError}),x=>x.status===401);
 assert.equal(calls.length,0);
});
test('UUID invalid, missing order both denied without unsafe fallback',async()=>{
 const {pool,calls}=mock();
 await assert.rejects(orderClosePreview(pool,u('?id=<script>'),opts),x=>x.status===400);
 assert.equal(calls.length,0);
 await assert.rejects(orderClosePreview(mock(null).pool,u(),opts),x=>x.status===404);
});
test('Google-owned order is never closeable, even if all work tasks are done',async()=>{
 const {pool,calls}=mock();
 const r=await orderClosePreview(pool,u(),opts);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].params,[id]);
 assert.ok(calls[0].sql.includes('mvp_legacy_import_map'));
 assert.ok(calls[0].sql.includes('mvp_worker_tasks'));
 assert.ok(calls[0].sql.includes('mvp_schedule_items'));
 assert.ok(!/\b(UPDATE|INSERT|DELETE|LOCK TABLE|FOR UPDATE)\b/i.test(calls[0].sql));
 assert.equal(r.canClose,false);
 assert.equal(r.previewOnly,true);
 assert.equal(r.readonly,true);
 assert.equal(r.order.googleOwned,true);
 assert.equal(r.finance.status,'UNVERIFIED_IN_CLEAN');
 assert.match(r.blockers[0],/Google VBOS/);
 assert.equal(r.counts.activeAssignments,1);
 assert.ok(r.warnings.some(s=>s.includes('ручные планы')));
 assert.equal(Object.hasOwn(r,'financeAmount'),false);
});
test('Native order with no tasks remains in preflight-only mode pending finance/assessment writer',async()=>{
 const row={...template(),google_owned:false,active_assignments:0,future_manual_plans:0,pending_auto_plans:0};
 const p=await orderClosePreview(mock(row).pool,u(),opts);
 assert.equal(p.order.googleOwned,false);
 assert.equal(p.canClose,false);
 assert.equal(p.counts.activeTasks,0);
 assert.ok(p.blockers.some(x=>x.includes('транзакция закрытия')));
 assert.ok(!p.blockers.some(x=>x.includes('Google VBOS')));
});
test('Active tasks and sessions are blockers; completed/cancelled not eligible',async()=>{
 const row={...template(),google_owned:false,active_tasks:2,open_sessions:1,active_assignments:0};
 const p=await orderClosePreview(mock(row).pool,u(),opts);
 assert.ok(p.blockers.some(s=>s.includes('2')));
 assert.ok(p.blockers.some(s=>s.includes('1')));
 const terminal=await orderClosePreview(mock({...row,status:'done'}).pool,u(),opts);
 assert.ok(terminal.blockers.some(s=>s.includes('повторно')));
 assert.equal(terminal.canClose,false);
});
test('Malformed counts are rejected rather than claiming a clean order',async()=>{
 await assert.rejects(orderClosePreview(mock({...template(),active_tasks:-1}).pool,u(),opts),/V13B_BAD_COUNT/);
});
test('Mobile summary escapes data and does not render a close action',()=>{
 const payload={readonly:true,previewOnly:true,canClose:false,source:'CLEAN_ORDER_WITH_LEGACY_AUTHORITY_GATE',
  order:{googleOwned:true,status:'active<img>',id},finance:{status:'UNVERIFIED_IN_CLEAN'},
  counts:{activeTasks:0,openSessions:0,activeAssignments:1,futureManualPlans:0,pendingAutoPlans:1},
  blockers:['<script>alert(1)</script>'],warnings:['<img onerror=evil>']};
 const html=renderClosePreview(payload);
 assert.match(html,/Закрытие пока недоступно/);
 assert.match(html,/Google VBOS/);
 assert.match(html,/&lt;script&gt;/);
 assert.match(html,/&lt;img/);
 assert.doesNotMatch(html,/<script>|<img/);
 assert.doesNotMatch(html,/data-act="close_work_order"/);
 assert.throws(()=>renderClosePreview({...payload,canClose:true}));
});

test('existing Order UI replaces direct done shortcut with close preflight only',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const route=readFileSync(new URL('../order-schedule.mjs',import.meta.url),'utf8');
 assert.ok(app.includes('data-close-preview'));
 assert.ok(app.includes('Проверить закрытие'));
 assert.ok(!app.includes("statusButtons(x,'order_status',['open','active','done','cancelled'])"));
 assert.ok(route.includes("if(type==='order_status'&&p.status==='done')throw new AppError(409"));
 assert.ok(server.includes("pathname==='/api/orders/close-preview'&&req.method==='GET'"));
 assert.ok(!server.includes("pathname==='/api/orders/close'&&req.method==='POST'"));
});
