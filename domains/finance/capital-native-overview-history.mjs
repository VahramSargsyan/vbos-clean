/**
 * Capital P2 — owner-only, immutable-source native PostgreSQL overview/history.
 * No capital writer, synthetic allocations, Google joins or legacy fund ID coercion.
 */
import {createHash} from 'node:crypto';
import {readNativeFinanceWorkspace} from './native-finance-workspace-read.mjs';

export class NativeCapitalOverviewError extends Error {
 constructor(status,code){super(code);this.name='NativeCapitalOverviewError';this.status=status;this.code=code;}
}
const fail=(status,code)=>{throw new NativeCapitalOverviewError(status,code);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const MONEY=/^-?(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/;
const TYPES=new Set(['ALLOCATION','TRANSFER','SPEND','REVERSAL']);
const STATUSES=new Set(['active','reversed']);
const FIELDS=['allocated','transferIn','transferOut','spent','reversalNet'];
const FIX=1000000n;
function parseMoney(value){
 const s=String(value??'');
 if(!MONEY.test(s))fail(503,'CAPITAL_P2_INVALID_CANONICAL_MONEY');
 const sign=s.startsWith('-')?-1n:1n;
 const a=s.startsWith('-')?s.slice(1):s;
 const [whole,part='']=a.split('.');
 return sign*(BigInt(whole)*FIX+BigInt(part.padEnd(6,'0')));
}
const fixed=n=>(n<0n?'-':'')+String((n<0n?-n:n)/FIX)+'.'+
 String((n<0n?-n:n)%FIX).padStart(6,'0');
function validDay(d){
 if(!d)return true;
 if(!DAY.test(d))return false;
 const t=Date.parse(d+'T00:00:00Z');
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===d;
}
export function parseCapitalP2Filters(params){
 const p=params instanceof URLSearchParams?params:new URLSearchParams(params||'');
 const get=k=>String(p.get(k)||'').trim();
 const f={fundId:get('fundId'),movementType:get('movementType'),status:get('status'),
  dateFrom:get('dateFrom'),dateTo:get('dateTo')};
 if(f.fundId&&!UUID.test(f.fundId))fail(400,'CAPITAL_P2_NATIVE_FUND_UUID_REQUIRED');
 if(f.movementType&&!TYPES.has(f.movementType))fail(400,'CAPITAL_P2_INVALID_MOVEMENT_TYPE');
 if(f.status&&!STATUSES.has(f.status))fail(400,'CAPITAL_P2_INVALID_STATUS');
 if(!validDay(f.dateFrom)||!validDay(f.dateTo)||
   (f.dateFrom&&f.dateTo&&f.dateFrom>f.dateTo))
  fail(400,'CAPITAL_P2_INVALID_DATE_RANGE');
 const rawLimit=get('limit');
 if(rawLimit&&!/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit))
  fail(400,'CAPITAL_P2_INVALID_PAGE_LIMIT');
 const limit=rawLimit?Number(rawLimit):20;
 const key=createHash('sha256').update(JSON.stringify(f)).digest('hex');
 const raw=get('cursor');let cursor=null;
 if(raw){
  if(raw.length>500||!/^[A-Za-z0-9_-]+$/.test(raw))
   fail(400,'CAPITAL_P2_INVALID_CURSOR');
  try{
   const c=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
   if(!c||c.k!==key||!UUID.test(c.id)||typeof c.at!=='string'||
     c.at.length>60||!Number.isFinite(Date.parse(c.at)))
    fail(400,'CAPITAL_P2_INVALID_CURSOR');
   cursor={id:c.id,at:c.at};
  }catch{fail(400,'CAPITAL_P2_INVALID_CURSOR');}
 }
 return {filters:f,limit,key,cursor};
}
function historyWhere(f){
 const args=[],clause=[];
 const add=(value,expr)=>{args.push(value);clause.push(expr.replace('?', '$'+args.length));};
 if(f.fundId)add(f.fundId,'EXISTS(SELECT 1 FROM mvp_finance_native.fund_effects fx WHERE fx.movement_id=m.movement_id AND fx.fund_id=?::uuid)');
 if(f.movementType)add(f.movementType,'m.movement_type=?');
 if(f.status)add(f.status,'m.status=?');
 if(f.dateFrom)add(f.dateFrom,'m.transaction_date_key>=?::date');
 if(f.dateTo)add(f.dateTo,'m.transaction_date_key<=?::date');
 return {args,sql:clause.length?clause.join(' AND '):'TRUE'};
}
// P6: immutable receipt metadata, not reconstructed history.
export function capitalMovementMetadata(type,raw){
 if(raw===null||raw===undefined)return null;
 const validText=(s,max)=>typeof s==='string'&&s.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s);
 if(!raw||raw.version!==1||!validText(raw.purpose,type==='REVERSAL'?1008:1000)||!raw.purpose.trim()||
    !validText(raw.notes,5000)||!['TRANSFER','SPEND','REVERSAL'].includes(type)||
    (type==='REVERSAL'?(!validText(raw.reason,1000)||!raw.reason.trim()||raw.purpose!=='Сторно: '+raw.reason):raw.reason!==null))
  fail(503,'CAPITAL_P6_METADATA_CONTRACT_DRIFT');
 return {version:1,purpose:raw.purpose,notes:raw.notes,reason:raw.reason};
}
function fundRow(r,motion){
 if(!UUID.test(r.id)||!['PROTECTIVE','GROWTH'].includes(r.group_type)||
    !['active','paused','archived'].includes(r.status)||
    !/^FND-2026-000[1-8]$/.test(r.legacy_source_id)||
    !/^[A-Z_]{3,100}$/.test(r.code))fail(503,'CAPITAL_P2_FUND_CONTRACT_DRIFT');
 const opening=parseMoney(r.opening_base),current=parseMoney(r.current_base);
 const delta=parseMoney(r.delta_base),target=parseMoney(r.target_base);
 if(opening<0n||current<0n||target<0n||opening+delta!==current)
  fail(503,'CAPITAL_P2_BALANCE_CONTRACT_DRIFT');
 const byType={};
 for(const name of FIELDS)byType[name]=parseMoney(motion?.[name]??'0');
 if(byType.allocated+byType.transferIn-byType.transferOut-byType.spent+
   byType.reversalNet!==delta||byType.allocated<0n||
   byType.transferIn<0n||byType.transferOut<0n||byType.spent<0n)
  fail(503,'CAPITAL_P2_MOVEMENT_EFFECT_DRIFT');
 const share=String(r.share_pct);
 if(!/^(?:\d{1,3})(?:\.\d{1,6})?$/.test(share)||Number(share)>100)
  fail(503,'CAPITAL_P2_INVALID_ALLOCATION_SHARE');
 return Object.freeze({
  id:r.id,legacyId:r.legacy_source_id,code:r.code,groupType:r.group_type,status:r.status,
  openingBase:fixed(opening),balanceBase:fixed(current),nativeDeltaBase:fixed(delta),
  targetBase:fixed(target),allocationSharePct:share,
  allocatedBase:fixed(byType.allocated),transferredInBase:fixed(byType.transferIn),
  transferredOutBase:fixed(byType.transferOut),spentBase:fixed(byType.spent),
  reversalNetBase:fixed(byType.reversalNet),
  targetReached:target>0n&&current>=target,
  targetProgressPct:target>0n?
   String(Number(((current<target?current:target)*10000n)/target)/100):null
 });
}
export async function readNativeCapitalOverview(pool,params,{authorizeOwner}={}){
 if(typeof authorizeOwner!=='function'||await authorizeOwner()!==true)
  fail(401,'CAPITAL_P2_OWNER_REQUIRED');
 const {filters,limit,key,cursor}=parseCapitalP2Filters(params);
 if(!pool?.connect)fail(503,'CAPITAL_P2_DATABASE_UNAVAILABLE');
 const gate=await readNativeFinanceWorkspace(pool,{authorizeOwner});
 if(gate.version!=='FINANCE_B18_NATIVE_WORKSPACE_V1'||
    gate.source!=='CLEAN_NATIVE_POST_CUTOVER_ONLY'||
    gate.historicalArchiveImmutable!==true||gate.phase!=='ACTIVE'||
    gate.authority!=='POSTGRES'||gate.postingEnabled!==true||
    gate.ledger?.isCurrentFinanceBalance!==true)
  fail(503,'CAPITAL_P2_FINANCE_SOURCE_NOT_ATTESTED');
 const c=await pool.connect();let started=false;
 try{
  await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');started=true;
  const rows=(await c.query(
   'SELECT f.fund_id::text AS id,f.legacy_source_id,f.code,f.group_type,f.status,'+
   'f.target_amount_base::text AS target_base,f.allocation_share_pct::text AS share_pct,'+
   'v.opening_balance_base::text AS opening_base,v.native_delta_base::text AS delta_base,'+
   'v.current_balance_base::text AS current_base FROM mvp_finance_native.funds f '+
   'JOIN mvp_finance_native.v_fund_balances v ON v.fund_id=f.fund_id '+
   'ORDER BY f.legacy_source_id')).rows||[];
  if(rows.length!==8||new Set(rows.map(r=>r.id)).size!==8)
   fail(503,'CAPITAL_P2_EIGHT_CANONICAL_FUNDS_REQUIRED');
  const effects=(await c.query(
   'SELECT e.fund_id::text AS id,'+
   "COALESCE(sum(e.balance_delta_base) FILTER (WHERE m.movement_type='ALLOCATION'),0)::text AS allocated,"+
   "COALESCE(sum(e.balance_delta_base) FILTER (WHERE m.movement_type='TRANSFER' AND e.balance_delta_base>0),0)::text AS transfer_in,"+
   "COALESCE(sum(-e.balance_delta_base) FILTER (WHERE m.movement_type='TRANSFER' AND e.balance_delta_base<0),0)::text AS transfer_out,"+
   "COALESCE(sum(-e.balance_delta_base) FILTER (WHERE m.movement_type='SPEND'),0)::text AS spent,"+
   "COALESCE(sum(e.balance_delta_base) FILTER (WHERE m.movement_type='REVERSAL'),0)::text AS reversal_net "+
   'FROM mvp_finance_native.fund_effects e '+
   'JOIN mvp_finance_native.fund_movements m ON m.movement_id=e.movement_id '+
   'GROUP BY e.fund_id')).rows||[];
  const fx=new Map(effects.map(r=>[r.id,{
   allocated:r.allocated,transferIn:r.transfer_in,transferOut:r.transfer_out,
   spent:r.spent,reversalNet:r.reversal_net
  }]));
  if(effects.some(e=>!rows.some(f=>f.id===e.id)))
   fail(503,'CAPITAL_P2_UNMAPPED_FUND_EFFECT');
  const funds=rows.map(r=>fundRow(r,fx.get(r.id)));
  if(filters.fundId&&!funds.some(f=>f.id===filters.fundId))
   fail(400,'CAPITAL_P2_UNKNOWN_NATIVE_FUND');
  const totals={total:0n,protective:0n,growth:0n,opening:0n,delta:0n};
  for(const f of funds){
   const b=parseMoney(f.balanceBase);
   totals.total+=b;totals.opening+=parseMoney(f.openingBase);totals.delta+=parseMoney(f.nativeDeltaBase);
   totals[f.groupType==='PROTECTIVE'?'protective':'growth']+=b;
  }
  if(totals.total!==totals.protective+totals.growth||
     totals.total!==totals.opening+totals.delta)
   fail(503,'CAPITAL_P2_GROUP_TOTAL_DRIFT');
  const where=historyWhere(filters);
  const args=where.args.slice();
  args.push(cursor?.at||null);const at='$'+args.length;
  args.push(cursor?.id||null);const id='$'+args.length;
  args.push(limit+1);const page='$'+args.length;
  const sql='SELECT m.movement_id::text AS id,m.transaction_date_key::text AS date,'+
   'm.movement_type AS type,m.status,m.amount_base::text AS amount_base,'+
   'm.from_fund_id::text AS from_id,m.to_fund_id::text AS to_id,'+
   'm.reversal_of::text AS reversal_of,m.created_at::text AS at,'+
   'rv.movement_id::text AS reversed_by,rv.transaction_date_key::text AS reversed_date,'+
   'orig.movement_type AS original_type,orig.transaction_date_key::text AS original_date,'+
   "rr.response->'capitalMetadata' AS capital_metadata "+
   'FROM mvp_finance_native.fund_movements m '+
   'LEFT JOIN mvp_finance_native.fund_movements rv ON rv.reversal_of=m.movement_id '+
   'LEFT JOIN mvp_finance_native.fund_movements orig ON orig.movement_id=m.reversal_of '+
   'LEFT JOIN mvp_finance_native.request_receipts rr ON rr.request_key=m.request_key '+
   "AND rr.response->>'sourceId'=m.movement_id::text AND rr.action=CASE WHEN m.movement_type='REVERSAL' THEN 'CAPITAL_REVERSE' ELSE 'CAPITAL_'||m.movement_type END "+
   'WHERE '+where.sql+
   ' AND ('+at+'::timestamptz IS NULL OR '+
   '(m.created_at,m.movement_id)<('+at+'::timestamptz,'+id+'::uuid))'+
   ' ORDER BY m.created_at DESC,m.movement_id DESC LIMIT '+page;
  const pageRows=(await c.query(sql,args)).rows||[];
  const shown=pageRows.slice(0,limit),hasMore=pageRows.length>limit;
  const byId=new Map(funds.map(f=>[f.id,f]));
  const items=shown.map(m=>{
   if(!UUID.test(m.id)||!TYPES.has(m.type)||!STATUSES.has(m.status)||
     !Number.isFinite(Date.parse(String(m.at)))||
     (m.from_id&&!byId.has(m.from_id))||(m.to_id&&!byId.has(m.to_id)))
    fail(503,'CAPITAL_P2_UNVERIFIED_MOVEMENT_ROW');
   const amount=parseMoney(m.amount_base);
   if(amount<=0n)fail(503,'CAPITAL_P2_MOVEMENT_MONEY_INVALID');
   return {id:m.id,date:String(m.date),type:m.type,status:m.status,
    amountBase:fixed(amount),fromFundId:m.from_id||'',toFundId:m.to_id||'',
    fromCode:byId.get(m.from_id)?.code||'',toCode:byId.get(m.to_id)?.code||'',
    reversalOf:m.reversal_of||'',reversedBy:m.reversed_by||'',
    reversedDate:m.reversed_date||'',originalType:m.original_type||'',originalDate:m.original_date||'',
    metadata:capitalMovementMetadata(m.type,m.capital_metadata),createdAt:String(m.at)};
  });
  const ids=shown.map(m=>m.id);
  const lines=ids.length?(await c.query(
   'SELECT movement_id::text AS id,fund_id::text AS fund_id,balance_delta_base::text AS delta '+
   'FROM mvp_finance_native.fund_effects WHERE movement_id=ANY($1::uuid[]) ORDER BY fund_id',
   [ids])).rows||[]:[];
  const lineMap=new Map(items.map(i=>[i.id,[]]));
  for(const e of lines){
   if(!lineMap.has(e.id)||!byId.has(e.fund_id))
    fail(503,'CAPITAL_P2_INVALID_EFFECT_RELATION');
   lineMap.get(e.id).push({fundId:e.fund_id,fundCode:byId.get(e.fund_id).code,
    deltaBase:fixed(parseMoney(e.delta))});
  }
  for(const item of items){
   item.effects=lineMap.get(item.id);
   if(!item.effects.length||item.effects.length>2)
    fail(503,'CAPITAL_P2_MISSING_MOVEMENT_EFFECT');
  }
  const last=shown[shown.length-1];
  const nextCursor=hasMore&&last?Buffer.from(JSON.stringify({
   k:key,id:last.id,at:String(last.at)
  })).toString('base64url'):null;
  return Object.freeze({
   version:'CAPITAL_P2_NATIVE_OVERVIEW_V1',source:'CLEAN_NATIVE_POST_CUTOVER_ONLY',
   readonly:true,historicalIncluded:false,postingEnabled:true,
   funds,summary:{totalReservedBase:fixed(totals.total),
    protectiveBase:fixed(totals.protective),growthBase:fixed(totals.growth),
    openingBase:fixed(totals.opening),nativeDeltaBase:fixed(totals.delta)},
   filters,items,hasMore,nextCursor,
   historyLimit:limit
  });
 }finally{
  if(started)await c.query('ROLLBACK').catch(()=>{});
  c.release();
 }
}
