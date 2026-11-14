/**
 * CRM-06A: append-only Lead/Client interaction history.
 * Legacy source: CrmService.js addInteractionService_, Config.js interactionType enum.
 * No import of historical Google rows and no change to CRM-04 Lead.notes.
 */
import {createHash} from 'node:crypto';

const kinds=new Set(['call','message','meeting','site_visit','note','other']);
function entityScope(p,uuid,AppError){
 const entityType=String(p.entityType||'');
 if(entityType!=='Lead'&&entityType!=='Client')throw new AppError(400,'Выбери обращение или клиента.');
 return {entityType,id:uuid(p.entityId),column:entityType==='Lead'?'lead_id':'client_id',
  table:entityType==='Lead'?'public.mvp_leads':'public.mvp_clients'};
}
function cleanText(value,label,max,AppError,required=false){
 if(value===undefined||value===null)value='';
 if(typeof value!=='string')throw new AppError(400,label+': неверный формат.');
 const s=value.trim();
 if((required&&!s)||s.length>max)throw new AppError(400,label+': укажи до '+max+' символов.');
 return s;
}
function normalizedPayload(p,deps){
 const {uuid,safeDate,dayYerevan,AppError}=deps;
 const scope=entityScope(p,uuid,AppError);
 const kind=String(p.interactionType||'note');
 if(!kinds.has(kind))throw new AppError(400,'Некорректный вид взаимодействия.');
 const summary=cleanText(p.summary,'Результат контакта',1000,AppError,true);
 const nextAction=cleanText(p.nextAction,'Следующее действие',500,AppError);
 const notes=cleanText(p.notes,'Заметки',5000,AppError);
 const contactOn=safeDate(p.contactOn||dayYerevan());
 const nextActionOn=p.nextActionOn?safeDate(p.nextActionOn):null;
 if(nextActionOn&&!nextAction)throw new AppError(400,'Для даты следующего контакта укажи действие.');
 return {scope,kind,summary,nextAction,notes,contactOn,nextActionOn};
}
const dateOnly=value=>value==null?null:value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
function present(row){
 return {id:row.id,entityType:row.entity_type,entityId:row.lead_id||row.client_id,
  interactionType:row.interaction_type,contactOn:dateOnly(row.contact_on),summary:row.summary,
  nextAction:row.next_action,nextActionOn:dateOnly(row.next_action_on),notes:row.notes,
  status:row.status,createdAt:row.created_at};
}
function schemaError(e,AppError){
 if(e?.code==='42P01')return new AppError(503,'Журнал контактов пока не установлен в TEST.');
 return e;
}
export async function crmInteractionAction({pool,p,key,uuid,safeDate,dayYerevan,AppError}){
 const item=normalizedPayload(p,{uuid,safeDate,dayYerevan,AppError});
 const {scope,kind,summary,nextAction,notes,contactOn,nextActionOn}=item;
 const hash=createHash('sha256').update(JSON.stringify([
  scope.entityType,scope.id,kind,contactOn,summary,nextAction,nextActionOn,notes
 ])).digest('hex');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const prior=await db.query('SELECT * FROM public.mvp_crm_interactions WHERE request_key=$1 FOR UPDATE',[key]);
  if(prior.rows.length){
   if(prior.rows[0].request_hash!==hash)throw new AppError(409,'Ключ запроса уже использован с другим результатом.');
   await db.query('COMMIT');return {saved:true,item:present(prior.rows[0]),deduplicated:true};
  }
  const parent=await db.query('SELECT id FROM '+scope.table+' WHERE id=$1 FOR KEY SHARE',[scope.id]);
  if(!parent.rowCount)throw new AppError(404,'Связанное обращение или клиент не найден.');
  const inserted=await db.query(
   'INSERT INTO public.mvp_crm_interactions(request_key,request_hash,entity_type,lead_id,client_id,interaction_type,contact_on,summary,next_action,next_action_on,notes) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(request_key) DO NOTHING RETURNING *',
   [key,hash,scope.entityType,scope.entityType==='Lead'?scope.id:null,scope.entityType==='Client'?scope.id:null,
    kind,contactOn,summary,nextAction,nextActionOn,notes]);
  let row=inserted.rows[0],deduplicated=false;
  if(!row){
   const existing=await db.query('SELECT * FROM public.mvp_crm_interactions WHERE request_key=$1',[key]);
   row=existing.rows[0];deduplicated=true;
   if(!row||row.request_hash!==hash)throw new AppError(409,'Ключ запроса уже использован с другими данными.');
  }
  await db.query('COMMIT');
  return {saved:true,item:present(row),deduplicated};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw schemaError(e,AppError);}
 finally{db.release();}
}
export async function crmInteractionsPage({pool,url,uuid,AppError}){
 const scope=entityScope({
  entityType:url.searchParams.get('entityType'),entityId:url.searchParams.get('entityId')
 },uuid,AppError);
 const unified=url.searchParams.get('unified')==='1';
 if(url.searchParams.has('unified')&&(!unified||scope.entityType!=='Client'))
  throw new AppError(400,'Объединённая история доступна только для клиента.');
 const limitRaw=url.searchParams.get('limit')||'20';
 if(!/^\d{1,2}$/.test(limitRaw)||+limitRaw<1||+limitRaw>40)throw new AppError(400,'Лимит: от 1 до 40.');
 let cursor=null;
 const raw=url.searchParams.get('cursor');
 if(raw){
  if(raw.length>300||!/^[a-zA-Z0-9_-]+$/.test(raw))throw new AppError(400,'Некорректная страница истории.');
  try{
   const parsed=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
   if(!Array.isArray(parsed)||parsed.length!==2||typeof parsed[0]!=='string'||
    !/^\d{4}-\d{2}-\d{2}T/.test(parsed[0])||!Number.isFinite(Date.parse(parsed[0])))
     throw Error('invalid cursor');
   cursor=[new Date(parsed[0]).toISOString(),uuid(parsed[1])];
  }catch{throw new AppError(400,'Некорректная страница истории.');}
 }
 try{
  const found=await pool.query('SELECT id FROM '+scope.table+' WHERE id=$1',[scope.id]);
  if(!found.rowCount)throw new AppError(404,'Обращение или клиент не найден.');
  const params=[scope.id,Number(limitRaw)+1];
  const older=cursor?' AND (created_at,id) < ($3::timestamptz,$4::uuid)':'';
  if(cursor)params.push(cursor[0],cursor[1]);
  // Direct client events + verified conversion/intake Lead references only.
  // UNION of related Lead IDs avoids duplicating a Lead linked through both
  // intake and later conversion. No name/phone matching or legacy Google import.
  const sql=unified?`
   WITH related AS (
    SELECT lead_id,MAX(kind)::int relation_kind
    FROM (
     SELECT lead_id,2 AS kind FROM public.mvp_crm_lead_client_links WHERE client_id=$1
     UNION ALL
     SELECT lead_id,1 AS kind FROM public.mvp_crm_lead_intakes WHERE client_id=$1
    ) scoped GROUP BY lead_id
   ),timeline AS (
    SELECT i.*, 'after_client'::text AS history_stage,''::text AS lead_title
    FROM public.mvp_crm_interactions i WHERE i.client_id=$1
    UNION ALL
    SELECT i.*, CASE WHEN r.relation_kind=2 THEN 'converted_lead'
                    ELSE 'repeat_lead' END::text AS history_stage,
           l.title::text AS lead_title
    FROM related r
    JOIN public.mvp_leads l ON l.id=r.lead_id
    JOIN public.mvp_crm_interactions i ON i.lead_id=r.lead_id
   )
   SELECT * FROM timeline WHERE true`+older+
   ' ORDER BY created_at DESC,id DESC LIMIT $2'
   :'SELECT * FROM public.mvp_crm_interactions WHERE '+scope.column+'=$1'+older+
    ' ORDER BY created_at DESC,id DESC LIMIT $2';
  const out=await pool.query(sql,params);
  const hasMore=out.rows.length>Number(limitRaw),rows=out.rows.slice(0,Number(limitRaw));
  const last=rows.at(-1);
  return {entityType:scope.entityType,entityId:scope.id,items:rows.map(row=>({
    ...present(row),
    ...(unified?{historyStage:row.history_stage,leadTitle:row.lead_title||''}:{})
   })),hasMore,
   ...(unified?{unified:true,coverage:'CLEAN_LINKED_INTERACTIONS_ONLY',historicalGoogleImported:false}:{}),
   nextCursor:hasMore&&last?Buffer.from(JSON.stringify([
    new Date(last.created_at).toISOString(),last.id
   ])).toString('base64url'):null};
 }catch(e){throw schemaError(e,AppError);}
}
