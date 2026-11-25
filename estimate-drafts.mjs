/**
 * CRM-05A: one internal editable Estimate draft per canonical Clean Lead.
 * All prices must be explicitly owner-entered integer AMD/unit; quantity has
 * three decimal places. No VAT, discounts, automatic acceptance, orders,
 * Finance writes, price inference, or legacy Google writes.
 */
import {createHash} from 'node:crypto';
import {normalizeCalculationBatches,normalizeLineCalculation,validateCalculationBatches,resolveEstimateLineLinks} from './estimate-service-links.mjs';

const sha=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
const textField=(raw,max,label,AppError,required=false)=>{
 if(typeof raw!=='string')throw new AppError(400,label+': неверный формат.');
 const s=raw.trim();
 if(s.length>max||(required&&!s))throw new AppError(400,label+': от '+(required?1:0)+' до '+max+' символов.');
 return s;
};
function quantity(raw,AppError){
 const s=String(raw??'').trim().replace(',','.');
 if(!/^\d{1,6}(?:\.\d{1,3})?$/.test(s))throw new AppError(400,'Количество: положительное число, максимум 3 знака после запятой.');
 const [whole,fraction='']=s.split('.');
 const milli=BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0')||'0');
 if(milli<1n||milli>100000000n)throw new AppError(400,'Количество должно быть больше нуля и не более 100000.');
 return (milli/1000n).toString()+'.'+(milli%1000n).toString().padStart(3,'0');
}
function price(raw,AppError){
 if(raw===null||raw===undefined||String(raw).trim()==='')return null;
 const s=String(raw).trim();
 if(!/^\d{1,10}$/.test(s)||BigInt(s)>1000000000n)
  throw new AppError(400,'Цена за единицу: целое число AMD от 0 до 1 000 000 000 или пустое поле.');
 return BigInt(s).toString();
}
function normalizeLines(raw,{uuid,AppError}){
 if(!Array.isArray(raw)||raw.length>50)throw new AppError(400,'Смета: не более 50 позиций.');
 const keys=new Set();
 return raw.map((line,index)=>{
  if(!line||typeof line!=='object'||Array.isArray(line))throw new AppError(400,'Строка сметы: неверный формат.');
  const lineKey=uuid(line.lineKey),kind=line.kind;
  if(keys.has(lineKey))throw new AppError(409,'Строки сметы имеют повторяющийся идентификатор.');
  keys.add(lineKey);
  if(!['WORK','MATERIAL'].includes(kind))throw new AppError(400,'Тип позиции: работа или материал.');
  const description=textField(line.description,240,'Наименование',AppError,true);
  const unit=textField(line.unit,24,'Единица',AppError,true);
  const qty=quantity(line.quantity,AppError);
  const unitPrice=price(line.unitPriceAMD,AppError);
  const normalized={lineKey,position:index+1,kind,description,quantity:qty,unit,
   unitPriceAMD:unitPrice,priceSource:unitPrice===null?'UNPRICED':'OWNER_ENTERED'};
  return {...normalized,...normalizeLineCalculation(line,normalized,{uuid,AppError})};
 });
}
function withTotals(estimate,rows){
 if(!estimate)return {estimate:null,lines:[],totals:null,readonly:false};
 let work=0n,material=0n,unpriced=0;
 const lines=rows.map(line=>{
  const qty=String(line.quantity);
  const [whole,fraction='']=qty.split('.');
  const milli=BigInt(whole)*1000n+BigInt(fraction.padEnd(3,'0').slice(0,3)||'0');
  const priceValue=line.unit_price_amd===null?null:BigInt(String(line.unit_price_amd));
  let lineTotal=null;
  if(priceValue===null)unpriced++;
  else{
   const amount=milli*priceValue;
   if(line.kind==='WORK')work+=amount;else material+=amount;
   lineTotal=fmtScaled(amount);
  }
  return {lineKey:line.line_key,kind:line.kind,description:line.description,
   position:line.position,quantity:qty,unit:line.unit,unitPriceAMD:line.unit_price_amd,
   priceSource:line.price_source,lineTotalAMD:lineTotal,
   ...(line.calculation_context?{calculation:line.calculation_context,serviceId:line.service_id||null,actionCode:line.action_code||null,serviceSnapshot:line.service_snapshot||null}:{})};
 });
 return {estimate:{id:estimate.id,sourceLeadId:estimate.source_lead_id,
  status:estimate.status,currency:estimate.currency,title:estimate.title,
  notes:estimate.notes,revision:estimate.revision,createdAt:estimate.created_at,
  updatedAt:estimate.updated_at,acceptedAt:estimate.accepted_at||null,
  acceptedRevision:estimate.accepted_revision||null,acceptedTotalAMD:estimate.accepted_total_amd||null,
  workOrderId:estimate.work_order_id||null},lines,
  totals:{laborKnownAMD:fmtScaled(work),materialsKnownAMD:fmtScaled(material),
    knownTotalAMD:fmtScaled(work+material),unpricedCount:unpriced,
    lineCount:lines.length,pricingComplete:lines.length>0&&unpriced===0},
  readonly:estimate.status==='accepted',...(estimate.calculation_batches?.length?{calculationBatches:estimate.calculation_batches}:{})};
}
function fmtScaled(n){
 return (n/1000n).toString()+'.'+(n%1000n).toString().padStart(3,'0');
}
async function loadEstimateTx(client,leadId){
 const e=(await client.query('SELECT * FROM public.mvp_estimates WHERE source_lead_id=$1',[leadId])).rows[0]||null;
 if(!e)return withTotals(null,[]);
 const rows=(await client.query(
  'SELECT line_key,position,kind,description,quantity,unit,unit_price_amd,price_source,to_jsonb(l)->\'calculation_context\' AS calculation_context,to_jsonb(l)->>\'service_id\' AS service_id,to_jsonb(l)->>\'action_code\' AS action_code,to_jsonb(l)->\'service_snapshot\' AS service_snapshot FROM public.mvp_estimate_lines l WHERE estimate_id=$1 AND archived_at IS NULL ORDER BY position',[e.id])).rows;
 return withTotals(e,rows);
}
export async function estimateRead({pool,url,uuid,AppError}){
 const leadId=uuid(url.searchParams.get('leadId'));
 try{
  const lead=(await pool.query('SELECT id FROM public.mvp_leads WHERE id=$1',[leadId])).rows[0];
  if(!lead)throw new AppError(404,'Обращение не найдено.');
  return {...await loadEstimateTx(pool,leadId),sourceLeadId:leadId,source:'CRM05A_INTERNAL_MANUAL_AMD'};
 }catch(e){
  if(['42P01','42703'].includes(e.code))throw new AppError(503,'Сметы пока не подготовлены в этой TEST-базе.');
  throw e;
 }
}
export async function estimateDraftAction({pool,type,p,key,uuid,safeRevision,AppError}){
 if(!['estimate_create','estimate_save'].includes(type))throw new AppError(404,'Неизвестная операция сметы.');
 const leadId=type==='estimate_create'?uuid(p.leadId):null;
 const estimateId=type==='estimate_save'?uuid(p.estimateId):null;
 const revision=type==='estimate_save'?safeRevision(p.revision):null;
 const title=textField(p.title,180,'Название сметы',AppError,true);
 const notes=textField(p.notes??'',4000,'Примечание',AppError);
 let lines=type==='estimate_save'?normalizeLines(p.lines,{uuid,AppError}):[];
 const batches=type==='estimate_save'?normalizeCalculationBatches(p.calculationBatches,{uuid,AppError}):[];
 validateCalculationBatches(lines,batches,[],AppError);
 const normalized={type,leadId,estimateId,revision,title,notes,lines,...(batches.length?{calculationBatches:batches}:{})};
 const hash=sha(normalized);
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const claimed=await db.query(
   'INSERT INTO public.mvp_estimate_mutation_requests(request_key,action,payload_sha256) VALUES($1,$2,$3) ON CONFLICT(request_key) DO NOTHING RETURNING request_key',
   [key,type,hash]);
  if(!claimed.rowCount){
   const prev=(await db.query('SELECT action,payload_sha256,response FROM public.mvp_estimate_mutation_requests WHERE request_key=$1',[key])).rows[0];
   if(!prev||prev.action!==type||prev.payload_sha256!==hash)
    throw new AppError(409,'Этот ключ сохранения уже использован для другой сметы или версии.');
   await db.query('COMMIT');
   return {...prev.response,deduplicated:true};
  }
  let estimate;
  if(type==='estimate_create'){
   const lead=(await db.query('SELECT id,status FROM public.mvp_leads WHERE id=$1 FOR KEY SHARE',[leadId])).rows[0];
   if(!lead)throw new AppError(404,'Обращение не найдено.');
   if(lead.status==='lost')throw new AppError(409,'Нельзя готовить новую смету по отклонённому обращению.');
   const existing=(await db.query('SELECT id FROM public.mvp_estimates WHERE source_lead_id=$1',[leadId])).rows[0];
   if(existing)throw new AppError(409,'У этого лида уже есть черновик сметы. Открой и отредактируй его.');
   estimate=(await db.query(
    'INSERT INTO public.mvp_estimates(source_lead_id,request_key,title,notes) VALUES($1,$2,$3,$4) RETURNING *',
    [leadId,key,title,notes])).rows[0];
  }else{
   estimate=(await db.query('SELECT * FROM public.mvp_estimates WHERE id=$1 FOR UPDATE',[estimateId])).rows[0];
   if(!estimate)throw new AppError(404,'Смета не найдена.');
   if(estimate.status!=='draft')throw new AppError(409,'Изменять можно только черновик.');
   if(estimate.revision!==revision)throw new AppError(409,'Смета была изменена. Обнови данные перед повторным сохранением.');
   const previous=(await db.query("SELECT line_key,to_jsonb(l)->'calculation_context' AS calculation_context,to_jsonb(l)->>'service_id' AS service_id,to_jsonb(l)->'service_snapshot' AS service_snapshot FROM public.mvp_estimate_lines l WHERE estimate_id=$1 AND archived_at IS NULL",[estimateId])).rows;
   validateCalculationBatches(lines,batches,estimate.calculation_batches||[],AppError);
   lines=await resolveEstimateLineLinks(db,lines,previous,AppError);
   await db.query('UPDATE public.mvp_estimate_lines SET archived_at=now() WHERE estimate_id=$1 AND archived_at IS NULL',[estimateId]);
   estimate=(await db.query(
    'UPDATE public.mvp_estimates SET title=$2,notes=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
    [estimateId,title,notes])).rows[0];
   if(batches.length||estimate.calculation_batches?.length){
    estimate=(await db.query('UPDATE public.mvp_estimates SET calculation_batches=$2::jsonb WHERE id=$1 RETURNING *',[estimateId,JSON.stringify(batches)])).rows[0];
   }
   for(const line of lines){
    if(line.calculation){
     await db.query('INSERT INTO public.mvp_estimate_lines(estimate_id,line_key,estimate_revision,position,kind,description,quantity,unit,unit_price_amd,price_source,calculation_context,service_id,action_code,service_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7::numeric,$8,$9::numeric,$10,$11::jsonb,$12,$13,$14::jsonb)',
      [estimateId,line.lineKey,estimate.revision,line.position,line.kind,line.description,line.quantity,line.unit,line.unitPriceAMD,line.priceSource,JSON.stringify(line.calculation),line.serviceId,line.actionCode,line.serviceSnapshot?JSON.stringify(line.serviceSnapshot):null]);
     continue;
    }
    await db.query(
     'INSERT INTO public.mvp_estimate_lines(estimate_id,line_key,estimate_revision,position,kind,description,quantity,unit,unit_price_amd,price_source) VALUES($1,$2,$3,$4,$5,$6,$7::numeric,$8,$9::numeric,$10)',
     [estimateId,line.lineKey,estimate.revision,line.position,line.kind,line.description,line.quantity,line.unit,line.unitPriceAMD,line.priceSource]);
   }
  }
  await db.query(
   'INSERT INTO public.mvp_estimate_versions(estimate_id,revision,snapshot) VALUES($1,$2,$3::jsonb)',
   [estimate.id,estimate.revision,JSON.stringify({title,notes,currency:'AMD',lines,sourceLeadId:estimate.source_lead_id,...(batches.length?{calculationBatches:batches}:{})})]);
  const out=await loadEstimateTx(db,estimate.source_lead_id);
  const result={saved:true,item:out.estimate,lines:out.lines,totals:out.totals,...(out.calculationBatches?{calculationBatches:out.calculationBatches}:{}),source:'CRM05A_INTERNAL_MANUAL_AMD'};
  await db.query(
   'UPDATE public.mvp_estimate_mutation_requests SET response=$2::jsonb WHERE request_key=$1',
   [key,JSON.stringify(result)]);
  await db.query('COMMIT');
  return result;
 }catch(e){
  await db.query('ROLLBACK').catch(()=>{});
  if(e.code==='23505')throw new AppError(409,'Смета или строка уже существует. Обнови карточку перед сохранением.');
  if(['42P01','42703'].includes(e.code))throw new AppError(503,'Сметы пока не подготовлены в этой TEST-базе.');
  throw e;
 }finally{db.release();}
}
