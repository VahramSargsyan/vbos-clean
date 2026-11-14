import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {crmReminderClock} from '../crm-reminders.mjs';

class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
const safeDate=s=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)
  throw new AppError(400,'Invalid date');
 return s;
};
const deps={safeDate,AppError};

test('CRM08 clock: Yerevan wall time is exact, rejects invalid calendar and non-local inputs',()=>{
 const d=crmReminderClock('2026-11-12T14:30',deps);
 assert.deepEqual(d,{instant:'2026-11-12T10:30:00.000Z',day:'2026-11-12',local:'2026-11-12T14:30'});
 assert.equal(crmReminderClock('',deps),null);
 for(const x of ['2026-02-31T09:00','2026-11-07T25:00','2026-11-07T09:99',
  '2026-11-07','2026-11-07T09:30Z','2026-11-07T09:30+04:00']){
  assert.throws(()=>crmReminderClock(x,deps),e=>e.status===400,x);
 }
});
test('CRM08: canonical Lead contract and projection do not change legacy/manual source',()=>{
 const sql=readFileSync(new URL('../migrations/0020_crm08a_next_action_calendar_TEST_ONLY.sql',import.meta.url),'utf8');
 assert.match(sql,/ALTER TABLE public\.mvp_leads/);
 assert.match(sql,/next_action_at timestamptz/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.mvp_schedule_lead_items/);
 assert.match(sql,/CONSTRAINT mvp_crm_auto_key/);
 assert.match(sql,/CONSTRAINT mvp_crm_auto_duration/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.mvp_crm_reminder_requests/);
 assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|DELETE FROM|UPDATE public\.mvp_leads/i);
 const schedule=readFileSync(new URL('../schedule.mjs',import.meta.url),'utf8');
 assert.match(schedule,/mvp_schedule_lead_items/);
 assert.match(schedule,/fromTable\('mvp_schedule_lead_items'\)/);
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 assert.match(server,/crmReminderAction/);
 assert.match(server,/crmLeadStatusAction/);
 const conversion=readFileSync(new URL('../crm-lead-conversion.mjs',import.meta.url),'utf8');
 assert.match(conversion,/archiveLeadReminderTx\(client,leadId\)/);
 const focus=readFileSync(new URL('../crm-followups.mjs',import.meta.url),'utf8');
 assert.match(focus,/CANONICAL_LEAD_NEXT_ACTION/);
 assert.match(focus,/l\.next_action/);
});
test('CRM08: UI escapes text, calendar is CRM read-only, saved request refreshes CRM/Calendar',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const calendar=readFileSync(new URL('../public/schedule.js',import.meta.url),'utf8');
 assert.match(app,/crmReminderCard\(x\)/);
 assert.match(app,/data-act="crm_reminder_save"/);
 assert.match(app,/esc\(lead\.next_action\|\|/);
 assert.match(app,/data-crm-reminder-clear/);
 assert.match(app,/schedule\.loaded=false/);
 assert.match(calendar,/x\.source_kind==='crm'/);
 assert.match(calendar,/if\(managed\)return out/);
 assert.match(calendar,/Напоминание CRM/);
 assert.match(calendar,/data-schedule-open-lead/);
});
