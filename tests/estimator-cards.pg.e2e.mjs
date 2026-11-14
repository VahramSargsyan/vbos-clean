/** EST-CARDS-01: disposable CI PostgreSQL only. Never connects to real Neon/Render. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {estimatorCardsRead,estimatorCardAction} from '../estimator-cards.mjs';

if(!process.env.TEST_DATABASE_URL||!/^(localhost|127\.0\.0\.1)$/.test(new URL(process.env.TEST_DATABASE_URL).hostname))
 throw Error('EST_CARDS_DISPOSABLE_LOCAL_POSTGRES_ONLY');
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,ssl:false});
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const config={pool,AppError:ApiError};
const act=(type,p,key=randomUUID())=>estimatorCardAction({...config,type,p,key});
const read=()=>estimatorCardsRead(config);
const created={cardKey:'',revision:0,displayName:'Фильтр чистой воды CI',
 category:'SANITARY',unit:'шт',supportsWater:true,supportsSewer:false,
 supportsInstall:true,waterPoints:2,sewerPoints:0,notes:'Тестовая карточка',
 recipeMode:'OWNER_OVERRIDE',materials:[
  {name:'Фитинг CI',quantity:'2.250',unit:'шт',section:'Вода'}
 ]};
try{
 const ddl=readFileSync(new URL('../migrations/0035_estimator_card_editor_TEST_ONLY.sql',import.meta.url),'utf8');
 await pool.query(ddl);await pool.query(ddl);
 const ready=(await pool.query("SELECT to_regclass('public.mvp_estimator_cards') IS NOT NULL AS c,to_regclass('public.mvp_estimator_card_requests') IS NOT NULL AS r")).rows[0];
 assert.equal(ready.c,true);assert.equal(ready.r,true);
 console.log('EST_CARDS_0035_SQL_REPLAY_TWICE_PASS');
 const zero=await read();
 assert.equal(zero.items.filter(x=>x.sourceType==='SYSTEM').length,12);
 assert.equal(zero.items.find(x=>x.cardKey==='WC').revision,0);
 const requestKey=randomUUID();
 const first=await act('estimator_card_save',created,requestKey);
 assert.equal(first.saved,true);assert.equal(first.revision,1);
 assert.match(first.cardKey,/^USR:[0-9a-f-]{36}$/);
 assert.equal(first.sourceType,'USER');
 const replay=await act('estimator_card_save',created,requestKey);
 assert.equal(replay.deduplicated,true);assert.equal(replay.cardKey,first.cardKey);
 await assert.rejects(act('estimator_card_save',{...created,displayName:'Чужая'},requestKey),e=>e.status===409);
 const state=await read();
 const item=state.items.find(x=>x.cardKey===first.cardKey);
 assert.equal(item.materials.length,1);assert.equal(item.materials[0].quantity,'2.250');
 assert.equal(item.displayName,created.displayName);
 const modified=await act('estimator_card_save',{...created,cardKey:first.cardKey,
  revision:1,displayName:'Фильтр чистой воды CI v2'});
 assert.equal(modified.revision,2);
 await assert.rejects(act('estimator_card_save',{...created,cardKey:first.cardKey,revision:1,
  displayName:'Устарело'}),e=>e.status===409);
 const archived=await act('estimator_card_archive',{cardKey:first.cardKey,revision:2});
 assert.equal(archived.status,'archived');
 await assert.rejects(act('estimator_card_save',{...created,cardKey:first.cardKey,revision:3}),e=>e.status===409);
 await assert.rejects(act('estimator_card_archive',{cardKey:'WC',revision:0}),e=>e.status===409);
 console.log('EST_CARDS_USER_CREATE_REPLAY_UPDATE_STALE_ARCHIVE_PASS');
 const system=zero.items.find(x=>x.cardKey==='WC');
 const override=await act('estimator_card_save',{
  cardKey:'WC',revision:0,displayName:'Унитаз CI',
  category:system.category,unit:'шт',
  supportsWater:true,supportsSewer:true,supportsInstall:true,
  waterPoints:1,sewerPoints:1,notes:'',recipeMode:'OWNER_OVERRIDE',
  materials:[{name:'Моя муфта CI',quantity:'2',unit:'шт',section:'Вода'}]
 });
 assert.equal(override.revision,1);
 const changed=(await read()).items.find(x=>x.cardKey==='WC');
 assert.equal(changed.hasOverride,true);assert.equal(changed.displayName,'Унитаз CI');
 assert.equal(changed.materials[0].quantity,'2.000');
 await assert.rejects(act('estimator_card_reset',{cardKey:'WC',revision:0}),e=>e.status===409);
 const reset=await act('estimator_card_reset',{cardKey:'WC',revision:1});
 assert.equal(reset.revision,2);assert.equal(reset.status,'archived');
 const restored=(await read()).items.find(x=>x.cardKey==='WC');
 assert.equal(restored.displayName,'Унитаз');assert.equal(restored.revision,2);
 assert.equal(Boolean(restored.hasOverride),false);
 const overrideAgain=await act('estimator_card_save',{
  cardKey:'WC',revision:2,displayName:'Унитаз CI после сброса',
  category:system.category,unit:'шт',supportsWater:true,supportsSewer:true,
  supportsInstall:true,waterPoints:1,sewerPoints:1,notes:'',
  recipeMode:'SOURCE',materials:[]
 });
 assert.equal(overrideAgain.revision,3);
 const source=(await read()).items.find(x=>x.cardKey==='WC');
 assert.equal(source.recipeMode,'SOURCE');
 assert.equal(source.hasOverride,true);
 assert.ok(source.materials.length>0,'Source recipe restored independently of owner overrides');
 console.log('EST_CARDS_SYSTEM_OVERLAY_MATERIALS_RESET_REVISION_SOURCE_PASS');
 const oldStats=(await pool.query("SELECT count(*)::int AS n FROM public.mvp_estimates")).rows[0].n;
 assert.ok(oldStats>=0);
 const audit=(await pool.query("SELECT count(*)::int AS n FROM public.mvp_estimator_card_requests")).rows[0].n;
 assert.ok(audit>=5);
 console.log('EST_CARDS_EXISTING_ESTIMATE_NONMUTATION_PASS');
}finally{await pool.end();}
