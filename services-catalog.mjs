import {createHash} from 'node:crypto';
import {mastersServicesAuthority,requireMastersServicesAuthority} from './masters-authority.mjs';
import {REFERENCE_BATCH,REFERENCE_SOURCE_MANIFEST,REFERENCE_SOURCE_MODIFIED,ACTION_LABELS} from './service-reference.mjs';
export const SERVICE_UNITS=['job','item','point','meter','square_meter','hour','day','visit','other'];
const statuses=['active','archived'],sid=/^SRV-[0-9]{4}-[0-9]{4,}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bad=(E,m)=>{throw new E(400,m);};
const str=(v,max,E,required=false)=>{
 if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))bad(E,'Проверь формат поля услуги.');
 const s=v.trim();if(required&&!s)bad(E,'Заполни обязательные поля.');return s;
};
export function servicePayload(p,E){
 if(!p||typeof p!=='object'||Array.isArray(p))bad(E,'Неверная карточка услуги.');
 if(Object.keys(p).some(k=>!['serviceId','revision','status','category','serviceName','defaultUnit','notes','actionCode'].includes(k)))bad(E,'Неизвестное поле услуги.');
 const serviceId=str(p.serviceId??'',128,E),revision=p.revision??null;
 if(serviceId&&!sid.test(serviceId))bad(E,'Неверный ID.');
 if(serviceId?(!Number.isInteger(revision)||revision<1||revision>2147483646):revision!==null)bad(E,'Неверная версия.');
 const status=p.status??'active',defaultUnit=p.defaultUnit,actionCode=p.actionCode||null;
 if(!statuses.includes(status)||!SERVICE_UNITS.includes(defaultUnit)||(actionCode!==null&&!Object.hasOwn(ACTION_LABELS,actionCode)))bad(E,'Проверь статус, единицу и вид работ.');
 const category=str(p.category??'',200,E,true),serviceName=str(p.serviceName??'',300,E,true);
 if(/[\r\n\t]/.test(category+serviceName))bad(E,'Название и категория должны быть одной строкой.');
 return {serviceId,revision,status,category,serviceName,defaultUnit,notes:str(p.notes??'',5000,E),actionCode};
}
async function verifiedSnapshot(db,E){
 const r=await db.query("SELECT 1 FROM public.mvp_service_reference_batches b WHERE b.batch_id=$1 AND b.manifest_sha256=$2 AND b.source_modified_at=$3::timestamptz AND b.source_system='LEGACY_GOOGLE_VBOS' AND b.status='VERIFIED' AND b.services_count=37 AND b.prices_count=1 AND (SELECT count(*) FROM public.mvp_services_reference s WHERE s.batch_id=b.batch_id)=37 AND (SELECT count(*) FROM public.mvp_master_prices_reference p WHERE p.batch_id=b.batch_id)=1",[REFERENCE_BATCH,REFERENCE_SOURCE_MANIFEST,REFERENCE_SOURCE_MODIFIED]);
 if(r.rows.length!==1)throw new E(503,'Исторический снимок услуг не подтверждён.');
}
const ts=x=>x instanceof Date?x.toISOString():x??null;
const item=r=>({serviceId:r.service_id,status:r.status,category:r.category,serviceName:r.service_name,defaultUnit:r.default_unit,notes:r.notes??'',actionCode:r.action_code??null,revision:r.revision??null,createdAt:ts(r.created_at),updatedAt:ts(r.updated_at)});
export async function servicesCatalogRead({pool,url,AppError:E}){
 const p=url.searchParams,q=str(p.get('q')??'',80,E),status=p.get('status')??'active',category=str(p.get('category')??'',200,E),action=p.get('action')??'',limit=Number(p.get('limit')??'50');
 if(!['',...statuses].includes(status)||!Number.isInteger(limit)||limit<1||limit>50||(action&&!Object.hasOwn(ACTION_LABELS,action)&&action!=='unclassified'))bad(E,'Неверный фильтр.');
 const state=await mastersServicesAuthority(pool);
 if(state.phase==='CLEAN'&&!state.writeEnabled)throw new E(503,'Подтверждение текущего каталога недоступно.');
 const live=state.writeEnabled===true;
 if(!live)await verifiedSnapshot(pool,E);
 const scope=[live?'CLEAN':'SNAPSHOT',q,status,category,action],raw=p.get('cursor')??'';
 let cursor='';
 if(raw){try{if(raw.length>1800||!/^[A-Za-z0-9_-]+$/.test(raw))throw Error('cursor');const x=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));if(!Array.isArray(x)||x.length!==6||scope.some((v,i)=>x[i]!==v)||!sid.test(x[5]))throw Error('cursor');cursor=x[5];}catch{bad(E,'Страница услуг устарела.');}}
 const table=live?'public.mvp_services_catalog':'public.mvp_services_reference',args=[q,status,category,action,cursor,limit+1];
 if(!live)args.push(REFERENCE_BATCH);
 const rows=(await pool.query('SELECT service_id,status,category,service_name,default_unit,notes,action_code,created_at,updated_at,'+(live?'revision':'NULL::integer AS revision')+' FROM '+table+' WHERE '+(live?'true':'batch_id=$7')+" AND ($1='' OR strpos(lower(concat_ws(' ',service_name,category,service_id,notes)),lower($1))>0) AND ($2='' OR status=$2) AND ($3='' OR category=$3) AND ($4='' OR action_code=$4 OR ($4='unclassified' AND action_code IS NULL)) AND ($5='' OR service_id>$5) ORDER BY service_id LIMIT $6",args)).rows;
 const categories=(await pool.query('SELECT DISTINCT category FROM '+table+(live?'':' WHERE batch_id=$1')+' ORDER BY category',live?[]:[REFERENCE_BATCH])).rows.map(r=>r.category);
 const items=rows.slice(0,limit).map(item),hasMore=rows.length>limit;
 return {items,categories,hasMore,nextCursor:hasMore?Buffer.from(JSON.stringify([...scope,items.at(-1).serviceId])).toString('base64url'):null,authority:state.phase,writeEnabled:live,source:live?'CLEAN_SERVICES_CATALOG':'VERIFIED_LEGACY_SNAPSHOT',sourceModifiedAt:live?null:REFERENCE_SOURCE_MODIFIED};
}
export async function servicesCatalogSave({pool,p,key,AppError:E}){
 if(typeof key!=='string'||!uuid.test(key))bad(E,'Неверный ключ сохранения.');
 const v=servicePayload(p,E),hash=createHash('sha256').update(JSON.stringify(v)).digest('hex'),db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");
  await requireMastersServicesAuthority(db,E);
  await db.query('LOCK TABLE public.mvp_services_catalog IN SHARE ROW EXCLUSIVE MODE');
  const prior=(await db.query('SELECT payload_sha256,response FROM public.mvp_services_catalog_requests WHERE request_key=$1 FOR UPDATE',[key])).rows[0];
  if(prior){if(prior.payload_sha256!==hash||!prior.response)throw new E(409,'Ключ уже использован. Проверь карточку.');await db.query('COMMIT');return prior.response;}
  const old=v.serviceId?(await db.query('SELECT revision FROM public.mvp_services_catalog WHERE service_id=$1 FOR UPDATE',[v.serviceId])).rows[0]:null;
  if(v.serviceId&&!old)throw new E(404,'Услуга не найдена.');
  if(old&&Number(old.revision)!==v.revision)throw new E(409,'Услуга изменилась. Обнови карточку.');
  if(v.status==='active'){
   const dup=(await db.query("SELECT service_id FROM public.mvp_services_catalog WHERE status='active' AND service_id<>$1 AND lower(regexp_replace(btrim(category),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim($2::text),'[[:space:]]+',' ','g')) AND lower(regexp_replace(btrim(service_name),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim($3::text),'[[:space:]]+',' ','g')) LIMIT 1",[v.serviceId,v.category,v.serviceName])).rows;
   if(dup.length)throw new E(409,'Услуга с таким названием в категории уже существует.');
  }
  let id=v.serviceId;
  if(!id){const seq=(await db.query("INSERT INTO public.mvp_services_catalog_sequences(year,last_value) VALUES(extract(year FROM now() AT TIME ZONE 'Asia/Yerevan')::int,1) ON CONFLICT(year) DO UPDATE SET last_value=public.mvp_services_catalog_sequences.last_value+1 RETURNING year,last_value")).rows[0];id='SRV-'+seq.year+'-'+String(seq.last_value).padStart(4,'0');}
  const vals=[id,v.status,v.category,v.serviceName,v.defaultUnit,v.notes,v.actionCode,key];
  const saved=(await db.query(old?'UPDATE public.mvp_services_catalog SET status=$2,category=$3,service_name=$4,default_unit=$5,notes=$6,action_code=$7,client_request_id=$8,revision=revision+1,updated_at=now() WHERE service_id=$1 AND revision=$9 RETURNING *':'INSERT INTO public.mvp_services_catalog(service_id,status,category,service_name,default_unit,notes,action_code,client_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',old?[...vals,v.revision]:vals)).rows[0];
  if(!saved)throw new E(409,'Услуга изменилась.');
  const result={entityId:id,data:item(saved)};
  await db.query('INSERT INTO public.mvp_services_catalog_requests(request_key,payload_sha256,response) VALUES($1,$2,$3::jsonb)',[key,hash,JSON.stringify(result)]);
  await db.query('COMMIT');return result;
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(e?.code==='23505')throw new E(409,'Услуга или её ID уже существует.');throw e;}finally{db.release();}
}
