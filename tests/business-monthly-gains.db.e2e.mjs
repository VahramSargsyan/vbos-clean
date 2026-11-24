/**
 * FINANCE-MONTH-04 — disposable PostgreSQL E2E, no Neon/Render connection.
 * Called only by an authorized disposable localhost TEST_DATABASE_URL (M1 requires PG17).
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {readBusinessMonthlyGain,saveBusinessMonthlyGain} from '../domains/finance/business-monthly-gains.mjs';

if(!process.env.TEST_DATABASE_URL||!/127\.0\.0\.1|localhost/.test(process.env.TEST_DATABASE_URL))
 throw Error('DISPOSABLE_LOCAL_TEST_DATABASE_REQUIRED');
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,ssl:false});
const approved={authorizeOwner:()=>true};
const month='2035-04';
const data={monthKey:month,referralCommissionBase:'1.005',purchaseCommissionBase:'2.004',
 organizationMarginBase:'3.015',taxOptimizationSavingsBase:'4.00',
 otherBusinessIncomeBase:'5',notes:'TEST-only monthly gain'};
const sql=readFileSync(new URL('../migrations/0026_finance_monthly_gains_TEST_ONLY.sql',import.meta.url),'utf8');
try{
 await pool.query(sql);
 await pool.query(sql);
 assert.equal((await pool.query("SELECT to_regclass('public.mvp_business_monthly_gains') IS NOT NULL AS m,to_regclass('public.mvp_business_monthly_gain_requests') IS NOT NULL AS r")).rows[0].m,true);
 console.log('FINANCE_MONTHLY_0026_ADDITIVE_REPLAY_TWICE_PASS');
 const initial=await readBusinessMonthlyGain(pool,month,approved);
 assert.equal(initial.record.revision,0);
 assert.equal(initial.record.totalBusinessGainsBase,'0.00');
 assert.equal(initial.financialAuthority,'NOT_APPLICABLE');
 assert.equal(initial.monthlyAuthority,'POSTGRESQL');
 assert.equal(initial.ledgerEffect,false);
 let rejected=false;
 try{await saveBusinessMonthlyGain(pool,{...data,requestKey:randomUUID(),expectedRevision:0},{authorizeOwner:()=>false});}
 catch(e){rejected=e.status===401;}
 assert.equal(rejected,true);
 const req1=randomUUID();
 const first=await saveBusinessMonthlyGain(pool,{...data,requestKey:req1,expectedRevision:0},approved);
 assert.equal(first.record.revision,1);
 assert.equal(first.record.totalBusinessGainsBase,'15.03');
 assert.equal(first.record.referralCommissionBase,'1.01');
 assert.equal(first.record.organizationMarginBase,'3.02');
 assert.equal(first.scope,'TEST_ONLY');
 assert.equal(first.replayed,false);
 const replay=await saveBusinessMonthlyGain(pool,{...data,requestKey:req1,expectedRevision:0},approved);
 assert.equal(replay.replayed,true);
 assert.equal(replay.record.revision,1);
 rejected=false;
 try{await saveBusinessMonthlyGain(pool,{...data,notes:'DIFFERENT',requestKey:req1,expectedRevision:0},approved);}
 catch(e){rejected=e.status===409;}
 assert.equal(rejected,true);
 rejected=false;
 try{await saveBusinessMonthlyGain(pool,{...data,requestKey:randomUUID(),expectedRevision:0},approved);}
 catch(e){rejected=e.status===409;}
 assert.equal(rejected,true);
 const updated=await saveBusinessMonthlyGain(pool,{...data,otherBusinessIncomeBase:'7.00',
  requestKey:randomUUID(),expectedRevision:1},approved);
 assert.equal(updated.record.revision,2);
 assert.equal(updated.record.totalBusinessGainsBase,'17.03');
 const byId=await readBusinessMonthlyGain(pool,month,approved);
 assert.equal(byId.record.revision,2);
 assert.equal(byId.record.totalBusinessGainsBase,'17.03');
 assert.ok(byId.months.some(r=>r.monthKey===month));
 const oldReplay=await saveBusinessMonthlyGain(pool,{...data,requestKey:req1,expectedRevision:0},approved);
 assert.equal(oldReplay.replayed,true);
 assert.equal(oldReplay.superseded,true);
 assert.equal(oldReplay.record.revision,2);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.mvp_business_monthly_gains WHERE month_key=$1',[month])).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.mvp_business_monthly_gain_requests WHERE month_key=$1',[month])).rows[0].n,2);
 console.log('FINANCE_MONTHLY_OWNER_IDEMPOTENT_EDIT_STALE_SUPERSEDED_GENERATED_TOTAL_PASS');
 // Concurrent first saves on same month are serialized and cannot create two rows.
 const competing='2035-05',one={...data,monthKey:competing};
 const race=await Promise.allSettled([
  saveBusinessMonthlyGain(pool,{...one,requestKey:randomUUID(),expectedRevision:0},approved),
  saveBusinessMonthlyGain(pool,{...one,requestKey:randomUUID(),expectedRevision:0},approved)
 ]);
 assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(race.filter(x=>x.status==='rejected'&&x.reason?.status===409).length,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.mvp_business_monthly_gains WHERE month_key=$1',[competing])).rows[0].n,1);
 const updates=await Promise.allSettled([
  saveBusinessMonthlyGain(pool,{...one,notes:'update A',requestKey:randomUUID(),expectedRevision:1},approved),
  saveBusinessMonthlyGain(pool,{...one,notes:'update B',requestKey:randomUUID(),expectedRevision:1},approved)
 ]);
 assert.equal(updates.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(updates.filter(x=>x.status==='rejected'&&x.reason?.status===409).length,1);
 assert.equal((await readBusinessMonthlyGain(pool,competing,approved)).record.revision,2);
 console.log('FINANCE_MONTHLY_CONCURRENT_SAME_MONTH_SINGLE_WRITER_PASS');
 const schema=(await pool.query(
  "SELECT column_name,is_generated FROM information_schema.columns WHERE table_schema='public' AND table_name='mvp_business_monthly_gains' AND column_name='total_business_gains_base'")).rows;
 assert.equal(schema.length,1);assert.equal(schema[0].is_generated,'ALWAYS');
 const docs=(await pool.query("SELECT count(*)::int AS n FROM public.mvp_business_monthly_gains")).rows[0].n;
 assert.equal(docs,2);
 console.log('FINANCE_MONTHLY_TEST_ONLY_NO_GOOGLE_COPY_GENERATED_SUM_PASS');
}finally{
 await pool.end();
}
