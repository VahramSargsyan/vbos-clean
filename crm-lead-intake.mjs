/**
 * CRM-02. Preserve an existing-client lead association BEFORE visit/qualification.
 * This is not conversion: the Lead stays NEW, with its own future status workflow.
 * Request key, Lead and intake relation are committed atomically.
 */
import {createHash} from 'node:crypto';

export async function createLeadForExistingClient({pool,p,key,uuid,requireText,optText,AppError}){
 const clientId=uuid(p.clientId);
 const title=requireText(p.title,160);
 const contactName=optText(p.contactName,160);
 const leadPhone=optText(p.phone,60);
 const notes=optText(p.notes);
 // Immutable request parameters, not mutable selected Client values.
 const canonical={clientId,title,contactName,phone:leadPhone,notes};
 const hash=createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const selected=(await db.query(
   'SELECT id,name,phone,status FROM public.mvp_clients WHERE id=$1 FOR KEY SHARE',[clientId])).rows[0];
  if(!selected)throw new AppError(404,'Выбранный клиент не найден. Обнови список.');
  const archived=(await db.query(
   "SELECT 1 FROM public.mvp_legacy_import_map WHERE source_entity='Clients' AND target_id=$1 AND source_payload->>'status'='archived' LIMIT 1",
   [clientId])).rows;
  if(archived.length||selected.status==='archived')throw new AppError(409,'Клиент архивирован. Создавать обращение без восстановления нельзя.');
  const first=await db.query(
   'INSERT INTO public.mvp_leads(request_key,title,contact_name,phone,notes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(request_key) DO NOTHING RETURNING *',
   [key,title,contactName||selected.name,leadPhone||selected.phone||'',notes]);
  if(!first.rowCount){
   const found=(await db.query('SELECT * FROM public.mvp_leads WHERE request_key=$1',[key])).rows[0];
   const intake=(await db.query('SELECT client_id,payload_sha256 FROM public.mvp_crm_lead_intakes WHERE request_key=$1',[key])).rows[0];
   if(!found||!intake||intake.client_id!==clientId||intake.payload_sha256!==hash)
    throw new AppError(409,'Ключ запроса использован для другого лида. Проверь список перед повторением.');
   await db.query('COMMIT');
   return {saved:true,item:found,clientId,association:'EXISTING_CLIENT_INTAKE',deduplicated:true};
  }
  const lead=first.rows[0];
  await db.query(
   'INSERT INTO public.mvp_crm_lead_intakes(lead_id,client_id,request_key,payload_sha256) VALUES($1,$2,$3,$4)',
   [lead.id,clientId,key,hash]);
  await db.query('COMMIT');
  return {saved:true,item:lead,clientId,association:'EXISTING_CLIENT_INTAKE'};
 }catch(err){await db.query('ROLLBACK').catch(()=>{});throw err;}
 finally{db.release();}
}
