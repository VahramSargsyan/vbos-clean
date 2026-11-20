/**
 * SOP copy (legacy KnowledgeService.js / Scripts.html).
 * No seed materials are copied into the public repository.
 * All writes remain blocked until separately reconciled owner cutover.
 */
import {createHash} from 'node:crypto';

export const KNOWLEDGE_STAGES=Object.freeze(['LEADS','INSPECTION','OFFER','WORK','QUALITY','HANDOVER','WARRANTY','IMPROVEMENTS','STOP']);
export const KNOWLEDGE_STAGE_LABELS=Object.freeze({
 LEADS:'Лиды',INSPECTION:'Осмотр',OFFER:'Предложение и цена',WORK:'Работа',
 QUALITY:'Качество',HANDOVER:'Запуск и сдача',WARRANTY:'Гарантия',
 IMPROVEMENTS:'Итоги и улучшения',STOP:'STOP / исключения',OTHER:'Справка'
});
const TYPES=['SOP','CHECKLIST','RULE','STANDARD','EXPERIENCE','REFERENCE'];
const STATUSES=['active','draft','archived'];
const PRIORITIES=['LOW','MEDIUM','HIGH','CRITICAL'];
const columns=['status','type','code','title','section_path','summary','full_text','tags','version',
 'source_name','source_version','sort_order','priority','favorite','client_request_id'];
const limits={code:80,title:300,sectionPath:300,summary:2000,fullText:49000,tags:1000,
 version:60,sourceName:300,sourceVersion:80};
const err=(AppError,status,message)=>{throw new AppError(status,message)};
const cleanText=(v,max,AppError,{required=false}={})=>{
 if(typeof v!=='string')err(AppError,400,'Поле должно быть текстом.');
 const value=v.trim().slice(0,max); // legacy Google service truncates optional fields
 if(required&&(!value||v.trim().length>max))err(AppError,400,'Название обязательно (до 300 символов).');
 return value;
};
const choice=(v,allowed,AppError,label)=>{
 if(typeof v!=='string'||!allowed.includes(v))err(AppError,400,'Неизвестный '+label+'.');
 return v;
};
const favorite=v=>/^(1|true|yes|да)$/i.test(String(v??'').trim())?'true':'false';
export function knowledgeStageKeys(item){
 const code=String(item?.code||'').trim().toUpperCase();
 const section=String(item?.sectionPath||'').trim().toLowerCase();
 const tags=String(item?.tags||'').trim().toLowerCase();
 const title=String(item?.title||'').trim().toLowerCase();
 const keys=[];
 const add=x=>{if(x&&!keys.includes(x))keys.push(x)};
 const match=code.match(/^([1-8])\./);
 if(match){add({'1':'LEADS','2':'INSPECTION','3':'OFFER','4':'WORK','5':'QUALITY','6':'HANDOVER','7':'WARRANTY','8':'IMPROVEMENTS'}[match[1]]);return keys;}
 if(/^S\./.test(code)){add('STOP');return keys;}
 if(code==='SOP-ARCH'||code==='SOP-SOURCES')return keys;
 const scoped=section+' '+tags+' '+title;
 if(/входящ|лид|квалификац/.test(scoped))add('LEADS');
 if(/осмотр|замер|готовност[ьи]\s+рабочего\s+фронта/.test(scoped))add('INSPECTION');
 if(/расч[её]т|согласован|коммерческ|тариф|предложен|рентабельност/.test(scoped))add('OFFER');
 if(/ведение\s+объекта|рабочего\s+дня|помощник|инструмент|материал|приостанов|прекращен/.test(scoped))add('WORK');
 if(/качество|скрыт|опрессов|канализац|поврежден|переделк/.test(scoped))add('QUALITY');
 if(/запуск|регулиров|испытан|сдач|акт\s+сдач|паспорт\s+систем|окончательн.*оплат/.test(scoped))add('HANDOVER');
 if(/гарант|сервис|повторн.*выезд/.test(scoped))add('WARRANTY');
 if(/закрыти[ея]\s+объекта|экономик|пост-анализ|изменени[ея]\s+систем|верс.*sop|архивирован/.test(scoped))add('IMPROVEMENTS');
 if(/\bstop\b|безопасн.*останов|инцидент|исключени[ея]\s+из\s+sop/.test(scoped))add('STOP');
 return keys;
}
export function knowledgeSort(items){
 return [...items].sort((a,b)=>{
  const favoriteDifference=Number(favorite(b.favorite)==='true')-Number(favorite(a.favorite)==='true');
  if(favoriteDifference)return favoriteDifference;
  const order=Number(a.sortOrder||0)-Number(b.sortOrder||0);
  return order||String(a.code||'').localeCompare(String(b.code||''),'ru',{numeric:true});
 });
}
export function knowledgeFilter(items,{query='',type='ALL',status='active',stage='ALL',favoritesOnly=false}={}){
 const needle=String(query).trim().toLowerCase();
 return items.filter(item=>{
  if(type!=='ALL'&&item.type!==type)return false;
  if(status!=='ALL'&&item.status!==status)return false;
  if(favoritesOnly&&favorite(item.favorite)!=='true')return false;
  if(stage!=='ALL'&&!knowledgeStageKeys(item).includes(stage))return false;
  if(needle&&![item.code,item.title,item.sectionPath,item.summary,item.fullText,item.tags,item.sourceName]
   .map(v=>String(v||'').toLowerCase()).join('\n').includes(needle))return false;
  return true;
 });
}
export function normalizeKnowledgePayload(raw,old,AppError){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))err(AppError,400,'Материал: неверные данные.');
 const pick=(name,defaultValue='')=>raw[name]===undefined?(old?.[name]??defaultValue):raw[name];
 const title=cleanText(pick('title'),limits.title,AppError,{required:true});
 const data={
  status:choice(pick('status','active'),STATUSES,AppError,'статус'),
  type:choice(pick('type','REFERENCE'),TYPES,AppError,'тип'),
  code:cleanText(pick('code'),limits.code,AppError),
  title,sectionPath:cleanText(pick('sectionPath'),limits.sectionPath,AppError),
  summary:cleanText(pick('summary'),limits.summary,AppError),
  fullText:cleanText(pick('fullText'),limits.fullText,AppError),
  tags:cleanText(pick('tags'),limits.tags,AppError),
  version:cleanText(pick('version'),limits.version,AppError),
  sourceName:cleanText(pick('sourceName'),limits.sourceName,AppError),
  sourceVersion:cleanText(pick('sourceVersion'),limits.sourceVersion,AppError),
  priority:choice(pick('priority','MEDIUM'),PRIORITIES,AppError,'приоритет'),
  favorite:favorite(pick('favorite','false'))
 };
 const number=Number(pick('sortOrder',0));
 if(!Number.isFinite(number))err(AppError,400,'Неверный порядок сортировки.');
 data.sortOrder=number;
 return data;
}
function knowledgeFromRow(r){
 return {knowledgeId:r.knowledge_id,createdAt:r.created_at,updatedAt:r.updated_at,
  status:r.status,type:r.type,code:r.code,title:r.title,sectionPath:r.section_path,
  summary:r.summary,fullText:r.full_text,tags:r.tags,version:r.version,
  sourceName:r.source_name,sourceVersion:r.source_version,sortOrder:Number(r.sort_order),
  priority:r.priority,favorite:r.favorite?'true':'false',clientRequestId:r.client_request_id};
}
async function authority(db,AppError){
 let row;
 try{row=(await db.query('SELECT phase,source_snapshot_hash FROM public.mvp_knowledge_authority WHERE id=1')).rows[0];}
 catch(e){if(e.code==='42P01')err(AppError,409,'База знаний пока не подготовлена для переноса.');throw e;}
 if(!row)err(AppError,409,'Источник SOP не подтверждён.');
 return row;
}
export async function knowledgeRead({pool,AppError}){
 const control=await authority(pool,AppError);
 const rows=(await pool.query('SELECT * FROM public.mvp_knowledge_items')).rows.map(knowledgeFromRow);
 const items=knowledgeSort(rows);
 return {items,total:items.length,sourceMeta:{
  sourceName:'Карта SOP системы бизнеса v0.2.62',sourceVersion:'v0.2.62',
  detailedSopCards:control.source_snapshot_hash?61:0,totalSeedItems:control.source_snapshot_hash?64:0
 },generatedAt:new Date().toISOString(),authority:control.phase,
  writeEnabled:control.phase==='CLEAN'&&Boolean(control.source_snapshot_hash)};
}
const values=x=>[x.status,x.type,x.code,x.title,x.sectionPath,x.summary,x.fullText,x.tags,
 x.version,x.sourceName,x.sourceVersion,x.sortOrder,x.priority,x.favorite==='true'];
export async function knowledgeSave({pool,p,key,AppError}){
 if(typeof key!=='string'||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)))
  err(AppError,400,'Неверный ключ сохранения.');
 const id=String(p?.knowledgeId||'').trim();
 if(id&&!/^KNW-\d{4}-\d{4,}$/.test(id))err(AppError,400,'Неверный ID материала.');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  let a;
  try{a=(await db.query('SELECT phase,source_snapshot_hash FROM public.mvp_knowledge_authority WHERE id=1 FOR SHARE')).rows[0];}
  catch(e){if(e.code==='42P01')err(AppError,409,'База знаний ещё не перенесена.');throw e;}
  if(!a||a.phase!=='CLEAN'||!a.source_snapshot_hash)
   err(AppError,409,'Сохранение SOP заблокировано до подтверждённой миграции источника.');
  const old=id?(await db.query('SELECT * FROM public.mvp_knowledge_items WHERE knowledge_id=$1 FOR UPDATE',[id])).rows[0]:null;
  if(id&&!old)err(AppError,404,'Материал не найден.');
  const data=normalizeKnowledgePayload(p,old&&knowledgeFromRow(old),AppError);
  const hash=createHash('sha256').update(JSON.stringify({knowledgeId:id,...data})).digest('hex');
  const op=id?'update_knowledge_item':'create_knowledge_item';
  const reserved=await db.query('INSERT INTO public.mvp_knowledge_requests(request_key,operation,payload_sha256) VALUES($1,$2,$3) ON CONFLICT(request_key) DO NOTHING RETURNING request_key',[key,op,hash]);
  if(!reserved.rows.length){
   const existing=(await db.query('SELECT * FROM public.mvp_knowledge_requests WHERE request_key=$1 FOR UPDATE',[key])).rows[0];
   if(!existing||existing.operation!==op||existing.payload_sha256!==hash)
    err(AppError,409,'Ключ сохранения уже использован с другими данными.');
   if(!existing.response)err(AppError,409,'Сохранение ещё выполняется.');
   await db.query('COMMIT');return existing.response;
  }
  let knowledgeId=id;
  if(!id){
   const year=new Date().getUTCFullYear();
   const sequence=(await db.query(
    'INSERT INTO public.mvp_knowledge_sequences(year,last_value) VALUES($1,1) '+
    'ON CONFLICT(year) DO UPDATE SET last_value=public.mvp_knowledge_sequences.last_value+1 '+
    'RETURNING last_value',[year])).rows[0].last_value;
   knowledgeId='KNW-'+year+'-'+String(sequence).padStart(4,'0');
  }
  const col=columns.slice(0,14);
  const vals=values(data);
  let saved;
  if(id){
   const setters=col.map((c,i)=>c+'=$'+(i+2)).join(',');
   saved=(await db.query('UPDATE public.mvp_knowledge_items SET '+setters+
    ',client_request_id=$16,updated_at=now() WHERE knowledge_id=$1 RETURNING *',
    [id,...vals,key])).rows[0];
  }else{
   const names=['knowledge_id',...col,'client_request_id'];
   const placeholders=names.map((_,i)=>'$'+(i+1)).join(',');
   saved=(await db.query('INSERT INTO public.mvp_knowledge_items('+names.join(',')+
    ') VALUES('+placeholders+') RETURNING *',[knowledgeId,...vals,key])).rows[0];
  }
  const result={entityId:knowledgeId,data:knowledgeFromRow(saved)};
  await db.query('UPDATE public.mvp_knowledge_requests SET response=$2::jsonb WHERE request_key=$1',
   [key,JSON.stringify(result)]);
  await db.query('COMMIT');
  return result;
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
 finally{db.release();}
}
