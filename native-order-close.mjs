/* VBOS Clean V13b.2 Native order close. Manual external finance attestation only.
 * The original Google WorkOrder authority is never modified. All native changes
 * and the idempotent action receipt commit or roll back together.
 */
import {createHash} from 'node:crypto';
import {computeLegacyAssessmentScoreV1} from './close-contract-parity.mjs';
import {syncWorkOrderScheduleTx} from './order-schedule.mjs';

const fields=Object.freeze({
 satisfaction:['YES','PARTIAL','NO','UNKNOWN'],
 acceptance:['NO_REMARKS','MINOR_REMARKS','NOT_ACCEPTED_REWORK','UNKNOWN'],
 paymentBehavior:['ON_TIME','DELAYED','PROBLEM','UNKNOWN'],
 communicationQuality:['EASY','NORMAL','DIFFICULT','CONFLICT','UNKNOWN'],
 scopeChanges:['NONE','FEW','MANY','UNKNOWN'],
 workAgain:['YES','YES_WITH_CONDITIONS','NO','UNKNOWN']
});
const readString=(v,max,{min=0}={})=>{
 const value=String(v??'').trim();
 if(value.length<min||value.length>max)throw new RangeError('INVALID_NATIVE_CLOSE_TEXT');
 return value;
};
const payloadDigest=p=>createHash('sha256').update(JSON.stringify(
  Object.keys(p).filter(k=>k!=='requestKey').sort().map(k=>[k,p[k]])
)).digest('hex');
const error=(AppError,status,message)=>{throw new AppError(status,message);};

/** Called only after the main server verified the owner cookie and POST origin. */
export async function nativeOrderCloseAction({pool,p,key,uuid,safeDate,safeRevision,AppError}){
 if(!pool?.connect||typeof AppError!=='function')throw Error('V13B2_CLOSE_DEPENDENCIES_MISSING');
 if(!p||typeof p!=='object'||Array.isArray(p))error(AppError,400,'Заполни форму закрытия.');
 const orderId=uuid(p.orderId),revision=safeRevision(p.revision),completionDate=safeDate(p.completionDate);
 if(p.financeChecked!=='yes')error(AppError,400,'Подтверди ручную проверку расчётов.');
 if(p.unfinishedObligationsStatus!=='NONE')error(AppError,409,'Остались незавершённые обязательства.');
 let financeReference,closeNote,comment;
 try{
  financeReference=readString(p.financeReference,500,{min:8});
  closeNote=readString(p.closeNote,5000);
  comment=readString(p.clientAssessment?.comment,5000);
 }catch{error(AppError,400,'Укажи источник финансовой проверки (8–500 символов). Проверь длину комментариев.');}
 const source=p.clientAssessment;
 if(!source||typeof source!=='object'||Array.isArray(source))error(AppError,400,'Заполни оценку взаимодействия с клиентом.');
 const assessment={};
 for(const [name,choices] of Object.entries(fields)){
  if(!choices.includes(source[name]))error(AppError,400,'Укажи допустимое значение поля оценки клиента: '+name);
  assessment[name]=source[name];
 }
 assessment.comment=comment;
 const scored=computeLegacyAssessmentScoreV1(assessment);
 const digest=payloadDigest({orderId,revision,completionDate,financeChecked:'yes',
  financeReference,unfinishedObligationsStatus:'NONE',closeNote,clientAssessment:assessment});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  await client.query("SET LOCAL lock_timeout = '8s'");
  const claim=await client.query(
   "INSERT INTO public.mvp_native_close_requests(request_key,order_id,action,payload_sha256,response) VALUES($1,$3,'close_work_order',$2,'{}'::jsonb) ON CONFLICT(request_key) DO NOTHING RETURNING request_key",
   [key,digest,orderId]);
  if(!claim.rowCount){
   const old=(await client.query('SELECT action,payload_sha256,response FROM public.mvp_native_close_requests WHERE request_key=$1',[key])).rows[0];
   if(!old||old.action!=='close_work_order'||old.payload_sha256!==digest)
    error(AppError,409,'Ключ закрытия уже использован с другими данными.');
   if(old.response?.saved!==true||old.response?.closed!==true)
    error(AppError,409,'Результат предыдущего закрытия не подтверждён.');
   await client.query('COMMIT');
   return {...old.response,deduplicated:true};
  }
  const found=await client.query('SELECT id,object_id,title,status,planned_on,revision FROM public.mvp_orders WHERE id=$1 FOR UPDATE',[orderId]);
  const order=found.rows[0];
  if(!order)error(AppError,404,'Заказ не найден.');
  const imported=await client.query(
   "SELECT 1 FROM public.mvp_legacy_import_map WHERE target_id=$1 AND source_entity='WorkOrders' LIMIT 1",[orderId]);
  if(imported.rowCount)error(AppError,409,'Этим заказом управляет Google VBOS, закрытие в Clean запрещено.');
  if(order.status!=='open'&&order.status!=='active')
   error(AppError,409,'Отменённый или завершённый заказ нельзя повторно закрыть.');
  if(order.revision!==revision)error(AppError,409,'Карточка заказа изменилась. Обнови данные.');
  // Block concurrent inserts/updates in related collections while checking and closing.
  // This bounded lock is held for only the single native order close transaction.
  await client.query('LOCK TABLE public.mvp_worker_tasks,public.mvp_sessions,public.mvp_worker_order_assignments,public.mvp_schedule_items,public.mvp_schedule_order_items IN SHARE MODE');
  const [tasks,sessions,actor]=await Promise.all([
   client.query("SELECT count(*)::int n FROM public.mvp_worker_tasks WHERE order_id=$1 AND status='active'",[orderId]),
   client.query('SELECT count(*)::int n FROM public.mvp_sessions WHERE order_id=$1 AND ended_at IS NULL',[orderId]),
   client.query("SELECT setting_value AS login FROM public.mvp_settings WHERE setting_key='owner_login'")
  ]);
  if(tasks.rows[0].n>0)error(AppError,409,'Есть активные задания работников. Заверши их перед закрытием.');
  if(sessions.rows[0].n>0)error(AppError,409,'Есть открытые рабочие сессии. Заверши их перед закрытием.');
  const owner=actor.rows[0]?.login;
  if(typeof owner!=='string'||!/^[a-z0-9_.-]{3,48}$/.test(owner))
   error(AppError,500,'Не удалось подтвердить учётную запись владельца.');
  const savedAssessment=await client.query(
   `INSERT INTO public.mvp_native_client_assessments
    (order_id,request_key,satisfaction,acceptance,payment_behavior,communication_quality,scope_changes,work_again,comment,score,score_version,known_factors,score_complete,risk_label)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
   [orderId,key,assessment.satisfaction,assessment.acceptance,assessment.paymentBehavior,
     assessment.communicationQuality,assessment.scopeChanges,assessment.workAgain,assessment.comment,
     scored.score===''?null:scored.score,scored.scoreVersion,scored.knownFactors,
     scored.scoreComplete,scored.riskLabel]);
  const removed=await client.query(
   "UPDATE public.mvp_worker_order_assignments SET status='removed',removed_at=now(),updated_at=now(),revision=revision+1 WHERE order_id=$1 AND status='active'",[orderId]);
  const manual=await client.query(
   "UPDATE public.mvp_schedule_items SET status='archived',archived_at=now(),updated_at=now(),revision=revision+1 WHERE order_id=$1 AND status='planned' AND schedule_date >= (now() AT TIME ZONE 'Asia/Yerevan')::date",[orderId]);
  const pending=await client.query(
   "SELECT count(*)::int n FROM public.mvp_schedule_order_items WHERE order_id=$1 AND status='planned'",[orderId]);
  const facts=await client.query(
   `INSERT INTO public.mvp_native_order_close_facts
    (order_id,request_key,assessment_id,previous_revision,completion_date,closed_by_login,finance_mode,finance_check_reference,payment_status,unfinished_obligations_status,close_note,removed_worker_assignments,archived_manual_plans,completed_auto_plans,source_system)
    VALUES($1,$2,$3,$4,$5::date,$6,'EXTERNAL_MANUAL',$7,'UNVERIFIED_IN_CLEAN','NONE',$8,$9,$10,$11,'CLEAN_NATIVE')
    RETURNING order_id,completion_date::text AS completion_date,closed_at,finance_checked_at,closed_by_login,finance_mode,finance_check_reference,payment_status,unfinished_obligations_status,removed_worker_assignments,archived_manual_plans,completed_auto_plans`,
   [orderId,key,savedAssessment.rows[0].id,revision,completionDate,owner,financeReference,closeNote,removed.rowCount,manual.rowCount,pending.rows[0].n]);
  const changed=await client.query(
   "UPDATE public.mvp_orders SET status='done',revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 AND status IN('open','active') RETURNING *",
   [orderId,revision]);
  if(changed.rowCount!==1)error(AppError,409,'Заказ изменился во время закрытия.');
  const auto=await syncWorkOrderScheduleTx(client,changed.rows[0]);
  const result={saved:true,closed:true,item:changed.rows[0],
   assessment:{id:savedAssessment.rows[0].id,score:scored.score,scoreVersion:scored.scoreVersion,
    knownFactors:scored.knownFactors,riskLabel:scored.riskLabel},
   closeFact:facts.rows[0],autoSchedule: auto,
   financeStatus:'UNVERIFIED_IN_CLEAN',externalManualFinance:true};
  await client.query("UPDATE public.mvp_native_close_requests SET response=$2::jsonb WHERE request_key=$1",
   [key,JSON.stringify(result)]);
  await client.query('COMMIT');
  return result;
 }catch(err){
  await client.query('ROLLBACK').catch(()=>{});
  if(err?.code==='55P03'||err?.code==='40001'||err?.code==='40P01')
   error(AppError,409,'Заказ одновременно изменяется. Повтори после обновления экрана.');
  if(err?.code==='23514'||err?.code==='23505')
   error(AppError,409,'Закрытие отклонено защитой данных. Обнови заказ.');
  throw err;
 }finally{client.release();}
}

/** Owner-only allowlisted audit view for a native closed WorkOrder; never a payment receipt. */
export async function nativeOrderCloseFactRead({pool,id,uuid,AppError}){
 const orderId=uuid(id);
 const result=await pool.query(
  `SELECT c.order_id::text AS "orderId",c.request_key::text AS "requestKey",
     c.completion_date::text AS "completionDate",c.closed_at AS "closedAt",
     c.closed_by_login AS "closedByLogin",c.finance_checked_at AS "financeCheckedAt",
     c.finance_mode AS "financeMode",c.finance_check_reference AS "financeReference",
     c.payment_status AS "paymentStatus",
     c.unfinished_obligations_status AS "unfinishedObligationsStatus",
     c.close_note AS "closeNote",
     c.removed_worker_assignments AS "removedWorkerAssignments",
     c.archived_manual_plans AS "archivedManualPlans",
     c.completed_auto_plans AS "completedAutoPlans",
     a.score,a.score_version AS "scoreVersion",a.risk_label AS "riskLabel",
     a.known_factors AS "knownFactors",a.comment AS "assessmentComment"
     FROM public.mvp_native_order_close_facts c
     JOIN public.mvp_native_client_assessments a ON a.id=c.assessment_id AND a.order_id=c.order_id
     WHERE c.order_id=$1::uuid LIMIT 1`,[orderId]);
 if(!result.rows.length)throw new AppError(404,'Закрытие этого заказа не зарегистрировано в Clean.');
 return {readonly:true,source:'CLEAN_NATIVE_MANUAL_FINANCE_ATTESTATION',
  fact:result.rows[0],financeIsSettled:false};
}
