// VBOS Clean V12: immutable legacy Services and master-specific MasterPrices mirror.
// Never writes canonical source, operational WorkLogs, wages, Estimator or finance.
export class ReferenceCatalogError extends Error {
 constructor(status,code){super(code);this.status=status;this.code=code;this.name='ReferenceCatalogError';}
}
const fail=(status,code)=>{throw new ReferenceCatalogError(status,code);};
export const REFERENCE_BATCH='SERVICES_MASTERPRICES_V12_TEST_20261105_R1';
export const REFERENCE_SOURCE_MANIFEST='fc85e0e51751b50c689fceaba8d6c273706a25e577e798df3e886deef3a8d674';
export const REFERENCE_SOURCE_MODIFIED='2026-11-03T19:06:09.263Z';
export const ACTION_LABELS=Object.freeze({
 MOUNT:'Монтаж',INSTALL:'Установка',DISMANTLE:'Демонтаж',CONNECT:'Подключение',
 REPAIR:'Ремонт',DIAGNOSE:'Диагностика',PREPARE:'Подготовка',CLEANUP:'Уборка',
 LOGISTICS:'Перенос / подъём',OTHER:'Другое'
});
function parse(url){
 if(!(url instanceof URL))fail(400,'INVALID_REFERENCE_QUERY');
 const limitText=url.searchParams.get('limit')??'20';
 if(!/^[1-9][0-9]?$/.test(limitText)||Number(limitText)>50)fail(400,'INVALID_REFERENCE_LIMIT');
 const q=(url.searchParams.get('q')??'').trim();
 if(q.length>80||/[\u0000-\u001f\u007f]/.test(q))fail(400,'INVALID_REFERENCE_SEARCH');
 const action=url.searchParams.get('action')??'';
 if(action!==''&&action!=='unclassified'&&!Object.hasOwn(ACTION_LABELS,action))fail(400,'INVALID_REFERENCE_ACTION');
 const cursor=url.searchParams.get('cursor')||'';
 if(cursor&&!/^[A-Za-z0-9_-]{3,128}$/.test(cursor))fail(400,'INVALID_REFERENCE_CURSOR');
 return {q,action,cursor,limit:Number(limitText)};
}
async function sourceGate(db,authorizeOwner,batchId){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)fail(401,'OWNER_SESSION_REQUIRED');
 if(!db||typeof db.query!=='function')fail(500,'REFERENCE_DATABASE_NOT_CONFIGURED');
 if(batchId!==REFERENCE_BATCH)fail(503,'REFERENCE_BATCH_NOT_CONFIGURED');
 const got=await db.query(`SELECT b.batch_id,b.source_system,b.services_count,b.prices_count
 FROM public.mvp_service_reference_batches b
 WHERE b.batch_id=$1 AND b.source_system='LEGACY_GOOGLE_VBOS' AND b.status='VERIFIED'
  AND b.manifest_sha256=$2 AND b.source_modified_at=$3::timestamptz
  AND (SELECT count(*) FROM public.mvp_services_reference s WHERE s.batch_id=b.batch_id)=b.services_count
  AND (SELECT count(*) FROM public.mvp_master_prices_reference p WHERE p.batch_id=b.batch_id)=b.prices_count`,[batchId,REFERENCE_SOURCE_MANIFEST,REFERENCE_SOURCE_MODIFIED]);
 const row=got.rows?.[0];
 if(got.rows?.length!==1||row?.services_count!==37||row?.prices_count!==1)
  fail(503,'REFERENCE_IMPORT_NOT_VERIFIED');
}
export async function referenceCatalogPage(db,url,{authorizeOwner,batchId=REFERENCE_BATCH}={}){
 await sourceGate(db,authorizeOwner,batchId);
 const {q,action,cursor,limit}=parse(url);
 const values=[batchId,q,action,cursor,limit+1];
 const sql=`SELECT s.service_id AS "serviceId",s.status,s.category,
 s.service_name AS "serviceName",s.default_unit AS "defaultUnit",s.action_code AS "actionCode",
 p.prices AS "masterPrices"
 FROM public.mvp_services_reference s
 LEFT JOIN LATERAL (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'masterPriceId',mp.master_price_id,'masterId',mp.master_id,'priceType',mp.price_type,
   'priceFrom',mp.price_from::text,'priceTo',mp.price_to::text,'currency',mp.currency,
   'unit',mp.unit,'validFrom',mp.valid_from::text
  ) ORDER BY mp.master_price_id),'[]'::jsonb) AS prices
  FROM public.mvp_master_prices_reference mp
  WHERE mp.batch_id=s.batch_id AND mp.service_id=s.service_id AND mp.status='active'
 ) p ON true
 WHERE s.batch_id=$1 AND s.status='active'
 AND ($2='' OR strpos(lower(s.service_name),lower($2))>0
   OR strpos(lower(s.category),lower($2))>0
   OR strpos(lower(s.service_id),lower($2))>0)
 AND ($3='' OR ($3='unclassified' AND s.action_code IS NULL) OR s.action_code=$3)
 AND ($4='' OR s.service_id>$4)
 ORDER BY s.service_id ASC LIMIT $5`;
 const result=await db.query(sql,values),all=result.rows??[],items=all.slice(0,limit).map(x=>({...x,masterPrices:x.masterPrices||[]}));
 return Object.freeze({
  readonly:true,source:'LEGACY_GOOGLE_REFERENCE_SNAPSHOT_NOT_AUTHORITY',batchId,
  items,limit,query:q,action,hasMore:all.length>limit,
  nextCursor:all.length>limit?items.at(-1)?.serviceId:null,
  expectedServices:37,expectedMasterPrices:1,sourceModifiedAt:REFERENCE_SOURCE_MODIFIED,
  actionLabels:ACTION_LABELS,
  notice:'Расценки указаны конкретным мастером и не являются общими тарифами или фактическими доходами.'
 });
}
