import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';

const url=process.env.TEST_DATABASE_URL;
if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname))
 throw Error('FINANCE_CORRECTIONS_REQUIRE_DISPOSABLE_LOCAL_POSTGRES');
const db=new pg.Client({connectionString:url,ssl:false});
try{
 await db.connect();
 const ddl=readFileSync(new URL('../migrations/0018_finance_history_owner_corrections_TEST_ONLY.sql',import.meta.url),'utf8');
 await db.query(ddl);
 await db.query(ddl);
 const tables=(await db.query(
  "SELECT to_regclass('public.mvp_finance_history_corrections') IS NOT NULL AS corrections,"+
  "to_regclass('public.mvp_finance_history_correction_events') IS NOT NULL AS audit")).rows[0];
 assert.deepEqual(tables,{corrections:true,audit:true});
 const security=(await db.query(
  "SELECT relname,relrowsecurity FROM pg_class WHERE oid IN "+
  "('public.mvp_finance_history_corrections'::regclass,'public.mvp_finance_history_correction_events'::regclass) ORDER BY relname")).rows;
 assert.equal(security.length,2);
 assert.ok(security.every(x=>x.relrowsecurity===true));
 const publicGrants=(await db.query(
  "SELECT COUNT(*)::int AS n FROM pg_class c CROSS JOIN LATERAL "+
  "aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid IN "+
  "('public.mvp_finance_history_corrections'::regclass,'public.mvp_finance_history_correction_events'::regclass) "+
  "AND a.grantee=0 AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')")).rows[0].n;
 assert.equal(publicGrants,0);
 const kind='FINANCE_TRANSACTION',id='FIN-CI-0001',key=randomUUID(),title='Fixed label',note='Owner-only note';
 const hash=createHash('sha256').update(JSON.stringify({kind,id,title,note})).digest('hex');
 await db.query(
  'INSERT INTO public.mvp_finance_history_corrections(source_kind,source_id,display_title,owner_note,updated_by_login,last_request_key) '+
  'VALUES($1,$2,$3,$4,$5,$6)',[kind,id,title,note,'ci-owner',key]);
 const response={saved:true,item:{sourceKind:kind,sourceId:id,displayTitle:title,ownerNote:note,revision:1}};
 await db.query(
  'INSERT INTO public.mvp_finance_history_correction_events(request_key,payload_sha256,source_kind,source_id,source_snapshot_id,'+
  'prior_title,next_title,prior_note,next_note,revision,actor_login,response) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',
  [key,hash,kind,id,'CI_SOURCE_ONLY',null,title,null,note,1,'ci-owner',JSON.stringify(response)]);
 assert.equal((await db.query('SELECT COUNT(*)::int n FROM public.mvp_finance_history_correction_events')).rows[0].n,1);
 await assert.rejects(db.query(
  'INSERT INTO public.mvp_finance_history_correction_events(request_key,payload_sha256,source_kind,source_id,source_snapshot_id,'+
  'prior_title,next_title,prior_note,next_note,revision,actor_login,response) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)',
  [key,hash,kind,id,'CI_SOURCE_ONLY',null,title,null,note,1,'ci-owner',JSON.stringify(response)]),
  e=>e.code==='23505');
 await assert.rejects(db.query(
  "UPDATE public.mvp_finance_history_correction_events SET next_title='tamper' WHERE request_key=$1",[key]),
  e=>e.code==='23514'&&/FINANCE_CORRECTION_AUDIT_APPEND_ONLY/.test(e.message));
 await assert.rejects(db.query(
  'DELETE FROM public.mvp_finance_history_correction_events WHERE request_key=$1',[key]),
  e=>e.code==='23514'&&/FINANCE_CORRECTION_AUDIT_APPEND_ONLY/.test(e.message));
 const version=(await db.query(
  'UPDATE public.mvp_finance_history_corrections SET display_title=NULL,owner_note=NULL,revision=revision+1 '+
  'WHERE source_kind=$1 AND source_id=$2 RETURNING revision,display_title,owner_note',[kind,id])).rows[0];
 assert.deepEqual(version,{revision:2,display_title:null,owner_note:null});
 assert.equal((await db.query('SELECT COUNT(*)::int n FROM public.mvp_finance_history_correction_events')).rows[0].n,1);
 console.log('FINANCE_CORRECTIONS_PG_MIGRATION_TWICE_RLS_PRIVATE_AUDIT_IMMUTABLE_REVERSIBLE_PASS');
}finally{await db.end().catch(()=>{});}
