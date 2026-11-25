// WorkLog compatibility only; the historical V12 API and immutable snapshot are unchanged.
import {mastersServicesAuthority} from './masters-authority.mjs';
import {REFERENCE_BATCH,REFERENCE_SOURCE_MANIFEST,REFERENCE_SOURCE_MODIFIED} from './service-reference.mjs';

async function sourceTx(db,E){
 const schema=(await db.query("SELECT to_regclass('public.mvp_masters_services_authority') IS NOT NULL AS authority_exists,to_regclass('public.mvp_services_catalog') IS NOT NULL AS catalog_exists,to_regclass('public.mvp_master_prices_catalog') IS NOT NULL AS prices_exists")).rows[0];
 if(!schema)throw new E(503,'Источник услуг не подтверждён.');
 if(schema.authority_exists){
  const state=await mastersServicesAuthority(db,{lock:true});
  if(state.phase==='CLEAN'){
   if(!state.writeEnabled||!schema.catalog_exists||!schema.prices_exists)throw new E(503,'Текущий каталог услуг не подтверждён.');
   return 'CLEAN';
  }
  if(state.phase!=='LEGACY')throw new E(503,'Источник услуг не подтверждён.');
 }else if(schema.catalog_exists||schema.prices_exists){
  throw new E(503,'Управление каталогом услуг отсутствует.');
 }
 const verified=await db.query("SELECT 1 FROM public.mvp_service_reference_batches b WHERE b.batch_id=$1 AND b.manifest_sha256=$2 AND b.source_modified_at=$3::timestamptz AND b.source_system='LEGACY_GOOGLE_VBOS' AND b.status='VERIFIED' AND b.services_count=37 AND b.prices_count=1 AND (SELECT count(*) FROM public.mvp_services_reference s WHERE s.batch_id=b.batch_id)=37 AND (SELECT count(*) FROM public.mvp_master_prices_reference p WHERE p.batch_id=b.batch_id)=1",[REFERENCE_BATCH,REFERENCE_SOURCE_MANIFEST,REFERENCE_SOURCE_MODIFIED]);
 if(verified.rows.length!==1)throw new E(503,'Исторический справочник услуг не подтверждён.');
 return 'LEGACY';
}

export async function readWorkLogServiceReferences(pool,E){
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SET LOCAL lock_timeout='5s'");
  const source=await sourceTx(db,E);
  const rows=(await db.query('SELECT service_id,service_name,category,action_code,status FROM '+(source==='CLEAN'?'public.mvp_services_catalog':'public.mvp_services_reference WHERE batch_id=$1')+' ORDER BY category,service_name,service_id LIMIT 201',source==='CLEAN'?[]:[REFERENCE_BATCH])).rows;
  await db.query('COMMIT');
  return {rows,unavailable:false};
 }catch(err){
  await db.query('ROLLBACK').catch(()=>{});
  // A missing/invalid service reference must not hide unrelated state or return stale choices.
  if(err?.status===503||['42P01','42703','55P03'].includes(err?.code))return {rows:[],unavailable:true};
  throw err;
 }finally{db.release();}
}

export async function requireActiveWorkLogServiceTx(db,serviceId,E){
 if(!serviceId)return;
 let source;
 try{source=await sourceTx(db,E);}
 catch(err){if(!['42P01','42703','55P03'].includes(err?.code))throw err;throw new E(503,'Источник услуг недоступен.');}
 // Lock the canonical row through the WorkLog commit so an archive cannot race validation.
 const r=await db.query(source==='CLEAN'?
  "SELECT service_id FROM public.mvp_services_catalog WHERE service_id=$1 AND status='active' LIMIT 1 FOR SHARE":
  "SELECT service_id FROM public.mvp_services_reference WHERE service_id=$1 AND status='active' AND batch_id=$2 LIMIT 1",
  source==='CLEAN'?[serviceId]:[serviceId,REFERENCE_BATCH]);
 if(!r.rowCount)throw new E(409,'Услуга не найдена в активном проверенном справочнике.');
}
