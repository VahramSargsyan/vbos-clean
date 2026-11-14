/* V9E — actual per-worker task sessions. Separate from attendance, WorkLog and payroll. */
import {createHash} from 'node:crypto';

const OUTCOMES=new Set(['COMPLETED','PARTIAL','NOT_COMPLETED','WITH_ERROR']);
const hash=(type,p)=>createHash('sha256').update(JSON.stringify({type,fields:Object.keys(p).filter(k=>k!=='requestKey').sort().map(k=>[k,p[k]])})).digest('hex');
const txt=(v,max,AppError,required=false)=>{const s=String(v??'').trim();if(s.length>max||(required&&!s))throw new AppError(400,'Проверь обязательные поля задачи.');return s;};
const positiveRevision=(v,AppError)=>{const n=Number(v);if(!Number.isInteger(n)||n<1||n>2147483646)throw new AppError(400,'Неверная версия задачи.');return n;};
const localStamp=(v,date,AppError)=>{
 const s=String(v??'').trim();
 if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)||s.slice(0,10)!==date)throw new AppError(400,'Время задачи должно относиться к дате смены.');
 return s;
};
const minutes=(start,end)=>(Number(end.slice(11,13))*60+Number(end.slice(14,16)))-(Number(start.slice(11,13))*60+Number(start.slice(14,16)));
const nonnegativeInt=(v,max,AppError,required=false)=>{
 if((v===undefined||v===null||String(v).trim()==='')&&!required)return 0;
 if(v===undefined||v===null||String(v).trim()==='')throw new AppError(400,'Укажи минуты вмешательства.');
 const n=Number(v);if(!Number.isSafeInteger(n)||n<0||n>max)throw new AppError(400,'Укажи корректное количество минут.');
 return n;
};
const flag=(v,AppError)=>{const s=String(v===undefined?'no':v);if(!['yes','no'].includes(s))throw new AppError(400,'Недопустимый признак задачи.');return s==='yes';};

export async function workerTaskAction({pool,type,p,key,uuid,AppError}){
 if(!['worker_task_start','worker_task_finish'].includes(type))throw new AppError(404,'Неизвестная операция задачи.');
 const digest=hash(type,p),client=await pool.connect();
 try{
  await client.query('BEGIN');
  const claimed=await client.query("INSERT INTO public.mvp_worker_task_requests(request_key,action,payload_sha256) VALUES($1,$2,$3) ON CONFLICT(request_key) DO NOTHING RETURNING request_key",[key,type,digest]);
  if(!claimed.rowCount){
   const prior=(await client.query('SELECT action,payload_sha256,response FROM public.mvp_worker_task_requests WHERE request_key=$1',[key])).rows[0];
   if(!prior||prior.action!==type||prior.payload_sha256!==digest)throw new AppError(409,'Ключ запроса относится к другой задаче.');
   await client.query('COMMIT');return {...prior.response,deduplicated:true};
  }
  let item;
  if(type==='worker_task_start'){
   const workerId=uuid(p.workerId),orderId=uuid(p.orderId),dayId=uuid(p.workerDayId);
   // A worker advisory lock is acquired before row locks, serializing task start/finish.
   await client.query("SELECT pg_advisory_xact_lock(hashtext('mvp_worker_task|'||$1))",[workerId]);
   const assignment=(await client.query("SELECT id FROM public.mvp_worker_order_assignments WHERE worker_id=$1 AND order_id=$2 AND status='active' FOR UPDATE",[workerId,orderId])).rows[0];
   if(!assignment)throw new AppError(409,'Сначала назначь исполнителя на заказ.');
   const worker=(await client.query('SELECT status FROM public.mvp_workers WHERE id=$1 FOR UPDATE',[workerId])).rows[0];
   if(!worker||worker.status!=='active')throw new AppError(409,'Задачу может начать только действующий исполнитель.');
   const order=(await client.query('SELECT id,status,object_id FROM public.mvp_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
   if(!order||!['open','active'].includes(order.status))throw new AppError(409,'Заказ не доступен для задачи.');
   const day=(await client.query("SELECT *,day_date::text AS date_key FROM public.mvp_worker_days WHERE id=$1 FOR UPDATE",[dayId])).rows[0];
   if(!day||day.worker_id!==workerId||day.status!=='open')throw new AppError(409,'Сначала отметь приход сотрудника в открытую смену.');
   const dayLink=(await client.query("SELECT id FROM public.mvp_worker_day_orders WHERE worker_day_id=$1 AND work_order_id=$2 AND status='active' FOR UPDATE",[dayId,orderId])).rows[0];
   if(!dayLink)throw new AppError(409,'Сначала добавь этот заказ в текущую смену.');
   const startAt=localStamp(p.startAt,day.date_key,AppError);
   if(startAt<day.arrival_at)throw new AppError(409,'Начало задачи не может быть раньше прихода.');
   const existing=(await client.query("SELECT id FROM public.mvp_worker_tasks WHERE worker_id=$1 AND status='active' FOR UPDATE",[workerId])).rows[0];
   if(existing)throw new AppError(409,'Сначала заверши текущую задачу этого исполнителя.');
   const latest=(await client.query("SELECT max(end_at) AS latest FROM public.mvp_worker_tasks WHERE worker_id=$1 AND day_date=$2::date AND status='completed'",[workerId,day.date_key])).rows[0]?.latest||'';
   if(latest&&startAt<latest)throw new AppError(409,'Начало пересекается с уже завершённой задачей.');
   item=(await client.query("INSERT INTO public.mvp_worker_tasks(worker_day_id,worker_id,order_id,object_id,day_date,start_at,notes) VALUES($1,$2,$3,$4,$5::date,$6,$7) RETURNING *,day_date::text AS date_key",
    [dayId,workerId,orderId,order.object_id,day.date_key,startAt,txt(p.notes,5000,AppError)])).rows[0];
  }else{
   const id=uuid(p.id),revision=positiveRevision(p.revision,AppError);
   const identity=(await client.query('SELECT worker_id FROM public.mvp_worker_tasks WHERE id=$1',[id])).rows[0];
   if(!identity)throw new AppError(404,'Задача не найдена.');
   await client.query("SELECT pg_advisory_xact_lock(hashtext('mvp_worker_task|'||$1))",[identity.worker_id]);
   const task=(await client.query("SELECT *,day_date::text AS date_key FROM public.mvp_worker_tasks WHERE id=$1 FOR UPDATE",[id])).rows[0];
   if(!task||task.status!=='active'||task.revision!==revision)throw new AppError(409,'Задача изменилась или уже завершена.');
   const day=(await client.query("SELECT status,arrival_at FROM public.mvp_worker_days WHERE id=$1 FOR UPDATE",[task.worker_day_id])).rows[0];
   if(!day||day.status!=='open')throw new AppError(409,'Задачу нельзя завершить после закрытия смены.');
   const endAt=localStamp(p.endAt,task.date_key,AppError),duration=minutes(task.start_at,endAt);
   if(duration<=0||duration>1440)throw new AppError(400,'Окончание задачи должно быть позже начала.');
   const taskType=txt(p.taskType,200,AppError,true);
   if(taskType==='WORK_SESSION')throw new AppError(400,'Укажи реальный вид выполненной работы.');
   const outcome=String(p.outcome??'');
   if(!OUTCOMES.has(outcome))throw new AppError(400,'Выбери результат выполнения задачи.');
   const management=nonnegativeInt(p.managementMinutes,1440,AppError,true);
   if(management>duration)throw new AppError(400,'Вмешательство не может превышать время задачи.');
   const qty=String(p.resultQty??'').trim();
   let resultQty=null;
   if(qty){
    if(!/^\d{1,11}(\.\d{1,3})?$/.test(qty))throw new AppError(400,'Количество: неотрицательное число до трёх знаков после точки.');
    resultQty=Number(qty);
   }
   const unit=txt(p.resultUnit,100,AppError);
   if(resultQty>0&&!unit)throw new AppError(400,'Укажи единицу измерения результата.');
   const problem=flag(p.problem,AppError),problemType=txt(p.problemType,500,AppError);
   if(problem&&!problemType)throw new AppError(400,'Укажи возникшую проблему.');
   const rework=flag(p.rework,AppError),reworkMinutes=rework?nonnegativeInt(p.reworkMinutes,1440,AppError):0;
   if(reworkMinutes>duration)throw new AppError(400,'Переделка не может превышать время задачи.');
   const notes=p.notes===undefined?task.notes:txt(p.notes,5000,AppError);
   item=(await client.query("UPDATE public.mvp_worker_tasks SET status='completed',task_type=$2,end_at=$3,duration_minutes=$4,result_qty=$5,result_unit=$6,management_minutes=$7,outcome=$8,problem=$9,problem_type=$10,rework=$11,rework_minutes=$12,notes=$13,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *,day_date::text AS date_key",
    [id,taskType,endAt,duration,resultQty,unit,management,outcome,problem,problem?problemType:'',rework,reworkMinutes,notes])).rows[0];
  }
  const response={saved:true,item};
  await client.query('UPDATE public.mvp_worker_task_requests SET response=$2::jsonb WHERE request_key=$1',[key,JSON.stringify(response)]);
  await client.query('COMMIT');return response;
 }catch(e){await client.query('ROLLBACK').catch(()=>{});if(e?.code==='23505')throw new AppError(409,'У исполнителя уже идёт задача. Обнови экран.');throw e;}
 finally{client.release();}
}

export async function workerTasksRead(pool,url,{uuid,safeDate,AppError}){
 const rawLimit=Number(url.searchParams.get('limit')||25);
 if(!Number.isInteger(rawLimit)||rawLimit<1||rawLimit>50)throw new AppError(400,'Страница задач: 1–50.');
 const workerId=url.searchParams.get('workerId')?uuid(url.searchParams.get('workerId')):null;
 const dayDate=url.searchParams.get('date')?safeDate(url.searchParams.get('date')):null;
 const orderId=url.searchParams.get('orderId')?uuid(url.searchParams.get('orderId')):null;
 const workerDayId=url.searchParams.get('workerDayId')?uuid(url.searchParams.get('workerDayId')):null;
 let cursor=null;
 if(url.searchParams.has('cursor')){
  const value=url.searchParams.get('cursor')||'';
  if(value.length>400||!/^[A-Za-z0-9_-]+$/.test(value))throw new AppError(400,'Неверная страница задач.');
  try{const x=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));if(!Array.isArray(x)||x.length!==2)throw Error();cursor=[safeDate(x[0]),uuid(x[1])];}
  catch{throw new AppError(400,'Неверная страница задач.');}
 }
 const params=[],where=["t.status<>'archived'"];
 for(const [field,value,cast] of [['t.worker_id',workerId,'::uuid'],['t.day_date',dayDate,'::date'],['t.order_id',orderId,'::uuid'],['t.worker_day_id',workerDayId,'::uuid']]){
  if(value){params.push(value);where.push(field+'=$'+params.length+cast);}
 }
 if(cursor){params.push(...cursor);where.push('(t.day_date,t.id)<($'+(params.length-1)+'::date,$'+params.length+'::uuid)');}
 params.push(rawLimit+1);
 const q=await pool.query('SELECT t.*,t.day_date::text AS day_date,w.name AS worker_name,o.title AS order_title FROM public.mvp_worker_tasks t JOIN public.mvp_workers w ON w.id=t.worker_id JOIN public.mvp_orders o ON o.id=t.order_id WHERE '+where.join(' AND ')+' ORDER BY t.day_date DESC,t.id DESC LIMIT $'+params.length,params);
 const items=q.rows.slice(0,rawLimit),more=q.rows.length>rawLimit;
 return {items,hasMore:more,nextCursor:more?Buffer.from(JSON.stringify([items.at(-1).day_date,items.at(-1).id])).toString('base64url'):null};
}
