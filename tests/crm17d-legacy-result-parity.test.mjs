import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {
 calculatePlumbingEstimateBatch, summarizePlumbingEstimateBatch, listPlumbingItems
} from '../public/estimate-plumbing.mjs';

const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const legacy=readFileSync(new URL('./fixtures/legacy/EstimatorResultCardsMaterialsPatch_v1_5_6.snippets.txt',import.meta.url),'utf8');
const htmlEscape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const demo=()=>calculatePlumbingEstimateBatch({
 tariff:'STANDARD_PLUS',
 cards:[
  {cardKey:'BATH',quantity:1,water:true,sewer:true,install:true},
  {cardKey:'WMETER',quantity:1,water:true,sewer:false,install:true}
 ],
 includeMaterials:true,applyFixedReferencePrices:true
});

test('legacy reference: summary+collapsed cards+aggregate materials are in accepted source',()=>{
 assert.match(legacy,/est-v156-result-card/);
 assert.match(legacy,/details\.innerHTML='<summary>/);
 assert.match(legacy,/Материалы из карточек/);
 assert.match(legacy,/aggregate\.length/);
 assert.ok(listPlumbingItems().some(x=>x.cardKey==='BATH'));
});

test('preview keeps saved prices intact while presenting historic indicative FROM subtotals',()=>{
 const result=demo();
 const before=JSON.stringify(result);
 const summary=summarizePlumbingEstimateBatch(result);
 const manual=result.lines.filter(x=>x.kind==='WORK'&&x.priceMode==='FROM');
 assert.ok(manual.length>0);
 assert.ok(manual.every(x=>x.unitPriceAMD===''),'FROM never becomes a final saved price');
 assert.ok(summary.fromWorkLines>=manual.length);
 const expected=result.lines.filter(x=>x.kind==='WORK').reduce((sum,row)=>
  sum+(row.suggestedUnitPriceAMD===null?0:Math.round(Number(row.quantity)*Number(row.suggestedUnitPriceAMD))),0);
 assert.equal(summary.laborReferenceAMD,expected);
 assert.equal(summary.referenceTotalAMD,expected);
 assert.equal(summary.extraMaterialsAMD,0);
 assert.equal(summary.hasCurrentVerifiedPricing,false);
 assert.equal(JSON.stringify(result),before,'read-only projection must not mutate estimate payload');
});

test('materials aggregated into one expandable item count without inventing prices',()=>{
 const result=demo(),summary=summarizePlumbingEstimateBatch(result);
 const materialRows=result.lines.filter(x=>x.kind==='MATERIAL');
 assert.ok(materialRows.length>0);
 assert.ok(summary.materialPositions>0&&summary.materialPositions<=materialRows.length);
 assert.equal(summary.materials.length,summary.materialPositions);
 assert.ok(summary.materials.every(x=>x.quantity>0&&x.unit));
 assert.ok(result.lines.filter(x=>x.kind==='MATERIAL').every(x=>x.unitPriceAMD===''));
});

test('real Estimator stage 3 renders legacy summary first, collapsed per-card rows and no draft totals at top',()=>{
 const result=demo();
 const start=ui.indexOf('function plumbingWizardMarkup(){');
 const end=ui.indexOf('function plumbingCaptureSelection(){',start);
 assert.ok(start>=0&&end>start);
 const markup=runInNewContext(ui.slice(start,end)+'\nplumbingWizardMarkup();',{
  plumbingUI:{module:{listPlumbingItems,summarizePlumbingEstimateBatch}},
  plumbingWizard:{step:3,preview:result},
  estimateUI:{editor:{lines:[]}},
  plumbingPriceEditorMarkup:()=>'<details class="plumbing-price-editor"></details>',
  esc:htmlEscape,estimateAMD:value=>String(value)+' AMD'
 });
 for(const title of ['Результат расчёта','Работы','Доп. материалы','Итого','Материалы из карточек','Ванна × 1','Водомер × 1'])
  assert.ok(markup.includes(title),title);
 assert.match(markup,/plumbing-summary-grid/);
 assert.match(markup,/plumbing-materials-summary/);
 assert.match(markup,/plumbing-compact-result-card/);
 assert.doesNotMatch(markup,/plumbing-compact-result-card" open/,'card details must begin collapsed');
 assert.doesNotMatch(markup,/Внутренняя смета · черновик/);
 assert.ok(markup.indexOf('plumbing-summary-grid')<markup.indexOf('plumbing-materials-summary'));
 assert.ok(markup.indexOf('plumbing-materials-summary')<markup.indexOf('plumbing-compact-result-card'));
 assert.match(markup,/старым тарифам/);
 assert.match(markup,/не включены/);
});

test('canonical draft stays collapsed by default; explicit transfer opens it, accepted label remains correct',()=>{
 const start=ui.indexOf('function plumbingWorkspace(lead){');
 const end=ui.indexOf('function estimateAMD(x){',start);
 assert.ok(start>=0&&end>start);
 const fragment=ui.slice(start,end);
 const ctx={esc:htmlEscape,estimateUI:{result:{estimate:{status:'draft'}}},
  plumbingDraftPanelOpen:false,plumbingWizardMarkup:()=>'<section>RESULT</section>',estimateView:()=>'<form id="estimateDraftEditor"></form>'};
 let html=runInNewContext(fragment+'\nplumbingWorkspace({id:"L-1",title:"Лид"});',ctx);
 assert.match(html,/plumbing-draft-expander"><summary>/);
 assert.doesNotMatch(html,/plumbing-draft-expander" open>/);
 assert.ok(html.indexOf('RESULT')<html.indexOf('plumbing-draft-expander'));
 ctx.plumbingDraftPanelOpen=true;
 html=runInNewContext(fragment+'\nplumbingWorkspace({id:"L-1",title:"Лид"});',ctx);
 assert.match(html,/plumbing-draft-expander" open>/);
 ctx.estimateUI.result.estimate.status='accepted';
 html=runInNewContext(fragment+'\nplumbingWorkspace({id:"L-1",title:"Лид"});',ctx);
 assert.match(html,/Смета согласована/);
 assert.doesNotMatch(html,/RESULT/);
 assert.match(ui,/plumbingDraftPanelOpen=true;/);
 assert.match(ui,/estimateCaptureForm\(\)/);
 assert.match(ui,/estimate_save/);
});

test('compact controls responsive, no legacy global price authority adopted',()=>{
 assert.match(css,/\.plumbing-summary-grid/);
 assert.match(css,/\.plumbing-compact-result-card>summary/);
 assert.match(css,/\.plumbing-materials-summary>summary/);
 assert.match(css,/@media\(max-width:650px\)/);
 const empty=calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[{cardKey:'BAXI',quantity:1,install:true}],includeMaterials:true});
 const summary=summarizePlumbingEstimateBatch(empty);
 assert.equal(summary.materialPositions,0);
 assert.equal(summary.groups[0].unpricedWorkLines>=0,true);
});
