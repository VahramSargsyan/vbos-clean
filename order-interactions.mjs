/* Clean Order contact journal: exact WorkOrder UUID, append-only, no Google import.
 * Reuses the tested Object-contact validation/idempotency/pagination model.
 * Contacts are communications, not WorkLogs or order lifecycle mutations.
 */
import {createHash} from 'node:crypto';

const kinds=new Set(['call','message','meeting','site_visit','note','other']);
function err(AppError,status,message){throw new AppError(status,message);}
function clean(value,max,label,AppError,required=false){
 if(value==null)value='';
 if(typeof value!=='string')err(AppError,400,label+': неверный формат.');
 const text=value.trim();
 if((required&&!text)||text.length>max)err(AppError,400,label+': не более '+max+' символов.');
 return text;
}
function localDateTime(raw,AppError){
 if(raw==null||raw==='')return null;
 if(typeof raw!=='string')err(AppError,400,'Некорректная дата следующего контакта.');
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
 if(!match)err(AppError,400,'Дата и время следующего контакта: YYYY-MM-DD HH:MM.');
 const [year,month,day,hour,minute]=match.slice(1).map(Number);
 const d=new Date(Date.UTC(year,month-1,day));
 if(year<2000||year>2100||d.getUTCFullYear()!==year||d.getUTCMonth()+1!==month||
    d.getUTCDate()!==day||hour>23||minute>59)
  err(AppError,400,'Некорректная дата следующего контакта.');
 return raw;
}
function output(row){
 return {id:row.id,entityType:'Order',entityId:row.order_id,
  interactionType:row.interaction_type,summary:row.summary,
  nextAction:row.next_action,nextActionAt:row.next_action_local||null,
  notes:row.notes,status:row.status,createdAt:row.created_at};
}
const cols=`*,to_char(next_action_at,'YYYY-MM-DD"T"HH24:MI') AS next_action_local`;
function schemaError(error,AppError){
 if(['42P01','42703'].includes(error?.code))return new AppError(503,'История контактов заказов ещё не установлена в TEST.');
 return error;
}
export async function orderInteractionAction({pool,p,key,uuid,AppError}){
 if(p.entityType!==undefined&&p.entityType!=='Order')err(AppError,400,'Контакт должен относиться к заказу.');
 const id=uuid(p.entityId);
 const kind=clean(p.interactionType||'note',30,'Тип контакта',AppError);
 if(!kinds.has(kind))err(AppError,400,'Неверный тип контакта.');
 const summary=clean(p.summary,1000,'Описание контакта',AppError,true);
 const nextAction=clean(p.nextAction,500,'Следующее действие',AppError);
 const nextActionAt=localDateTime(p.nextActionAt,AppError);
 const notes=clean(p.notes,5000,'Заметки',AppError);
 if(nextActionAt&&!nextAction)err(AppError,400,'Для даты следующего контакта укажи действие.');
 const hash=createHash('sha256').update(JSON.stringify([id,kind,summary,nextAction,nextActionAt,notes])).digest('hex');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const prior=await db.query('SELECT '+cols+' FROM public.mvp_order_interactions WHERE request_key=$1 FOR UPDATE',[key]);
  if(prior.rows.length){
   if(prior.rows[0].request_hash!==hash)err(AppError,409,'Ключ контакта уже использован с другими данными.');
   await db.query('COMMIT');
   return {saved:true,item:output(prior.rows[0]),deduplicated:true};
  }
  const parent=await db.query('SELECT id FROM public.mvp_orders WHERE id=$1 FOR KEY SHARE',[id]);
  if(parent.rowCount===0)err(AppError,404,'Заказ для контакта не найден.');
  const insert=await db.query(
   "INSERT INTO public.mvp_order_interactions(request_key,request_hash,order_id,interaction_type,summary,next_action,next_action_at,notes) "+
   "VALUES($1,$2,$3,$4,$5,$6,$7::timestamp,$8) ON CONFLICT(request_key) DO NOTHING RETURNING id",
   [key,hash,id,kind,summary,nextAction,nextActionAt,notes]);
  if(!insert.rowCount){
   const existing=await db.query('SELECT '+cols+' FROM public.mvp_order_interactions WHERE request_key=$1',[key]);
   if(existing.rows[0]?.request_hash!==hash)err(AppError,409,'Ключ контакта уже использован с другими данными.');
   await db.query('COMMIT');
   return {saved:true,item:output(existing.rows[0]),deduplicated:true};
  }
  const saved=await db.query('SELECT '+cols+' FROM public.mvp_order_interactions WHERE id=$1',[insert.rows[0].id]);
  await db.query('COMMIT');
  return {saved:true,item:output(saved.rows[0]),deduplicated:false};
 }catch(error){await db.query('ROLLBACK').catch(()=>{});throw schemaError(error,AppError);}
 finally{db.release();}
}
export async function orderInteractionsPage({pool,url,uuid,AppError}){
 const id=uuid(url.searchParams.get('id'));
 const limitRaw=url.searchParams.get('limit')||'20';
 if(!/^\d{1,2}$/.test(limitRaw)||Number(limitRaw)<1||Number(limitRaw)>40)
  err(AppError,400,'Лимит: 1–40.');
 const limit=Number(limitRaw);
 let cursor=null;
 const raw=url.searchParams.get('cursor');
 if(raw){
  if(raw.length>300||!/^[a-zA-Z0-9_-]+$/.test(raw))err(AppError,400,'Неверная страница контактов.');
  try{
   const pair=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
   if(!Array.isArray(pair)||pair.length!==3||pair[0]!==id||
      typeof pair[1]!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(pair[1])||
      !Number.isFinite(Date.parse(pair[1])))
    throw Error('invalid cursor');
   cursor=[new Date(pair[1]).toISOString(),uuid(pair[2])];
  }catch{err(AppError,400,'Неверная страница контактов.');}
 }
 try{
  const parent=await pool.query('SELECT id FROM public.mvp_orders WHERE id=$1',[id]);
  if(!parent.rowCount)err(AppError,404,'Заказ не найден.');
  const args=[id,limit+1],older=cursor?' AND (created_at,id)<($3::timestamptz,$4::uuid)':'';
  if(cursor)args.push(cursor[0],cursor[1]);
  const result=await pool.query('SELECT '+cols+' FROM public.mvp_order_interactions WHERE order_id=$1'+older+
   ' ORDER BY created_at DESC,id DESC LIMIT $2',args);
  const rows=result.rows.slice(0,limit),hasMore=result.rows.length>limit;
  const last=rows.at(-1);
  return {orderId:id,entityType:'Order',items:rows.map(output),hasMore,
   nextCursor:hasMore&&last?Buffer.from(JSON.stringify([
    id,new Date(last.created_at).toISOString(),last.id
   ])).toString('base64url'):null};
 }catch(error){throw schemaError(error,AppError);}
}
