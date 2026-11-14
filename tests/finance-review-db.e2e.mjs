import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';

const url=process.env.TEST_DATABASE_URL;
if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname))
 throw Error('FINANCE_REVIEW_SQL_REQUIRES_DISPOSABLE_LOCAL_POSTGRES');
const client=new pg.Client({connectionString:url,ssl:false});
try{
 await client.connect();
 const sql=readFileSync(new URL('../migrations/0017_finance_history_review_TEST_ONLY.sql',import.meta.url),'utf8');
 await client.query(sql);
 await client.query(sql);
 const count=(await client.query(
  "SELECT to_regclass('public.mvp_finance_history_review')::text AS states,to_regclass('public.mvp_finance_history_review_events')::text AS events")).rows[0];
 assert.equal(count.states,'mvp_finance_history_review');
 assert.equal(count.events,'mvp_finance_history_review_events');
 const security=(await client.query(
  "SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('public.mvp_finance_history_review'::regclass,'public.mvp_finance_history_review_events'::regclass) ORDER BY relname")).rows;
 assert.equal(security.length,2);assert.ok(security.every(x=>x.relrowsecurity===true));
 const exposed=(await client.query(
  "SELECT count(*)::int n FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid IN ('public.mvp_finance_history_review'::regclass,'public.mvp_finance_history_review_events'::regclass) AND a.grantee=0 AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')")).rows[0].n;
 assert.equal(exposed,0);
 const kind='FINANCE_TRANSACTION',id='CI-ONLY-FINANCE-0001',requestKey=randomUUID();
 const payloadSha=createHash('sha256').update(JSON.stringify({kind,id,action:'REVIEWED'})).digest('hex');
 await client.query("INSERT INTO public.mvp_finance_history_review(source_kind,source_id,review_state,updated_by_login,last_request_key) VALUES($1,$2,'REVIEWED','owner-ci',$3)",[kind,id,requestKey]);
 const response={saved:true,item:{sourceKind:kind,sourceId:id,reviewState:'REVIEWED',revision:1}};
 await client.query("INSERT INTO public.mvp_finance_history_review_events(request_key,payload_sha256,source_kind,source_id,source_snapshot_id,prior_state,next_state,revision,actor_login,response) VALUES($1,$2,$3,$4,'CI_SOURCE_ONLY','UNREVIEWED','REVIEWED',1,'owner-ci',$5::jsonb)",
  [requestKey,payloadSha,kind,id,JSON.stringify(response)]);
 const state=(await client.query("SELECT review_state,revision FROM public.mvp_finance_history_review WHERE source_kind=$1 AND source_id=$2",[kind,id])).rows[0];
 assert.deepEqual(state,{review_state:'REVIEWED',revision:1});
 assert.equal((await client.query("SELECT count(*)::int n FROM public.mvp_finance_history_review_events")).rows[0].n,1);
 await assert.rejects(client.query(
  "INSERT INTO public.mvp_finance_history_review_events(request_key,payload_sha256,source_kind,source_id,source_snapshot_id,prior_state,next_state,revision,actor_login,response) VALUES($1,$2,$3,$4,'CI_SOURCE_ONLY','UNREVIEWED','REVIEWED',1,'owner-ci',$5::jsonb)",
  [requestKey,payloadSha,kind,id,JSON.stringify(response)]),e=>e.code==='23505');
 // A failed standalone statement leaves the connection usable (no transaction open).
 await assert.rejects(client.query("UPDATE public.mvp_finance_history_review_events SET next_state='ARCHIVED' WHERE request_key=$1",[requestKey]),
  e=>e.code==='23514'&&/FINANCE_REVIEW_AUDIT_APPEND_ONLY/.test(e.message));
 await assert.rejects(client.query("DELETE FROM public.mvp_finance_history_review_events WHERE request_key=$1",[requestKey]),
  e=>e.code==='23514'&&/FINANCE_REVIEW_AUDIT_APPEND_ONLY/.test(e.message));
 // Review marks are deliberately reversible without altering immutable event receipts.
 const next=await client.query("UPDATE public.mvp_finance_history_review SET review_state='ARCHIVED',revision=revision+1 WHERE source_kind=$1 AND source_id=$2 RETURNING review_state,revision",[kind,id]);
 assert.deepEqual(next.rows[0],{review_state:'ARCHIVED',revision:2});
 const events=(await client.query("SELECT count(*)::int n FROM public.mvp_finance_history_review_events")).rows[0].n;
 assert.equal(events,1);
 console.log('FINANCE_REVIEW_REAL_POSTGRES_ADDITIVE_TWICE_RLS_PRIVATE_AUDIT_IDEMPOTENCE_REVERT_PASS');
}finally{await client.end().catch(()=>{});}
