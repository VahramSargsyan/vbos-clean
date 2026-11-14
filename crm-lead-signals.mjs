/** 
 * CRM-10A: accepted deterministic VBOS Win Score V1 in Clean PostgreSQL.
 * Stage/source/need are explicit owner-entered Lead facts. No AI prediction,
 * historical backfill, technical relation signals or persisted score.
 */
import {createHash} from 'node:crypto';

export const CRM_STAGE_KEYS=Object.freeze([
 'new_contact','needs_discussion','estimate_required','estimate_sent','negotiation','approved','rejected'
]);
export const CRM_SOURCE_KEYS=Object.freeze([
 'repeat_client','referral','partner','facebook','instagram','google','whatsapp','signboard','other'
]);
const STAGE_POINTS=Object.freeze({
 new_contact:10,needs_discussion:20,estimate_required:30,estimate_sent:40,
 negotiation:50,approved:60,rejected:0
});
const SOURCE_POINTS=Object.freeze({repeat_client:15,referral:10,partner:7});
const STAGE_LABELS=Object.freeze({
 new_contact:'Новый контакт',needs_discussion:'Нужно обсудить',
 estimate_required:'Нужна смета',estimate_sent:'Смета отправлена',
 negotiation:'Переговоры',approved:'Согласовано',rejected:'Отказ'
});
const SOURCE_LABELS=Object.freeze({
 repeat_client:'Повторный клиент',referral:'Сарафан',partner:'Партнёр',
 facebook:'Facebook',instagram:'Instagram',google:'Google',
 whatsapp:'WhatsApp',signboard:'Вывеска',other:'Другое'
});
export function crmSignalFields(p,AppError){
 const stage=String(p.agreementStage??'').trim();
 const source=String(p.sourceChannel??'').trim();
 if(stage&&!CRM_STAGE_KEYS.includes(stage))throw new AppError(400,'Некорректный этап сделки.');
 if(source&&!CRM_SOURCE_KEYS.includes(source))throw new AppError(400,'Некорректный источник обращения.');
 if(typeof p.needSummary!=='string'||p.needSummary.trim().length>1000)
  throw new AppError(400,'Описание потребности должно быть текстом до 1000 символов.');
 return {agreementStage:stage||null,sourceChannel:source||null,needSummary:p.needSummary.trim()};
}
function scoreBand(score){
 if(score<=24)return {key:'LOW',label:'Слабый'};
 if(score<=44)return {key:'DEVELOPING',label:'Развивается'};
 if(score<=64)return {key:'ACTIVE',label:'Рабочий'};
 if(score<=79)return {key:'STRONG',label:'Сильный'};
 return {key:'VERY_STRONG',label:'Очень сильный'};
}
export function crmLeadSignals(row){
 const stage=row.agreement_stage||null;
 const source=row.source_channel||null;
 const need=Boolean(String(row.need_summary||'').trim());
 const hasContact=Boolean(row.last_contact_at);
 const hasAction=Boolean(String(row.next_action||'').trim());
 const hasReminder=Boolean(row.next_action_at);
 const terminal=['won','lost'].includes(row.status);
 const stageKnown=CRM_STAGE_KEYS.includes(stage);
 const rejected=stage==='rejected';
 const reasons=[
  {key:'stage',points:stageKnown?STAGE_POINTS[stage]:0,label:stageKnown?STAGE_LABELS[stage]:'Этап сделки не указан',active:stageKnown},
  {key:'source',points:SOURCE_POINTS[source]||0,label:source?SOURCE_LABELS[source]:'Источник не указан',active:Boolean(source)},
  {key:'need',points:need?10:0,label:need?'Потребность описана':'Нет описания потребности',active:need},
  {key:'interaction',points:hasContact?5:0,label:hasContact?'Есть деловой контакт':'Деловой контакт не зарегистрирован',active:hasContact},
  {key:'nextAction',points:hasAction?5:0,label:hasAction?'Есть следующий шаг':'Нет следующего шага',active:hasAction},
  {key:'reminder',points:hasReminder?5:0,label:hasReminder?'Есть CRM-напоминание':'Нет CRM-напоминания',active:hasReminder}
 ];
 const ready=stageKnown&&!terminal;
 const score=ready?(rejected?0:Math.max(0,Math.min(100,reasons.reduce((a,x)=>a+x.points,0)))):null;
 const band=ready?scoreBand(score):null;
 if(rejected)reasons.splice(0,reasons.length,{key:'stage',points:0,label:'Отказ · итог 0',active:true});
 return {
  modelVersion:'CRM_WIN_SCORE_V1_100',leadId:row.id,leadStatus:row.status,
  signalSource:'EXPLICIT_CLEAN_LEAD_AND_CRM06A',
  interactionCoverage:'INDEXED_ACTIVE_CONTACT_PRESENCE_ONLY',
  sourceChannel:source,agreementStage:stage,hasNeedSummary:need,
  hasNextAction:hasAction,hasReminder,hasBusinessContact:hasContact,
  lastContactAt:row.last_contact_at||null,lastContactType:row.last_contact_type||null,
  nextActionAt:row.next_action_at||null,
  winScore:{
   score,band:band?.key||null,bandLabel:band?.label||null,
   ready,coverage:terminal?'TERMINAL_LEAD':stageKnown?'COMPLETE_FOR_EXPLICIT_CURRENT_FACTS':'STAGE_REQUIRED',
   calibratedProbability:false,terminalOverride:rejected||terminal,reasons
  }
 };
}
const ONE_LEAD_SIGNALS_SQL=`
SELECT l.id,l.status,l.revision,l.agreement_stage,l.source_channel,l.need_summary,
 l.next_action,l.next_action_at,i.created_at AS last_contact_at,
 i.interaction_type AS last_contact_type
FROM public.mvp_leads l LEFT JOIN LATERAL (
 SELECT created_at,interaction_type FROM public.mvp_crm_interactions
 WHERE entity_type='Lead' AND lead_id=l.id AND status='active'
 ORDER BY created_at DESC,id DESC LIMIT 1
) i ON true
WHERE l.id=$1 LIMIT 1`;
// One shared source query for on-demand read and the CRM12A observer.
// Neither the score model nor the active-contact coverage is duplicated.
export async function crmLeadSignalRow(conn,leadId){
 return (await conn.query(ONE_LEAD_SIGNALS_SQL,[leadId])).rows[0]||null;
}
export async function crmLeadSignalsRead({pool,url,uuid,AppError}){
 const params=url.searchParams.getAll('leadId');
 if(params.length!==1)throw new AppError(400,'Выбери одно обращение для проверки сигналов.');
 const leadId=uuid(params[0]);
 const row=await crmLeadSignalRow(pool,leadId);
 if(!row)throw new AppError(404,'Обращение не найдено.');
 return {version:'CRM10A_LEAD_SIGNALS',signal:crmLeadSignals(row)};
}
export async function crmLeadSignalsSave({pool,p,key,uuid,safeRevision,AppError}){
 const leadId=uuid(p.leadId),revision=safeRevision(p.revision);
 const fields=crmSignalFields(p,AppError);
 const digest=createHash('sha256').update(JSON.stringify({leadId,revision,...fields})).digest('hex');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const claim=await client.query(
   "INSERT INTO public.mvp_crm_signal_requests(request_key,action,payload_sha256,lead_id,response) VALUES($1,'crm_signal_save',$2,$3,'{}'::jsonb) ON CONFLICT(request_key) DO NOTHING RETURNING request_key",
   [key,digest,leadId]);
  if(!claim.rowCount){
   const prev=(await client.query('SELECT action,payload_sha256,lead_id,response FROM public.mvp_crm_signal_requests WHERE request_key=$1',[key])).rows[0];
   if(!prev||prev.action!=='crm_signal_save'||prev.payload_sha256!==digest||String(prev.lead_id).toLowerCase()!==leadId.toLowerCase())
    throw new AppError(409,'Ключ изменения CRM уже использован с другими данными.');
   await client.query('COMMIT');
   return {...prev.response,deduplicated:true};
  }
  const lead=(await client.query('SELECT id,status,revision FROM public.mvp_leads WHERE id=$1 FOR UPDATE',[leadId])).rows[0];
  if(!lead)throw new AppError(404,'Обращение не найдено.');
  if(!['new','contacted','qualified'].includes(lead.status))throw new AppError(409,'Закрытое обращение нельзя изменить.');
  if(lead.revision!==revision)throw new AppError(409,'Карточка изменена. Обнови данные.');
  const updated=(await client.query(
   'UPDATE public.mvp_leads SET agreement_stage=$3,source_channel=$4,need_summary=$5,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *',
   [leadId,revision,fields.agreementStage,fields.sourceChannel,fields.needSummary])).rows[0];
  if(!updated)throw new AppError(409,'Карточка изменилась. Обнови данные.');
  const out={saved:true,item:updated,source:'EXPLICIT_CLEAN_LEAD_SIGNALS'};
  await client.query('UPDATE public.mvp_crm_signal_requests SET response=$2::jsonb WHERE request_key=$1',[key,JSON.stringify(out)]);
  await client.query('COMMIT');
  return out;
 }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}
 finally{client.release();}
}
