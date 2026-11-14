import {test} from 'node:test';
import assert from 'node:assert/strict';
import {correctionAuditRowsHtml,mountFinanceCorrectionAuditPanel} from '../finance-correction-audit-view.mjs';

const event={
 eventId:'24',sourceKind:'FINANCE_TRANSACTION',sourceId:'FIN-001',
 originalTitle:'Источник <img src=x onerror=alert(1)>',revision:2,
 priorTitle:'Прошлое <script>alert(1)</script>',nextTitle:'Новое & проверенное',
 priorNote:'До <b>abc</b>',nextNote:'После <svg onload=alert(1)>',
 actorLogin:'test-owner',recordedAt:'2026-11-06T12:40:00.000Z'
};
const page={
 source:'VERIFIED_FINANCE_CORRECTION_AUDIT',readonly:true,
 financialWriter:'GOOGLE',moneyAffected:false,mode:'finance',limit:10,
 events:[event],hasMore:false,nextCursor:null
};

test('history timeline escapes source and owner text without change controls',()=>{
 const html=correctionAuditRowsHtml(page,{mode:'finance'});
 assert.match(html,/Новое &amp; проверенное/);
 assert.match(html,/До &lt;b&gt;abc&lt;\/b&gt;/);
 assert.match(html,/Источник &lt;img src=x onerror=alert\(1\)&gt;/);
 assert.doesNotMatch(html,/<script|<svg|<img/);
 assert.match(html,/test-owner/);
 assert.match(html,/версия 2/);
 assert.doesNotMatch(html,/<form|data-correction-save|data-correction-clear/);
});
test('same timeline supports reset event and empty history',()=>{
 const html=correctionAuditRowsHtml({...page,events:[{...event,nextTitle:null,nextNote:null}]},{mode:'finance'});
 assert.match(html,/Сброс пользовательского описания/);
 assert.match(correctionAuditRowsHtml({...page,events:[]},{mode:'finance'}),/Исправлений пока не было/);
});
test('financial authority, unsupported kind, mode and oversized response fail closed',()=>{
 for(const p of [
  {...page,financialWriter:'CLEAN'}, {...page,readonly:false},
  {...page,moneyAffected:true}, {...page,mode:'capital'},
  {...page,events:Array.from({length:21},()=>event)},
  {...page,events:[{...event,sourceKind:'CAPITAL_FUND'}]},
  {...page,hasMore:true,nextCursor:null}
 ])assert.throws(()=>correctionAuditRowsHtml(p,{mode:'finance'}));
});
test('mount loads only owner endpoint with mode and never posts',async()=>{
 const handlers={};
 const root={innerHTML:'',addEventListener(type,fn){handlers[type]=fn;},
  removeEventListener(type){delete handlers[type];}};
 const calls=[];
 const panel=mountFinanceCorrectionAuditPanel(root,{mode:'finance',fetchPage:async path=>{
  calls.push(path);return page;
 }});
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.deepEqual(calls,['/api/finance/correction-audit?mode=finance&limit=10']);
 assert.match(root.innerHTML,/Новое &amp; проверенное/);
 panel.unmount();assert.equal(handlers.click,undefined);
});
test('network failure renders retry without unauthorized records',async()=>{
 const root={innerHTML:'',addEventListener(){},removeEventListener(){}};
 const panel=mountFinanceCorrectionAuditPanel(root,{mode:'capital',fetchPage:async()=>{throw Error('OFFLINE');}});
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.match(root.innerHTML,/OFFLINE/);
 assert.match(root.innerHTML,/data-audit-reload/);
 assert.doesNotMatch(root.innerHTML,/FIN-001/);
 panel.unmount();
});
