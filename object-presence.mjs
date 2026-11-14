/* VBOS Clean V7 — guarded object presence. Owner WorkDay, visits, WorkLog remain distinct. */
import {createHash} from 'node:crypto';
const baseSelect="SELECT p.id,p.day_id,p.day_date::text AS day_date,p.object_id,p.order_id,p.status,p.arrived_at,p.departed_at,p.arrival_recorded_at,p.departure_recorded_at,p.notes,p.revision,p.created_at,p.updated_at,o.name AS object_name,o.address AS object_address,c.name AS client_name,ord.title AS order_title FROM public.mvp_object_presence p JOIN public.mvp_objects o ON o.id=p.object_id JOIN public.mvp_clients c ON c.id=o.client_id LEFT JOIN public.mvp_orders ord ON ord.id=p.order_id";
const todayIso=v=>new Date(v).toISOString();
const getTime=(v,name,AppError)=>{const s=String(v||'');if(!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(s))throw new AppError(400,'Укажи корректное время '+name+' (ЧЧ:ММ).');return s;};
const asInstant=(date,time)=>date+'T'+time+':00+04:00';
const text=(v,AppError)=>{const a=String(v??'').trim();if(a.length>2000)throw new AppError(400,'Примечание слишком длинное.');return a;};
const rev=(v,AppError)=>{const n=Number(v);if(!Number.isInteger(n)||n<1||n>2147483646)throw new AppError(400,'Некорректная версия посещения.');return n;};
const validCursor=(v,uuid,AppError)=>{
 if(!v)return null;
 if(v.length>500||!/^[a-zA-Z0-9_-]+$/.test(v))throw new AppError(400,'Неверная страница посещений.');
 try{
  const d=JSON.parse(Buffer.from(v,'base64url').toString('utf8'));
  if(!Array.isArray(d)||d.length!==2||new Date(d[0]).toISOString()!==d[0])throw Error('bad');
  return [d[0],uuid(d[1])];
 }catch{throw new AppError(400,'Неверная страница посещений.');}
};
export async function objectPresenceRead(pool,url,{dayYerevan,safeDate,uuid,AppError}){
 const date=safeDate(url.searchParams.get('date')||dayYerevan());
 const cursor=validCursor(url.searchParams.get('cursor'),uuid,AppError);
 const args=[date];
 let where=' WHERE p.day_date=$1::date';
 if(cursor){args.push(...cursor);where+=' AND (p.arrived_at,p.id)<($2::timestamptz,$3::uuid)';}
 const rows=await Promise.all([
  pool.query('SELECT id,day_date::text AS day_date,status FROM public.mvp_work_days WHERE day_date=$1::date',[date]),
  pool.query(baseSelect+where+' ORDER BY p.arrived_at DESC,p.id DESC LIMIT 26',args),
  pool.query(baseSelect+" WHERE p.status='open' LIMIT 1")
 ]);
 const items=rows[1].rows.slice(0,25),hasMore=rows[1].rows.length>25,last=items.at(-1);
 const nextCursor=hasMore&&last?Buffer.from(JSON.stringify([todayIso(last.arrived_at),last.id])).toString('base64url'):null;
 return {date,day:rows[0].rows[0]||null,active:rows[2].rows[0]||null,items,hasMore,nextCursor,
  model:{workDay:'whole_day',presence:'object_visit',workLog:'performed_work',ownerActivity:'separate'}};
}
export async function objectPresenceAction({pool,type,p,key,dayYerevan,safeDate,uuid,AppError}){
 if(!['presence_start','presence_stop','presence_update'].includes(type))throw new AppError(404,'Неизвестная операция посещения.');
 const date=type==='presence_start'?dayYerevan():safeDate(p.date||dayYerevan());
 if(p.date && safeDate(p.date)!==date)throw new AppError(400,'Приход на объект отмечается за сегодняшний день.');
 const value={date};
 if(type==='presence_start'){
  value.objectId=uuid(p.objectId);
  value.orderId=p.orderId?uuid(p.orderId):null;
  value.arrivalTime=getTime(p.arrivalTime,'прихода',AppError);
  value.notes=text(p.notes,AppError);
 }else{
  value.id=uuid(p.id);
  value.revision=rev(p.revision,AppError);
  if(type==='presence_stop'){
   value.departureTime=getTime(p.departureTime,'ухода',AppError);
   value.notes=text(p.notes,AppError);
  }else{
   value.arrivalTime=getTime(p.arrivalTime,'прихода',AppError);
   value.departureTime=p.departureTime?getTime(p.departureTime,'ухода',AppError):null;
   value.notes=text(p.notes,AppError);
  }
 }
 const digest=createHash('sha256').update(JSON.stringify({type,...value})).digest('hex');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Serialize all owner visits, including corrections, so overlap cannot race.
  await client.query('SELECT pg_advisory_xact_lock(151106,20261107)');
  const claim=await client.query("INSERT INTO public.mvp_presence_requests(request_key,action,payload_sha256,response) VALUES($1,$2,$3,'{}'::jsonb) ON CONFLICT DO NOTHING RETURNING request_key",[key,type,digest]);
  if(!claim.rowCount){
   const old=await client.query('SELECT action,payload_sha256,response FROM public.mvp_presence_requests WHERE request_key=$1',[key]);
   if(!old.rows.length||old.rows[0].action!==type||old.rows[0].payload_sha256!==digest)
    throw new AppError(409,'Ключ посещения уже использован с другими данными.');
   await client.query('COMMIT');
   return {...old.rows[0].response,deduplicated:true};
  }
  let id,dayId,objectId,orderId,arrival,departure,status,notes;
  if(type==='presence_start'){
   const day=await client.query('SELECT id,status FROM public.mvp_work_days WHERE day_date=$1::date FOR UPDATE',[date]);
   if(!day.rows.length||day.rows[0].status!=='open')throw new AppError(409,'Сначала открой рабочий день. Закрытый день нельзя использовать для нового прихода.');
   const ob=await client.query('SELECT id FROM public.mvp_objects WHERE id=$1',[value.objectId]);
   if(!ob.rows.length)throw new AppError(400,'Объект не найден.');
   if(value.orderId){
    const order=await client.query('SELECT object_id,status FROM public.mvp_orders WHERE id=$1',[value.orderId]);
    if(!order.rows.length||order.rows[0].object_id!==value.objectId)
     throw new AppError(400,'Заказ не относится к выбранному объекту.');
    if(['done','cancelled'].includes(order.rows[0].status))throw new AppError(409,'Заказ завершён или отменён.');
   }
   if((await client.query("SELECT id FROM public.mvp_object_presence WHERE status='open' LIMIT 1")).rowCount)
    throw new AppError(409,'Сначала отметь уход с предыдущего объекта.');
   dayId=day.rows[0].id;objectId=value.objectId;orderId=value.orderId;
   arrival=asInstant(date,value.arrivalTime);departure=null;status='open';notes=value.notes;
  }else{
   const old=await client.query('SELECT *,day_date::text AS date_key FROM public.mvp_object_presence WHERE id=$1 FOR UPDATE',[value.id]);
   if(!old.rows.length)throw new AppError(404,'Посещение объекта не найдено.');
   const row=old.rows[0];if(row.revision!==value.revision)throw new AppError(409,'Посещение изменилось в другой вкладке. Обнови экран.');
   id=row.id;dayId=row.day_id;objectId=row.object_id;orderId=row.order_id;status=row.status;
   if(row.date_key!==date)throw new AppError(400,'Дата посещения не совпадает.');
   if(type==='presence_stop'){
    if(status!=='open')throw new AppError(409,'Посещение уже закрыто.');
    arrival=todayIso(row.arrived_at);departure=asInstant(date,value.departureTime);status='closed';
    notes=value.notes||row.notes;
   }else{
    arrival=asInstant(date,value.arrivalTime);
    if(row.status==='closed'&&!value.departureTime)throw new AppError(400,'Для закрытого посещения требуется время ухода.');
    departure=row.status==='closed'?asInstant(date,value.departureTime):null;
    notes=value.notes;
   }
  }
  if(departure && new Date(departure)<new Date(arrival))throw new AppError(400,'Уход не может быть раньше прихода.');
  const overlaps=await client.query("SELECT id FROM public.mvp_object_presence WHERE day_id=$1 AND ($2::uuid IS NULL OR id<>$2::uuid) AND arrived_at<coalesce($4::timestamptz,'infinity'::timestamptz) AND coalesce(departed_at,'infinity'::timestamptz)>$3::timestamptz LIMIT 1",[dayId,id||null,arrival,departure]);
  if(overlaps.rows.length)throw new AppError(409,'Время посещений объектов не должно пересекаться.');
  let changed;
  if(type==='presence_start'){
   changed=await client.query("INSERT INTO public.mvp_object_presence(day_id,day_date,object_id,order_id,arrived_at,notes) VALUES($1,$2::date,$3,$4,$5::timestamptz,$6) RETURNING id",[dayId,date,objectId,orderId,arrival,notes]);
   id=changed.rows[0].id;
  }else if(type==='presence_stop'){
   changed=await client.query("UPDATE public.mvp_object_presence SET status='closed',departed_at=$2::timestamptz,departure_recorded_at=now(),notes=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id",[id,departure,notes]);
  }else{
   changed=await client.query('UPDATE public.mvp_object_presence SET arrived_at=$2::timestamptz,departed_at=$3::timestamptz,notes=$4,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id',[id,arrival,departure,notes]);
  }
  const detail=await client.query(baseSelect+' WHERE p.id=$1',[id]);
  if(!detail.rows.length)throw new AppError(500,'Не удалось прочитать посещение после сохранения.');
  const response={saved:true,item:detail.rows[0]};
  await client.query('UPDATE public.mvp_presence_requests SET response=$2::jsonb WHERE request_key=$1',[key,JSON.stringify(response)]);
  await client.query('COMMIT');
  return response;
 }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}
 finally{client.release();}
}
