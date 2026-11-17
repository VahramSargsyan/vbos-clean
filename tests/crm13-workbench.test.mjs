import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const from=script.indexOf('/* CRM-13A: legacy mobile workbench');
const end=script.indexOf('async function loadCrmFollowups(){',from);
assert.ok(from>=0&&end>from,'CRM-13A workbench section must be present');
const helpersFrom=script.indexOf('function crmLeadScoreFromFocus(id){');
const helpersTo=script.indexOf('/* CRM-25A: external Masters directory.',helpersFrom);
assert.ok(helpersFrom>end&&helpersTo>helpersFrom,'Canonical compact-row helper must exist');
const fragment=script.slice(from,end)+'\n'+script.slice(helpersFrom,helpersTo);
const htmlEsc=x=>String(x??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);

function harness(){
 const id='11111111-1111-4111-8111-111111111111';
 const lead={id,title:'Клиент <script>alert(1)</script>',contact_name:'Контакт',
  phone:'+374 10 000000',status:'new',next_action:null,created_at:'2026-11-08T10:00:00Z'};
 const item={leadId:id,title:lead.title,contactName:lead.contact_name,phone:lead.phone,
  status:'new',nextAction:'Позвонить',nextActionOn:'2026-11-08',nextActionLocal:'2026-11-08T11:00',
  lastContactAt:'2026-11-07T10:00:00Z',bucket:'today',
  winScore:{ready:true,score:82,band:'VERY_STRONG',bandLabel:'Очень сильный',calibratedProbability:false}};
 const buckets={
  overdue:{count:0,items:[]},
  today:{count:1,items:[item]},
  noNext:{count:2,items:[]},
  stale:{count:0,items:[]}
 };
 const result={version:'CRM07A_READ_ONLY',source:'CANONICAL_LEAD_NEXT_ACTION',
  openLeadCount:3,attentionCount:3,buckets,
  priority:{version:'CRM11A_ATTENTION_SCORE_V1',source:'CANONICAL_CRM10A_SIGNALS_AND_CRM07_ATTENTION',
   coverage:{complete:true},scoreCoverage:{ready:1,unready:2},count:1,items:[{...item,priorityKey:'today',reason:'Сегодня назначен контакт'}]}
 };
 const ctx=vm.createContext({
  data:{today:'2026-11-08',leads:[lead]},esc:htmlEsc,
  label:{new:'Новый',contacted:'Связались',qualified:'В работе',won:'Успешно',lost:'Отказ'},
  crmStageOptions:[['approved','Согласовано'],['negotiation','Переговоры'],['new_contact','Новый контакт']],
  fmt:x=>Number(x||0).toLocaleString('ru-RU'),
  when:x=>new Date(x).toISOString().slice(0,16).replace('T',' ')
 });
 vm.runInContext(fragment,ctx,{filename:'crm13-workbench-ui.js'});
 vm.runInContext('crmFollowupState.loaded=true',ctx);
 ctx.crmTestResult=result;
 vm.runInContext('crmFollowupState.result=crmTestResult',ctx);
 return {ctx,id,lead,item,result};
}

test('CRM13A: four focus counters, compact clickable rows, escaped lead titles',()=>{
 const {ctx}=harness();
 let ui=vm.runInContext('crmFollowupView()',ctx);
 assert.match(ui,/Фокус CRM/);
 for(const label of ['Просрочено','Сегодня','Без шага','Зависшие'])assert.ok(ui.includes(label),label);
 assert.equal((ui.match(/data-crm-focus-filter=/g)||[]).length,4);
 assert.match(ui,/aria-pressed="true"/);
 assert.match(ui,/требуют внимания: 3/);
 assert.match(ui,/В выбранной группе пока нет обращений/);
 vm.runInContext("crmFocusFilter='today'",ctx);
 ui=vm.runInContext('crmFollowupView()',ctx);
 assert.match(ui,/82%/);
 assert.match(ui,/Win Score/);
 assert.match(ui,/Контакт/);
 assert.doesNotMatch(ui,/Последняя запись контакта:|Следующий шаг:|Открыть карточку/);
 assert.match(ui,/data-crm-followup-lead=/);
 assert.ok(!ui.includes('<script>alert(1)</script>'),'Lead titles are escaped before rendering');
 assert.match(ui,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.equal((ui.match(/data-crm-quick-lead=/g)||[]).length,0);
 assert.doesNotMatch(ui,/data-crm-reminder-open=/);
});

test('CRM13A: quick buttons OPEN existing CRM06A form, no mutation before Save',()=>{
 const {ctx,id}=harness();
 vm.runInContext(`crmQuickAction={leadId:'${id}',context:'focus',kind:'call'}`,ctx);
 const call=vm.runInContext(`crmQuickForm('${id}','focus')`,ctx);
 assert.match(call,/data-act="crm_interaction_add"/);
 assert.match(call,/name="entityType" value="Lead"/);
 assert.match(call,/name="interactionType" value="call"/);
 assert.match(call,/name="summary"[^>]*required/);
 assert.match(call,/Сохранить контакт/);
 assert.match(call,/Пока ничего не записано/);
 assert.doesNotMatch(call,/name="nextAction"/,'Quick history entry does not silently set canonical reminder');
 vm.runInContext("crmQuickAction.kind='message'",ctx);
 const message=vm.runInContext(`crmQuickForm('${id}','focus')`,ctx);
 assert.match(message,/name="interactionType" value="message"/);
 vm.runInContext("crmQuickAction.kind='no_answer'",ctx);
 const noAnswer=vm.runInContext(`crmQuickForm('${id}','focus')`,ctx);
 assert.match(noAnswer,/name="interactionType" value="call"/);
 assert.match(noAnswer,/Не ответил<\/textarea>/,'User sees editable result before Save');
 assert.equal(vm.runInContext(`crmQuickForm('${id}','priority')`,ctx),'',
  'A quick form must not appear simultaneously in another section');
 assert.doesNotMatch(fragment,/fetch\(|pool\.query\(|INSERT INTO|UPDATE public\./,
  'Quick UI has no direct persistence or network side effects');
 assert.match(script,/await sendAction\(type,payload,f\)/);
});

test('CRM13A: Priority retains canonical order but displays compact rows without quick forms',()=>{
 const {ctx}=harness();
 const view=vm.runInContext('crmPriorityView()',ctx);
 assert.match(view,/Приоритет сейчас/);
 assert.match(view,/82%/);
 assert.match(view,/data-crm-followup-lead=/);
 assert.equal((view.match(/data-crm-quick-lead=/g)||[]).length,0);
 assert.ok(!view.includes('<script>alert(1)</script>'));
 assert.match(fragment,/priority\?\.version==='CRM11A_ATTENTION_SCORE_V1'/);
 assert.match(fragment,/CANONICAL_CRM10A_SIGNALS_AND_CRM07_ATTENTION/);
 assert.match(script,/api\('\/api\/crm\/followups\?limit=6'\)/);
 const start=script.indexOf('function crmView(){');
 const end=script.indexOf('function clientListCard(',start);
 assert.ok(start>0&&end>start);
 const body=script.slice(start,end);
 const order=['form(\'lead_create\'','data.leads.map(crmLeadEntry)','crmFollowupView()','crmCapacitySignpost()','crmPriorityView()'];
 let pos=-1;
 for(const marker of order){const i=body.indexOf(marker);assert.ok(i>pos,marker+' should follow previous screen section');pos=i;}
});

test('CRM13A/14A: compact list delegates to isolated Lead editor without losing canonical actions',()=>{
 const listStart=script.indexOf('function crmCompactLeadRow(');
 const detailStart=script.indexOf('function crmLeadDetails(',listStart);
 const viewStart=script.indexOf('function crmView(){',detailStart);
 const list=script.slice(listStart,detailStart);
 const section=script.slice(detailStart,viewStart);
 assert.ok(section.length>1000);
 assert.match(list,/data-crm-lead-open/);
 assert.doesNotMatch(list,/crmReminderCard\(x\)|crmInteractionView\('Lead',x.id\)|leadEdit\(x\)/,
  'Long editor and nested forms cannot appear in overview cards');
 assert.match(section,/data-crm-detail-page/);
 assert.match(section,/data-crm-back/);
 assert.match(section,/crmReminderCard\(x\)/);
 assert.match(section,/crmLeadSignalCard\(x\)/);
 assert.match(section,/crmInteractionView\('Lead',x.id\)/);
 assert.match(section,/crmLeadConversion\(x\)/);
 assert.match(section,/data-estimate-open/);
 assert.match(script,/function plumbingWorkspace\(lead\)/);
 assert.match(script,/function crmView\(\)\{\s*if\(estimateWorkspaceOpen\)/);
 assert.match(section,/statusButtons\(x,'lead_status'/);
 assert.match(section,/leadEdit\(x\)/);
 assert.match(script,/openCrmLeadDetail\(openReminder.dataset.crmReminderOpen,\{reminder:true\}\)/);
 assert.match(script,/data-crm-reminder-details/);
 assert.match(script,/data-crm-lead-open/);
 assert.match(script,/data-crm-focus-filter/);
});
test('CRM13A: Capacity explicitly unverified; existing Calendar is the only navigation target',()=>{
 const {ctx}=harness();
 const ui=vm.runInContext('crmCapacitySignpost()',ctx);
 assert.match(ui,/Покрытие свободной Capacity/);
 assert.match(ui,/нет проверенного расчёта/);
 assert.match(ui,/data-open-schedule/);
 assert.doesNotMatch(ui,/\b(?:0|14|30)\s*занято\b/);
 assert.doesNotMatch(ui,/data-crm-capacity-duration|data-act="capacity_save"/);
 assert.match(css,/CRM-13A: logic\/layout/);
 assert.match(css,/\.crm-focus-grid/);
 assert.match(css,/\.crm-quick-actions/);
 assert.match(css,/var\(--accent\)/);
});
