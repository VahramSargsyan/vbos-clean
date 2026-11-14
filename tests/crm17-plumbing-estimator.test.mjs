import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculatePlumbingEstimate,listPlumbingItems,LEGACY_PLUMBING_REFERENCE} from '../public/estimate-plumbing.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('legacy READY-only catalog and source provenance',()=>{
 const rows=listPlumbingItems();
 assert.equal(rows.length,12);assert.equal(rows.some(x=>x.cardKey==='BID'),false);
 assert.equal(rows.find(x=>x.cardKey==='BAXI').materialStatus,'REQUIRES_VARIANT');
 assert.equal(LEGACY_PLUMBING_REFERENCE.currency,'AMD');
 assert.equal(LEGACY_PLUMBING_REFERENCE.routeMaterialsIncluded,false);
});
test('two WC: FROM labor price remains unpriced even with explicit fixed-price checkbox; READY materials scaled exactly',()=>{
 const r=calculatePlumbingEstimate({cardKey:'WC',tariff:'STANDARD_PLUS',quantity:'2',install:true,includeMaterials:true,applyFixedReferencePrices:true});
 const install=r.lines.find(l=>l.sourceAction==='FIXTURE_INSTALL');
 assert.equal(install.suggestedUnitPriceAMD,'18750');
 assert.equal(install.priceMode,'FROM');assert.equal(install.unitPriceAMD,'');
 const pipe=r.lines.find(l=>l.kind==='MATERIAL'&&l.description==='Труба Ø20');
 assert.equal(pipe.quantity,'1.000');assert.equal(pipe.unitPriceAMD,'');
 assert.equal(r.materialsStatus,'READY');assert.equal(r.pricingComplete,false);
});
test('FIXED legacy reference prices only transfer to draft with explicit owner confirmation',()=>{
 const p={cardKey:'WM',tariff:'VIP',quantity:'2',install:true,includeMaterials:false};
 const a=calculatePlumbingEstimate(p),b=calculatePlumbingEstimate({...p,applyFixedReferencePrices:true});
 assert.equal(a.lines[0].suggestedUnitPriceAMD,'15000');
 assert.equal(a.lines[0].unitPriceAMD,'');
 assert.equal(b.lines[0].unitPriceAMD,'15000');
 assert.equal(b.lines[0].quantity,'2.000');
});
test('water/sewer/chasing quantities use legacy action units; unconfigured chasing never priced',()=>{
 const r=calculatePlumbingEstimate({cardKey:'WASH',tariff:'ECONOM',quantity:'1',install:false,
  coldWaterPoints:'2',hotWaterPoints:'1',sewerPoints:'2',chasingMeters:'3.250',
  includeMaterials:false,applyFixedReferencePrices:true});
 assert.equal(r.lines.length,3);
 assert.deepEqual(r.lines.map(x=>x.quantity),['3.000','2.000','3.250']);
 assert.deepEqual(r.lines.map(x=>x.unit),['точка','точка','м']);
 assert.deepEqual(r.lines.map(x=>x.unitPriceAMD),['6000','6000','']);
});
test('BAXI material variant not guessed; source conflicts and invalid inputs fail closed',()=>{
 const b=calculatePlumbingEstimate({cardKey:'BAXI',tariff:'ECONOM',quantity:1,install:true,includeMaterials:true});
 assert.equal(b.materialsStatus,'REQUIRES_VARIANT');assert.equal(b.lines.some(x=>x.kind==='MATERIAL'),false);
 assert.throws(()=>calculatePlumbingEstimate({cardKey:'BID',tariff:'VIP',quantity:1,install:true}),/CARD_NOT_READY/);
 assert.throws(()=>calculatePlumbingEstimate({cardKey:'WM',tariff:'ECONOM',quantity:0,install:true}),/QUANTITY_REQUIRED/);
 assert.throws(()=>calculatePlumbingEstimate({cardKey:'WM',tariff:'ECONOM',quantity:1}),/WORK_ACTION_REQUIRED/);
 assert.throws(()=>calculatePlumbingEstimate({cardKey:'WC',tariff:'ECONOM',quantity:1,install:true,chasingMeters:'1.1234'}),/CHASING_METERS_INVALID/);
});
test('UI adapter uses existing revision-guarded estimate_save and renders no unverified final total',()=>{
 const app=read('../public/app.js'),server=read('../server.mjs'),draft=read('../estimate-drafts.mjs');
 assert.match(app,/data-plumbing-preview/);
 assert.match(app,/data-plumbing-add/);
 assert.match(app,/estimateCaptureForm\(\)/);
 assert.match(app,/estimate_save/);
 assert.match(app,/Калькулятор сантехнических работ/);
 assert.match(server,/\/estimate-plumbing\.mjs/);
 assert.match(draft,/status!=='draft'/);
 assert.doesNotMatch(app,/estimate_accept_handoff.*data-plumbing-add/);
});
