import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBusinessMonthlyGain,readBusinessMonthlyGain,saveBusinessMonthlyGain,BusinessMonthlyGainError} from '../business-monthly-gains.mjs';
import {businessGainPreview,businessGainEditorHtml,gainFields,mountBusinessGainEditor} from '../business-monthly-gains-view.mjs';

const sample={monthKey:'2026-08',referralCommissionBase:'3000',purchaseCommissionBase:'84300',
 organizationMarginBase:'100000',taxOptimizationSavingsBase:'4000',otherBusinessIncomeBase:'0'};
test('legacy 5-category original archived August and September totals',()=>{
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
 assert.match(html,/TEST-реестр/);
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
  financialAuthority:'GOOGLE',scope:'TEST_ONLY',currentOperationalFinance:false,ledgerEffect:false,readonly:false};
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
 assert.match(root.innerHTML,/Сохранить в TEST/);
 handlers.get('input')({target:{getAttribute:k=>k==='data-gain-amount'?'referralCommissionBase':null,
  value:'10.01'}});
 handlers.get('submit')({target:{matches:x=>x==='[data-gain-form]'},preventDefault(){}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,2);
 assert.match(root.innerHTML,/Итого за месяц/);
 assert.match(root.innerHTML,/Версия записи: 1/);
 assert.match(root.innerHTML,/Сохранено в отдельном TEST-реестре/);
 editor.unmount();assert.equal(handlers.size,0);
});
test('failed monthly source is not editable; retry must first verify the source',async()=>{
 const handlers=new Map(),root={innerHTML:'',addEventListener:(k,h)=>handlers.set(k,h),
  removeEventListener:(k,h)=>handlers.delete(k)};
 const editor=mountBusinessGainEditor(root,{fetchPage:async()=>{throw Error('MIGRATION_NOT_APPLIED');}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(root.innerHTML,/Повторить загрузку месяца/);
 assert.doesNotMatch(root.innerHTML,/Сохранить в TEST/);
 editor.unmount();
});
