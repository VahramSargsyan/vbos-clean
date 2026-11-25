/**
 * CRM-25A external Masters (not internal Workers) on canonical Clean PostgreSQL.
 * Legacy Google records require a separately approved guarded import and remain
 * read-only until the owner authorizes external-master authority cutover.
 */
import {createHash} from 'node:crypto';
import {mastersServicesAuthority,requireMastersServicesAuthority} from './masters-authority.mjs';
import {REFERENCE_BATCH,REFERENCE_SOURCE_MANIFEST,REFERENCE_SOURCE_MODIFIED} from './service-reference.mjs';
export const MASTER_STATUS=Object.freeze(['active','unavailable','archived']);
export const MASTER_QUALITY=Object.freeze(['','good','normal','problematic']);
export const MASTER_MESSENGER=Object.freeze(['whatsapp','viber','telegram','other','none']);
const invalid=(AppError,msg)=>{throw new AppError(400,msg);};
function plain(v,max,AppError,{required=false,label='Поле'}={}){
 if(typeof v!=='string')invalid(AppError,label+': нужен текст.');
 const s=v.trim();
 if((required&&!s)||s.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s))
  invalid(AppError,label+': неверное значение или длина.');
 return s;
}
function choice(v,allowed,AppError,label){
 if(typeof v!=='string'||!allowed.includes(v))invalid(AppError,label+': неизвестное значение.');
 return v;
}
export function masterPayload(p,AppError){
 return {
  name:plain(p.name,300,AppError,{required:true,label:'Имя мастера'}),
  phone:plain(p.phone??'',100,AppError,{label:'Телефон'}),
  email:plain(p.email??'',200,AppError,{label:'Email'}),
  serviceArea:plain(p.serviceArea??'',500,AppError,{label:'Регион работы'}),
  notes:plain(p.notes??'',5000,AppError,{label:'Примечания'}),
  status:choice(p.status??'active',MASTER_STATUS,AppError,'Статус'),
  qualityTier:choice(p.qualityTier??'',MASTER_QUALITY,AppError,'Качество'),
  messengerType:choice(p.messengerType??'none',MASTER_MESSENGER,AppError,'Мессенджер'),
  messengerContact:plain(p.messengerContact??'',300,AppError,{label:'Контакт мессенджера'})
 };
}
const digest=p=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
function rowFrom(p){
 return [p.name,p.phone,p.email,p.serviceArea,p.notes,p.status,p.qualityTier,p.messengerType,p.messengerContact];
}
// MS1.2: match the live M8B2 API phone contract; do not re-key imported records.
export function normalizeMasterPhone(raw,AppError){
 const compact=raw.replace(/[\s().-]+/g,'');
 if(!compact)return '';
 const bad=()=>invalid(AppError,'Телефон: укажи полный армянский или международный номер.');
 if(!/^(?:\+|00)?[0-9]+$/.test(compact))bad();
 const international=compact.startsWith('+')||compact.startsWith('00');
 const digits=compact.startsWith('+')?compact.slice(1):compact.startsWith('00')?compact.slice(2):compact;
 if(digits.startsWith('374')){
  if(digits.length!==11||(international&&digits.startsWith('3740')))bad();
  return '+'+digits;
 }
 if(international){
  if(digits.length<8||digits.length>15)bad();
  return '+'+digits;
 }
 if(digits.startsWith('0')&&digits.length===9)return '+374'+digits.slice(1);
 bad();
}
async function masterDuplicateGuard(db,phone,id,AppError){
 if(!phone)return;
 const found=(await db.query(
  "SELECT id FROM public.mvp_crm_masters WHERE status IN ('active','unavailable') "+
  "AND phone<>'' AND public.mvp_crm_phone_canonical(phone)=public.mvp_crm_phone_canonical($1::text) "+
  "AND ($2::uuid IS NULL OR id<>$2::uuid) LIMIT 1",[phone,id])).rows;
 if(found.length)throw new AppError(409,'Мастер с таким телефоном уже существует. Открой существующую карточку.');
}
export async function mastersAction({pool,type,p,key,uuid,safeRevision,AppError}){
 const raw=masterPayload(p,AppError);
 const creating=type==='crm_master_create';
 if(!creating&&type!=='crm_master_update')throw new AppError(400,'Неизвестное действие со справочником мастеров.');
 if(creating&&(p.masterId||p.sourceMasterId||p.sourceSystem))
  invalid(AppError,'Нельзя создавать мастера с чужим ID или происхождением.');
 const id=creating?null:uuid(p.masterId),revision=creating?null:safeRevision(p.revision);
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query("SET LOCAL lock_timeout='5s'");
  await requireMastersServicesAuthority(db,AppError);
  // Short table-scoped serialization of master writes only; reads remain available.
  await db.query('LOCK TABLE public.mvp_crm_masters IN SHARE ROW EXCLUSIVE MODE');
  if(creating){
   const previous=(await db.query('SELECT * FROM public.mvp_crm_masters WHERE request_key=$1 FOR UPDATE',[key])).rows[0];
   if(previous){
    // Retain exact replay of an old request hashed before phone normalization.
    const hashMatches=previous.payload_sha256===digest(raw)||
     previous.payload_sha256===digest({...raw,phone:normalizeMasterPhone(raw.phone,AppError)});
    if(!hashMatches)throw new AppError(409,'Этот ключ создания уже использован с другими данными.');
    await db.query('COMMIT');
    return {saved:true,item:previous,deduplicated:true,source:'CLEAN_CRM25_MASTER'};
   }
  }else{
   const old=(await db.query('SELECT source_system,revision FROM public.mvp_crm_masters WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!old)throw new AppError(404,'Мастер не найден.');
   if(!['CLEAN_NATIVE','LEGACY_GOOGLE'].includes(old.source_system))throw new AppError(409,'Неизвестное происхождение карточки мастера.');
   if(Number(old.revision)!==revision)throw new AppError(409,'Карточка мастера изменилась. Обнови страницу.');
  }
  const value={...raw,phone:normalizeMasterPhone(raw.phone,AppError)};
  await masterDuplicateGuard(db,value.phone,id,AppError);
  let item;
  if(creating){
   item=(await db.query('INSERT INTO public.mvp_crm_masters '+
    '(request_key,payload_sha256,name,phone,email,service_area,notes,status,quality_tier,messenger_type,messenger_contact) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) '+
    'ON CONFLICT(request_key) DO NOTHING RETURNING *',[key,digest(value),...rowFrom(value)])).rows[0];
  }else{
   item=(await db.query('UPDATE public.mvp_crm_masters SET '+
    'name=$3,phone=$4,email=$5,service_area=$6,notes=$7,status=$8,quality_tier=$9,'+
    'messenger_type=$10,messenger_contact=$11,revision=revision+1,updated_at=now() '+
    "WHERE id=$1 AND revision=$2 AND source_system IN ('CLEAN_NATIVE','LEGACY_GOOGLE') RETURNING *",
    [id,revision,...rowFrom(value)])).rows[0];
  }
  if(!item)throw new AppError(409,'Карточка мастера изменилась. Обнови страницу.');
  await db.query('COMMIT');
  return {saved:true,item,...(creating?{deduplicated:false}:{}),source:'CLEAN_CRM25_MASTER'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
 finally{db.release();}
}
// MS1/MS3: legacy snapshot until shared activation; then canonical price links.
const effectivePrice="p.status='active' AND coalesce(p.valid_from,(p.created_at AT TIME ZONE 'Asia/Yerevan')::date)<=(now() AT TIME ZONE 'Asia/Yerevan')::date";
async function masterReference(pool,live){
 if(live){const options=await pool.query('SELECT service_id AS "serviceId",category,service_name AS "serviceName",default_unit AS "defaultUnit" FROM public.mvp_services_catalog WHERE status=\'active\' ORDER BY category,service_name,service_id');return {readonly:false,sourceModifiedAt:null,services:options.rows};}
 const verified=await pool.query("SELECT 1 AS verified FROM public.mvp_service_reference_batches b WHERE b.batch_id=$1 AND b.source_system='LEGACY_GOOGLE_VBOS' AND b.status='VERIFIED' AND b.manifest_sha256=$2 AND b.source_modified_at=$3::timestamptz AND b.services_count=37 AND b.prices_count=1 AND (SELECT count(*) FROM public.mvp_services_reference s WHERE s.batch_id=b.batch_id)=b.services_count AND (SELECT count(*) FROM public.mvp_master_prices_reference p WHERE p.batch_id=b.batch_id)=b.prices_count",[REFERENCE_BATCH,REFERENCE_SOURCE_MANIFEST,REFERENCE_SOURCE_MODIFIED]);
 if(verified.rows.length!==1)return null;
 const options=await pool.query("SELECT service_id AS \"serviceId\",category,service_name AS \"serviceName\",default_unit AS \"defaultUnit\" FROM public.mvp_services_reference WHERE batch_id=$1 AND status='active' ORDER BY category,service_name,service_id",[REFERENCE_BATCH]);
 return {batchId:REFERENCE_BATCH,sourceModifiedAt:REFERENCE_SOURCE_MODIFIED,readonly:true,services:options.rows};
}
export async function mastersRead({pool,url,AppError}){
 const params=url.searchParams;
 const q=plain(params.get('q')??'',80,AppError,{label:'Поиск'}).toLocaleLowerCase('ru');
 const status=params.get('status')??'';
 if(status&&status!=='available'&&!MASTER_STATUS.includes(status))invalid(AppError,'Неизвестный статус мастера.');
 const category=plain(params.get('category')??'',180,AppError,{label:'Категория'});
 const serviceId=plain(params.get('serviceId')??'',128,AppError,{label:'Услуга'});
 const masterId=params.get('masterId')??'';
 if(masterId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(masterId))invalid(AppError,'Неверный ID мастера.');
 if(serviceId&&!/^[A-Za-z0-9_-]{3,128}$/.test(serviceId))invalid(AppError,'Неверная услуга.');
 if(masterId&&(q||status||category||serviceId||params.get('cursor')))invalid(AppError,'Карточка не совмещается с фильтрами списка.');
 const catalog=params.get('reference')??'';
 if(catalog&&catalog!=='1')invalid(AppError,'Неизвестный режим справочника.');
 const wantReference=catalog==='1'||Boolean(category||serviceId);
 const wantAuthority=wantReference||params.get('authority')==='1';
 const scope=wantReference||masterId?[q,status,category,serviceId,masterId,catalog]:[q,status];
 const limit=Number(params.get('limit')||50);
 if(!Number.isInteger(limit)||limit<1||limit>100)invalid(AppError,'Размер страницы — от 1 до 100.');
 const raw=params.get('cursor');
 let cursor=null;
 if(raw){
  if(raw.length>1400||!/^[A-Za-z0-9_-]+$/.test(raw))invalid(AppError,'Неверная страница мастеров.');
  try{
   const x=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
   if(!Array.isArray(x)||x.length!==scope.length+2||scope.some((v,i)=>x[i]!==v)||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(x.at(-2))||
      !/^[0-9a-f-]{36}$/i.test(x.at(-1)))throw Error('cursor');
   cursor=x.slice(-2);
  }catch{invalid(AppError,'Неверная страница мастеров.');}
 }
 const authority=wantAuthority?await mastersServicesAuthority(pool):null;
 if(wantReference&&authority?.phase==='CLEAN'&&!authority.writeEnabled)throw new AppError(503,'Право чтения текущих связей не подтверждено.');
 const live=authority?.writeEnabled===true;
 const reference=wantReference?await masterReference(pool,live):null;
 if((category||serviceId)&&!reference)throw new AppError(503,'Снимок связей мастеров и услуг не подтверждён.');
 if(category&&!reference.services.some(s=>s.category===category))invalid(AppError,'Категория отсутствует в подтверждённом снимке.');
 if(serviceId&&!reference.services.some(s=>s.serviceId===serviceId&&(!category||s.category===category)))invalid(AppError,'Услуга отсутствует в выбранной категории.');
 const args=[],where=[];
 if(q){args.push(q);where.push("strpos(lower(concat_ws(' ',name,phone,service_area,email,notes,source_master_id,id::text)),lower($"+args.length+"))>0");}
 if(status==='available')where.push("status<>'archived'");
 else if(status){args.push(status);where.push('status=$'+args.length);}
 if(masterId){args.push(masterId);where.push('id=$'+args.length+'::uuid');}
 if((category||serviceId)&&live){
  args.push(category,serviceId);const i=args.length-1;
  where.push("EXISTS(SELECT 1 FROM public.mvp_master_prices_catalog p JOIN public.mvp_services_catalog s ON s.service_id=p.service_id WHERE p.master_id=m.id AND s.status='active' AND "+effectivePrice+" AND ($"+i+"='' OR s.category=$"+i+") AND ($"+(i+1)+"='' OR s.service_id=$"+(i+1)+"))");
 }else if(category||serviceId){
  args.push(REFERENCE_BATCH,category,serviceId);
  const i=args.length-2;
  where.push("m.source_system='LEGACY_GOOGLE' AND EXISTS(SELECT 1 FROM public.mvp_master_prices_reference p JOIN public.mvp_services_reference s ON s.batch_id=p.batch_id AND s.service_id=p.service_id WHERE p.batch_id=$"+i+" AND p.master_id=m.source_master_id AND s.status='active' AND "+effectivePrice+" AND ($"+(i+1)+"='' OR s.category=$"+(i+1)+") AND ($"+(i+2)+"='' OR s.service_id=$"+(i+2)+"))");
 }
 if(cursor){args.push(...cursor);const i=args.length-1;where.push('(created_at,id)<($'+i+'::timestamptz,$'+(i+1)+'::uuid)');}
 args.push(limit+1);
 const sql='SELECT id,source_system,source_master_id,name,phone,email,service_area,notes,status,'+
   'quality_tier,messenger_type,messenger_contact,revision,created_at,updated_at,'+
   'to_char(created_at AT TIME ZONE '+String.fromCharCode(39)+'UTC'+String.fromCharCode(39)+
   ','+String.fromCharCode(39)+'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'+String.fromCharCode(39)+') AS cursor_at '+
   'FROM public.mvp_crm_masters m'+(where.length?' WHERE '+where.join(' AND '):'')+
   ' ORDER BY created_at DESC,id DESC LIMIT $'+args.length;
 const result=await pool.query(sql,args),items=result.rows.slice(0,limit),hasMore=result.rows.length>limit;
 const last=items.at(-1);
 const nextCursor=hasMore&&last?Buffer.from(JSON.stringify([...scope,last.cursor_at,last.id])).toString('base64url'):null;
 for(const x of items)delete x.cursor_at;
 if(masterId&&!items.length)throw new AppError(404,'Мастер не найден.');
 let linkedServices=[];
 if(masterId&&reference&&live){
  const got=await pool.query('SELECT DISTINCT s.service_id AS "serviceId",s.category,s.service_name AS "serviceName" FROM public.mvp_master_prices_catalog p JOIN public.mvp_services_catalog s ON s.service_id=p.service_id '+"WHERE p.master_id=$1::uuid AND s.status='active' AND "+effectivePrice+' ORDER BY s.category,s.service_name,s.service_id',[masterId]);linkedServices=got.rows;
 }else if(masterId&&reference&&items[0]?.source_system==='LEGACY_GOOGLE'){
  const got=await pool.query('SELECT DISTINCT s.service_id AS "serviceId",s.category,s.service_name AS "serviceName" FROM public.mvp_master_prices_reference p JOIN public.mvp_services_reference s ON s.batch_id=p.batch_id AND s.service_id=p.service_id '+"WHERE p.batch_id=$1 AND p.master_id=$2 AND s.status='active' AND "+effectivePrice+' ORDER BY s.category,s.service_name,s.service_id',[REFERENCE_BATCH,items[0].source_master_id]);
  linkedServices=got.rows;
 }
 return {items,nextCursor,hasMore,limit,q,status,source:'CLEAN_CRM25_MASTERS',...(wantReference?{category,serviceId,reference,linkedServices}:{}),...(wantAuthority?{authority}: {})};
}
