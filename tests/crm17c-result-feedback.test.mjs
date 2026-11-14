import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {
  calculatePlumbingEstimateBatch, listPlumbingItems, plumbingStandardForCard
} from '../public/estimate-plumbing.mjs';

const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');

test('CRM17C Android screenshot case BATH x1 + chasing 1.000 + checked installation/materials calculates preview',()=>{
 const out=calculatePlumbingEstimateBatch({
  tariff:'STANDARD_PLUS',
  cards:[{cardKey:'BATH',quantity:'1',water:true,sewer:true,install:true}],
  chasing:true,chasingMeters:'1.000',includeMaterials:true,applyFixedReferencePrices:true
 });
 assert.equal(out.groups[0].displayName,'Ванна');
 assert.equal(out.groups[0].lines.find(x=>x.sourceAction==='WATER').quantity,'2.000');
 assert.equal(out.groups[0].lines.find(x=>x.sourceAction==='SEWER').quantity,'1.000');
 assert.equal(out.groups.at(-1).displayName,'Штробление');
 assert.equal(out.groups.at(-1).lines[0].quantity,'1.000');
 assert.equal(out.groups.at(-1).lines[0].unitPriceAMD,'');
 assert.equal(out.pricingComplete,false);
});

test('CRM17C all legacy READY cards produce preview even above canonical 50-line storage limit',()=>{
 const cards=listPlumbingItems().map(item=>{
  const standard=plumbingStandardForCard(item.cardKey);
  return {cardKey:item.cardKey,quantity:'1',water:standard.supportsWater,
   sewer:standard.supportsSewer,install:true};
 });
 const result=calculatePlumbingEstimateBatch({
  tariff:'ECONOM',cards,includeMaterials:true,applyFixedReferencePrices:false
 });
 assert.equal(result.cards,12);
 assert.equal(result.groups.length,12);
 assert.ok(result.lines.length>50,'A multi-card job must exceed 50 rows in this test');
 assert.equal(result.previewLineLimitExceeded,true);
 assert.equal(result.estimateMaxLines,50);
 assert.ok(result.warnings.some(x=>x.includes('50')));
 assert.equal(result.committed,false);
});

test('CRM17C actual wizard focus and inline error helpers scroll to visible stage rather than hidden global notice',()=>{
 const start=ui.indexOf('function plumbingScrollToActiveStep(){');
 const end=ui.indexOf('function plumbingWizardMarkup(){',start);
 assert.ok(start>=0&&end>start);
 const calls=[],heading={
  setAttribute:(name,value)=>calls.push(['attribute',name,value]),
  focus:options=>calls.push(['focus',options.preventScroll])
 };
 const wizard={querySelector:selector=>selector==='h2'?heading:null,
  scrollIntoView:options=>calls.push(['wizardScroll',options.block,options.behavior])};
 const alert={hidden:true,textContent:'',scrollIntoView:options=>calls.push(['errorScroll',options.block,options.behavior])};
 const ctx={
  $:selector=>selector==='[data-plumbing-wizard]'?wizard:selector==='[data-pw-error]'?alert:null,
  message:value=>calls.push(['globalNotice',value]),
 };
 runInNewContext(ui.slice(start,end)+"\nplumbingScrollToActiveStep();plumbingShowStepError(new Error('TEST_VALIDATION'));",ctx);
 assert.ok(calls.some(x=>x[0]==='wizardScroll'&&x[1]==='start'));
 assert.ok(calls.some(x=>x[0]==='errorScroll'&&x[1]==='center'));
 assert.equal(alert.hidden,false);
 assert.match(alert.textContent,/TEST_VALIDATION/);
 assert.equal(calls.some(x=>x[0]==='globalNotice'),false);
});

test('CRM17C calculate action scrolls to result, errors adjacent, preview transfer blocked only when storage cap exceeded',()=>{
 assert.match(ui,/message\(''\);plumbingScrollToActiveStep\(\);/);
 assert.match(ui,/catch\(err\)\{plumbingShowStepError\(err\);\}/);
 assert.match(ui,/data-pw-error hidden/);
 assert.match(ui,/const transferBlocked=existingLines\+result\.lines\.length>50;/);
 assert.match(ui,/data-pw-add'\+\(transferBlocked\?' disabled/);
 assert.match(ui,/data-pw-calculate/);
 assert.match(css,/\[data-plumbing-wizard\]\{scroll-margin-top:96px\}/);
});
