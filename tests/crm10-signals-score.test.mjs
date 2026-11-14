import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {crmLeadSignals,crmSignalFields,CRM_STAGE_KEYS,CRM_SOURCE_KEYS} from '../crm-lead-signals.mjs';
class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
const base={id:'case-1',status:'new',agreement_stage:null,source_channel:null,need_summary:'',
 next_action:'',next_action_at:null,last_contact_at:null,last_contact_type:null};

test('CRM10A: no guessed stage, no invented score for existing Clean Leads',()=>{
 const out=crmLeadSignals(base);
 assert.equal(out.winScore.score,null);
 assert.equal(out.winScore.ready,false);
 assert.equal(out.winScore.coverage,'STAGE_REQUIRED');
 assert.equal(out.winScore.calibratedProbability,false);
 assert.equal(out.interactionCoverage,'INDEXED_ACTIVE_CONTACT_PRESENCE_ONLY');
 assert.ok(out.winScore.reasons.some(x=>x.label==='Этап сделки не указан'));
 assert.equal(crmLeadSignals({...base,status:'won',agreement_stage:'approved'}).winScore.score,null);
 assert.equal(crmLeadSignals({...base,status:'lost',agreement_stage:'rejected'}).winScore.coverage,'TERMINAL_LEAD');
});

test('CRM10A: accepted legacy stage weights and Win Score band thresholds',()=>{
 const expected=[
 ['new_contact',10,'LOW'],['needs_discussion',20,'LOW'],
 ['estimate_required',30,'DEVELOPING'],['estimate_sent',40,'DEVELOPING'],
 ['negotiation',50,'ACTIVE'],['approved',60,'ACTIVE'],['rejected',0,'LOW']
 ];
 for(const [stage,score,band] of expected){
  const o=crmLeadSignals({...base,agreement_stage:stage});
  assert.equal(o.winScore.score,score,stage);
  assert.equal(o.winScore.band,band,stage);
  assert.equal(o.winScore.reasons.reduce((a,x)=>a+x.points,0),score,stage);
 }
 assert.equal(CRM_STAGE_KEYS.length,7);
});
test('CRM10A: source bonus/need/interaction/action/time exact legacy points, cap 100',()=>{
 const full={...base,agreement_stage:'approved',source_channel:'repeat_client',
  need_summary:'Описание',last_contact_at:'2026-11-06T10:00:00Z',last_contact_type:'call',
  next_action:'Отправить документ',next_action_at:'2026-11-08T10:00:00Z'};
 const x=crmLeadSignals(full);
 assert.equal(x.winScore.score,100);
 assert.equal(x.winScore.band,'VERY_STRONG');
 assert.deepEqual(x.winScore.reasons.map(x=>x.points),[60,15,10,5,5,5]);
 assert.equal(x.winScore.reasons.reduce((a,r)=>a+r.points,0),100);
 const y=crmLeadSignals({...full,agreement_stage:'negotiation',source_channel:'referral'});
 assert.equal(y.winScore.score,85);
 assert.deepEqual(y.winScore.reasons.map(x=>x.points),[50,10,10,5,5,5]);
 const z=crmLeadSignals({...full,agreement_stage:'negotiation',source_channel:'partner'});
 assert.equal(z.winScore.score,82);
 assert.equal(crmLeadSignals({...full,source_channel:'facebook'}).winScore.score,85);
 assert.equal(CRM_SOURCE_KEYS.length,9);
});
test('CRM10A: rejected stage overrides otherwise positive evidence',()=>{
 const out=crmLeadSignals({...base,agreement_stage:'rejected',source_channel:'repeat_client',need_summary:'Known',
  next_action:'Meet',next_action_at:'2026-11-08T10:00:00Z',last_contact_at:'2026-11-06T10:00:00Z'});
 assert.equal(out.winScore.score,0);
 assert.equal(out.winScore.terminalOverride,true);
 assert.deepEqual(out.winScore.reasons,[{key:'stage',points:0,label:'Отказ · итог 0',active:true}]);
});
test('CRM10A: explicit enum and text guards; blank source/stage remain unknown',()=>{
 const f=crmSignalFields({agreementStage:'',sourceChannel:'',needSummary:''},AppError);
 assert.deepEqual(f,{agreementStage:null,sourceChannel:null,needSummary:''});
 assert.equal(crmSignalFields({agreementStage:'negotiation',sourceChannel:'referral',needSummary:'  Трубопровод '},AppError).needSummary,'Трубопровод');
 for(const data of [
  {agreementStage:'qualified',sourceChannel:'referral',needSummary:''},
  {agreementStage:'approved',sourceChannel:'tiktok',needSummary:''},
  {agreementStage:'approved',sourceChannel:'referral',needSummary:'a'.repeat(1001)},
  {agreementStage:'approved',sourceChannel:'referral',needSummary:null}
 ])assert.throws(()=>crmSignalFields(data,AppError),e=>e.status===400);
});
test('CRM10A: additive SQL only, auth route, escaped UI; no legacy or Finance writer',()=>{
 const sql=readFileSync(new URL('../migrations/0021_crm10a_lead_signals_TEST_ONLY.sql',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(sql,/ADD COLUMN IF NOT EXISTS agreement_stage/);
 assert.match(sql,/ADD COLUMN IF NOT EXISTS source_channel/);
 assert.match(sql,/ADD COLUMN IF NOT EXISTS need_summary/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.mvp_crm_signal_requests/);
 assert.doesNotMatch(sql,/\bDROP TABLE|\bDELETE FROM|\bTRUNCATE TABLE|\bUPDATE public\.mvp_leads/i);
 assert.match(server,/if\(!sessionValid\(req\)\)throw new AppError\(401/);
 assert.match(server,/if\(pathname==='\/api\/crm\/lead-signals'&&req\.method==='GET'\)\{\s+const signals=await crmLeadSignalsRead\(/);
 assert.match(server,/if\(type==='crm_signal_save'\)return crmLeadSignalsSave/);
 assert.match(ui,/crmLeadSignalCard\(x\)/);
 assert.match(ui,/data-crm-signal-load/);
 assert.match(ui,/data-act="crm_signal_save"/);
 assert.match(ui,/esc\(score\.bandLabel\|\|''\)/);
 assert.match(ui,/esc\(reason\.label\)/);
 assert.match(ui,/не вероятность продажи/);
});
