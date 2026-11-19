import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {workLogFullContextRead} from '../worklog-full.mjs';
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
 assert.match(app,/if\(isFullLog\)\{\s*worklogDraftSaveFailed\(form,e\.status,e\.message\);\s*fullWorkLogStatus\(form,'Не сохранено:/);
 assert.match(app,/worklogDraftAcknowledge\(form\);\s*fullWorkLogSaveConfirmed\(form,out,type\)/);
 assert.match(app,/const frozen=worklogDraftPrepareSubmit\(f,payload\)/);
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


test('WorkLog legacy taxonomy Category → Action → Service preserves canonical serviceId',()=>{
 assert.match(server,/SELECT service_id,service_name,category,action_code,status FROM public\.mvp_services_reference/);
 assert.match(ui,/data-full-worklog-tax-category/);
 assert.match(ui,/data-full-worklog-tax-action/);
 assert.match(ui,/Фактическая работа/);
 assert.match(ui,/fullWorkLogTaxSync\(form,'service'\)/);
 const context=vm.createContext({data:{workLogServiceReferences:[
  {service_id:'s1',service_name:'Трубы',category:'Сантехника',action_code:'MOUNT',status:'active'},
  {service_id:'s2',service_name:'Радиатор',category:'Сантехника',action_code:'INSTALL',status:'active'},
  {service_id:'s3',service_name:'Проводка',category:'Электрика',action_code:'REPAIR',status:'active'},
  {service_id:'s4',service_name:'Архивная',category:'Сантехника',action_code:null,status:'archived'}
 ]},esc:x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')});
 vm.runInContext(ui,context);
 assert.equal(vm.runInContext("fullWorkLogTaxRows('').length",context),3);
 assert.equal(vm.runInContext("fullWorkLogTaxRows('s4').length",context),4);
 const choices=vm.runInContext("fullWorkLogTaxServices(fullWorkLogTaxRows(''),'Сантехника','MOUNT','')",context);
 assert.match(choices,/Трубы/);
 assert.doesNotMatch(choices,/Радиатор|Проводка|Архивная/);
 const actions=vm.runInContext("fullWorkLogTaxActions(fullWorkLogTaxRows(''),'Сантехника')",context);
 assert.deepEqual(Array.from(actions,row=>Array.from(row)[0]),['MOUNT','INSTALL']);
 const categorySelect={value:'',innerHTML:''},actionSelect={value:'',innerHTML:''},serviceSelect={value:'',innerHTML:''};
 const sampleForm={elements:{serviceId:serviceSelect},querySelector:s=>{
  if(s==='[data-full-worklog-tax-category]')return categorySelect;
  if(s==='[data-full-worklog-tax-action]')return actionSelect;
  return null;
 }};
 context.sampleForm=sampleForm;
 assert.equal(vm.runInContext("fullWorkLogTaxPreselect(sampleForm,'s2')",context),true);
 assert.equal(categorySelect.value,'Сантехника');
 assert.equal(actionSelect.value,'INSTALL');
 assert.equal(serviceSelect.value,'s2','copy previous must preserve canonical serviceId');
 assert.match(serviceSelect.innerHTML,/Радиатор/);
 assert.doesNotMatch(ui,/name="taxCategory"|name="taxAction"/);
});


test('WorkLog idle gap UI uses the canonical read-only gap endpoint and does not move the writer',()=>{
 assert.match(server,/\/api\/worklogs\/full-context/);
 assert.match(writer,/endClock:url\.searchParams\.get\('endClock'\)\?/);
 assert.match(writer,/const exceptId=url\.searchParams\.get\('recordId'\)/);
 assert.match(writer,/work_log_id<>\$2/);
 assert.match(ui,/fullWorkLogGapSchedule/);
 assert.match(ui,/data-full-gap-before/);
 assert.match(ui,/data-full-gap-after/);
 assert.match(ui,/Повторить проверку пауз/);
 assert.match(ui,/fullWorkLogGapReset\(form\)/);
 assert.match(app,/fullWorkLogGapSchedule\(full\)/);
 const modalSource=get('public/workday-legacy-ui.js');
 assert.match(modalSource,/worklogDraftOffer\(form\)/);
 assert.match(modalSource,/fullWorkLogGapSchedule\(form,true\)/);
 assert.match(modalSource,/form\.dataset\.draftDecision==='active'\|\|form\.dataset\.act==='work_log_full_update'/);
 assert.ok(modalSource.indexOf('worklogDraftOffer(form)')<
  modalSource.indexOf('fullWorkLogGapSchedule(form,true)'),
  'Draft must be offered before canonical gap advisory check');
 const beforeIndex=ui.indexOf('data-full-gap-before'),advancedIndex=ui.indexOf('Дополнительно: детали');
 assert.ok(beforeIndex>0&&beforeIndex<advancedIndex,'Gap reason must be immediately below clocks, not hidden in advanced');
 assert.equal((ui.match(/select\('gapReason',/g)||[]).length,1,'One gapReason field only');
 assert.equal((ui.match(/select\('successorGapReason',/g)||[]).length,1,'One successor reason field only');
});
test('WorkLog gap reason appears automatically only over 15 minutes and clears stale reason',async()=>{
 const queue=[],calls=[],contexts=[
  {ready:true,overlap:false,gapMinutes:15,successorGapMinutes:0,thresholdMinutes:15,hasEndClock:false},
  {ready:true,overlap:false,gapMinutes:16,successorGapMinutes:0,thresholdMinutes:15,hasEndClock:false},
  {ready:true,overlap:false,gapMinutes:16,successorGapMinutes:22,thresholdMinutes:15,hasEndClock:true},
  {ready:true,overlap:false,gapMinutes:0,successorGapMinutes:0,thresholdMinutes:15,hasEndClock:true}
 ];
 const mk=()=>({hidden:true,textContent:''});
 const before=mk(),after=mk(),hint=mk(),retry=mk(),minutes=mk(),successor=mk();
 const elements={
  orderId:{value:'11111111-1111-4111-8111-111111111111'},
  dayDate:{value:'2026-11-18'},startClock:{value:'09:00'},endClock:{value:''},
  performerMode:{value:'OWNER'},workerId:{value:''},
  gapReason:{value:'waiting',required:false},successorGapReason:{value:'',required:false}
 };
 const lookups={
  '[data-full-gap-before]':before,'[data-full-gap-after]':after,
  '[data-full-gap-feedback]':hint,'[data-full-gap-retry]':retry,
  '[data-full-gap-minutes]':minutes,'[data-full-successor-gap-minutes]':successor
 };
 const form={elements,dataset:{},isConnected:true,
  hasAttribute:k=>k==='data-full-worklog-form',
  querySelector:k=>lookups[k]||null};
 const sandbox=vm.createContext({console,URLSearchParams,
  setTimeout(fn){queue.push(fn);return queue.length;},clearTimeout(){},
  api:async(url)=>{calls.push(url);return contexts.shift();}
 });
 vm.runInContext(ui,sandbox,{filename:'worklog-full-ui.js'});
 sandbox.form=form;
 async function check(){
  vm.runInContext('fullWorkLogGapSchedule(form,true)',sandbox);
  assert.equal(form.dataset.fullGapState,'pending');
  await queue.shift()();
  assert.equal(form.dataset.fullGapState,'ready');
 }
 await check();
 assert.equal(before.hidden,true,'15 minutes must remain hidden');
 assert.equal(elements.gapReason.required,false);
 assert.equal(elements.gapReason.value,'','no stale gap reason');
 assert.ok(!calls[0].includes('endClock='),'advisory query must work before entering end time');
 elements.startClock.value='09:16';
 await check();
 assert.equal(before.hidden,false,'16-minute pause appears immediately');
 assert.equal(elements.gapReason.required,true);
 assert.match(minutes.textContent,/16 мин/);
 assert.equal(after.hidden,true,'no successor check until end clock');
 elements.gapReason.value='materials';
 elements.endClock.value='10:00';
 await check();
 assert.equal(after.hidden,false,'successor gap prompts if >15');
 assert.equal(elements.gapReason.value,'materials','valid user selection preserved');
 assert.equal(elements.successorGapReason.required,true,'next WorkLog without explanation needs a reason');
 elements.startClock.value='08:59';elements.endClock.value='09:59';
 elements.successorGapReason.value='lunch';
 await check();
 assert.equal(before.hidden,true);
 assert.equal(after.hidden,true);
 assert.equal(elements.gapReason.value,'');
 assert.equal(elements.successorGapReason.value,'');
 assert.equal(hint.hidden,true);
 assert.equal(calls.length,4);
});

test('Invalid ready gap context does not silently clear mandatory user reason',()=>{
 const ctx=vm.createContext({console});
 vm.runInContext(ui,ctx,{filename:'worklog-full-ui.js'});
 const before={hidden:false},after={hidden:true};
 const gap={value:'materials',required:true},successor={value:'waiting',required:false};
 ctx.form={elements:{gapReason:gap,successorGapReason:successor},
  querySelector:k=>({'[data-full-gap-before]':before,'[data-full-gap-after]':after}[k]||null)};
 for(const candidate of [
  {gapMinutes:null,successorGapMinutes:0,hasEndClock:false,thresholdMinutes:15},
  {gapMinutes:16,successorGapMinutes:null,hasEndClock:true,thresholdMinutes:15},
  {gapMinutes:16,successorGapMinutes:0,hasEndClock:null,thresholdMinutes:15},
  {gapMinutes:'0',successorGapMinutes:0,hasEndClock:false,thresholdMinutes:15}
 ]){
  ctx.result=candidate;
  assert.throws(()=>vm.runInContext('fullWorkLogGapApply(form,result)',ctx),/некорректный расчёт пауз/);
  assert.equal(gap.value,'materials');
  assert.equal(gap.required,true);
  assert.equal(before.hidden,false);
  assert.equal(successor.value,'waiting');
 }
});
test('Gap check disregards an old response after a faster clock change',async()=>{
 const timers=[],requests=[];
 const wrap={hidden:true},hint={hidden:true,textContent:''};
 const controls={orderId:{value:'11111111-1111-4111-8111-111111111111'},
  dayDate:{value:'2026-11-18'},startClock:{value:'09:15'},endClock:{value:''},
  performerMode:{value:'OWNER'},workerId:{value:''},
  gapReason:{value:'',required:false},successorGapReason:{value:'',required:false}};
 const form={dataset:{},elements:controls,isConnected:true,
  hasAttribute:k=>k==='data-full-worklog-form',
  querySelector:k=>({'[data-full-gap-before]':wrap,'[data-full-gap-feedback]':hint}[k]||null)};
 const ctx=vm.createContext({console,URLSearchParams,
  setTimeout:fn=>{timers.push(fn);return timers.length;},
  clearTimeout(){},
  api:url=>new Promise(resolve=>requests.push({url,resolve}))
 });
 vm.runInContext(ui,ctx,{filename:'worklog-full-ui.js'});ctx.form=form;
 vm.runInContext('fullWorkLogGapSchedule(form,true)',ctx);
 const oldRequest=timers.shift()();
 controls.startClock.value='09:16';
 vm.runInContext('fullWorkLogGapSchedule(form,true)',ctx);
 const latestRequest=timers.shift()();
 assert.equal(requests.length,2);
 requests[1].resolve({ready:true,overlap:false,gapMinutes:16,successorGapMinutes:0,
  thresholdMinutes:15,hasEndClock:false});
 await latestRequest;
 requests[0].resolve({ready:true,overlap:false,gapMinutes:15,successorGapMinutes:0,
  thresholdMinutes:15,hasEndClock:false});
 await oldRequest;
 assert.equal(form.dataset.fullGapState,'ready');
 assert.equal(wrap.hidden,false,'old 15-minute result must not mask new 16-minute gap');
 assert.equal(controls.gapReason.required,true);
 assert.match(requests[0].url,/startClock=09%3A15/);
 assert.match(requests[1].url,/startClock=09%3A16/);
});

test('WorkLog preflight errors remain visible and retryable without hiding the real writer error',async()=>{
 const callbacks=[],feedback={hidden:true,textContent:''},retry={hidden:true},before={hidden:true};
 const elements={orderId:{value:'11111111-1111-4111-8111-111111111111'},dayDate:{value:'2026-11-18'},
  startClock:{value:'09:00'},endClock:{value:''},performerMode:{value:'OWNER'},workerId:{value:''},
  gapReason:{value:'materials',required:false},successorGapReason:{value:'',required:false}};
 const form={elements,dataset:{},isConnected:true,
  hasAttribute:k=>k==='data-full-worklog-form',
  querySelector:k=>({'[data-full-gap-feedback]':feedback,'[data-full-gap-retry]':retry,
   '[data-full-gap-before]':before}[k]||null)};
 const sandbox=vm.createContext({console,URLSearchParams,
  setTimeout:fn=>{callbacks.push(fn);return 1;},clearTimeout(){},
  api:async()=>{throw Error('offline');}
 });
 vm.runInContext(ui,sandbox,{filename:'worklog-full-ui.js'});
 sandbox.form=form;
 vm.runInContext('fullWorkLogGapSchedule(form,true)',sandbox);
 await callbacks.shift()();
 assert.equal(form.dataset.fullGapState,'error');
 assert.equal(feedback.hidden,false);
 assert.equal(retry.hidden,false);
 assert.match(feedback.textContent,/offline/);
 assert.equal(elements.gapReason.value,'materials','failure must not erase selected reason');
 assert.ok(vm.runInContext('fullWorkLogGapSignature(form)',sandbox).includes('startClock=09%3A00'));
});


test('Canonical read-only gap context detects idle time without end clock and excludes an edited WorkLog',async()=>{
 const previous={work_log_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  performer_mode:'OWNER',worker_id:null,start_clock:'08:00:00',end_clock:'09:00:00',gap_reason:''};
 const edited={work_log_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  performer_mode:'OWNER',worker_id:null,start_clock:'09:30:00',end_clock:'10:00:00',gap_reason:'waiting'};
 const queries=[],all=[previous,edited];
 const pool={async query(sql,params){
  queries.push({sql,params});
  if(sql.includes('SELECT id FROM public.mvp_work_days'))
   return {rowCount:1,rows:[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}]};
  assert.match(sql,/work_log_id<>\$2/,'edit exclusion must be an advisory parameter');
  const rows=all.filter(item=>item.work_log_id!==params[1]);
  return {rowCount:rows.length,rows};
 }};
 class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
 const common={pool,uuid:v=>String(v),safeDate:v=>String(v),AppError};
 const request=({start='09:16',end='',recordId=''}={})=>{
  const query=new URLSearchParams({orderId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   dayDate:'2026-11-18',startClock:start,performerMode:'OWNER'});
  if(end)query.set('endClock',end);
  if(recordId)query.set('recordId',recordId);
  return new URL('http://localhost/api/worklogs/full-context?'+query);
 };
 const atStart=await workLogFullContextRead({...common,url:request()});
 assert.equal(atStart.ready,true);
 assert.equal(atStart.gapMinutes,16);
 assert.equal(atStart.hasEndClock,false,'start-time-only query must not need end clock');
 assert.equal(atStart.successorGapMinutes,0);
 const editing=await workLogFullContextRead({...common,url:request({
  start:'09:16',end:'10:00',recordId:edited.work_log_id})});
 assert.equal(editing.ready,true,'historical record must not collide with itself');
 assert.equal(editing.gapMinutes,16);
 assert.equal(queries.at(-1).params[1],edited.work_log_id);
 assert.equal(queries.at(-1).params[0],'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
});
test('Canonical gap context identifies whether the following WorkLog already contains a reason',async()=>{
 const next={work_log_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  performer_mode:'OWNER',worker_id:null,start_clock:'10:00:00',end_clock:'11:00:00',gap_reason:''};
 const pool={async query(sql){
  if(sql.includes('SELECT id FROM public.mvp_work_days'))return {rowCount:1,rows:[{id:'day'}]};
  return {rowCount:1,rows:[next]};
 }};
 class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
 const url=new URL('http://localhost/api/worklogs/full-context?orderId=11111111-1111-4111-8111-111111111111&dayDate=2026-11-18&startClock=09%3A00&endClock=09%3A44&performerMode=OWNER');
 const read=()=>workLogFullContextRead({pool,url,uuid:x=>x,safeDate:x=>x,AppError});
 const unrecorded=await read();
 assert.equal(unrecorded.ready,true);
 assert.equal(unrecorded.successorGapMinutes,16);
 assert.equal(unrecorded.successorReasonPresent,false);
 next.gap_reason='waiting';
 const annotated=await read();
 assert.equal(annotated.successorGapMinutes,16);
 assert.equal(annotated.successorReasonPresent,true);
});

const presenceUi=get('public/presence.js');
test('My Work shows arrival and departure above secondary details with canonical object and order IDs',()=>{
 const day='2026-11-18',id='11111111-1111-4111-8111-111111111111',objectId='22222222-2222-4222-8222-222222222222';
 const order={id,object_id:objectId,object_name:'Квартира',title:'Монтаж',status:'open'};
 const snapshot={today:day,day:{status:'open'},contextOrder:order,currentSession:null,currentPresence:null,
  plannedOrders:[],todaySessions:[],todayLogs:[],todayTotals:{logCount:0,workMinutes:0},
  assignedWorkers:[],recentWorkdays:[],selectedOrderId:id};
 const sandbox=vm.createContext({
  myWork:{snapshot},data:{today:day,orders:[],objects:[],listsTruncated:false},
  dailyA1:{item:{goal:'Монтаж'}},workFlowLastNotice:'',
  esc:x=>String(x??''),label:{open:'Открыт',closed:'Закрыт'},fmt:()=>0,when:()=>'',record:()=>'<div></div>',
  a1Card:()=>'',ownerActivityPane:()=>'',presencePane:historyOnly=>{
   assert.equal(historyOnly,true,'Historical panel must not duplicate the arrival form');return 'История посещений';
  },
  formField:()=>'<input>',editText:name=>'<input name="'+name+'">',currentYerevanTime:()=> '09:00'
 });
 vm.runInContext(mywork,sandbox,{filename:'my-work.js'});
 const view=()=>vm.runInContext('myWorkView()',sandbox);
 const open=view();
 assert.ok(open.indexOf('data-act="presence_start"')>0);
 assert.ok(open.indexOf('data-act="presence_start"')<open.indexOf('data-workflow-secondary'));
 assert.equal(open.split('data-act="presence_start"').length-1,1);
 assert.match(open,/Я на объекте · отметить приход/);
 assert.ok(open.includes('name="objectId" value="'+objectId+'"'));
 assert.ok(open.includes('name="orderId" value="'+id+'"'));
 snapshot.currentPresence={id:'33333333-3333-4333-8333-333333333333',day_date:day,revision:1,
  object_id:objectId,object_name:'Квартира',arrived_at:'2026-11-18T05:00:00Z'};
 const active=view();
 assert.ok(active.indexOf('data-act="presence_stop"')<active.indexOf('data-workflow-secondary'));
 assert.doesNotMatch(active,/data-act="presence_start"/);
 snapshot.currentPresence=null;snapshot.contextOrder=null;
 assert.doesNotMatch(view(),/data-act="presence_start"/,'No arrival without selected order');
 snapshot.contextOrder=order;snapshot.day=null;
 assert.doesNotMatch(view(),/data-act="presence_start"/,'No arrival before WorkDay is opened');
});
test('Presence history-only mode keeps history and removes duplicate check-in writer',()=>{
 const day='2026-11-18',p={date:day,day:{status:'open'},active:null,items:[],hasMore:false,loaded:true};
 const sandbox=vm.createContext({
  presence:p,data:{today:day,objects:[{id:'22222222-2222-4222-8222-222222222222',name:'Квартира'}],orders:[]},
  esc:x=>String(x??''),currentYerevanTime:()=> '09:00',
  form:(type,title)=>'<form data-act="'+type+'">'+title+'</form>',
  select:()=>'<select></select>',option:()=>'<option></option>',
  editText:()=>'<input>',record:()=>'<div></div>'
 });
 vm.runInContext(presenceUi,sandbox,{filename:'presence.js'});
 const history=vm.runInContext('presencePane(true)',sandbox);
 assert.match(history,/История по объектам/);
 assert.doesNotMatch(history,/data-act="presence_start"/);
 const regular=vm.runInContext('presencePane()',sandbox);
 assert.match(regular,/data-act="presence_start"/);
 assert.match(regular,/История по объектам/);
});


test('WorkDay start from My Work does not require daily A1 or write to its record',async()=>{
 const source=get('public/workday-legacy-ui.js');
 assert.match(mywork,/data-workflow-open="start">Начать рабочий день/);
 assert.match(mywork,/a1Card\(\)/,'Existing separate A1 editor must remain');
 assert.match(source,/type:'a1_complete'/,'Unrelated day-finish behavior must remain untouched');
 for(const item of [null,{id:'DA1-2026-11-19',goal:'Сохранённая цель',reason:'Отдельная запись'}]){
  const requests=[],notices=[],date='2026-11-19';
  const sandbox=vm.createContext({
   myWork:{snapshot:{today:date,contextOrder:null}},data:{today:date},dailyA1:{item},
   ids:()=>null,esc:x=>String(x??''),editText:name=>'<input name="'+name+'">',
   crypto:{randomUUID:()=> 'c33b5cdf-5000-4000-8000-000000000001'},
   api:async(path,request)=>{
    requests.push({path,request});
    return {saved:true,item:{status:'open'}};
   },
   workFlowModalClose:()=>true,refresh:async()=>{},loadMyWork:async()=>{},
   message:(...args)=>notices.push(args),tab:'myWork'
  });
  vm.runInContext(source,sandbox,{filename:'workday-legacy-ui.js'});
  vm.runInContext("workFlowModalState.kind='start'",sandbox);
  const markup=vm.runInContext('workFlowModalHtml()',sandbox);
  assert.match(markup,/data-workflow-day-start/);
  assert.match(markup,/A1 не создаётся и не изменяется/);
  assert.doesNotMatch(markup,/name="(?:goal|reason|notes)"/,'Opening WorkDay must not require A1 fields');
  assert.equal(markup.includes('<strong>A1:'),Boolean(item),'Existing A1 remains read-only on start');
  const feedback={textContent:''},button={textContent:'Начать день',disabled:false,isConnected:true};
  sandbox.testForm={dataset:{},elements:[],querySelector:selector=>
   selector==='[data-workflow-feedback]'?feedback:
   selector==='button[type="submit"]'?button:null};
  await vm.runInContext("workFlowModalSubmitDay(testForm,'start')",sandbox);
  assert.equal(requests.length,1,'Start must emit only one server action');
  assert.equal(requests[0].path,'/api/action');
  assert.equal(requests[0].request.type,'day_open');
  assert.equal(requests[0].request.payload.requestKey,'c33b5cdf-5000-4000-8000-000000000001');
  assert.equal(notices.length,1);
  assert.match(notices[0][0],/Рабочий день открыт\. A1 не изменена/);
  assert.equal(button.disabled,false);
  assert.equal(sandbox.dailyA1.item,item,'Existing A1 is neither created nor overwritten');
 }
});
