// EST-CARDS-01: owner-only Estimator card catalogue. No finance writer and no legacy mutation.
import {createHash,randomUUID} from 'node:crypto';
import {listPlumbingItems,plumbingStandardForCard,calculatePlumbingEstimate} from './public/estimate-plumbing.mjs';

const SYSTEM=new Map(listPlumbingItems().map(x=>[x.cardKey,x]));
const validId=/^USR:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail=(AppError,status,message)=>{throw new AppError(status,message);};
const trimmed=(value,max,label,AppError,required=true)=>{
 if(typeof value!=='string'||value.length>max*3)fail(AppError,400,label+': неверный тип или длина.');
 const s=value.replace(/\s+/g,' ').trim();
 if((required&&!s)||s.length>max)fail(AppError,400,label+': укажи от 1 до '+max+' символов.');
 return s;
};
const boolean=v=>v===true;
const points=(value,enabled,name,AppError)=>{
 if(!enabled)return 0;
 if(!/^\d{1,2}$/.test(String(value??''))||Number(value)<1||Number(value)>30)
  fail(AppError,400,name+': для выбранной работы укажи 1–30 точек на прибор.');
 return Number(value);
};
function normalizeMaterials(value,AppError){
 if(!Array.isArray(value)||value.length>100)fail(AppError,400,'Список материалов: максимум 100 позиций.');
 return value.map((item,i)=>{
  if(!item||typeof item!=='object'||Array.isArray(item))fail(AppError,400,'Строка материала '+(i+1)+': неверный формат.');
  const name=trimmed(item.name,120,'Материал '+(i+1),AppError);
  const unit=trimmed(item.unit??'шт',30,'Единица материала',AppError);
  const section=trimmed(item.section??'',80,'Раздел материала',AppError,false);
  const quantity=String(item.quantity??'').replace(',','.');
  if(!/^\d{1,5}(?:\.\d{1,3})?$/.test(quantity)||Number(quantity)<=0||Number(quantity)>100000)
   fail(AppError,400,'Материал '+name+': количество должно быть больше нуля (до 3 знаков).');
  return {name,unit,section,quantity:Number(quantity).toFixed(3)};
 });
}
export function normalizeEstimatorCardDefinition(raw,{AppError}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))fail(AppError,400,'Карточка: неверный формат.');
 const displayName=trimmed(raw.displayName,120,'Название карточки',AppError);
 const category=trimmed(raw.category??'OTHER',40,'Категория',AppError).toUpperCase();
 if(!/^[A-Z0-9_-]{2,40}$/.test(category))fail(AppError,400,'Категория: латинские буквы, цифры и _.');
 const unit=trimmed(raw.unit??'шт',30,'Единица',AppError);
 const supportsWater=boolean(raw.supportsWater),supportsSewer=boolean(raw.supportsSewer),supportsInstall=boolean(raw.supportsInstall);
 if(!supportsWater&&!supportsSewer&&!supportsInstall)fail(AppError,400,'Выбери хотя бы одну работу.');
 const waterPoints=points(raw.waterPoints,supportsWater,'Монтаж воды',AppError);
 const sewerPoints=points(raw.sewerPoints,supportsSewer,'Монтаж канализации',AppError);
 const notes=trimmed(raw.notes??'',1000,'Примечание',AppError,false);
 const recipeMode=raw.recipeMode==='SOURCE'?'SOURCE':'OWNER_OVERRIDE';
 const materials=recipeMode==='SOURCE'?[]:normalizeMaterials(raw.materials??[],AppError);
 return {displayName,category,unit,supportsWater,supportsSewer,supportsInstall,
  waterPoints,sewerPoints,notes,recipeMode,materials};
}
function sourceRecipe(cardKey){
 const item=SYSTEM.get(cardKey);
 if(!item||item.materialStatus!=='READY')return [];
 const standard=plumbingStandardForCard(cardKey);
 try{
  const r=calculatePlumbingEstimate({cardKey,tariff:'ECONOM',quantity:1,
   coldWaterPoints:0,hotWaterPoints:0,sewerPoints:0,chasingMeters:0,install:true,includeMaterials:true});
  return r.lines.filter(x=>x.kind==='MATERIAL').map(x=>({name:x.description,quantity:x.quantity,unit:x.unit,section:''}));
 }catch{return [];}
}
function sourceCard(key){
 const s=SYSTEM.get(key),std=plumbingStandardForCard(key);
 return {cardKey:key,sourceType:'SYSTEM',status:'active',displayName:s.displayName,
  category:s.category,unit:'шт',supportsWater:std.supportsWater,supportsSewer:std.supportsSewer,
  supportsInstall:std.supportsInstall,waterPoints:std.waterPoints??0,sewerPoints:std.sewerPoints??0,
  notes:'',recipeMode:'SOURCE',materials:sourceRecipe(key),materialStatus:s.materialStatus,revision:0};
}
function projected(row){
 return {cardKey:row.card_key,sourceType:row.source_type,status:row.status,
  displayName:row.display_name,category:row.category,unit:row.unit,
  supportsWater:row.supports_water,supportsSewer:row.supports_sewer,supportsInstall:row.supports_install,
  waterPoints:row.water_points,sewerPoints:row.sewer_points,notes:row.notes,
  recipeMode:row.recipe_mode,materials:row.materials,revision:row.revision};
}
export async function estimatorCardsRead({pool,AppError}){
 try{
  const rows=(await pool.query('SELECT * FROM public.mvp_estimator_cards ORDER BY source_type,display_name,card_key LIMIT 500')).rows;
  const allSystemRows=new Map(rows.filter(x=>x.source_type==='SYSTEM').map(x=>[x.card_key,x]));
  const overlays=new Map(rows.filter(x=>x.source_type==='SYSTEM'&&x.status==='active').map(x=>[x.card_key,x]));
  const systems=[...SYSTEM.keys()].map(key=>{
   const base=sourceCard(key),row=overlays.get(key);
   if(!row)return {...base,revision:allSystemRows.get(key)?.revision??0};
   const p=projected(row);
   return {...p,hasOverride:true,materials:p.recipeMode==='SOURCE'?base.materials:p.materials,
    materialStatus:p.recipeMode==='SOURCE'?base.materialStatus:(p.materials.length?'READY':'NOT_CONFIGURED')};
  });
  const users=rows.filter(x=>x.source_type==='USER').map(x=>({...projected(x),
   materialStatus:x.materials.length?'READY':'NOT_CONFIGURED'}));
  return {ready:true,version:'EST_CARDS_01',items:systems.concat(users)};
 }catch(e){
  if(e.code==='42P01'||e.code==='42703')fail(AppError,503,'Редактор карточек ещё не установлен в TEST PostgreSQL.');
  throw e;
 }
}
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function estimatorCardAction({pool,type,p,key,AppError}){
 if(!['estimator_card_save','estimator_card_archive','estimator_card_reset'].includes(type))
  fail(AppError,404,'Неизвестная операция карточки.');
 const inputKey=String(p?.cardKey||'').trim();
 const cardKey=/^USR:/i.test(inputKey)?'USR:'+inputKey.slice(4).toLowerCase():inputKey.toUpperCase();
 if(cardKey&&(!SYSTEM.has(cardKey)&&!validId.test(cardKey)))fail(AppError,400,'Карточка не найдена.');
 if(!cardKey&&type!=='estimator_card_save')fail(AppError,400,'Выбери карточку.');
 if(cardKey===' '||cardKey.length>64)fail(AppError,400,'Код карточки неверен.');
 const revision=p?.revision;
 if(cardKey&&(!Number.isInteger(Number(revision))||Number(revision)<0||Number(revision)>2147483647))
  fail(AppError,400,'Версия карточки неверна.');
 const definition=type==='estimator_card_save'?normalizeEstimatorCardDefinition(p,{AppError}):null;
 const isSystem=SYSTEM.has(cardKey);
 const normalized={type,cardKey,revision:cardKey?Number(revision):null,definition};
 if(type==='estimator_card_save'&&isSystem&&definition.recipeMode==='SOURCE'){
  // SOURCE means preserving the immutable, built-in source recipe.
  normalized.definition.materials=[];
 }
 const digest=hash(normalized),client=await pool.connect();
 try{
  await client.query('BEGIN');
  const claim=await client.query('INSERT INTO public.mvp_estimator_card_requests(request_key,action,payload_sha256) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING request_key',
   [key,type,digest]);
  if(!claim.rowCount){
   const old=(await client.query('SELECT action,payload_sha256,response FROM public.mvp_estimator_card_requests WHERE request_key=$1',[key])).rows[0];
   if(!old||old.action!==type||old.payload_sha256!==digest)fail(AppError,409,'Ключ сохранения уже использован для другой карточки.');
   await client.query('COMMIT');return {...old.response,deduplicated:true};
  }
  await client.query('SELECT pg_advisory_xact_lock(20261114,3501)');
  let current=null;
  if(cardKey){
   current=(await client.query('SELECT * FROM public.mvp_estimator_cards WHERE card_key=$1 FOR UPDATE',[cardKey])).rows[0]||null;
   if(isSystem){
    const currRevision=current?.revision??0;
    if(currRevision!==Number(revision))fail(AppError,409,'Системная карточка изменена. Обнови экран.');
   }else{
    if(!current||current.source_type!=='USER')fail(AppError,404,'Карточка не найдена.');
    if(current.revision!==Number(revision))fail(AppError,409,'Карточка изменена. Обнови экран.');
   }
  }
  let stored;
  if(type==='estimator_card_save'){
   const existing=await client.query('SELECT card_key,category,display_name FROM public.mvp_estimator_cards WHERE status=$1 AND category=$2 AND lower(display_name)=lower($3) AND card_key<>$4 LIMIT 1',
    ['active',definition.category,definition.displayName,cardKey]);
   if(existing.rowCount)fail(AppError,409,'Уже есть карточка с таким названием и категорией.');
   const clashes=[...SYSTEM].some(([k,v])=>k!==cardKey&&v.category===definition.category&&
    v.displayName.toLocaleLowerCase('ru')===definition.displayName.toLocaleLowerCase('ru'));
   if(clashes)fail(AppError,409,'Название совпадает с системной карточкой.');
   if(cardKey){
    if(!isSystem&&current.status!=='active')fail(AppError,409,'Карточка в архиве; редактирование отключено.');
    const nextVersion=(current?.revision??0)+1;
    const values=[definition.displayName,definition.category,definition.unit,definition.supportsWater,
     definition.supportsSewer,definition.supportsInstall,definition.waterPoints,definition.sewerPoints,
     definition.notes,isSystem?definition.recipeMode:'OWNER_OVERRIDE',JSON.stringify(definition.materials)];
    if(current){
     stored=(await client.query(
      'UPDATE public.mvp_estimator_cards SET status=$2,display_name=$3,category=$4,unit=$5,supports_water=$6,supports_sewer=$7,supports_install=$8,water_points=$9,sewer_points=$10,notes=$11,recipe_mode=$12,materials=$13::jsonb,revision=revision+1,updated_at=now() WHERE card_key=$1 RETURNING *',
      [cardKey,'active',...values])).rows[0];
    }else{
     stored=(await client.query(
      'INSERT INTO public.mvp_estimator_cards(card_key,source_type,display_name,category,unit,supports_water,supports_sewer,supports_install,water_points,sewer_points,notes,recipe_mode,materials) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb) RETURNING *',
      [cardKey,'SYSTEM',...values])).rows[0];
    }
   }else{
    const id=randomUUID(),newKey='USR:'+id;
    stored=(await client.query(
     "INSERT INTO public.mvp_estimator_cards(id,card_key,source_type,display_name,category,unit,supports_water,supports_sewer,supports_install,water_points,sewer_points,notes,recipe_mode,materials) VALUES($1,$2,'USER',$3,$4,$5,$6,$7,$8,$9,$10,$11,'OWNER_OVERRIDE',$12::jsonb) RETURNING *",
     [id,newKey,definition.displayName,definition.category,definition.unit,definition.supportsWater,
      definition.supportsSewer,definition.supportsInstall,definition.waterPoints,definition.sewerPoints,
      definition.notes,JSON.stringify(definition.materials)])).rows[0];
   }
  }else if(type==='estimator_card_archive'){
   if(isSystem||current.status==='archived')fail(AppError,409,'Можно архивировать только активную пользовательскую карточку.');
   stored=(await client.query("UPDATE public.mvp_estimator_cards SET status='archived',revision=revision+1,updated_at=now() WHERE card_key=$1 RETURNING *",[cardKey])).rows[0];
  }else{
   if(!isSystem||!current||current.status!=='active')fail(AppError,409,'Только изменённая системная карточка может быть сброшена.');
   stored=(await client.query("UPDATE public.mvp_estimator_cards SET status='archived',revision=revision+1,updated_at=now() WHERE card_key=$1 RETURNING *",[cardKey])).rows[0];
  }
  const result={saved:true,cardKey:stored.card_key,revision:stored.revision,status:stored.status,
   sourceType:stored.source_type};
  await client.query('UPDATE public.mvp_estimator_card_requests SET response=$2::jsonb WHERE request_key=$1',[key,JSON.stringify(result)]);
  await client.query('COMMIT');
  return result;
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  if(error.code==='23505'||error.code==='23514')fail(AppError,409,'Конфликт имени или свойств карточки. Проверь данные и обнови экран.');
  if(error.code==='42P01'||error.code==='42703')fail(AppError,503,'Редактор карточек ещё не установлен в TEST PostgreSQL.');
  throw error;
 }finally{client.release();}
}
