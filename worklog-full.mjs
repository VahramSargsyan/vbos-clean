/* VBOS Clean WorkLog full legacy-parity writer.
 * Canonical WorkLog UUID remains public.mvp_work_logs.id; extended facts live in
 * additive 1:1 details. No worker-payroll or approved-benchmark side effects.
 * Date/clock are Yerevan wall time, never inferred from UTC event timestamps.
 */
import {createHash} from 'node:crypto';
const PERFORMERS=['OWNER','WORKER','JOINT'];
const REWORK=['no','yes','disputed'];
const REASONS=['','lunch','materials','tool','chasing','waiting','call','helper','project','reschedule','coordination','travel','coffee','other'];
function required(value,name,max,AppError){
 const t=String(value??'').trim();
 if(!t||t.length>max)throw new AppError(400,name+': укажи корректное значение.');
 return t;
}
function optional(value,name,max,AppError){
 const t=String(value??'').trim();
 if(t.length>max)throw new AppError(400,name+': текст слишком длинный.');
 return t;
}
function enumValue(value,allowed,name,AppError){
 if(!allowed.includes(value))throw new AppError(400,'Неверное значение: '+name);
 return value;
}
function clock(value,name,AppError){
 const t=String(value??'');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))throw new AppError(400,'Некорректное время: '+name);
 return t;
}
function clockMin(t){return Number(t.slice(0,2))*60+Number(t.slice(3,5));}
function amount(value,name,scale,AppError){
 if(value===undefined||value===null||String(value).trim()==='')return null;
 const s=String(value).trim();
 if(!/^\d{1,11}(?:\.\d{1,3})?$/.test(s)||Number(s)>99999999999||
    (scale===2&&s.includes('.')&&s.split('.')[1].length>2))
  throw new AppError(400,'Некорректное количество: '+name);
 return Number(s);
}
function nonnegativeInt(value,name,AppError){
 const n=Number(value??0);
 if(!Number.isInteger(n)||n<0||n>1440)throw new AppError(400,name+': укажи 0–1440 минут.');
 return n;
}
function normalize(p,{safeDate,uuid,AppError}){
 const orderId=uuid(p.orderId);
 const dayDate=safeDate(p.dayDate);
 const startClock=clock(p.startClock,'начало',AppError);
 const endClock=clock(p.endClock,'конец',AppError);
 const elapsed=clockMin(endClock)-clockMin(startClock);
 if(elapsed<1||elapsed>1440)throw new AppError(400,'Конец работы должен быть позже начала в один день.');
 const mode=enumValue(p.performerMode||'OWNER',PERFORMERS,'исполнитель',AppError);
 const workerId=mode==='OWNER'?null:uuid(p.workerId);
 const location=required(p.location,'Зона работы',300,AppError);
 const workType=required(p.workType,'Вид работы',180,AppError);
 const workDetail=optional(p.workDetail,'Детали',2000,AppError);
 const serviceId=optional(p.serviceId,'Код услуги',100,AppError);
 const quantity=amount(p.quantity,'Результат',3,AppError);
 const unit=optional(p.unit,'Единица',30,AppError);
 if(quantity!==null&&quantity>0&&!unit)throw new AppError(400,'Укажи единицу измерения результата.');
 const points=amount(p.points,'Точки',2,AppError);
 const nodes=amount(p.nodes,'Узлы',2,AppError);
 const meters=amount(p.meters,'Метры',2,AppError);
 const complexity=Number(p.complexity??3);
 if(!Number.isInteger(complexity)||complexity<1||complexity>5)
  throw new AppError(400,'Сложность: от 1 до 5.');
 const lossMinutes=nonnegativeInt(p.lossMinutes,'Потери',AppError);
 if(lossMinutes>=elapsed)throw new AppError(400,'Потери не могут занимать всё рабочее время.');
 const cleanMinutes=elapsed-lossMinutes;
 const lossReason=lossMinutes?required(p.lossReason,'Причина потерь',300,AppError):'';
 const reworkStatus=enumValue(p.reworkStatus||'no',REWORK,'переделка',AppError);
 const reworkReason=reworkStatus==='no'?'':required(p.reworkReason,'Причина переделки',300,AppError);
 const reworkMinutes=reworkStatus==='no'?0:nonnegativeInt(p.reworkMinutes,'Переделка',AppError);
 if(reworkMinutes>elapsed)throw new AppError(400,'Время переделки больше интервала работы.');
 const gapReason=enumValue(p.gapReason||'',REASONS,'причина разрыва',AppError);
 const successorGapReason=enumValue(p.successorGapReason||'',REASONS,'причина разрыва перед следующей работой',AppError);
 const comment=optional(p.comment,'Комментарий',5000,AppError);
 const notes=optional(p.notes,'Заметки',5000,AppError);
 return {orderId,dayDate,startClock,endClock,elapsed,mode,workerId,location,workType,workDetail,serviceId,
  quantity,unit,points,nodes,meters,complexity,lossMinutes,cleanMinutes,lossReason,
  reworkStatus,reworkReason,reworkMinutes,gapReason,successorGapReason,comment,notes};
}
const payloadDigest=(f,target,revision)=>createHash('sha256').update(JSON.stringify([target||'',revision||0,...Object.values(f)])).digest('hex');
const TIME_GAP_MINUTES=15;
function affectsSamePerson(a,b){
 return ((a.mode!=='WORKER')&&(b.performer_mode!=='WORKER')) ||
  Boolean(a.workerId&&b.worker_id===a.workerId);
}
function clockText(value){return String(value).slice(0,5);}
async function gapsTx(client,f,workDayId,exceptId,AppError){
 const all=await client.query(
  'SELECT work_log_id,performer_mode,worker_id,start_clock::text AS start_clock,'+
  'end_clock::text AS end_clock,gap_reason FROM public.mvp_work_log_details '+
  'WHERE work_day_id=$1 AND ($2::uuid IS NULL OR work_log_id<>$2) '+
  'ORDER BY start_clock,work_log_id LIMIT 501',[workDayId,exceptId||null]);
 if(all.rows.length>500)throw new AppError(409,'Слишком много работ за день для безопасной проверки.');
 const rows=all.rows.filter(x=>affectsSamePerson(f,x));
 const start=clockMin(f.startClock),end=clockMin(f.endClock);
 if(rows.some(x=>clockMin(clockText(x.start_clock))<end&&clockMin(clockText(x.end_clock))>start))
  throw new AppError(409,'Время работы пересекается с другой записью этого исполнителя.');
 let previous=null,successor=null;
 for(const x of rows){
  const s=clockMin(clockText(x.start_clock)),e=clockMin(clockText(x.end_clock));
  if(e<=start&&(!previous||e>previous.end))previous={row:x,end:e};
  if(s>=end&&(!successor||s<successor.start))successor={row:x,start:s};
 }
 const gap=previous?start-previous.end:0;
 if(gap>TIME_GAP_MINUTES&&!f.gapReason)
  throw new AppError(409,'Разрыв '+gap+' мин перед работой. Выбери причину разрыва.');
 // The record after this work will acquire a different predecessor. Revalidate
 // its reason rather than leaving silently stale time-accounting metadata.
 let successorAction=null;
 if(successor){
  const afterGap=successor.start-end;
  if(afterGap>TIME_GAP_MINUTES&&!(f.successorGapReason||successor.row.gap_reason))
   throw new AppError(409,'После этой работы перед следующей разрыв '+afterGap+' мин. Укажи причину для следующей записи.');
  successorAction={id:successor.row.work_log_id,
   reason:afterGap>TIME_GAP_MINUTES?(f.successorGapReason||successor.row.gap_reason):''};
 }
 return {reason:gap>TIME_GAP_MINUTES?f.gapReason:'',gap,successorAction};
}
async function workerGateTx(client,f,AppError){
 if(!f.workerId)return;
 const w=await client.query(
  "SELECT w.id FROM public.mvp_workers w JOIN public.mvp_worker_order_assignments a "+
  "ON a.worker_id=w.id AND a.order_id=$2 AND a.status='active' "+
  "WHERE w.id=$1 AND w.status='active' LIMIT 1",[f.workerId,f.orderId]);
 if(!w.rowCount)throw new AppError(409,'Помощник должен быть активен и назначен на этот заказ.');
 const open=await client.query(
  "SELECT d.id FROM public.mvp_worker_days d JOIN public.mvp_worker_day_orders a "+
  "ON a.worker_day_id=d.id AND a.work_order_id=$2 AND a.status='active' "+
  "WHERE d.worker_id=$1 AND d.day_date=$3::date AND d.status='open' LIMIT 1",
  [f.workerId,f.orderId,f.dayDate]);
 if(!open.rowCount)throw new AppError(409,'У помощника должна быть открыта смена по этому заказу и дате.');
}
async function referenceGateTx(client,f,AppError){
 if(!f.serviceId)return;
 const r=await client.query("SELECT service_id FROM public.mvp_services_reference WHERE service_id=$1 AND status='active' LIMIT 1",[f.serviceId]);
 if(!r.rowCount)throw new AppError(409,'Услуга не найдена в активном проверенном справочнике.');
}
async function lockWorkdayTx(client,f,AppError){
 const order=await client.query('SELECT id,status FROM public.mvp_orders WHERE id=$1',[f.orderId]);
 if(!order.rowCount||!['open','active'].includes(order.rows[0].status))
  throw new AppError(409,'Заказ завершён, отменён или не найден.');
 const legacy=await client.query(
  "SELECT source_payload->>'status' AS status FROM public.mvp_legacy_import_map "+
  "WHERE source_system='Working IP APP / M8C cutover baseline' "+
  "AND source_entity='WorkOrders' AND target_id=$1 LIMIT 1",[f.orderId]);
 if(legacy.rowCount&&['completed','cancelled','archived'].includes(legacy.rows[0].status))
  throw new AppError(409,'Исходный Google-заказ завершён или закрыт для новых работ.');
 const day=await client.query('SELECT id,status FROM public.mvp_work_days WHERE day_date=$1::date FOR UPDATE',[f.dayDate]);
 if(!day.rowCount||day.rows[0].status!=='open')
  throw new AppError(409,'Открой рабочий день нужной даты перед записью фактической работы.');
 const linked=await client.query('SELECT id FROM public.mvp_sessions WHERE day_id=$1 AND order_id=$2 LIMIT 1',[day.rows[0].id,f.orderId]);
 if(!linked.rowCount)throw new AppError(409,'Сначала выбери этот заказ в текущем рабочем дне («Начать работу»).');
 return day.rows[0].id;
}
const DETAIL_COLUMNS=['work_log_id','payload_sha256','work_day_id','performer_mode','worker_id','start_clock',
 'end_clock','location','work_type','work_detail','service_id','points','nodes','meters','complexity',
 'loss_minutes','loss_reason','clean_minutes','rework_status','rework_reason','rework_minutes','gap_reason','comment'];
function detailsValues(id,hash,day,f,reason){
 return [id,hash,day,f.mode,f.workerId,f.startClock,f.endClock,f.location,f.workType,f.workDetail,f.serviceId,
  f.points,f.nodes,f.meters,f.complexity,f.lossMinutes,f.lossReason,f.cleanMinutes,
  f.reworkStatus,f.reworkReason,f.reworkMinutes,reason,f.comment];
}
async function findSaved(client,id){
 const q=await client.query('SELECT l.*,l.day_date::text AS day_date,to_jsonb(d) AS detail FROM public.mvp_work_logs l LEFT JOIN public.mvp_work_log_details d ON d.work_log_id=l.id WHERE l.id=$1',[id]);
 return q.rows[0]||null;
}
export async function workLogFullAction({pool,type,p,key,uuid,safeDate,safeRevision,AppError}){
 const updating=type==='work_log_full_update';
 const existingId=updating?uuid(p.id):null;
 const f=normalize(p,{safeDate,uuid,AppError});
 const revision=updating?safeRevision(p.revision):0;
 const hash=payloadDigest(f,existingId,revision);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  if(updating){
   const prior=await client.query('SELECT * FROM public.mvp_work_log_full_requests WHERE request_key=$1',[key]);
   if(prior.rowCount){
    if(prior.rows[0].payload_sha256!==hash||prior.rows[0].work_log_id!==existingId)
     throw new AppError(409,'Ключ запроса уже использован с другими данными.');
    const old=await findSaved(client,existingId);
    if(!old)throw new AppError(409,'Повторная запись больше не найдена.');
    await client.query('COMMIT');
    return {saved:true,item:old,deduplicated:true};
   }
  }else{
   const prior=await client.query(
    'SELECT l.id,d.payload_sha256 FROM public.mvp_work_logs l '+
    'LEFT JOIN public.mvp_work_log_details d ON d.work_log_id=l.id WHERE l.request_key=$1',[key]);
   if(prior.rowCount){
    if(prior.rows[0].payload_sha256!==hash)
     throw new AppError(409,'Ключ записи уже использован с другими данными.');
    const old=await findSaved(client,prior.rows[0].id);
    await client.query('COMMIT');
    return {saved:true,item:old,deduplicated:true};
   }
  }
  const day=await lockWorkdayTx(client,f,AppError);
  await workerGateTx(client,f,AppError);
  await referenceGateTx(client,f,AppError);
  if(updating){
   const existing=await findSaved(client,existingId);
   if(!existing||!existing.detail)throw new AppError(409,'Подробная запись отсутствует. Сокращённый WorkLog редактируй через старую форму.');
   if(existing.revision!==revision)throw new AppError(409,'Запись изменена. Обнови историю.');
   if(existing.order_id!==f.orderId||String(existing.day_date).slice(0,10)!==f.dayDate)
    throw new AppError(409,'Перенос полного WorkLog в другой заказ/день требует отдельной проверки связей.');
  }
  const gap=await gapsTx(client,f,day,existingId,AppError);
  let row;
  if(updating){
   const updated=await client.query(
    'UPDATE public.mvp_work_logs SET title=$3,minutes=$4,quantity=$5,unit=$6,notes=$7,'+
    'revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *',
    [existingId,revision,f.workType,f.elapsed,f.quantity,f.unit,f.notes]);
   if(updated.rowCount!==1)throw new AppError(409,'Запись изменилась в другой сессии.');
   row=updated.rows[0];
   const fields=DETAIL_COLUMNS.slice(1);
   const sql=fields.map((column,i)=>column+'=$'+(i+2)).join(',');
   const vals=detailsValues(existingId,hash,day,f,gap.reason).slice(1);
   const changed=await client.query(
    'UPDATE public.mvp_work_log_details SET '+sql+',updated_at=now() WHERE work_log_id=$1',
    [existingId,...vals]);
   if(changed.rowCount!==1)throw new AppError(503,'Детали записи не найдены.');
   await client.query(
    'INSERT INTO public.mvp_work_log_full_requests(request_key,work_log_id,payload_sha256,saved_revision) VALUES($1,$2,$3,$4)',
    [key,existingId,hash,row.revision]);
  }else{
   const newLog=await client.query(
    'INSERT INTO public.mvp_work_logs(request_key,day_date,order_id,title,minutes,quantity,unit,notes) '+
    'VALUES($1,$2::date,$3,$4,$5,$6,$7,$8) RETURNING *',
    [key,f.dayDate,f.orderId,f.workType,f.elapsed,f.quantity,f.unit,f.notes]);
   row=newLog.rows[0];
   const vals=detailsValues(row.id,hash,day,f,gap.reason);
   const placeholders=vals.map((_,i)=>'$'+(i+1));
   await client.query('INSERT INTO public.mvp_work_log_details('+DETAIL_COLUMNS.join(',')+
    ') VALUES('+placeholders.join(',')+')',vals);
  }
  if(gap.successorAction)
   await client.query('UPDATE public.mvp_work_log_details SET gap_reason=$2,updated_at=now() WHERE work_log_id=$1',
    [gap.successorAction.id,gap.successorAction.reason]);
  const result=await findSaved(client,row.id);
  await client.query('COMMIT');
  return {saved:true,item:result,derived:{elapsedMinutes:f.elapsed,cleanMinutes:f.cleanMinutes,gapMinutes:gap.gap}};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
 finally{client.release();}
}
export async function workLogFullContextRead({pool,url,uuid,safeDate,AppError}){
 const f={
  orderId:uuid(url.searchParams.get('orderId')),
  dayDate:safeDate(url.searchParams.get('dayDate')),
  startClock:clock(url.searchParams.get('startClock'),'начало',AppError),
  // The advisory gap before a new WorkLog is available before the end time is entered.
  endClock:url.searchParams.get('endClock')?clock(url.searchParams.get('endClock'),'конец',AppError):null,
  mode:enumValue(url.searchParams.get('performerMode')||'OWNER',PERFORMERS,'исполнитель',AppError),
  workerId:null
 };
 f.workerId=f.mode==='OWNER'?null:uuid(url.searchParams.get('workerId'));
 if(f.endClock&&clockMin(f.endClock)<=clockMin(f.startClock))
  throw new AppError(400,'Время окончания должно быть позже начала.');
 // Advisory lookup may skip the currently edited WorkLog; the real writer still validates all links and overlaps.
 const exceptId=url.searchParams.get('recordId')?uuid(url.searchParams.get('recordId')):null;
 const day=await pool.query("SELECT id FROM public.mvp_work_days WHERE day_date=$1::date AND status='open'",[f.dayDate]);
 if(!day.rowCount)return {ready:false,reason:'WORK_DAY_NOT_OPEN',gapMinutes:0,overlap:false,source:'CANONICAL_WORKLOG_DETAIL_ONLY'};
 const rows=await pool.query(
  'SELECT work_log_id,performer_mode,worker_id,start_clock::text AS start_clock,end_clock::text AS end_clock,gap_reason '+
  'FROM public.mvp_work_log_details WHERE work_day_id=$1 AND ($2::uuid IS NULL OR work_log_id<>$2) '+
  'ORDER BY start_clock LIMIT 501',[day.rows[0].id,exceptId]);
 if(rows.rowCount>500)throw new AppError(409,'История рабочего дня требует постраничной проверки.');
 const same=rows.rows.filter(x=>affectsSamePerson(f,x));
 const start=clockMin(f.startClock),end=f.endClock?clockMin(f.endClock):start+1;
 let previous=0,following=null;
 for(const x of same){
  const s=clockMin(clockText(x.start_clock)),e=clockMin(clockText(x.end_clock));
  if(s<end&&e>start)return {ready:false,overlap:true,source:'CANONICAL_WORKLOG_DETAIL_ONLY'};
  if(e<=start&&e>previous)previous=e;
  if(s>=end&&(following===null||s<following))following=s;
 }
 return {ready:true,overlap:false,gapMinutes:previous?start-previous:0,
  successorGapMinutes:f.endClock&&following!==null?following-end:0,
  hasEndClock:Boolean(f.endClock),thresholdMinutes:TIME_GAP_MINUTES,
  source:'CANONICAL_WORKLOG_DETAIL_ONLY',unrecordedLegacyClocks:'NOT_INFERRED'};
}
