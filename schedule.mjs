/* VBOS Clean V9A: manual ScheduleItems only, source legacy ScheduleService.js. */
import {createHash} from 'node:crypto';
import {syncManualPlanWorkerTx} from './workers.mjs';
import {capacityCalendarDayPolicy} from './capacity.mjs';
const STATUSES=['planned','completed','cancelled','archived'];
const COLUMNS="s.id,s.source_kind,s.auto_source_key,s.status,s.start_at,s.end_at,s.schedule_date::text AS schedule_date,s.object_id,s.order_id,s.item_type,s.title,s.notes,s.revision,s.archived_at,s.created_at,s.updated_at,ob.name AS object_name,ob.address AS object_address,o.title AS order_title,o.status AS order_status,"+
" CASE WHEN s.source_kind='work_order' THEN "+
"COALESCE((SELECT string_agg(w.name,' · ' ORDER BY w.name,w.id) "+
"FROM public.mvp_worker_order_assignments a JOIN public.mvp_workers w ON w.id=a.worker_id "+
"WHERE a.order_id=s.order_id AND a.status='active'),'') "+
"WHEN s.source_kind='manual' THEN COALESCE((SELECT string_agg(w.name,' · ' ORDER BY w.name,w.id) "+
"FROM public.mvp_manual_plan_workers a JOIN public.mvp_workers w ON w.id=a.worker_id "+
"WHERE a.plan_id=s.id AND a.status='active'),'') ELSE '' END AS worker_names";
const JOINS=" FROM public.mvp_schedule_items s LEFT JOIN public.mvp_objects ob ON ob.id=s.object_id LEFT JOIN public.mvp_orders o ON o.id=s.order_id";
const localMinute=x=>new Date(new Date(x).getTime()+14400000).toISOString().slice(0,16);
const localDay=x=>localMinute(x).slice(0,10);
const dayOffset=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const txt=(v,n,Err,optional=false)=>{const a=String(v??'').trim();if(a.length>n||(!optional&&!a))throw new Err(400,'Проверь текст плана.');return a;};
function clock(v,safeDate,Err){
 const s=String(v||'').trim();
 if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(s))throw new Err(400,'Некорректная дата или время.');
 safeDate(s.slice(0,10));
 const at=new Date(s+':00+04:00');
 if(!Number.isFinite(at.valueOf())||localMinute(at)!==s)throw new Err(400,'Некорректное время Еревана.');
 return at.toISOString();
}
// Reuse the exact canonical Week/Month bounds for read-only hourly legacy parity.
export {period as schedulePeriod};
function period(anchor,mode){
 if(mode==='month')return {start:anchor.slice(0,7)+'-01',end:new Date(Date.UTC(+anchor.slice(0,4),+anchor.slice(5,7),0)).toISOString().slice(0,10)};
 const offset=(new Date(anchor+'T00:00:00Z').getUTCDay()+6)%7,start=dayOffset(anchor,-offset);
 return {start,end:dayOffset(start,6)};
}
function cursor(raw,uuid,Err){
 if(!raw)return null;
 if(raw.length>500||!/^[\w-]+$/.test(raw))throw new Err(400,'Недопустимая страница плана.');
 try{
  const c=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
  if(!Array.isArray(c)||c.length!==2||new Date(c[0]).toISOString()!==c[0])throw Error('bad');
  return [c[0],uuid(c[1])];
 }catch{throw new Err(400,'Недопустимая страница плана.');}
}
export async function scheduleRead(pool,url,{dayYerevan,safeDate,uuid,AppError}){
 const mode=String(url.searchParams.get('viewMode')||'week');
 if(!['week','month'].includes(mode))throw new AppError(400,'Выбери неделю или месяц.');
 const anchor=safeDate(url.searchParams.get('anchorDate')||dayYerevan()),p=period(anchor,mode);
 const c=cursor(url.searchParams.get('cursor'),uuid,AppError);
 const params=[p.start,p.end],where=" WHERE s.schedule_date BETWEEN $1::date AND $2::date AND s.status<>'archived'";
 if(c)params.push(...c);
 const after=c?' AND (s.start_at,s.id)>($3::timestamptz,$4::uuid)':'';
 const fromTable=table=>('SELECT '+COLUMNS+','+(table==='mvp_schedule_lead_items'?'s.lead_id':'NULL::uuid')+
  ' AS lead_id'+JOINS.replace('FROM public.mvp_schedule_items s','FROM public.'+table+' s')+where+after);
 // Both canonical sources expose the exact same ScheduleItem contract. Never fabricate an
 // automatic item from order.planned_on at read time; writes commit the mirror atomically.
 const sql='SELECT * FROM ('+fromTable('mvp_schedule_items')+
   ' UNION ALL '+fromTable('mvp_schedule_order_items')+
   ' UNION ALL '+fromTable('mvp_schedule_lead_items')+
   ') AS scheduled ORDER BY start_at,id LIMIT 51';
 const [list,count]=await Promise.all([
  pool.query(sql,params),
  pool.query("SELECT ((SELECT count(*) FROM public.mvp_schedule_items WHERE schedule_date BETWEEN $1::date AND $2::date AND status<>'archived')+(SELECT count(*) FROM public.mvp_schedule_order_items WHERE schedule_date BETWEEN $1::date AND $2::date AND status<>'archived')+(SELECT count(*) FROM public.mvp_schedule_lead_items WHERE schedule_date BETWEEN $1::date AND $2::date AND status<>'archived'))::int AS n",[p.start,p.end])
 ]);
 const items=list.rows.slice(0,50),last=items.at(-1),hasMore=list.rows.length>50;
 return {viewMode:mode,anchorDate:anchor,periodStart:p.start,periodEnd:p.end,
  calendarDayPolicy:capacityCalendarDayPolicy(p.start,p.end),items,total:count.rows[0].n,hasMore,
  nextCursor:hasMore&&last?Buffer.from(JSON.stringify([new Date(last.start_at).toISOString(),last.id])).toString('base64url'):null,
  source:'mvp_schedule_items+mvp_schedule_order_items+mvp_schedule_lead_items',sourceKind:'manual+work_order+crm',autoWorkOrderSync:'ENABLED',autoCrmSync:'ENABLED',workerAssignment:'NOT_IMPLEMENTED'};
}
const version=(v,Err)=>{
 const n=Number(v);if(!Number.isInteger(n)||n<0||n>=2147483647)throw new Err(400,'Некорректная версия плана.');return n;
};
export async function scheduleAction({pool,type,p,key,uuid,safeDate,AppError}){
 if(!['schedule_save','schedule_archive'].includes(type))throw new AppError(404,'Неизвестное действие плана.');
 const id=p.id?uuid(p.id):null,rev=version(p.revision,AppError);
 if(type==='schedule_archive'&&!id)throw new AppError(400,'Не указан план.');
 if((!id&&rev!==0)||(id&&rev<1))throw new AppError(400,'План изменился. Обнови экран.');
 const submitted=Object.keys(p).filter(k=>k!=='requestKey').sort().map(k=>[k,p[k]]);
 const digest=createHash('sha256').update(JSON.stringify({type,submitted})).digest('hex');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const receipt=await client.query("INSERT INTO public.mvp_schedule_requests(request_key,action,payload_sha256,response) VALUES($1,$2,$3,'{}'::jsonb) ON CONFLICT(request_key) DO NOTHING RETURNING request_key",[key,type,digest]);
  if(!receipt.rowCount){
   const old=await client.query('SELECT action,payload_sha256,response FROM public.mvp_schedule_requests WHERE request_key=$1',[key]);
   if(!old.rows.length||old.rows[0].action!==type||old.rows[0].payload_sha256!==digest)throw new AppError(409,'Ключ плана уже использован с другими данными.');
   await client.query('COMMIT');return {...old.rows[0].response,deduplicated:true};
  }
  const previous=id?await client.query('SELECT * FROM public.mvp_schedule_items WHERE id=$1 FOR UPDATE',[id]):null;
  const old=previous?.rows[0]||null;
  if(id&&!old)throw new AppError(404,'План не найден.');
  if(old&&old.revision!==rev)throw new AppError(409,'План изменился в другой вкладке.');
  if(old?.status==='archived')throw new AppError(409,'Архивный план менять нельзя.');
  // Auto items belong to WorkOrders and are managed only through order actions.
  // This source table owns only manual items, never a projected order record.
  let savedId;
  if(type==='schedule_archive'){
   const r=await client.query("UPDATE public.mvp_schedule_items SET status='archived',archived_at=now(),revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id",[id]);
   savedId=r.rows[0].id;
  }else{
   const start=clock(p.startAt===undefined?(old?localMinute(old.start_at):''):p.startAt,safeDate,AppError);
   const end=clock(p.endAt===undefined?(old?localMinute(old.end_at):''):p.endAt,safeDate,AppError);
   if(new Date(end)<=new Date(start))throw new AppError(400,'Окончание должно быть позже начала.');
   const status=p.status===undefined?(old?.status||'planned'):String(p.status);
   if(!STATUSES.includes(status)||status==='archived')throw new AppError(400,'Некорректный статус плана.');
   const orderId=p.orderId===undefined?(old?.order_id||null):(p.orderId?uuid(p.orderId):null);
   const relChanged=p.orderId!==undefined&&String(orderId||'')!==String(old?.order_id||'');
   let objectId=p.objectId===undefined?(relChanged?null:old?.object_id||null):(p.objectId?uuid(p.objectId):null);
   let order=null,ob=null;
   if(orderId){
    order=(await client.query('SELECT id,object_id,title,status FROM public.mvp_orders WHERE id=$1',[orderId])).rows[0];
    if(!order)throw new AppError(400,'Заказ не найден.');
    if(objectId&&objectId!==order.object_id)throw new AppError(400,'Объект не соответствует заказу.');
    objectId=order.object_id;
    if((!old||relChanged)&&['done','cancelled'].includes(order.status))throw new AppError(409,'Нельзя планировать новый пункт для завершённого или отменённого заказа.');
   }
   if(objectId){
    ob=(await client.query('SELECT id,name,address FROM public.mvp_objects WHERE id=$1',[objectId])).rows[0];
    if(!ob)throw new AppError(400,'Объект не найден.');
   }
   const kind=txt(p.itemType===undefined?(old?.item_type||'Работа'):p.itemType,120,AppError);
   const title=txt(p.title===undefined?(old?.title||order?.title||ob?.name||kind):p.title,300,AppError);
   const notes=txt(p.notes===undefined?(old?.notes||''):p.notes,5000,AppError,true);
   if(old){
    const r=await client.query('UPDATE public.mvp_schedule_items SET status=$2,start_at=$3::timestamptz,end_at=$4::timestamptz,schedule_date=$5::date,object_id=$6,order_id=$7,item_type=$8,title=$9,notes=$10,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING id',[id,status,start,end,localDay(start),objectId,orderId,kind,title,notes]);
    savedId=r.rows[0].id;
   }else{
    const r=await client.query('INSERT INTO public.mvp_schedule_items(status,start_at,end_at,schedule_date,object_id,order_id,item_type,title,notes) VALUES($1,$2::timestamptz,$3::timestamptz,$4::date,$5,$6,$7,$8,$9) RETURNING id',[status,start,end,localDay(start),objectId,orderId,kind,title,notes]);
    savedId=r.rows[0].id;
   }
  }
  if(type==='schedule_save')await syncManualPlanWorkerTx(client,savedId,p.workerId,uuid,AppError);
  const item=(await client.query('SELECT '+COLUMNS+JOINS+' WHERE s.id=$1',[savedId])).rows[0];
  const result={saved:true,item};
  await client.query('UPDATE public.mvp_schedule_requests SET response=$2::jsonb WHERE request_key=$1',[key,JSON.stringify(result)]);
  await client.query('COMMIT');return result;
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
 finally{client.release();}
}
