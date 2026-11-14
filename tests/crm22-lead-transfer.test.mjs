import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {leadTransferAction,LEAD_TRANSFER_REASONS} from '../crm-lead-transfer.mjs';

const get=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const legacy=get('../../../CrmService.js'),config=get('../../../Config.js');
const sql=get('../migrations/0025_crm22a_lead_transfer_TEST_ONLY.sql');
const plan=get('../migrations/0025_crm22a_lead_transfer_MIGRATION_PLAN.md');
const ui=get('../public/app.js'),server=get('../server.mjs');
class AppError extends Error{constructor(status,message){super(message);this.status=status;}}
const uuid=x=>{if(!/^[0-9a-f-]{36}$/i.test(String(x)))throw new AppError(400,'UUID');return x;};
const safeRevision=x=>{if(!Number.isSafeInteger(+x)||+x<1)throw new AppError(400,'Revision');return +x;};
const id='11111111-1111-4111-8111-111111111111';
const key='22222222-2222-4222-8222-222222222222';
const valid={leadId:id,revision:1,recipientName:'Мастер',reason:'too_far',comment:'далеко',confirm:'TRANSFER_LEAD'};
const ctx={uuid,safeRevision,AppError};
const noConnect={connect:async()=>{throw Error('Unexpected database connection');}};
test('legacy source confirms exact one-transfer, terminal status, separate Masters and manual recipient',()=>{
 assert.match(legacy,/function transferLeadService_\(/);
 assert.match(legacy,/findRecordByValue_\('LeadTransfers','leadId',leadId\)/);
 assert.match(legacy,/findRecordByValue_\('Masters','masterId',masterId\)/);
 assert.match(legacy,/recipientName=requireString_\(payload\.recipientName/);
 assert.match(legacy,/status:'transferred'/);
 assert.match(legacy,/lastTransferRecipient/);
 assert.match(config,/leadTransferReason:\s*\[/);
 assert.deepEqual(LEAD_TRANSFER_REASONS,[
 'no_time','not_my_specialty','budget_mismatch','too_far',
 'different_specialist_needed','do_not_want_order','other'
 ]);
});
test('invalid manual recipient, reason, malformed master ID, worker ref, spoofed datetime and missing confirmation fail before SQL',async()=>{
 const samples=[
  {...valid,reason:'bad'},
  {...valid,recipientName:' '},
  {...valid,recipientName:'a'.repeat(301)},
  {...valid,comment:'c'.repeat(5001)},
  {...valid,confirm:''},
  {...valid,masterId:'invalid-master-uuid'},
  {...valid,workerId:id},
  {...valid,transferredAt:'2026-10-09T12:00:00Z'}
 ];
 for(const p of samples)await assert.rejects(
  ()=>leadTransferAction({pool:noConnect,p,key,...ctx}),
  e=>[400,409].includes(e.status));
});
test('atomic module keeps same Lead lock as CRM conversion, idempotency and rollback',()=>{
 const src=get('../crm-lead-transfer.mjs');
 assert.match(src,/SELECT \* FROM public\.mvp_leads WHERE id=\$1 FOR UPDATE/);
 assert.match(src,/SELECT \* FROM public\.mvp_crm_lead_transfers WHERE lead_id=\$1/);
 assert.match(src,/prior\.request_key!==key\|\|prior\.payload_sha256!==digest/);
 assert.match(src,/status='transferred'/);
 assert.match(src,/next_action='',next_action_at=NULL/);
 assert.match(src,/await archiveLeadReminderTx\(db,leadId\)/);
 assert.match(src,/await db\.query\('ROLLBACK'\)/);
 assert.match(src,/if\(!\['new','contacted','qualified','lost'\]\.includes\(lead\.status\)\)/);
 assert.doesNotMatch(src,/mvp_workers|INSERT INTO public\.mvp_orders|mvp_clients/);
});
test('SQL migration is guarded, status addition and one-transfer-per-Lead exact FK',()=>{
 assert.match(sql,/DROP CONSTRAINT IF EXISTS mvp_leads_status_check/);
 assert.match(sql,/CHECK\s*\(status IN \('new','contacted','qualified','won','lost','transferred'\)\)/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.mvp_crm_lead_transfers/);
 assert.match(sql,/lead_id uuid NOT NULL UNIQUE REFERENCES public\.mvp_leads\(id\) ON DELETE RESTRICT/);
 assert.match(sql,/request_key uuid NOT NULL UNIQUE/);
 assert.match(sql,/source_system='CLEAN_NATIVE'/);
 assert.match(plan,/fresh point-in-time/i);
 assert.match(plan,/10\/10/);
});
test('the client UI uses manual recipient and immutable transfer receipt, no Worker-to-Master mapping',()=>{
 assert.match(ui,/function crmLeadTransferCard\(lead\)/);
 assert.match(ui,/data-act="lead_transfer"/);
 assert.match(ui,/payload\.confirm='TRANSFER_LEAD'/);
 assert.match(ui,/Повторно передавать нельзя|повторно передавать нельзя/);
 assert.match(ui,/leadTransferReasons/);
 assert.match(ui,/leadTransfers\|\|\[\]/);
 assert.match(ui,/transferred:'Передан'/);
 assert.match(server,/leadTransferAction/);
 assert.match(server,/leadTransfers:leadTransfers\.rows/);
 assert.match(server,/status<>\\?'transferred\\?'/);
});
