import {test} from 'node:test';
import assert from 'node:assert/strict';
import {correctionRowsHtml,mountFinanceCorrectionsPanel} from '../finance-corrections-view.mjs';

const item=(kind,id,extras={})=>({
 sourceKind:kind,sourceId:id,originalTitle:'Исходное название',sourceStatus:'active',
 reviewState:'UNREVIEWED',amountBase:'200.000000',displayTitle:null,ownerNote:null,
 revision:0,sourcePreserved:true,...extras
});
const records=[
 item('FINANCE_TRANSACTION','FIN-1',{originalTitle:'Платёж <img src=x onerror=alert(1)>'}),
 item('FINANCE_TRANSACTION','FIN-2',{reviewState:'ARCHIVED',
  displayTitle:'Старое исправление',ownerNote:'Приватное & примечание',revision:1}),
 item('BUSINESS_MONTHLY_GAIN','2026-08'),
 ...Array.from({length:8},(_,i)=>item('CAPITAL_FUND','FND-'+(i+1))),
 item('CAPITAL_ALLOCATION_BATCH','BATCH-1'),
 ...Array.from({length:6},(_,i)=>item('CAPITAL_FUND_TRANSACTION','MOVE-'+(i+1))),
 ...Array.from({length:22},(_,i)=>item('FINANCE_TRANSACTION','FIN-'+(i+3))),
 ...Array.from({length:2},(_,i)=>item('BUSINESS_MONTHLY_GAIN','2026-0'+(i+9)))
];
const data={source:'VERIFIED_FINANCE_OWNER_CORRECTIONS',readonlySource:true,
 financialWriter:'GOOGLE',moneyAffected:false,
 editableFields:['displayTitle','ownerNote'],total:42,corrected:1,items:records};

test('source labels escaped, financial amounts visible but noneditable, no financial form fields',()=>{
 const html=correctionRowsHtml(data,{mode:'finance',filter:'ALL',editorKey:'FINANCE_TRANSACTION:FIN-1'});
 assert.match(html,/Название для отображения|Новое название/);
 assert.match(html,/Исходное название/);
 assert.match(html,/Историческая сумма/);
 assert.doesNotMatch(html,/<img /);
 assert.match(html,/&lt;img src=x/);
 assert.match(html,/<form data-correction-form/);
 assert.match(html,/name="displayTitle"/);
 assert.match(html,/name="ownerNote"/);
 assert.doesNotMatch(html,/name="amountBase"|name="sourceStatus"|name="currency"/);
 assert.match(html,/Не меняются|не меняются/);
});
test('finance capital, archive and corrected filters have correct scope',()=>{
 const fin=correctionRowsHtml(data,{mode:'finance'});
 assert.match(fin,/FIN-1/);assert.doesNotMatch(fin,/FND-1/);
 assert.doesNotMatch(fin,/data-correction-id="FIN-2"/);
 const archived=correctionRowsHtml(data,{mode:'finance',filter:'ARCHIVED'});
 assert.match(archived,/data-correction-id="FIN-2"/);assert.doesNotMatch(archived,/data-correction-id="FIN-1"/);
 const corrected=correctionRowsHtml(data,{mode:'finance',filter:'EDITED'});
 assert.match(corrected,/Старое исправление/);assert.doesNotMatch(corrected,/data-correction-id="FIN-1"/);
 const capital=correctionRowsHtml(data,{mode:'capital'});
 assert.match(capital,/FND-1/);assert.doesNotMatch(capital,/FIN-1/);
});
test('render fails closed on financial authority and incorrect source contract',()=>{
 for(const invalid of [{...data,financialWriter:'CLEAN'},{...data,readonlySource:false},
  {...data,moneyAffected:true},{...data,total:41},{...data,editableFields:['amountBase']}])
  assert.throws(()=>correctionRowsHtml(invalid,{mode:'finance'}));
});
test('mount loads only same-origin owner endpoint and never writes on initial load',async()=>{
 const handlers={};
 const root={innerHTML:'',addEventListener(t,cb){handlers[t]=cb;},
  removeEventListener(t,cb){if(handlers[t]===cb)delete handlers[t];},
  querySelectorAll(){return[];}};
 let fetchCount=0,postCount=0;
 const panel=mountFinanceCorrectionsPanel(root,{mode:'finance',
  fetchPage:async url=>{assert.equal(url,'/api/finance/corrections');fetchCount++;return data;},
  saveCorrection:()=>{postCount++;}});
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(fetchCount,1);assert.equal(postCount,0);
 assert.match(root.innerHTML,/Исправить описание истории/);
 panel.unmount();assert.equal(handlers.click,undefined);assert.equal(handlers.submit,undefined);
});
test('failed source load shows a retry option without unverified financial records',async()=>{
 const handlers={};
 const root={innerHTML:'',addEventListener(t,cb){handlers[t]=cb;},
  removeEventListener(t){delete handlers[t];},querySelectorAll(){return[];}};
 let calls=0;
 const panel=mountFinanceCorrectionsPanel(root,{mode:'capital',
  fetchPage:async()=>{calls++;throw Error('NET_DOWN');},
  saveCorrection:()=>{}});
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(calls,1);assert.match(root.innerHTML,/NET_DOWN/);
 assert.match(root.innerHTML,/data-correction-refresh/);
 assert.doesNotMatch(root.innerHTML,/Исходное название|Историческая сумма/);
 panel.unmount();
});

test('unsaved edits survive re-render and are HTML-escaped after a failed request',()=>{
 const html=correctionRowsHtml(data,{mode:'finance',filter:'INBOX',editorKey:'FINANCE_TRANSACTION:FIN-1',
  draft:{key:'FINANCE_TRANSACTION:FIN-1',title:'Моё & <название>',
   note:'Сохранить <strong>важный</strong> комментарий'},error:'NETWORK_RETRY'});
 assert.match(html,/value="Моё &amp; &lt;название&gt;"/);
 assert.match(html,/Сохранить &lt;strong&gt;важный&lt;\/strong&gt; комментарий/);
 assert.doesNotMatch(html,/<strong>важный<\/strong>/);
 assert.match(html,/NETWORK_RETRY/);
});
