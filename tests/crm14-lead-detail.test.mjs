import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const start=script.indexOf('/* CRM-14A: dedicated in-app Lead view.');
const end=script.indexOf('function clientListCard(',start);
assert.ok(start>=0&&end>start,'CRM14A detail/overview boundary present');
const fragment=script.slice(start,end);
const escapeHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);

function harness(){
 const id='11111111-1111-4111-8111-111111111111';
 const lead={id,title:'Труба <script>alert(1)</script>',contact_name:'Контакт',
  phone:'+374 10 000000',status:'new',revision:1,notes:'Потребность',
  next_action:'Позвонить',next_action_at:'2026-11-08T11:00:00Z',agreement_stage:null};
 const scroll=[],editors=[],notice=[];
 const win={scrollY:413,scrollTo:(x,y)=>scroll.push([x,y])};
 const ctx=vm.createContext({
  tab:'crm',data:{today:'2026-11-08',leads:[lead],clients:[],archivedLegacyClientIds:[]},
  crmDetailId:null,crmReminderEditorLeadId:null,crmClientLeadContext:null,estimateWorkspaceOpen:false,crmListScrollY:0,crmFocusFilter:'today',crmQuickAction:{leadId:null,kind:null,context:null},
  crmSignalView:{leadId:null,signal:null},crmFollowupState:{result:null},
  crmMasters:{items:[],loaded:false,loading:false,error:'',q:'',status:'',nextCursor:null,hasMore:false,opened:false},crmTransferOpenLeadId:null,
  window:win,document:{querySelector:()=>({setAttribute:(...x)=>editors.push(x),
   scrollIntoView:()=>editors.push('scroll')})},
  message:s=>notice.push(s),loadCrmLeadSignals:async()=>({version:'CRM10A_LEAD_SIGNALS'}),
  render:()=>{ctx.rendered=vm.runInContext('crmView()',ctx);},
  esc:escapeHtml,when:()=> '08.11, 15:00',fmt:x=>String(x),
  crmStageOptions:[['new_contact','Новый контакт']],label:{new:'Новый'},
  leadEdit:()=>'<details class="edit-panel"><summary>Изменить</summary><form data-act="lead_update"></form></details>',
  crmLeadSignalCard:()=>'<div><details class="edit-panel"><summary>Сигналы</summary><form data-act="crm_signal_save"></form></details></div>',
  crmReminderCard:()=>'<details class="card" data-crm-reminder-details><summary>Напоминание</summary><form data-act="crm_reminder_save"></form></details>',
  crmInteractionView:()=>'<div>История контактов</div>',
  crmLeadConversion:()=>'<details><summary>Клиент</summary><form data-act="lead_convert"></form></details>',
  crm04ResultCard:()=>'<div>Осмотр</div>',
  crmIntakeTag:()=>'<div>Повторный клиент</div>',
  crmQuickButtons:()=>'<div>Позвонил · Написал · Не ответил</div>',
  statusButtons:()=>'<div><button data-act="lead_status">Статус</button></div>',
  estimateView:()=>'<div>Смета</div>',estimateUI:{leadId:null},
  select:()=>'<select></select>',option:()=>'<option></option>',
  formField:()=>'<input>',form:()=>'<details>Новый лид</details>',
  crmFollowupView:()=>'<section>Фокус CRM</section>',
  crmCapacitySignpost:()=>'<section>Capacity</section>',
  crmPriorityView:()=>'<section>Приоритет сейчас</section>'
 });
 vm.runInContext(fragment,ctx,{filename:'crm14-source-ui.js'});
 return {ctx,id,scroll,editors,notice};
}
test('CRM14A: overview remains compact and full Lead row is one tap target',()=>{
 const {ctx}=harness();
 const view=vm.runInContext('crmView()',ctx);
 assert.match(view,/Фокус CRM/);
 assert.match(view,/Capacity/);
 assert.match(view,/Приоритет сейчас/);
 assert.match(view,/data-crm-lead-open/);
 assert.match(view,/data-crm-lead-card/);
 assert.doesNotMatch(view,/data-crm-detail-page|data-act="lead_update"|История контактов/);
 assert.ok(!view.includes('<script>alert(1)</script>'),'Lead text is escaped');
 assert.match(view,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
 assert.equal((view.match(/data-crm-lead-open/g)||[]).length,1);
});
test('CRM14A: opening a Lead hides list, Focus, Capacity and Priority entirely',()=>{
 const {ctx,id,scroll}=harness();
 vm.runInContext("openCrmLeadDetail('"+id+"')",ctx);
 assert.equal(ctx.crmDetailId,id);
 assert.deepEqual(scroll,[[0,0]]);
 const detail=ctx.rendered;
 assert.match(detail,/data-crm-detail-page/);
 assert.match(detail,/aria-label="Основные данные лида"/);
 assert.match(detail,/data-act="lead_update"/);
 assert.match(detail,/data-act="crm_signal_save"/);
 assert.match(detail,/data-act="crm_reminder_save"/);
 assert.match(detail,/data-act="lead_status"/);
 assert.match(detail,/data-act="lead_convert"/);
 assert.match(detail,/История контактов/);
 assert.match(detail,/Осмотр и смета/);
 assert.match(detail,/edit-panel" open/);
 assert.match(detail,/data-crm-back/);
 assert.doesNotMatch(detail,/Фокус CRM|Приоритет сейчас|Покрытие свободной Capacity|data-crm-lead-open/);
 assert.ok(!detail.includes('<script>alert(1)</script>'));
});
test('CRM14A: Back returns to list and preserves original scroll and Focus filter',()=>{
 const {ctx,id,scroll}=harness();
 vm.runInContext("openCrmLeadDetail('"+id+"')",ctx);
 vm.runInContext('backToCrmLeads()',ctx);
 assert.equal(ctx.crmDetailId,null);
 assert.equal(ctx.crmFocusFilter,'today');
 assert.deepEqual(scroll,[[0,0],[0,413]]);
 assert.match(ctx.rendered,/Фокус CRM/);
 assert.match(ctx.rendered,/data-crm-lead-open/);
 assert.doesNotMatch(ctx.rendered,/data-crm-detail-page/);
});
test('CRM14A: reminder deep-open reveals existing editor, invalid ID does not navigate',()=>{
 const {ctx,id,editors,notice}=harness();
 vm.runInContext("openCrmLeadDetail('"+id+"',{reminder:true})",ctx);
 assert.equal(ctx.crmDetailId,id);
 assert.ok(editors.some(x=>Array.isArray(x)&&x[0]==='open'),'Canonical reminder must open');
 assert.match(vm.runInContext('crmView()',ctx),/data-crm-reminder-details open>/,
  'Async signal rerender must retain reminder editor open on the isolated page');
 vm.runInContext("openCrmLeadDetail('22222222-2222-4222-8222-222222222222')",ctx);
 assert.equal(ctx.crmDetailId,id);
 assert.ok(notice.some(x=>x.includes('не найдено')));
});
test('CRM14A: missing lead fails closed rather than showing another record',()=>{
 const {ctx,id}=harness();
 vm.runInContext("openCrmLeadDetail('"+id+"')",ctx);
 ctx.data.leads=[];
 const detail=vm.runInContext('crmView()',ctx);
 assert.match(detail,/Обращение недоступно/);
 assert.match(detail,/data-crm-back/);
 assert.doesNotMatch(detail,/data-act="lead_update"/);
});
test('CRM14A: callbacks route exact selected Lead and navigation never saves data',()=>{
 assert.match(script,/button\[data-crm-lead-open\]/);
 assert.match(script,/openCrmLeadDetail\(openExisting.dataset.crmLeadOpen\)/);
 assert.match(script,/button\[data-crm-back\]/);
 assert.match(script,/backToCrmLeads\(\)/);
 assert.match(script,/openCrmLeadDetail\(attentionOpen.dataset.crmFollowupLead\)/);
 assert.match(script,/openCrmLeadDetail\(openReminder.dataset.crmReminderOpen,\{reminder:true\}\)/);
 assert.match(script,/openCrmLeadDetail\(toLead.dataset.scheduleOpenLead\)/);
 assert.match(script,/if\(tab!=='crm'\)\{estimateWorkspaceOpen=false;if\(crmDetailId\)\{crmDetailId=null;crmReminderEditorLeadId=null;\}\}/);
 assert.doesNotMatch(fragment,/await sendAction\(|\/api\/action|pool\.query\(/);
 assert.match(css,/CRM-14A: isolated Lead page/);
 assert.match(css,/\.crm-lead-list-open/);
 assert.match(css,/\.crm-detail-page/);
 assert.match(css,/min-height:48px/);
});
