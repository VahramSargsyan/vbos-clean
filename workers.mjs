/* V9C staff roster and explicit WorkOrder assignees — no WorkerDay/WorkLog/pay inference. */
import {createHash} from 'node:crypto';

const normalizePhone=(raw,AppError)=>{
 const phone=String(raw??'').trim();
 if(!phone)return {phone:'',key:''};
 if(phone.length>60||!/^\+?[\d\s().-]+$/.test(phone))throw new AppError(400,'Некорректный телефон исполнителя.');
 const key=phone.replace(/\D/g,'');
 if(key.length<7||key.length>20)throw new AppError(400,'Телефон исполнителя должен содержать 7–20 цифр.');
 return {phone,key};
};
const hashPayload=(type,p)=>createHash('sha256').update(JSON.stringify({type,values:Object.keys(p).filter(k=>k!=='requestKey').sort().map(k=>[k,p[k]])})).digest('hex');
const textField=(raw,max,AppError,required=false)=>{
 const str=String(raw??'').trim();
 if(str.length>max||(required&&!str))throw new AppError(400,'Проверь обязательные поля исполнителя.');
 return str;
};
const positiveRevision=(raw,AppError)=>{
 const n=Number(raw);
 if(!Number.isInteger(n)||n<1||n>=2147483647)throw new AppError(400,'Неверная версия исполнителя.');
 return n;
};
/** All rows and idempotency receipts commit atomically; repeated keys cannot alter a different worker/order. */
export async function workerAction({pool,type,p,key,uuid,AppError}){
 const kinds=['worker_create','worker_update','worker_assign_order','worker_remove_order'];
 if(!kinds.includes(type))throw new AppError(404,'Неизвестная операция исполнителя.');
 const digest=hashPayload(type,p);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const claim=await client.query("INSERT INTO public.mvp_worker_requests(request_key,action,payload_sha256,response) VALUES($1,$2,$3,'{}'::jsonb) ON CONFLICT(request_key) DO NOTHING RETURNING request_key",[key,type,digest]);
  if(!claim.rowCount){
   const old=(await client.query('SELECT action,payload_sha256,response FROM public.mvp_worker_requests WHERE request_key=$1',[key])).rows[0];
   if(!old||old.action!==type||old.payload_sha256!==digest)throw new AppError(409,'Ключ запроса уже использован для других данных исполнителя.');
   await client.query('COMMIT');
   return {...old.response,deduplicated:true};
  }
  let item;
  if(type==='worker_create'||type==='worker_update'){
   const name=textField(p.name,160,AppError,true),role=textField(p.roleTitle,160,AppError),notes=textField(p.notes,5000,AppError);
   const {phone,key:phoneKey}=normalizePhone(p.phone,AppError);
   const status=p.status===undefined?'active':String(p.status);
   if(!['active','inactive','archived'].includes(status))throw new AppError(400,'Некорректный статус исполнителя.');
   if(type==='worker_create'){
    item=(await client.query('INSERT INTO public.mvp_workers(name,phone,phone_key,role_title,notes,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[name,phone,phoneKey,role,notes,status])).rows[0];
   }else{
    const result=await client.query('UPDATE public.mvp_workers SET name=$3,phone=$4,phone_key=$5,role_title=$6,notes=$7,status=$8,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *',
     [uuid(p.id),positiveRevision(p.revision,AppError),name,phone,phoneKey,role,notes,status]);
    if(!result.rows.length)throw new AppError(409,'Карточка исполнителя изменена. Обнови экран.');
    item=result.rows[0];
   }
  }else{
   const workerId=uuid(p.workerId),orderId=uuid(p.orderId);
   const assignment=(await client.query('SELECT * FROM public.mvp_worker_order_assignments WHERE worker_id=$1 AND order_id=$2 FOR UPDATE',[workerId,orderId])).rows[0]||null;
   if(type==='worker_assign_order'){
    const w=(await client.query('SELECT id,name,status FROM public.mvp_workers WHERE id=$1 FOR UPDATE',[workerId])).rows[0];
    if(!w||w.status!=='active')throw new AppError(409,'Можно назначить только действующего исполнителя.');
    const order=(await client.query('SELECT id,status FROM public.mvp_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
    if(!order||!['open','active'].includes(order.status))throw new AppError(409,'Нельзя назначить исполнителя на завершённый или отсутствующий заказ.');
    if(assignment?.status==='active')item=assignment;
    else if(assignment){
     item=(await client.query("UPDATE public.mvp_worker_order_assignments SET status='active',removed_at=NULL,assigned_at=now(),updated_at=now(),revision=revision+1 WHERE id=$1 RETURNING *",[assignment.id])).rows[0];
    }else{
     item=(await client.query('INSERT INTO public.mvp_worker_order_assignments(worker_id,order_id) VALUES($1,$2) RETURNING *',[workerId,orderId])).rows[0];
    }
   }else{
    if(!assignment)throw new AppError(404,'Назначение исполнителя не найдено.');
    item=assignment.status==='active'
      ?(await client.query("UPDATE public.mvp_worker_order_assignments SET status='removed',removed_at=now(),updated_at=now(),revision=revision+1 WHERE id=$1 RETURNING *",[assignment.id])).rows[0]
      :assignment;
   }
  }
  const response={saved:true,item};
  await client.query('UPDATE public.mvp_worker_requests SET response=$2::jsonb WHERE request_key=$1',[key,JSON.stringify(response)]);
  await client.query('COMMIT');return response;
 }catch(e){
  await client.query('ROLLBACK').catch(()=>{});
  if(e?.code==='23505'&&String(e.constraint||'').includes('phone'))throw new AppError(409,'Исполнитель с таким телефоном уже существует.');
  throw e;
 }finally{client.release();}
}

/** Single optional manual ScheduleItem worker, inside its existing guarded schedule_save transaction. */
export async function syncManualPlanWorkerTx(client,planId,raw,uuid,AppError){
 if(raw===undefined)return;
 const workerId=raw?uuid(raw):null;
 const existing=(await client.query('SELECT * FROM public.mvp_manual_plan_workers WHERE plan_id=$1 FOR UPDATE',[planId])).rows[0]||null;
 if(!workerId){
  if(existing?.status==='active')await client.query("UPDATE public.mvp_manual_plan_workers SET status='removed',removed_at=now(),updated_at=now(),revision=revision+1 WHERE id=$1",[existing.id]);
  return;
 }
 if(existing?.status==='active'&&existing.worker_id===workerId)return;
 const worker=(await client.query('SELECT id,status FROM public.mvp_workers WHERE id=$1 FOR UPDATE',[workerId])).rows[0];
 if(!worker||worker.status!=='active')throw new AppError(409,'Для нового назначения выбери действующего исполнителя.');
 if(existing)await client.query("UPDATE public.mvp_manual_plan_workers SET worker_id=$2,status='active',removed_at=NULL,assigned_at=now(),updated_at=now(),revision=revision+1 WHERE id=$1",[existing.id,workerId]);
 else await client.query('INSERT INTO public.mvp_manual_plan_workers(plan_id,worker_id) VALUES($1,$2)',[planId,workerId]);
}
