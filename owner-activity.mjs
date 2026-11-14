/* VBOS Clean MVP V8 — OwnerActivity, separate from WorkDay / WorkLog / visits.
 * Source contract: OwnerActivityService.js, OwnerActivityTimezoneHotfix_v1_4_0_2.js.
 */
import {createHash} from 'node:crypto';
const select="SELECT id,day_date::text AS date,status,activity_class,summary,notes,start_at,end_at,duration_minutes,work_day_id,related_entity_type,related_entity_id,parent_activity_id,revision,started_recorded_at,ended_recorded_at,updated_at FROM public.mvp_owner_activities";
const classes=['ORGANIZATION','BUSINESS_SYSTEM'];
const parents={Lead:'mvp_leads',Client:'mvp_clients',Object:'mvp_objects',WorkOrder:'mvp_orders'};
const trim=(v,max,Err)=>{const a=String(v??'').trim();if(a.length>max)throw new Err(400,'Текст бизнес-времени слишком длинный.');return a;};
const requiredClass=(v,Err)=>{const s=String(v||'');if(!classes.includes(s))throw new Err(400,'Неизвестный тип бизнес-времени.');return s;};
const goodRevision=(v,Err)=>{const n=Number(v);if(!Number.isInteger(n)||n<1||n>2147483646)throw new Err(400,'Неверная версия записи.');return n;};
const plusOne=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const dayFor=utc=>new Date(Date.parse(utc)+4*3600000).toISOString().slice(0,10);
const validLocal=(v,safeDate,Err)=>{
 const s=String(v||'').trim();
 if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(s))throw new Err(400,'Нужно время в формате ГГГГ-ММ-ДД ЧЧ:ММ.');
 const day=safeDate(s.slice(0,10));
 const utc=new Date(s+':00+04:00');
 if(Number.isNaN(utc.getTime())||dayFor(utc.toISOString())!==day)throw new Err(400,'Некорректное время Еревана.');
 return utc.toISOString();
};
const localMinute=instant=>new Date(new Date(instant).getTime()+4*3600000).toISOString().slice(0,16);
const boundaries=(start,end,Err)=>{
 const a=Date.parse(start),b=Date.parse(end);
 if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)throw new Err(400,'Окончание должно быть позже начала.');
 let t=a,segments=[];
 while(t<b){
  if(segments.length>=62)throw new Err(400,'Слишком длинный интервал для разделения по дням.');
  const date=dayFor(new Date(t).toISOString());
  const midnight=Date.parse(plusOne(date)+'T00:00:00+04:00');
  const endMs=Math.min(midnight,b);
  const minutes=Math.round((endMs-t)/60000);
  if(minutes<=0)throw new Err(400,'Нулевой интервал бизнес-времени.');
  segments.push({date,start:new Date(t).toISOString(),end:new Date(endMs).toISOString(),minutes});
  t=endMs;
 }
 return segments;
};
async function optionalRelation(client,type,id,uuid,Err){
 const t=String(type||'');if(!t&&!id)return {type:'',id:null};
 if(!parents[t]||!id)throw new Err(400,'Связанная сущность требует допустимый тип и ID.');
 const uid=uuid(id);
 const r=await client.query('SELECT 1 FROM public.'+parents[t]+' WHERE id=$1',[uid]);
 if(!r.rows.length)throw new Err(400,'Связанная запись не найдена.');
 return {type:t,id:uid};
}
const renderRead=(client,id)=>client.query(select+' WHERE id=$1',[id]);
export async function ownerActivityRead(pool,url,{dayYerevan,safeDate,uuid,AppError}){
 const date=safeDate(url.searchParams.get('date')||dayYerevan());
 const raw=url.searchParams.get('cursor')||'';
 let cursor=null;
 if(raw){
  if(raw.length>500||!/^[a-zA-Z0-9_-]+$/.test(raw))throw new AppError(400,'Неверная страница бизнес-времени.');
  try{
   const v=JSON.parse(Buffer.from(raw,'base64url').toString());
   if(!Array.isArray(v)||v.length!==2||new Date(v[0]).toISOString()!==v[0])throw Error('bad');
   cursor=[v[0],uuid(v[1])];
  }catch{throw new AppError(400,'Неверная страница бизнес-времени.');}
 }
 const args=[date],where=" WHERE day_date=$1::date AND status<>'archived'"+(cursor?" AND (start_at,id)<($2::timestamptz,$3::uuid)":"");
 if(cursor)args.push(...cursor);
 const [today,active,totals,first]=await Promise.all([
  pool.query(select+where+' ORDER BY start_at DESC,id DESC LIMIT 26',args),
  pool.query(select+" WHERE status='active' LIMIT 1"),
  pool.query("SELECT activity_class,coalesce(sum(duration_minutes),0)::int AS minutes,count(*)::int AS records FROM public.mvp_owner_activities WHERE day_date=$1::date AND status='completed' GROUP BY activity_class",[date]),
  pool.query('SELECT min(day_date)::text AS tracking_since FROM public.mvp_owner_activities')
 ]);
 const items=today.rows.slice(0,25),last=items.at(-1),hasMore=today.rows.length>25;
 return {date,active:active.rows[0]||null,items,hasMore,
  nextCursor:hasMore&&last?Buffer.from(JSON.stringify([new Date(last.start_at).toISOString(),last.id])).toString('base64url'):null,
  totals:Object.fromEntries(classes.map(c=>[c,totals.rows.find(x=>x.activity_class===c)?.minutes||0])),
  completedCount:totals.rows.reduce((n,x)=>n+x.records,0),
  trackingSince:first.rows[0]?.tracking_since||null,
  model:{ownerActivity:'independent',workDay:'not_required',workLog:'no_automatic_mutation',physicalPresence:'not_inferred',trackedMinutes:'unadjusted_sum_not_unique_union'}
 };
}
export async function ownerActivityAction({pool,type,p,key,dayYerevan,safeDate,uuid,AppError}){
 if(!['owner_activity_start','owner_activity_stop','owner_activity_update','owner_activity_archive'].includes(type))throw new AppError(404,'Действие бизнес-времени не найдено.');
 let v={};
 if(type==='owner_activity_start'){
  v.startAt=validLocal(p.startTime,safeDate,AppError);
  v.activityClass=requiredClass(p.activityClass,AppError);
  v.summary=trim(p.summary,1000,AppError);
  v.notes=trim(p.notes,5000,AppError);
  v.relatedEntityType=String(p.relatedEntityType||'');
  v.relatedEntityId=p.relatedEntityId?uuid(p.relatedEntityId):null;
 }else{
  v.id=uuid(p.id);
  v.revision=goodRevision(p.revision,AppError);
  if(type==='owner_activity_stop'){
   v.endAt=validLocal(p.endTime,safeDate,AppError);
   v.summary=p.summary===undefined?null:trim(p.summary,1000,AppError);
   v.notes=p.notes===undefined?null:trim(p.notes,5000,AppError);
  }else if(type==='owner_activity_update'){
   v.startAt=validLocal(p.startTime,safeDate,AppError);
   v.endAt=p.endTime?validLocal(p.endTime,safeDate,AppError):null;
   v.activityClass=requiredClass(p.activityClass,AppError);
   v.summary=trim(p.summary,1000,AppError);
   v.notes=trim(p.notes,5000,AppError);
  }
 }
 const digest=createHash('sha256').update(JSON.stringify({type,...v})).digest('hex');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(151106,20261108)');
  const claim=await client.query("INSERT INTO public.mvp_owner_activity_requests(request_key,action,payload_sha256,response) VALUES($1,$2,$3,'{}'::jsonb) ON CONFLICT(request_key) DO NOTHING RETURNING request_key",[key,type,digest]);
  if(!claim.rowCount){
   const old=await client.query('SELECT action,payload_sha256,response FROM public.mvp_owner_activity_requests WHERE request_key=$1',[key]);
   if(!old.rows.length||old.rows[0].action!==type||old.rows[0].payload_sha256!==digest)throw new AppError(409,'Ключ бизнес-времени повторно использован для других данных.');
   await client.query('COMMIT');
   return {...old.rows[0].response,deduplicated:true};
  }
  let id,extra={};
  if(type==='owner_activity_start'){
   if((await client.query("SELECT id FROM public.mvp_owner_activities WHERE status='active' LIMIT 1")).rows.length)
    throw new AppError(409,'Уже запущен другой таймер бизнес-времени.');
   const date=dayFor(v.startAt);
   const link=(await client.query('SELECT id FROM public.mvp_work_days WHERE day_date=$1::date LIMIT 1',[date])).rows[0]?.id||null;
   const relation=await optionalRelation(client,v.relatedEntityType,v.relatedEntityId,uuid,AppError);
   const r=await client.query("INSERT INTO public.mvp_owner_activities(day_date,activity_class,summary,notes,start_at,work_day_id,related_entity_type,related_entity_id) VALUES($1::date,$2,$3,$4,$5::timestamptz,$6,$7,$8) RETURNING id",[date,v.activityClass,v.summary,v.notes,v.startAt,link,relation.type,relation.id]);
   id=r.rows[0].id;
  }else{
   const old=await client.query('SELECT * FROM public.mvp_owner_activities WHERE id=$1 FOR UPDATE',[v.id]);
   if(!old.rows.length)throw new AppError(404,'Запись бизнес-времени не найдена.');
   const row=old.rows[0];
   if(row.revision!==v.revision)throw new AppError(409,'Запись изменилась. Обнови экран и повтори.');
   id=row.id;
   if(type==='owner_activity_stop'){
    if(row.status!=='active')throw new AppError(409,'Таймер уже остановлен или архивирован.');
    const seg=boundaries(new Date(row.start_at).toISOString(),v.endAt,AppError);
    const summary=v.summary===null?row.summary:v.summary,notes=v.notes===null?row.notes:v.notes;
    await client.query("UPDATE public.mvp_owner_activities SET status='completed',end_at=$2,ended_recorded_at=now(),duration_minutes=$3,summary=$4,notes=$5,revision=revision+1,updated_at=now() WHERE id=$1",[id,seg[0].end,seg[0].minutes,summary,notes]);
    const ids=[];
    for(const part of seg.slice(1)){
     const workDay=(await client.query('SELECT id FROM public.mvp_work_days WHERE day_date=$1::date',[part.date])).rows[0]?.id||null;
     const x=await client.query("INSERT INTO public.mvp_owner_activities(day_date,status,activity_class,summary,notes,start_at,end_at,duration_minutes,work_day_id,related_entity_type,related_entity_id,parent_activity_id,ended_recorded_at) VALUES($1::date,'completed',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()) RETURNING id",[part.date,row.activity_class,summary,notes,part.start,part.end,part.minutes,workDay,row.related_entity_type,row.related_entity_id,id]);
     ids.push(x.rows[0].id);
    }
    extra={splitCount:ids.length,splitIds:ids,totalDurationMinutes:seg.reduce((n,x)=>n+x.minutes,0)};
   }else if(type==='owner_activity_update'){
    if(row.status==='archived')throw new AppError(409,'Архив нельзя изменять.');
    if(dayFor(v.startAt)!==dayFor(new Date(row.start_at).toISOString()))throw new AppError(400,'Дата начала записи не меняется при исправлении времени.');
    if(row.status==='active'){
     if(v.endAt)throw new AppError(400,'Для активного таймера используй «Стоп».');
     await client.query("UPDATE public.mvp_owner_activities SET start_at=$2,activity_class=$3,summary=$4,notes=$5,revision=revision+1,updated_at=now() WHERE id=$1",[id,v.startAt,v.activityClass,v.summary,v.notes]);
    }else{
     if(!v.endAt)throw new AppError(400,'Для завершённой записи необходимо время окончания.');
     const split=boundaries(v.startAt,v.endAt,AppError);
     if(split.length!==1)throw new AppError(400,'Исправляй время каждого календарного сегмента отдельно.');
     await client.query("UPDATE public.mvp_owner_activities SET start_at=$2,end_at=$3,duration_minutes=$4,activity_class=$5,summary=$6,notes=$7,revision=revision+1,updated_at=now() WHERE id=$1",[id,v.startAt,v.endAt,split[0].minutes,v.activityClass,v.summary,v.notes]);
    }
   }else if(type==='owner_activity_archive'){
    if(row.status!=='completed')throw new AppError(409,'Архивировать можно только завершённую запись.');
    await client.query("UPDATE public.mvp_owner_activities SET status='archived',revision=revision+1,updated_at=now() WHERE id=$1",[id]);
   }
  }
  const item=(await renderRead(client,id)).rows[0];
  const response={saved:true,item,...extra};
  await client.query("UPDATE public.mvp_owner_activity_requests SET response=$2::jsonb WHERE request_key=$1",[key,JSON.stringify(response)]);
  await client.query('COMMIT');
  return response;
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();}
}
