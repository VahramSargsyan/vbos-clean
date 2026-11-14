/* V9B: authoritative WorkOrder -> automatic ScheduleItem projection; never edit manual plans. */
import {createHash} from 'node:crypto';
import {validateOrderLeadContext} from './crm-lead-conversion.mjs';

const dateKey=v=>{
 if(v===null||v===undefined||v==='')return '';
 if(v instanceof Date)return v.toISOString().slice(0,10);
 return String(v).slice(0,10);
};
const localTime=v=>new Date(new Date(v).getTime()+14400000).toISOString().slice(11,16);
const lifecycle=status=>status==='done'?'completed':status==='cancelled'?'cancelled':'planned';
const yTime=(day,clock)=>day+'T'+clock+':00+04:00';
const payloadHash=(type,p)=>{
 const ordered=Object.keys(p).filter(x=>x!=='requestKey').sort().map(x=>[x,p[x]]);
 return createHash('sha256').update(JSON.stringify({type,ordered})).digest('hex');
};

/**
 * Invoked only with an already-open transaction and an exact row from mvp_orders.
 * The containing order mutation MUST roll back if any auto schedule write fails.
 * The unique order_id and auto_source_key prohibit multiple auto items per order.
 */
export async function syncWorkOrderScheduleTx(client,order){
 const id=String(order.id),sourceKey='WORKORDER|'+id;
 const oldResult=await client.query('SELECT * FROM public.mvp_schedule_order_items WHERE order_id=$1 FOR UPDATE',[id]);
 const old=oldResult.rows[0]||null,planned=dateKey(order.planned_on);
 if(!planned&&!old)return {action:'none',reason:'no_planned_date'};
 const day=planned||dateKey(old.schedule_date);
 let startClock=old?localTime(old.start_at):'09:00',endClock=old?localTime(old.end_at):'10:00';
 if(endClock<=startClock){startClock='09:00';endClock='10:00';}
 const start=new Date(yTime(day,startClock)).toISOString(),end=new Date(yTime(day,endClock)).toISOString();
 const status=!planned&&lifecycle(order.status)==='planned'?'cancelled':lifecycle(order.status);
 const title=String(order.title||'Заказ').trim().slice(0,300)||'Заказ';
 if(old){
  const unchanged=old.status===status&&new Date(old.start_at).toISOString()===start&&
   new Date(old.end_at).toISOString()===end&&dateKey(old.schedule_date)===day&&
   old.object_id===order.object_id&&old.title===title;
  if(unchanged)return {action:'unchanged',id:old.id};
  const row=await client.query(
   'UPDATE public.mvp_schedule_order_items SET status=$2,start_at=$3::timestamptz,end_at=$4::timestamptz,schedule_date=$5::date,object_id=$6,title=$7,revision=revision+1,updated_at=now(),archived_at=NULL WHERE id=$1 RETURNING id',
   [old.id,status,start,end,day,order.object_id,title]);
  return {action:'updated',id:row.rows[0].id};
 }
 const row=await client.query(
  'INSERT INTO public.mvp_schedule_order_items(status,start_at,end_at,schedule_date,object_id,order_id,auto_source_key,item_type,title) VALUES($1,$2::timestamptz,$3::timestamptz,$4::date,$5,$6,$7,$8,$9) RETURNING id',
  [status,start,end,day,order.object_id,id,sourceKey,'Работа',title]);
 return {action:'created',id:row.rows[0].id};
}

/**
 * Strict request-key replay + optimistic updates, atomic order + auto schedule.
 * Public response format stays {saved:true,item:order} for existing clients.
 */
export async function orderScheduleAction({pool,type,p,key,uuid,maybeUuid,requireText,optText,safeDate,safeRevision,allow,AppError}){
 if(!['order_create','order_update','order_status'].includes(type))throw new AppError(404,'Неизвестная операция заказа.');
 // Never allow the former 'done' shortcut: it skipped the legacy finance, assessment,
 // task, assignment, schedule and audit close protocol. No authorized close writer exists yet.
 if(type==='order_status'&&p.status==='done')throw new AppError(409,'Заказ нельзя завершить простой сменой статуса. Используй предварительную проверку закрытия; полная процедура ещё не подключена.');
 const digest=payloadHash(type,p);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const claim=await client.query(
   "INSERT INTO public.mvp_order_schedule_requests(request_key,action,payload_sha256,response) VALUES($1,$2,$3,'{}'::jsonb) ON CONFLICT(request_key) DO NOTHING RETURNING request_key",
   [key,type,digest]
  );
  if(!claim.rowCount){
   const receipt=await client.query('SELECT action,payload_sha256,response FROM public.mvp_order_schedule_requests WHERE request_key=$1',[key]);
   const old=receipt.rows[0];
   if(!old||old.action!==type||old.payload_sha256!==digest)throw new AppError(409,'Ключ заказа уже использован с другими данными.');
   await client.query('COMMIT');
   return {...old.response,deduplicated:true};
  }
  // V10 Fast Start: Google is the single writer for imported legacy WorkOrders.
  // Keep legacy orders usable for new WorkLogs / WorkerDays / assignments, but
  // refuse all edits to their canonical title, date, notes and lifecycle.
  if(type!=='order_create'){
   const found=await client.query(
    "SELECT 1 FROM public.mvp_legacy_import_map WHERE source_system='Working IP APP / M8C cutover baseline' AND source_entity='WorkOrders' AND target_id=$1 LIMIT 1",
    [uuid(p.id)]);
   if(found.rowCount)throw new AppError(409,'Импортированный заказ управляется в старом VBOS. Его карточка в Clean доступна только для просмотра.');
   const current=await client.query('SELECT status FROM public.mvp_orders WHERE id=$1 FOR UPDATE',[uuid(p.id)]);
   if(current.rows[0]?.status==='done')
    throw new AppError(409,'Завершённый заказ нельзя менять через обычный редактор. История закрытия сохраняется отдельно.');
  }
  let updated;
  if(type==='order_create'){
   const objectId=uuid(p.objectId),sourceLead=maybeUuid(p.leadId);
   await validateOrderLeadContext(client,sourceLead,objectId,AppError);
   const on=p.plannedOn?safeDate(p.plannedOn):null;
   const row=await client.query(
    'INSERT INTO public.mvp_orders(request_key,object_id,lead_id,title,planned_on,notes) VALUES($1,$2,$3,$4,$5::date,$6) RETURNING *',
    [key,objectId,sourceLead,requireText(p.title,180),on,optText(p.notes)]);
   updated=row.rows[0];
  }else if(type==='order_update'){
   const on=p.plannedOn?safeDate(p.plannedOn):null;
   const row=await client.query(
    'UPDATE public.mvp_orders SET title=$3,planned_on=$4::date,notes=$5,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *',
    [uuid(p.id),safeRevision(p.revision),requireText(p.title,180),on,optText(p.notes)]);
   updated=row.rows[0];
  }else{
   const row=await client.query(
    'UPDATE public.mvp_orders SET status=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *',
    [uuid(p.id),safeRevision(p.revision),allow(p.status,['open','active','done','cancelled'])]);
   updated=row.rows[0];
  }
  if(!updated)throw new AppError(409,'Заказ изменился в другой сессии. Обнови экран.');
  await syncWorkOrderScheduleTx(client,updated);
  const result={saved:true,item:updated};
  await client.query('UPDATE public.mvp_order_schedule_requests SET response=$2::jsonb WHERE request_key=$1',
   [key,JSON.stringify(result)]);
  await client.query('COMMIT');
  return result;
 }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}
 finally{client.release();}
}
