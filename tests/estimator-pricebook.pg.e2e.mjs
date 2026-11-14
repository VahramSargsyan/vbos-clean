/** EST-PRICES-01: native PostgreSQL integration, disposable CI host ONLY. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {estimatorPricebookRead,estimatorPricebookAction} from '../estimator-pricebook.mjs';
import {resolveEstimatorUnitPrice} from '../public/estimate-pricebook.mjs';
import {estimatorCardAction} from '../estimator-cards.mjs';

if(!process.env.TEST_DATABASE_URL||!/^(localhost|127\.0\.0\.1)$/.test(new URL(process.env.TEST_DATABASE_URL).hostname))
 throw Error('EST_PRICES_DISPOSABLE_LOCAL_POSTGRES_ONLY');
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,ssl:false});
class ApiError extends Error{constructor(status,text){super(text);this.status=status;}}
const act=(type,p,key=randomUUID())=>estimatorPricebookAction({pool,type,p,key,AppError:ApiError});
const read=()=>estimatorPricebookRead({pool,AppError:ApiError});
const profile={tariffCode:'STANDARD_PLUS',multiplier:'1.3',roundingStep:100,revision:0};
const global={scopeType:'GLOBAL_ACTION',actionType:'WATER',cardKey:'',revision:0,
 economyBaseAMD:'2000',standardFloorAMD:'3000',vipFloorAMD:null};
const stamp=()=>pool.query('SELECT (SELECT count(*)::int FROM public.mvp_estimates) AS estimates, (SELECT count(*)::int FROM public.mvp_estimate_lines WHERE archived_at IS NULL) AS lines, (SELECT count(*)::int FROM public.mvp_estimate_versions) AS versions, (SELECT count(*)::int FROM public.mvp_estimator_cards) AS cards');
try{
 const ddl=readFileSync(new URL('../migrations/0036_estimator_pricebook_TEST_ONLY.sql',import.meta.url),'utf8');
 await pool.query(ddl);await pool.query(ddl);
 const pre=(await stamp()).rows[0];
 const empty=await read();
 assert.equal(empty.ready,true);assert.equal(empty.rules.length,0);
 assert.equal(empty.profiles[1].multiplier,1.25);
 console.log('EST_PRICES_0036_SQL_REPLAY_TWICE_PASS');
 const key=randomUUID();
 const first=await act('estimator_tariff_save',profile,key);
 assert.equal(first.saved,true);assert.equal(first.revision,1);
 const replay=await act('estimator_tariff_save',profile,key);
 assert.equal(replay.deduplicated,true);assert.equal(replay.revision,1);
 await assert.rejects(act('estimator_tariff_save',{...profile,multiplier:'1.45'},key),e=>e.status===409);
 await assert.rejects(act('estimator_tariff_save',{...profile,multiplier:'1.5'}),e=>e.status===409);
 let state=await read();
 assert.equal(state.profiles.find(x=>x.tariffCode==='STANDARD_PLUS').roundingStep,100);
 assert.equal(state.profiles.find(x=>x.tariffCode==='STANDARD_PLUS').multiplier,1.3);
 const second=await act('estimator_tariff_save',{...profile,multiplier:'1.4',revision:1});
 assert.equal(second.revision,2);
 console.log('EST_PRICES_PROFILE_CREATE_REPLAY_CONFLICT_REVISION_PASS');
 const gp=await act('estimator_price_save',global);
 assert.equal(gp.revision,1);
 state=await read();
 assert.equal(state.rules.length,1);
 const r=resolveEstimatorUnitPrice(state,{actionType:'WATER',tariff:'STANDARD_PLUS',legacyEconomy:1000});
 assert.equal(r.generated,'2800');
 assert.equal(r.price,'3000');assert.equal(r.floorEffective,true);
 const raised=await act('estimator_price_save',{...global,economyBaseAMD:'2500',revision:1});
 assert.equal(raised.revision,2);
 state=await read();
 const above=resolveEstimatorUnitPrice(state,{actionType:'WATER',tariff:'STANDARD_PLUS',legacyEconomy:1000});
 assert.equal(above.price,'3500');assert.equal(above.floor,3000);assert.equal(above.floorEffective,false);
 const lowered=await act('estimator_price_save',{...global,revision:2});
 assert.equal(lowered.revision,3);
 const back=resolveEstimatorUnitPrice(await read(),{actionType:'WATER',tariff:'STANDARD_PLUS',legacyEconomy:1000});
 assert.equal(back.price,'3000');assert.equal(back.floorEffective,true);
 console.log('EST_PRICES_BOOK_MINIMUM_PERSISTS_AND_REACTIVATES_PASS');
 const cardReq=randomUUID();
 const newCard=await estimatorCardAction({pool,AppError:ApiError,type:'estimator_card_save',key:cardReq,p:{
  displayName:'Устройство для цены CI '+cardReq.slice(0,8),category:'SANITARY',unit:'шт',
  supportsWater:false,supportsSewer:false,supportsInstall:true,waterPoints:0,sewerPoints:0,
  recipeMode:'OWNER_OVERRIDE',materials:[],notes:''
 }});
 assert.ok(newCard.cardKey.startsWith('USR:'));
 const cr=await act('estimator_price_save',{scopeType:'CARD_ACTION',actionType:'FIXTURE_INSTALL',
  cardKey:newCard.cardKey,revision:0,economyBaseAMD:'12000',standardFloorAMD:'18000',vipFloorAMD:'21000'});
 assert.equal(cr.revision,1);
 state=await read();
 assert.equal(resolveEstimatorUnitPrice(state,{actionType:'FIXTURE_INSTALL',cardKey:newCard.cardKey,
  tariff:'STANDARD_PLUS',legacyEconomy:null}).price,'18000');
 await estimatorCardAction({pool,AppError:ApiError,type:'estimator_card_archive',key:randomUUID(),
  p:{cardKey:newCard.cardKey,revision:1}});
 await assert.rejects(act('estimator_price_save',{scopeType:'CARD_ACTION',actionType:'FIXTURE_INSTALL',
  cardKey:newCard.cardKey,revision:1,economyBaseAMD:'10000'}),e=>e.status===409);
 console.log('EST_PRICES_USER_CARD_SOURCE_AND_ARCHIVE_GUARD_PASS');
 const after=(await stamp()).rows[0];
 assert.equal(after.estimates,pre.estimates);
 assert.equal(after.lines,pre.lines);
 assert.equal(after.versions,pre.versions);
 assert.equal(after.cards,pre.cards+1);
 console.log('EST_PRICES_ESTIMATE_SNAPSHOT_NONMUTATION_PASS');
}finally{await pool.end();}
