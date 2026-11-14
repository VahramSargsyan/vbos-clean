import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 crmScoreHistoryFingerprint,crmScoreHistoryDelta,crmScoreHistoryAfterAction
} from '../crm-score-history.mjs';
import {crmLeadSignals} from '../crm-lead-signals.mjs';

const row={id:'11111111-1111-4111-8111-111111111111',status:'new',revision:1,
 agreement_stage:'negotiation',source_channel:'referral',need_summary:'Do not leak this text',
 next_action:'Позвонить',next_action_at:new Date('2026-11-08T11:00:00Z'),
 last_contact_at:new Date('2026-11-08T08:00:00Z'),last_contact_type:'call'};
test('CRM12A: stable factual signature, no PII, action text change and time source affect fingerprint',()=>{
 const sig=crmLeadSignals(row);
 const first=crmScoreHistoryFingerprint(row,sig);
 assert.match(first,/^[0-9a-f]{64}$/);
 assert.equal(first,crmScoreHistoryFingerprint({...row},crmLeadSignals({...row})));
 assert.notEqual(first,crmScoreHistoryFingerprint({...row,next_action:'Отправить смету'},crmLeadSignals({...row,next_action:'Отправить смету'})));
 assert.notEqual(first,crmScoreHistoryFingerprint({...row,next_action_at:new Date('2026-11-08T12:00:00Z')},crmLeadSignals({...row,next_action_at:new Date('2026-11-08T12:00:00Z')})));
 assert.notEqual(first,crmScoreHistoryFingerprint({...row,status:'lost'},crmLeadSignals({...row,status:'lost'})));
 assert.notEqual(first,crmScoreHistoryFingerprint({...row,last_contact_at:new Date('2026-11-08T09:00:00Z')},crmLeadSignals({...row,last_contact_at:new Date('2026-11-08T09:00:00Z')})));
 assert.equal(JSON.stringify({signature:first}).includes('Do not leak'),false);
});
test('CRM12A: real zero, signed delta and null terminal never fabricated',()=>{
 assert.equal(crmScoreHistoryDelta(null,70),null);
 assert.equal(crmScoreHistoryDelta(0,0),0);
 assert.equal(crmScoreHistoryDelta(10,0),-10);
 assert.equal(crmScoreHistoryDelta(60,70),10);
 assert.equal(crmScoreHistoryDelta(70,null),null);
});
test('CRM12A: unrelated actions must never touch history, eligible failures nonblocking',async()=>{
 const innocent=await crmScoreHistoryAfterAction({pool:{connect(){throw Error('must not connect')}},type:'order_update',p:{id:row.id}});
 assert.equal(innocent.status,'NOT_APPLICABLE');
 const orig=console.warn;console.warn=()=>{};
 try{
  const failure=await crmScoreHistoryAfterAction({pool:{connect(){throw Error('synthetic down')}},type:'crm_signal_save',p:{leadId:row.id}});
  assert.equal(failure.status,'FAILED');
 }finally{console.warn=orig;}
});
test('CRM12A: migration and protected owner-auth path, exact cardinality and no replay rewrite',()=>{
 const sql=readFileSync(new URL('../migrations/0022_crm12a_score_history_TEST_ONLY.sql',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const module=readFileSync(new URL('../crm-score-history.mjs',import.meta.url),'utf8');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.mvp_crm_score_history_meta/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.mvp_lead_score_snapshots/);
 assert.match(sql,/ON CONFLICT\(singleton\) DO NOTHING/);
 assert.match(sql,/CREATE INDEX IF NOT EXISTS mvp_lead_score_snapshots_latest_idx/);
 assert.doesNotMatch(sql,/ALTER TABLE public\.mvp_leads|DROP TABLE|TRUNCATE TABLE|DELETE FROM/);
 assert.match(server,/if\(!sessionValid\(req\)\)throw new AppError\(401/);
 assert.match(server,/crmScoreHistoryAfterAction\(\{pool,type,p\}\)/);
 assert.match(server,/const result=await action\(type,p\)/);
 assert.ok(server.indexOf('const result=await action(type,p)')<server.indexOf('await crmScoreHistoryAfterAction({pool,type,p})'));
 assert.match(module,/FOR UPDATE/);
 assert.match(module,/ORDER BY snapshot_id DESC LIMIT 1/);
 assert.match(module,/HISTORY_LIMIT=12/);
 assert.match(app,/История Win Score/);
 assert.match(app,/esc\(item\.capture_source\)/);
 assert.match(app,/История до этой даты неизвестна/);
});
