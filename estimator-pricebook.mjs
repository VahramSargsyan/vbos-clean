// EST-PRICES-01. Owner-only Estimate pricing authority, not Finance or Service MasterPrices.
import {createHash} from 'node:crypto';
import {listPlumbingItems} from './public/estimate-plumbing.mjs';
import {DEFAULT_TARIFF_PROFILES} from './public/estimate-pricebook.mjs';

const SYSTEM=new Set(listPlumbingItems().map(x=>x.cardKey));
const ACTIONS=new Set(['WATER','SEWER','CHASING','FIXTURE_INSTALL']);
const TARIFFS=new Set(['ECONOM','STANDARD_PLUS','VIP']);
const bad=(AppError,status,text)=>{throw new AppError(status,text);};
const money=(raw,label,AppError)=>{
 if(raw===null||raw===undefined||raw==='')return null;
 const v=String(raw).trim();
 if(!/^\d{1,10}$/.test(v)||BigInt(v)>1000000000n)
  bad(AppError,400,label+': укажи целое число AMD от 0 до 1 000 000 000.');
 return v.replace(/^0+(?=\d)/,'');
};
const whole=(raw,label,AppError)=>{
 if(!/^\d{1,6}$/.test(String(raw??''))||Number(raw)<1||Number(raw)>100000)
  bad(AppError,400,label+': целое число от 1 до 100 000.');
 return Number(raw);
};
const multiplier=(raw,AppError)=>{
 const v=String(raw??'').trim().replace(',','.');
 if(!/^\d{1,2}(?:\.\d{1,4})?$/.test(v)||Number(v)<=0||Number(v)>20)
  bad(AppError,400,'Коэффициент должен быть больше нуля и не превышать 20 (до 4 знаков).');
 return Number(v);
};
const readProfile=r=>({tariffCode:r.tariff_code,multiplier:Number(r.multiplier),
 roundingStep:r.rounding_step,revision:r.revision});
const readRule=r=>({scopeType:r.scope_type,actionType:r.action_type,cardKey:r.card_key,
 economyBaseAMD:r.economy_base_amd,standardFloorAMD:r.standard_floor_amd,
 vipFloorAMD:r.vip_floor_amd,revision:r.revision});
export async function estimatorPricebookRead({pool,AppError}){
 try{
  const [p,r]=await Promise.all([
   pool.query('SELECT tariff_code,multiplier,rounding_step,revision FROM public.mvp_estimator_tariff_profiles'),
   pool.query('SELECT scope_type,action_type,card_key,economy_base_amd,standard_floor_amd,vip_floor_amd,revision FROM public.mvp_estimator_price_rules ORDER BY scope_type,action_type,card_key LIMIT 1000')
  ]);
  return {ready:true,version:'EST_PRICES_01',
   profiles:Object.values(DEFAULT_TARIFF_PROFILES).map(x=>{
    const stored=p.rows.find(y=>y.tariff_code===x.tariffCode);
    return stored?readProfile(stored):{...x};
   }),
   rules:r.rows.map(readRule)};
 }catch(e){
  if(['42P01','42703'].includes(e.code))bad(AppError,503,'Редактор цен ещё не подготовлен в TEST.');
  throw e;
 }
}
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function version(raw,AppError){
 const n=Number(raw);
 if(!Number.isInteger(n)||n<0||n>2147483647)bad(AppError,400,'Версия прайса неверна. Обнови экран.');
 return n;
}
function normalize(type,p,AppError){
 const revision=version(p?.revision,AppError);
 if(type==='estimator_tariff_save'){
  const tariffCode=String(p?.tariffCode||'').trim().toUpperCase();
  if(!TARIFFS.has(tariffCode))bad(AppError,400,'Тариф не найден.');
  const mult=multiplier(p?.multiplier,AppError);
  if(tariffCode==='ECONOM'&&mult!==1)bad(AppError,400,'Economy — базовый тариф, коэффициент 1.');
  return {tariffCode,multiplier:mult,roundingStep:whole(p?.roundingStep,'Округление',AppError),revision};
 }
 const scopeType=String(p?.scopeType||''),actionType=String(p?.actionType||'');
 if(!ACTIONS.has(actionType)||!['GLOBAL_ACTION','CARD_ACTION'].includes(scopeType))
  bad(AppError,400,'Вид прайса не поддерживается.');
 if((scopeType==='GLOBAL_ACTION')===(actionType==='FIXTURE_INSTALL'))
  bad(AppError,400,'Вид работ и область цены несовместимы.');
 const cardKey=scopeType==='CARD_ACTION'?String(p?.cardKey||'').trim().toUpperCase():'';
 if(scopeType==='CARD_ACTION'&&!cardKey)bad(AppError,400,'Выбери карточку для цены установки.');
 if(cardKey.length>64)bad(AppError,400,'Код карточки слишком длинный.');
 const economyBaseAMD=money(p?.economyBaseAMD,'Economy база',AppError);
 const standardFloorAMD=money(p?.standardFloorAMD,'Standard+ минимум',AppError);
 const vipFloorAMD=money(p?.vipFloorAMD,'VIP минимум',AppError);
 if(economyBaseAMD===null&&(standardFloorAMD!==null||vipFloorAMD!==null))
  bad(AppError,400,'Сначала задай Economy базу для минимальных цен.');
 return {scopeType,actionType,cardKey,economyBaseAMD,standardFloorAMD,vipFloorAMD,revision};
}
export async function estimatorPricebookAction({pool,type,p,key,AppError}){
 if(!['estimator_tariff_save','estimator_price_save'].includes(type))
  bad(AppError,404,'Операция прайса не поддерживается.');
 const payload=normalize(type,p,AppError),hash=sha({type,payload}),db=await pool.connect();
 try{
  await db.query('BEGIN');
  const claim=await db.query('INSERT INTO public.mvp_estimator_price_requests(request_key,action,payload_sha256) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING request_key',[key,type,hash]);
  if(!claim.rowCount){
   const prior=(await db.query('SELECT action,payload_sha256,response FROM public.mvp_estimator_price_requests WHERE request_key=$1',[key])).rows[0];
   if(!prior||prior.action!==type||prior.payload_sha256!==hash)
    bad(AppError,409,'Ключ сохранения уже использован для других цен.');
   await db.query('COMMIT');
   return {...prior.response,deduplicated:true};
  }
  // First-write race and revision checks are serialized within native TEST.
  await db.query('SELECT pg_advisory_xact_lock(20261114,3601)');
  let current,stored;
  if(type==='estimator_tariff_save'){
   current=(await db.query('SELECT revision FROM public.mvp_estimator_tariff_profiles WHERE tariff_code=$1 FOR UPDATE',[payload.tariffCode])).rows[0];
   if((current?.revision??0)!==payload.revision)
    bad(AppError,409,'Тариф уже изменён. Обнови страницу.');
   stored=(await db.query(
    'INSERT INTO public.mvp_estimator_tariff_profiles(tariff_code,multiplier,rounding_step,revision) VALUES($1,$2,$3,$4) ON CONFLICT(tariff_code) DO UPDATE SET multiplier=EXCLUDED.multiplier,rounding_step=EXCLUDED.rounding_step,revision=public.mvp_estimator_tariff_profiles.revision+1,updated_at=now() RETURNING tariff_code,revision',
    [payload.tariffCode,payload.multiplier,payload.roundingStep,(current?.revision??0)+1])).rows[0];
  }else{
   if(payload.scopeType==='CARD_ACTION'&&!SYSTEM.has(payload.cardKey)){
    const linked=await db.query("SELECT 1 FROM public.mvp_estimator_cards WHERE upper(card_key)=$1 AND source_type='USER' AND status='active' LIMIT 1",[payload.cardKey]);
    if(!linked.rowCount)bad(AppError,409,'Карточка отсутствует или архивирована.');
   }
   current=(await db.query('SELECT id,revision FROM public.mvp_estimator_price_rules WHERE scope_type=$1 AND action_type=$2 AND card_key=$3 FOR UPDATE',[payload.scopeType,payload.actionType,payload.cardKey])).rows[0];
   if((current?.revision??0)!==payload.revision)
    bad(AppError,409,'Цена уже изменена. Обнови страницу.');
   const params=[payload.scopeType,payload.actionType,payload.cardKey,payload.economyBaseAMD,
    payload.standardFloorAMD,payload.vipFloorAMD,(current?.revision??0)+1];
   stored=(await db.query(
    'INSERT INTO public.mvp_estimator_price_rules(scope_type,action_type,card_key,economy_base_amd,standard_floor_amd,vip_floor_amd,revision) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(scope_type,action_type,card_key) DO UPDATE SET economy_base_amd=EXCLUDED.economy_base_amd,standard_floor_amd=EXCLUDED.standard_floor_amd,vip_floor_amd=EXCLUDED.vip_floor_amd,revision=public.mvp_estimator_price_rules.revision+1,updated_at=now() RETURNING scope_type,action_type,card_key,revision',
    params)).rows[0];
  }
  const result={saved:true,version:'EST_PRICES_01',...stored};
  await db.query('UPDATE public.mvp_estimator_price_requests SET response=$2::jsonb WHERE request_key=$1',[key,JSON.stringify(result)]);
  await db.query('COMMIT');
  return result;
 }catch(e){
  await db.query('ROLLBACK').catch(()=>{});
  if(['23505','23514','22003'].includes(e.code))bad(AppError,409,'Цена или тариф не прошли ограничения сохранения.');
  if(['42P01','42703'].includes(e.code))bad(AppError,503,'Редактор цен ещё не подготовлен в TEST.');
  throw e;
 }finally{db.release();}
}
