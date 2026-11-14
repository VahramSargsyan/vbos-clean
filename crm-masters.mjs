/**
 * CRM-25A external Masters (not internal Workers) on canonical Clean PostgreSQL.
 * Legacy Google records require a separately approved guarded import and remain
 * read-only until the owner authorizes external-master authority cutover.
 */
import {createHash} from 'node:crypto';
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
export async function mastersAction({pool,type,p,key,uuid,safeRevision,AppError}){
 const value=masterPayload(p,AppError);
 if(type==='crm_master_create'){
  if(p.masterId||p.sourceMasterId||p.sourceSystem)
   invalid(AppError,'Нельзя создавать мастера с чужим ID или происхождением.');
  const hash=digest(value),db=await pool.connect();
  try{
   await db.query('BEGIN');
   const saved=(await db.query(
    'INSERT INTO public.mvp_crm_masters '+
    '(request_key,payload_sha256,name,phone,email,service_area,notes,status,quality_tier,messenger_type,messenger_contact) '+
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) '+
    'ON CONFLICT(request_key) DO NOTHING RETURNING *',[key,hash,...rowFrom(value)])).rows[0];
   let item=saved;
   if(!item){
    item=(await db.query('SELECT * FROM public.mvp_crm_masters WHERE request_key=$1 FOR UPDATE',[key])).rows[0];
    if(!item||item.payload_sha256!==hash)throw new AppError(409,'Этот ключ создания уже использован с другими данными.');
   }
   await db.query('COMMIT');
   return {saved:true,item,deduplicated:!saved,source:'CLEAN_CRM25_MASTER'};
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
  finally{db.release();}
 }
 if(type==='crm_master_update'){
  const id=uuid(p.masterId),revision=safeRevision(p.revision);
  const result=await pool.query(
   'UPDATE public.mvp_crm_masters SET '+
   'name=$3,phone=$4,email=$5,service_area=$6,notes=$7,status=$8,quality_tier=$9,'+
   'messenger_type=$10,messenger_contact=$11,revision=revision+1,updated_at=now() '+
   "WHERE id=$1 AND revision=$2 AND source_system='CLEAN_NATIVE' RETURNING *",
   [id,revision,...rowFrom(value)]);
  const item=result.rows[0];
  if(!item){
   const check=(await pool.query('SELECT source_system,revision FROM public.mvp_crm_masters WHERE id=$1',[id])).rows[0];
   if(!check)throw new AppError(404,'Мастер не найден.');
   if(check.source_system==='LEGACY_GOOGLE')throw new AppError(409,'Исторический мастер пока доступен только для просмотра. Изменение источника требует отдельного согласования.');
   throw new AppError(409,'Карточка мастера изменилась. Обнови страницу.');
  }
  return {saved:true,item,source:'CLEAN_CRM25_MASTER'};
 }
 throw new AppError(400,'Неизвестное действие со справочником мастеров.');
}
export async function mastersRead({pool,url,AppError}){
 const params=url.searchParams;
 const q=plain(params.get('q')??'',80,AppError,{label:'Поиск'}).toLocaleLowerCase('ru');
 const status=params.get('status')??'';
 if(status&&!MASTER_STATUS.includes(status))invalid(AppError,'Неизвестный статус мастера.');
 const limit=Number(params.get('limit')||50);
 if(!Number.isInteger(limit)||limit<1||limit>100)invalid(AppError,'Размер страницы — от 1 до 100.');
 const raw=params.get('cursor');
 let cursor=null;
 if(raw){
  if(raw.length>600||!/^[A-Za-z0-9_-]+$/.test(raw))invalid(AppError,'Неверная страница мастеров.');
  try{
   const x=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
   if(!Array.isArray(x)||x.length!==4||x[0]!==q||x[1]!==status||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(x[2])||
      !/^[0-9a-f-]{36}$/i.test(x[3]))throw Error('cursor');
   cursor=[x[2],x[3]];
  }catch{invalid(AppError,'Неверная страница мастеров.');}
 }
 const args=[],where=[];
 if(q){args.push(q);where.push("strpos(lower(concat_ws(' ',name,phone,service_area)),lower($"+args.length+"))>0");}
 if(status){args.push(status);where.push('status=$'+args.length);}
 if(cursor){args.push(...cursor);const i=args.length-1;where.push('(created_at,id)<($'+i+'::timestamptz,$'+(i+1)+'::uuid)');}
 args.push(limit+1);
 const sql='SELECT id,source_system,source_master_id,name,phone,email,service_area,notes,status,'+
   'quality_tier,messenger_type,messenger_contact,revision,created_at,updated_at,'+
   'to_char(created_at AT TIME ZONE '+String.fromCharCode(39)+'UTC'+String.fromCharCode(39)+
   ','+String.fromCharCode(39)+'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'+String.fromCharCode(39)+') AS cursor_at '+
   'FROM public.mvp_crm_masters'+(where.length?' WHERE '+where.join(' AND '):'')+
   ' ORDER BY created_at DESC,id DESC LIMIT $'+args.length;
 const result=await pool.query(sql,args),items=result.rows.slice(0,limit),hasMore=result.rows.length>limit;
 const last=items.at(-1);
 const nextCursor=hasMore&&last?Buffer.from(JSON.stringify([q,status,last.cursor_at,last.id])).toString('base64url'):null;
 for(const x of items)delete x.cursor_at;
 return {items,nextCursor,hasMore,limit,q,status,source:'CLEAN_CRM25_MASTERS'};
}
