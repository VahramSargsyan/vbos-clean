/* V9D: WorkerDay attendance, distinct from owner WorkDay, WorkerTask, WorkLog and payroll. */
import {createHash} from 'node:crypto';

const VALID_REASONS=new Set(['work_done_early','no_work_front','no_materials','site_problem','personal_reason','manager_decision','unwell','activity_not_recorded','other']);
const payloadHash=(type,p)=>createHash('sha256').update(JSON.stringify({type,fields:Object.keys(p).filter(k=>k!=='requestKey').sort().map(k=>[k,p[k]])})).digest('hex');
const str=(x,max,AppError)=>{const text=String(x??'').trim();if(text.length>max)throw new AppError(400,'Слишком длинное поле смены работника.');return text;};
const rev=(x,AppError)=>{const n=Number(x);if(!Number.isInteger(n)||n<1||n>2147483646)throw new AppError(400,'Неверная версия смены.');return n;};
const localStamp=(raw,date,AppError)=>{
 const value=String(raw??'').trim();
 if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)||value.slice(0,10)!==date)throw new AppError(400,'Время прихода или ухода должно соответствовать дате смены.');
 return value;
};
const closeReason=(code,note,AppError)=>{
 const value=String(code??'').trim(),text=str(note,2000,AppError);
 if(!VALID_REASONS.has(value))throw new AppError(400,'Укажи причину окончания смены. До переноса WorkerTasks это обязательное поле.');
 if(value==='other'&&!text)throw new AppError(400,'Для причины «Другое» требуется пояснение.');
 return {value,text};
};
async function readItem(client,id){
 const x=await client.query('SELECT *,day_date::text AS day_date FROM public.mvp_worker_days WHERE id=$1',[id]);return x.rows[0];
}

/** All worker-day, assignment verification, order links and retry receipts live in one transaction. */
export async function workerDayAction({pool,type,p,key,uuid,safeDate,dayYerevan,AppError}){
 if(!['worker_day_arrive','worker_day_depart','worker_day_correct'].includes(type))throw new AppError(404,'Неизвестная операция смены.');
 const digest=payloadHash(type,p),client=await pool.connect();
 try{
  await client.query('BEGIN');
  const claim=await client.query("INSERT INTO public.mvp_worker_day_requests(request_key,action,payload_sha256,response) VALUES($1,$2,$3,'{}'::jsonb) ON CONFLICT(request_key) DO NOTHING RETURNING request_key",[key,type,digest]);
  if(!claim.rowCount){
   const old=(await client.query('SELECT action,payload_sha256,response FROM public.mvp_worker_day_requests WHERE request_key=$1',[key])).rows[0];
   if(!old||old.action!==type||old.payload_sha256!==digest)throw new AppError(409,'Ключ запроса уже относится к другой смене.');
   await client.query('COMMIT');return {...old.response,deduplicated:true};
  }
  let item,attachedExisting=false,linkedOrder=false;
  if(type==='worker_day_arrive'){
   const workerId=uuid(p.workerId),orderId=uuid(p.orderId),date=safeDate(p.date||dayYerevan());
   const arrival=localStamp(p.arrivalAt,date,AppError),notes=str(p.notes,5000,AppError);
   // V9C assignment transaction also locks the assignment row before worker/order.
   const assigned=(await client.query("SELECT id FROM public.mvp_worker_order_assignments WHERE worker_id=$1 AND order_id=$2 AND status='active' FOR UPDATE",[workerId,orderId])).rows[0];
   if(!assigned)throw new AppError(409,'Сначала назначь исполнителя на заказ.');
   const worker=(await client.query('SELECT id,status FROM public.mvp_workers WHERE id=$1 FOR UPDATE',[workerId])).rows[0];
   if(!worker||worker.status!=='active')throw new AppError(409,'Приход доступен только действующему исполнителю.');
   const order=(await client.query('SELECT id,object_id,status FROM public.mvp_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
   if(!order||!['open','active'].includes(order.status))throw new AppError(409,'Нельзя начать смену по завершённому заказу.');
   const day=(await client.query("SELECT * FROM public.mvp_worker_days WHERE worker_id=$1 AND day_date=$2::date AND status<>'archived' FOR UPDATE",[workerId,date])).rows[0];
   const other=(await client.query("SELECT id FROM public.mvp_worker_days WHERE worker_id=$1 AND status='open' AND day_date<>$2::date FOR UPDATE",[workerId,date])).rows[0];
   if(other)throw new AppError(409,'У исполнителя осталась незакрытая смена за другую дату.');
   if(day){
    if(day.status!=='open')throw new AppError(409,'Смена на эту дату уже закрыта.');
    if(day.arrival_at!==arrival)throw new AppError(409,'Время прихода уже сохранено. Для второго заказа используй его без изменения.');
    attachedExisting=true;item=day;
   }else{
    item=(await client.query("INSERT INTO public.mvp_worker_days(worker_id,day_date,arrival_at,notes) VALUES($1,$2::date,$3,$4) RETURNING *",[workerId,date,arrival,notes])).rows[0];
   }
   const link=await client.query("INSERT INTO public.mvp_worker_day_orders(worker_day_id,work_order_id,object_id) VALUES($1,$2,$3) ON CONFLICT(worker_day_id,work_order_id) DO NOTHING RETURNING id",[item.id,orderId,order.object_id]);
   linkedOrder=link.rowCount>0;
  }else{
   const dayId=uuid(p.id),expected=rev(p.revision,AppError);
   const row=(await client.query('SELECT *,day_date::text AS day_date FROM public.mvp_worker_days WHERE id=$1 FOR UPDATE',[dayId])).rows[0];
   if(!row)throw new AppError(404,'Смена не найдена.');
   if(row.revision!==expected)throw new AppError(409,'Смена изменена в другом окне. Обнови данные.');
   if(row.status==='archived')throw new AppError(409,'Архивную смену нельзя изменять.');
   const date=row.day_date,notes=p.notes===undefined?row.notes:str(p.notes,5000,AppError);
   if(type==='worker_day_depart'){
    if(row.status!=='open')throw new AppError(409,'Смена уже закрыта.');
    const departure=localStamp(p.departureAt,date,AppError);
    if(departure<row.arrival_at)throw new AppError(400,'Уход раньше прихода.');
    const taskSummary=(await client.query(
     "SELECT count(*) FILTER (WHERE status='active')::int AS active_count,max(end_at) FILTER (WHERE status='completed') AS latest_end FROM public.mvp_worker_tasks WHERE worker_day_id=$1",[dayId])).rows[0];
    if(taskSummary.active_count)throw new AppError(409,'Сначала заверши активную задачу работника.');
    if(taskSummary.latest_end&&departure<taskSummary.latest_end)throw new AppError(409,'Уход не может быть раньше окончания задачи.');
    const reason=closeReason(p.closeReasonCode,p.closeReasonNote,AppError);
    item=(await client.query("UPDATE public.mvp_worker_days SET status='closed',departure_at=$2,departure_recorded_at=now(),close_reason_code=$3,close_reason_note=$4,notes=$5,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",[dayId,departure,reason.value,reason.text,notes])).rows[0];
   }else{
    const arrival=localStamp(p.arrivalAt??row.arrival_at,date,AppError);
    const departure=row.status==='closed'?localStamp(p.departureAt??row.departure_at,date,AppError):'';
    if(departure&&departure<arrival)throw new AppError(400,'Уход раньше прихода.');
    const reason=row.status==='closed'?closeReason(p.closeReasonCode??row.close_reason_code,p.closeReasonNote??row.close_reason_note,AppError):{value:'',text:''};
    if(row.status==='open'&&p.departureAt)throw new AppError(409,'Открытую смену сначала нужно закрыть.');
    const bounds=(await client.query(
     "SELECT min(start_at) AS earliest_start,max(end_at) FILTER (WHERE status='completed') AS latest_end FROM public.mvp_worker_tasks WHERE worker_day_id=$1",[dayId])).rows[0];
    if(bounds.earliest_start&&arrival>bounds.earliest_start)throw new AppError(409,'Приход не может быть позже начала записанной задачи.');
    if(departure&&bounds.latest_end&&departure<bounds.latest_end)throw new AppError(409,'Уход не может быть раньше окончания записанной задачи.');
    item=(await client.query("UPDATE public.mvp_worker_days SET arrival_at=$2,departure_at=$3,close_reason_code=$4,close_reason_note=$5,notes=$6,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",[dayId,arrival,departure,reason.value,reason.text,notes])).rows[0];
   }
  }
  item=await readItem(client,item.id);
  const response={saved:true,item,attachedExisting,linkedOrder};
  await client.query('UPDATE public.mvp_worker_day_requests SET response=$2::jsonb WHERE request_key=$1',[key,JSON.stringify(response)]);
  await client.query('COMMIT');return response;
 }catch(e){
  await client.query('ROLLBACK').catch(()=>{});
  if(e?.code==='23505')throw new AppError(409,'У исполнителя уже есть смена на эту дату или другая открытая смена.');
  throw e;
 }finally{client.release();}
}

export async function workerDaysRead(pool,url,{uuid,safeDate,AppError}){
 const limit=Number(url.searchParams.get('limit')||25);
 if(!Number.isInteger(limit)||limit<1||limit>50)throw new AppError(400,'Страница смен: 1–50 записей.');
 const worker=url.searchParams.get('workerId')?uuid(url.searchParams.get('workerId')):null;
 const date=url.searchParams.get('date')?safeDate(url.searchParams.get('date')):null;
 let cursor=null;
 if(url.searchParams.has('cursor')){
  const raw=url.searchParams.get('cursor')||'';
  if(raw.length>400||!/^[A-Za-z0-9_-]+$/.test(raw))throw new AppError(400,'Неверная страница смен.');
  try{
   const a=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
   if(!Array.isArray(a)||a.length!==2)throw Error('cursor');
   cursor=[safeDate(a[0]),uuid(a[1])];
  }catch{throw new AppError(400,'Неверная страница смен.');}
 }
 const args=[],where=["d.status<>'archived'"];
 if(worker){args.push(worker);where.push('d.worker_id=$'+args.length);}
 if(date){args.push(date);where.push('d.day_date=$'+args.length+'::date');}
 if(cursor){const n=args.length+1;args.push(...cursor);where.push('(d.day_date,d.id)<($'+n+'::date,$'+(n+1)+'::uuid)');}
 args.push(limit+1);
 const q=await pool.query('SELECT d.*,d.day_date::text AS day_date,w.name AS worker_name FROM public.mvp_worker_days d JOIN public.mvp_workers w ON w.id=d.worker_id WHERE '+where.join(' AND ')+' ORDER BY d.day_date DESC,d.id DESC LIMIT $'+args.length,args);
 const rows=q.rows.slice(0,limit),more=q.rows.length>limit;
 const ids=rows.map(r=>r.id),links=ids.length?(await pool.query("SELECT worker_day_id,work_order_id,object_id,status FROM public.mvp_worker_day_orders WHERE worker_day_id=ANY($1::uuid[]) ORDER BY linked_at,id",[ids])).rows:[];
 for(const row of rows)row.linkedOrders=links.filter(l=>l.worker_day_id===row.id);
 return {items:rows,hasMore:more,nextCursor:more?Buffer.from(JSON.stringify([rows.at(-1).day_date,rows.at(-1).id])).toString('base64url'):null};
}
