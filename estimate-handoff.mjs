/**
 * CRM-16A. Exact explicit legacy-compatible commercial handoff:
 * draft estimate -> owner accepts -> one NEW native open Order, in one DB transaction.
 * No invented price, finance/payment, legacy Google write or calendar booking.
 */
import {createHash} from 'node:crypto';
export async function estimateAcceptHandoff({pool,p,key,uuid,safeRevision,AppError}){
 const estimateId=uuid(p.estimateId),objectId=uuid(p.objectId),revision=safeRevision(p.revision);
 if(p.confirm!=='ACCEPT_AND_CREATE_OPEN_ORDER')throw new AppError(400,'Подтверди согласование сметы и создание заказа.');
 const identity={estimateId,objectId,revision,confirm:p.confirm};
 const hash=createHash('sha256').update(JSON.stringify(identity)).digest('hex');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const claimed=await db.query(
   'INSERT INTO public.mvp_estimate_handoff_requests(request_key,estimate_id,payload_sha256) VALUES($1,$2,$3) ON CONFLICT(request_key) DO NOTHING RETURNING request_key',
   [key,estimateId,hash]);
  if(!claimed.rowCount){
   const old=(await db.query('SELECT estimate_id,payload_sha256,response FROM public.mvp_estimate_handoff_requests WHERE request_key=$1',[key])).rows[0];
   if(!old||old.estimate_id!==estimateId||old.payload_sha256!==hash)
    throw new AppError(409,'Ключ согласования уже использован для другого расчёта.');
   await db.query('COMMIT');
   return {...old.response,deduplicated:true};
  }
  const estimate=(await db.query('SELECT * FROM public.mvp_estimates WHERE id=$1 FOR UPDATE',[estimateId])).rows[0];
  if(!estimate)throw new AppError(404,'Черновик сметы не найден.');
  if(estimate.status!=='draft')throw new AppError(409,'Смета уже согласована или закрыта.');
  if(estimate.revision!==revision)throw new AppError(409,'Версия сметы изменилась. Перечитай перед согласованием.');
  const lead=(await db.query('SELECT id,status FROM public.mvp_leads WHERE id=$1 FOR KEY SHARE',[estimate.source_lead_id])).rows[0];
  if(!lead||lead.status!=='won')throw new AppError(409,'Сначала заверши лид через подтверждённую связь с клиентом.');
  const link=(await db.query('SELECT client_id,object_id FROM public.mvp_crm_lead_client_links WHERE lead_id=$1',[lead.id])).rows[0];
  if(!link)throw new AppError(409,'У лида нет подтверждённой связи с клиентом.');
  if(link.object_id&&link.object_id!==objectId)
   throw new AppError(409,'Выбранный объект не совпадает с объектом преобразования лида.');
  const selected=(await db.query('SELECT o.id,o.client_id,c.status AS client_status FROM public.mvp_objects o JOIN public.mvp_clients c ON c.id=o.client_id WHERE o.id=$1 FOR KEY SHARE OF o,c',[objectId])).rows[0];
  if(!selected||selected.client_id!==link.client_id)throw new AppError(409,'Объект принадлежит другому клиенту.');
  if(selected.client_status==='archived')throw new AppError(409,'Клиент архивирован. Согласование остановлено.');
  const oldArchive=await db.query("SELECT 1 FROM public.mvp_legacy_import_map WHERE source_entity='Clients' AND target_id=$1 AND source_payload->>'status'='archived' LIMIT 1",[link.client_id]);
  if(oldArchive.rowCount)throw new AppError(409,'Исходный клиент архивирован в старом VBOS.');
  const sums=(await db.query(
   "SELECT count(*)::int AS lines,count(*) FILTER(WHERE unit_price_amd IS NULL OR price_source='UNPRICED')::int AS unpriced,coalesce(sum(quantity*unit_price_amd),0)::numeric(20,3)::text AS total FROM public.mvp_estimate_lines WHERE estimate_id=$1 AND archived_at IS NULL",
   [estimateId])).rows[0];
  if(!sums||sums.lines<1||sums.unpriced>0)throw new AppError(409,'Сначала оцени все позиции сметы. Нельзя согласовать неполный расчёт.');
  // No WorkOrder schedule: planned_on stays NULL; existing V9B auto-projection is unaffected.
  const order=(await db.query(
   "INSERT INTO public.mvp_orders(request_key,object_id,lead_id,title,status,notes) VALUES($1,$2,$3,$4,'open',$5) RETURNING id,object_id,lead_id,status",
   [key,objectId,lead.id,estimate.title,'Основание: согласованная смета '+estimateId])).rows[0];
  if(!order||order.object_id!==objectId||order.lead_id!==lead.id)throw new AppError(500,'Связь нового заказа с лидом или объектом не подтверждена.');
  const accepted=(await db.query(
   "UPDATE public.mvp_estimates SET status='accepted',accepted_at=now(),accepted_revision=revision,accepted_total_amd=$2::numeric,work_order_id=$3,updated_at=now() WHERE id=$1 AND status='draft' AND revision=$4 RETURNING id,source_lead_id,revision,status,accepted_at,accepted_total_amd,work_order_id",
   [estimateId,sums.total,order.id,revision])).rows[0];
  if(!accepted)throw new AppError(409,'Смета была изменена во время согласования.');
  const result={saved:true,source:'CRM16A_EXPLICIT_ESTIMATE_TO_NATIVE_ORDER',estimateId,
   orderId:order.id,clientId:link.client_id,objectId,sourceLeadId:lead.id,
   acceptedRevision:revision,acceptedTotalAMD:sums.total,status:'accepted',orderStatus:'open'};
  await db.query('UPDATE public.mvp_estimate_handoff_requests SET response=$2::jsonb WHERE request_key=$1',[key,JSON.stringify(result)]);
  await db.query('COMMIT');
  return result;
 }catch(e){
  await db.query('ROLLBACK').catch(()=>{});
  if(e.code==='42P01'||e.code==='42703')throw new AppError(503,'Согласование смет ещё не установлено в TEST-базе.');
  if(e.code==='23505')throw new AppError(409,'Для этой сметы уже существует заказ или повторный запрос.');
  throw e;
 }finally{db.release();}
}
