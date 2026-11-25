// ESTIMATOR_SAVED_ESTIMATE_SERVICE_LINK_PARITY. Clean-local references only.
import {createHash,randomUUID} from 'node:crypto';
import {verifiedServiceSourceTx} from './worklog-service-source.mjs';
import {mastersServicesAuthority,requireMastersServicesAuthority} from './masters-authority.mjs';
import {REFERENCE_BATCH} from './service-reference.mjs';
import {listPlumbingItems} from './public/estimate-plumbing.mjs';

export const BRIDGE_RULES=Object.freeze({
 FIXTURE_INSTALL:Object.freeze({actionCode:'INSTALL',unit:'item',quantityRule:'ITEM_QUANTITY'}),
 WATER:Object.freeze({actionCode:'CONNECT',unit:'point',quantityRule:'WATER_POINT_TOTAL'}),
 SEWER:Object.freeze({actionCode:'CONNECT',unit:'point',quantityRule:'SEWER_POINT_COUNT'})
});
const ruleFor=x=>Object.hasOwn(BRIDGE_RULES,x)?BRIDGE_RULES[x]:null;
const actions=new Set(['FIXTURE_INSTALL','WATER','SEWER','CHASING','NODE_CARD_MATERIAL','EXTRA_MATERIALS']);
const validHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const bad=(E,m,status=400)=>{throw new E(status,m);};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=(x,n,E)=>{if(typeof x!=='string'||x.length>n||/[\u0000-\u001f\u007f]/.test(x))bad(E,'Неверное поле контекста расчёта.');return x;};
const cardId=(v,E)=>{
 const key=text(v,80,E);
 if(/^USR:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))return 'USR:'+key.slice(4).toLowerCase();
 if(!/^[A-Z0-9_+:-]{1,80}$/.test(key)||key.startsWith('USR:'))bad(E,'Неверный код карточки.');
 return key;
};
const svcId=(v,E)=>{if(typeof v!=='string'||v.length>100||!/^SRV-[0-9]{4}-[0-9]{4,}$/.test(v))bad(E,'Неверный ID услуги.');return v;};
const unitCode=v=>({'шт':'item','точка':'point','item':'item','point':'point'})[String(v).trim()]||null;
// Stable JSON independent of PostgreSQL jsonb property ordering. These are
// client-captured quote inputs, not a server attestation of catalog prices.
function sortedJson(v,E,depth=0){
 if(depth>8)bad(E,'Слишком глубокий snapshot.');
 if(v===null||typeof v==='boolean')return v;
 if(typeof v==='string'){if(v.length>6000)bad(E,'Слишком длинный параметр расчёта.');return v;}
 if(typeof v==='number'&&Number.isFinite(v))return v;
 if(Array.isArray(v)){if(v.length>100)bad(E,'Слишком много параметров расчёта.');return v.map(x=>sortedJson(x,E,depth+1));}
 if(!object(v))bad(E,'Неверный snapshot.');
 const keys=Object.keys(v).sort();if(keys.length>150)bad(E,'Слишком много параметров расчёта.');
 const out={};for(const k of keys){if(k.length>180||['__proto__','constructor','prototype'].includes(k))bad(E,'Неверный ключ snapshot.');out[k]=sortedJson(v[k],E,depth+1);}return out;
}
const same=(a,b,E)=>JSON.stringify(sortedJson(a,E))===JSON.stringify(sortedJson(b,E));
export function normalizeCalculationBatches(raw,{uuid,AppError:E}){
 if(raw===undefined||raw===null)return [];
 if(!Array.isArray(raw)||raw.length>50)bad(E,'Слишком много расчётов в смете.');
 const ids=new Set();
 const batches=raw.map(b=>{
  if(!object(b)||!['BATCH','SINGLE'].includes(b.mode)||!validHash(b.sourcePackageSha256)||!object(b.inputSnapshot))bad(E,'Неверный snapshot расчёта.');
  const id=uuid(b.id);if(ids.has(id))bad(E,'Повторный ID расчёта.');ids.add(id);
  const inputSnapshot=sortedJson(b.inputSnapshot,E);
  if(!['ECONOM','STANDARD_PLUS','VIP'].includes(inputSnapshot.tariff))bad(E,'Неверный тариф snapshot.');
  if(b.mode==='BATCH'){
   const {cards,config}=inputSnapshot;
   if(!object(cards)||!object(config)||Object.keys(cards).length>12||Object.keys(config).some(k=>!Object.hasOwn(cards,k)))bad(E,'Неверные карточки snapshot.');
   for(const [k,v] of Object.entries(cards)){
    cardId(k,E);
    if(!object(v)||!/^\d{1,2}$/.test(String(v.quantity??''))||Number(v.quantity)<1||Number(v.quantity)>50||!object(config[k]))bad(E,'Неверные параметры карточки snapshot.');
    for(const flag of ['water','sewer','install'])if(Object.hasOwn(config[k],flag)&&typeof config[k][flag]!=='boolean')bad(E,'Неверный флаг действия snapshot.');
   }
   for(const flag of ['includeMaterials','useFixedPrices','chasing','extraMaterials'])if(Object.hasOwn(inputSnapshot,flag)&&typeof inputSnapshot[flag]!=='boolean')bad(E,'Неверный флаг snapshot.');
  }else cardId(inputSnapshot.cardKey,E);
  if(JSON.stringify(inputSnapshot).length>12000)bad(E,'Слишком большой snapshot расчёта.');
  return {id,mode:b.mode,sourcePackageSha256:b.sourcePackageSha256,inputSnapshot};
 });
 if(JSON.stringify(batches).length>30000)bad(E,'Слишком большой контекст сметы.');
 return batches;
}
export function normalizeLineCalculation(raw,line,{uuid,AppError:E}){
 if(raw.calculation===undefined||raw.calculation===null){
  if(raw.serviceId||raw.relink)bad(E,'Связь с услугой требует исходной позиции расчёта.');
  return {};
 }
 const c=raw.calculation;
 if(!object(c)||!actions.has(c.sourceAction)||!object(c.original))bad(E,'Неверная исходная позиция расчёта.');
 const isMaterial=['NODE_CARD_MATERIAL','EXTRA_MATERIALS'].includes(c.sourceAction);
 if((line.kind==='MATERIAL')!==isMaterial)bad(E,'Тип исходной позиции нельзя менять. Удали строку и добавь новую.');
 const original={
  description:text(c.original.description,240,E),quantity:text(c.original.quantity,30,E),
  unit:text(c.original.unit,24,E),unitPriceAMD:c.original.unitPriceAMD===null?null:text(c.original.unitPriceAMD,20,E),
  priceMode:text(c.original.priceMode??'',60,E)
 };
 if(!/^\d{1,6}(?:\.\d{1,3})?$/.test(original.quantity)||Number(original.quantity)<=0||
  (original.unitPriceAMD!==null&&original.unitPriceAMD!==''&&!/^\d{1,10}$/.test(original.unitPriceAMD)))bad(E,'Неверный исходный объём или цена.');
 const out={calculation:{batchId:uuid(c.batchId),cardKey:cardId(c.cardKey,E),sourceAction:c.sourceAction,original}};
 if(raw.serviceId!==undefined&&raw.serviceId!==null){if(raw.serviceId!=='')svcId(raw.serviceId,E);out.serviceId=raw.serviceId;}
 if(raw.relink===true)out.relink=true;
 if((out.serviceId||out.relink)&&(!ruleFor(c.sourceAction)||line.kind!=='WORK'))bad(E,'Для этого действия связь с услугой не предусмотрена.');
 return out;
}
export function validateCalculationBatches(lines,batches,previous,E){
 const ids=new Set(batches.map(x=>x.id)),used=new Set(lines.filter(x=>x.calculation).map(x=>x.calculation.batchId));
 if([...used].some(id=>!ids.has(id))||[...ids].some(id=>!used.has(id)))bad(E,'Snapshot и позиции расчёта не совпадают.');
 const byId=new Map(batches.map(b=>[b.id,b]));
 for(const line of lines){
  const c=line.calculation;if(!c)continue;
  const b=byId.get(c.batchId),input=b.inputSnapshot;
  if(c.cardKey==='SPECIAL:CHASING'&&c.sourceAction==='CHASING')continue;
  if(c.cardKey==='SPECIAL:EXTRA_MATERIALS'&&c.sourceAction==='EXTRA_MATERIALS')continue;
  const keys=b.mode==='BATCH'?Object.keys(input.cards).map(k=>cardId(k,E)):[cardId(input.cardKey,E)];
  if(!keys.includes(c.cardKey))bad(E,'Карточка позиции отсутствует в исходном snapshot.');
 }
 const old=new Map((previous||[]).map(x=>[x.id,x]));
 for(const b of batches)if(old.has(b.id)&&!same(old.get(b.id),b,E))bad(E,'Исторические параметры расчёта неизменяемы.',409);
}
async function serviceTx(db,source,id,rule,E){
 const current=source==='CLEAN';
 const r=(await db.query('SELECT service_id,service_name,category,action_code,default_unit,status FROM '+(current?'public.mvp_services_catalog':'public.mvp_services_reference')+' WHERE service_id=$1'+(current?' FOR SHARE':' AND batch_id=$2'),current?[id]:[id,REFERENCE_BATCH])).rows[0];
 if(!r||r.status!=='active'||r.action_code!==rule.actionCode||r.default_unit!==rule.unit)
  bad(E,'Услуга неактивна либо не соответствует действию и единице.',409);
 return {serviceId:r.service_id,serviceName:r.service_name,category:r.category,actionCode:r.action_code,defaultUnit:r.default_unit,source};
}
// Existing exact links remain historical facts even after catalog archive/edit.
// A new or explicitly relinked position must use the current verified source.
export async function resolveEstimateLineLinks(db,lines,previous,E){
 const old=new Map(previous.map(x=>[x.line_key,x]));let source;
 const out=[];
 for(const line of lines){
  const prior=old.get(line.lineKey),c=line.calculation;
  if(prior?.calculation_context&&(!c||!same(prior.calculation_context,c,E)))bad(E,'Нельзя изменить или потерять исходный snapshot позиции.',409);
  if(prior&&!prior.calculation_context&&c)bad(E,'Старую ручную строку нельзя задним числом объявить расчётной.',409);
  if(!c){out.push(line);continue;}
  const rule=ruleFor(c.sourceAction),{relink,...rest}=line;
  const actionCode=rule?.actionCode??null;
  let serviceId=null,serviceSnapshot=null;
  const requested=Object.hasOwn(line,'serviceId')?line.serviceId:prior?.service_id??'';
  if(rule&&prior?.service_id&&requested===prior.service_id&&!relink){
   if(unitCode(line.unit)!==rule.unit||!prior.service_snapshot)bad(E,'Единица связанной позиции изменилась.',409);
   serviceId=prior.service_id;serviceSnapshot=prior.service_snapshot;
  }else if(rule&&(requested||relink||!prior)){
   source??=await verifiedServiceSourceTx(db,E);
   let id=relink?'':requested;
   if(!id){
    const rows=(await db.query("SELECT service_id FROM public.mvp_estimator_service_bridges WHERE card_key=$1 AND action_type=$2 AND status='active' FOR SHARE",[c.cardKey,c.sourceAction])).rows;
    if(rows.length>1)bad(E,'Дублирующая связь карточки.',409);
    id=rows[0]?.service_id||'';
   }
   if(id){
    if(unitCode(line.unit)!==rule.unit)bad(E,'Единица позиции не совпадает с услугой.',409);
    serviceSnapshot=await serviceTx(db,source,id,rule,E);serviceId=id;
   }
  }
  out.push({...rest,actionCode,serviceId,serviceSnapshot});
 }
 return out;
}
const systemCards=new Set(listPlumbingItems().map(x=>x.cardKey));
async function checkCard(db,key,E){
 if(systemCards.has(key))return;
 const r=(await db.query("SELECT card_key FROM public.mvp_estimator_cards WHERE card_key=$1 AND status='active' FOR SHARE",[key])).rows[0];
 if(!r)bad(E,'Карточка не найдена или архивирована.',404);
}
const bridgeHash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export async function estimatorBridgeRead({pool,url,AppError:E}){
 const key=cardId(url.searchParams.get('cardKey')??'',E),db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");
  await checkCard(db,key,E);
  const source=await verifiedServiceSourceTx(db,E);
  const rows=(await db.query("SELECT bridge_id,card_key,action_type,service_id,quantity_rule FROM public.mvp_estimator_service_bridges WHERE card_key=$1 AND status='active' ORDER BY action_type",[key])).rows;
  const table=source==='CLEAN'?'public.mvp_services_catalog':'public.mvp_services_reference';
  const candidates=(await db.query("SELECT service_id,service_name,action_code,default_unit FROM "+table+" WHERE status='active' AND ((action_code='INSTALL' AND default_unit='item') OR (action_code='CONNECT' AND default_unit='point'))"+(source==='CLEAN'?'':' AND batch_id=$1')+" ORDER BY service_name,service_id LIMIT 201",source==='CLEAN'?[]:[REFERENCE_BATCH])).rows;
  await db.query('COMMIT');
  return {items:rows,candidates:candidates.slice(0,200),truncated:candidates.length>200,writeEnabled:source==='CLEAN'};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(['42P01','42703'].includes(e.code))bad(E,'Связи Estimator ещё не установлены.',503);throw e;}
 finally{db.release();}
}
export async function estimatorBridgeAction({pool,p,key,AppError:E}){
 const cardKey=cardId(p.cardKey,E),actionType=p.actionType,rule=ruleFor(actionType);
 if(!rule)bad(E,'Неподдерживаемое действие карточки.');
 const serviceId=p.serviceId===''?'':svcId(p.serviceId,E);
 const expectedBridgeId=text(p.expectedBridgeId??'',100,E);
 const digest=bridgeHash({cardKey,actionType,serviceId,expectedBridgeId}),db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");
  await requireMastersServicesAuthority(db,E);
  const claim=await db.query("INSERT INTO public.mvp_estimator_bridge_requests(request_key,payload_sha256) VALUES($1,$2) ON CONFLICT(request_key) DO NOTHING RETURNING request_key",[key,digest]);
  if(!claim.rowCount){
   const r=(await db.query("SELECT payload_sha256,response FROM public.mvp_estimator_bridge_requests WHERE request_key=$1",[key])).rows[0];
   if(!r||r.payload_sha256!==digest||!r.response)bad(E,'Ключ связи уже использован.',409);
   await db.query('COMMIT');return {...r.response,deduplicated:true};
  }
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['estimator-bridge:'+cardKey+'|'+actionType]);
  await checkCard(db,cardKey,E);
  const current=(await db.query("SELECT * FROM public.mvp_estimator_service_bridges WHERE card_key=$1 AND action_type=$2 AND status='active' FOR UPDATE",[cardKey,actionType])).rows[0];
  if((current?.bridge_id||'')!==expectedBridgeId)bad(E,'Связь изменилась. Обнови карточку.',409);
  if(serviceId)await serviceTx(db,'CLEAN',serviceId,rule,E);
  let bridgeId=current?.bridge_id||null;
  if((current?.service_id||'')!==serviceId){
   if(current)await db.query("UPDATE public.mvp_estimator_service_bridges SET status='archived',archived_at=now() WHERE bridge_id=$1",[current.bridge_id]);
   bridgeId=null;
   if(serviceId){
    bridgeId='CLEAN:'+randomUUID();
    await db.query("INSERT INTO public.mvp_estimator_service_bridges(bridge_id,card_key,action_type,service_id,quantity_rule,status,source_system) VALUES($1,$2,$3,$4,$5,'active','CLEAN_NATIVE')",[bridgeId,cardKey,actionType,serviceId,rule.quantityRule]);
   }
  }
  const response={saved:true,bridgeId,cardKey,actionType,serviceId:serviceId||null};
  await db.query('UPDATE public.mvp_estimator_bridge_requests SET response=$2::jsonb WHERE request_key=$1',[key,JSON.stringify(response)]);
  await db.query('COMMIT');return response;
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(['42P01','42703'].includes(e.code))bad(E,'Связи Estimator ещё не установлены.',503);throw e;}
 finally{db.release();}
}
// Offline only: caller owns transaction and exact private, independently reconciled
// Google/Supabase manifest. No HTTP route, no live synchronization, no seeded business rows.
export function bridgeSnapshotManifest(rows,E){
 if(!Array.isArray(rows)||rows.length>1000)bad(E,'Неверный manifest связей.');
 const canonical=rows.map(r=>sortedJson(r,E)).sort((a,b)=>String(a.estimatorServiceBridgeId).localeCompare(String(b.estimatorServiceBridgeId)));
 return {canonical,sha256:bridgeHash(canonical)};
}
export async function importEstimatorBridgeSnapshotTx(db,rows,expectedHash,E){
 if(!validHash(expectedHash))bad(E,'Неверный manifest связей.');
 const {canonical,sha256}=bridgeSnapshotManifest(rows,E);
 if(sha256!==expectedHash)bad(E,'Manifest связей не совпадает.',409);
 const state=await mastersServicesAuthority(db,{lock:true});
 if(state.phase!=='LEGACY')bad(E,'Импорт допустим только до активации.',409);
 const source=await verifiedServiceSourceTx(db,E);
 if(source!=='LEGACY')bad(E,'Источник импорта не подтверждён.',409);
 await db.query('LOCK TABLE public.mvp_estimator_service_bridges IN SHARE ROW EXCLUSIVE MODE');
 const existing=(await db.query('SELECT bridge_id,source_snapshot,source_manifest_sha256 FROM public.mvp_estimator_service_bridges ORDER BY bridge_id')).rows;
 if(existing.length){
  if(existing.length===canonical.length&&existing.every((r,i)=>r.source_manifest_sha256===expectedHash&&r.bridge_id===canonical[i].estimatorServiceBridgeId&&same(r.source_snapshot,canonical[i],E)))return {imported:0,deduplicated:true};
  bad(E,'Таблица связей уже содержит данные. Нужна адресная сверка.',409);
 }
 const ids=new Set(),active=new Set();
 for(const r of canonical){
  const id=text(r.estimatorServiceBridgeId,100,E),card=cardId(r.cardKey,E),rule=ruleFor(r.actionType);
  if(!/^ESB-[0-9]{4}-[0-9]{4,}$/.test(id)||ids.has(id)||!rule||r.quantityRule!==rule.quantityRule||
   r.relationKey!==r.cardKey+'|'+r.actionType||!['active','archived'].includes(r.status))bad(E,'Неверная исходная связь.');
  ids.add(id);const service=svcId(r.serviceId,E),relation=card+'|'+r.actionType;
  if(r.status==='active'){
   if(active.has(relation))bad(E,'Дублирующая активная связь.',409);active.add(relation);
   await checkCard(db,card,E);await serviceTx(db,source,service,rule,E);
  }
  await db.query("INSERT INTO public.mvp_estimator_service_bridges(bridge_id,card_key,action_type,service_id,quantity_rule,status,source_system,source_snapshot,source_manifest_sha256) VALUES($1,$2,$3,$4,$5,$6,'LEGACY_RECONCILED',$7::jsonb,$8)",[id,card,r.actionType,service,r.quantityRule,r.status,JSON.stringify(r),expectedHash]);
 }
 return {imported:canonical.length,deduplicated:false};
}
