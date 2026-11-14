/**
 * CRM-04, L2: save a site visit result in the existing Lead.notes.
 * This is a bounded operational record, NOT an immutable interaction ledger.
 * Optimistic revision + row lock + request marker guard against repeated writes.
 * No schema/migration/status/client/order/schedule mutation occurs here.
 */
import {createHash} from 'node:crypto';

const cleanLine=(value,label,max,AppError)=>{
 if(typeof value!=='string')throw new AppError(400,label+' обязательно.');
 const trimmed=value.replace(/[\r\n]+/g,' ').trim();
 if(!trimmed||trimmed.length>max)throw new AppError(400,label+': укажи от 1 до '+max+' символов.');
 return trimmed;
};

export async function leadVisitRecordAction({pool,p,key,uuid,safeRevision,safeDate,AppError}){
 const leadId=uuid(p.leadId);
 const revision=safeRevision(p.revision);
 const visitDate=safeDate(p.visitDate);
 const observations=cleanLine(p.observations,'Результат осмотра',500,AppError);
 const nextAction=cleanLine(p.nextAction,'Следующее действие',200,AppError);
 const followUpOn=p.followUpOn?safeDate(p.followUpOn):'';
 const fields={leadId,visitDate,observations,nextAction,followUpOn};
 const hash=createHash('sha256').update(JSON.stringify(fields)).digest('hex');
 const marker='[CRM04 RECORD | '+key+' | ';
 const fullMarker=marker+hash+']';
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const rows=await db.query('SELECT * FROM public.mvp_leads WHERE id=$1 FOR UPDATE',[leadId]);
  const lead=rows.rows[0];
  if(!lead)throw new AppError(404,'Обращение не найдено.');
  const priorNotes=String(lead.notes||'');
  if(priorNotes.includes(marker)){
   if(!priorNotes.includes(fullMarker))throw new AppError(409,'Ключ результата осмотра уже использован с другими данными.');
   await db.query('COMMIT');
   return {saved:true,item:lead,deduplicated:true,source:'CRM04_LEAD_NOTES'};
  }
  if(lead.revision!==revision)throw new AppError(409,'Обращение изменилось. Обнови карточку, прежде чем сохранять результат.');
  if(['lost','won','transferred'].includes(lead.status))throw new AppError(409,'Завершённое обращение нельзя использовать для нового результата осмотра.');
  const block=fullMarker+'\nДата осмотра: '+visitDate+
   '\nРезультат: '+observations+
   '\nСледующее действие: '+nextAction+
   '\nСледующий контакт: '+(followUpOn||'не назначен')+
   '\n[/CRM04 RECORD]';
  const notes=priorNotes+(priorNotes?'\n\n':'')+block;
  if(notes.length>2000)throw new AppError(409,'Заметки достигли лимита 2000 символов. Сохрани предыдущие записи отдельно, прежде чем добавлять новый результат.');
  const updated=await db.query(
   'UPDATE public.mvp_leads SET notes=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *',
   [leadId,revision,notes]);
  if(!updated.rowCount)throw new AppError(409,'Обращение изменилось. Обнови карточку.');
  await db.query('COMMIT');
  return {saved:true,item:updated.rows[0],source:'CRM04_LEAD_NOTES'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
 finally{db.release();}
}
