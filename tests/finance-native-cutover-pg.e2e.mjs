/**
 * B9 guarded native Finance/Capital cutover schema:
 * PostgreSQL 16 disposable CI ONLY, synthetic sources and fake balances.
 * This test must NEVER connect to shared Neon or an existing financial DB.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const url=process.env.TEST_DATABASE_URL||'';
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname)||
 new URL(url).pathname!=='/vbos_mvp_ci')
 throw Error('FINANCE_B9_DISPOSABLE_PG_ONLY');
const pool=new pg.Pool({connectionString:url,ssl:false,max:3});
const sql=readFileSync(
 new URL('../migrations/0030_finance_native_cutover_CANDIDATE.sql',import.meta.url),'utf8');
const hashA='a'.repeat(64),hashB='b'.repeat(64);
const snapshot='SYNTHETIC_B9_SNAPSHOT';
const day='2026-11-11',dayBefore='2026-11-10';
const uuid=()=>randomUUID();
const money=x=>Number(x);
async function tx(date=day,extra={}){
 const id=uuid();
 await pool.query(
  'INSERT INTO mvp_finance_native.transactions('+
  'finance_transaction_id,request_key,status,transaction_date_key,operation_type,'+
  'client_id,amount_base,cash_effect_base,profit_effect_base,'+
  'worker_payable_effect_base,normalized) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)',
  [id,uuid(),'active',date,extra.type||'INCOME',
   extra.clientId||null,extra.amount||'300.000000',
   extra.cash||'300.000000',extra.profit||'200.000000',
   '0.000000',JSON.stringify({source:'B9_SYNTHETIC',
    ...(extra.type==='OWNER_TRANSFER'?{ownerDirection:'investments'}:{})})]);
 return id;
}
async function ctrl(){
 const r=await pool.query(
  'SELECT phase,financial_write_authority,cutover_date_key,owner_identity_approved,'+
  'google_frozen_confirmed FROM mvp_finance_native.cutover_control WHERE id=1');
 return r.rows[0];
}
const funds=Array.from({length:8},(_,i)=>({
 id:uuid(),legacy:'SYNTHETIC-LEGACY-FUND-'+(i+1),
 code:i===0?'OPERATING_RESERVE':i===1?'WARRANTY_RESERVE':'GROWTH_'+i,
 group:i<2?'PROTECTIVE':'GROWTH',
 opening:i===0?'50.000000':'0.000000'
}));
async function counts(){
 const q=await pool.query(
  'SELECT (SELECT count(*)::int FROM mvp_finance_native.transactions) tx,'+
  '(SELECT count(*)::int FROM mvp_finance_native.fincap_batches) batches,'+
  '(SELECT count(*)::int FROM mvp_finance_native.fund_movements) movements,'+
  '(SELECT count(*)::int FROM mvp_finance_native.fund_effects) effects');
 return q.rows[0];
}
test('B9 native TEST cutover: default closed, exact openings, native-only ledger',async t=>{
 try{
  await t.test('additive SQL applies twice; writer closed by default',async()=>{
   await pool.query(sql);await pool.query(sql);
   const control=await ctrl();
   assert.equal(control.phase,'BLOCKED');
   assert.equal(control.financial_write_authority,'GOOGLE');
   assert.equal(control.owner_identity_approved,false);
   assert.deepEqual(await counts(),{tx:0,batches:0,movements:0,effects:0});
   await assert.rejects(tx(),/FINANCE_B9_NATIVE_WRITER_GATE_CLOSED/);
   assert.equal((await counts()).tx,0);
   const p=await pool.query(
    "SELECT count(*)::int n FROM pg_tables WHERE schemaname='mvp_finance_native'");
   assert.ok(p.rows[0].n>=9);
  });
  await t.test('no activation without independently attested opening and mapping',async()=>{
   await assert.rejects(pool.query(
    "UPDATE mvp_finance_native.cutover_control SET phase='ACTIVE',financial_write_authority='POSTGRES' WHERE id=1"),
    /FINANCE_B9_ACTIVATION_APPROVAL_REQUIRED/);
   assert.equal((await ctrl()).phase,'BLOCKED');
   await pool.query(
    'INSERT INTO mvp_finance_native.opening_snapshot('+
    'source_snapshot_id,manifest_sha256,as_of_date,opening_cash_base,'+
    'opening_profit_base,opening_worker_payable_base) VALUES($1,$2,$3,$4,$5,$6)',
    [snapshot,hashA,dayBefore,'5000','700','0']);
   const activate=[
    "UPDATE mvp_finance_native.cutover_control SET phase='ACTIVE',"+
    "financial_write_authority='POSTGRES',cutover_date_key=$1,"+
    "snapshot_id=$2,manifest_sha256=$3,crm_bridge_sha256=$4,"+
    "owner_identity_approved=true,google_frozen_confirmed=true WHERE id=1",
    [day,snapshot,hashA,hashB]];
   await assert.rejects(pool.query(...activate),/FINANCE_B9_FUND_OPENINGS_INCOMPLETE/);
   assert.equal((await ctrl()).phase,'BLOCKED');
   for(const f of funds){
    await pool.query(
     'INSERT INTO mvp_finance_native.funds(fund_id,legacy_source_id,code,group_type,status) '+
     "VALUES($1,$2,$3,$4,'active')",[f.id,f.legacy,f.code,f.group]);
    await pool.query(
     'INSERT INTO mvp_finance_native.fund_openings('+
     'fund_id,legacy_balance_source_id,source_snapshot_id,opening_balance_base) '+
     'VALUES($1,$2,$3,$4)',[f.id,'SYN-OPEN-'+f.legacy,snapshot,f.opening]);
   }
   await pool.query(...activate);
   assert.equal((await ctrl()).phase,'ACTIVE');
   assert.equal((await ctrl()).financial_write_authority,'POSTGRES');
   await assert.rejects(pool.query(
    'UPDATE mvp_finance_native.opening_snapshot SET opening_cash_base=9999 WHERE id=1'),
    /FINANCE_B9_OPENING_IMMUTABLE_AFTER_ACTIVATION/);
   await assert.rejects(pool.query(
    'UPDATE mvp_finance_native.fund_openings SET opening_balance_base=9999 WHERE fund_id=$1',
    [funds[0].id]),/FINANCE_B9_OPENING_IMMUTABLE_AFTER_ACTIVATION/);
  });
  await t.test('cutover date and CRM UUID foreign keys guard new native finance',async()=>{
   await assert.rejects(tx(dayBefore),/FINANCE_B9_BEFORE_CUTOVER_DATE/);
   await assert.rejects(tx(day,{clientId:uuid()}),/foreign key constraint/);
   assert.equal((await counts()).tx,0);
   await tx(day);
   const r=await pool.query(
    'SELECT opening_cash_base::text,native_cash_delta_base::text,'+
    'current_cash_balance_base::text,opening_profit_base::text,'+
    'native_profit_delta_base::text FROM mvp_finance_native.v_cash_ledger');
   assert.equal(r.rows.length,1);
   assert.equal(money(r.rows[0].opening_cash_base),5000);
   assert.equal(money(r.rows[0].native_cash_delta_base),300);
   assert.equal(money(r.rows[0].current_cash_balance_base),5300);
   assert.equal(money(r.rows[0].opening_profit_base),700);
   assert.equal(money(r.rows[0].native_profit_delta_base),200);
   assert.equal((await counts()).tx,1);
  });
  await t.test('FINCAP deterministic identity, fund opening and append-only nonnegative ledger',async()=>{
   const source=await tx(day,{type:'OWNER_TRANSFER',amount:'100',
    cash:'-100',profit:'0'});
   const batch=uuid(),movement=uuid();
   await assert.rejects(pool.query(
    'INSERT INTO mvp_finance_native.fincap_batches('+
    'batch_id,finance_transaction_id,client_request_id,total_amount_base,'+
    'transaction_date_key) VALUES($1,$2,$3,$4,$5)',
    [batch,source,'FINCAP|WRONG','100',day]),/fincap_deterministic_key/);
   await pool.query(
    'INSERT INTO mvp_finance_native.fincap_batches('+
    'batch_id,finance_transaction_id,client_request_id,total_amount_base,'+
    'transaction_date_key) VALUES($1,$2,$3,$4,$5)',
    [batch,source,'FINCAP|'+source,'100',day]);
   await pool.query(
    'INSERT INTO mvp_finance_native.fund_movements('+
    'movement_id,request_key,movement_type,transaction_date_key,'+
    'to_fund_id,allocation_batch_id,amount_base) '+
    "VALUES($1,$2,'ALLOCATION',$3,$4,$5,$6)",
    [movement,uuid(),day,funds[0].id,batch,'100']);
   await pool.query(
    'INSERT INTO mvp_finance_native.fund_effects(movement_id,fund_id,balance_delta_base) '+
    'VALUES($1,$2,$3)',[movement,funds[0].id,'100']);
   const r=await pool.query(
    'SELECT opening_balance_base::text,native_delta_base::text,current_balance_base::text '+
    'FROM mvp_finance_native.v_fund_balances WHERE fund_id=$1',[funds[0].id]);
   assert.equal(money(r.rows[0].opening_balance_base),50);
   assert.equal(money(r.rows[0].native_delta_base),100);
   assert.equal(money(r.rows[0].current_balance_base),150);
   await assert.rejects(pool.query(
    'UPDATE mvp_finance_native.fund_effects SET balance_delta_base=1 WHERE movement_id=$1',
    [movement]),/FINANCE_B9_EFFECTS_APPEND_ONLY/);
   const before=await counts();
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const move=uuid();
    await client.query(
     'INSERT INTO mvp_finance_native.fund_movements('+
     'movement_id,request_key,movement_type,transaction_date_key,from_fund_id,amount_base) '+
     "VALUES($1,$2,'SPEND',$3,$4,$5)",[move,uuid(),day,funds[0].id,'250']);
    await assert.rejects(client.query(
     'INSERT INTO mvp_finance_native.fund_effects(movement_id,fund_id,balance_delta_base)'+
     ' VALUES($1,$2,$3)',[move,funds[0].id,'-250']),
     /FINANCE_B9_INSUFFICIENT_FUND_BALANCE/);
   }finally{await client.query('ROLLBACK');client.release();}
   assert.deepEqual(await counts(),before);
  });
  await t.test('pausing PostgreSQL stops money writes; never reverts to Google automatically',async()=>{
   await pool.query(
    "UPDATE mvp_finance_native.cutover_control SET phase='PAUSED' WHERE id=1");
   assert.equal((await ctrl()).financial_write_authority,'POSTGRES');
   await assert.rejects(tx(day),/FINANCE_B9_NATIVE_WRITER_GATE_CLOSED/);
   await assert.rejects(pool.query(
    "UPDATE mvp_finance_native.cutover_control SET phase='BLOCKED',financial_write_authority='GOOGLE' WHERE id=1"),
    /FINANCE_B9_CANNOT_REVERT_AUTHORITY_TO_GOOGLE/);
   assert.equal((await ctrl()).phase,'PAUSED');
  });
 }finally{await pool.end();}
});
