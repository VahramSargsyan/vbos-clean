/**
 * CRM-23A: read-only historical Interactions. Original data stays in private
 * Neon archive, never in GitHub/native CRM journal. Owner-cookie route only.
 * REL|LeadClientPending markers are NOT final Client identity evidence.
 */
export const LEGACY_COUNTS=Object.freeze({all:30,activity:15,final:5,pending:10,leads:33,clients:17});
const HISTORY_COUNTS=Object.freeze({
 LEAD:33,CLIENT:17,OBJECT:19,WORKER:2,WORK_ORDER:22,
 CLIENT_ASSESSMENT:13,WORKER_ASSIGNMENT:1,FINANCE_TRANSACTION:24
});
const SYSTEM='Working IP APP / M8C cutover baseline';
const f=(E,status,message)=>{throw new E(status,message);};
const str=x=>x==null?'':String(x);
const finalRe=/^REL\|LeadClient\|([^|]+)\|([^|]+)$/;
const pendingRe=/^REL\|LeadClientPending\|([^|]+)\|([^|]+)$/;
export function classifyLegacyInteraction(x){
 const request=str(x.clientRequestId);
 const match=finalRe.exec(request)||pendingRe.exec(request);
 if(request.startsWith('REL|')&&!match)throw Error('UNKNOWN_LEGACY_RELATION');
 const kind=match?(request.startsWith('REL|LeadClientPending|')?'RELATION_PENDING':'RELATION_FINAL'):'ACTIVITY';
 if(!x.interactionId||!x.entityId||!['Lead','Client'].includes(x.entityType)||
    !['active','archived'].includes(x.status)||
    !['call','message','meeting','site_visit','note','other'].includes(x.interactionType)||
    !Number.isFinite(Date.parse(x.createdAt))||!Number.isFinite(Date.parse(x.updatedAt)))
  throw Error('INVALID_LEGACY_INTERACTION');
 if(match&&(x.entityType!=='Lead'||x.entityId!==match[1]))
  throw Error('LEGACY_RELATION_SCOPE_CONFLICT');
 return {kind,leadId:match?.[1]||'',clientId:match?.[2]||''};
}
export function countLegacyRows(rows,leads,clients){
 const ids=new Set(),leadSet=new Set(leads),clientSet=new Set(clients);
 const counts={all:0,activity:0,final:0,pending:0};
 for(const row of rows){
  if(ids.has(row.interactionId))throw Error('DUPLICATE_INTERACTION_ID');
  ids.add(row.interactionId);
  const c=classifyLegacyInteraction(row);
  if(row.entityType==='Lead'&&!leadSet.has(row.entityId)||
     row.entityType==='Client'&&!clientSet.has(row.entityId)||
     c.kind!=='ACTIVITY'&&!clientSet.has(c.clientId))
    throw Error('UNKNOWN_LEGACY_PARENT');
  counts.all++;
  counts[c.kind==='ACTIVITY'?'activity':c.kind==='RELATION_FINAL'?'final':'pending']++;
 }
 return counts;
}
const receiptSql=[
 'SELECT r.receipt_id,r.history_batch_id,r.count_all,r.count_activity,',
 'r.count_relation_final,r.count_relation_pending,b.expected_counts,',
 'v.reconciled_counts FROM mvp_history.crm_legacy_interaction_receipts r',
 'JOIN mvp_history.import_batches b ON b.batch_id=r.history_batch_id',
 "JOIN mvp_history.batch_receipts v ON v.batch_id=b.batch_id AND v.receipt_kind='RECONCILED_IN_ISOLATED_TEST'",
 'AND v.verified_manifest_sha256=b.evidence_manifest_sha256',
 "WHERE r.status='VERIFIED' AND r.source_system='LEGACY_GOOGLE' AND r.source_sheet='Interactions'",
 'ORDER BY r.created_at DESC LIMIT 2'
].join(' ');
const rowsSql=[
 'SELECT source_id,entity_type,entity_id,record_kind,interaction_type,',
 'created_at,updated_at,original_status,summary,next_action,next_action_at,notes,',
 'client_request_id,row_sha256 FROM mvp_history.crm_legacy_interactions',
 'WHERE receipt_id=$1 ORDER BY created_at DESC,source_id DESC LIMIT 101'
].join(' ');
const clientsSql=[
 "SELECT source_id,target_id,source_payload->>'sourceLeadId' AS source_lead_id",
 'FROM public.mvp_legacy_import_map WHERE source_entity=$1 AND source_system=$2',
 'ORDER BY source_id LIMIT 501'
].join(' ');
const leadsSql=[
 "SELECT source_id FROM mvp_history.source_records WHERE source_kind='LEAD'",
 'AND import_batch_id=$1 ORDER BY source_id LIMIT 501'
].join(' ');
const unavailable=id=>({readonly:true,clientId:id,source:'LEGACY_GOOGLE_VERIFIED_READONLY',
 status:'NOT_IMPORTED',archiveActivities:null,unlinkedActivities:null,
 items:[],verifiedClientLinksOnly:true,nativeHistoryUnaffected:true});
const isCounts=x=>x&&Object.keys(x).length===8&&
 Object.entries(HISTORY_COUNTS).every(([k,v])=>Number(x[k])===v);
function archivedRow(r,E){
 const x={interactionId:str(r.source_id),entityType:str(r.entity_type),
  entityId:str(r.entity_id),status:str(r.original_status),
  interactionType:str(r.interaction_type),
  createdAt:r.created_at instanceof Date?r.created_at.toISOString():str(r.created_at),
  updatedAt:r.updated_at instanceof Date?r.updated_at.toISOString():str(r.updated_at),
  summary:str(r.summary),nextAction:str(r.next_action),
  nextActionAt:str(r.next_action_at),notes:str(r.notes),
  clientRequestId:str(r.client_request_id)};
 let c;
 try{c=classifyLegacyInteraction(x);}
 catch{f(E,503,'Повреждён исторический источник взаимодействий.');}
 if(c.kind!==r.record_kind||!x.interactionId||x.interactionId.length>128||
    x.summary.length>1000||x.notes.length>5000||x.nextAction.length>500||
    !/^[0-9a-f]{64}$/.test(r.row_sha256||''))
  f(E,503,'Исторические строки не прошли проверку.');
 return {...x,...c};
}
/** Read-only, caller is authenticated by server owner-cookie before invocation. */
export async function crmLegacyInteractionsForClient({pool,clientId,uuid,AppError}){
 const id=uuid(clientId);
 const exists=await pool.query('SELECT id FROM public.mvp_clients WHERE id=$1',[id]);
 if(!exists.rows.length)f(AppError,404,'Клиент не найден.');
 let receipt;
 try{receipt=await pool.query(receiptSql);}
 catch(e){if(['42P01','3F000'].includes(e?.code))return unavailable(id);throw e;}
 if(!receipt.rows.length)return unavailable(id);
 if(receipt.rows.length!==1)f(AppError,503,'Несколько неподтверждённых архивов контактов.');
 const r=receipt.rows[0];
 if(!isCounts(r.expected_counts)||!isCounts(r.reconciled_counts)||
    Number(r.count_all)!==30||Number(r.count_activity)!==15||
    Number(r.count_relation_final)!==5||Number(r.count_relation_pending)!==10)
  f(AppError,503,'Исторический архив не соответствует зафиксированным количествам.');
 const [old,mapped,leads]=await Promise.all([
  pool.query(rowsSql,[r.receipt_id]),
  pool.query(clientsSql,['Clients',SYSTEM]),
  pool.query(leadsSql,[r.history_batch_id])
 ]);
 if(old.rows.length!==30||mapped.rows.length!==17||leads.rows.length!==33)
  f(AppError,503,'В историческом архиве отсутствуют строки.');
 const knownLeads=new Set(leads.rows.map(x=>str(x.source_id)));
 if(knownLeads.size!==33)f(AppError,503,'Дубли исторических идентификаторов лидов.');
 const mappedClients=new Map(),links=new Map();
 function addLink(leadId,newId,stage){
  if(!links.has(leadId))links.set(leadId,new Map());
  const group=links.get(leadId);
  if(!group.has(newId))group.set(newId,stage);
 }
 for(const m of mapped.rows){
  const oldId=str(m.source_id),currentId=str(m.target_id),sourceLead=str(m.source_lead_id);
  if(!oldId||!currentId||mappedClients.has(oldId))f(AppError,503,'Дубликаты старых клиентов.');
  mappedClients.set(oldId,currentId);
  if(sourceLead){
   if(!knownLeads.has(sourceLead))f(AppError,503,'Исходный лид клиента не найден.');
   addLink(sourceLead,currentId,'before_client');
  }
 }
 const records=old.rows.map(x=>archivedRow(x,AppError));
 const kinds={ACTIVITY:0,RELATION_FINAL:0,RELATION_PENDING:0};
 for(const x of records){
  kinds[x.kind]++;
  if(x.entityType==='Lead'&&!knownLeads.has(x.entityId))
   f(AppError,503,'Найдено взаимодействие без исходного лида.');
  if(x.kind!=='ACTIVITY'){
   if(!knownLeads.has(x.leadId)||!mappedClients.has(x.clientId))
    f(AppError,503,'Ссылка на старый клиент/лид не подтверждена.');
   if(x.kind==='RELATION_FINAL')addLink(x.leadId,mappedClients.get(x.clientId),'repeat_lead');
  }
 }
 if(kinds.ACTIVITY!==15||kinds.RELATION_FINAL!==5||kinds.RELATION_PENDING!==10)
  f(AppError,503,'Служебные связи ошибочно включены в историю.');
 for(const group of links.values())
  if(group.size>1)f(AppError,503,'Один старый лид привязан к разным клиентам.');
 let unlinked=0;const items=[];
 for(const x of records){
  if(x.kind!=='ACTIVITY'||x.status==='archived')continue;
  let toId,stage;
  if(x.entityType==='Client'){
   toId=mappedClients.get(x.entityId);stage='after_client';
   if(!toId)f(AppError,503,'Контакт старого клиента не имеет подтверждённой карты.');
  }else{
   const group=links.get(x.entityId);
   if(!group){unlinked++;continue;}
   [[toId,stage]]=group;
  }
  if(toId!==id)continue;
  items.push({id:x.interactionId,source:'LEGACY_GOOGLE',readonly:true,
   historyStage:stage,interactionType:x.interactionType,
   createdAt:x.createdAt,contactOn:x.createdAt.slice(0,10),
   summary:x.summary,nextAction:x.nextAction,nextActionAt:x.nextActionAt,notes:x.notes,
   originalEntityType:x.entityType,originalEntityId:x.entityId});
 }
 items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
 return {readonly:true,clientId:id,source:'LEGACY_GOOGLE_VERIFIED_READONLY',
  status:'VERIFIED_READONLY',archiveActivities:15,unlinkedActivities:unlinked,
  items,verifiedClientLinksOnly:true,nativeHistoryUnaffected:true};
}
