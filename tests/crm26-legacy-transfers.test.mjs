import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {TRANSFER_HEADER,LEAD_EVIDENCE_HEADER,prepareLegacyTransfers,importPreparedLegacyTransfers} from '../crm-legacy-transfers-import.mjs';
import {legacyLeadTransfersPage} from '../crm-legacy-transfers.mjs';
import {renderLegacyTransferRows} from '../public/crm-legacy-transfers-view.mjs';

class AppError extends Error{constructor(status,msg){super(msg);this.status=status;}}
const src=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const stamp='2026-11-08T10:00:00.000Z';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const synthetic=()=>{
 const t1=['LT-TEST-01',stamp,stamp,'active','LEAD-TEST-01','Fake <script>alert(1)</script>',
  'no_time',stamp,'Synthetic comment','REQ-TEST-01','MASTER-TEST-01'];
 const t2=['LT-TEST-02',stamp,stamp,'active','LEAD-TEST-02','Fake B',
  'different_specialist_needed',stamp,'', 'REQ-TEST-02',''];
 const l=id=>{
  const row=Array(LEAD_EVIDENCE_HEADER.length).fill('');
  row[0]='LEAD-TEST-'+id;row[3]='transferred';row[15]='LT-TEST-'+id;
  return row;
 };
 const transfers=[TRANSFER_HEADER,[...t1],[...t2]],leads=[LEAD_EVIDENCE_HEADER,l('01'),l('02')];
 const sourceSha256=sha({transfers:transfers.slice(1),leadWitness:leads.slice(1).map(x=>[x[0],x[3],x[15]])});
 const receipt={sourceSpreadsheetId:'SYNTHETIC-GOOGLE-SHEET-TEST',
  sourceSheet:'LeadTransfers',sourceModifiedAt:stamp,batchId:'CRM26-TEST-BATCH-01',
  expectedCount:2,expectedSourceSha256:sourceSha256};
 return {transfers,leads,receipt};
};
test('CRM26 source exact enums and immutable separate history schema',()=>{
 const schema=src('../migrations/0029_crm26a_legacy_transfer_archive_CANDIDATE.sql');
 const old=src('../../../Config.js'),transfer=src('../../../CrmService.js'),server=src('../server.mjs');
 assert.match(old,/LeadTransfers:\s*\['transferId',\s*'createdAt'/);
 assert.match(transfer,/function transferLeadService_\(/);
 assert.match(schema,/CREATE TABLE IF NOT EXISTS mvp_history\.crm_legacy_transfer_batches/);
 assert.match(schema,/CREATE TABLE IF NOT EXISTS mvp_history\.crm_legacy_lead_transfers/);
 assert.match(schema,/source_transfer_id text PRIMARY KEY/);
 assert.match(schema,/source_master_id text NOT NULL DEFAULT/);
 assert.doesNotMatch(schema,/source_lead_id uuid|REFERENCES public\.mvp_leads|REFERENCES public\.mvp_crm_lead_transfers/);
 assert.match(server,/\/api\/crm\/legacy-transfers/);
 const plan=src('../migrations/0029_crm26a_legacy_transfer_archive_MIGRATION_PLAN.md');
 assert.match(plan,/fresh Neon backup/i);
});

test('CRM26 source snapshot validates historical Lead references and exact digest',()=>{
 const base=synthetic(),p=prepareLegacyTransfers(base);
 assert.equal(p.items.length,2);
 assert.equal(p.items[0].row[0],'LT-TEST-01');
 assert.equal(p.items[0].row[1],'LEAD-TEST-01');
 assert.equal(p.items[0].row[2],'MASTER-TEST-01');
 assert.equal(p.items[0].row[11].length,64);
 for(const patch of [
  v=>{v.receipt.expectedCount=1;},
  v=>{v.receipt.expectedSourceSha256='0'.repeat(64);},
  v=>{v.receipt.sourceModifiedAt='tomorrow';},
  v=>{v.transfers[1][0]='LT-TEST-02';},
  v=>{v.transfers[1][4]='unknown';},
  v=>{v.leads[1][3]='won';},
  v=>{v.leads[1][15]='WRONG';},
  v=>{v.transfers[1][6]='unknown';},
  v=>{v.transfers[1][7]='not a timestamp';},
  v=>{v.transfers[0][0]='incorrect-header';}
 ]){
  const payload=structuredClone(base);patch(payload);
  assert.throws(()=>prepareLegacyTransfers(payload),/CRM26_SOURCE_GATE/);
 }
});

test('CRM26 missing owner approval, backup or scope fails before any database connection',async()=>{
 const p=prepareLegacyTransfers(synthetic());
 const pool={async connect(){throw Error('Database must never be opened');}};
 for(const gate of [
  {},{explicitOwnerApproval:true},{explicitOwnerApproval:true,independentlyRestorableBackupId:'backup',
   approvedBatchId:'wrong',approvedSourceSha256:p.batch.sourceSha256}
 ]){
  await assert.rejects(importPreparedLegacyTransfers({pool,prepared:p,gate}),
   /CRM26_SOURCE_GATE:RELEASE_NOT_APPROVED_OR_BACKUP_MISSING/);
 }
});

test('CRM26 pagination is bounded and query parameters, not interpolated SQL',async()=>{
 const calls=[],row={source_transfer_id:'LT-TEST-01',
  transferred_at_source:stamp,cursor_at:'2026-11-08T10:00:00.000000Z'};
 const pool={async query(sql,args){calls.push({sql,args});return {rows:[row,{...row,source_transfer_id:'LT-TEST-02'}]};}};
 const first=await legacyLeadTransfersPage({pool,url:new URL('http://local?limit=1&q=Test'),AppError});
 assert.equal(first.items.length,1);
 assert.equal(first.items[0].cursor_at,undefined);
 assert.equal(first.hasMore,true);
 assert.equal(first.linkedToClean,false);
 assert.match(calls[0].sql,/FROM mvp_history\.crm_legacy_lead_transfers/);
 assert.ok(calls[0].sql.includes('strpos(lower(concat_ws('));
 assert.deepEqual(calls[0].args,['Test',2]);
 const second=await legacyLeadTransfersPage({pool,url:new URL('http://local?limit=1&q=Test&cursor='+first.nextCursor),AppError});
 assert.equal(second.items.length,1);
 assert.equal(calls[1].args[1],'2026-11-08T10:00:00.000000Z');
 for(const url of [
  'q=A','limit=500','q=else&cursor='+first.nextCursor,
  'cursor=bad','q=%00',
 ]){
  await assert.rejects(legacyLeadTransfersPage({pool,url:new URL('http://local?'+url),AppError}),e=>e.status===400);
 }
 assert.equal(calls.length,2);
});
test('CRM26 HTML escapes old recipient and comment, never links legacy to native',()=>{
 const html=renderLegacyTransferRows([{source_transfer_id:'LT-TEST-01',
  source_lead_id:'LEAD-TEST-01',source_master_id:'M-TEST',
  recipient_name:'<img src=x onerror=alert(1)>',reason:'no_time',
  transferred_at_source:stamp,comment:'<script>alert(1)</script>'}]);
 assert.ok(html.includes('&lt;img'));
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('<script>')&&!html.includes('<img'));
 assert.ok(html.includes('LEAD-TEST-01'));
 assert.doesNotMatch(html,/data-act|\/api\/action|href=/);
});
