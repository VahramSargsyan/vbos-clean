import {createHash} from 'node:crypto';
import {mastersServicesAuthority,requireMastersServicesAuthority} from './masters-authority.mjs';
import {REFERENCE_BATCH,REFERENCE_SOURCE_MANIFEST,REFERENCE_SOURCE_MODIFIED} from './service-reference.mjs';
import {SERVICE_UNITS} from './services-catalog.mjs';
const ID=/^MPR-[0-9]{4}-[0-9]{4,}$/;
const SID=/^SRV-[0-9]{4}-[0-9]{4,}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const types=['fixed','from','range','per_unit','estimate'],statuses=['active','inactive','archived'],currencies=['AMD','USD','EUR'];
const bad=(E,m)=>{throw new E(400,m);};
const money=(v,E)=>{
 if(v===null||v===undefined||v==='')return null;
 if(typeof v!=='string')bad(E,'Цена должна быть десятичным текстом.');
 const s=v.trim().replace(',','.');
 if(!/^\d{1,16}(?:\.\d{1,4})?$/.test(s))bad(E,'Цена: неотрицательное число, до 4 знаков после запятой.');
 const [a,b='']=s.split('.');return a.replace(/^0+(?=\d)/,'')+'.'+b.padEnd(4,'0');
};
export function pricePayload(p,E){
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['masterPriceId','masterId','serviceId','revision','status','priceType','priceFrom','priceTo','currency','unit','validFrom','notes'].includes(k)))bad(E,'Неверные поля расценки.');
 const masterPriceId=p.masterPriceId??'',masterId=p.masterId,serviceId=p.serviceId,revision=p.revision??null;
 if(typeof masterPriceId!=='string'||(masterPriceId&&!ID.test(masterPriceId))||typeof masterId!=='string'||!UUID.test(masterId)||typeof serviceId!=='string'||!SID.test(serviceId))bad(E,'Неверная связь мастера и услуги.');
 if(masterPriceId?(!Number.isInteger(revision)||revision<1||revision>2147483646):revision!==null)bad(E,'Неверная версия расценки.');
 const {status='active',priceType='fixed',currency='AMD',unit,validFrom='',notes=''}=p;
 if(!statuses.includes(status)||!types.includes(priceType)||!currencies.includes(currency)||!SERVICE_UNITS.includes(unit)||typeof notes!=='string'||notes.length>5000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(notes))bad(E,'Проверь тип, статус, валюту, единицу и заметки.');
 if(typeof validFrom!=='string'||(validFrom&&(!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)||!Number.isFinite(Date.parse(validFrom+'T00:00:00Z'))||new Date(validFrom+'T00:00:00Z').toISOString().slice(0,10)!==validFrom)))bad(E,'Некорректная дата начала действия.');
 const priceFrom=money(p.priceFrom,E),priceTo=money(p.priceTo,E);
 if(priceType==='range'&&(priceFrom===null||priceTo===null||BigInt(priceTo.replace('.',''))<BigInt(priceFrom.replace('.',''))))bad(E,'Проверь обе границы диапазона.');
 if(['fixed','from','per_unit'].includes(priceType)&&(priceFrom===null||priceTo!==null))bad(E,'Для этого типа нужна только цена от.');
 return {masterPriceId,masterId,serviceId,revision,status,priceType,priceFrom,priceTo,currency,unit,validFrom:validFrom||null,notes:notes.trim()};
}
export const PRICE_EFFECTIVE="coalesce(p.valid_from,(p.created_at AT TIME ZONE 'Asia/Yerevan')::date)";
export const PRICE_CURRENT="p.status='active' AND "+PRICE_EFFECTIVE+"<=(now() AT TIME ZONE 'Asia/Yerevan')::date";
async function snapshotGate(db,E){
 const r=await db.query("SELECT 1 FROM public.mvp_service_reference_batches b WHERE b.batch_id=$1 AND b.manifest_sha256=$2 AND b.source_modified_at=$3::timestamptz AND b.source_system='LEGACY_GOOGLE_VBOS' AND b.status='VERIFIED' AND b.services_count=37 AND b.prices_count=1 AND (SELECT count(*) FROM public.mvp_services_reference s WHERE s.batch_id=b.batch_id)=37 AND (SELECT count(*) FROM public.mvp_master_prices_reference p WHERE p.batch_id=b.batch_id)=1",[REFERENCE_BATCH,REFERENCE_SOURCE_MANIFEST,REFERENCE_SOURCE_MODIFIED]);
 if(r.rows.length!==1)throw new E(503,'Снимок расценок не подтверждён.');
}
const asText=v=>v instanceof Date?v.toISOString():v??null;
const item=r=>({masterPriceId:r.master_price_id,masterId:r.master_uuid??r.master_id,serviceId:r.service_id,masterName:r.master_name??'',masterStatus:r.master_status??'',serviceName:r.service_name??'',category:r.category??'',status:r.status,priceType:r.price_type,priceFrom:r.price_from==null?null:String(r.price_from),priceTo:r.price_to==null?null:String(r.price_to),currency:r.currency,unit:r.unit,validFrom:asText(r.valid_from)?.slice(0,10)??null,notes:r.notes??'',revision:r.revision??null,createdAt:asText(r.created_at),updatedAt:asText(r.updated_at),current:r.is_current===true,stale:r.is_stale===true});
export async function masterPricesRead({pool,url,AppError:E}){
 const p=url.searchParams,masterId=p.get('masterId')||'',serviceId=p.get('serviceId')||'',historyId=p.get('historyId')||'',sort=p.get('sort')||'name',page=Number(p.get('page')??'0');
 if((masterId&&!UUID.test(masterId))||(serviceId&&!SID.test(serviceId))||(historyId&&!ID.test(historyId))||(!masterId&&!serviceId)||!['name','price','updated'].includes(sort)||!Number.isInteger(page)||page<0||page>1000)bad(E,'Неверный запрос расценок.');
 const a=await mastersServicesAuthority(pool);
 if(a.phase==='CLEAN'&&!a.writeEnabled)throw new E(503,'Право чтения каталога не подтверждено.');
 const live=a.writeEnabled===true;
 if(!live)await snapshotGate(pool,E);
 if(historyId){
  if(!live)return {items:[],hasMore:false,writeEnabled:false,source:'VERIFIED_LEGACY_SNAPSHOT'};
  if(!masterId||serviceId)bad(E,'История требует карточку мастера.');
  const rows=(await pool.query("SELECT h.previous_row,h.previous_row->>'price_from' AS exact_price_from,h.previous_row->>'price_to' AS exact_price_to,h.recorded_at FROM public.mvp_master_prices_catalog_history h JOIN public.mvp_master_prices_catalog p USING(master_price_id) WHERE h.master_price_id=$1 AND p.master_id=$2::uuid ORDER BY h.revision DESC LIMIT 51 OFFSET $3",[historyId,masterId,page*50])).rows;
  return {items:rows.slice(0,50).map(r=>({...item({...r.previous_row,price_from:r.exact_price_from,price_to:r.exact_price_to}),recordedAt:asText(r.recorded_at)})),hasMore:rows.length>50,writeEnabled:live,source:'CLEAN_MASTER_PRICES'};
 }
 const args=[masterId,serviceId,page*50];
 const prices=live?'public.mvp_master_prices_catalog':'public.mvp_master_prices_reference',services=live?'public.mvp_services_catalog':'public.mvp_services_reference';
 if(!live)args.push(REFERENCE_BATCH);
 const masterJoin=live?'m.id=p.master_id':"m.source_system='LEGACY_GOOGLE' AND m.source_master_id=p.master_id";
 const serviceJoin=live?'s.service_id=p.service_id':'s.batch_id=p.batch_id AND s.service_id=p.service_id';
 const compare=!masterId;
 // Compare the latest effective active price per master; no automatic recommendation/FX conversion.
 const select="SELECT p.*,m.id AS master_uuid,m.name AS master_name,m.status AS master_status,s.service_name,s.category,"+(live?"p.revision AS selected_revision":"NULL::integer AS revision")+",("+PRICE_CURRENT+") AS is_current,("+PRICE_EFFECTIVE+"<(now() AT TIME ZONE 'Asia/Yerevan')::date-90) AS is_stale, row_number() OVER(PARTITION BY m.id,p.service_id ORDER BY "+PRICE_EFFECTIVE+" DESC,p.updated_at DESC,p.created_at DESC,p.master_price_id DESC) AS rn,"+PRICE_EFFECTIVE+" AS effective_date FROM "+prices+" p JOIN public.mvp_crm_masters m ON "+masterJoin+" JOIN "+services+" s ON "+serviceJoin+" WHERE "+(live?'true':'p.batch_id=$4')+" AND ($1='' OR m.id::text=$1) AND ($2='' OR p.service_id=$2)"+(compare?" AND "+PRICE_CURRENT+" AND m.status<>'archived' AND s.status='active'":"");
 const order=compare?(sort==='price'?"currency,unit,CASE WHEN price_type='estimate' THEN 1 ELSE 0 END,price_from NULLS LAST,master_name,master_price_id":sort==='updated'?'updated_at DESC,master_price_id':'master_name,master_price_id'):'is_current DESC,effective_date DESC,updated_at DESC,created_at DESC,master_price_id';
 const rows=(await pool.query("WITH chosen AS ("+select+") SELECT * FROM chosen "+(compare?'WHERE rn=1 ':'')+"ORDER BY "+order+" LIMIT 51 OFFSET $3",args)).rows;
 return {items:rows.slice(0,50).map(item),hasMore:rows.length>50,writeEnabled:live,source:live?'CLEAN_MASTER_PRICES':'VERIFIED_LEGACY_SNAPSHOT',comparison:compare,automaticRecommendation:false,currencyConversion:false};
}
export async function masterPriceSave({pool,p,key,AppError:E}){
 if(typeof key!=='string'||!UUID.test(key))bad(E,'Неверный ключ сохранения.');
 const v=pricePayload(p,E),hash=createHash('sha256').update(JSON.stringify(v)).digest('hex'),db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='5s'");await requireMastersServicesAuthority(db,E);
  // Parent row locks precede price-table lock. Writers never change master/service IDs.
  const master=(await db.query('SELECT id,status FROM public.mvp_crm_masters WHERE id=$1::uuid FOR SHARE',[v.masterId])).rows[0];
  const service=(await db.query('SELECT service_id,status FROM public.mvp_services_catalog WHERE service_id=$1 FOR SHARE',[v.serviceId])).rows[0];
  await db.query('LOCK TABLE public.mvp_master_prices_catalog IN SHARE ROW EXCLUSIVE MODE');
  const prior=(await db.query('SELECT payload_sha256,response FROM public.mvp_master_prices_catalog_requests WHERE request_key=$1 FOR UPDATE',[key])).rows[0];
  if(prior){if(prior.payload_sha256!==hash)throw new E(409,'Ключ уже использован.');await db.query('COMMIT');return prior.response;}
  const old=v.masterPriceId?(await db.query('SELECT * FROM public.mvp_master_prices_catalog WHERE master_price_id=$1 FOR UPDATE',[v.masterPriceId])).rows[0]:null;
  if(v.masterPriceId&&!old)throw new E(404,'Расценка не найдена.');
  if(old&&(String(old.master_id)!==v.masterId||Number(old.revision)!==v.revision))throw new E(409,'Мастер или версия расценки изменились.');
  if(!master||!service)throw new E(409,'Связь мастера и услуги отсутствует.');
  if(master.status==='archived'||(service.status==='archived'&&(!old||old.service_id!==v.serviceId)))throw new E(409,'Нельзя назначить цену архивному мастеру или новой архивной услуге.');
  let id=v.masterPriceId;
  if(!id){const seq=(await db.query("INSERT INTO public.mvp_master_prices_catalog_sequences(year,last_value) VALUES(extract(year FROM now() AT TIME ZONE 'Asia/Yerevan')::int,1) ON CONFLICT(year) DO UPDATE SET last_value=public.mvp_master_prices_catalog_sequences.last_value+1 RETURNING year,last_value")).rows[0];id='MPR-'+seq.year+'-'+String(seq.last_value).padStart(4,'0');}
  if(old)await db.query('INSERT INTO public.mvp_master_prices_catalog_history(master_price_id,revision,previous_row) SELECT master_price_id,revision,to_jsonb(p) FROM public.mvp_master_prices_catalog p WHERE master_price_id=$1 AND revision=$2',[id,v.revision]);
  const vals=[id,v.masterId,v.serviceId,v.status,v.priceType,v.priceFrom,v.priceTo,v.currency,v.unit,v.validFrom,v.notes,key];
  const effective="coalesce($10::date,(now() AT TIME ZONE 'Asia/Yerevan')::date)";
  const sql=old?'UPDATE public.mvp_master_prices_catalog SET service_id=$3,status=$4,price_type=$5,price_from=$6,price_to=$7,currency=$8,unit=$9,valid_from='+effective+',notes=$11,client_request_id=$12,revision=revision+1,updated_at=now() WHERE master_price_id=$1 AND master_id=$2::uuid AND revision=$13 RETURNING *':'INSERT INTO public.mvp_master_prices_catalog(master_price_id,master_id,service_id,status,price_type,price_from,price_to,currency,unit,valid_from,notes,client_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'+effective+',$11,$12) RETURNING *';
  const saved=(await db.query(sql,old?[...vals,v.revision]:vals)).rows[0];if(!saved)throw new E(409,'Расценка изменилась.');
  const result={entityId:id,data:item(saved)};
  await db.query('INSERT INTO public.mvp_master_prices_catalog_requests(request_key,payload_sha256,response) VALUES($1,$2,$3::jsonb)',[key,hash,JSON.stringify(result)]);
  await db.query('COMMIT');return result;
 }catch(e){await db.query('ROLLBACK').catch(()=>{});if(e?.code==='23505')throw new E(409,'ID или ключ уже существует.');throw e;}finally{db.release();}
}
