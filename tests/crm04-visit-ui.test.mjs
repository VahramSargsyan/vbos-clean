import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const schedule=readFileSync(new URL('../public/schedule.js',import.meta.url),'utf8');
const cut=(s,start,end)=>{const i=s.indexOf(start),j=s.indexOf(end,i+1);assert.ok(i>=0&&j>i,start);return s.slice(i,j);};
const id='a83a1a15-bda6-4d85-8b13-b16bd99ae1ee',key='b83a1a15-bda6-4d85-8b13-b16bd99ae1ef';
const hash='a'.repeat(64);
const note='Existing notes'+'\n\n[CRM04 RECORD | '+key+' | '+hash+']\n'+
 'Дата осмотра: 2026-11-06\nРезультат: Проверили инженерную систему\n'+
 'Следующее действие: Рассчитать стоимость\nСледующий контакт: 2026-11-08\n[/CRM04 RECORD]';

test('parse saved result date, outcome and follow-up; reject arbitrary prose',()=>{
 const fn=cut(app,'function crm04LatestResult(notes){','function crm04ResultCard(lead){');
 const run=n=>runInNewContext(fn+';crm04LatestResult('+JSON.stringify(n)+')');
 const x=run(note);
 assert.equal(x.visitDate,'2026-11-06');
 assert.equal(x.observations,'Проверили инженерную систему');
 assert.equal(x.nextAction,'Рассчитать стоимость');
 assert.equal(x.followUpOn,'2026-11-08');
 assert.equal(x.count,1);
 assert.equal(run('CRM04 RECORD in a draft'),null);
});

test('prefill follow-up calendar without scheduling or modifying lead',()=>{
 const fn=cut(app,'function crm04LatestResult(notes){','function crmView(){');
 const ctx={data:{today:'2026-11-05',leadIntakes:[],leadClientLinks:[]},ids:()=>null,
  esc:x=>String(x),label:{new:'Новый'}};
 const lead={id,title:'Heating proposal',status:'new',notes:note,contact_name:'Contact',phone:'099123456'};
 const d=runInNewContext(fn+';crm04FollowupDraft('+JSON.stringify(lead)+')',ctx);
 assert.equal(d.date,'2026-11-08');
 assert.equal(d.itemType,'Связь с клиентом');
 assert.equal(d.title,'Связаться · Heating proposal');
 assert.match(d.notes,new RegExp(id));
 assert.match(d.notes,/Следующий шаг: Рассчитать стоимость/);
 assert.equal(Object.hasOwn(d,'orderId'),false);
});

test('UI requires explicit result save and separate calendar save',()=>{
 assert.match(app,/data-act="lead_visit_record"/);
 assert.match(app,/data-plan-followup/);
 assert.match(app,/scheduleLeadDraft=crm04FollowupDraft\(lead\)/);
 assert.match(app,/await loadSchedule\(false\)/);
 assert.match(app,/Статус не меняется/);
 assert.match(schedule,/draft\?\.itemType/);
 assert.match(schedule,/Данные подготовлены из CRM/);
 assert.match(schedule,/Создать пункт плана/);
});
