/* Daily A1 V6 — independent daily goal for dedicated PostgreSQL TEST. */
import {createHash} from 'node:crypto';

const outcomes=['COMPLETED','PARTIAL','NOT_COMPLETED'];
const view="SELECT id,day_date::text AS date,status,goal,reason,outcome,outcome_note,notes,revision,created_at,updated_at FROM public.mvp_daily_a1";
const txt=(v,max,required,AppError)=>{
 const s=String(v??'').trim();
 if(s.length>max||(required&&!s.length))throw new AppError(400,'Поле A1 пустое или слишком длинное.');
 return s;
};
const revision=(v,AppError)=>{
 const n=Number(v);
 if(!Number.isInteger(n)||n<0||n>2147483646)throw new AppError(400,'Некорректная версия A1.');
 return n;
};
export async function dailyA1Read(pool,date){
 const r=await pool.query(view+' WHERE day_date=$1::date LIMIT 1',[date]);
 return {date,item:r.rows[0]||null,source:'mvp_daily_a1',coupledToWorkDay:false,coupledToWorkOrder:false};
}
export async function dailyA1Action({pool,type,p,key,dayYerevan,safeDate,AppError}){
 if(!['a1_save','a1_complete','a1_reopen'].includes(type))throw new AppError(404,'Неизвестное действие A1.');
 const date=safeDate(p.date||dayYerevan()),id='DA1-'+date;
 if(p.id!==undefined && p.id!=='' && p.id!==id)throw new AppError(400,'A1 ID не совпадает с календарной датой.');
 const rev=revision(p.revision,AppError);
 const value={date,revision:rev};
 if(type==='a1_save'){
  value.goal=txt(p.goal,1000,true,AppError);
  value.reason=txt(p.reason,2000,true,AppError);
  value.notes=txt(p.notes,5000,false,AppError);
 }else if(type==='a1_complete'){
  value.outcome=String(p.outcome??'');
  if(!outcomes.includes(value.outcome))throw new AppError(400,'Выбери результат A1.');
  value.outcomeNote=txt(p.outcomeNote,3000,false,AppError);
 }
 const digest=createHash('sha256').update(JSON.stringify({type,...value})).digest('hex');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const claim=await client.query("INSERT INTO public.mvp_a1_requests(request_key,action,payload_sha256,response) VALUES($1,$2,$3,'{}'::jsonb) ON CONFLICT(request_key) DO NOTHING RETURNING request_key",[key,type,digest]);
  if(!claim.rowCount){
   const prior=await client.query('SELECT action,payload_sha256,response FROM public.mvp_a1_requests WHERE request_key=$1',[key]);
   if(!prior.rows.length||prior.rows[0].action!==type||prior.rows[0].payload_sha256!==digest)
    throw new AppError(409,'Ключ A1 уже использован для других данных.');
   await client.query('COMMIT');
   return {...prior.rows[0].response,deduplicated:true};
  }
  const old=await client.query(view+' WHERE day_date=$1::date FOR UPDATE',[date]);
  const current=old.rows[0]||null;
  if(type==='a1_save'){
   if(!current){
    if(rev!==0)throw new AppError(409,'A1 изменился. Обнови экран.');
    await client.query('INSERT INTO public.mvp_daily_a1(id,day_date,goal,reason,notes) VALUES($1,$2::date,$3,$4,$5)',[id,date,value.goal,value.reason,value.notes]);
   }else{
    if(current.revision!==rev)throw new AppError(409,'A1 изменился в другой вкладке. Обнови экран.');
    await client.query('UPDATE public.mvp_daily_a1 SET goal=$2,reason=$3,notes=$4,revision=revision+1,updated_at=now() WHERE id=$1',[id,value.goal,value.reason,value.notes]);
   }
  }else{
   if(!current||current.revision!==rev)throw new AppError(409,'A1 не найден или изменился. Обнови экран.');
   if(type==='a1_complete'){
    if(current.status!=='open')throw new AppError(409,'A1 уже завершён. Обнови экран.');
    await client.query("UPDATE public.mvp_daily_a1 SET status='completed',outcome=$2,outcome_note=$3,revision=revision+1,updated_at=now() WHERE id=$1",[id,value.outcome,value.outcomeNote]);
   }else{
    if(current.status!=='completed')throw new AppError(409,'A1 уже открыт. Обнови экран.');
    await client.query("UPDATE public.mvp_daily_a1 SET status='open',outcome='',outcome_note='',revision=revision+1,updated_at=now() WHERE id=$1",[id]);
   }
  }
  const latest=await client.query(view+' WHERE day_date=$1::date',[date]);
  const response={saved:true,item:latest.rows[0]};
  await client.query('UPDATE public.mvp_a1_requests SET response=$2::jsonb WHERE request_key=$1',[key,JSON.stringify(response)]);
  await client.query('COMMIT');
  return response;
 }catch(e){
  await client.query('ROLLBACK').catch(()=>{});
  throw e;
 }finally{client.release();}
}
