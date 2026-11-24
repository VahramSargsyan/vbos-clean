/**
 * Finance P4 — bounded overview of NEW native PostgreSQL finance by Object / Worker.
 * Native UUID only, immutable Google archive excluded, B18 signed source authority reused.
 * This module is READ ONLY; economic definitions are imported byte-for-byte from P1.
 */
import {createHash} from 'node:crypto';
import {readNativeFinanceWorkspace} from './native-finance-workspace-read.mjs';
import {nativeFinanceScopeSumsSql} from './finance-native-summary-history.mjs';

export class NativeFinanceEntityResultsError extends Error{
 constructor(status,code){super(code);this.name='NativeFinanceEntityResultsError';this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new NativeFinanceEntityResultsError(status,code);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY=/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const SUM_FIELDS=['earnedBase','receivedBase','economicExpenseBase','profitBase',
 'cashBalanceBase','workerPayableBase','workerPaidBase','ownerTransferBase','workerAccruedBase'];
const SOURCES=Object.freeze({
 objects:Object.freeze({column:'object_id',table:'public.mvp_objects'}),
 workers:Object.freeze({column:'worker_id',table:'public.mvp_workers'})
});
function decimal(value){
 const x=String(value??'');
 if(!MONEY.test(x))fail(503,'FINANCE_P4_UNVERIFIED_MONEY');
 const neg=x.startsWith('-'),[w,frac='']=(neg?x.slice(1):x).split('.');
 const tail=frac.padEnd(6,'0');
 return (neg&&(w!=='0'||/[1-9]/.test(tail))?'-':'')+w+'.'+tail;
}
export function parseFinanceP4Query(input){
 const p=input instanceof URLSearchParams?input:new URLSearchParams(input||'');
 const get=k=>String(p.get(k)||'').trim();
 const kind=get('kind')||'objects';
 if(!Object.hasOwn(SOURCES,kind))fail(400,'FINANCE_P4_INVALID_KIND');
 const q=get('q');
 if(q.length>80||(q.length>0&&q.length<2)||/[\x00-\x1f]/.test(q))
  fail(400,'FINANCE_P4_INVALID_SEARCH');
 const limitText=get('limit');
 if(limitText&&!/^(?:[1-9]|[1-4]\d|50)$/.test(limitText))fail(400,'FINANCE_P4_INVALID_LIMIT');
 const limit=limitText?Number(limitText):20;
 const key=createHash('sha256').update(JSON.stringify({kind,q,limit})).digest('hex');
 const text=get('cursor');let cursor=null;
 if(text){
  if(text.length>500||!/^[A-Za-z0-9_-]+$/.test(text))fail(400,'FINANCE_P4_INVALID_CURSOR');
  try{
   const c=JSON.parse(Buffer.from(text,'base64url').toString('utf8'));
   if(!c||c.k!==key||!UUID.test(c.id)||typeof c.at!=='string'||
      c.at.length>60||!Number.isFinite(Date.parse(c.at)))
    fail(400,'FINANCE_P4_INVALID_CURSOR');
   cursor={id:c.id,at:c.at};
  }catch{fail(400,'FINANCE_P4_INVALID_CURSOR');}
 }
 return {kind,q,limit,key,cursor};
}
function queryFor({kind,q,limit,cursor}){
 const {column,table}=SOURCES[kind];
 const args=[];
 let search='';
 if(q){
  args.push('%'+q.replace(/[\\%_]/g,'\\$&')+'%');
  search=" AND (ent.name ILIKE $1 ESCAPE '\\' OR t."+column+"::text ILIKE $1 ESCAPE '\\')";
 }
 const base="SELECT t."+column+" AS id,ent.name AS label,"+
  "count(*)::int AS total_count,"+
  "count(*) FILTER (WHERE t.status='active')::int AS active_count,"+
  "max(t.created_at) AS last_at,"+
  nativeFinanceScopeSumsSql.join(',')+","+
  "coalesce(sum(t.amount_base) FILTER (WHERE t.status='active' AND "+
  "t.operation_type IN ('WORKER_ACCRUAL','WORKER_ACCRUAL_PAYMENT')),0)::text AS worker_accrued_base "+
  "FROM mvp_finance_native.transactions t JOIN "+table+" ent ON ent.id=t."+column+
  " WHERE t.source_system='CLEAN_NATIVE_FINANCE' AND t."+column+" IS NOT NULL"+search+
  " GROUP BY t."+column+",ent.name";
 args.push(cursor?.at||null);const at='$'+args.length;
 args.push(cursor?.id||null);const id='$'+args.length;
 args.push(limit+1);const cap='$'+args.length;
 const sql="WITH grouped AS ("+base+") SELECT grouped.* FROM grouped WHERE ("+at+
  "::timestamptz IS NULL OR (grouped.last_at,grouped.id)<("+at+"::timestamptz,"+
  id+"::uuid)) ORDER BY grouped.last_at DESC,grouped.id DESC LIMIT "+cap;
 return {sql,args};
}
export async function readNativeFinanceEntityResults(pool,params,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'FINANCE_P4_OWNER_REQUIRED');
 const parsed=parseFinanceP4Query(params);
 if(!pool||typeof pool.connect!=='function')fail(503,'FINANCE_P4_DB_UNAVAILABLE');
 const gate=await readNativeFinanceWorkspace(pool,{authorizeOwner});
 if(gate?.version!=='FINANCE_B18_NATIVE_WORKSPACE_V1'||
    gate.source!=='CLEAN_NATIVE_POST_CUTOVER_ONLY'||gate.phase!=='ACTIVE'||
    gate.authority!=='POSTGRES'||gate.postingEnabled!==true||
    gate.historicalArchiveImmutable!==true||gate.ledger?.isCurrentFinanceBalance!==true)
  fail(503,'FINANCE_P4_SOURCE_NOT_ATTESTED');
 const db=await pool.connect();let tx=false;
 try{
  await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');tx=true;
  const {sql,args}=queryFor(parsed);
  const rows=(await db.query(sql,args)).rows||[];
  if(rows.length>parsed.limit+1)fail(503,'FINANCE_P4_UNBOUNDED_SOURCE');
  const shown=rows.slice(0,parsed.limit);
  const items=shown.map(r=>{
   if(!UUID.test(r.id)||typeof r.label!=='string'||!r.label.trim()||
      !Number.isSafeInteger(r.total_count)||r.total_count<1||
      !Number.isSafeInteger(r.active_count)||r.active_count<0||
      r.active_count>r.total_count||!(r.last_at instanceof Date)||
      !Number.isFinite(r.last_at.getTime()))fail(503,'FINANCE_P4_SOURCE_DRIFT');
   const metrics={};
   for(const field of SUM_FIELDS){
    const snake=field.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
    metrics[field]=decimal(r[snake]);
   }
   return {id:r.id,label:r.label.slice(0,160),totalCount:r.total_count,
    activeCount:r.active_count,archivedCount:r.total_count-r.active_count,
    lastAt:r.last_at.toISOString(),metrics};
  });
  const hasMore=rows.length>parsed.limit,last=shown[shown.length-1];
  const nextCursor=hasMore&&last?Buffer.from(JSON.stringify({
   k:parsed.key,id:last.id,at:last.lastAt
  })).toString('base64url'):null;
  await db.query('COMMIT');tx=false;
  return Object.freeze({version:'FINANCE_P4_NATIVE_ENTITY_RESULTS_V1',
   source:'CLEAN_NATIVE_FINANCE_ONLY',readonly:true,historicalIncluded:false,
   currency:'AMD',scope:'NEW_NATIVE_TRANSACTIONS_ONLY',
   kind:parsed.kind,q:parsed.q,items,hasMore,nextCursor});
 }catch(e){
  if(['42P01','3F000','42501'].includes(e?.code))
   fail(503,'FINANCE_P4_SOURCE_UNAVAILABLE');
  throw e;
 }finally{
  if(tx)await db.query('ROLLBACK').catch(()=>{});
  db.release();
 }
}
