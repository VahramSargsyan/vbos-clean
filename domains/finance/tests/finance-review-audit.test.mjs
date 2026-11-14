import {test} from 'node:test';
import assert from 'node:assert/strict';
import {financeReviewAuditRead,financeReviewAuditProject,FinanceReviewAuditError} from '../finance-review-audit.mjs';

const BATCH='FINANCE_HIST_SOURCE_UNION_TEST_20261104_R1';
const SNAP='FINANCE_CAPITAL_GOOGLE_SNAPSHOT_20261106_R1';
const kinds=[['FINANCE_TRANSACTION',24],['BUSINESS_MONTHLY_GAIN',3],
 ['CAPITAL_FUND',8],['CAPITAL_ALLOCATION_BATCH',1],['CAPITAL_FUND_TRANSACTION',6]];
const items=kinds.flatMap(([sourceKind,count])=>Array.from({length:count},(_,i)=>({
 sourceKind,sourceId:sourceKind+'-'+(i+1),title:'Saved '+sourceKind+' '+(i+1),
 sourceSystem:'LEGACY_GOOGLE',sourcePreserved:true
})));
const verified={source:'VERIFIED_FINANCE_REVIEW_OVERLAY',readonlySource:true,
 financialWriter:'GOOGLE',moneyAffectedByArchive:false,total:42,items};
const event=(id,kind='FINANCE_TRANSACTION',at=1)=>({
 event_id:String(id),source_kind:kind,source_id:kind+'-'+at,
 source_snapshot_id:kind==='FINANCE_TRANSACTION'?BATCH:SNAP,
 prior_state:'UNREVIEWED',next_state:'REVIEWED',revision:1,
 actor_login:'owner-ci',recorded_at:'2026-11-08T19:00:00.000Z',
 response:{privateData:'MUST_NOT_BE_EXPOSED'},request_key:'PRIVATE_TOKEN'
});
const fixture=events=>{
 const sql=[];
 const db={query:async (q,args)=>{
  sql.push({q,args});
  assert.match(q,/^SELECT event_id::text AS event_id/);
  assert.doesNotMatch(q,/SELECT\s+\*/i);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP)\b/i.test(q));
  const [types,cursor,limit]=args;
  return {rows:events.filter(e=>types.includes(e.source_kind)&&
   (cursor===null||BigInt(e.event_id)<BigInt(cursor)))
   .sort((a,b)=>Number(b.event_id)-Number(a.event_id)).slice(0,limit)};
 }};
 let verification=0;
 const sourceReader=async()=>{verification++;return verified};
 return {db,sql,sourceReader,get verification(){return verification;}};
};
const auth={authorizeOwner:()=>true};
const query=p=>new URL('http://test.invalid/?'+p);

test('auth and parameter gate reject without SQL or source scan',async()=>{
 const f=fixture([event(1)]);
 await assert.rejects(financeReviewAuditRead(f.db,query('mode=finance'),{
  authorizeOwner:()=>false,verifiedRead:f.sourceReader
 }),{status:401});
 for(const params of ['mode=other','cursor=0','cursor=-1','cursor=9223372036854775808',
  'limit=0','limit=21','limit=1e2','limit=10.0']){
  await assert.rejects(financeReviewAuditRead(f.db,query(params),{
   ...auth,verifiedRead:f.sourceReader}),{status:400},params);
 }
 assert.equal(f.sql.length,0);
 assert.equal(f.verification,0);
});
test('finance audit is strictly source verified, read-only, paginated and no private receipt',async()=>{
 const f=fixture([event(11),event(10),event(9),event(8,'CAPITAL_FUND')]);
 const first=await financeReviewAuditRead(f.db,query('mode=finance&limit=2'),
  {...auth,verifiedRead:f.sourceReader});
 assert.equal(first.source,'VERIFIED_FINANCE_REVIEW_AUDIT');
 assert.equal(first.readonly,true);assert.equal(first.moneyAffected,false);
 assert.equal(first.financialWriter,'GOOGLE');
 assert.deepEqual(first.events.map(e=>e.eventId),['11','10']);
 assert.equal(first.hasMore,true);assert.equal(first.nextCursor,'10');
 assert.equal(JSON.stringify(first).includes('PRIVATE_TOKEN'),false);
 assert.equal(JSON.stringify(first).includes('MUST_NOT_BE_EXPOSED'),false);
 const next=await financeReviewAuditRead(f.db,query('mode=finance&limit=2&cursor=10'),
  {...auth,verifiedRead:f.sourceReader});
 assert.deepEqual(next.events.map(e=>e.eventId),['9']);
 assert.equal(next.hasMore,false);assert.equal(next.nextCursor,null);
 assert.equal(f.sql.length,2);assert.equal(f.verification,2);
 assert.deepEqual(f.sql[0].args,[['FINANCE_TRANSACTION','BUSINESS_MONTHLY_GAIN'],null,3]);
 assert.ok(f.sql.every(x=>x.q.includes('ORDER BY event_id DESC LIMIT $3')));
});
test('finance and capital timelines cannot mix; empty source is honest',async()=>{
 const f=fixture([event(3),event(2,'CAPITAL_FUND')]);
 const finance=await financeReviewAuditRead(f.db,query('mode=finance'),
  {...auth,verifiedRead:f.sourceReader});
 const capital=await financeReviewAuditRead(f.db,query('mode=capital'),
  {...auth,verifiedRead:f.sourceReader});
 assert.equal(finance.events.length,1);assert.equal(capital.events.length,1);
 assert.equal(capital.events[0].sourceKind,'CAPITAL_FUND');
 assert.equal(capital.events[0].originalTitle,'Saved CAPITAL_FUND 1');
 const empty=await financeReviewAuditRead(f.db,query('mode=capital&cursor=2'),
  {...auth,verifiedRead:f.sourceReader});
 assert.deepEqual(empty.events,[]);assert.equal(empty.hasMore,false);
});
test('unverified canonical source aborts before event SELECT',async()=>{
 const f=fixture([event(1)]);let calls=0;
 for(const broken of [
  {...verified,total:41},{...verified,financialWriter:'CLEAN'},
  {...verified,readonlySource:false},{...verified,moneyAffectedByArchive:true},
  {...verified,items:items.slice(1)}
 ]){
  await assert.rejects(financeReviewAuditRead(f.db,query('mode=finance'),
   {...auth,verifiedRead:async()=>{calls++;return broken}}),{status:503});
 }
 assert.equal(calls,5);assert.equal(f.sql.length,0);
});
test('tampered events, duplicate sequence, source ID and snapshot fail closed',()=>{
 const variants=[
  [event(1,'CAPITAL_FUND')], // capital event in a Finance page
  [{...event(1),source_id:'UNKNOWN'}],
  [{...event(1),source_snapshot_id:'WRONG'}],
  [{...event(1),actor_login:'owner <script>'}],
  [{...event(1),prior_state:'ARCHIVED',next_state:'ARCHIVED'}],
  [{...event(1),revision:0}],
  [{...event(1),recorded_at:'bad'}],
  [event(2),event(2)],
  [event(1),event(3)]
 ];
 for(const rows of variants){
  assert.throws(()=>financeReviewAuditProject(rows,{mode:'finance',limit:10,
   cursor:null,sourceItems:items}),e=>e instanceof FinanceReviewAuditError&&e.status===503);
 }
});
