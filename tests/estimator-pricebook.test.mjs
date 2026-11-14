import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_TARIFF_PROFILES,pricebookProfile,resolveEstimatorUnitPrice,
 pricebookRule} from '../public/estimate-pricebook.mjs';
import {calculatePlumbingEstimateBatch,estimatorLegacyEconomyPrice} from '../public/estimate-plumbing.mjs';
import {estimatorPricebookRead,estimatorPricebookAction} from '../estimator-pricebook.mjs';

const book={profiles:[
 {tariffCode:'ECONOM',multiplier:1,roundingStep:1,revision:0},
 {tariffCode:'STANDARD_PLUS',multiplier:1.25,roundingStep:1,revision:0},
 {tariffCode:'VIP',multiplier:1.5,roundingStep:1,revision:0}],
 rules:[{scopeType:'CARD_ACTION',actionType:'FIXTURE_INSTALL',cardKey:'WC',economyBaseAMD:'10000',
 standardFloorAMD:'13000',vipFloorAMD:null,revision:1},
 {scopeType:'GLOBAL_ACTION',actionType:'CHASING',cardKey:'',economyBaseAMD:'300',standardFloorAMD:null,vipFloorAMD:null,revision:1},
 {scopeType:'GLOBAL_ACTION',actionType:'WATER',cardKey:'',economyBaseAMD:'2000',standardFloorAMD:null,vipFloorAMD:null,revision:1}]};
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}

test('Economy base multiplier / persistent Standard+ floor reproduces legacy price policy',()=>{
 assert.equal(DEFAULT_TARIFF_PROFILES.STANDARD_PLUS.multiplier,1.25);
 const base={actionType:'FIXTURE_INSTALL',cardKey:'WC',legacyEconomy:15000,legacyPriceMode:'FROM'};
 let p=resolveEstimatorUnitPrice(book,{...base,tariff:'ECONOM'});
 assert.equal(p.price,'10000');
 assert.equal(p.configured,true);
 p=resolveEstimatorUnitPrice(book,{...base,tariff:'STANDARD_PLUS'});
 assert.equal(p.generated,'12500');
 assert.equal(p.price,'13000');assert.equal(p.floorEffective,true);
 assert.equal(p.floor,13000);
 assert.equal(resolveEstimatorUnitPrice(book,{...base,tariff:'VIP'}).price,'15000');
 const higher={...book,rules:[{...book.rules[0],economyBaseAMD:'11000'}]};
 p=resolveEstimatorUnitPrice(higher,{...base,tariff:'STANDARD_PLUS'});
 assert.equal(p.generated,'13750');assert.equal(p.price,'13750');
 assert.equal(p.floor,13000);assert.equal(p.floorEffective,false);
 assert.equal(resolveEstimatorUnitPrice(book,{...base,tariff:'STANDARD_PLUS'}).price,'13000');
 const rounded={...book,profiles:[book.profiles[0],{...book.profiles[1],roundingStep:100},book.profiles[2]]};
 p=resolveEstimatorUnitPrice(rounded,{...base,tariff:'STANDARD_PLUS'});
 assert.equal(p.price,'13000');
});

test('user rate wins in fresh quote, and missing owner rule leaves historical FROM manual',()=>{
 const line={cardKey:'WC',quantity:1,water:true,sewer:true,install:true};
 const fresh=calculatePlumbingEstimateBatch({tariff:'STANDARD_PLUS',cards:[line],
  cardCatalog:[],pricebook:book,includeMaterials:false,applyFixedReferencePrices:true});
 const install=fresh.lines.find(x=>x.sourceAction==='FIXTURE_INSTALL');
 assert.equal(install.unitPriceAMD,'13000');
 assert.equal(install.priceMode,'OWNER_PRICEBOOK');
 assert.equal(fresh.lines.find(x=>x.sourceAction==='WATER').unitPriceAMD,'2500');
 const overridden=calculatePlumbingEstimateBatch({tariff:'STANDARD_PLUS',
  cards:[{...line,installPrice:'19000'}],pricebook:book,
  includeMaterials:false,applyFixedReferencePrices:true});
 assert.equal(overridden.lines.find(x=>x.sourceAction==='FIXTURE_INSTALL').unitPriceAMD,'19000');
 assert.equal(overridden.lines.find(x=>x.sourceAction==='FIXTURE_INSTALL').priceMode,'OWNER_ENTERED');
 const plain=calculatePlumbingEstimateBatch({tariff:'STANDARD_PLUS',cards:[line],
  includeMaterials:false,applyFixedReferencePrices:true});
 assert.equal(plain.lines.find(x=>x.sourceAction==='FIXTURE_INSTALL').priceMode,'FROM');
 assert.equal(plain.lines.find(x=>x.sourceAction==='FIXTURE_INSTALL').unitPriceAMD,'');
 assert.equal(estimatorLegacyEconomyPrice('FIXTURE_INSTALL','WC'),15000);
});

test('fixed historical rate obeys owner multiplier even when no explicit price override exists',()=>{
 const configured={profiles:[
  {tariffCode:'ECONOM',multiplier:1,roundingStep:1,revision:0},
  {tariffCode:'STANDARD_PLUS',multiplier:1.4,roundingStep:100,revision:1},
  {tariffCode:'VIP',multiplier:1.5,roundingStep:1,revision:0}
 ],rules:[]};
 const quote=calculatePlumbingEstimateBatch({
  tariff:'STANDARD_PLUS',cards:[{cardKey:'WC',quantity:1,sewer:true,water:false,install:false}],
  includeMaterials:false,pricebook:configured,applyFixedReferencePrices:true
 });
 const sewer=quote.lines.find(x=>x.sourceAction==='SEWER');
 const economy=estimatorLegacyEconomyPrice('SEWER');
 assert.equal(sewer.suggestedUnitPriceAMD,String(Math.round(economy*1.4/100)*100));
 assert.equal(sewer.unitPriceAMD,sewer.suggestedUnitPriceAMD);
 const unconfirmed=calculatePlumbingEstimateBatch({
  tariff:'STANDARD_PLUS',cards:[{cardKey:'WC',quantity:1,sewer:true,water:false,install:false}],
  includeMaterials:false,pricebook:configured,applyFixedReferencePrices:false
 });
 assert.equal(unconfirmed.lines.find(x=>x.sourceAction==='SEWER').unitPriceAMD,'');
});

test('configured chasing and custom card install obey floor and remain quote-local',()=>{
 const custom={cardKey:'USR:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',sourceType:'USER',status:'active',
  displayName:'Тестовый фильтр',category:'SANITARY',supportsWater:true,supportsSewer:false,
  supportsInstall:true,waterPoints:2,sewerPoints:0,recipeMode:'OWNER_OVERRIDE',materials:[]};
 const cardRule={scopeType:'CARD_ACTION',actionType:'FIXTURE_INSTALL',cardKey:custom.cardKey,
  economyBaseAMD:'5000',standardFloorAMD:'7000',vipFloorAMD:'9000',revision:1};
 const priced={...book,rules:[...book.rules,cardRule]};
 const x=calculatePlumbingEstimateBatch({tariff:'STANDARD_PLUS',cards:[{cardKey:custom.cardKey,
  quantity:2,water:true,install:true}],cardCatalog:[custom],pricebook:priced,
  chasing:true,chasingMeters:'4.000',includeMaterials:false,applyFixedReferencePrices:true});
 assert.equal(x.groups[0].lines.find(v=>v.sourceAction==='FIXTURE_INSTALL').unitPriceAMD,'7000');
 assert.equal(x.groups[1].lines[0].unitPriceAMD,'375');
 assert.equal(x.groups[1].lines[0].priceMode,'OWNER_PRICEBOOK');
 assert.equal(pricebookRule(priced,'FIXTURE_INSTALL',custom.cardKey),cardRule);
 const customQuote=calculatePlumbingEstimateBatch({tariff:'STANDARD_PLUS',
  cards:[{cardKey:custom.cardKey,quantity:1,install:true,installPrice:'14000'}],
  cardCatalog:[custom],pricebook:priced,includeMaterials:false});
 assert.equal(customQuote.lines[0].unitPriceAMD,'14000');
});

test('owner pricebook API defaults are immutable and validation fails before acquiring DB',async()=>{
 const stub={query:async sql=>({rows:[]})};
 const read=await estimatorPricebookRead({pool:stub,AppError:ApiError});
 assert.equal(read.profiles.length,3);assert.equal(read.rules.length,0);
 assert.equal(read.profiles[1].multiplier,1.25);
 let acquired=0;
 const pool={connect:async()=>{acquired++;throw Error('unexpected database call');}};
 const execute=(type,p)=>estimatorPricebookAction({pool,type,p,key:'00000000-0000-4000-8000-000000000001',AppError:ApiError});
 const standard={tariffCode:'STANDARD_PLUS',multiplier:'1.35',roundingStep:1,revision:0};
 for(const input of [
  ['estimator_tariff_save',{...standard,multiplier:0}],
  ['estimator_tariff_save',{...standard,multiplier:21}],
  ['estimator_tariff_save',{...standard,roundingStep:'1.5'}],
  ['estimator_tariff_save',{tariffCode:'ECONOM',multiplier:2,roundingStep:1,revision:0}],
  ['estimator_price_save',{scopeType:'GLOBAL_ACTION',actionType:'WATER',economyBaseAMD:'-1',revision:0}],
  ['estimator_price_save',{scopeType:'GLOBAL_ACTION',actionType:'FIXTURE_INSTALL',economyBaseAMD:'100',revision:0}],
  ['estimator_price_save',{scopeType:'GLOBAL_ACTION',actionType:'SEWER',economyBaseAMD:'',standardFloorAMD:'100',revision:0}]
 ])await assert.rejects(execute(...input),e=>e.status===400);
 assert.equal(acquired,0);
});

test('owner-only routes, legacy mobile price form controls and TEST-only additive DDL',()=>{
 const root=new URL('../',import.meta.url);
 const app=readFileSync(new URL('public/app.js',root),'utf8');
 const server=readFileSync(new URL('server.mjs',root),'utf8');
 const css=readFileSync(new URL('public/style.css',root),'utf8');
 const sql=readFileSync(new URL('migrations/0036_estimator_pricebook_TEST_ONLY.sql',root),'utf8');
 assert.match(server,/if\(!sessionValid\(req\)\)throw new AppError\(401/);
 assert.match(server,/pathname==='\/api\/estimator\/pricebook'/);
 assert.match(server,/estimatorPricebookAction/);
 for(const token of ['estimatorPriceEditorMarkup','data-est-profile-save','data-est-price-save',
  'data-est-price-card-select','estimatorSubmitPrice','pricebook:estimatorPricebookSnapshot()'])
  assert.ok(app.includes(token),token);
 assert.match(css,/\.estimator-price-rule button\{min-height:48px/);
 for(const table of ['mvp_estimator_tariff_profiles','mvp_estimator_price_rules','mvp_estimator_price_requests'])
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS public.'+table),table);
 assert.doesNotMatch(sql,/\b(?:DROP|TRUNCATE|ALTER TABLE public\.mvp_estimates)\b/i);
});
