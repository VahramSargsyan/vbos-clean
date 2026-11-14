import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculatePlumbingEstimateBatch,plumbingStandardForCard,listPlumbingItems} from '../public/estimate-plumbing.mjs';
const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const oldWizard='EstimatorCalculationFlowPatch_v1_5_0.html';

test('legacy standard points preserved, no invented BAXI or INSTALL pipe quantities',()=>{
 assert.deepEqual([plumbingStandardForCard('WC').waterPoints,plumbingStandardForCard('WC').sewerPoints],[1,1]);
 assert.deepEqual([plumbingStandardForCard('WASH').waterPoints,plumbingStandardForCard('WASH').sewerPoints],[2,1]);
 assert.equal(plumbingStandardForCard('BAXI').pointStatus,'NOT_DECLARED');
 assert.equal(plumbingStandardForCard('BAXI').supportsWater,false);
 assert.equal(plumbingStandardForCard('INSTALL').supportsSewer,false);
 assert.equal(listPlumbingItems().length,12);
});
test('multi-card mixed installation/water/sewer preserving per-card readable names and scaled quantities',()=>{
 const r=calculatePlumbingEstimateBatch({tariff:'STANDARD_PLUS',cards:[
  {cardKey:'WC',quantity:2,water:true,sewer:true,install:true},
  {cardKey:'WASH',quantity:3,water:true,sewer:true,install:true}
 ],includeMaterials:true,applyFixedReferencePrices:true});
 assert.equal(r.groups.length,2);
 const wc=r.groups[0];
 assert.equal(wc.displayName,'Унитаз');
 assert.equal(wc.lines.find(x=>x.sourceAction==='WATER').quantity,'2.000');
 assert.equal(wc.lines.find(x=>x.sourceAction==='SEWER').quantity,'2.000');
 assert.equal(wc.lines.find(x=>x.description.includes('Труба Ø20')).quantity,'1.000');
 const wash=r.groups[1];
 assert.equal(wash.lines.find(x=>x.sourceAction==='WATER').quantity,'6.000');
 assert.equal(wash.lines.find(x=>x.sourceAction==='SEWER').quantity,'3.000');
 const install=wc.lines.find(x=>x.sourceAction==='FIXTURE_INSTALL');
 assert.equal(install.priceMode,'FROM');
 assert.equal(install.suggestedUnitPriceAMD,'18750');
 assert.equal(install.unitPriceAMD,'');
 assert.equal(r.lines.every(x=>x.description.includes(' · ')),true);
 assert.equal(r.pricingComplete,false);
});
test('mixed FIXED price consent, no invented routes, separate chasing remain blank',()=>{
 const r=calculatePlumbingEstimateBatch({tariff:'VIP',cards:[
  {cardKey:'WM',quantity:2,water:false,sewer:false,install:true},
  {cardKey:'BAXI',quantity:1,water:false,sewer:false,install:true}
 ],chasing:true,chasingMeters:'1.250',includeMaterials:true,applyFixedReferencePrices:true});
 assert.equal(r.groups.length,3);
 assert.equal(r.groups[0].lines.find(x=>x.sourceAction==='FIXTURE_INSTALL').unitPriceAMD,'15000');
 assert.equal(r.groups[1].materialsStatus,'REQUIRES_VARIANT');
 assert.equal(r.groups[1].lines.some(x=>x.kind==='MATERIAL'),false);
 assert.equal(r.lines.at(-1).quantity,'1.250');
 assert.equal(r.lines.at(-1).unitPriceAMD,'');
});
test('batch rejects ambiguous/duplicated/unsupported/empty work selection',()=>{
 assert.throws(()=>calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[{cardKey:'BID',quantity:1,install:true}]}),/CARD_NOT_READY/);
 assert.throws(()=>calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[{cardKey:'BAXI',quantity:1,water:true,install:true}]}),/WATER_NOT_SUPPORTED/);
 assert.throws(()=>calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[{cardKey:'WC',quantity:1,install:false}]}),/WORK_ACTION_REQUIRED/);
 assert.throws(()=>calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[{cardKey:'WC',quantity:1,install:true},{cardKey:'WC',quantity:1,install:true}]}),/DUPLICATE_CARD/);
 assert.throws(()=>calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[]}),/BATCH_EMPTY/);
 assert.throws(()=>calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[],chasing:true,chasingMeters:'-1'}),/CHASING_METERS_INVALID/);
});
test('independent in-app Estimator workspace with 3 stages; draft is saved by existing owner action only',()=>{
 assert.match(ui,/let estimateWorkspaceOpen=false/);
 assert.match(ui,/function plumbingWorkspace\(lead\)/);
 assert.match(ui,/function crmView\(\)\{\s*if\(estimateWorkspaceOpen\)/);
 assert.match(ui,/Выбери все услуги и количество/);
 assert.match(ui,/Подтвердить выбор → Действия/);
 assert.match(ui,/Рассчитать → Итог/);
 assert.match(ui,/Добавить все позиции в черновик/);
 assert.match(ui,/data-pw-pick/);
 assert.match(ui,/data-pw-qty/);
 assert.match(ui,/data-estimate-back/);
 assert.match(ui,/calculatePlumbingEstimateBatch/);
 assert.match(ui,/estimateCaptureForm\(\)/);
 assert.match(ui,/estimate_save/);
});
