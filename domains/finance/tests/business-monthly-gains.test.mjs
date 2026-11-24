import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBusinessMonthlyGain,readBusinessMonthlyGain,saveBusinessMonthlyGain,BusinessMonthlyGainError} from '../business-monthly-gains.mjs';
import {businessGainPreview,businessGainEditorHtml,gainFields,mountBusinessGainEditor} from '../business-monthly-gains-view.mjs';

const sample={monthKey:'2026-08',referralCommissionBase:'3000',purchaseCommissionBase:'84300',
 organizationMarginBase:'100000',taxOptimizationSavingsBase:'4000',otherBusinessIncomeBase:'0'};
test('five-category arithmetic with existing deterministic fixture totals',()=>{
 const aug=normalizeBusinessMonthlyGain(sample);
 assert.equal(aug.totalBusinessGainsBase,'191300.00');
 const sep=normalizeBusinessMonthlyGain({monthKey:'2026-09',referralCommissionBase:79400,
  purchaseCommissionBase:165000,organizationMarginBase:59000,
  taxOptimizationSavingsBase:4000,otherBusinessIncomeBase:0});
 assert.equal(sep.totalBusinessGainsBase,'307400.00');
 assert.equal(aug.monthKey,'2026-08');
 assert.equal(businessGainPreview(aug),aug.totalBusinessGainsBase);
 assert.equal(gainFields.length,5);
});
test('month key stays literal YYYY-MM, no timezone mutation or silent current month fallback',()=>{
 for(const monthKey of ['2026-00','2026-13','2026-08-01','August 2026','','  ','26-08']){
  assert.throws(()=>normalizeBusinessMonthlyGain({...sample,monthKey}),e=>e.status===400,monthKey);
 }
 assert.equal(normalizeBusinessMonthlyGain({...sample,monthKey:'2026-08'}).monthKey,'2026-08');
 assert.throws(()=>normalizeBusinessMonthlyGain({...sample,monthKey:undefined}),/MONTH_KEY_INVALID/);
});
test('exact cents, nonnegative, default zeros and five-category maximum',()=>{
 let p=normalizeBusinessMonthlyGain({monthKey:'2027-01',referralCommissionBase:'1.005',
  purchaseCommissionBase:'0.004',organizationMarginBase:'0.015'});
 assert.equal(p.referralCommissionBase,'1.01');
 assert.equal(p.purchaseCommissionBase,'0.00');
 assert.equal(p.organizationMarginBase,'0.02');
 assert.equal(p.totalBusinessGainsBase,'1.03');
 assert.equal(businessGainPreview(p),'1.03');
 for(const value of ['-1','NaN','1e4','Infinity','999999999.999999','1.2345678','<script>']){
  assert.throws(()=>normalizeBusinessMonthlyGain({monthKey:'2027-01',referralCommissionBase:value}),
   e=>e instanceof BusinessMonthlyGainError&&e.status===400,value);
 }
 assert.equal(normalizeBusinessMonthlyGain({monthKey:'2027-02'}).totalBusinessGainsBase,'0.00');
});
test('do not accept oversized notes',()=>{
 assert.throws(()=>normalizeBusinessMonthlyGain({monthKey:'2026-08',notes:'a'.repeat(2001)}),
  e=>e.status===400);
 assert.equal(normalizeBusinessMonthlyGain({monthKey:'2026-08',notes:'  test  '}).notes,'test');
});
test('owner authorization precedes reads, writes, and database client acquisition',async()=>{
 let count=0;
 const db={query:async()=>{count++;throw Error('DB_READ');},connect:async()=>{count++;throw Error('DB_WRITE');}};
 await assert.rejects(readBusinessMonthlyGain(db,'2026-08',{authorizeOwner:()=>false}),
  e=>e instanceof BusinessMonthlyGainError&&e.status===401);
 await assert.rejects(saveBusinessMonthlyGain(db,{...sample,requestKey:'invalid',expectedRevision:0},
  {authorizeOwner:()=>false}),e=>e instanceof BusinessMonthlyGainError&&e.status===401);
 assert.equal(count,0);
 await assert.rejects(saveBusinessMonthlyGain(db,{...sample,requestKey:'invalid',expectedRevision:0},
  {authorizeOwner:()=>true}),e=>e.status===400);
 assert.equal(count,0);
});
test('new archive and operational balance are explicitly separate in UI',()=>{
 const fields={...sample};
 const html=businessGainEditorHtml({monthKey:'2026-08',draft:fields,revision:0,months:[]});
 assert.match(html,/191(?:\s|\u00a0)?300,00 AMD/);
 assert.match(html,/Отдельный реестр PostgreSQL · TEST/);
 assert.match(html,/Дополнительная прибыль бизнеса за месяц/);
 assert.match(html,/Итого дополнительная прибыль/);
 assert.match(html,/Сохранить итоги месяца/);
 assert.match(html,/Вноси только положительную сумму законно сохранённых денег/);
 assert.match(html,/Не влияет на текущие финансы/);
 const x=businessGainEditorHtml({monthKey:'2026-08',draft:{...fields,notes:'<img src=x onerror=alert(1)>'},revision:1});
 assert.match(x,/&lt;img/);
 assert.doesNotMatch(x,/<img/);
});
test('editor fetches month with owner session; source guard rejects false live data',async()=>{
 const handles=new Map(),calls=[];
 const root={innerHTML:'',addEventListener:(k,fn)=>handles.set(k,fn),
  removeEventListener:(k,fn)=>{if(handles.get(k)===fn)handles.delete(k);},
  querySelector:()=>null};
 const fetchPage=async (path,payload)=>{
  calls.push({path,payload});
  return {source:'LIVE',scope:'PROD',record:{monthKey:'2026-11',revision:1}};
 };
 const editor=mountBusinessGainEditor(root,{fetchPage});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,1);
 assert.match(root.innerHTML,/Источник месячных данных не подтверждён/);
 editor.unmount();assert.equal(handles.size,0);
});

test('monthly gain editor submits five-source sum, revision and requestKey, then confirms readback',async()=>{
 const handlers=new Map(),calls=[];
 const root={innerHTML:'',addEventListener:(k,h)=>handlers.set(k,h),
  removeEventListener:(k,h)=>{if(handlers.get(k)===h)handlers.delete(k);},
  querySelector:()=>({textContent:''})};
 const empty={referralCommissionBase:'0.00',purchaseCommissionBase:'0.00',
  organizationMarginBase:'0.00',taxOptimizationSavingsBase:'0.00',
  otherBusinessIncomeBase:'0.00',notes:''};
 let month;
 const source={source:'CLEAN_TEST_MONTHLY_GAINS_NO_LEDGER',
  monthlyAuthority:'POSTGRESQL',financialAuthority:'NOT_APPLICABLE',scope:'TEST_ONLY',currentOperationalFinance:false,ledgerEffect:false,readonly:false};
 const fetchPage=async (path,payload)=>{
  calls.push({path,payload});
  month=new URL(path,'https://test.invalid').searchParams.get('monthKey')||payload?.monthKey||month;
  if(payload){
   assert.equal(payload.expectedRevision,0);
   assert.equal(payload.referralCommissionBase,'10.01');
   assert.match(payload.requestKey,/^[0-9a-f-]{36}$/i);
   return {...source,record:{...empty,monthKey:month,referralCommissionBase:'10.01',
    totalBusinessGainsBase:'10.01',revision:1},replayed:false,superseded:false};
  }
  return {...source,record:{...empty,monthKey:month,totalBusinessGainsBase:'0.00',revision:0},
   months:[]};
 };
 const editor=mountBusinessGainEditor(root,{fetchPage});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,1);
 assert.match(root.innerHTML,/Сохранить итоги месяца/);
 handlers.get('input')({target:{getAttribute:k=>k==='data-gain-amount'?'referralCommissionBase':null,
  value:'10.01'}});
 handlers.get('submit')({target:{matches:x=>x==='[data-gain-form]'},preventDefault(){}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,2);
 assert.match(root.innerHTML,/Итого дополнительная прибыль/);
 assert.match(root.innerHTML,/Версия записи: 1/);
 assert.match(root.innerHTML,/Итоги месяца сохранены/);
 editor.unmount();assert.equal(handlers.size,0);
});
test('failed monthly source is not editable; retry must first verify the source',async()=>{
 const handlers=new Map(),root={innerHTML:'',addEventListener:(k,h)=>handlers.set(k,h),
  removeEventListener:(k,h)=>handlers.delete(k)};
 const editor=mountBusinessGainEditor(root,{fetchPage:async()=>{throw Error('MIGRATION_NOT_APPLIED');}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(root.innerHTML,/Повторить загрузку месяца/);
 assert.doesNotMatch(root.innerHTML,/Сохранить итоги месяца/);
 editor.unmount();
});

test('M1 empty inputs, exact rounding and object coercion',()=>{
 const d={monthKey:'2035-07',referralCommissionBase:'',purchaseCommissionBase:'1.005',organizationMarginBase:'2.015'};
 assert.equal(businessGainPreview(d),'3.03');
 assert.equal(normalizeBusinessMonthlyGain(d).totalBusinessGainsBase,'3.03');
 for(const value of [[],[1],{},true]){
  assert.throws(()=>normalizeBusinessMonthlyGain({...d,referralCommissionBase:value}),err=>err.status===400);
  assert.throws(()=>businessGainPreview({...d,referralCommissionBase:value}));
 }
 assert.throws(()=>normalizeBusinessMonthlyGain({...d,notes:{}}),err=>err.status===400);
});
const m1source={source:'CLEAN_TEST_MONTHLY_GAINS_NO_LEDGER',monthlyAuthority:'POSTGRESQL',financialAuthority:'NOT_APPLICABLE',
 scope:'TEST_ONLY',currentOperationalFinance:false,ledgerEffect:false,readonly:false};
const m1empty={referralCommissionBase:'0.00',purchaseCommissionBase:'0.00',organizationMarginBase:'0.00',
 taxOptimizationSavingsBase:'0.00',otherBusinessIncomeBase:'0.00',notes:'',totalBusinessGainsBase:'0.00'};
const m1root=()=>{const handlers=new Map();return {handlers,innerHTML:'',addEventListener:(k,h)=>handlers.set(k,h),removeEventListener:k=>handlers.delete(k),querySelector:()=>null};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const m1submit=root=>root.handlers.get('submit')({target:{matches:s=>s==='[data-gain-form]'},preventDefault(){}});
test('M1 double click, network retry key and stale revision force reload',async()=>{
 const root=m1root(),posts=[],gets=[];
 const panel=mountBusinessGainEditor(root,{fetchPage:async(path,payload)=>{
  if(payload){posts.push(payload);if(posts.length===1)throw Error('NETWORK');const err=Error('MONTHLY_GAIN_STALE_REVISION');err.status=409;throw err;}
  const key=new URL(path,'https://example.invalid').searchParams.get('monthKey');gets.push(key);
  return {...m1source,record:{...m1empty,monthKey:key,revision:0},months:[]};
 }});
 await tick();
 root.handlers.get('input')({target:{getAttribute:k=>k==='data-gain-amount'?'referralCommissionBase':null,value:'12.34'}});
 m1submit(root);m1submit(root);await tick();assert.equal(posts.length,1);
 m1submit(root);await tick();assert.equal(posts.length,2);assert.equal(posts[0].requestKey,posts[1].requestKey);
 assert.match(root.innerHTML,/Перезагрузи месяц/);assert.doesNotMatch(root.innerHTML,/Сохранить итоги месяца/);
 m1submit(root);await tick();assert.equal(posts.length,2);
 root.handlers.get('change')({target:{matches:s=>s==='[data-gain-month]',value:'2035-07'}});await tick();
 assert.equal(gets.at(-1),'2035-07');assert.match(root.innerHTML,/Сохранить итоги месяца/);
 assert.doesNotMatch(root.innerHTML,/value="12.34"/);panel.unmount();
});
test('M1 superseded replay with changed total requires reload',async()=>{
 const root=m1root(),panel=mountBusinessGainEditor(root,{fetchPage:async(path,payload)=>payload?
  {...m1source,record:{...m1empty,monthKey:payload.monthKey,revision:2,referralCommissionBase:'9.00',totalBusinessGainsBase:'9.00'},replayed:true,superseded:true}:
  {...m1source,record:{...m1empty,monthKey:new URL(path,'https://example.invalid').searchParams.get('monthKey'),revision:0}}});
 await tick();m1submit(root);await tick();
 assert.match(root.innerHTML,/Месяц уже изменён после этого запроса/);
 assert.doesNotMatch(root.innerHTML,/Сохранить итоги месяца/);panel.unmount();
});
