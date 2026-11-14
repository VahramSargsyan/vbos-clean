/**
 * FINANCE-MONTH-04 — BusinessGainService.js monthly upsert port.
 * New isolated Clean TEST register. No Google backfill, no Finance ledger writes.
 * Source fields remain 5 categories + two-decimal total + YYYY-MM text key.
 */
import {createHash} from 'node:crypto';

export class BusinessMonthlyGainError extends Error {
 constructor(status,code){super(code);this.name='BusinessMonthlyGainError';this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new BusinessMonthlyGainError(status,code);};
export const MONTHLY_GAIN_CATEGORIES=Object.freeze([
 ['referralCommissionBase','referral_commission_base'],
 ['purchaseCommissionBase','purchase_commission_base'],
 ['organizationMarginBase','organization_margin_base'],
 ['taxOptimizationSavingsBase','tax_optimization_savings_base'],
 ['otherBusinessIncomeBase','other_business_income_base']
]);
const moneyRegex=/^(0|[1-9]\d{0,8})(?:\.(\d{1,6}))?$/;
const monthRegex=/^\d{4}-(0[1-9]|1[0-2])$/;
const uuidRegex=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const moneyFromCents=v=>String(v/100n)+'.'+String(v%100n).padStart(2,'0');
function month(value){
 const key=typeof value==='string'?value.trim():'';
 if(!monthRegex.test(key))fail(400,'MONTH_KEY_INVALID');
 return key;
}
function cents(value,field){
 const text=value===undefined||value===null||value===''?'0':String(value).trim();
 if(!moneyRegex.test(text))fail(400,'MONTHLY_GAIN_AMOUNT_INVALID_'+field);
 const [whole,frac='']=text.split('.');
 const six=BigInt(frac.padEnd(6,'0'));
 const rounded=BigInt(whole)*100n+(six+5000n)/10000n;
 if(rounded>99999999999n)fail(400,'MONTHLY_GAIN_AMOUNT_OVERFLOW_'+field);
 return rounded;
}
export function normalizeBusinessMonthlyGain(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))fail(400,'MONTHLY_GAIN_PAYLOAD_REQUIRED');
 const monthKey=month(payload.monthKey);
 const values={},items=[];
 for(const [camel] of MONTHLY_GAIN_CATEGORIES){
  const n=cents(payload[camel],camel);values[camel]=moneyFromCents(n);items.push(n);
 }
 const notes=payload.notes===undefined||payload.notes===null?'':String(payload.notes).trim();
 if(notes.length>2000)fail(400,'MONTHLY_GAIN_NOTES_TOO_LONG');
 const totalBusinessGainsBase=moneyFromCents(items.reduce((sum,n)=>sum+n,0n));
 return Object.freeze({monthKey,...values,notes,totalBusinessGainsBase});
}
const rowFields=`month_key AS "monthKey",referral_commission_base AS "referralCommissionBase",
 purchase_commission_base AS "purchaseCommissionBase",organization_margin_base AS "organizationMarginBase",
 tax_optimization_savings_base AS "taxOptimizationSavingsBase",other_business_income_base AS "otherBusinessIncomeBase",
 total_business_gains_base AS "totalBusinessGainsBase",notes,revision,
 source_system AS "sourceSystem",created_at AS "createdAt",updated_at AS "updatedAt"`;
const selectMonth='SELECT '+rowFields+' FROM public.mvp_business_monthly_gains WHERE month_key=$1';
function whitelist(row){
 if(!row||row.sourceSystem!=='CLEAN_TEST_MONTHLY_ONLY'||!Number.isInteger(Number(row.revision))||
  Number(row.revision)<1)fail(503,'MONTHLY_GAIN_SOURCE_UNVERIFIED');
 const m=normalizeBusinessMonthlyGain(row);
 if(m.totalBusinessGainsBase!==String(row.totalBusinessGainsBase))
  fail(503,'MONTHLY_GAIN_TOTAL_INVALID');
 return Object.freeze({...m,notes:row.notes,revision:Number(row.revision),status:'active',
  createdAt:row.createdAt,updatedAt:row.updatedAt});
}
const wrap=(record,months=[],extra={})=>Object.freeze({
 source:'CLEAN_TEST_MONTHLY_GAINS_NO_LEDGER',readonly:false,
 financialAuthority:'GOOGLE',currentOperationalFinance:false,
 ledgerEffect:false,scope:'TEST_ONLY',record,months,...extra
});
export async function readBusinessMonthlyGain(db,monthKey,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)fail(401,'OWNER_SESSION_REQUIRED');
 if(!db||typeof db.query!=='function')fail(503,'MONTHLY_GAIN_DB_UNAVAILABLE');
 const key=month(monthKey);
 const [current,history]=await Promise.all([
  db.query(selectMonth,[key]),
  db.query("SELECT month_key AS \"monthKey\",total_business_gains_base AS \"totalBusinessGainsBase\",revision FROM public.mvp_business_monthly_gains ORDER BY month_key DESC LIMIT 36")
 ]);
 if((current.rows||[]).length>1)fail(503,'MONTHLY_GAIN_MONTH_DUPLICATE');
 const row=current.rows?.[0];
 const record=row?whitelist(row):Object.freeze({
  ...normalizeBusinessMonthlyGain({monthKey:key}),status:'new',revision:0
 });
 const months=(history.rows||[]).map(x=>Object.freeze({
  monthKey:month(x.monthKey),totalBusinessGainsBase:String(x.totalBusinessGainsBase),revision:Number(x.revision)
 }));
 return wrap(record,Object.freeze(months));
}
export async function saveBusinessMonthlyGain(db,payload,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)fail(401,'OWNER_SESSION_REQUIRED');
 if(!db||typeof db.connect!=='function')fail(503,'MONTHLY_GAIN_DB_UNAVAILABLE');
 const data=normalizeBusinessMonthlyGain(payload);
 const requestKey=String(payload.requestKey||'');
 if(!uuidRegex.test(requestKey))fail(400,'MONTHLY_GAIN_REQUEST_KEY_INVALID');
 if(!Number.isInteger(payload.expectedRevision)||payload.expectedRevision<0||payload.expectedRevision>2147483646)
  fail(400,'MONTHLY_GAIN_EXPECTED_REVISION_INVALID');
 const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[data.monthKey]);
  const prior=await client.query(
   'SELECT month_key,payload_sha256,recorded_revision FROM public.mvp_business_monthly_gain_requests WHERE request_key=$1 FOR UPDATE',
   [requestKey]);
  if(prior.rows?.length){
   const old=prior.rows[0];
   if(old.month_key!==data.monthKey||old.payload_sha256!==hash)
    fail(409,'MONTHLY_GAIN_REQUEST_KEY_REUSED');
   const snapshot=await client.query(selectMonth,[data.monthKey]);
   if(snapshot.rows?.length!==1)fail(503,'MONTHLY_GAIN_REPLAY_ROW_MISSING');
   const record=whitelist(snapshot.rows[0]);
   await client.query('COMMIT');
   return wrap(record,[],{replayed:true,superseded:record.revision!==Number(old.recorded_revision)});
  }
  const existing=await client.query(
   'SELECT revision FROM public.mvp_business_monthly_gains WHERE month_key=$1 FOR UPDATE',
   [data.monthKey]);
  if(existing.rows?.length>1)fail(503,'MONTHLY_GAIN_MONTH_DUPLICATE');
  const revision=Number(existing.rows?.[0]?.revision||0);
  if(revision!==payload.expectedRevision)fail(409,'MONTHLY_GAIN_STALE_REVISION');
  const parts=MONTHLY_GAIN_CATEGORIES.map(([key])=>data[key]);
  const values=[data.monthKey,...parts,data.notes,requestKey,hash];
  let result;
  if(revision===0){
   result=await client.query(
    `INSERT INTO public.mvp_business_monthly_gains
     (month_key,referral_commission_base,purchase_commission_base,organization_margin_base,
      tax_optimization_savings_base,other_business_income_base,notes,last_request_key,last_payload_sha256)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${rowFields}`,values);
  }else{
   result=await client.query(
    `UPDATE public.mvp_business_monthly_gains SET
       referral_commission_base=$2,purchase_commission_base=$3,organization_margin_base=$4,
       tax_optimization_savings_base=$5,other_business_income_base=$6,notes=$7,
       last_request_key=$8,last_payload_sha256=$9,
       revision=revision+1,updated_at=now()
     WHERE month_key=$1 AND revision=$10 RETURNING ${rowFields}`,[...values,revision]);
  }
  if(result.rows?.length!==1)fail(409,'MONTHLY_GAIN_STALE_REVISION');
  const record=whitelist(result.rows[0]);
  await client.query(
   'INSERT INTO public.mvp_business_monthly_gain_requests(request_key,month_key,payload_sha256,recorded_revision) VALUES($1,$2,$3,$4)',
   [requestKey,data.monthKey,hash,record.revision]);
  await client.query('COMMIT');
  return wrap(record,[],{replayed:false,superseded:false});
 }catch(e){
  try{await client.query('ROLLBACK');}catch{}
  throw e;
 }finally{client.release();}
}
