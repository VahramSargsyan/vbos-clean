// SOP synthetic disposable PostgreSQL E2E: explicitly localhost only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {knowledgeRead,knowledgeSave} from '../knowledge.mjs';
const address=process.env.TEST_DATABASE_URL;
if(!address||!['localhost','127.0.0.1'].includes(new URL(address).hostname))
 throw Error('SOP_LOCAL_DISPOSABLE_PG_ONLY');
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const pool=new Pool({connectionString:address,ssl:false});
const original={title:'Исходная карточка',code:'1.1',status:'active',type:'SOP',
 sectionPath:'',summary:'',fullText:'',tags:'лид',version:'v1',
 sourceName:'Исходный документ',sourceVersion:'v0.2.62',
 priority:'MEDIUM',sortOrder:0,favorite:'false'};
try{
 const ddl=readFileSync(new URL('../migrations/0038_legacy_sop_knowledge_CANDIDATE.sql',import.meta.url),'utf8');
 await pool.query(ddl);await pool.query(ddl);
 let state=await knowledgeRead({pool,AppError:ApiError});
 assert.equal(state.items.length,0);assert.equal(state.writeEnabled,false);
 await assert.rejects(knowledgeSave({pool,p:original,key:randomUUID(),AppError:ApiError}),
  e=>e.status===409);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.mvp_knowledge_items')).rows[0].n,0);
 console.log('SOP_BLOCKED_PRE_CUTOVER_AND_DDL_REPLAY_PASS');
 // Only synthetic test gate activation, NEVER an authorization to switch real source.
 await pool.query("INSERT INTO public.mvp_knowledge_items(knowledge_id,title,code,type,source_system) VALUES('KNW-2026-0002','Историческая карточка','2.1','SOP','LEGACY_GOOGLE')");
 await pool.query('INSERT INTO public.mvp_knowledge_sequences(year,last_value) VALUES(2026,2)');
 await pool.query("UPDATE public.mvp_knowledge_authority SET phase='CLEAN',source_snapshot_hash=$1 WHERE id=1",['a'.repeat(64)]);
 state=await knowledgeRead({pool,AppError:ApiError});
 assert.equal(state.items[0].knowledgeId,'KNW-2026-0002');assert.equal(state.writeEnabled,true);
 const k=randomUUID();
 const first=await knowledgeSave({pool,p:original,key:k,AppError:ApiError});
 assert.match(first.entityId,/^KNW-[0-9]{4}-[0-9]{4,}$/);
 assert.equal(first.data.favorite,'false');
 const replay=await knowledgeSave({pool,p:original,key:k,AppError:ApiError});
 assert.deepEqual(replay,first);
 await assert.rejects(knowledgeSave({pool,p:{...original,title:'Другой смысл'},key:k,AppError:ApiError}),
  e=>e.status===409);
 const changed=await knowledgeSave({pool,p:{...first.data,title:'Обновлено',favorite:'true'},key:randomUUID(),AppError:ApiError});
 assert.equal(changed.entityId,first.entityId);assert.equal(changed.data.favorite,'true');
 state=await knowledgeRead({pool,AppError:ApiError});
 assert.equal(state.items[0].knowledgeId,first.entityId);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM public.mvp_knowledge_items')).rows[0].n,2);
 assert.equal((await pool.query("SELECT source_system FROM public.mvp_knowledge_items WHERE knowledge_id='KNW-2026-0002'")).rows[0].source_system,'LEGACY_GOOGLE');
 console.log('SOP_ID_CREATE_UPDATE_FAVORITE_REPLAY_CONFLICT_SOURCE_PRESERVATION_PASS');
}finally{await pool.end();}
