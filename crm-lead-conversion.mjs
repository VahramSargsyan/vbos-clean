/**
 * VBOS Clean CRM-01. Explicit Lead -> Client conversion, no legacy data remapping.
 * New conversion links are canonical; existing direct Clients are grandfathered.
 * Exactly one transaction commits the Lead status, Client (new/reused),
 * optional validated Object context, immutable relation and request receipt.
 */
import {createHash} from 'node:crypto';
import {archiveLeadReminderTx} from './crm-reminders.mjs';

const digest=(type,p)=>createHash('sha256').update(JSON.stringify({
 type,entries:Object.keys(p).filter(k=>k!=='requestKey').sort().map(k=>[k,p[k]])
})).digest('hex');
const cleanText=(value,max,ErrorClass,label)=>{
 if(typeof value!=='string'||!value.trim()||value.trim().length>max)
  throw new ErrorClass(400,label+' обязательно, не длиннее '+max+' символов.');
 return value.trim();
};

export async function leadConversionAction({pool,p,key,uuid,safeRevision,AppError}){
 const leadId=uuid(p.leadId);
 const expectedRevision=safeRevision(p.revision);
 const requestedClient=p.clientId?uuid(p.clientId):null;
 const requestedObject=p.objectId?uuid(p.objectId):null;
 const newClientName=p.newClientName===undefined?'':String(p.newClientName).trim();
 if(newClientName.length>160)throw new AppError(400,'Имя клиента слишком длинное.');
 if(requestedClient&&newClientName)
  throw new AppError(400,'Нельзя одновременно создавать клиента и выбирать существующего.');
 if(requestedObject&&!requestedClient)
  throw new AppError(400,'Существующий объект можно выбрать только вместе с его клиентом.');
 const hash=digest('lead_convert',p);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const claim=await client.query(
   "INSERT INTO public.mvp_crm_conversion_requests(request_key,action,payload_sha256,response) VALUES($1,'lead_convert',$2,'{}'::jsonb) ON CONFLICT(request_key) DO NOTHING RETURNING request_key",
   [key,hash]);
  if(!claim.rowCount){
   const receipt=(await client.query('SELECT action,payload_sha256,response FROM public.mvp_crm_conversion_requests WHERE request_key=$1',[key])).rows[0];
   if(!receipt||receipt.action!=='lead_convert'||receipt.payload_sha256!==hash)
    throw new AppError(409,'Ключ преобразования уже использован с другими данными.');
   await client.query('COMMIT');
   return {...receipt.response,deduplicated:true};
  }
  const lead=(await client.query('SELECT * FROM public.mvp_leads WHERE id=$1 FOR UPDATE',[leadId])).rows[0];
  if(!lead)throw new AppError(404,'Лид не найден.');
  const linked=(await client.query('SELECT client_id,object_id FROM public.mvp_crm_lead_client_links WHERE lead_id=$1',[leadId])).rows[0];
  const intake=(await client.query('SELECT client_id FROM public.mvp_crm_lead_intakes WHERE lead_id=$1',[leadId])).rows[0];
  if(linked)throw new AppError(409,'Лид уже связан с клиентом. Обнови карточку.');
  if(lead.revision!==expectedRevision)throw new AppError(409,'Лид изменился. Обнови карточку.');
  if(intake&&requestedClient!==intake.client_id)
   throw new AppError(409,'Обращение уже связано с выбранным ранее клиентом. Менять клиента при завершении нельзя.');
  if(!['new','contacted','qualified'].includes(lead.status))
   throw new AppError(409,'Для этого статуса преобразование недоступно. Исторические статусы не переписываются.');
  const phone=(await client.query('SELECT public.mvp_crm_phone_canonical($1::text) AS phone',[lead.phone])).rows[0].phone;
  // Equal-number conversions are serialized. Legacy direct Client entry still
  // exists until a separate owner-approved policy decision; no unique rewrite.
  if(phone)await client.query('SELECT pg_advisory_xact_lock(151106,hashtext($1::text))',[phone]);
  const matches=phone?(await client.query(
   "SELECT id,name,phone FROM public.mvp_clients WHERE status<>'archived' AND phone<>'' AND public.mvp_crm_phone_canonical(phone)=$1 ORDER BY id FOR SHARE",[phone])).rows:[];
  // An explicit client selected at Lead creation is authoritative for this intake;
  // contact phone may belong to a representative, not the Client profile.
  if(!intake&&matches.length>1)throw new AppError(409,'Найдено несколько клиентов с тем же номером. Разреши дубликаты перед преобразованием.');
  if(!intake&&matches.length===1&&!requestedClient)
   throw new AppError(409,'Клиент с таким телефоном уже существует. Выбери его явно из списка.');
  if(!intake&&matches.length===1&&requestedClient!==matches[0].id)
   throw new AppError(409,'Выбранный клиент не совпадает с телефоном лида. Обнови карточку.');
  if(!intake&&matches.length===0&&requestedClient&&phone)
   throw new AppError(409,'У выбранного клиента другой телефон. Исправь данные или проверь связь.');
  let clientId=requestedClient,createdClient=false;
  if(requestedClient){
   const selected=(await client.query('SELECT id,status FROM public.mvp_clients WHERE id=$1 FOR KEY SHARE',[requestedClient])).rows[0];
   if(!selected)throw new AppError(404,'Клиент не найден.');
   // Clean mvp_clients has no legacy status column. Historical Google provenance
   // remains authoritative for the archive/active distinction.
   const archived=(await client.query(
    "SELECT 1 FROM public.mvp_legacy_import_map WHERE source_entity='Clients' AND target_id=$1 AND source_payload->>'status'='archived' LIMIT 1",
    [requestedClient])).rows;
   if(archived.length||selected.status==='archived')throw new AppError(409,'Клиент архивирован. Без восстановления связывать нельзя.');
  }else{
   const name=cleanText(newClientName||lead.contact_name,160,AppError,'Имя нового клиента');
   const result=await client.query(
    'INSERT INTO public.mvp_clients(request_key,name,phone,notes) VALUES($1,$2,$3,$4) RETURNING id',
    [key,name,phone||'',lead.notes||'']);
   clientId=result.rows[0].id;
   createdClient=true;
  }
  if(requestedObject){
   const object=(await client.query('SELECT client_id FROM public.mvp_objects WHERE id=$1 FOR KEY SHARE',[requestedObject])).rows[0];
   if(!object)throw new AppError(404,'Объект не найден.');
   if(object.client_id!==clientId)throw new AppError(409,'Объект принадлежит другому клиенту.');
  }
  await client.query(
   'INSERT INTO public.mvp_crm_lead_client_links(lead_id,client_id,object_id,request_key) VALUES($1,$2,$3,$4)',
   [leadId,clientId,requestedObject,key]);
  const updated=(await client.query(
   "UPDATE public.mvp_leads SET status='won',next_action='',next_action_at=NULL,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING id,status,revision",
   [leadId,expectedRevision])).rows[0];
  if(!updated)throw new AppError(409,'Лид изменился в другой сессии.');
  await archiveLeadReminderTx(client,leadId);
  // CrmService.js legacy parity: agreement relation event belongs to the Lead.
  // Same request UUID as conversion, committed atomically and never replayed twice.
  const agreementSummary='Договорились по обращению: '+String(lead.title||'').slice(0,160);
  const agreementHash=createHash('sha256').update(JSON.stringify([
   'CRM01_AGREEMENT',leadId,clientId,requestedObject||null
  ])).digest('hex');
  await client.query(
   "INSERT INTO public.mvp_crm_interactions(request_key,request_hash,entity_type,lead_id,interaction_type,contact_on,summary) "+
   "VALUES($1,$2,'Lead',$3,'note',(now() AT TIME ZONE 'Asia/Yerevan')::date,$4)",
   [key,agreementHash,leadId,agreementSummary]);
  const result={saved:true,item:updated,clientId,leadId,objectId:requestedObject,
    conversion:createdClient?'created_new':'linked_existing',source:'CLEAN_CRM01_ATOMIC_CONVERSION'};
  await client.query('UPDATE public.mvp_crm_conversion_requests SET response=$2::jsonb WHERE request_key=$1',
   [key,JSON.stringify(result)]);
  await client.query('COMMIT');
  return result;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();}
}

/** Only a linked won Lead may be the explicit source of a new Clean WorkOrder. */
export async function validateOrderLeadContext(client,leadId,objectId,AppError){
 if(!leadId)return;
 const q=await client.query(
  'SELECT l.client_id,l.object_id,lead.status,o.client_id AS order_client_id FROM public.mvp_crm_lead_client_links l JOIN public.mvp_leads lead ON lead.id=l.lead_id JOIN public.mvp_objects o ON o.id=$2 WHERE l.lead_id=$1',
  [leadId,objectId]);
 const match=q.rows[0];
 if(!match||match.status!=='won'||match.client_id!==match.order_client_id||
    (match.object_id!==null&&match.object_id!==objectId))
  throw new AppError(409,'Связь лида, клиента и объекта не подтверждена. Создай заказ из правильной цепочки CRM.');
}
