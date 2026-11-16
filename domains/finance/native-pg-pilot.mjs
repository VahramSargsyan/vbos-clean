/**
 * FINANCE_NATIVE_SYNTHETIC_POSTING_PILOT_V1
 * Isolated PostgreSQL adapter for source-pinned ORIGINAL FinanceService.js and CapitalService.js excerpts (test-only).
 * NO HTTP endpoint, NO live Clean writer, NO Google / historical import / PROD.
 * The database MUST be the disposable CI database or an explicitly named pilot-only DB.
 */
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {prepareNewFinanceInvestmentAllocation} from './capital-waterfall.mjs';

const financeSource=readFileSync(new URL('../../tests/fixtures/legacy/FinanceService.pilot-excerpts.txt',import.meta.url),'utf8');
const capitalSource=readFileSync(new URL('../../tests/fixtures/legacy/CapitalService.pilot-excerpts.txt',import.meta.url),'utf8');
const configSource=readFileSync(new URL('../../tests/fixtures/legacy/Config.pilot-excerpts.txt',import.meta.url),'utf8');
const sqlSource=readFileSync(new URL('./native-pilot-isolated.sql',import.meta.url),'utf8');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const table='finance_pilot';
const section=(src,from,to)=>{
 const a=src.indexOf(from),b=src.indexOf(to,a+from.length);
 if(a<0||b<=a)throw Error('LEGACY_SOURCE_PARITY_MISSING_'+from);
 return src.slice(a,b);
};
const configLiteral=label=>{
 const a=configSource.indexOf('const '+label+' = Object.freeze({');
 const b=configSource.indexOf('});',a)+3;
 if(a<0||b<a)throw Error('LEGACY_CONFIG_NOT_FOUND_'+label);
 return configSource.slice(a,b);
};
const config=vm.runInNewContext(configLiteral('VBOS_CONFIG')+';'+configLiteral('VBOS_ENUMS')+';({VBOS_CONFIG,VBOS_ENUMS})',{},{timeout:1000});
const financeFunctions=section(financeSource,'function financeTodayKey_() {','function financeScopesForRecord_(record) {');
const capitalHelpers=section(capitalSource,'function capitalMoneyNumber_(value,label,allowZero) {','function capitalFundStatusAllowsIncoming_(fund) {')+section(capitalSource,'function capitalEffectAdd_(map,fundId,changes) {','function capitalBalanceLocationsByIdSetUnlocked_(fundIds) {');
const capitalWaterfall=section(capitalSource,'function capitalPolicyShareForFund_(fund) {','function normalizeCapitalAllocationBatch_(payload) {');
const fixedMoney=n=>{
 const x=Number(n);
 if(!Number.isFinite(x)||Math.abs(x)>1000000000000)throw Error('PILOT_AMOUNT_OUT_OF_RANGE');
 return x.toFixed(6);
};
function requiredMoney(value,label,allowZero=false){
 if(value===undefined||value===null){if(allowZero)return;throw Error('MISSING_'+label);}
 const x=String(value);
 if(!/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(x)||
    (!allowZero && Number(x)===0))throw Error('INVALID_MONEY_'+label);
}
function sandbox({related={},funds=[]}={}){
 const maps=related;
 const ctx={
  VBOS_CONFIG:config.VBOS_CONFIG,VBOS_ENUMS:config.VBOS_ENUMS,
  VBOS_ERROR_CODES:{FINANCE_VALIDATION:'FINANCE_VALIDATION',CAPITAL_VALIDATION:'CAPITAL_VALIDATION'},
  Utilities:{formatDate:()=> '2026-11-06'},Session:{getScriptTimeZone:()=> 'Asia/Yerevan'},
  nowIso_:()=> '2026-11-06T00:00:00Z',
  makeVbosError_:(_code,message)=>new Error(message),
  validateEnum_:(v,list,label)=>{if(!list.includes(v))throw Error('INVALID_ENUM_'+label);return v;},
  safeString_:(v,max)=>String(v??'').slice(0,max||300),
  requireString_:(v,label)=>{if(!String(v??'').trim())throw Error('REQUIRED_'+label);return String(v);},
  findProjectedRecordByPrimaryId_:(kind,field,id)=>maps[kind]?.[id]||null,
  listRecentRecords_:(kind)=>{if(kind!=='CapitalFunds')throw Error('PILOT_BROKEN_CAPITAL_SOURCE');return {items:funds};},
  getCapitalFundBalanceRecord_:(id)=>({fundId:id,balanceBase:Number(funds.find(f=>f.fundId===id)?.balanceBase||0)}),
  findRecordByValue_:()=>null
 };
 return vm.runInNewContext(financeFunctions+';'+capitalHelpers+';'+capitalWaterfall+
  ';({normalizeFinanceTransaction_,financeContribution_,capitalWaterfallAllocationsUnlocked_,capitalTransactionEffects_})',
  ctx,{timeout:1500});
}
function error(code){throw Error(code);}
function hash(v){return createHash('sha256').update(JSON.stringify(v)).digest('hex');}
async function ensureIsolated(client){
 if(process.env.FINANCE_PILOT_SYNTHETIC_ONLY!=='1')error('FINANCE_WRITER_DISABLED_BY_DEFAULT');
 const {rows}=await client.query('SELECT current_database() AS name');
 const name=rows[0]?.name||'';
 if(name!=='vbos_mvp_ci'&&!name.startsWith('vbos_finance_pilot_'))
  error('FINANCE_PILOT_REQUIRES_SEPARATE_DATABASE');
}
async function transaction(pool,fn){
 if(!pool?.connect)error('POSTGRES_POOL_REQUIRED');
 const c=await pool.connect();
 try{
  await ensureIsolated(c);
  await c.query('BEGIN');
  // Serializes the synthetic financial aggregate and request-key gate, even under races.
  await c.query('SELECT pg_advisory_xact_lock(9061106001)');
  const answer=await fn(c);
  await c.query('COMMIT');
  return answer;
 }catch(e){
  await c.query('ROLLBACK').catch(()=>{});
  throw e;
 }finally{c.release();}
}
export async function installIsolatedPilot(pool){
 if(!pool?.connect)error('POSTGRES_POOL_REQUIRED');
 const c=await pool.connect();
 try{await ensureIsolated(c);await c.query(sqlSource);}finally{c.release();}
}
export async function seedSyntheticRelations(pool,{clients=[],objects=[],orders=[],workers=[],funds=[]}={}){
 return transaction(pool,async c=>{
  for(const id of clients)await c.query('INSERT INTO finance_pilot.clients(id) VALUES($1) ON CONFLICT DO NOTHING',[id]);
  for(const v of objects)await c.query('INSERT INTO finance_pilot.objects(id,client_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[v.id,v.clientId]);
  for(const v of orders)await c.query('INSERT INTO finance_pilot.orders(id,object_id,client_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[v.id,v.objectId,v.clientId]);
  for(const v of workers)await c.query('INSERT INTO finance_pilot.workers(id,status) VALUES($1,$2) ON CONFLICT DO NOTHING',[v.id,v.status||'active']);
  for(const v of funds)await c.query(
   'INSERT INTO finance_pilot.funds(id,code,group_type,status,target_amount_base,allocation_share_pct) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
   [v.id,v.code,v.groupType,v.status||'active',v.targetAmountBase||0,v.allocationSharePct||0]);
  return {synthetic:true};
 });
}
async function relatedRecords(c){
 const map={Clients:{},Objects:{},WorkOrders:{},Workers:{}};
 const tables={Clients:'clients',Objects:'objects',WorkOrders:'orders',Workers:'workers'};
 for(const [kind,t] of Object.entries(tables)){
  const {rows}=await c.query('SELECT * FROM finance_pilot.'+t);
  for(const r of rows)map[kind][r.id]={
   clientId:r.client_id||'',objectId:r.object_id||'',workOrderId:r.id,
   workerId:r.id,status:r.status||'active',id:r.id
  };
 }
 return map;
}
function assertRelations(payload,map){
 const order=payload.workOrderId?map.WorkOrders[payload.workOrderId]:null;
 const object=payload.objectId?map.Objects[payload.objectId]:null;
 if(order&&payload.clientId&&order.clientId!==payload.clientId)error('ORDER_CLIENT_MISMATCH');
 if(order&&payload.objectId&&order.objectId!==payload.objectId)error('ORDER_OBJECT_MISMATCH');
 if(object&&payload.clientId&&object.clientId!==payload.clientId)error('OBJECT_CLIENT_MISMATCH');
 // Legacy lookup also checks referenced IDs and statuses through the exact source functions.
}
function financeNormalize(payload,map,existing={},options={}){
 if(payload.amountOriginal!==undefined)requiredMoney(payload.amountOriginal,'amountOriginal');
 if(payload.commissionOriginal!==undefined)requiredMoney(payload.commissionOriginal,'commissionOriginal',true);
 if(payload.fxRate!==undefined)requiredMoney(payload.fxRate,'fxRate');
 assertRelations(payload,map);
 const legacy=sandbox({related:map});
 const result=legacy.normalizeFinanceTransaction_(payload,existing);
 if(result.status!=='active'&&Object.keys(existing).length===0)
  error('CANNOT_CREATE_ARCHIVED_FINANCE');
 if(result.operationType==='OWNER_TRANSFER'&&result.ownerDirection==='investments'&&!options.allowLinkedInvestment)
  error('LINKED_OWNER_INVESTMENT_REQUIRES_ATOMIC_FINCAP_GATE');
 return result;
}
async function balances(c){
 const r=await c.query(
  "SELECT coalesce(sum(cash_base),0)::numeric(24,6)::text AS cash, "+
  "coalesce(sum(profit_base),0)::numeric(24,6)::text AS profit, "+
  "coalesce(sum(worker_payable_base),0)::numeric(24,6)::text AS payable "+
  "FROM finance_pilot.transactions WHERE status='active'");
 const f=await c.query('SELECT id,code,status,balance_base::text AS balance FROM finance_pilot.funds ORDER BY code');
 const scopes={};
 for(const key of ['workerId','workOrderId','objectId','clientId']){
  const q=await c.query("SELECT normalized->>($1::text) AS id, "+
   "coalesce(sum(cash_base),0)::text AS cash, "+
   "coalesce(sum(profit_base),0)::text AS profit, "+
   "coalesce(sum(worker_payable_base),0)::text AS payable "+
   "FROM finance_pilot.transactions WHERE status='active' AND coalesce(normalized->>($1::text),'')<>'' GROUP BY normalized->>($1::text)",
   [key]);
  scopes[key]=Object.fromEntries(q.rows.map(x=>[x.id,{
   cashBalanceBase:fixedMoney(x.cash),earnedProfitBase:fixedMoney(x.profit),
   workerPayableBase:fixedMoney(x.payable)}]));
 }
 return {cashBalanceBase:fixedMoney(r.rows[0].cash),earnedProfitBase:fixedMoney(r.rows[0].profit),
  workerPayableBase:fixedMoney(r.rows[0].payable),
  scopes,funds:Object.fromEntries(f.rows.map(x=>[x.code,{balanceBase:fixedMoney(x.balance),status:x.status}]))};
}
export async function pilotBalances(pool){return transaction(pool,balances);}
async function stored(c,requestKey,payloadHash){
 const {rows}=await c.query('SELECT payload_sha256,response FROM finance_pilot.receipts WHERE request_key=$1',[requestKey]);
 if(!rows.length)return null;
 if(rows[0].payload_sha256!==payloadHash)error('IDEMPOTENCY_KEY_PAYLOAD_CONFLICT');
 return {...rows[0].response,replayed:true};
}
async function receipt(c,requestKey,payloadHash,action,before,after,response){
 await c.query('INSERT INTO finance_pilot.audit(request_key,action,before_snapshot,after_snapshot) VALUES($1,$2,$3::jsonb,$4::jsonb)',
  [requestKey,action,JSON.stringify(before),JSON.stringify(after)]);
 await c.query('INSERT INTO finance_pilot.receipts(request_key,payload_sha256,response) VALUES($1,$2,$3::jsonb)',
  [requestKey,payloadHash,JSON.stringify(response)]);
 return response;
}
export async function pilotFinanceAction(pool,{requestKey,action,payload={},transactionId,expectedRevision}={}){
 if(!UUID.test(String(requestKey||'')))error('INVALID_PILOT_REQUEST_KEY');
 if(!['CREATE','CORRECT','ARCHIVE'].includes(action))error('INVALID_PILOT_FINANCE_ACTION');
 const digest=hash({action,payload,transactionId,expectedRevision});
 return transaction(pool,async c=>{
  const repeat=await stored(c,requestKey,digest);if(repeat)return repeat;
  const before=await balances(c);
  let id=transactionId?String(transactionId):randomUUID(),revision=1,canonical;
  const map=await relatedRecords(c);
  if(action==='CREATE'){
   if(transactionId)error('CLIENT_SUPPLIED_PILOT_FINANCE_ID_FORBIDDEN');
   canonical=financeNormalize({...payload,clientRequestId:requestKey},map);
   await c.query('INSERT INTO finance_pilot.transactions(id,request_key,status,normalized,cash_base,profit_base,worker_payable_base) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)',
    [id,requestKey,canonical.status,JSON.stringify(canonical),fixedMoney(canonical.cashEffectBase),
     fixedMoney(canonical.profitEffectBase),fixedMoney(canonical.workerPayableEffectBase)]);
  } else {
   if(!UUID.test(id))error('INVALID_PILOT_TRANSACTION_ID');
   const {rows}=await c.query('SELECT * FROM finance_pilot.transactions WHERE id=$1 FOR UPDATE',[id]);
   if(rows.length!==1)error('FINANCE_TRANSACTION_NOT_FOUND');
   const row=rows[0];
   if(expectedRevision!==undefined && (!Number.isInteger(expectedRevision)||expectedRevision!==row.revision))
    error('STALE_FINANCE_REVISION');
   if(row.status==='archived')error('ARCHIVED_FINANCE_IMMUTABLE');
   if(row.normalized?.operationType==='OWNER_TRANSFER'&&row.normalized?.ownerDirection==='investments')
    error('FINCAP_LINKED_FINANCE_CHANGE_REQUIRES_ATOMIC_GATE');
   if(action==='ARCHIVE'){
    canonical={...row.normalized,status:'archived',archivedAt:new Date().toISOString()};
   }else{
    canonical=financeNormalize({...payload,clientRequestId:requestKey},map,row.normalized);
    if(canonical.status!=='active')error('CORRECTION_CANNOT_ARCHIVE');
   }
   revision=row.revision+1;
   await c.query('UPDATE finance_pilot.transactions SET status=$2,revision=$3,normalized=$4::jsonb,cash_base=$5,profit_base=$6,worker_payable_base=$7 WHERE id=$1',
    [id,canonical.status,revision,JSON.stringify(canonical),fixedMoney(canonical.cashEffectBase),
     fixedMoney(canonical.profitEffectBase),fixedMoney(canonical.workerPayableEffectBase)]);
  }
  const after=await balances(c);
  const response={id,revision,action,status:canonical.status,normalized:canonical,before,after,synthetic:true};
  return receipt(c,requestKey,digest,'FINANCE_'+action,before,after,response);
 });
}
function fundRecord(r){return {fundId:r.id,code:r.code,groupType:r.group_type,status:r.status,
 targetAmountBase:Number(r.target_amount_base),allocationSharePct:Number(r.allocation_share_pct),
 balanceBase:Number(r.balance_base)};}
async function fundRows(c){
 const {rows}=await c.query('SELECT * FROM finance_pilot.funds ORDER BY code FOR UPDATE');
 return rows.map(fundRecord);
}
async function applyEffects(c,effects,funds){
 for(const [id,delta] of Object.entries(effects)){
  const fund=funds.find(x=>x.fundId===id);
  if(!fund)error('CAPITAL_FUND_NOT_FOUND');
  const value=Number(fund.balanceBase)+Number(delta.balanceBase||0);
  if(value<-0.0000001)error('CAPITAL_NEGATIVE_FUND_BALANCE');
  // Under a locked transaction preserve every legacy CapitalFundBalance counter,
  // not just the cash balance. Numeric arithmetic is performed in PostgreSQL.
  const changes=['balanceBase','allocatedBase','transferredInBase',
   'transferredOutBase','spentBase'].map(k=>fixedMoney(delta[k]||0));
  const count=Number(delta.transactionCount||0);
  if(!Number.isSafeInteger(count)||count<0)error('CAPITAL_COUNT_INVALID');
  const q=await c.query(
   'UPDATE finance_pilot.funds SET balance_base=balance_base+$2::numeric, '+
   'allocated_base=allocated_base+$3::numeric,transferred_in_base=transferred_in_base+$4::numeric, '+
   'transferred_out_base=transferred_out_base+$5::numeric,spent_base=spent_base+$6::numeric, '+
   'transaction_count=transaction_count+$7::integer WHERE id=$1',
   [id,...changes,count]);
  if(q.rowCount!==1)error('CAPITAL_FUND_CONCURRENTLY_REMOVED');
  fund.balanceBase=Number(fixedMoney(value));
 }
}
export async function pilotCapitalAction(pool,{requestKey,action,amountBase,fromFundId,toFundId,movementId,reason='synthetic pilot'}={}){
 if(!UUID.test(String(requestKey||'')))error('INVALID_PILOT_REQUEST_KEY');
 if(!['ALLOCATE','TRANSFER','SPEND','REVERSE'].includes(action))error('INVALID_CAPITAL_ACTION');
 const digest=hash({action,amountBase,fromFundId,toFundId,movementId,reason});
 return transaction(pool,async c=>{
  const repeat=await stored(c,requestKey,digest);if(repeat)return repeat;
  const before=await balances(c);
  const funds=await fundRows(c);
  const native=sandbox({funds});
  const newIds=[];
  function requireFund(id){const f=funds.find(x=>x.fundId===id);if(!f||f.status==='archived')error('CAPITAL_FUND_NOT_FOUND');return f;}
  if(action!=='REVERSE')requiredMoney(amountBase,'capitalAmount');
  if(action==='ALLOCATE'){
   const policy=native.capitalWaterfallAllocationsUnlocked_(Number(amountBase));
   for(const entry of policy.allocations){
    const f=requireFund(entry.fundId);
    if(f.status!=='active')error('CAPITAL_FUND_PAUSED');
    const movement={movementType:'ALLOCATION',amountBase:entry.amountBase,toFundId:f.fundId};
    await applyEffects(c,native.capitalTransactionEffects_(movement),funds);
    const id=randomUUID();newIds.push(id);
    await c.query('INSERT INTO finance_pilot.fund_movements(id,request_key,movement_type,to_fund_id,amount_base) VALUES($1,$2,$3,$4,$5)',
     [id,requestKey,'ALLOCATION',f.fundId,fixedMoney(entry.amountBase)]);
   }
  }else if(action==='TRANSFER'||action==='SPEND'){
   const from=requireFund(fromFundId);
   const to=action==='TRANSFER'?requireFund(toFundId):null;
   if(to&&(to.fundId===from.fundId||to.status!=='active'))error('CAPITAL_DESTINATION_INVALID');
   const movement={movementType:action,amountBase:Number(amountBase),fromFundId:from.fundId,toFundId:to?.fundId||''};
   await applyEffects(c,native.capitalTransactionEffects_(movement),funds);
   const id=randomUUID();newIds.push(id);
   await c.query('INSERT INTO finance_pilot.fund_movements(id,request_key,movement_type,from_fund_id,to_fund_id,amount_base) VALUES($1,$2,$3,$4,$5,$6)',
    [id,requestKey,action,from.fundId,to?.fundId||null,fixedMoney(amountBase)]);
  }else{
   if(!UUID.test(String(movementId||'')))error('CAPITAL_MOVEMENT_ID_REQUIRED');
   const {rows}=await c.query('SELECT * FROM finance_pilot.fund_movements WHERE id=$1 FOR UPDATE',[movementId]);
   if(rows.length!==1||rows[0].status!=='active'||rows[0].movement_type==='REVERSAL')error('CAPITAL_REVERSAL_FORBIDDEN');
   const orig=rows[0];
   if(orig.movement_type==='ALLOCATION')error('CAPITAL_ALLOCATION_REVERSAL_REQUIRES_FINCAP_GATE');
   const source={movementType:orig.movement_type,amountBase:Number(orig.amount_base),
    fromFundId:orig.from_fund_id||'',toFundId:orig.to_fund_id||''};
   const movement={...source,movementType:'REVERSAL',reversalOfTransactionId:movementId};
   await applyEffects(c,native.capitalTransactionEffects_(movement,source),funds);
   const id=randomUUID();newIds.push(id);
   await c.query("UPDATE finance_pilot.fund_movements SET status='reversed' WHERE id=$1",[movementId]);
   await c.query('INSERT INTO finance_pilot.fund_movements(id,request_key,movement_type,from_fund_id,to_fund_id,amount_base,reversal_of) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id,requestKey,'REVERSAL',orig.from_fund_id,orig.to_fund_id,orig.amount_base,movementId]);
  }
  const after=await balances(c);
  const response={action,movementIds:newIds,before,after,synthetic:true};
  return receipt(c,requestKey,digest,'CAPITAL_'+action,before,after,response);
 });
}


/**
 * B8: one synthetic PostgreSQL transaction for Finance owner investment,
 * FINCAP batch, 15/15/70 allocation lines, fund counters and durable audit.
 * NOT a real financial writer, nor an HTTP route or cutover permission.
 */
export async function pilotLinkedInvestmentAction(pool,{requestKey,payload={}}={}){
 if(!UUID.test(String(requestKey||'')))error('INVALID_PILOT_REQUEST_KEY');
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    payload.operationType!=='OWNER_TRANSFER'||payload.ownerDirection!=='investments')
  error('FINCAP_NEW_OWNER_INVESTMENT_REQUIRED');
 const digest=hash({action:'LINKED_INVESTMENT',payload});
 return transaction(pool,async c=>{
  const replay=await stored(c,requestKey,digest);
  if(replay)return replay;
  const before=await balances(c);
  const map=await relatedRecords(c);
  const normalized=financeNormalize({...payload,clientRequestId:requestKey},map,{},
   {allowLinkedInvestment:true});
  if(normalized.status!=='active'||normalized.operationType!=='OWNER_TRANSFER'||
     normalized.ownerDirection!=='investments'||!Number.isFinite(normalized.amountBase)||
     normalized.amountBase<=0)error('FINCAP_INVALID_NATIVE_FINANCE_INTENT');
  if(Number(before.cashBalanceBase)+0.0000001<
     Number(normalized.amountBase)+Number(normalized.commissionBase))
   error('FINCAP_NOT_ENOUGH_NATIVE_CASH');
  const funds=await fundRows(c); // Canonical target/balance rows locked FOR UPDATE.
  const id=randomUUID(),link='FINCAP|'+id;
  const existing=await c.query(
   'SELECT count(*)::int AS n FROM finance_pilot.allocation_batches '+
   'WHERE finance_transaction_id=$1 OR client_request_id=$2',[id,link]);
  if(existing.rows[0].n!==0)error('FINCAP_BATCH_EXISTS');
  const saved=await c.query(
   'INSERT INTO finance_pilot.transactions(id,request_key,status,normalized,cash_base,profit_base,worker_payable_base) '+
   'VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)',
   [id,requestKey,normalized.status,JSON.stringify(normalized),
    fixedMoney(normalized.cashEffectBase),fixedMoney(normalized.profitEffectBase),
    fixedMoney(normalized.workerPayableEffectBase)]);
  if(saved.rowCount!==1)error('FINCAP_FINANCE_ROW_MISSING');
  const plan=prepareNewFinanceInvestmentAllocation(
   {...normalized,financeTransactionId:id,sourceSystem:'CLEAN_NATIVE_FINANCE'},
   funds,funds.map(f=>({fundId:f.fundId,balanceBase:fixedMoney(f.balanceBase)})),
   {newFinancePostVerified:true,sourceSnapshotVerified:true,
    finCapLookupVerified:true,existingFinCapBatchCount:0});
  const batchId=randomUUID();
  const batch=await c.query(
   'INSERT INTO finance_pilot.allocation_batches(id,finance_transaction_id,client_request_id,'+
   'status,source_type,transaction_date_key,total_amount_base,allocations) '+
   'VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
   [batchId,id,plan.clientRequestId,'applied',plan.sourceType,
    plan.transactionDateKey,plan.totalAmountBase,JSON.stringify(plan.allocations)]);
  if(batch.rowCount!==1)error('FINCAP_BATCH_INSERT_FAILED');
  const legacy=sandbox({funds}),movementIds=[];
  for(const line of plan.allocations){
   const movement={movementType:'ALLOCATION',amountBase:Number(line.amountBase),
    toFundId:line.fundId};
   await applyEffects(c,legacy.capitalTransactionEffects_(movement),funds);
   const movementId=randomUUID();
   const lineKey=plan.clientRequestId+'|ALLOC|'+line.fundId;
   const created=await c.query(
    'INSERT INTO finance_pilot.fund_movements(id,request_key,movement_type,to_fund_id,'+
    'amount_base,batch_id,line_request_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [movementId,requestKey,'ALLOCATION',line.fundId,line.amountBase,batchId,lineKey]);
   if(created.rowCount!==1)error('FINCAP_MOVEMENT_INSERT_FAILED');
   movementIds.push(movementId);
  }
  const after=await balances(c);
  const response={action:'LINKED_INVESTMENT',financeTransactionId:id,
   allocationBatchId:batchId,clientRequestId:plan.clientRequestId,
   allocationLines:plan.allocations,movementIds,sourceType:'OPERATING_PROFIT',
   synthetic:true,before,after,historicalSourcePreserved:true,
   financialWriter:'SYNTHETIC_ONLY'};
  return receipt(c,requestKey,digest,'FINANCE_LINKED_INVESTMENT',before,after,response);
 });
}
