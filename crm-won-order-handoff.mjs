/*
 * CRM WON -> WorkOrder without a detour through Client / Object cards.
 * Legacy reference: Scripts.html openPostConvertModal/openWorkOrderCreateFlow_.
 * One atomic request may create an Object and its Order for an already linked,
 * WON Lead; preserves the original immutable Lead -> Client relation.
 */
import {createHash} from 'node:crypto';
import {validateOrderLeadContext} from './crm-lead-conversion.mjs';
import {syncWorkOrderScheduleTx} from './order-schedule.mjs';

const hashPayload=(payload)=>createHash('sha256')
 .update(JSON.stringify({action:'crm_won_order_create',
  ordered:Object.keys(payload).filter(k=>k!=='requestKey').sort().map(k=>[k,payload[k]])}))
 .digest('hex');

export async function crmWonOrderCreate({pool,p,key,uuid,requireText,optText,safeDate,AppError}){
 const leadId=uuid(p.leadId);
 const mode=String(p.objectMode||'');
 if(!['existing','new'].includes(mode))throw new AppError(400,'Выбери существующий или новый объект.');
 const existingObject=mode==='existing'?uuid(p.objectId):null;
 const objectName=mode==='new'?requireText(p.objectName,160):'';
 const address=mode==='new'?optText(p.objectAddress,300):'';
 const objectType=mode==='new'?optText(p.objectType,100):'';
 const orderTitle=requireText(p.title,180);
 const orderNotes=optText(p.notes);
 const plannedOn=p.plannedOn?safeDate(p.plannedOn):null;
 const hash=hashPayload(p);
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const claim=await c.query(
   "INSERT INTO public.mvp_order_schedule_requests(request_key,action,payload_sha256,response) "+
   // Existing PostgreSQL CHECK permits 'order_create', not new action names.
   "VALUES($1,'order_create',$2,'{}'::jsonb) "+
   'ON CONFLICT(request_key) DO NOTHING RETURNING request_key',[key,hash]);
  if(!claim.rowCount){
   const existing=(await c.query(
    'SELECT action,payload_sha256,response FROM public.mvp_order_schedule_requests WHERE request_key=$1',
    [key])).rows[0];
   if(!existing||existing.action!=='order_create'||existing.payload_sha256!==hash)
    throw new AppError(409,'Ключ создания заказа уже использован с другими данными.');
   await c.query('COMMIT');
   return {...existing.response,deduplicated:true};
  }
  const lead=(await c.query('SELECT id,status FROM public.mvp_leads WHERE id=$1 FOR SHARE',[leadId])).rows[0];
  if(!lead||lead.status!=='won')throw new AppError(409,'Сначала подтверди договорённость с клиентом.');
  const link=(await c.query(
   'SELECT client_id,object_id FROM public.mvp_crm_lead_client_links WHERE lead_id=$1 FOR SHARE',
   [leadId])).rows[0];
  if(!link)throw new AppError(409,'Связь лида с клиентом не найдена. Обнови обращение.');
  const clientId=link.client_id;
  const client=(await c.query('SELECT id FROM public.mvp_clients WHERE id=$1 FOR KEY SHARE',[clientId])).rows[0];
  if(!client)throw new AppError(409,'Связанный клиент не найден.');
  let objectId=existingObject,createdObject=false;
  if(mode==='new'){
   if(link.object_id)throw new AppError(409,'К обращению уже привязан объект. Для него используй тот же объект.');
   const obj=await c.query(
    'INSERT INTO public.mvp_objects(request_key,client_id,name,address,object_type,notes) '+
    "VALUES($1,$2,$3,$4,$5,'') RETURNING id",
    [key,clientId,objectName,address,objectType]);
   objectId=obj.rows[0].id;
   createdObject=true;
  }else{
   const obj=(await c.query(
    'SELECT id,client_id FROM public.mvp_objects WHERE id=$1 FOR KEY SHARE',[objectId])).rows[0];
   if(!obj||obj.client_id!==clientId)throw new AppError(409,'Выбранный объект не принадлежит связанному клиенту.');
   const archive=await c.query(
    "SELECT 1 FROM public.mvp_legacy_import_map WHERE source_entity='Objects' AND target_id=$1 "+
    "AND source_payload->>'status'='archived' LIMIT 1",[objectId]);
   if(archive.rowCount)throw new AppError(409,'Объект в архиве, новый заказ на нём создавать нельзя.');
  }
  await validateOrderLeadContext(c,leadId,objectId,AppError);
  const order=(await c.query(
   'INSERT INTO public.mvp_orders(request_key,object_id,lead_id,title,planned_on,notes) '+
   'VALUES($1,$2,$3,$4,$5::date,$6) RETURNING *',
   [key,objectId,leadId,orderTitle,plannedOn,orderNotes])).rows[0];
  await syncWorkOrderScheduleTx(c,order);
  const response={
   saved:true,item:order,orderId:order.id,objectId,clientId,leadId,createdObject,
   source:'CLEAN_CRM_WON_POST_CONVERT_ORDER'
  };
  await c.query(
   'UPDATE public.mvp_order_schedule_requests SET response=$2::jsonb WHERE request_key=$1',
   [key,JSON.stringify(response)]);
  await c.query('COMMIT');
  return response;
 }catch(err){await c.query('ROLLBACK').catch(()=>{});throw err;}
 finally{c.release();}
}
