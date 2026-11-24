/**
 * Finance B10 — one synthetic PostgreSQL 16 transactional adapter for B9.
 *
 * B9 is an EMPTY private native schema; B8 is an isolated trial. This adapter
 * joins existing B2/B5/B6 pure business logic with B9 tables without rewriting
 * legacy FinanceService.js or CapitalService.js. It is NOT an API route and
 * deliberately refuses any DB other than localhost/vbos_mvp_ci.
 *
 * No Google/Neon/PROD write, no owner authentication claims, no finance cutover.
 * Never treat context.syntheticOwnerVerified as real owner authorization.
 */
import {createHash,randomUUID} from 'node:crypto';
import {normalizeFinanceCreate} from './finance-create-normalize.mjs';
import {financeAmendSynthetic} from './finance-amend-synthetic.mjs';
import {prepareNewFinanceInvestmentAllocation,CapitalWaterfallError} from './capital-waterfall.mjs';
import {planCapitalMovement,planCapitalReversal} from './capital-movement.mjs';

export class NativeFinanceWriterError extends Error {
 constructor(code){super(code);this.name='NativeFinanceWriterError';this.code=code;}
}
const fail=code=>{throw new NativeFinanceWriterError(code);};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES=new Set(['FINANCE_CREATE','FINANCE_EDIT','FINANCE_CANCEL','FINANCE_RESTORE',
 'CAPITAL_TRANSFER','CAPITAL_SPEND','CAPITAL_REVERSE','CAPITAL_FUND_SETTINGS']);
const FINANCE_FIELDS=new Set([
 'operationType','category','incomeRecognition','ownerDirection','workerId',
 'workOrderId','objectId','clientId','transactionDate','amountOriginal',
 'currencyOriginal','fxRate','fxRateDate','fxRateSource','commissionOriginal',
 'counterparty','notes'
]);
const FINANCE_CREATE_FIELDS=new Set([...FINANCE_FIELDS,'manualAllocations']);
const AMEND_FIELDS=new Set(['financeTransactionId','expectedRevision','patch']);
const STATUS_FIELDS=new Set(['financeTransactionId','expectedRevision']);
const CAPITAL_FIELDS={
 CAPITAL_TRANSFER:new Set(['fromFundId','toFundId','amountBase','transactionDateKey','purpose','notes']),
 CAPITAL_SPEND:new Set(['fromFundId','amountBase','transactionDateKey','purpose','notes']),
 CAPITAL_REVERSE:new Set(['fundTransactionId','transactionDateKey','reason','notes']),
 CAPITAL_FUND_SETTINGS:new Set(['fundId','expected','settings'])
};
const MICRO=1000000n;
function micro(raw,label){
 const value=String(raw??'');
 if(!/^-?(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(value))
  fail('B10_MONEY_INVALID_'+label);
 const negative=value.startsWith('-'),part=negative?value.slice(1):value;
 const [whole,frac='']=part.split('.');
 const n=BigInt(whole)*MICRO+BigInt(frac.padEnd(6,'0'));
 if(n>1000000000000n*MICRO)fail('B10_MONEY_OUT_OF_RANGE_'+label);
 return negative?-n:n;
}
function dec(number){
 const absolute=number<0n?-number:number;
 return (number<0n?'-':'')+String(absolute/MICRO)+'.'+
  String(absolute%MICRO).padStart(6,'0');
}
function validateInput(action,requestKey,payload,context){
 if(!TYPES.has(action))fail('B10_ACTION_UNSUPPORTED');
 if(typeof requestKey!=='string'||!UUID.test(requestKey))
  fail('B10_REQUEST_KEY_INVALID');
 if(!payload||typeof payload!=='object'||Array.isArray(payload))
  fail('B10_PAYLOAD_INVALID');
 if(context?.syntheticOwnerVerified!==true)
  fail('B10_TEST_OWNER_GATE_CLOSED');
 const fields=action==='FINANCE_CREATE'?FINANCE_CREATE_FIELDS:
  action==='FINANCE_EDIT'?AMEND_FIELDS:
  ['FINANCE_CANCEL','FINANCE_RESTORE'].includes(action)?STATUS_FIELDS:CAPITAL_FIELDS[action];
 if(Object.keys(payload).some(k=>!fields.has(k)))fail('B10_UNEXPECTED_PAYLOAD_FIELD');
 if(action==='FINANCE_CREATE'&&typeof payload.transactionDate!=='string')
  fail('B10_EXPLICIT_FINANCE_DATE_REQUIRED');
 if(action==='FINANCE_CREATE'&&Object.hasOwn(payload,'manualAllocations')){
  if(payload.operationType!=='OWNER_TRANSFER'||payload.ownerDirection!=='investments'||
     payload.currencyOriginal!=='AMD'||typeof payload.amountOriginal!=='string'||
     micro(payload.amountOriginal,'P5_amount')<=0n||
     (payload.commissionOriginal!==undefined&&micro(payload.commissionOriginal,'P5_commission')!==0n)||
     !Array.isArray(payload.manualAllocations)||payload.manualAllocations.length<1||
     payload.manualAllocations.length>8)
   fail('P5_MANUAL_INVESTMENT_ONLY');
 }
 if(['FINANCE_EDIT','FINANCE_CANCEL','FINANCE_RESTORE'].includes(action)){
  if(!UUID.test(payload.financeTransactionId??''))
   fail('B14_FINANCE_ID_INVALID');
  if(!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<1)
   fail('B14_EXPECTED_REVISION_INVALID');
  if(action==='FINANCE_EDIT'){
   const patch=payload.patch;
   if(!patch||typeof patch!=='object'||Array.isArray(patch)||
      Object.keys(patch).length===0||Object.keys(patch).some(k=>!FINANCE_FIELDS.has(k)))
    fail('B14_PATCH_FIELDS_INVALID');
   if(patch.transactionDate===undefined)
    fail('B14_EXPLICIT_AMENDMENT_DATE_REQUIRED');
  }
 }
}
function canonicalFundSettings(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).sort().join(',')!=='allocationSharePct,status,targetBase'||
    !['active','paused'].includes(value.status)||typeof value.targetBase!=='string'||
    typeof value.allocationSharePct!=='string')fail('P7_SETTINGS_INVALID');
 const target=micro(value.targetBase,'P7_target'),share=micro(value.allocationSharePct,'P7_share');
 if(target<0n||share<0n||share>100n*MICRO)fail('P7_SETTINGS_INVALID');
 return {status:value.status,targetBase:dec(target),allocationSharePct:dec(share)};
}
async function capitalFundSettings(c,g,payload){
 requireActive(g,day(g.cutover_date_key));
 if(typeof payload.fundId!=='string'||!UUID.test(payload.fundId))fail('P7_FUND_UUID_REQUIRED');
 const expected=canonicalFundSettings(payload.expected),after=canonicalFundSettings(payload.settings);
 const rows=(await c.query('SELECT fund_id::text AS id,code,group_type,status,target_amount_base::text AS target_base,allocation_share_pct::text AS share FROM mvp_finance_native.funds ORDER BY fund_id FOR UPDATE')).rows;
 if(rows.length!==8||new Set(rows.map(f=>f.id)).size!==8)fail('P7_FUND_SNAPSHOT_INVALID');
 const row=rows.find(f=>f.id===payload.fundId);
 if(!row||!['active','paused'].includes(row.status)||!['PROTECTIVE','GROWTH'].includes(row.group_type))fail('P7_FUND_UNAVAILABLE');
 const before=canonicalFundSettings({status:row.status,targetBase:row.target_base,allocationSharePct:row.share});
 if(JSON.stringify(before)!==JSON.stringify(expected))fail('P7_SETTINGS_REVISION_CONFLICT');
 if(JSON.stringify(before)===JSON.stringify(after))fail('P7_SETTINGS_UNCHANGED');
 if(row.group_type==='PROTECTIVE'&&after.allocationSharePct!=='0.000000')fail('P7_PROTECTIVE_SHARE_FIXED');
 if(!rows.some(f=>f.group_type==='GROWTH'&&(f.id===row.id?after.status==='active'&&micro(after.allocationSharePct,'P7_weight')>0n:f.status==='active'&&micro(f.share,'P7_weight')>0n)))
  fail('P7_ACTIVE_GROWTH_REQUIRED');
 const updated=await c.query('UPDATE mvp_finance_native.funds SET status=$1,target_amount_base=$2,allocation_share_pct=$3 WHERE fund_id=$4',[after.status,after.targetBase,after.allocationSharePct,row.id]);
 if(updated.rowCount!==1)fail('P7_FUND_UPDATE_RACE');
 return {sourceKind:'CapitalFund',sourceId:row.id,capitalFundSettings:{version:1,before,after},financeLedgerEffect:'NONE',writer:'B10_ISOLATED_PG',synthetic:true,replayed:false};
}
function canonicalDigest(action,payload){
 const sort=x=>Array.isArray(x)?x.map(sort):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;
 return createHash('sha256').update(JSON.stringify(sort({action,payload}))).digest('hex');
}
function assertSandboxEnv(){
 if(process.env.FINANCE_B10_SYNTHETIC_ONLY!=='1')
  fail('B10_SYNTHETIC_GATE_REQUIRED');
 const url=process.env.TEST_DATABASE_URL;
 if(!url)fail('B10_DISPOSABLE_DATABASE_REQUIRED');
 let parsed;
 try{parsed=new URL(url);}catch{fail('B10_DATABASE_URL_INVALID');}
 if(!['postgres:','postgresql:'].includes(parsed.protocol)||
    !['localhost','127.0.0.1'].includes(parsed.hostname)||
    parsed.pathname!=='/vbos_mvp_ci')
  fail('B10_DISPOSABLE_DATABASE_REQUIRED');
}
function assertHostedEnv(pool,context){
 // HARD OFF unless an exact separate owner-authorized finance release enables it.
 // This does not itself prove closure; DB cutover control and manifest must agree.
 if(process.env.FINANCE_NATIVE_POSTING_ENABLE!=='OWNER_APPROVED_CLEAN_TEST')
  fail('B17_HOSTED_FINANCIAL_POSTING_DISABLED');
 if(process.env.RENDER_SERVICE_ID!=='srv-dbkvfh2jnfac73a31nv0')
  fail('B17_WRONG_RUNTIME_SERVICE');
 if(!/^[0-9a-f]{64}$/.test(process.env.FINANCE_NATIVE_FROZEN_MANIFEST_SHA256||'')||
    !/^[0-9a-f]{64}$/.test(process.env.FINANCE_NATIVE_CRM_BRIDGE_SHA256||''))
  fail('B17_MISSING_OWNER_SIGNED_SOURCE_RECEIPTS');
 if(context?.ownerSessionVerified!==true||context?.csrfVerified!==true)
  fail('B17_OWNER_OR_CSRF_UNVERIFIED');
 if(!process.env.DATABASE_URL||pool?.options?.connectionString!==process.env.DATABASE_URL)
  fail('B17_DATABASE_CONNECTION_MISMATCH');
}
async function withTransaction(pool,work,mode='synthetic',context=null){
 if(mode==='synthetic')assertSandboxEnv();
 else if(mode==='hosted')assertHostedEnv(pool,context);
 else fail('B17_INVALID_RUN_MODE');
 if(!pool?.connect)fail('B10_POSTGRES_POOL_REQUIRED');
 // A caller cannot claim a local CI URL while supplying a pool bound to Neon
 // or any other connection. This module is never a deployable money gateway.
 if(mode==='synthetic' && pool.options?.connectionString!==process.env.TEST_DATABASE_URL)
  fail('B10_POOL_CONNECTION_MISMATCH');
 const client=await pool.connect();
 try{
  const {rows}=await client.query('SELECT current_database() AS name');
  if(mode==='synthetic'&&rows[0]?.name!=='vbos_mvp_ci')
   fail('B10_DATABASE_NAME_MISMATCH');
  if(mode==='hosted'&&rows[0]?.name!=='vbos_mvp_clean')
   fail('B17_EXPECTED_CLEAN_TEST_DB');
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(9061110001)');
  // The singleton authority row is locked for the full transaction.
  const ctrl=await client.query(
   'SELECT * FROM mvp_finance_native.cutover_control WHERE id=1 FOR UPDATE');
  if(ctrl.rows.length!==1)fail('B10_AUTHORITY_ROW_MISSING');
  if(mode==='hosted')await assertHostedAuthority(client,ctrl.rows[0]);
  const result=await work(client,ctrl.rows[0]);
  await client.query('COMMIT');
  return result;
 }catch(e){
  await client.query('ROLLBACK').catch(()=>{});
  throw e;
 }finally{client.release();}
}
function day(value){
 return value instanceof Date?value.toISOString().slice(0,10):String(value);
}
function requireActive(g,dateKey){
 if(g.phase!=='ACTIVE'||g.financial_write_authority!=='POSTGRES'||
    g.owner_identity_approved!==true||g.google_frozen_confirmed!==true)
  fail('B10_FINANCIAL_AUTHORITY_BLOCKED');
 if(!g.cutover_date_key||dateKey<day(g.cutover_date_key))
  fail('B10_BEFORE_CUTOVER_DATE');
}
/**
 * A source/identity attestation must be present *in the DB*, not only in env.
 * Existing November 6 GOOGLE archive is not an approved source closure.
 */
async function assertHostedAuthority(c,g){
 if(g.phase!=='ACTIVE'||g.financial_write_authority!=='POSTGRES'||
    g.owner_identity_approved!==true||g.google_frozen_confirmed!==true||
    day(g.cutover_date_key)!=='2026-10-01'||g.expected_fund_count!==8)
  fail('B17_SOURCE_AUTHORITY_NOT_APPROVED');
 const sourceSha=process.env.FINANCE_NATIVE_FROZEN_MANIFEST_SHA256;
 const crmSha=process.env.FINANCE_NATIVE_CRM_BRIDGE_SHA256;
 // B9's immutable opening is dated 2026-09-30 and is already bound to
 // November 6's owner-accepted historical source. Do NOT retarget or rewrite.
 const openingManifestId='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
 const openingManifestSha='8bdfd30faa9e45785f928c2861d7e3645a9dd168bb6d678004c0df730a04871d';
 if(g.manifest_sha256!==openingManifestSha||
    g.snapshot_id!==openingManifestId||g.crm_bridge_sha256!==crmSha||
    sourceSha===openingManifestSha)
  fail('B17_SIGNED_CUTOVER_RECEIPT_MISMATCH');
 const snapshot=await c.query(
  'SELECT as_of_date::text,opening_cash_base::text,opening_profit_base::text,'+
  'opening_worker_payable_base::text FROM mvp_finance_native.opening_snapshot WHERE id=1');
 const open=snapshot.rows[0];
 if(!open||open.as_of_date!=='2026-09-30'||
    open.opening_cash_base!=='203000.000000'||
    open.opening_profit_base!=='588000.000000'||
    open.opening_worker_payable_base!=='0.000000')
  fail('B17_OPENING_STOCK_DRIFT');
 // Fresh *separate* signed post-fence evidence. This must not change the
 // original opening snapshot ID/SHA, nor reclassify historic gains as income.
 // The historical freeze manifest deliberately CHECKs GOOGLE and owner=false.
 // Never loosen that archive: B21 uses a separate signed native receipt.
 const manifest=await c.query(
  'SELECT snapshot_id,original_snapshot_id,original_manifest_sha256,'+
  'google_manifest_sha256,crm_bridge_sha256,owner_identity_approved,'+
  'google_spreadsheet_id,source_copy_id,google_prod_version,'+
  'source_record_count,expected_counts,legacy_link_policy,'+
  'owner_attestation_ref,signed_at,google_modified_at,captured_at '+
  'FROM mvp_finance_native.post_fence_attestations '+
  'WHERE google_manifest_sha256=$1 AND original_snapshot_id=$2 '+
  'AND crm_bridge_sha256=$3',
  [sourceSha,openingManifestId,crmSha]);
 const signed=manifest.rows[0];
 if(manifest.rows.length!==1||signed.owner_identity_approved!==true||
    signed.original_manifest_sha256!==openingManifestSha||
    signed.google_prod_version<93||signed.source_record_count!==80||
    signed.legacy_link_policy!=='ARCHIVE_ONLY_NO_UUID_BRIDGE'||
    signed.google_spreadsheet_id!=='13LRWLgHJQb24WXOsPLCIP2W8ZIaSX9AI3sfXJgF2-y8'||
    signed.source_copy_id!=='1jN8nuyFOCozJ3rEeOhIMOVLrbRhkfY8VGkPSiFsvhH0'||
    typeof signed.owner_attestation_ref!=='string'||signed.owner_attestation_ref.length<24||
    !(new Date(signed.captured_at).getTime()>
      Date.parse('2026-11-08T10:59:32.797Z'))||
    new Date(signed.google_modified_at).getTime()>
      new Date(signed.captured_at).getTime()||
    new Date(signed.signed_at).getTime()<new Date(signed.captured_at).getTime()||
    ['FINANCE_TRANSACTION:24','FINANCE_BALANCE:30','BUSINESS_MONTHLY_GAIN:3',
     'CAPITAL_FUND:8','CAPITAL_ALLOCATION_BATCH:1',
     'CAPITAL_FUND_TRANSACTION:6','CAPITAL_FUND_BALANCE:8'].some(k=>{
      const [kind,count]=k.split(':');
      return signed.expected_counts?.[kind]!==Number(count);
     }))
  fail('B17_POST_FENCE_SNAPSHOT_NOT_OWNER_ACCEPTED');
 const funds=await c.query(
  'SELECT count(*)::int AS n,sum(opening_balance_base)::text AS total '+
  'FROM mvp_finance_native.fund_openings');
 if(funds.rows[0]?.n!==8||funds.rows[0]?.total!=='10000.000000')
  fail('B17_FUND_OPENING_DRIFT');
}
/**
 * Read-only availability proof for B18. Server authenticates the owner before
 * calling this. No env, database or signed-control flag alone authorizes POST;
 * postHostedFinanceCapital repeats every check under a locking transaction.
 */
export async function hostedFinancePostingReadiness(pool,c,g){
 try{
  assertHostedEnv(pool,{ownerSessionVerified:true,csrfVerified:true});
  if(g?.phase!=='ACTIVE'||g.financial_write_authority!=='POSTGRES')
   fail('B17_SOURCE_AUTHORITY_NOT_APPROVED');
  await assertHostedAuthority(c,g);
  return Object.freeze({ready:true,reason:'SIGNED_SINGLE_WRITER_READY'});
 }catch(error){
  if(error instanceof NativeFinanceWriterError)
   return Object.freeze({ready:false,reason:error.code});
  throw error;
 }
}
async function readLedger(c){
 const r=await c.query('SELECT * FROM mvp_finance_native.v_cash_ledger');
 if(r.rows.length!==1)fail('B10_OPENING_SNAPSHOT_MISSING');
 const x=r.rows[0];
 return Object.freeze({
  openingCashBase:dec(micro(x.opening_cash_base,'opening_cash')),
  cashBase:dec(micro(x.current_cash_balance_base,'cash')),
  openingProfitBase:dec(micro(x.opening_profit_base,'opening_profit')),
  profitDeltaBase:dec(micro(x.native_profit_delta_base,'profit_delta')),
  payableBase:dec(micro(x.opening_worker_payable_base,'opening_payable')+
   micro(x.native_worker_payable_delta_base,'payable_delta'))
 });
}
async function refs(c,p){
 const out={clients:{},objects:{},workOrders:{},workers:{}};
 if(p.clientId){
  const q=await c.query('SELECT id,status FROM public.mvp_clients WHERE id=$1',[p.clientId]);
  for(const row of q.rows)out.clients[row.id]={clientId:row.id,status:row.status};
 }
 if(p.objectId){
  const q=await c.query('SELECT id,client_id FROM public.mvp_objects WHERE id=$1',[p.objectId]);
  for(const row of q.rows)out.objects[row.id]={objectId:row.id,clientId:row.client_id};
 }
 if(p.workOrderId){
  const q=await c.query(
   'SELECT o.id,o.object_id,obj.client_id FROM public.mvp_orders o '+
   'JOIN public.mvp_objects obj ON obj.id=o.object_id WHERE o.id=$1',[p.workOrderId]);
  for(const row of q.rows){
   out.workOrders[row.id]={workOrderId:row.id,objectId:row.object_id,clientId:row.client_id};
   if(!out.objects[row.object_id]){
    out.objects[row.object_id]={objectId:row.object_id,clientId:row.client_id};
   }
   if(!out.clients[row.client_id]){
    const cr=await c.query('SELECT id,status FROM public.mvp_clients WHERE id=$1',[row.client_id]);
    for(const x of cr.rows)out.clients[x.id]={clientId:x.id,status:x.status};
   }
  }
 }
 if(p.workerId){
  const q=await c.query('SELECT id,status FROM public.mvp_workers WHERE id=$1',[p.workerId]);
  for(const row of q.rows)out.workers[row.id]={workerId:row.id,status:row.status};
 }
 // A client ID derived through an object must itself be available for the
 // normalizer's canonical reference lookup.
 for(const x of Object.values(out.objects)){
  if(!out.clients[x.clientId]){
   const cr=await c.query('SELECT id,status FROM public.mvp_clients WHERE id=$1',[x.clientId]);
   for(const row of cr.rows)out.clients[row.id]={clientId:row.id,status:row.status};
  }
 }
 return out;
}
async function fundsLocked(c){
 const fs=await c.query(
  'SELECT fund_id,code,group_type,status,target_amount_base::text,'+
  'allocation_share_pct::text FROM mvp_finance_native.funds ORDER BY fund_id FOR UPDATE');
 const balances=await c.query(
  'SELECT fund_id,current_balance_base::text AS balance FROM mvp_finance_native.v_fund_balances');
 const map=new Map(balances.rows.map(x=>[x.fund_id,x.balance]));
 if(fs.rows.length===0||fs.rows.some(x=>!map.has(x.fund_id)))
  fail('B10_FUND_OPENINGS_INCOMPLETE');
 const funds=fs.rows.map(x=>({
  fundId:x.fund_id,code:x.code,groupType:x.group_type,status:x.status,
  targetAmountBase:x.target_amount_base,allocationSharePct:x.allocation_share_pct
 }));
 const accounting=new Map(fs.rows.map(f=>[f.fund_id,{
  fundId:f.fund_id,balanceBase:map.get(f.fund_id),
  allocatedBase:'0',transferredInBase:'0',transferredOutBase:'0',
  spentBase:'0',transactionCount:0
 }]));
 // Derive B6 counters from exact native movements. Never trust caller balances.
 const entries=await c.query('SELECT movement_id,movement_type,from_fund_id,to_fund_id,'+
  'amount_base::text,allocation_batch_id,reversal_of,status '+
  'FROM mvp_finance_native.fund_movements ORDER BY created_at,movement_id');
 const originals=new Map(entries.rows.map(x=>[x.movement_id,x]));
 const effects=await c.query(
  'SELECT movement_id,fund_id,balance_delta_base::text '+
  'FROM mvp_finance_native.fund_effects');
 const byMovement=new Map();
 for(const ef of effects.rows){
  if(!byMovement.has(ef.movement_id))byMovement.set(ef.movement_id,new Map());
  byMovement.get(ef.movement_id).set(ef.fund_id,micro(ef.balance_delta_base,'effect'));
 }
 const bump=(id,field,amount)=>{
  const a=accounting.get(id);
  if(!a)fail('B10_DANGLING_CAPITAL_FUND');
  a[field]=dec(micro(a[field],field)+amount);
 };
 for(const x of entries.rows){
  const amount=micro(x.amount_base,'movement');
  if(amount<=0n)fail('B10_MOVEMENT_AMOUNT_INVALID');
  const expected=new Map(),countFundIds=[];
  const add=(id,delta)=>{expected.set(id,delta);countFundIds.push(id);};
  if(x.movement_type==='ALLOCATION'){
   add(x.to_fund_id,amount);bump(x.to_fund_id,'allocatedBase',amount);
  }else if(x.movement_type==='TRANSFER'){
   add(x.from_fund_id,-amount);add(x.to_fund_id,amount);
   bump(x.from_fund_id,'transferredOutBase',amount);
   bump(x.to_fund_id,'transferredInBase',amount);
  }else if(x.movement_type==='SPEND'){
   add(x.from_fund_id,-amount);bump(x.from_fund_id,'spentBase',amount);
  }else if(x.movement_type==='REVERSAL'){
   const prev=originals.get(x.reversal_of);
   if(!prev||prev.movement_type==='ALLOCATION'||prev.movement_type==='REVERSAL'||
      prev.status!=='reversed'||micro(prev.amount_base,'reverse')!==amount)
    fail('B10_REVERSE_SOURCE_CORRUPT');
   if(prev.movement_type==='TRANSFER'){
    add(prev.from_fund_id,amount);add(prev.to_fund_id,-amount);
    bump(prev.from_fund_id,'transferredOutBase',-amount);
    bump(prev.to_fund_id,'transferredInBase',-amount);
   }else{
    add(prev.from_fund_id,amount);bump(prev.from_fund_id,'spentBase',-amount);
   }
  }else fail('B10_MOVEMENT_TYPE_CORRUPT');
  const actual=byMovement.get(x.movement_id);
  if(!actual||actual.size!==expected.size||
      [...expected].some(([id,n])=>actual.get(id)!==n))
   fail('B10_MOVEMENT_EFFECTS_INCONSISTENT');
  for(const id of countFundIds)accounting.get(id).transactionCount++;
 }
 if(byMovement.size!==entries.rows.length)fail('B10_EFFECTS_ORPHANED');
 for(const a of accounting.values()){
  for(const field of ['allocatedBase','transferredInBase','transferredOutBase','spentBase'])
   if(micro(a[field],field)<0n)fail('B10_COUNTER_NEGATIVE');
 }
 return {funds,balances:[...accounting.values()],movementMap:originals};
}
async function insertMovement(c,{id,requestKey,type,dateKey,fromId=null,
 toId=null,batchId=null,reverseOf=null,amount,effects}){
 await c.query(
  'INSERT INTO mvp_finance_native.fund_movements('+
  'movement_id,request_key,movement_type,transaction_date_key,'+
  'from_fund_id,to_fund_id,allocation_batch_id,reversal_of,amount_base) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  [id,requestKey,type,dateKey,fromId,toId,batchId,reverseOf,amount]);
 for(const {fundId,deltaBase} of effects){
  await c.query(
   'INSERT INTO mvp_finance_native.fund_effects('+
   'movement_id,fund_id,balance_delta_base) VALUES($1,$2,$3)',
   [id,fundId,deltaBase]);
 }
}
async function loadReply(c,requestKey,digest){
 const r=await c.query(
  'SELECT payload_sha256,response FROM mvp_finance_native.request_receipts '+
  'WHERE request_key=$1',[requestKey]);
 if(!r.rows.length)return null;
 if(r.rows[0].payload_sha256!==digest)
  fail('B10_IDEMPOTENCY_PAYLOAD_CONFLICT');
 return {...r.rows[0].response,replayed:true};
}
async function storeReply(c,requestKey,digest,action,response){
 await c.query(
  'INSERT INTO mvp_finance_native.audit_events('+
  'request_key,event_type,source_kind,source_id,details) '+
  'VALUES($1,$2,$3,$4,$5::jsonb)',
  [requestKey,action,response.sourceKind,response.sourceId,JSON.stringify({
   synthetic:response.synthetic===true,action,openingUnchanged:true,sourceSystem:'CLEAN_NATIVE_FINANCE',
   financialAuthority:'POSTGRES',
   ...(response.capitalMetadata?{capitalMetadata:response.capitalMetadata}:{}),
   ...(response.capitalFundSettings?{capitalFundSettings:response.capitalFundSettings}:{}),
   ...(response.revisionBefore===undefined?{}:{
    revisionBefore:response.revisionBefore,revisionAfter:response.revisionAfter,
    statusBefore:response.statusBefore,statusAfter:response.statusAfter,
    effects:response.effects
   })
  })]);
 await c.query(
  'INSERT INTO mvp_finance_native.request_receipts('+
  'request_key,payload_sha256,action,response) VALUES($1,$2,$3,$4::jsonb)',
  [requestKey,digest,action,JSON.stringify(response)]);
 return Object.freeze(response);
}
async function financeCreate(c,g,requestKey,payload){
 requireActive(g,payload.transactionDate);
 const {manualAllocations,...financePayload}=payload;
 const normalized=normalizeFinanceCreate(financePayload,{
  todayKey:payload.transactionDate,references:await refs(c,financePayload)});
 if(Object.hasOwn(payload,'manualAllocations')&&
    micro(normalized.amountBase,'P5_normalized')!==micro(payload.amountOriginal,'P5_amount'))
  fail('P5_MANUAL_AMOUNT_PRECISION');
 if(normalized.status!=='active')fail('B10_FINANCE_STATUS_INVALID');
 const before=await readLedger(c),delta=micro(normalized.cashEffectBase,'cash_effect');
 const payDelta=micro(normalized.workerPayableEffectBase,'payable_effect');
 if(micro(before.cashBase,'cash_balance')+delta<0n)
  fail('B10_INSUFFICIENT_FINANCE_CASH');
 if(micro(before.payableBase,'worker_payable')+payDelta<0n)
  fail('B10_NEGATIVE_WORKER_PAYABLE');
 const id=randomUUID();
 await c.query(
  'INSERT INTO mvp_finance_native.transactions('+
  'finance_transaction_id,request_key,transaction_date_key,operation_type,'+
  'client_id,object_id,work_order_id,worker_id,amount_base,commission_base,'+
  'cash_effect_base,profit_effect_base,worker_payable_effect_base,normalized) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)',
  [id,requestKey,normalized.transactionDateKey,normalized.operationType,
   normalized.clientId||null,normalized.objectId||null,
   normalized.workOrderId||null,normalized.workerId||null,
   dec(micro(normalized.amountBase,'amount')),
   dec(micro(normalized.commissionBase,'commission')),
   dec(delta),dec(micro(normalized.profitEffectBase,'profit_effect')),
   dec(payDelta),JSON.stringify(normalized)]);
 let finCap=null;
 if(normalized.operationType==='OWNER_TRANSFER'&&normalized.ownerDirection==='investments'){
  const state=await fundsLocked(c);
  let plan;
  try{
   plan=prepareNewFinanceInvestmentAllocation({
    ...normalized,financeTransactionId:id,sourceSystem:'CLEAN_NATIVE_FINANCE'
   },state.funds,state.balances,{
    newFinancePostVerified:true,sourceSnapshotVerified:true,
    finCapLookupVerified:true,existingFinCapBatchCount:0,
    ...(Object.hasOwn(payload,'manualAllocations')?{manualAllocations}:{})
   });
  }catch(error){
   if(Object.hasOwn(payload,'manualAllocations')&&error instanceof CapitalWaterfallError)
    fail(error.code);
   throw error;
  }
  const batchId=randomUUID();
  await c.query(
   'INSERT INTO mvp_finance_native.fincap_batches('+
   'batch_id,finance_transaction_id,client_request_id,total_amount_base,'+
   'transaction_date_key) VALUES($1,$2,$3,$4,$5)',
   [batchId,id,plan.clientRequestId,plan.totalAmountBase,
    plan.transactionDateKey]);
  const lines=[];
  for(const line of plan.allocations){
   const movementId=randomUUID();
   await insertMovement(c,{id:movementId,requestKey,type:'ALLOCATION',
    dateKey:normalized.transactionDateKey,toId:line.fundId,
    batchId,amount:line.amountBase,
    effects:[{fundId:line.fundId,deltaBase:line.amountBase}]});
   lines.push({fundId:line.fundId,amountBase:line.amountBase,movementId});
  }
  finCap={batchId,clientRequestId:plan.clientRequestId,lines,
   totalAmountBase:plan.totalAmountBase};
 }
 const after=await readLedger(c);
 return {sourceKind:'FinanceTransaction',sourceId:id,
  financeTransactionId:id,operationType:normalized.operationType,
  sourceSystem:'CLEAN_NATIVE_FINANCE',finCap,before,after,
  writer:'B10_ISOLATED_PG',synthetic:true,replayed:false};
}
async function capitalAction(c,g,action,requestKey,payload){
 requireActive(g,payload.transactionDateKey);
 const state=await fundsLocked(c);
 let plan,original=null;
 if(action==='CAPITAL_REVERSE'){
  const q=await c.query(
   'SELECT * FROM mvp_finance_native.fund_movements '+
   'WHERE movement_id=$1 FOR UPDATE',[payload.fundTransactionId]);
  if(q.rows.length!==1)fail('B10_ORIGINAL_MOVEMENT_NOT_FOUND');
  original=q.rows[0];
  if(original.movement_type==='ALLOCATION')
   fail('B10_FINCAP_ALLOCATION_REVERSAL_FORBIDDEN');
  const rev=await c.query(
   'SELECT count(*)::int AS n FROM mvp_finance_native.fund_movements '+
   'WHERE reversal_of=$1',[original.movement_id]);
  plan=planCapitalReversal({...payload,requestKey},{
   fundTransactionId:original.movement_id,
   sourceSystem:'CLEAN_NATIVE_CAPITAL',
   movementType:original.movement_type,
   status:original.status,amountBase:original.amount_base,
   transactionDateKey:day(original.transaction_date_key),
   fromFundId:original.from_fund_id,toFundId:original.to_fund_id||'',
   allocationBatchId:original.allocation_batch_id||'',
   reversedByTransactionId:rev.rows[0].n?'already-reversed':'',
   reversalOfTransactionId:original.reversal_of||''
  },state.funds,state.balances,{
   sourceSnapshotVerified:true,originalTransactionVerified:true,
   reversalLookupVerified:true,matchingReversalsCount:rev.rows[0].n
  });
 }else{
  plan=planCapitalMovement({
   ...payload,requestKey,movementType:action==='CAPITAL_TRANSFER'?'TRANSFER':'SPEND'
  },state.funds,state.balances,{sourceSnapshotVerified:true});
 }
 const id=randomUUID(),record=plan.record;
 const effects=plan.effects.map(x=>({
  fundId:x.fundId,deltaBase:x.balanceBase
 }));
 await insertMovement(c,{id,requestKey,type:record.movementType,
  dateKey:record.transactionDateKey,
  fromId:record.fromFundId||null,toId:record.toFundId||null,
  reverseOf:original?.movement_id||null,amount:record.amountBase,effects});
 if(original){
  const updated=await c.query(
   "UPDATE mvp_finance_native.fund_movements SET status='reversed' "+
   "WHERE movement_id=$1 AND status='active'",[original.movement_id]);
  if(updated.rowCount!==1)fail('B10_ORIGINAL_REVERSAL_RACE');
 }
 return {sourceKind:'CapitalFundTransaction',sourceId:id,movementId:id,
  movementType:record.movementType,reversalOf:original?.movement_id||null,
  fundEffects:effects,financeLedgerEffect:'NONE',
  capitalMetadata:{version:1,purpose:record.purpose,notes:record.notes,
   reason:original?record.purpose.slice('Сторно: '.length):null},
  writer:'B10_ISOLATED_PG',synthetic:true,replayed:false};
}
/**
 * Executes only in CI's isolated, disposable DB, after a simulated B9
 * activation. Explicitly rejects caller-created IDs and economic deltas.
 */
async function postNativeFinanceCapitalCore(pool,req,mode){
 const {action,requestKey,payload={},context={}}=req||{};
 if(mode==='synthetic'){
  validateInput(action,requestKey,payload,context);
 }else{
  if(context.ownerSessionVerified!==true||context.csrfVerified!==true)
   fail('B17_OWNER_OR_CSRF_UNVERIFIED');
  // Caller cannot supply syntheticOwnerVerified; the server supplies context
  // after its signed session + HMAC CSRF checks. Reuse identical allowlists.
  validateInput(action,requestKey,payload,{syntheticOwnerVerified:true});
 }
 const digest=canonicalDigest(action,payload);
 return withTransaction(pool,async(c,g)=>{
  const replay=await loadReply(c,requestKey,digest);
  if(replay)return replay;
  if(g.phase!=='ACTIVE'||g.financial_write_authority!=='POSTGRES')
   fail('B10_FINANCIAL_AUTHORITY_BLOCKED');
  const result=action==='CAPITAL_FUND_SETTINGS'?
   await capitalFundSettings(c,g,payload):action==='FINANCE_CREATE'?
   await financeCreate(c,g,requestKey,payload):
   ['FINANCE_EDIT','FINANCE_CANCEL','FINANCE_RESTORE'].includes(action)?
   await financeAmendSynthetic(c,g,action,requestKey,payload,{
    requireActive,readLedger,refs,micro,dec,day,fail,
    verifiedHostedMode:mode==='hosted'
   }):
   await capitalAction(c,g,action,requestKey,payload);
  const response=mode==='hosted'?
   {...result,writer:'B17_CLEAN_TEST_NATIVE',synthetic:false}:result;
  return storeReply(c,requestKey,digest,action,response);
 },mode,context);
}
/** B10/B14 permanent disposable-only test gateway. */
export async function postNativeFinanceCapital(pool,req={}){
 return postNativeFinanceCapitalCore(pool,req,'synthetic');
}
/**
 * B17 owner-only Clean TEST gateway. All hosted writes are disabled until
 * exact owner-approved cutoff, independent Google writer closure and signed
 * source/CRM receipts are simultaneously established.
 */
export async function postHostedFinanceCapital(pool,req={}){
 return postNativeFinanceCapitalCore(pool,req,'hosted');
}
