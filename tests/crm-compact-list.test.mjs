import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const helperStart=app.indexOf('function crmLeadScoreFromFocus(id){');
const helperEnd=app.indexOf('/* CRM-25A: external Masters directory.',helperStart);
const workStart=app.indexOf('function crmWorkbenchLead(item,context){');
const workEnd=app.indexOf('function crmFollowupView(){',workStart);
assert.ok(helperStart>0&&helperEnd>helperStart&&workStart>0&&workEnd>workStart);
const fragment=app.slice(helperStart,helperEnd)+'\n'+app.slice(workStart,workEnd);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);

function harness(){
 const id='11111111-1111-4111-8111-111111111111';
 const ca='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const cb='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const lead={id,title:'Ремонт <вентиляция>',contact_name:'Роман',phone:'091111111',status:'new'};
 const clients=[
  {id:ca,name:'Другой клиент',phone:lead.phone},
  {id:cb,name:'Заказчик <test>',phone:lead.phone}
 ];
 const ctx=vm.createContext({
  data:{leads:[lead],clients,leadIntakes:[{lead_id:id,client_id:cb}],leadClientLinks:[]},
  crmFollowupState:{result:null},
  esc,label:{new:'Новый',lost:'Отказ',won:'Успешно'}
 });
 vm.runInContext(fragment,ctx,{filename:'crm-compact-source.js'});
 return {ctx,id,lead,ca,cb};
}

test('CRM Compact: explicit Client→Lead link determines displayed name, not matching phone',()=>{
 const {ctx,id,lead}=harness();
 const row=vm.runInContext('crmLeadEntry(data.leads[0])',ctx);
 assert.match(row,/Заказчик &lt;test&gt;/);
 assert.doesNotMatch(row,/Другой клиент|<test>|<вентиляция>/);
 assert.match(row,/Ремонт &lt;вентиляция&gt;/);
 assert.match(row,new RegExp('data-crm-lead-open="'+id+'"'));
 assert.match(row,/data-crm-lead-card=/);
 assert.equal((row.match(/<button/g)||[]).length,1,'One entire-row tap target');
 assert.doesNotMatch(row,/data-crm-quick-lead|data-crm-reminder-open|Открыть карточку/);
 assert.match(row,/Win Score/);
 assert.match(row,/<strong>—<\/strong>/,'No score must not look like zero');
});

test('CRM Compact: unlinked contact is not silently joined by phone',()=>{
 const {ctx}=harness();
 ctx.data.leadIntakes=[];
 ctx.data.leads[0].contact_name='Заявитель';
 const row=vm.runInContext('crmLeadEntry(data.leads[0])',ctx);
 assert.match(row,/Заявитель/);
 assert.doesNotMatch(row,/Заказчик|Другой клиент/);
 assert.match(row,/Контакт: Заявитель/,'Accessible label must identify fallback as contact');
});

test('CRM Compact: valid score, including zero, comes from canonical bounded read response',()=>{
 const {ctx,id}=harness();
 ctx.crmFollowupState.result={
  buckets:{today:{items:[]}},
  priority:{items:[{leadId:id,winScore:{ready:true,score:82,calibratedProbability:false}}]}
 };
 let row=vm.runInContext('crmLeadEntry(data.leads[0])',ctx);
 assert.match(row,/>82%<\/strong>/);
 assert.match(row,/Win Score/);
 ctx.crmFollowupState.result.priority.items[0].winScore.score=0;
 row=vm.runInContext('crmLeadEntry(data.leads[0])',ctx);
 assert.match(row,/>0%<\/strong>/);
 ctx.crmFollowupState.result.priority.items=[];
 row=vm.runInContext('crmLeadEntry(data.leads[0])',ctx);
 assert.doesNotMatch(row,/>0%<\/strong>/);
 assert.match(row,/<strong>—<\/strong>/);
});

test('CRM Compact: Focus/Priority show one touch target and no inline CRM mutations',()=>{
 const {ctx,id}=harness();
 const row=vm.runInContext(
  `crmWorkbenchLead({leadId:'${id}',title:'Ремонт',winScore:{ready:true,score:65},status:'new'},'priority')`,ctx);
 assert.match(row,/data-crm-followup-lead=/);
 assert.match(row,/65%/);
 assert.doesNotMatch(row,/data-crm-quick-lead|data-crm-reminder-open|<form|Открыть карточку/);
 assert.equal((row.match(/<button/g)||[]).length,1);
});

test('CRM Compact: overview first, advanced panels collapsed; detail keeps actions',()=>{
 const start=app.indexOf('function crmView(){');
 const end=app.indexOf('function clientListCard(',start);
 const view=app.slice(start,end);
 const row=view.indexOf('data.leads.map(crmLeadEntry)');
 const adv=view.indexOf('data-crm-advanced');
 const archive=view.indexOf('data-crm-legacy-archive');
 assert.ok(row>0&&adv>row&&archive>adv,'Main lead list must be first');
 assert.match(view,/crmAdvancedOpen\?' open':''/);
 assert.match(view,/crmArchiveOpen\?' open':''/);
 assert.match(app,/crmAdvancedOpen=detail.open/);
 assert.match(app,/crmArchiveOpen=detail.open/);
 assert.match(app,/openCrmLeadDetail\(openExisting.dataset.crmLeadOpen\)/);
 assert.match(app,/openCrmLeadDetail\(attentionOpen.dataset.crmFollowupLead\)/);
 assert.match(app,/crmQuickButtons\(x.id,'detail'\)/);
 assert.match(css,/CRM Compact List: mobile-first/);
 assert.match(css,/button\.crm-compact-lead:focus-visible/);
 assert.match(css,/min-height:64px/);
 assert.match(view,/эвристический балл 0–100, не вероятность продажи/);
});
