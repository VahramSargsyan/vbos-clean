import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const get=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const app=get('public/app.js');
const html=get('public/index.html');
const ui=get('public/worklog-full-ui.js');
const server=get('server.mjs');
const writer=get('worklog-full.mjs');
const migration=get('migrations/0034_full_worklog_parity_CANDIDATE.sql');
const order=get('order-card-worklogs.mjs');
const mywork=get('public/my-work.js');
test('Full WorkLog uses canonical existing UUID and additive detail table only',()=>{
 assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.mvp_work_log_details/);
 assert.match(migration,/REFERENCES public\.mvp_work_logs\(id\) ON DELETE RESTRICT/);
 assert.doesNotMatch(migration,/\bALTER TABLE public\.mvp_work_logs\b|\bDROP TABLE\b/i);
 assert.match(migration,/mvp_work_log_full_requests/);
 assert.match(writer,/INSERT INTO public\.mvp_work_logs/);
 assert.match(writer,/INSERT INTO public\.mvp_work_log_details/);
 assert.match(writer,/INSERT INTO public\.mvp_work_log_full_requests/);
});
test('Old WorkLog can stay reduced and full writer has one atomic save and revision replay',()=>{
 assert.match(writer,/await client\.query\('BEGIN'\)/);
 assert.match(writer,/await client\.query\('COMMIT'\)/);
 assert.match(writer,/await client\.query\('ROLLBACK'\)/);
 assert.match(writer,/payloadDigest/);
 assert.match(writer,/deduplicated:true/);
 assert.match(writer,/FOR UPDATE/);
 assert.match(writer,/Время работы пересекается/);
 assert.match(writer,/Разрыв /);
 assert.match(writer,/workerGateTx/);
 assert.match(server,/Полную запись следует|полную форму с часами и потерями/);
 assert.match(server,/to_jsonb\(d\) AS detail/);
 assert.match(order,/to_jsonb\(d\) AS detail/);
});
test('Mobile presents real old WorkLog fields and does not invent missing history',()=>{
 assert.match(html,/\/worklog-full-ui\.js/);
 assert.ok(html.indexOf('/worklog-full-ui.js')<html.indexOf('/my-work.js'));
 for(const token of ['performerMode','startClock','endClock','location','workType',
 'workDetail','quantity','unit','points','nodes','meters','complexity','lossMinutes',
 'lossReason','reworkStatus','reworkReason','reworkMinutes','gapReason','comment','notes'])
  assert.ok(ui.includes(token),'Missing form field '+token);
 assert.match(ui,/Полное.*|чистое время/i);
 assert.match(mywork,/data-workflow-open="log"/);
 assert.match(app,/data-workflow-open="log"/);
 assert.match(app,/Сокращённая запись/);
 assert.match(ui,/data-full-worklog-copy/);
 assert.match(ui,/\.\.\.\(data\?\.logs\|\|\[\]\)/,'MyWork must reuse canonical recent WorkLogs when order card was not opened');
 assert.doesNotMatch(ui,/финансовая операция.*создаётся(?!.*не)/);
});

test('Mobile WorkLog save has explicit validation, pending state, durable success receipt and clear-only-on-ack',()=>{
 assert.match(ui,/novalidate data-full-worklog-form/);
 assert.match(ui,/function fullWorkLogValidate\(form\)/);
 assert.match(ui,/Array\.from\(form\.elements/);
 assert.match(ui,/if\(node\.tagName==='DETAILS'\)node\.open=true/);
 assert.match(ui,/function fullWorkLogSavePending\(form,waiting\)/);
 assert.match(ui,/Сохраняю работу в PostgreSQL/);
 assert.match(ui,/function fullWorkLogSaveConfirmed\(form,result,type\)/);
 assert.match(ui,/if\(type==='work_log_full_create'&&form\)/);
 assert.match(ui,/form\.reset\(\)/);
 assert.match(ui,/role="status"/);
 assert.match(ui,/fullWorkLogLastSaved/);
 assert.match(app,/fullWorkLogSaveConfirmed\(form,out,type\)/);
 assert.match(app,/if\(isFullLog\)fullWorkLogStatus\(form,'Не сохранено:/);
 const acknowledge=app.indexOf("if(!out.saved)throw Error('Сервер не подтвердил сохранение.');");
 const clear=app.indexOf('fullWorkLogSaveConfirmed(form,out,type)');
 assert.ok(acknowledge>=0&&clear>acknowledge,'Never clear form before server acknowledged');
 assert.match(app,/const check=fullWorkLogValidate\(f\)/);
 assert.match(app,/if\(!check\.ok\)\{message\(check\.message,true\);return;\}/);
});

test('UI behavior: invalid fields retain data; only acknowledged save clears entered values and shows receipt',()=>{
 const vmContext={console};
 vm.createContext(vmContext);
 vm.runInContext(ui,vmContext,{filename:'worklog-full-ui.js'});
 const makeField=(name,value,valid=true)=>{
  const item={name,value,willValidate:true,valid,focusCount:0,reportCount:0,
   checkValidity(){return this.valid;},focus(){this.focusCount++;},
   reportValidity(){this.reportCount++;},
   closest(){return {textContent:name};},parentElement:{tagName:'DETAILS',open:false,parentElement:null}};
  return item;
 };
 const vals={
  orderId:makeField('orderId','11111111-1111-4111-8111-111111111111'),
  performerMode:makeField('performerMode','OWNER'),
  workerId:makeField('workerId',''),
  startClock:makeField('startClock','09:00'),
  endClock:makeField('endClock','10:00'),
  location:makeField('location','Кухня',false),
  workType:makeField('workType','Монтаж трубы'),
  quantity:makeField('quantity','2'),
  unit:makeField('unit','шт'),
  lossMinutes:makeField('lossMinutes','10'),
  lossReason:makeField('lossReason','материалы'),
  reworkStatus:makeField('reworkStatus','no'),
  reworkReason:makeField('reworkReason',''),
  reworkMinutes:makeField('reworkMinutes','0'),
  gapReason:makeField('gapReason',''),
  successorGapReason:makeField('successorGapReason',''),
  serviceId:makeField('serviceId',''),
  complexity:makeField('complexity','3'),
  workDetail:makeField('workDetail','Тест'),
  points:makeField('points',''),
  nodes:makeField('nodes',''),
  meters:makeField('meters',''),
  comment:makeField('comment','Заметка'),
  notes:makeField('notes','Комментарии')
 };
 const elements=Object.assign(Object.values(vals),vals);
 elements.namedItem=k=>vals[k]||null;
 const status={textContent:'',dataset:{}},submit={textContent:'Сохранить работу',dataset:{},disabled:false};
 const form={elements,resetCalls:0,hasAttribute:k=>k==='data-full-worklog-form',
  querySelector(k){
   if(k==='[data-full-worklog-feedback]')return status;
   if(k==='button[type="submit"]')return submit;
   if(k==='[data-full-duration]')return {textContent:''};
   return null;
  },
  reset(){this.resetCalls++;}
 };
 vmContext.testForm=form;
 let result=vm.runInContext('fullWorkLogValidate(testForm)',vmContext);
 assert.equal(result.ok,false);
 assert.match(status.textContent,/Не сохранено/);
 assert.equal(vals.location.value,'Кухня');
 assert.equal(vals.location.focusCount,1);
 assert.equal(form.resetCalls,0);
 vals.location.valid=true;
 result=vm.runInContext('fullWorkLogValidate(testForm)',vmContext);
 assert.equal(result.ok,true);
 vm.runInContext('fullWorkLogSavePending(testForm,true)',vmContext);
 assert.equal(submit.disabled,true);
 assert.match(status.textContent,/Сохраняю/);
 vmContext.ack={item:{id:'f4404777-b7e3-4e47-9f48-152037233333',
  order_id:vals.orderId.value,title:'Монтаж трубы',minutes:60}};
 vm.runInContext("fullWorkLogSaveConfirmed(testForm,ack,'work_log_full_create')",vmContext);
 assert.equal(form.resetCalls,1);
 assert.equal(vals.workType.value,'');
 assert.equal(vals.location.value,'');
 assert.equal(vals.endClock.value,'');
 assert.equal(vals.notes.value,'');
 assert.match(status.textContent,/Сохранено в PostgreSQL/);
 assert.equal(vm.runInContext('fullWorkLogLastSaved.orderId',vmContext),vals.orderId.value);
 vm.runInContext('fullWorkLogSavePending(testForm,false)',vmContext);
 assert.equal(submit.disabled,false);
 assert.equal(submit.textContent,'Сохранить работу');
});
