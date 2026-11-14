/**
 * CRM23 guarded private import. Source rows and owner credentials are NEVER bundled.
 * A separately approved release executor supplies the exact connector snapshot.
 * Import only original Interactions into an immutable mvp_history archive.
 */
import {createHash} from 'node:crypto';
import {classifyLegacyInteraction,countLegacyRows} from './crm-legacy-interactions.mjs';

export const INTERACTIONS_HEADER=Object.freeze([
 'interactionId','createdAt','updatedAt','status','entityType','entityId',
 'interactionType','summary','nextAction','nextActionAt','notes','clientRequestId'
]);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=x=>{throw new Error('CRM23_IMPORT_GATE:'+x);};
const time=x=>typeof x==='string'&&x.length<=80&&
 /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&Number.isFinite(Date.parse(x));
const countExpected={all:30,activity:15,final:5,pending:10};
const fullCounts={LEAD:33,CLIENT:17,OBJECT:19,WORKER:2,WORK_ORDER:22,CLIENT_ASSESSMENT:13,WORKER_ASSIGNMENT:1,FINANCE_TRANSACTION:24};
const exact=(rows,header,max)=>{
 if(!Array.isArray(rows)||!rows.length||JSON.stringify(rows[0])!==JSON.stringify(header))fail('HEADER_CHANGED');
 if(rows.length-1>max)fail('SOURCE_BOUNDS');
 return rows.slice(1).filter(x=>Array.isArray(x)&&x.some(v=>v!==''&&v!==null&&v!==undefined))
  .map(x=>{
   if(x.length>header.length)fail('TOO_MANY_COLUMNS');
   return header.map((_,i)=>String(x[i]??''));
  });
};
function keys(arr,index,label){
 const keys=new Set();
 for(const x of arr){
  const k=x[index];
  if(!k||k.trim()!==k||k.length>128||keys.has(k))fail(label+'_DUPLICATE_OR_INVALID');
  keys.add(k);
 }
 return keys;
}
/**
 * Both original Google sheets and the frozen 33/17 archive IDs are required.
 * A historic Lead dropped from Google is allowed if no interaction references it.
 */
export function prepareLegacyInteractions({interactions,leads,clients,frozenLeads,frozenClients,receipt}){
 const rows=exact(interactions,INTERACTIONS_HEADER,100);
 const l=exact(leads,['leadId','createdAt','updatedAt','status','name','phone','source','needSummary',
  'agreementStage','nextAction','nextActionAt','notes','clientRequestId','sourceChannel','sourceDetail',
  'lastTransferId','lastTransferredAt','lastTransferRecipient','lastTransferReason'],1500);
 const c=exact(clients,['clientId','createdAt','updatedAt','status','name','phone','email','address',
  'notes','sourceLeadId','clientRequestId','clientTier','referralStatus','clientLabelNote'],1500);
 if(rows.length!==30||c.length!==17||l.length<1)fail('SOURCE_COUNTS_CHANGED');
 const actualLead=keys(l,0,'GOOGLE_LEAD'),actualClient=keys(c,0,'GOOGLE_CLIENT');
 const fixedLead=new Set(frozenLeads),fixedClient=new Set(frozenClients);
 if(fixedLead.size!==33||fixedClient.size!==17||
    [...actualLead].some(x=>!fixedLead.has(x))||
    [...actualClient].some(x=>!fixedClient.has(x)))fail('FROZEN_PARENT_PARITY');
 const objs=rows.map(r=>Object.fromEntries(INTERACTIONS_HEADER.map((h,i)=>[h,r[i]])));
 keys(rows,0,'INTERACTION');
 for(const x of objs){
  const c=classifyLegacyInteraction(x);
  if(!time(x.createdAt)||!time(x.updatedAt)||!x.entityId||x.entityId.trim()!==x.entityId||
     x.interactionId.length<3||x.interactionId.length>128||
     x.entityId.length<3||x.entityId.length>128||x.summary.length>1000||
     x.nextAction.length>500||x.nextActionAt.length>50||
     x.notes.length>5000||x.clientRequestId.length>160)fail('INTERACTION_FIELDS_INVALID');
  if(x.entityType==='Lead'&&!fixedLead.has(x.entityId))fail('ORPHAN_LEAD');
  if(x.entityType==='Client'&&!fixedClient.has(x.entityId))fail('ORPHAN_CLIENT');
  if(c.kind!=='ACTIVITY'&&(!fixedLead.has(c.leadId)||!fixedClient.has(c.clientId)))
   fail('RELATION_PARENT_INVALID');
 }
 const counts=countLegacyRows(objs,[...fixedLead],[...fixedClient]);
 if(JSON.stringify(counts)!==JSON.stringify(countExpected))fail('CLASSIFICATION_COUNTS_CHANGED');
 if(!receipt||receipt.sourceSheet!=='Interactions'||!time(receipt.sourceModifiedAt)||
    typeof receipt.sourceSpreadsheetId!=='string'||receipt.sourceSpreadsheetId.length<10||
    typeof receipt.batchId!=='string'||!/^[A-Za-z0-9_.:-]{4,128}$/.test(receipt.batchId)||
    typeof receipt.historyBatchId!=='string'||receipt.historyBatchId.length<4||
    receipt.expectedCount!==30)fail('RECEIPT_INVALID');
 const sourceSha256=sha({interactions:rows,
  leadWitness:l.map(x=>[x[0],x[3]]),clientWitness:c.map(x=>[x[0],x[9]]),
  frozenLeads:[...fixedLead].sort(),frozenClients:[...fixedClient].sort()});
 if(receipt.expectedSourceSha256!==sourceSha256)fail('SOURCE_DIGEST_MISMATCH');
 const payload=objs.map((x,i)=>{
  const category=classifyLegacyInteraction(x);
  return [x.interactionId,category.kind,x.entityType,x.entityId,x.interactionType,
   x.createdAt,x.updatedAt,x.status,x.summary,x.nextAction,x.nextActionAt,
   x.notes,x.clientRequestId,sha(rows[i])];
 });
 return {rows:payload,receipt:{...receipt,sourceSha256},counts,
  frozenLeadIds:[...fixedLead],frozenClientIds:[...fixedClient]};
}
const checkGate=(p,g)=>{
 if(g?.explicitOwnerApproval!==true||!g.independentlyRestorableBackupId||
    g.approvedBatchId!==p?.receipt?.batchId||
    g.approvedSourceSha256!==p?.receipt?.sourceSha256||
    g.approvedSourceModifiedAt!==p?.receipt?.sourceModifiedAt||
    g.approvedHistoryBatchId!==p?.receipt?.historyBatchId)
  fail('RELEASE_AUTHORIZATION_OR_BACKUP_MISSING');
};
export async function importPreparedLegacyInteractions({pool,prepared,gate}){
 checkGate(prepared,gate);
 const db=await pool.connect(),r=prepared.receipt,receiptId='CRM23-'+r.sourceSha256.slice(0,40);
 try{
  await db.query('BEGIN');
  const history=(await db.query('SELECT expected_counts FROM mvp_history.import_batches WHERE batch_id=$1 FOR SHARE',
   [r.historyBatchId])).rows[0];
  if(!history||Object.entries(fullCounts).some(([key,val])=>Number(history.expected_counts?.[key])!==val))
   fail('FROZEN_HISTORY_BATCH_CHANGED');
  const current=(await db.query("SELECT source_kind,source_id FROM mvp_history.source_records WHERE import_batch_id=$1 AND source_kind IN ('LEAD','CLIENT')",
   [r.historyBatchId])).rows;
  const l=new Set(current.filter(x=>x.source_kind==='LEAD').map(x=>x.source_id));
  const c=new Set(current.filter(x=>x.source_kind==='CLIENT').map(x=>x.source_id));
  if(l.size!==33||c.size!==17||
     prepared.frozenLeadIds.some(x=>!l.has(x))||prepared.frozenClientIds.some(x=>!c.has(x)))
   fail('FROZEN_SOURCE_CHANGED');
  const maps=(await db.query(
   "SELECT source_id,target_id FROM public.mvp_legacy_import_map WHERE source_entity='Clients' AND source_system='Working IP APP / M8C cutover baseline'"
  )).rows;
  if(maps.length!==17||new Set(maps.map(x=>x.source_id)).size!==17||
     new Set(maps.map(x=>String(x.target_id))).size!==17||
     maps.some(x=>!c.has(x.source_id)))fail('CLIENT_IDENTITY_MAP_INVALID');
  await db.query(
   'INSERT INTO mvp_history.crm_legacy_interaction_receipts '+
   '(receipt_id,history_batch_id,source_spreadsheet_id,source_sheet,snapshot_sha256,count_all,count_activity,count_relation_final,count_relation_pending) '+
   "VALUES($1,$2,$3,'Interactions',$4,30,15,5,10) ON CONFLICT DO NOTHING",
   [receiptId,r.historyBatchId,r.sourceSpreadsheetId,r.sourceSha256]);
  const existed=(await db.query(
   'SELECT receipt_id,history_batch_id,source_spreadsheet_id,source_sheet,snapshot_sha256,count_all,count_activity,count_relation_final,count_relation_pending '+
   'FROM mvp_history.crm_legacy_interaction_receipts WHERE receipt_id=$1 FOR UPDATE',
   [receiptId])).rows[0];
  if(!existed||existed.history_batch_id!==r.historyBatchId||
     existed.source_spreadsheet_id!==r.sourceSpreadsheetId||
     existed.source_sheet!=='Interactions'||existed.snapshot_sha256!==r.sourceSha256||
     Number(existed.count_all)!==30||Number(existed.count_activity)!==15||
     Number(existed.count_relation_final)!==5||Number(existed.count_relation_pending)!==10)
    fail('RECEIPT_COLLISION');
  for(const row of prepared.rows){
   await db.query(
    'INSERT INTO mvp_history.crm_legacy_interactions '+
    '(source_id,receipt_id,record_kind,entity_type,entity_id,interaction_type,created_at,updated_at,original_status,summary,next_action,next_action_at,notes,client_request_id,row_sha256) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11,$12,$13,$14,$15) '+
    'ON CONFLICT(source_id) DO NOTHING',
    [row[0],receiptId,...row.slice(1)]);
   const stored=(await db.query('SELECT receipt_id,row_sha256,record_kind,entity_id FROM mvp_history.crm_legacy_interactions WHERE source_id=$1 FOR UPDATE',[row[0]])).rows[0];
   if(!stored||stored.receipt_id!==receiptId||stored.row_sha256!==row[13]||
      stored.record_kind!==row[1]||stored.entity_id!==row[3])fail('INTERACTION_SOURCE_ID_COLLISION');
  }
  const cnt=(await db.query('SELECT count(*)::int n FROM mvp_history.crm_legacy_interactions WHERE receipt_id=$1',[receiptId])).rows[0]?.n;
  if(cnt!==30)fail('IMPORTED_COUNT_MISMATCH');
  await db.query('COMMIT');
  return {receiptId,sourceSha256:r.sourceSha256,verifiedRows:cnt};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
 finally{db.release();}
}
