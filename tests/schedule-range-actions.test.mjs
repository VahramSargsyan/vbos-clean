import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../public/schedule.js',import.meta.url),'utf8');
const planId='11111111-1111-4111-8111-111111111111';
const manual={id:planId,source_kind:'manual',revision:3,status:'planned',
 start_at:'2026-11-30T05:15:00Z',end_at:'2026-11-30T07:15:00Z',
 schedule_date:'2026-11-30',title:'План <разметка>',item_type:'Осмотр',notes:''};
const cleanHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
function instance(item=manual){
 const state={invalidations:0,form:null};
 const ctx={
  Date,console,
  data:{today:'2026-11-11',objects:[],orders:[],workers:[],manualPlanWorkers:[]},
  schedule:{loaded:true,loading:false,items:[item],viewMode:'week'},
  scheduleLeadDraft:null,scheduleCapacityDraft:null,hourlyManual:null,
  esc:cleanHtml,
  editText:(name,label,value)=>'<input name="'+name+'" value="'+cleanHtml(value)+'">',
  select:(name,label,options)=>'<select name="'+name+'">'+options+'</select>',
  legacyConflictInvalidate:form=>{state.invalidations++;},
 };
 vm.createContext(ctx);vm.runInContext(script,ctx,{filename:'schedule.js'});
 return {ctx,state,run:code=>vm.runInContext(code,ctx)};
}
function opened(item=manual,revision=item.revision){
 const form={elements:{
  id:{value:item.id},revision:{value:String(revision)},
  startAt:{value:'2026-11-30T09:15'},endAt:{value:'2026-11-30T11:15'}
 }};
 const summary={scrollIntoView:options=>{summary.scrollOptions=options;},
  focus:options=>{summary.focusOptions=options;}};
 const note={hidden:true,textContent:''};
 const details={open:false,querySelector:query=>({
  'form[data-act="schedule_save"]':form,
  '[data-schedule-range-notice]':note,'summary':summary
 })[query]||null};
 const card={querySelector:query=>query==='details.edit-panel'?details:null};
 const button=(action,delta=null)=>({
  dataset:{scheduleRangeId:item.id,scheduleRangeAction:action,
   ...(delta===null?{}:{scheduleRangeDelta:String(delta)})},
  closest:query=>query==='article.schedule-item'?card:null
 });
 return {form,summary,note,details,button};
}
test('legacy v1.8.3 shift both start and end exactly one day, retain hours, no write',()=>{
 const {ctx,state,run}=instance();
 const {form,details,button,summary,note}=opened();
 ctx.target=button('shift',1);
 assert.equal(run('scheduleLegacyOpenRangeEditor(target)'),true);
 assert.equal(details.open,true);
 assert.equal(form.elements.startAt.value,'2026-12-01T09:15');
 assert.equal(form.elements.endAt.value,'2026-12-01T11:15');
 assert.equal(state.invalidations,1,'invalidate existing conflict approval after prefill');
 assert.match(note.textContent,/Сроки сдвинуты на 1 день вперёд/);
 assert.equal(note.hidden,false);
 assert.equal(summary.scrollOptions.block,'start');
 assert.equal(summary.focusOptions.preventScroll,true);
 ctx.target=button('shift',-1);
 assert.equal(run('scheduleLegacyOpenRangeEditor(target)'),true);
 assert.equal(form.elements.startAt.value,'2026-11-30T09:15');
 assert.equal(form.elements.endAt.value,'2026-11-30T11:15');
 assert.equal(state.invalidations,2);
});
test('legacy v1.8.4 duration changes only end date; reduction blocked for single-day plans',()=>{
 const {ctx,state,run}=instance();
 const {form,button,note}=opened();
 ctx.target=button('duration',1);
 assert.equal(run('scheduleLegacyOpenRangeEditor(target)'),true);
 assert.equal(form.elements.startAt.value,'2026-11-30T09:15');
 assert.equal(form.elements.endAt.value,'2026-12-01T11:15');
 assert.match(note.textContent,/Длительность увеличена на 1 день/);
 ctx.target=button('duration',-1);
 assert.equal(run('scheduleLegacyOpenRangeEditor(target)'),true);
 assert.equal(form.elements.endAt.value,'2026-11-30T11:15');
 assert.equal(state.invalidations,2);
 ctx.target=button('duration',-1);
 assert.equal(run('scheduleLegacyOpenRangeEditor(target)'),true);
 assert.equal(form.elements.startAt.value,'2026-11-30T09:15');
 assert.equal(form.elements.endAt.value,'2026-11-30T11:15');
 assert.match(note.textContent,/Сократить его ещё на день нельзя/);
 assert.equal(state.invalidations,2,'rejected operation must not create a new draft');
});
test('legacy v1.8.1 edit opens original editor, unchanged, scrolling without mobile keyboard',()=>{
 const {ctx,state,run}=instance();
 const {form,button,details,note}=opened();
 ctx.target=button('open');
 assert.equal(run('scheduleLegacyOpenRangeEditor(target)'),true);
 assert.equal(details.open,true);
 assert.equal(form.elements.startAt.value,'2026-11-30T09:15');
 assert.equal(form.elements.endAt.value,'2026-11-30T11:15');
 assert.equal(state.invalidations,0);
 assert.match(note.textContent,/Проверь даты/);
});
test('input validation, calendar date rollover and duration cannot invert overnight hours',()=>{
 const {ctx,run}=instance();
 const shift=s=>{ctx.inp=s;return run('scheduleLegacyShiftDateTime(inp,1)');};
 assert.equal(shift('2024-02-28T08:30'),'2024-02-29T08:30','leap year');
 assert.equal(shift('2026-12-31T23:45'),'2027-01-01T23:45','year crossing');
 assert.equal(shift('2026-02-30T09:00'),null,'invalid day');
 assert.equal(shift('2026-11-30T25:00'),null,'invalid clock');
 assert.equal(run('scheduleLegacyShiftDateTime("2026-11-30T09:00",2)'),null,'only exact one-day steps');
 const {form,button,note}=opened();
 form.elements.startAt.value='2026-11-30T23:30';
 form.elements.endAt.value='2026-12-01T00:15';
 ctx.target=button('duration',-1);
 assert.equal(run('scheduleLegacyOpenRangeEditor(target)'),true);
 assert.equal(form.elements.endAt.value,'2026-12-01T00:15','unsafe shortening denied');
 assert.match(note.textContent,/Сократить его ещё на день нельзя/);
});
test('legacy v1.8.5 Week and Month expose the same five actions for manual, never for auto sources',()=>{
 const {ctx,run}=instance();
 ctx.record=manual;
 let markup=run('scheduleItemCard(record)');
 assert.equal((markup.match(/data-schedule-range-action=/g)||[]).length,5);
 assert.match(markup,/data-schedule-range-action="shift" data-schedule-range-delta="-1"/);
 assert.match(markup,/data-schedule-range-action="duration" data-schedule-range-delta="1"/);
 for(const label of ['Раньше на 1 день','Позже на 1 день','Сократить на 1 день','Продлить на 1 день'])
  assert.ok(markup.includes('>'+label+'</button>'),label+' is a clear visible action');
 assert.doesNotMatch(markup,/>[←−+] 1 день<\/button>|>1 день →<\/button>/,'old ambiguous labels not displayed');
 assert.match(markup,/Изменить сроки/);
 assert.match(markup,/name="revision" value="3"/);
 assert.match(markup,/План &lt;разметка&gt;/);
 assert.doesNotMatch(markup,/<разметка>/);
 run('schedule.viewMode="month"');
 markup=run('scheduleItemCard(record)');
 assert.equal((markup.match(/data-schedule-range-action=/g)||[]).length,5,'month selected cards reuse same action set');
 ctx.record={...manual,source_kind:'work_order',order_id:planId,order_status:'open'};
 assert.doesNotMatch(run('scheduleItemCard(record)'),/data-schedule-range-action=/);
 ctx.record={...manual,source_kind:'crm',lead_id:planId};
 assert.doesNotMatch(run('scheduleItemCard(record)'),/data-schedule-range-action=/);
});
test('edit controls reject forged ID, stale revision and auto ownership before touching form',()=>{
 const {ctx,run,state}=instance();
 const {form,button,details}=opened();
 ctx.target=button('shift',1);
 ctx.target.dataset.scheduleRangeId='ffffffff-ffff-4fff-8fff-ffffffffffff';
 assert.equal(run('scheduleLegacyOpenRangeEditor(target)'),false);
 assert.equal(details.open,false);
 ctx.target=button('shift',1);
 form.elements.revision.value='2';
 assert.equal(run('scheduleLegacyOpenRangeEditor(target)'),false);
 assert.equal(details.open,false);
 assert.equal(state.invalidations,0);
});
