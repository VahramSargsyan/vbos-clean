/**
 * Finance B23 — real PostgreSQL 17 result calculations on disposable localhost only.
 * Synthetic fixtures are created and deleted exclusively inside vbos_mvp_ci.
 * Run after npm run test:e2e has installed the normal Clean TEST schema.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {normalizeFinanceCreate} from '../domains/finance/finance-create-normalize.mjs';
import {readOrderFinancialResult} from '../domains/finance/finance-native-order-result.mjs';

const uri=process.env.TEST_DATABASE_URL||'';
let url;
try{url=new URL(uri);}catch{throw Error('B23_DISPOSABLE_POSTGRES_REQUIRED');}
if(!['postgres:','postgresql:'].includes(url.protocol)||
   !['localhost','127.0.0.1'].includes(url.hostname)||
   url.pathname!=='/vbos_mvp_ci')
 throw Error('B23_DISPOSABLE_POSTGRES_REQUIRED');
const pool=new pg.Pool({connectionString:uri,ssl:false,max:3});
const uid=()=>randomUUID();
const clientId=uid(),objectId=uid(),workerId=uid(),a=uid(),b=uid();
const today='2026-11-23';
const refs={clients:{[clientId]:{clientId}},
 objects:{[objectId]:{objectId,clientId}},
 workOrders:{
  [a]:{workOrderId:a,objectId,clientId},
  [b]:{workOrderId:b,objectId,clientId}
 },
 workers:{[workerId]:{workerId,status:'active'}}};
const amounts=[
 {order:a,operationType:'INCOME',category:'current_work',amountOriginal:'200',commissionOriginal:'3'},
 {order:a,operationType:'INCOME',category:'advance',amountOriginal:'80'},
 {order:a,operationType:'EXPENSE',category:'materials',amountOriginal:'60',commissionOriginal:'2'},
 {order:a,operationType:'WORKER_ACCRUAL',amountOriginal:'30',workerId},
 {order:a,operationType:'WORKER_PAYMENT',amountOriginal:'15',commissionOriginal:'1',workerId},
 {order:a,operationType:'EXPENSE',category:'client_material_purchase',amountOriginal:'20'},
 {order:a,operationType:'INCOME',category:'current_work',incomeRecognition:'EARNED_ONLY',amountOriginal:'50'},
 {order:a,operationType:'INCOME',category:'current_work',amountOriginal:'500',archived:true},
 {order:b,operationType:'INCOME',category:'current_work',amountOriginal:'999'}
];
const seeded=[];
async function insertFixture(){
 const db=await pool.query('SELECT current_database() AS db');
 assert.equal(db.rows[0].db,'vbos_mvp_ci');
 const classes=await pool.query("SELECT to_regclass('public.mvp_orders') IS NOT NULL AS orders,"+
 "to_regclass('mvp_finance_native.transactions') IS NOT NULL AS finance");
 assert.equal(classes.rows[0].orders,true);assert.equal(classes.rows[0].finance,true);
 // The prior B14 test intentionally leaves ONLY this disposable finance schema PAUSED.
 // Reopen the already synthetic, fully reconciled local source gate; NEVER do this on Neon.
 const gate=await pool.query("UPDATE mvp_finance_native.cutover_control SET phase='ACTIVE' "+
  "WHERE id=1 AND phase='PAUSED' AND financial_write_authority='POSTGRES' RETURNING id");
 assert.equal(gate.rowCount,1,'B23_DISPOSABLE_REHEARSAL_REQUIRES_B14_PAUSED_GATE');
 await pool.query('INSERT INTO public.mvp_clients(id,request_key,name) VALUES($1,$2,$3)',
  [clientId,uid(),'B23_SYNTHETIC_CLIENT']);
 await pool.query('INSERT INTO public.mvp_objects(id,request_key,client_id,name) VALUES($1,$2,$3,$4)',
  [objectId,uid(),clientId,'B23_SYNTHETIC_OBJECT']);
 await pool.query('INSERT INTO public.mvp_orders(id,request_key,object_id,title) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
  [a,uid(),objectId,'B23_SYNTHETIC_ORDER_A',b,uid(),objectId,'B23_SYNTHETIC_ORDER_B']);
 await pool.query('INSERT INTO public.mvp_workers(id,name) VALUES($1,$2)',
  [workerId,'B23_SYNTHETIC_WORKER']);
 for(let i=0;i<amounts.length;i++){
  const row=amounts[i],p={
   operationType:row.operationType,category:row.category,
   incomeRecognition:row.incomeRecognition,workerId:row.workerId,
   workOrderId:row.order,amountOriginal:row.amountOriginal,
   commissionOriginal:row.commissionOriginal||'0',
   transactionDate:today,currencyOriginal:'AMD'
  };
  const norm=normalizeFinanceCreate(p,{todayKey:today,references:refs});
  const id=uid();seeded.push(id);
  await pool.query(
   'INSERT INTO mvp_finance_native.transactions('+
   'finance_transaction_id,request_key,status,transaction_date_key,operation_type,'+
   'client_id,object_id,work_order_id,worker_id,amount_base,commission_base,'+
   'cash_effect_base,profit_effect_base,worker_payable_effect_base,normalized,created_at) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::timestamptz)',
   [id,uid(),row.archived?'archived':'active',today,norm.operationType,
    clientId,objectId,row.order,row.workerId||null,
    String(norm.amountBase),String(norm.commissionBase),String(norm.cashEffectBase),
    String(norm.profitEffectBase),String(norm.workerPayableEffectBase),JSON.stringify(norm),
    '2026-11-23 10:00:00.12345'+String(i%5)+'+00']);
 }
}
async function cleanup(){
 if(seeded.length)await pool.query('DELETE FROM mvp_finance_native.transactions WHERE finance_transaction_id=ANY($1::uuid[])',[seeded]);
 await pool.query('DELETE FROM public.mvp_workers WHERE id=$1',[workerId]);
 await pool.query('DELETE FROM public.mvp_orders WHERE id=ANY($1::uuid[])',[[a,b]]);
 await pool.query('DELETE FROM public.mvp_objects WHERE id=$1',[objectId]);
 await pool.query('DELETE FROM public.mvp_clients WHERE id=$1',[clientId]);
 // Restore the earlier B14 PAUSED authority state in the local disposable database.
 const gate=await pool.query("UPDATE mvp_finance_native.cutover_control SET phase='PAUSED' "+
  "WHERE id=1 AND phase='ACTIVE' RETURNING id");
 assert.equal(gate.rowCount,1,'B23_DISPOSABLE_FINANCE_PAUSE_RESTORE_REQUIRED');
}
test('Finance B23 actual isolated PostgreSQL: exact scoped sums, archived, owner gate and pagination',async t=>{
 try{
  await insertFixture();
  const request=id=>readOrderFinancialResult(pool,id,{authorizeOwner:()=>true,limit:2});
  await t.test('source amounts match the B2 accounting contract without double counting advances or payroll',async()=>{
   const x=await request(a);
   assert.equal(x.orderId,a);assert.equal(x.totalCount,8);assert.equal(x.activeCount,7);
   assert.deepEqual(x.metrics,{
    receivedBase:'280.000000',advanceBase:'80.000000',earnedBase:'250.000000',
    cashOutBase:'98.000000',cashBalanceBase:'179.000000',
    economicExpenseBase:'96.000000',profitBase:'154.000000',
    workerAccruedBase:'30.000000',workerPaidBase:'15.000000',
    workerPayableBase:'15.000000'
   });
   assert.equal(x.historicalIncluded,false);assert.equal(x.readonly,true);
   assert.equal(x.source,'CLEAN_NATIVE_ORDER_LEDGER');
  });
  await t.test('same client and object do not leak financial rows from another Order UUID',async()=>{
   const x=await request(b);
   assert.equal(x.totalCount,1);assert.equal(x.metrics.receivedBase,'999.000000');
   assert.equal(x.metrics.cashBalanceBase,'999.000000');
   assert.equal(x.metrics.advanceBase,'0.000000');
  });
  await t.test('keyset pages use microsecond timestamp + UUID without duplicates',async()=>{
   const page1=await request(a);const ids=new Set(page1.items.map(i=>i.id));
   let next=page1.nextCursor;
   while(next){
    const q=await readOrderFinancialResult(pool,a,{authorizeOwner:()=>true,limit:2,cursor:next});
    assert.equal(q.orderId,a);assert.equal(q.totalCount,8);
    for(const item of q.items){assert.equal(ids.has(item.id),false);ids.add(item.id);}
    next=q.nextCursor;
    assert.ok(ids.size<=8);
   }
   assert.equal(ids.size,8);
  });
  await t.test('archived record appears in history but is excluded from every active subtotal',async()=>{
   let seenArchived=false,next=null;
   do{
    const page=await readOrderFinancialResult(pool,a,{authorizeOwner:()=>true,limit:3,cursor:next});
    seenArchived ||= page.items.some(item=>item.status==='archived'&&item.amountBase==='500.000000');
    next=page.nextCursor;
   }while(next);
   assert.equal(seenArchived,true);
  });
  await t.test('invalid IDs, forged cursor and unauthenticated owner fail with 400/401/404',async()=>{
   await assert.rejects(readOrderFinancialResult(pool,a,{authorizeOwner:()=>false}),e=>e.status===401);
   await assert.rejects(request('LEGACY_ORDER_ID'),e=>e.status===400);
   await assert.rejects(request(uid()),e=>e.status===404);
   const page=await request(a);
   await assert.rejects(readOrderFinancialResult(pool,b,{authorizeOwner:()=>true,cursor:page.nextCursor}),
    e=>e.status===400&&e.code==='B23_CURSOR_INVALID');
  });
  await t.test('GET repetition leaves financial ledger count unchanged',async()=>{
   const before=(await pool.query('SELECT count(*)::int n FROM mvp_finance_native.transactions')).rows[0].n;
   await Promise.all([request(a),request(a),request(a)]);
   const after=(await pool.query('SELECT count(*)::int n FROM mvp_finance_native.transactions')).rows[0].n;
   assert.equal(after,before);
  });
  console.log('FINANCE_B23_REAL_DISPOSABLE_PG17_EXACT_SCOPE_AND_ACCOUNTING_PASS');
 }finally{
  try{await cleanup();}finally{await pool.end();}
 }
});
