import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNativeFinanceHistoryFilters,readNativeFinanceHistory,NativeFinanceHistoryError}
 from '../domains/finance/finance-native-summary-history.mjs';
import {nativeFinanceParityHtml,mountNativeFinanceParity} from '../domains/finance/finance-native-summary-view.mjs';

const UUID_A='11111111-1111-4111-8111-111111111111';
const UUID_B='22222222-2222-4222-8222-222222222222';
const params=x=>new URLSearchParams(x);
const empty=()=>({workOrderId:'',objectId:'',workerId:'',operationType:'',dateFrom:'',dateTo:'',q:''});
const source=()=>({
 version:'FINANCE_P1_NATIVE_READ_V1',source:'CLEAN_NATIVE_FINANCE_ONLY',readonly:true,
 historicalIncluded:false,scopeLabel:'GLOBAL',totalCount:0,activeCount:0,
 ledger:{openingCashBase:'203000.000000',currentCashBase:'223000.000000'},
 summary:{earnedBase:'0.000000',receivedBase:'0.000000',economicExpenseBase:'0.000000',
  profitBase:'0.000000',cashBalanceBase:'0.000000',workerPayableBase:'0.000000',
  workerPaidBase:'0.000000',ownerTransferBase:'0.000000'},
 items:[],hasMore:false,nextCursor:null,
 references:{orders:[],objects:[],workers:[]},referenceListsTruncated:{orders:false,objects:false,workers:false}
});
test('P1 native-only defaults, source-local filters, and bounded size',()=>{
 const f=parseNativeFinanceHistoryFilters(params());
 assert.deepEqual(f.filters,empty());
 assert.equal(f.limit,20);
 assert.equal(f.cursor,null);
 const exact=parseNativeFinanceHistoryFilters(params({workOrderId:UUID_A,q:'tools',
  dateFrom:'2026-10-01',dateTo:'2026-11-23',operationType:'EXPENSE',limit:'50'}));
 assert.equal(exact.filters.workOrderId,UUID_A);
 assert.equal(exact.filters.q,'tools');
 assert.equal(exact.limit,50);
});
test('P1 reject legacy IDs, multiple scopes, arbitrary type, date invalidity and search injection',()=>{
 for(const arg of [
  {workOrderId:'WO-2026-001'},
  {workOrderId:UUID_A,objectId:UUID_B},
  {operationType:'ALLOCATION'},
  {dateFrom:'2026-02-30'},
  {dateFrom:'2026-11-23',dateTo:'2026-11-01'},
  {q:'a'},
  {q:'x'.repeat(81)},
  {q:'\u0000foo'},
  {limit:'51'},{limit:'0'},{limit:'01'}
 ]){
  assert.throws(()=>parseNativeFinanceHistoryFilters(params(arg)),
   e=>e instanceof NativeFinanceHistoryError&&e.status===400,JSON.stringify(arg));
 }
});
test('P1 keyset cursor is bound to exact filters and UUID',()=>{
 const p=parseNativeFinanceHistoryFilters(params({q:'tools'}));
 const at='2026-11-12 12:00:00.123456+00';
 const good=Buffer.from(JSON.stringify({k:p.filterKey,id:UUID_A,at})).toString('base64url');
 assert.equal(parseNativeFinanceHistoryFilters(params({q:'tools',cursor:good})).cursor.id,UUID_A);
 for(const arg of [
  {q:'other',cursor:good},
  {q:'tools',cursor:'not-a-json'},
  {q:'tools',cursor:Buffer.from(JSON.stringify({k:p.filterKey,id:'OLD-WO',at})).toString('base64url')}
 ])assert.throws(()=>parseNativeFinanceHistoryFilters(params(arg)),
  e=>e instanceof NativeFinanceHistoryError&&e.status===400);
});
test('P1 auth fails before database access',async()=>{
 await assert.rejects(()=>readNativeFinanceHistory({connect(){throw Error('MUST_NOT_CONNECT');}},
  params(),{authorizeOwner:async()=>false}),
  e=>e instanceof NativeFinanceHistoryError&&e.status===401);
});
test('P1 source-only UI renders eight metrics and separates opening from native effects',()=>{
 const html=nativeFinanceParityHtml({data:source(),filters:empty(),items:[],loading:false,error:''});
 for(const label of ['Заработано','Получено','Расходы','Прибыль','Изменение денег',
  'Долг рабочим','Выплачено рабочим','Выведено владельцем'])
  assert.ok(html.includes(label),label);
 assert.match(html,/Текущий денежный остаток/);
 assert.match(html,/223\s?000/);
 assert.match(html,/Начальный остаток|начальный остаток/);
 assert.match(html,/Даты, тип и текст фильтруют только историю/);
 assert.equal((html.match(/data-finance-p1-action=/g)||[]).length,5);
 for(const v of ['INCOME','EXPENSE','WORKER','OWNER_TRANSFER','INVEST'])
  assert.ok(html.includes('data-finance-p1-action="'+v+'"'));
 assert.ok(!html.includes('<form data-b18-form')); // no parallel financial writer
});
test('P1 rejects archived/Google source as current money',()=>{
 for(const val of [{...source(),source:'FROZEN_LEGACY_FINANCE_ARCHIVE_ONLY'},
  {...source(),historicalIncluded:true},{...source(),readonly:false}])
  assert.throws(()=>nativeFinanceParityHtml({data:val,filters:empty(),items:[],loading:false,error:''}),
   /FINANCE_P1_SOURCE_INVALID/);
});
test('P1 scope-specific summary does not confuse cash delta with global opening',()=>{
 const x={...source(),scopeLabel:'ORDER'};
 const html=nativeFinanceParityHtml({data:x,filters:{...empty(),workOrderId:UUID_A},
  items:[],loading:false,error:''});
 assert.ok(html.includes('«заказ»'));
 assert.ok(!html.includes('Текущий денежный остаток:'));
 assert.ok(html.includes('Изменение денег'));
});
test('P1 rows escape untrusted notes and keep cancelled operations visibly archived',()=>{
 const d=source();d.totalCount=1;
 const item={id:UUID_A,date:'2026-11-23',type:'EXPENSE',status:'archived',revision:2,
  amountBase:'100.000000',category:'tools',currency:'AMD',notes:'<img src=x onerror=alert(1)>',
  orderTitle:'<script>alert(1)</script>',objectTitle:'',workerName:''};
 const html=nativeFinanceParityHtml({data:d,filters:empty(),items:[item],loading:false,error:''});
 assert.ok(html.includes('Отменена'));
 assert.ok(!html.includes('<script>'));
 assert.ok(!html.includes('<img'));
 assert.ok(html.includes('&lt;img'));
});

test('P1 confirmed write during an in-flight read queues a fresh ledger readback',async()=>{
 const pending=[];
 const root={innerHTML:'',addEventListener(){},removeEventListener(){},querySelector(){return null;}};
 const panel=mountNativeFinanceParity(root,{
  fetchPage:()=>new Promise(resolve=>pending.push(resolve)),
  onQuickAction:()=>true
 });
 assert.equal(pending.length,1);
 await panel.load();
 assert.equal(pending.length,1,'a second concurrent GET must not start');
 pending.shift()(source());
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(pending.length,1,'refresh must be queued and retried after the first GET');
 const fresh=source();fresh.ledger.currentCashBase='224000.000000';
 pending.shift()(fresh);
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(root.innerHTML,/224\s?000/);
 panel.unmount();
});
