/**
 * CRM25 private legacy Masters importer. Historical rows remain read-only in Clean.
 * The explicit owner gate is a defense-in-depth precondition, not an authorization
 * to execute this code against the user's database from an ordinary chat task.
 */
import {createHash} from 'node:crypto';

export const MASTERS_HEADER=Object.freeze([
 'masterId','createdAt','updatedAt','status','name','phone','email','serviceArea',
 'notes','clientRequestId','qualityTier','messengerType','messengerContact'
]);
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=x=>{throw new Error('CRM25_IMPORT_GATE:'+x);};
const iso=x=>typeof x==='string'&&x.length<=80&&
 /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)&&
 Number.isFinite(Date.parse(x));
const STATUS=new Set(['active','unavailable','archived']);
const QUALITY=new Set(['','good','normal','problematic']);
const MESSENGER=new Set(['whatsapp','viber','telegram','other','none']);
export function prepareLegacyMasters({masters,receipt}){
 if(!Array.isArray(masters)||JSON.stringify(masters[0])!==JSON.stringify(MASTERS_HEADER)||
    masters.length>101)fail('HEADER_OR_SOURCE_BOUNDS');
 const rows=masters.slice(1).filter(r=>Array.isArray(r)&&r.some(x=>x!==''&&x!=null)).map(r=>{
  if(r.length>MASTERS_HEADER.length)fail('COLUMN_COUNT');
  return MASTERS_HEADER.map((_,i)=>String(r[i]??''));
 });
 if(rows.length!==5)fail('SOURCE_COUNT_CHANGED');
 const seen=new Set();
 for(const r of rows){
  if(!r[0]||r[0]!==r[0].trim()||r[0].length>100||seen.has(r[0]))
   fail('MASTER_ID_INVALID_OR_DUPLICATE');
  seen.add(r[0]);
  if(!iso(r[1])||!iso(r[2])||!STATUS.has(r[3])||
     !r[4].trim()||r[4].length>300||
     r[5].length>100||r[6].length>200||r[7].length>500||
     r[8].length>5000||r[9].length>160||!QUALITY.has(r[10])||
     !MESSENGER.has(r[11]||'none')||r[12].length>300)
   fail('SOURCE_FIELDS_INVALID');
  // Preserve original blanks; PG's explicit NOT NULL default applies to source nulls only.
 }
 if(!receipt||receipt.sourceSheet!=='Masters'||!iso(receipt.sourceModifiedAt)||
    typeof receipt.sourceSpreadsheetId!=='string'||receipt.sourceSpreadsheetId.length<10||
    typeof receipt.batchId!=='string'||!/^[A-Za-z0-9_.:-]{4,128}$/.test(receipt.batchId)||
    receipt.expectedCount!==5)fail('SOURCE_RECEIPT_INVALID');
 const sourceSha256=sha({masters:rows,sourceSheet:'Masters'});
 if(receipt.expectedSourceSha256!==sourceSha256)fail('SOURCE_DIGEST_MISMATCH');
 return {rows:rows.map(x=>[...x,sha(x)]),
  receipt:{...receipt,sourceSha256}};
}
export async function importPreparedLegacyMasters({pool,prepared,gate}){
 const r=prepared?.receipt;
 if(gate?.explicitOwnerApproval!==true||!gate.independentlyRestorableBackupId||
    gate.approvedBatchId!==r?.batchId||gate.approvedSourceSha256!==r?.sourceSha256||
    gate.approvedSourceModifiedAt!==r?.sourceModifiedAt)
  fail('RELEASE_AUTHORIZATION_OR_BACKUP_MISSING');
 const receiptId='CRM25-'+r.sourceSha256.slice(0,40);
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query('INSERT INTO mvp_history.crm_legacy_master_receipts '+
   '(receipt_id,source_spreadsheet_id,source_sheet,source_modified_at,source_sha256,row_count) '+
   "VALUES($1,$2,'Masters',$3::timestamptz,$4,5) ON CONFLICT DO NOTHING",
   [receiptId,r.sourceSpreadsheetId,r.sourceModifiedAt,r.sourceSha256]);
  const proof=(await db.query(
   'SELECT receipt_id,source_spreadsheet_id,source_sheet,source_modified_at,source_sha256,row_count '+
   'FROM mvp_history.crm_legacy_master_receipts WHERE receipt_id=$1 FOR UPDATE',[receiptId])).rows[0];
  if(!proof||proof.source_spreadsheet_id!==r.sourceSpreadsheetId||
     proof.source_sheet!=='Masters'||proof.source_sha256!==r.sourceSha256||
     new Date(proof.source_modified_at).toISOString()!==new Date(r.sourceModifiedAt).toISOString()||
     Number(proof.row_count)!==5)fail('RECEIPT_COLLISION');
  for(const row of prepared.rows){
   // A distinct canonical UUID is always assigned by the DB. Do not coerce legacy IDs.
   await db.query('INSERT INTO public.mvp_crm_masters '+
    '(source_system,source_master_id,source_created_at,source_updated_at,status,name,phone,'+
    'email,service_area,notes,source_client_request_id,quality_tier,messenger_type,'+
    'messenger_contact,row_sha256,legacy_receipt_id) '+
    "VALUES('LEGACY_GOOGLE',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) "+
    'ON CONFLICT(source_master_id) DO NOTHING',
    [row[0],row[1],row[2],row[3],row[4],row[5],row[6],row[7],row[8],
     row[9],row[10],row[11]||'none',row[12],row[13],receiptId]);
   const item=(await db.query(
    'SELECT source_system,source_master_id,row_sha256,legacy_receipt_id,source_client_request_id '+
    'FROM public.mvp_crm_masters WHERE source_master_id=$1 FOR UPDATE',[row[0]])).rows[0];
   if(!item||item.source_system!=='LEGACY_GOOGLE'||item.source_master_id!==row[0]||
      item.row_sha256!==row[13]||item.legacy_receipt_id!==receiptId||
      item.source_client_request_id!==row[9])
    fail('MASTER_SOURCE_ID_COLLISION');
  }
  const cnt=(await db.query(
   "SELECT count(*)::int n FROM public.mvp_crm_masters WHERE source_system='LEGACY_GOOGLE' AND legacy_receipt_id=$1",
   [receiptId])).rows[0]?.n;
  if(cnt!==5)fail('READBACK_COUNT_MISMATCH');
  await db.query('COMMIT');
  return {receiptId,sourceSha256:r.sourceSha256,verifiedRows:cnt};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
 finally{db.release();}
}
