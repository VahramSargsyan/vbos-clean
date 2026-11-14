import test from 'node:test';
import assert from 'node:assert/strict';
import {historyLocalDate,renderHistoryOrdersPanel,mountHistoryOrdersPanel} from '../history-orders-view.mjs';
const item=(o={})=>({legacy_order_id:'WO-2026-0024',status:'active',title:'Крыша квартир 36 и 46',client_name:'Аджапняк 5',object_title:'Алабян 39',planned_profit_amount:'120000',planned_profit_currency:'AMD',planned_start_raw:'2026-10-10',...o});
const page=(items=[item()],hasMore=false)=>({items,hasMore,readonly:true,scope:'unfinished'});
test('Shows historical project labels without pretending planned profit is realized',()=>{
 const html=renderHistoryOrdersPanel(page(),{scope:'unfinished'});
 assert.ok(html.includes('Алабян 39'));
 assert.ok(html.includes('120 000 драм')||html.includes('120 000 драм'));
 assert.ok(html.includes('не фактический доход'));
 assert.ok(html.includes('Активен'));
 assert.ok(html.includes('Только просмотр'));
});
test('Never writes user data unescaped in HTML',()=>{
 const html=renderHistoryOrdersPanel(page([item({title:'<img src=x onerror=alert(1)>',client_name:'<script>alert(2)</script>',object_title:'" onclick="evil()'})]),{query:'" autofocus onfocus=bad()'});
 assert.ok(!html.includes('<img'));
 assert.ok(!html.includes('<script'));
 assert.ok(html.includes('&lt;img'));
 assert.ok(html.includes('&quot; autofocus'));
});
test('Date normalizes UTC 20:00 to next day in Yerevan',()=>{
 assert.equal(historyLocalDate('2026-09-15T20:00:00.000Z'),'16.09.2026');
 assert.equal(historyLocalDate('2026-09-16'),'16.09.2026');
});
test('Finished and unfinished sections are explicit separate options',()=>{
 const a=renderHistoryOrdersPanel(page([]),{scope:'finished'});
 const b=renderHistoryOrdersPanel(page([]),{scope:'unfinished'});
 assert.ok(a.includes('data-scope="finished" aria-pressed="true"'));
 assert.ok(b.includes('data-scope="unfinished" aria-pressed="true"'));
});
test('Empty, loading, error and more states are distinct',()=>{
 assert.ok(renderHistoryOrdersPanel(page([])).includes('Записей по запросу нет'));
 assert.ok(renderHistoryOrdersPanel(page([]),{busy:true}).includes('Загрузка истории'));
 assert.ok(renderHistoryOrdersPanel(page([]),{error:'Ошибка доступа'}).includes('role="alert"'));
 assert.ok(renderHistoryOrdersPanel(page([item()],true)).includes('Показать ещё'));
});
test('No speculative profit for empty or invalid amounts',()=>{
 const html=renderHistoryOrdersPanel(page([item({planned_profit_amount:'',planned_profit_currency:''}),item({planned_profit_amount:'oops'})]));
 assert.ok(!html.includes('Ожидаемая прибыль:'));
});
test('View fails closed on invalid scopes and invalid mount inputs',()=>{
 assert.throws(()=>renderHistoryOrdersPanel(page(),{scope:'deleted'}));
 assert.throws(()=>renderHistoryOrdersPanel(page(),{query:'x'.repeat(81)}));
 assert.throws(()=>mountHistoryOrdersPanel(null,{fetchPage:()=>{}}));
 assert.throws(()=>mountHistoryOrdersPanel({innerHTML:'',addEventListener(){}},{}));
});
test('Switching scope during pending request discards stale finished response',async()=>{
 const listeners={};const pending=[];
 const root={innerHTML:'',addEventListener:(type,fn)=>{(listeners[type]??=[]).push(fn);},removeEventListener:()=>{}};
 const view=mountHistoryOrdersPanel(root,{fetchPage:()=>new Promise(resolve=>pending.push(resolve))});
 assert.equal(pending.length,1);
 const target={closest:selector=>selector==='[data-scope]'?{getAttribute:()=> 'unfinished'}:null};
 listeners.click[0]({target});
 assert.equal(pending.length,2);
 pending[0]({items:[item({status:'completed',title:'OLD'})],scope:'finished',readonly:true,hasMore:false});
 await Promise.resolve();
 pending[1]({items:[item()],scope:'unfinished',readonly:true,hasMore:false});
 await Promise.resolve();await Promise.resolve();
 assert.ok(root.innerHTML.includes('Алабян 39'));
 assert.ok(!root.innerHTML.includes('OLD'));
 view.unmount();
});

test('Six decimal places are displayed without rounding or inventing currency',()=>{
 const html=renderHistoryOrdersPanel(page([item({planned_profit_amount:'1234.123456',planned_profit_currency:''})]));
 assert.ok(html.includes('1 234,123456 валюта не указана'));
});
