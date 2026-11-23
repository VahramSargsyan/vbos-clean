/**
 * CRM historical archive browser (READ ONLY).
 * Carries legacy IDs and verified source provenance, never inserts/updates
 * native CRM entities or treats a shadow extra as a live Google record.
 * Owner authentication and immutable history batch gate are mandatory.
 */
import {verifyHistoricalArchiveBatch} from './domains/finance/history-orders-api.mjs';

export class CrmHistoricalArchiveError extends Error {
 constructor(status,code){super(code);this.status=status;this.code=code;this.name='CrmHistoricalArchiveError';}
}
const fail=(status,code)=>{throw new CrmHistoricalArchiveError(status,code);};
const kinds=Object.freeze({
 leads:Object.freeze({kind:'LEAD',entity:'Leads',states:['new','contacted','qualified','won','lost','transferred','archived']}),
 clients:Object.freeze({kind:'CLIENT',entity:'Clients',states:['active','archived']}),
 objects:Object.freeze({kind:'OBJECT',entity:'Objects',states:['draft','planned']})
});
const sourceTag='FROZEN_LEGACY_CRM_ARCHIVE_ONLY';
const idOk=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(v);

export function parseHistoricalCrmQuery(url){
 if(!(url instanceof URL))fail(400,'INVALID_CRM_ARCHIVE_QUERY');
 const type=url.searchParams.get('type')||'leads',config=kinds[type];
 if(!config)fail(400,'INVALID_CRM_ARCHIVE_TYPE');
 const limitRaw=url.searchParams.get('limit')??'20';
 if(!/^[1-9][0-9]?$/.test(limitRaw)||Number(limitRaw)>50)fail(400,'INVALID_CRM_ARCHIVE_LIMIT');
 const q=(url.searchParams.get('q')||'').trim();
 if(q.length>80||/[\u0000-\u001f\u007f]/.test(q))fail(400,'INVALID_CRM_ARCHIVE_SEARCH');
 const status=url.searchParams.get('status')||'all';
 if(status!=='all'&&status!=='open'&&!config.states.includes(status))fail(400,'INVALID_CRM_ARCHIVE_STATUS');
 if(status==='open'&&type!=='leads')fail(400,'INVALID_CRM_ARCHIVE_STATUS');
 const cursor=url.searchParams.get('cursor')||'';
 if(cursor&&!idOk(cursor))fail(400,'INVALID_CRM_ARCHIVE_CURSOR');
 return {type,config,limit:Number(limitRaw),q,status,cursor};
}

/** Matches original legacy list searches: names, telephone, address, work needs and original IDs. */
export async function historicalCrmArchivePage(db,url,{authorizeOwner,batchId}={}){
 await verifyHistoricalArchiveBatch(db,authorizeOwner,batchId);
 const {type,config,limit,q,status,cursor}=parseHistoricalCrmQuery(url);
 const args=[batchId,config.kind,config.entity,q,status,cursor,limit+1];
 const query=`
SELECT r.source_id AS legacy_id,r.source_system,r.original_status AS status,
       r.client_source_id AS legacy_client_id,
       r.object_source_id AS legacy_object_id,
       r.lead_source_id AS legacy_lead_id,
       COALESCE(NULLIF(r.source_payload->>'name',''),NULLIF(r.source_payload->>'title',''),'') AS title,
       COALESCE(r.source_payload->>'phone','') AS phone,
       COALESCE(r.source_payload->>'address','') AS address,
       COALESCE(r.source_payload->>'needSummary',r.source_payload->>'need_summary','') AS need_summary,
       COALESCE(r.source_payload->>'notes','') AS notes,
       COALESCE(r.source_payload->>'objectType',r.source_payload->>'object_type','') AS object_type,
       COALESCE(r.source_payload->>'createdAt',r.source_payload->>'created_at','') AS created_at_source,
       COALESCE(r.source_payload->>'updatedAt',r.source_payload->>'updated_at','') AS updated_at_source,
       COALESCE(c.source_payload->>'name','') AS client_name,
       COALESCE(l.source_payload->>'name','') AS lead_name,
       m.target_id IS NOT NULL AS native_link_verified,
       r.payload_sha256=encode(sha256(convert_to(r.source_payload::text,'UTF8')),'hex') AS hash_valid
FROM mvp_history.source_records r
LEFT JOIN mvp_history.source_records c
 ON c.import_batch_id=r.import_batch_id AND c.source_kind='CLIENT' AND c.source_id=r.client_source_id
LEFT JOIN mvp_history.source_records l
 ON l.import_batch_id=r.import_batch_id AND l.source_kind='LEAD' AND l.source_id=r.lead_source_id
LEFT JOIN public.mvp_legacy_import_map m
 ON m.source_id=r.source_id AND m.source_entity=$3
 AND m.source_system='Working IP APP / M8C cutover baseline'
WHERE r.import_batch_id=$1 AND r.source_kind=$2
 AND (
  $5='all' OR r.original_status=$5
  OR ($5='open' AND r.original_status=ANY(ARRAY['new','contacted','qualified']::text[]))
 )
 AND (
  $4='' OR strpos(lower(r.source_id),lower($4))>0
  OR strpos(lower(COALESCE(r.source_payload->>'name',r.source_payload->>'title','')),lower($4))>0
  OR strpos(lower(COALESCE(r.source_payload->>'phone','')),lower($4))>0
  OR strpos(lower(COALESCE(r.source_payload->>'address','')),lower($4))>0
  OR strpos(lower(COALESCE(r.source_payload->>'needSummary',r.source_payload->>'need_summary','')),lower($4))>0
  OR strpos(lower(COALESCE(c.source_payload->>'name','')),lower($4))>0
 )
 AND ($6='' OR r.source_id<$6)
ORDER BY r.source_id DESC LIMIT $7`;
 const result=await db.query(query,args),rows=result.rows||[];
 if(rows.some(r=>r.hash_valid!==true||!['LEGACY_GOOGLE','OFFICIAL_SHADOW_EXTRA'].includes(r.source_system)))
  fail(503,'CRM_ARCHIVE_INTEGRITY_ERROR');
 const items=rows.slice(0,limit).map(row=>{
  const {hash_valid,...safe}=row;
  return Object.freeze({...safe,readonly:true,shadowOnly:row.source_system==='OFFICIAL_SHADOW_EXTRA'});
 });
 const hasMore=rows.length>limit;
 return Object.freeze({version:'CRM_HISTORICAL_BROWSER_V1',source:sourceTag,readonly:true,
  operational:false,sourceBatchState:'STAGED',type,status,q,limit,items,hasMore,
  nextCursor:hasMore?items.at(-1)?.legacy_id:null});
}
