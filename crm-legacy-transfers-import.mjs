/**
 * CRM26A: guarded, private-input Google LeadTransfers -> isolated immutable history.
 * Does not fetch Google, hold credentials or contain real user rows.
 * Never call from a public endpoint. Requires a separate exact approved release.
 */
import {createHash} from 'node:crypto';

export const TRANSFER_HEADER=Object.freeze([
 'transferId','createdAt','updatedAt','status','leadId','recipientName',
 'reason','transferredAt','comment','clientRequestId','masterId'
]);
export const LEAD_EVIDENCE_HEADER=Object.freeze([
 'leadId','createdAt','updatedAt','status','name','phone','source','needSummary',
 'agreementStage','nextAction','nextActionAt','notes','clientRequestId',
 'sourceChannel','sourceDetail','lastTransferId','lastTransferredAt',
 'lastTransferRecipient','lastTransferReason'
]);
const REASONS=new Set([
 'no_time','not_my_specialty','budget_mismatch','too_far',
 'different_specialist_needed','do_not_want_order','other'
]);
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=message=>{throw new Error('CRM26_SOURCE_GATE:'+message);};
const cell=v=>String(v??'');
const dateValid=v=>typeof v==='string'&&v.length<=80&&
 /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&
 Number.isFinite(Date.parse(v));
function exactHeader(rows,header){
 if(!Array.isArray(rows)||!rows.length||JSON.stringify(rows[0])!==JSON.stringify(header))fail('HEADER_MISMATCH');
}
function rowsOnly(rows,max){
 if(rows.length-1>max)fail('UNBOUNDED_SOURCE');
 return rows.slice(1).filter(r=>Array.isArray(r)&&r.some(x=>cell(x))).map(r=>{
  if(r.length>40)fail('COLUMN_WIDTH');
  return Array.from({length:rows[0].length},(_,i)=>cell(r[i]));
 });
}
/** Validates ORIGINAL Google rows and exact Lead relationships before SQL. */
export function prepareLegacyTransfers({transfers,leads,receipt}){
 exactHeader(transfers,TRANSFER_HEADER);exactHeader(leads,LEAD_EVIDENCE_HEADER);
 const rows=rowsOnly(transfers,5000),leadRows=rowsOnly(leads,10000);
 const leadMap=new Map();
 for(const l of leadRows){
  const id=l[0];
  if(!id||!id.trim()||id!==id.trim()||id.length>100||leadMap.has(id))fail('LEAD_ID_DUPLICATE_OR_EMPTY');
  leadMap.set(id,l);
 }
 const seen=new Set();
 const items=rows.map((r,index)=>{
  const [transferId,createdAt,updatedAt,status,leadId,recipientName,
   reason,transferredAt,comment,clientRequestId,masterId]=r;
  if(!transferId||!transferId.trim()||transferId!==transferId.trim()||transferId.length>100||seen.has(transferId))fail('TRANSFER_ID_DUPLICATE_OR_EMPTY');
  seen.add(transferId);
  if(!leadId||leadId!==leadId.trim()||leadId.length>100||!leadMap.has(leadId))fail('SOURCE_LEAD_ORPHAN');
  const l=leadMap.get(leadId);
  if(l[3]!=='transferred'||l[15]!==transferId)fail('SOURCE_LEAD_TRANSFER_INCONSISTENT');
  if(!['active','archived'].includes(status)||!REASONS.has(reason))fail('ENUM_MISMATCH');
  if(!recipientName||!recipientName.trim()||recipientName.length>300||comment.length>5000||
      clientRequestId.length>100||masterId.length>100)fail('FIELD_LENGTH');
  if(![createdAt,updatedAt,transferredAt].every(dateValid))fail('SOURCE_DATE');
  const row=[transferId,leadId,masterId,clientRequestId,recipientName,reason,
    comment,status,createdAt,updatedAt,transferredAt,sha(r)];
  return {index:index+2,row};
 });
 if(!receipt||typeof receipt!=='object')fail('RECEIPT_REQUIRED');
 if(!receipt.sourceSpreadsheetId||String(receipt.sourceSpreadsheetId).length<10||
     receipt.sourceSheet!=='LeadTransfers'||!dateValid(receipt.sourceModifiedAt)||
     typeof receipt.batchId!=='string'||!/^[A-Za-z0-9_.:-]{4,128}$/.test(receipt.batchId)||
     !Number.isInteger(receipt.expectedCount)||receipt.expectedCount!==items.length)
   fail('RECEIPT_INVALID');
 // Source digest binds TRANSFERS and Lead-link witness; raw PII never written to GitHub/logs.
 const sourceSha256=sha({transfers:rows,leadWitness:leadRows.map(l=>[l[0],l[3],l[15]])});
 if(receipt.expectedSourceSha256!==sourceSha256)fail('SOURCE_SHA_MISMATCH');
 return {items,batch:{
  id:receipt.batchId,sourceSpreadsheetId:receipt.sourceSpreadsheetId,
  sourceSheet:'LeadTransfers',sourceModifiedAt:receipt.sourceModifiedAt,
  sourceSha256,rowCount:items.length
 }};
}
/**
 * Never call against owner DB without a CURRENT independent approval and backup
 * receipt. CI explicitly uses a disposable local PostgreSQL connection.
 */
export async function importPreparedLegacyTransfers({pool,prepared,gate}){
 if(!gate?.explicitOwnerApproval||!gate?.independentlyRestorableBackupId||
    gate?.approvedBatchId!==prepared?.batch?.id||
    gate?.approvedSourceSha256!==prepared?.batch?.sourceSha256)
  fail('RELEASE_NOT_APPROVED_OR_BACKUP_MISSING');
 const b=prepared.batch,db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query('INSERT INTO mvp_history.crm_legacy_transfer_batches '+
   '(batch_id,source_spreadsheet_id,source_sheet,source_modified_at,source_sha256,row_count) '+
   'VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(batch_id) DO NOTHING',
   [b.id,b.sourceSpreadsheetId,b.sourceSheet,b.sourceModifiedAt,b.sourceSha256,b.rowCount]);
  const existing=(await db.query('SELECT * FROM mvp_history.crm_legacy_transfer_batches WHERE batch_id=$1 FOR UPDATE',[b.id])).rows[0];
  if(!existing||existing.source_spreadsheet_id!==b.sourceSpreadsheetId||
     existing.source_sheet!==b.sourceSheet||
     new Date(existing.source_modified_at).toISOString()!==new Date(b.sourceModifiedAt).toISOString()||
     existing.source_sha256!==b.sourceSha256||existing.row_count!==b.rowCount)
   fail('BATCH_COLLISION');
  for(const {row} of prepared.items){
   await db.query('INSERT INTO mvp_history.crm_legacy_lead_transfers '+
    '(source_transfer_id,source_lead_id,source_master_id,source_client_request_id,'+
    'recipient_name,reason,comment,source_status,created_at_source,updated_at_source,'+
    'transferred_at_source,row_sha256,transferred_at,batch_id) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14) '+
    'ON CONFLICT(source_transfer_id) DO NOTHING',
    [...row,row[10],b.id]);
   const one=(await db.query('SELECT row_sha256,batch_id,source_lead_id FROM '+
    'mvp_history.crm_legacy_lead_transfers WHERE source_transfer_id=$1 FOR UPDATE',[row[0]])).rows[0];
   if(!one||one.row_sha256!==row[11]||one.batch_id!==b.id||one.source_lead_id!==row[1])
    fail('ROW_ID_COLLISION');
  }
  const count=(await db.query('SELECT count(*)::int AS n FROM '+
   'mvp_history.crm_legacy_lead_transfers WHERE batch_id=$1',[b.id])).rows[0]?.n;
  if(count!==b.rowCount)fail('READBACK_COUNT_MISMATCH');
  await db.query('COMMIT');
  return {batchId:b.id,importedOrVerified:count,sourceSha256:b.sourceSha256};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
 finally{db.release();}
}
