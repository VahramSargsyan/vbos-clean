import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {INTERACTIONS_HEADER,prepareLegacyInteractions,importPreparedLegacyInteractions}
 from '../crm-legacy-interactions-import.mjs';
import {MASTERS_HEADER,prepareLegacyMasters,importPreparedLegacyMasters}
 from '../crm-legacy-masters-import.mjs';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const iso='2026-11-08T10:59:32.797Z';
const lHead=['leadId','createdAt','updatedAt','status','name','phone','source','needSummary',
 'agreementStage','nextAction','nextActionAt','notes','clientRequestId','sourceChannel','sourceDetail',
 'lastTransferId','lastTransferredAt','lastTransferRecipient','lastTransferReason'];
const cHead=['clientId','createdAt','updatedAt','status','name','phone','email','address',
 'notes','sourceLeadId','clientRequestId','clientTier','referralStatus','clientLabelNote'];
const fake23=()=>{
 const frozenLeads=Array.from({length:33},(_,i)=>'TEST-OLD-LEAD-'+i);
 const frozenClients=Array.from({length:17},(_,i)=>'TEST-OLD-CLIENT-'+i);
 const leads=[lHead,...frozenLeads.slice(0,32).map(id=>[id,iso,iso,'transferred'])];
 const clients=[cHead,...frozenClients.map(id=>[id,iso,iso,'active'])];
 const interactions=[INTERACTIONS_HEADER];
 for(let i=0;i<30;i++){
  const kind=i<15?'ACTIVITY':i<20?'RELATION_FINAL':'RELATION_PENDING';
  const lead=frozenLeads[i%32],client=frozenClients[i%17];
  const req=kind==='ACTIVITY'?'CI-REQ-'+i:
   'REL|'+(kind==='RELATION_FINAL'?'LeadClient':'LeadClientPending')+'|'+lead+'|'+client;
  interactions.push(['TEST-INT-'+i,iso,iso,'active','Lead',lead,
   kind==='ACTIVITY'?'call':'note',kind==='ACTIVITY'?'synthetic call':'relation',
   '','','',req]);
 }
 const expectedSourceSha256=sha({
  interactions:interactions.slice(1),
  leadWitness:leads.slice(1).map(x=>[x[0],x[3]]),
  clientWitness:clients.slice(1).map(x=>[x[0],x[9]||'']),
  frozenLeads:[...frozenLeads].sort(),frozenClients:[...frozenClients].sort()
 });
 const receipt={sourceSheet:'Interactions',sourceSpreadsheetId:'CI-SYNTHETIC-GOOGLE-ID',
  sourceModifiedAt:iso,batchId:'CRM23-CI-IMPORT-01',
  historyBatchId:'CI-FROZEN-BATCH-001',expectedCount:30,expectedSourceSha256};
 return {interactions,leads,clients,frozenLeads,frozenClients,receipt};
};
const fake25=()=>{
 const masters=[MASTERS_HEADER];
 for(let i=0;i<5;i++)masters.push(['CI-OLD-MASTER-'+i,iso,iso,'active',
  'Fictional master '+i,'0000'+i,'','Synthetic area','','','good','none','']);
 const sourceSha256=sha({masters:masters.slice(1),sourceSheet:'Masters'});
 return {masters,receipt:{sourceSheet:'Masters',sourceSpreadsheetId:'CI-SYNTHETIC-GOOGLE-ID',
  sourceModifiedAt:iso,batchId:'CRM25-CI-IMPORT-01',expectedCount:5,expectedSourceSha256:sourceSha256}};
};
const clone=x=>structuredClone(x);
test('CRM23 source evidence: 30 immutable rows, 15 genuine, 5 final, 10 pending, frozen 33 vs current 32',()=>{
 const p=prepareLegacyInteractions(fake23());
 assert.deepEqual(p.counts,{all:30,activity:15,final:5,pending:10});
 assert.equal(p.rows.length,30);assert.equal(p.frozenLeadIds.length,33);
 assert.equal(p.rows[0][13].length,64);
 assert.equal(p.rows.filter(x=>x[1]==='ACTIVITY').length,15);
});
test('CRM23 malformed headers, unknown relationship, wrong hashes, duplicates and source orphans fail closed',()=>{
 const orig=fake23();
 for(const mutate of [
  p=>{p.receipt.expectedSourceSha256='0'.repeat(64);},
  p=>{p.interactions[0][0]='wrong';},
  p=>{p.interactions[1][0]=p.interactions[2][0];},
  p=>{p.interactions[1][5]='LEAD-OUTSIDE-FROZEN';},
  p=>{p.interactions[1][11]='REL|Wrong|AAA';},
  p=>{p.interactions[16][11]='REL|LeadClientPending|wrong|wrong';},
  p=>{p.interactions[1][1]='invalid-date';},
  p=>{p.interactions[1][7]='X'.repeat(1001);},
  p=>{p.frozenLeads=p.frozenLeads.slice(1);},
  p=>{p.clients.pop();},
  p=>{p.leads.push([...p.leads[1]]);}
 ]){
  const payload=clone(orig);mutate(payload);
  assert.throws(()=>prepareLegacyInteractions(payload));
 }
});
test('CRM25 source contract preserves original IDs and fields; invalid statuses and replay spoofing fail',()=>{
 const fixture=fake25(),p=prepareLegacyMasters(fixture);
 assert.equal(p.rows.length,5);
 assert.equal(p.rows[0][0],'CI-OLD-MASTER-0');
 assert.equal(p.rows[0][13].length,64);
 for(const mutate of [
  f=>{f.masters[0][0]='invalid';},
  f=>{f.masters[1][0]=f.masters[2][0];},
  f=>{f.masters[1][3]='won';},
  f=>{f.masters[1][10]='vip';},
  f=>{f.masters[1][11]='signal';},
  f=>{f.masters[1][4]='';},
  f=>{f.masters[1][1]='not-date';},
  f=>{f.masters[1][7]='z'.repeat(501);},
  f=>{f.masters.pop();},
  f=>{f.receipt.expectedSourceSha256='0'.repeat(64);}
 ]){
  const changed=clone(fixture);mutate(changed);
  assert.throws(()=>prepareLegacyMasters(changed),/CRM25_IMPORT_GATE/);
 }
});
test('No owner approval, exact source or backup => zero connections and zero writes',async()=>{
 const blockedPool={connect(){throw Error('CONNECT_NOT_ALLOWED');}};
 const p23=prepareLegacyInteractions(fake23()),p25=prepareLegacyMasters(fake25());
 for(const [prepare,execute] of [[p23,importPreparedLegacyInteractions],[p25,importPreparedLegacyMasters]]){
  for(const gate of [{},{explicitOwnerApproval:true},{explicitOwnerApproval:true,independentlyRestorableBackupId:'snapshot'},
   {explicitOwnerApproval:true,independentlyRestorableBackupId:'backup',approvedBatchId:prepare.receipt.batchId,approvedSourceSha256:'0'.repeat(64)}]){
   await assert.rejects(execute({pool:blockedPool,prepared:prepare,gate}),
    /_IMPORT_GATE:RELEASE_AUTHORIZATION_OR_BACKUP_MISSING/);
  }
 }
});
test('Migration is additive, original fields preserved, and imported legacy Masters cannot be edited as native',()=>{
 const schema=readFileSync(new URL('../migrations/0028_crm25a_master_directory_CANDIDATE.sql',import.meta.url),'utf8');
 const editor=readFileSync(new URL('../crm-masters.mjs',import.meta.url),'utf8');
 assert.match(schema,/mvp_history\.crm_legacy_master_receipts/);
 for(const column of ['source_created_at','source_updated_at','source_client_request_id','legacy_receipt_id','row_sha256'])
  assert.ok(schema.includes(column),column);
 assert.match(editor,/source_system='CLEAN_NATIVE' RETURNING/);
 assert.doesNotMatch(schema,/DROP TABLE|TRUNCATE|DELETE FROM/);
});
