import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {normalizeEstimatorCardDefinition,estimatorCardsRead} from '../estimator-cards.mjs';
import {listPlumbingItems,plumbingStandardForCard,calculatePlumbingEstimateBatch,
 summarizePlumbingEstimateBatch} from '../public/estimate-plumbing.mjs';

class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const card={cardKey:'USR:deac0000-0000-4000-8000-000000000123',sourceType:'USER',status:'active',
 displayName:'Фильтр питьевой воды',category:'SANITARY',unit:'шт',
 supportsWater:true,supportsSewer:false,supportsInstall:true,waterPoints:2,sewerPoints:0,
 recipeMode:'OWNER_OVERRIDE',
 materials:[{name:'Тройник Ø20',quantity:'2.000',unit:'шт',section:'Вода'},
 {name:'Труба Ø20',quantity:'0.750',unit:'м',section:'Вода'}]};
const mk=(patch={})=>({...card,...patch});

test('card definition validates old editor name/category/actions/quantity strictly before SQL',()=>{
 const clean=normalizeEstimatorCardDefinition(mk({notes:'  пример  '}),{AppError:ApiError});
 assert.equal(clean.displayName,'Фильтр питьевой воды');
 assert.equal(clean.waterPoints,2);
 assert.equal(clean.materials[1].quantity,'0.750');
 assert.equal(clean.notes,'пример');
 for(const invalid of [
  {displayName:''},{displayName:'X'.repeat(121)},{category:'ВОДА'},
  {supportsWater:false,supportsInstall:false,supportsSewer:false},
  {waterPoints:0},{waterPoints:31},{materials:[{name:'',unit:'шт',quantity:1}]},
  {materials:[{name:'Медь',unit:'м',quantity:-1}]},
  {materials:[{name:'Медь',unit:'м',quantity:'.5'}]},
  {materials:Array.from({length:101},()=>({name:'Медь',unit:'м',quantity:1}))}
 ]){
  assert.throws(()=>normalizeEstimatorCardDefinition(mk(invalid),{AppError:ApiError}),
   e=>e instanceof ApiError&&e.status===400);
 }
});

test('system source remains immutable without database overrides; owner may override safely',async()=>{
 const result=await estimatorCardsRead({pool:{query:async()=>({rows:[]})},AppError:ApiError});
 assert.equal(result.items.length,12);
 assert.equal(result.items.find(x=>x.cardKey==='WC').displayName,'Унитаз');
 assert.equal(result.items.find(x=>x.cardKey==='WC').revision,0);
 assert.equal(result.items.find(x=>x.cardKey==='WC').recipeMode,'SOURCE');
 assert.equal(result.items.find(x=>x.cardKey==='WC').sourceType,'SYSTEM');
 assert.ok(listPlumbingItems().some(x=>x.cardKey==='WC'));
 assert.equal(listPlumbingItems().length,12);
 const custom=mk();
 assert.equal(listPlumbingItems([custom]).length,13);
 assert.equal(plumbingStandardForCard(custom.cardKey,[custom]).waterPoints,2);
 assert.equal(plumbingStandardForCard('WC').waterPoints,1);
 const owner={...result.items.find(x=>x.cardKey==='WC'),displayName:'Унитаз новый',
  recipeMode:'OWNER_OVERRIDE',materials:[{name:'Муфта',quantity:'2.000',unit:'шт',section:'Вода'}]};
 assert.equal(listPlumbingItems([owner]).find(x=>x.cardKey==='WC').displayName,'Унитаз новый');
 assert.equal(listPlumbingItems().find(x=>x.cardKey==='WC').displayName,'Унитаз');
});

test('custom card participates in actual batch, manual prices, recipe and chasing',()=>{
 const result=calculatePlumbingEstimateBatch({
  tariff:'STANDARD_PLUS',cards:[{cardKey:card.cardKey,quantity:3,water:true,sewer:false,
   install:true,waterPrice:'1700',installPrice:'12000'}],
  cardCatalog:[card],includeMaterials:true,applyFixedReferencePrices:false,
  chasing:true,chasingMeters:'2.000',chasingPrice:'500'
 });
 assert.equal(result.groups[0].displayName,'Фильтр питьевой воды');
 assert.equal(result.groups[0].lines.find(x=>x.sourceAction==='WATER').quantity,'6.000');
 assert.equal(result.groups[0].lines.find(x=>x.sourceAction==='FIXTURE_INSTALL').unitPriceAMD,'12000');
 assert.equal(result.groups[0].lines.find(x=>x.description.includes('Тройник Ø20')).quantity,'6.000');
 assert.equal(result.groups[0].lines.find(x=>x.description.includes('Труба Ø20')).quantity,'2.250');
 assert.equal(result.groups[1].cardKey,'SPECIAL:CHASING');
 assert.equal(result.groups[1].lines[0].unitPriceAMD,'500');
 const summary=summarizePlumbingEstimateBatch(result);
 assert.equal(summary.materialPositions,2);
 assert.ok(summary.referenceTotalAMD>0);
});
test('archived user card unavailable, system overlay recipes override but never mutate built-in recipe',()=>{
 const archived=mk({status:'archived'});
 assert.equal(listPlumbingItems([archived]).length,12);
 assert.throws(()=>calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[{cardKey:card.cardKey,
  quantity:1,water:true}],cardCatalog:[archived]}),/CARD_NOT_READY/);
 const system={cardKey:'WC',status:'active',sourceType:'SYSTEM',displayName:'Унитаз изменённый',
  category:'SANITARY',supportsWater:true,supportsSewer:false,supportsInstall:true,
  waterPoints:1,sewerPoints:0,recipeMode:'OWNER_OVERRIDE',
  materials:[{name:'Свой материал',quantity:'5.000',unit:'шт'}]};
 const x=calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[{cardKey:'WC',quantity:2,
  water:true,sewer:false,install:true}],cardCatalog:[system],includeMaterials:true});
 assert.equal(x.groups[0].displayName,'Унитаз изменённый');
 assert.equal(x.groups[0].lines.some(l=>l.description.includes('Свой материал')),true);
 assert.equal(x.groups[0].lines.find(l=>l.description.includes('Свой материал')).quantity,'10.000');
 assert.equal(x.groups[0].lines.some(l=>l.description.includes('Тройник Ø50')),false);
 const original=calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[{cardKey:'WC',quantity:2,
  water:true,sewer:true,install:true}],includeMaterials:true});
 assert.equal(original.groups[0].displayName,'Унитаз');
 assert.ok(original.groups[0].lines.some(l=>l.kind==='MATERIAL'));
});
test('mobile editor and API preserve owner gate and Finance isolation',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
 const sql=readFileSync(new URL('../migrations/0035_estimator_card_editor_TEST_ONLY.sql',import.meta.url),'utf8');
 const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 for(const marker of ['estimatorCardEditorMarkup','data-estimator-card-new',
  'data-estimator-card-edit','data-estimator-card-save',
  'data-estimator-card-archive','data-estimator-card-reset','data-estimator-material-add',
  'estimatorCardCatalog','estimator_card_save','estimator_card_archive','estimator_card_reset']){
  assert.ok(app.includes(marker),marker);
 }
 assert.match(server,/if\(!sessionValid\(req\)\)throw new AppError\(401/);
 assert.match(server,/pathname==='\/api\/estimator\/cards'/);
 assert.match(server,/estimatorCardAction\(/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.mvp_estimator_cards/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS public\.mvp_estimator_card_requests/);
 assert.doesNotMatch(sql,/\b(?:DROP|TRUNCATE|ALTER TABLE public\.mvp_estimates)\b/i);
 assert.match(css,/\.estimator-card-editor\{scroll-margin-top:95px/);
});
