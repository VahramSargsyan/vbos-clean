/**
 * CRM-22A/CRM-25A: manual OR selected canonical external Master recipient branch.
 * Masters (external partners) are NOT Clean Workers (employees).
 * This action never creates, notifies or silently substitutes a Worker as Master.
 * The one-time immutable transfer and terminal Lead status commit atomically.
 */
import {createHash} from 'node:crypto';
import {archiveLeadReminderTx} from './crm-reminders.mjs';

export const LEAD_TRANSFER_REASONS=Object.freeze([
 'no_time','not_my_specialty','budget_mismatch','too_far',
 'different_specialist_needed','do_not_want_order','other'
]);
const fail=(AppError,status,message)=>{throw new AppError(status,message);};
const trim=(value,max,label,AppError,required=true)=>{
 if(typeof value!=='string')
  fail(AppError,400,label+' — нужен текст.');
 const text=value.trim();
 if((required&&!text)||text.length>max)
  fail(AppError,400,label+' — '+(required?'обязательное поле, ':'')+'максимум '+max+' символов.');
 return text;
};
function transferResponse(transfer,lead,deduplicated=false){
 return {
  saved:true,item:lead,transfer:{
   id:transfer.id,leadId:transfer.lead_id,recipientName:transfer.recipient_name,
   reason:transfer.reason,comment:transfer.comment,masterId:transfer.master_id||null,
   transferredAt:transfer.transferred_at,
   source:transfer.master_id?'CLEAN_NATIVE_MASTER_RECIPIENT':'CLEAN_NATIVE_MANUAL_RECIPIENT'
  },leadId:lead.id,
  source:'CLEAN_CRM22A_MANUAL_TRANSFER',
  ...(deduplicated?{deduplicated:true}:{})
 };
}
/**
 * Existing /api/action owner cookie gate authenticates caller.
 * Replay is keyed by requestKey and exact immutable payload, not by Lead title.
 */
export async function leadTransferAction({pool,p,key,uuid,safeRevision,AppError}){
 const leadId=uuid(p.leadId);
 const revision=safeRevision(p.revision);
 if(p.workerId)fail(AppError,409,'Работник компании — не внешний мастер.');
 const masterId=p.masterId?uuid(p.masterId):null;
 const recipientName=masterId?'':trim(p.recipientName,300,'Имя мастера или получателя',AppError);
 if(masterId&&p.recipientName&&String(p.recipientName).trim())
  fail(AppError,400,'При выборе мастера не вводи второе имя получателя.');
 const reason=trim(p.reason,50,'Причина передачи',AppError);
 if(!LEAD_TRANSFER_REASONS.includes(reason))fail(AppError,400,'Неизвестная причина передачи.');
 const comment=p.comment===undefined?'':trim(p.comment,5000,'Комментарий',AppError,false);
 if(p.confirm!=='TRANSFER_LEAD')
  fail(AppError,400,'Подтверди передачу лида отдельным действием.');
 if(p.transferredAt!==undefined&&p.transferredAt!==null&&p.transferredAt!=='')
  fail(AppError,400,'Дата передачи фиксируется сервером; изменение задним числом не поддерживается.');
 const canon=masterId?{leadId,revision,masterId,reason,comment,recipientKind:'MASTER'}:
  {leadId,revision,recipientName,reason,comment,recipientKind:'MANUAL'};
 const digest=createHash('sha256').update(JSON.stringify(canon)).digest('hex');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const lead=(await db.query('SELECT * FROM public.mvp_leads WHERE id=$1 FOR UPDATE',[leadId])).rows[0];
  if(!lead)fail(AppError,404,'Лид не найден.');
  const prior=(await db.query(
   'SELECT * FROM public.mvp_crm_lead_transfers WHERE lead_id=$1',[leadId])).rows[0];
  if(prior){
   if(prior.request_key!==key||prior.payload_sha256!==digest)
    fail(AppError,409,'Этот лид уже был передан другому получателю. Повторная передача запрещена.');
   if(lead.status!=='transferred')
    fail(AppError,409,'Запись передачи и статус лида не совпадают. Требуется проверка.');
   await db.query('COMMIT');
   return transferResponse(prior,lead,true);
  }
  if(lead.revision!==revision)
   fail(AppError,409,'Карточка лида изменена. Обнови её перед передачей.');
  if(!['new','contacted','qualified','lost'].includes(lead.status))
   fail(AppError,409,'Лид в этом статусе передавать нельзя.');
  // Same Lead row lock as native CRM01 conversion. Immutable recipient snapshot.
  let finalRecipientName=recipientName;
  if(masterId){
   const master=(await db.query('SELECT id,name,status FROM public.mvp_crm_masters WHERE id=$1 FOR SHARE',[masterId])).rows[0];
   if(!master)fail(AppError,404,'Выбранный внешний мастер не найден.');
   if(master.status==='archived')fail(AppError,409,'Архивному мастеру нельзя передать лид.');
   if(!['active','unavailable'].includes(master.status))fail(AppError,409,'Неизвестный статус мастера.');
   finalRecipientName=master.name;
  }
  const t=(await db.query(
   'INSERT INTO public.mvp_crm_lead_transfers(lead_id,request_key,payload_sha256,recipient_name,reason,comment,master_id) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
   [leadId,key,digest,finalRecipientName,reason,comment,masterId])).rows[0];
  const newLead=(await db.query(
   "UPDATE public.mvp_leads SET status='transferred',next_action='',next_action_at=NULL,"+
   'revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *',
   [leadId,revision])).rows[0];
  if(!newLead)fail(AppError,409,'Карточка лида изменилась при передаче.');
  await archiveLeadReminderTx(db,leadId);
  await db.query('COMMIT');
  return transferResponse(t,newLead);
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}
 finally{db.release();}
}
