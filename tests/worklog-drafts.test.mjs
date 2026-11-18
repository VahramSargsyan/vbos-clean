import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const draftSource=source('public/worklog-drafts.js');
const uiSource=source('public/worklog-full-ui.js');
const appSource=source('public/app.js');
const serverSource=source('server.mjs');
const htmlSource=source('public/index.html');
const writerSource=source('worklog-full.mjs');
const OWNER_A='a'.repeat(64),OWNER_B='b'.repeat(64);
const ORDER_A='11111111-1111-4111-8111-111111111111';
const ORDER_B='22222222-2222-4222-8222-222222222222';
function harness(){
 const storage=new Map(),status={textContent:'',dataset:{}};
 let allowDelete=false,failWrite=false;
 const localStorage={
  getItem:k=>storage.has(k)?storage.get(k):null,
  setItem(k,v){if(failWrite)throw Error('storage denied');storage.set(k,v);},
  removeItem:k=>storage.delete(k)
 };
 const ctx=vm.createContext({
  window:{localStorage},
  crypto:{randomUUID:()=> '33333333-3333-4333-8333-333333333333'},
  confirm:()=>allowDelete,
  fullWorkLogFormUpdated:()=>{}
 });
 vm.runInContext(draftSource,ctx,{filename:'worklog-drafts.js'});
 function form(order=ORDER_A,date='2026-11-18'){
  const names=['orderId','dayDate','performerMode','workerId','startClock','endClock','location','serviceId',
   'workType','quantity','unit','nodes','meters','complexity','workDetail','points','lossMinutes',
   'lossReason','reworkStatus','reworkReason','reworkMinutes','gapReason','successorGapReason','comment','notes'];
  const values=Object.fromEntries(names.map(name=>[name,{
   name,value:name==='orderId'?order:name==='dayDate'?date:name==='startClock'?'16:20':
    name==='performerMode'?'OWNER':name==='reworkStatus'?'no':name==='complexity'?'3':'',
   dataset:{},disabled:false
  }]));
  const elements={...values,namedItem:n=>values[n]||null};
  const controls=[...Object.values(values)].filter(x=>x.name!=='orderId');
  const restore={hidden:true},del={hidden:true},copy={disabled:false};
  const f={dataset:{act:'work_log_full_create'},elements,resetCount:0,
   querySelector:k=>({
    '[data-full-worklog-draft-status]':status,
    '[data-full-worklog-draft-restore]':restore,
    '[data-full-worklog-draft-delete]':del,
    '[data-full-worklog-copy]':copy
   })[k]||null,
   querySelectorAll:()=>controls,
   reset(){this.resetCount++;}
  };
  return {f,values,restore,del,copy};
 }
 function run(expression,extra={}){
  Object.assign(ctx,extra);
  return vm.runInContext(expression,ctx);
 }
 return {storage,status,form,run,ctx,localStorage,
  setDelete:v=>{allowDelete=v;},setWriteFailure:v=>{failWrite=v;}};
}
function populate(values){
 const fields={
  startClock:'09:15',endClock:'11:30',location:'Кухня',workType:'Монтаж труб',
  workDetail:'Замена участка трубы',serviceId:'SERVICE-1',quantity:'2.500',unit:'м',
  nodes:'3',meters:'5.25',points:'8',complexity:'4',lossMinutes:'10',
  lossReason:'Инструмент',reworkStatus:'yes',reworkReason:'Переделка',reworkMinutes:'3',
  gapReason:'materials',successorGapReason:'travel',comment:'Тестовый комментарий',
  notes:'Примечание',performerMode:'JOINT',workerId:ORDER_B
 };
 for(const [k,v] of Object.entries(fields))values[k].value=v;
 return fields;
}
test('draft captures every field and restores original start after reload, without backend',()=>{
 const h=harness(),initial=h.form(),fields=populate(initial.values);
 h.run('worklogDraftSetOwner(OWNER_A)',{OWNER_A});
 h.run('worklogDraftOffer(testForm)',{testForm:initial.f});
 assert.equal(h.run('worklogDraftAutosave(testForm)'),true);
 assert.match(h.status.textContent,/Черновик сохранён на телефоне/);
 assert.equal(h.storage.size,1);
 const d=JSON.parse([...h.storage.values()][0]);
 assert.equal(d.dayDate,'2026-11-18');
 assert.equal(d.fields.startClock,'09:15');assert.ok(d.savedAt);
 for(const [k,v] of Object.entries(fields))assert.equal(d.fields[k],v,k);
 const reloaded=h.form();
 h.run('worklogDraftOffer(testForm)',{testForm:reloaded.f});
 assert.equal(reloaded.restore.hidden,false);
 assert.equal(reloaded.values.location.disabled,true,'draft choice must block accidental new entry');
 assert.equal(h.run('worklogDraftAutosave(testForm)'),false,'existing draft must not be overwritten before a choice');
 assert.equal(h.run('worklogDraftRestore(testForm)'),true);
 assert.equal(reloaded.values.location.disabled,false,'regular restored draft must be editable');
 assert.equal(reloaded.values.startClock.value,'09:15');
 for(const [k,v] of Object.entries(fields))assert.equal(reloaded.values[k].value,v,k);
 assert.match(h.status.textContent,/Восстановлен незавершённый черновик/);
});
test('drafts are separated by owner, order and date; explicit removal requires confirmation',()=>{
 const h=harness();h.run('worklogDraftSetOwner(OWNER_A)',{OWNER_A});
 const a=h.form();h.run('worklogDraftOffer(testForm)',{testForm:a.f});
 a.values.location.value='Зона A';h.run('worklogDraftAutosave(testForm)');
 const b=h.form(ORDER_B);h.run('worklogDraftOffer(testForm)',{testForm:b.f});
 assert.equal(b.restore.hidden,true);b.values.location.value='Зона B';h.run('worklogDraftAutosave(testForm)');
 const tomorrow=h.form(ORDER_A,'2026-11-19');
 h.run('worklogDraftOffer(testForm)',{testForm:tomorrow.f});
 assert.equal(tomorrow.restore.hidden,true);
 assert.equal(h.storage.size,2);
 h.run('worklogDraftSetOwner(OWNER_B)',{OWNER_B});
 const other=h.form();h.run('worklogDraftOffer(testForm)',{testForm:other.f});
 assert.equal(other.restore.hidden,true);
 h.run('worklogDraftSetOwner(OWNER_A)',{OWNER_A});
 h.run('worklogDraftOffer(testForm)',{testForm:a.f});
 assert.equal(h.run('worklogDraftDelete(testForm)'),false);
 assert.equal(h.storage.size,2);
 h.setDelete(true);assert.equal(h.run('worklogDraftDelete(testForm)'),true);
 assert.equal(h.storage.size,1);
});
test('uncertain network response retains locked exact payload and requestKey across reload',()=>{
 const h=harness();h.run('worklogDraftSetOwner(OWNER_A)',{OWNER_A});
 const a=h.form();h.run('worklogDraftOffer(testForm)',{testForm:a.f});
 a.values.startClock.value='09:15';a.values.location.value='Кухня';
 h.run('worklogDraftAutosave(testForm)');
 const payload={orderId:ORDER_A,dayDate:'2026-11-18',startClock:'09:15',location:'Кухня'};
 const first=h.run('worklogDraftPrepareSubmit(testForm,payload)',{payload});
 assert.equal(first.requestKey,'33333333-3333-4333-8333-333333333333');
 assert.equal(h.run('worklogDraftPending(testForm)'),true);
 h.run('worklogDraftSaveFailed(testForm,undefined)');
 assert.equal(h.storage.size,1);
 const fresh=h.form();h.run('worklogDraftOffer(testForm)',{testForm:fresh.f});
 assert.equal(h.run('worklogDraftRestore(testForm)'),true);
 assert.equal(fresh.values.startClock.value,'09:15');
 assert.equal(fresh.values.location.disabled,true);
 const replay=h.run('worklogDraftPrepareSubmit(testForm,{changed:"ignored"})');
 assert.equal(JSON.stringify(replay),JSON.stringify(first));
 assert.equal(h.storage.size,1,'not cleared without saved:true');
 h.run('worklogDraftAcknowledge(testForm)');
 assert.equal(h.storage.size,0,'only explicit ACK removes local draft');
 assert.match(h.status.textContent,/Работа сохранена в PostgreSQL/);
});
test('definite validation rejection unlocks correction; storage failure blocks unsafe send',()=>{
 const h=harness();h.run('worklogDraftSetOwner(OWNER_A)',{OWNER_A});
 const a=h.form();h.run('worklogDraftOffer(testForm)',{testForm:a.f});
 let out=h.run('worklogDraftPrepareSubmit(testForm,{orderId:ORDER_A,dayDate:"2026-11-18"})');
 assert.ok(out);assert.equal(a.values.location.disabled,true);
 h.run('worklogDraftSaveFailed(testForm,409)');
 assert.equal(a.values.location.disabled,false);
 assert.equal(h.run('worklogDraftPending(testForm)'),false);
 assert.equal(JSON.parse([...h.storage.values()][0]).pending,null);
 a.values.location.value='Исправлено';h.run('worklogDraftAutosave(testForm)');
 assert.equal(h.storage.size,1);
 // A 409 stating the key was already committed must NOT allow a second payload.
 const conflict=h.form();
 h.run('worklogDraftOffer(testForm)',{testForm:conflict.f});
 h.run('worklogDraftRestore(testForm)');
 const samePayload=h.run('worklogDraftPrepareSubmit(testForm,{orderId:ORDER_A,dayDate:"2026-11-18"})');
 assert.ok(samePayload);
 h.run('worklogDraftSaveFailed(testForm,409,"Ключ записи уже использован с другими данными.")');
 assert.equal(h.run('worklogDraftPending(testForm)'),true);
 const replay=h.run('worklogDraftPrepareSubmit(testForm,{unexpected:"edit"})');
 assert.equal(JSON.stringify(replay),JSON.stringify(samePayload));
 const noStorage=harness();noStorage.run('worklogDraftSetOwner(OWNER_A)',{OWNER_A});
 const f=noStorage.form();noStorage.run('worklogDraftOffer(testForm)',{testForm:f.f});
 noStorage.setWriteFailure(true);
 assert.equal(noStorage.run('worklogDraftPrepareSubmit(testForm,{orderId:ORDER_A})'),null);
 assert.match(noStorage.status.textContent,/Не удалось сохранить/);
});
test('integration preserves existing server WorkLog writer and owner-only state',()=>{
 assert.match(htmlSource,/\/worklog-drafts\.js/);
 assert.ok(htmlSource.indexOf('worklog-full-ui.js')<htmlSource.indexOf('worklog-drafts.js'));
 assert.ok(htmlSource.indexOf('worklog-drafts.js')<htmlSource.indexOf('workday-legacy-ui.js'));
 assert.match(serverSource,/draftOwnerScope:createHash\('sha256'\)/);
 assert.match(serverSource,/if\(!sessionValid\(req\)\)throw new AppError\(401/);
 assert.match(appSource,/worklogDraftSetOwner\(state\.draftOwnerScope\)/);
 assert.match(appSource,/worklogDraftPrepareSubmit\(f,payload\)/);
 assert.match(appSource,/worklogDraftAcknowledge\(form\)/);
 assert.match(appSource,/if\(!out\.saved\)throw Error/);
 assert.match(uiSource,/data-full-worklog-draft-restore/);
 assert.match(uiSource,/data-full-worklog-draft-delete/);
 assert.match(writerSource,/payload_sha256!==hash/);
 assert.match(writerSource,/deduplicated:true/);
});
