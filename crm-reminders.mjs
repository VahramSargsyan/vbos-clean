/**
 * CRM-08A: current Lead.nextAction/nextActionAt is the canonical reminder.
 * mvp_schedule_lead_items is an atomic, managed Calendar projection only.
 * No legacy, CRM06 Interaction or manual ScheduleItem mutation.
 */
import {createHash} from 'node:crypto';

export function crmReminderClock(value,{safeDate,AppError}){
 const raw=String(value??'').trim();
 if(!raw)return null;
 if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw))
  throw new AppError(400,'Укажи корректные дату и время следующего контакта.');
 safeDate(raw.slice(0,10));
 const at=new Date(raw+':00+04:00');
 if(!Number.isFinite(at.getTime())||new Date(at.getTime()+14400000).toISOString().slice(0,16)!==raw)
  throw new AppError(400,'Некорректное местное время Еревана.');
 return {instant:at.toISOString(),day:raw.slice(0,10),local:raw};
}
export async function archiveLeadReminderTx(client,leadId){
 const r=await client.query(
  "UPDATE public.mvp_schedule_lead_items SET status='archived',archived_at=now(),revision=revision+1,updated_at=now() WHERE lead_id=$1 AND status<>'archived' RETURNING id",
  [leadId]);
 return r.rows[0]?.id||null;
}
function actionText(raw,AppError){
 if(typeof raw!=='string')throw new AppError(400,'Следующее действие должно быть текстом.');
 const val=raw.trim();
 if(val.length>500)throw new AppError(400,'Следующее действие длиннее 500 символов.');
 return val;
}
function hashPayload(value){
 return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function isOpen(status){return ['new','contacted','qualified'].includes(status);}

export async function crmReminderAction({pool,p,key,uuid,safeDate,safeRevision,AppError}){
 const leadId=uuid(p.leadId);
 const revision=safeRevision(p.revision);
 const nextAction=actionText(p.nextAction,AppError);
 const nextTime=crmReminderClock(p.nextActionAt,{safeDate,AppError});
 if(nextTime&&!nextAction)throw new AppError(400,'Для времени нужно указать следующее действие.');
 const hash=hashPayload({leadId,revision,nextAction,nextActionAt:nextTime?.instant||null});
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const claim=await db.query(
   "INSERT INTO public.mvp_crm_reminder_requests(request_key,action,payload_sha256,response) VALUES($1,'crm_reminder_save',$2,'{}'::jsonb) ON CONFLICT(request_key) DO NOTHING RETURNING request_key",
   [key,hash]);
  if(!claim.rowCount){
   const prior=(await db.query('SELECT action,payload_sha256,response FROM public.mvp_crm_reminder_requests WHERE request_key=$1',[key])).rows[0];
   if(!prior||prior.action!=='crm_reminder_save'||prior.payload_sha256!==hash)
    throw new AppError(409,'Ключ CRM уже использован с другим действием.');
   await db.query('COMMIT');
   return {...prior.response,deduplicated:true};
  }
  const lead=(await db.query('SELECT id,title,status,revision FROM public.mvp_leads WHERE id=$1 FOR UPDATE',[leadId])).rows[0];
  if(!lead)throw new AppError(404,'Обращение не найдено.');
  if(!isOpen(lead.status))throw new AppError(409,'Завершённому обращению нельзя назначить новый контакт.');
  if(lead.revision!==revision)throw new AppError(409,'Обращение изменилось. Обнови карточку.');
  const saved=(await db.query(
   'UPDATE public.mvp_leads SET next_action=$2,next_action_at=$3::timestamptz,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$4 RETURNING *',
   [leadId,nextAction,nextTime?.instant||null,revision])).rows[0];
  if(!saved)throw new AppError(409,'Обращение изменилось. Обнови карточку.');
  let planId=null;
  if(nextTime){
   const title=('CRM · '+lead.title+' · '+nextAction).slice(0,300);
   const mirror=(await db.query(
    `INSERT INTO public.mvp_schedule_lead_items(
       lead_id,auto_source_key,status,start_at,end_at,schedule_date,title,notes)
     VALUES ($1,$2,'planned',$3::timestamptz,$3::timestamptz+interval '30 minutes',$4::date,$5,$6)
     ON CONFLICT(lead_id) DO UPDATE SET
       status='planned',start_at=EXCLUDED.start_at,end_at=EXCLUDED.end_at,
       schedule_date=EXCLUDED.schedule_date,title=EXCLUDED.title,notes=EXCLUDED.notes,
       archived_at=NULL,revision=public.mvp_schedule_lead_items.revision+1,updated_at=now()
     RETURNING id`,
    [leadId,'LEAD|'+leadId,nextTime.instant,nextTime.day,title,nextAction])).rows[0];
   planId=mirror.id;
  }else planId=await archiveLeadReminderTx(db,leadId);
  const result={saved:true,item:saved,leadId,planId,source:'CLEAN_CRM08A_CANONICAL_NEXT_ACTION'};
  await db.query('UPDATE public.mvp_crm_reminder_requests SET response=$2::jsonb WHERE request_key=$1',
   [key,JSON.stringify(result)]);
  await db.query('COMMIT');return result;
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
 finally{db.release();}
}

export async function crmLeadStatusAction({pool,p,uuid,safeRevision,AppError}){
 const id=uuid(p.id),rev=safeRevision(p.revision),status=String(p.status||'');
 if(status==='won')throw new AppError(409,'Для статуса «Успешно» используй преобразование лида в клиента.');
 if(!['new','contacted','qualified','lost'].includes(status))throw new AppError(400,'Некорректный статус обращения.');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const previous=(await db.query('SELECT id,status,revision FROM public.mvp_leads WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!previous)throw new AppError(404,'Обращение не найдено.');
  if(['won','transferred'].includes(previous.status)||previous.revision!==rev)throw new AppError(409,'Обращение изменилось. Обнови карточку.');
  const saved=(await db.query(
   `UPDATE public.mvp_leads SET status=$2,
     next_action=CASE WHEN $2='lost' THEN '' ELSE next_action END,
     next_action_at=CASE WHEN $2='lost' THEN NULL ELSE next_action_at END,
     revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$3 RETURNING *`,
   [id,status,rev])).rows[0];
  if(!saved)throw new AppError(409,'Обращение изменилось. Обнови карточку.');
  if(status==='lost')await archiveLeadReminderTx(db,id);
  await db.query('COMMIT');return {saved:true,item:saved};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
 finally{db.release();}
}
