import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const planner=readFileSync(new URL('../public/schedule.js',import.meta.url),'utf8');
const cut=(source,start,end)=>{const i=source.indexOf(start),j=source.indexOf(end,i+1);assert.ok(i>=0&&j>i,start);return source.slice(i,j);};
const uuid='a83a1a15-bda6-4d85-8b13-b16bd99ae1ee';

test('actual CRM lead builds a next-day visit draft without saving it',()=>{
 const fn=cut(app,'function crmVisitDraft(lead){','function crmView(){');
 const context={data:{today:'2026-11-05',leadIntakes:[{lead_id:uuid,client_id:'client-1'}],leadClientLinks:[]},
  ids:(tab,id)=>tab==='clients'&&id==='client-1'?{name:'Repeat Client'}:null,
  scheduleShiftDay:(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)};
 const draft=runInNewContext(fn+';crmVisitDraft({id:'+JSON.stringify(uuid)+',title:"Heating",contact_name:"Representative",phone:"099123456",notes:"Address & details"})',context);
 assert.equal(draft.date,'2026-11-06');
 assert.equal(draft.title,'Осмотр · Heating');
 assert.match(draft.notes,new RegExp(uuid));
 assert.match(draft.notes,/Клиент: Repeat Client/);
 assert.match(draft.notes,/Данные обращения: Address & details/);
 assert.ok(!('orderId' in draft));
});
test('schedule source label can navigate to original CRM ID without assuming FK',()=>{
 const fn=cut(planner,'function scheduleVisitLeadId(notes){','function scheduleItemCard(x){');
 const found=runInNewContext(fn+';scheduleVisitLeadId('+JSON.stringify('CRM LEAD ID: '+uuid+'\nКонтакт: A')+')');
 assert.equal(found,uuid);
 assert.equal(runInNewContext(fn+';scheduleVisitLeadId("No source link")'),null);
});
test('mobile UI has a safe unsaved draft, manual Save and explicit cancel',()=>{
 assert.match(app,/data-plan-lead/);
 assert.match(app,/scheduleLeadDraft=crmVisitDraft\(lead\)/);
 assert.match(app,/await loadSchedule\(false\)/);
 assert.match(app,/data-cancel-lead-visit/);
 assert.match(app,/type==='schedule_save'&&form\?\.hasAttribute\('data-lead-visit-draft'\)/);
 assert.match(planner,/data-lead-visit-draft/);
 assert.match(planner,/scheduleLeadDraft\|\|scheduleCapacityDraft\?' open':'/);
 assert.match(planner,/scheduleLeadDraft\?\(scheduleLeadDraft\.itemType/);
 assert.match(planner,/data-schedule-open-lead/);
 assert.match(planner,/Связь с обращением записана в примечании/);
 assert.doesNotMatch(app,/sendAction\('schedule_save'[,)]/);
});
