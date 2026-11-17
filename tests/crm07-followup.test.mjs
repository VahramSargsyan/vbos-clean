import test from 'node:test';
import assert from 'node:assert/strict';
import {groupCrmFollowUps,crmFollowUpsRead} from '../crm-followups.mjs';

const make=(id,extra={})=>({
 id,title:'Лид '+id,contact_name:'',phone:'',status:'new',
 created_at:'2026-10-01T10:00:00.000Z',updated_at:'2026-11-06T10:00:00.000Z',
 interaction_type:null,next_action:null,next_action_on:null,last_contact_at:null,...extra
});
const date='2026-11-07';

test('CRM07A: four disjoint attention groups, future leads excluded, terminal excluded',()=>{
 const rows=[
  make('a',{next_action:'Позвонить',next_action_on:'2026-11-06',last_contact_at:'2026-11-05T10:00:00Z'}),
  make('b',{next_action:'Отправить',next_action_on:date,last_contact_at:'2026-11-06T10:00:00Z'}),
  make('c'),
  make('d',{next_action:'Контакт позднее',next_action_on:'2026-11-14',last_contact_at:'2026-10-01T10:00:00Z'}),
  make('e',{next_action:'Контакт позднее',next_action_on:'2026-11-15',last_contact_at:'2026-11-06T10:00:00Z'}),
  make('f',{status:'lost',next_action:'Позвонить',next_action_on:'2026-11-06'}),
  make('g',{status:'won',next_action:'Позвонить',next_action_on:date})
 ];
 const out=groupCrmFollowUps(rows,{todayKey:date,limit:6});
 assert.equal(out.version,'CRM07A_READ_ONLY');
 assert.equal(out.source,'CANONICAL_LEAD_NEXT_ACTION');
 assert.equal(out.openLeadCount,5);assert.equal(out.attentionCount,4);
 assert.deepEqual(['overdue','today','noNext','stale'].map(k=>out.buckets[k].items.map(x=>x.leadId)),
  [['a'],['b'],['c'],['d']]);
 assert.equal(out.coverage.complete,true);
 assert.equal(rows[0].next_action,'Позвонить','pure computation never mutates source');
});
test('CRM07A: deterministic sorting, strict cap, no unverified counts',()=>{
 const rows=[
  make('z',{next_action:'Позвонить',next_action_on:'2026-11-06'}),
  make('a',{next_action:'Позвонить',next_action_on:'2026-11-02'}),
  make('f',{next_action:'Позвонить',next_action_on:'2026-11-06'})
 ];
 const out=groupCrmFollowUps(rows,{todayKey:date,limit:2});
 assert.equal(out.buckets.overdue.count,3);
 assert.deepEqual(out.buckets.overdue.items.map(x=>x.leadId),['a','f']);
 assert.throws(()=>groupCrmFollowUps(Array.from({length:501},(_,i)=>make(String(i))),{todayKey:date}),/UNBOUNDED/);
 assert.throws(()=>groupCrmFollowUps([], {todayKey:date,limit:13}),/LIMIT/);
});
test('CRM09A: one ranked queue from disjoint complete groups, no false numeric Win Score',()=>{
 const rows=[
  make('z',{next_action:'Просроченный',next_action_on:'2026-11-06'}),
  make('a',{next_action:'Просроченный',next_action_on:'2026-11-02'}),
  make('b',{next_action:'Сегодня',next_action_on:date}),
  make('c'),
  make('d',{next_action:'Без времени'}),
  make('e',{next_action:'Позднее',next_action_on:'2026-11-15',last_contact_at:'2026-10-01T10:00:00Z'}),
  make('f',{next_action:'Позднее',next_action_on:'2026-11-15',last_contact_at:'2026-10-02T10:00:00Z'}),
  make('g',{next_action:'Будущее',next_action_on:'2026-11-15',last_contact_at:'2026-11-06T10:00:00Z'}),
  make('h',{status:'lost',next_action:'Просроченный',next_action_on:'2026-11-01'}),
  make('i',{status:'won',next_action:'Просроченный',next_action_on:'2026-11-01'})
 ];
 const snapshot=JSON.stringify(rows);
 const r=groupCrmFollowUps(rows,{todayKey:date,limit:1});
 assert.equal(r.priority.version,'CRM11A_ATTENTION_SCORE_V1');
 assert.equal(r.priority.source,'CANONICAL_CRM10A_SIGNALS_AND_CRM07_ATTENTION');
 assert.equal(r.priority.coverage.complete,true);
 assert.equal(r.priority.limit,6);
 assert.equal(r.priority.count,7);
 assert.equal(r.attentionCount,7);
 assert.deepEqual(r.priority.items.map(x=>x.leadId),['a','z','b','c','d','e']);
 assert.deepEqual(r.priority.items.map(x=>x.priorityKey),['overdue','overdue','today','noNext','noNext','stale']);
 assert.equal(r.buckets.overdue.items.length,1,'priority must not use truncated per-bucket page');
 assert.equal(r.priority.items.find(x=>x.leadId==='d').reason,'Не указано время следующего шага');
 assert.equal(r.priority.items.find(x=>x.leadId==='c').reason,'Не назначено следующее действие');
 assert.equal(new Set(r.priority.items.map(x=>x.leadId)).size,r.priority.items.length);
 assert.deepEqual(groupCrmFollowUps(rows,{todayKey:date,limit:1}).priority,r.priority);
 assert.equal(JSON.stringify(rows),snapshot,'priority is read-only');
 assert.equal(r.priority.scoreCoverage.ready,0,'stage unknown cannot be scored');
 assert.equal(r.priority.scoreCoverage.unready,7);
 assert.ok(r.priority.items.every(x=>x.winScore.score===null&&x.winScore.ready===false),'no fabricated scores');
 assert.equal(groupCrmFollowUps([make('x',{next_action:'Будущее',next_action_on:'2026-12-20'})],{todayKey:date}).priority.items.length,0);
});
test('CRM09A: priority cap six and stable tie-break on equal dates',()=>{
 const rows=Array.from({length:9},(_,i)=>make(String.fromCharCode(122-i),{
  next_action:'Вызов',next_action_on:'2026-11-01'
 }));
 const r=groupCrmFollowUps(rows,{todayKey:date,limit:2});
 assert.equal(r.priority.count,9);
 assert.deepEqual(r.priority.items.map(x=>x.leadId),['r','s','t','u','v','w']);
 assert.equal(r.priority.items.length,6);
 assert.equal(r.buckets.overdue.count,9);
});
test('CRM11A: urgency class outranks score, scored then unscored, tie uses due/activity and ID',()=>{
 const rows=[
  make('unknown-old',{next_action:'Позвонить',next_action_on:'2026-11-01',agreement_stage:null}),
  make('approved',{next_action:'Позвонить',next_action_on:'2026-11-06',agreement_stage:'approved',source_channel:'repeat_client',need_summary:'Смета'}),
  make('negotiation',{next_action:'Позвонить',next_action_on:'2026-11-04',agreement_stage:'negotiation'}),
  make('rejected',{next_action:'Позвонить',next_action_on:'2026-11-03',agreement_stage:'rejected'}),
  make('today-strong',{next_action:'Позвонить',next_action_on:date,agreement_stage:'approved',source_channel:'referral',need_summary:'Сделка'}),
  make('today-unknown',{next_action:'Позвонить',next_action_on:date,agreement_stage:null})
 ];
 const original=JSON.stringify(rows);
 const r=groupCrmFollowUps(rows,{todayKey:date,limit:1});
 assert.equal(r.priority.count,6);
 assert.deepEqual(r.priority.items.map(x=>x.leadId),
  ['approved','negotiation','rejected','unknown-old','today-strong','today-unknown']);
 assert.deepEqual(r.priority.items.map(x=>x.winScore.score),[90,55,0,null,85,null]);
 assert.equal(r.priority.scoreCoverage.ready,4);
 assert.equal(r.priority.scoreCoverage.unready,2);
 assert.equal(r.priority.items[2].winScore.ready,true,'explicit rejected is a ready zero, not missing');
 assert.equal(r.priority.items[3].winScore.ready,false,'unknown cannot rank as a fake 10');
 assert.deepEqual(r.buckets.overdue.items.map(x=>x.leadId),['unknown-old'],
  'CRM07 original due ordering and per-group truncation must remain');
 assert.equal(JSON.stringify(rows),original,'read-only rank calculation must not mutate facts');
 assert.ok(r.priority.items.every(x=>x.winScore.calibratedProbability===false));
});
test('CRM11A: score from authoritative CRM10A model and no note leak',()=>{
 const r=groupCrmFollowUps([
  make('a',{agreement_stage:'approved',source_channel:'repeat_client',need_summary:'Private request details',
   next_action:'Позвонить',next_action_on:'2026-11-01',next_action_at:'2026-11-01T09:00:00Z',
   last_contact_at:'2026-11-06T10:00:00Z'}),
  make('b',{agreement_stage:'new_contact',source_channel:null,need_summary:'',next_action:'Позвонить',next_action_on:'2026-11-01'})
 ],{todayKey:date});
 assert.equal(r.priority.items[0].winScore.score,100);
 assert.equal(r.priority.items[0].winScore.band,'VERY_STRONG');
 assert.equal(r.priority.items[1].winScore.score,15);
 assert.doesNotMatch(JSON.stringify(r),/Private request details/);
 assert.equal(r.priority.coverage.complete,true);
});
test('CRM07A: API bounded query, owner route supplies auth, fail closed over 500',async()=>{
 class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
 const url=new URL('https://test.invalid/api/crm/followups?limit=2');
 const sql=[];
 const pool={query:async query=>{sql.push(query);return {rows:[make('a')]};}};
 const out=await crmFollowUpsRead({pool,url,dayYerevan:()=>date,AppError});
 assert.equal(out.buckets.noNext.count,1);
 assert.match(sql[0],/LEFT JOIN LATERAL/);
 assert.match(sql[0],/l.next_action/);
 assert.match(sql[0],/l.next_action_at/);
 assert.match(sql[0],/l\.next_action,l\.next_action_at,to_char/,'Score must consume canonical timestamp, not only display day');
 assert.match(sql[0],/l.agreement_stage,l.source_channel,l.need_summary/);
 assert.match(sql[0],/entity_type='Lead' AND lead_id=l.id AND status='active'/);
 assert.match(sql[0],/WHERE l.status IN \('new','contacted','qualified'\)/);
 assert.match(sql[0],/LIMIT 501/);
 await assert.rejects(crmFollowUpsRead({pool,url:new URL('https://test.invalid/api/crm/followups?limit=0'),dayYerevan:()=>date,AppError}),e=>e.status===400);
 await assert.rejects(crmFollowUpsRead({pool,url:new URL('https://test.invalid/api/crm/followups?limit=01'),dayYerevan:()=>date,AppError}),e=>e.status===400);
 await assert.rejects(crmFollowUpsRead({pool,url:new URL('https://test.invalid/api/crm/followups?limit=6&limit=7'),dayYerevan:()=>date,AppError}),e=>e.status===400);
 const big={query:async()=>({rows:Array.from({length:501},(_,i)=>make(String(i)))})};
 await assert.rejects(crmFollowUpsRead({pool:big,url,dayYerevan:()=>date,AppError}),e=>e.status===409);
});
test('CRM07A: UI and handler are owner-only, read-only and escape lead strings',async()=>{
 const {readFileSync}=await import('node:fs');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(server,/if\(!sessionValid\(req\)\)throw new AppError\(401/);
 assert.match(server,/pathname==='\/api\/crm\/followups'.*crmFollowUpsRead/);
 assert.match(ui,/crmFollowupView\(\)/);
 assert.match(ui,/crmWorkbenchLead\(lead,'focus'\)/);
 assert.match(ui,/esc\(identity\.name\)/);
 assert.match(ui,/esc\(description\)/);
 assert.match(ui,/data-crm-focus-filter/);
 assert.match(ui,/data-crm-quick-lead/);
 assert.match(ui,/data-crm-followup-lead/);
 assert.match(ui,/Приоритет сейчас/);
 assert.match(ui,/esc\(identity\.name\)/);
 assert.match(ui,/esc\(title\|\|'Обращение'\)/);
 assert.match(ui,/CANONICAL_CRM10A_SIGNALS_AND_CRM07_ATTENTION/);
 assert.match(ui,/esc\(score\.score\)/);
 assert.match(ui,/crm_signal_save'\].includes\(type\)\)await loadCrmFollowups\(\)/);
 assert.match(ui,/scoreValue===null\?'Не рассчитан'/);
 assert.match(ui,/Win Score/);
 assert.match(ui,/crmFollowupState=\{loaded:false,loading:false,result:null,error:''\}/);
 assert.doesNotMatch(server,/UPDATE public\.mvp_leads SET next_action/);
});
