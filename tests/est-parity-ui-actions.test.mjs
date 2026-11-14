import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {
 calculatePlumbingEstimateBatch,summarizePlumbingEstimateBatch,
 plumbingQuoteRows,plumbingApplyQuotePrices,listPlumbingItems,plumbingStandardForCard
} from '../public/estimate-plumbing.mjs';

const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const legacy=readFileSync(new URL('../../../EstimatorCalculationFlowPatch_v1_5_0.html',import.meta.url),'utf8');
const htmlEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const demo=()=>calculatePlumbingEstimateBatch({tariff:'STANDARD_PLUS',
 cards:[{cardKey:'WC',quantity:2,water:true,sewer:true,install:true,
  waterPrice:'1700',sewerPrice:'0',installPrice:'12000'}],
 chasing:true,chasingMeters:'3.250',chasingPrice:'800',
 extraMaterials:true,extraMaterialsAmount:'2500',extraMaterialsNote:'крепёж',
 includeMaterials:true,applyFixedReferencePrices:false});
function wizard(context){
 const from=ui.indexOf('function plumbingWizardMarkup(){');
 const to=ui.indexOf('function plumbingCaptureSelection(){',from);
 assert.ok(from>=0&&to>from);
 return runInNewContext(ui.slice(from,to)+'\nplumbingWizardMarkup();',context);
}
const moduleRef={calculatePlumbingEstimateBatch,summarizePlumbingEstimateBatch,
 plumbingQuoteRows,plumbingApplyQuotePrices,listPlumbingItems,plumbingStandardForCard};

test('source legacy labels/buttons: Всё, local quote prices, manual extras and Новый расчёт',()=>{
 for(const marker of ['data-est-wiz-select-all','waterPrice','sewerPrice','installPrice',
  'extraMaterials','data-est-wiz-action="new"'])assert.ok(legacy.includes(marker),marker);
 for(const marker of ['data-pw-all','data-pw-action','pwWaterPrice_','pwSewerPrice_','pwInstallPrice_',
  'pwExtraMaterials','pwExtraAmount','pwExtraNote','pwChasingPrice','data-pw-new',
  'plumbingWizard=plumbingNewWizard()'])assert.ok(ui.includes(marker),marker);
 assert.match(ui,/actions\.every\(input=>input\.checked\)/);
 assert.match(ui,/estimateCaptureForm\(\);plumbingWizard=plumbingNewWizard\(\)/);
 assert.match(ui,/estimate_save/);
});

test('wizard stage 1 and stage 2 render old controls with no new global price authority',()=>{
 const context={plumbingUI:{module:moduleRef},esc:htmlEscape,estimateAMD:v=>String(v)+' AMD',
  plumbingPriceEditorMarkup:()=>'',estimateUI:{editor:{lines:[]}}};
 context.plumbingWizard={step:1,cards:{},config:{},tariff:'ECONOM',chasing:false,
  extraMaterials:false,includeMaterials:true};
 const a=wizard(context);
 assert.match(a,/pwExtraMaterials/);
 assert.match(a,/data-pw-next/);
 context.plumbingWizard={step:2,cards:{WC:{quantity:2}},config:{},tariff:'STANDARD_PLUS',
  chasing:true,chasingMeters:'3.250',chasingPrice:'800',extraMaterials:true,
  extraMaterialsAmount:'2500',extraMaterialsNote:'крепёж',includeMaterials:true,useFixedPrices:false};
 const b=wizard(context);
 for(const value of ['data-pw-all','data-pw-action','pwWaterPrice_WC','pwSewerPrice_WC',
  'pwInstallPrice_WC','pwChasingPrice','pwExtraAmount','pwExtraNote','2500','крепёж'])
  assert.ok(b.includes(value),value);
 assert.match(b,/data-pw-calculate/);
});

test('local prices, chasing and extra materials appear as distinct owner-priced lines',()=>{
 const result=demo(),groups=result.groups;
 assert.equal(groups.length,3);
 const work=result.lines.filter(x=>x.kind==='WORK');
 assert.deepEqual(work.map(x=>x.unitPriceAMD),['1700','0','12000','800']);
 assert.ok(work.every(x=>x.priceMode==='OWNER_ENTERED'));
 const extra=result.lines.find(x=>x.sourceAction==='EXTRA_MATERIALS');
 assert.equal(extra.unitPriceAMD,'2500');
 assert.equal(extra.quantity,'1.000');
 const summary=summarizePlumbingEstimateBatch(result);
 assert.equal(summary.laborReferenceAMD,30000);
 assert.equal(summary.extraMaterialsAMD,2500);
 assert.equal(summary.referenceTotalAMD,32500);
 assert.ok(summary.materialPositions>0);
 assert.ok(summary.materials.every(x=>!x.name.startsWith('Доп. материалы')));
 const extraRow=plumbingQuoteRows(result).materials.find(x=>x.name.startsWith('Доп. материалы'));
 assert.ok(extraRow);
 assert.equal(extraRow.currentUnitPriceAMD,'2500');
 const priced=plumbingApplyQuotePrices(result,{});
 assert.equal(priced.totals.laborKnownAMD,'30000.000');
 assert.equal(priced.groupMaterialKnownAMD[2],'2500.000');
 assert.ok(Number(priced.totals.materialsKnownAMD)>=2500);
 assert.ok(priced.totals.unpricedCount>0,'unverified recipe materials stay unpriced');
});

test('result is compact, shows named manual extra subtotal and reset; draft unchanged',()=>{
 const result=demo();
 const ctx={plumbingUI:{module:moduleRef},plumbingWizard:{step:3,preview:result,
   pricedResult:null,quotePrices:{}},estimateUI:{editor:{lines:[]}},
  plumbingPriceEditorMarkup:()=>'<details></details>',esc:htmlEscape,
  estimateAMD:v=>String(v)+' AMD'};
 const markup=wizard(ctx);
 for(const value of ['Работы','Доп. материалы','Итого','Материалы из карточек',
  'data-pw-new','data-pw-add','2500 AMD','32500 AMD'])assert.ok(markup.includes(value),value);
 assert.match(markup,/plumbing-compact-result-card/);
 assert.equal(result.committed,false);
});

test('extra-only and zero amount accepted; nonselection or missing price rejected',()=>{
 const extra=calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[],
  extraMaterials:true,extraMaterialsAmount:'0',extraMaterialsNote:'крепёж'});
 assert.equal(extra.lines.length,1);
 assert.equal(summarizePlumbingEstimateBatch(extra).extraMaterialsAMD,0);
 assert.throws(()=>calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[]}),/BATCH_EMPTY/);
 assert.throws(()=>calculatePlumbingEstimateBatch({tariff:'ECONOM',cards:[],
  extraMaterials:true,extraMaterialsAmount:''}),/EXTRA_MATERIAL_PRICE_REQUIRED/);
});

test('strict numeric guards, disabled action cannot retain a hidden local override',()=>{
 const common={tariff:'ECONOM',includeMaterials:false};
 const row={cardKey:'WC',quantity:1,water:true,sewer:false,install:true};
 assert.throws(()=>calculatePlumbingEstimateBatch({...common,cards:[{...row,sewerPrice:'20'}]}),/ACTION_PRICE_WITHOUT_ACTION/);
 for(const p of ['-1','1.5','1000000001','abc'])
  assert.throws(()=>calculatePlumbingEstimateBatch({...common,cards:[{...row,waterPrice:p}]}),/QUOTE_OWNER_PRICE_INVALID/);
 assert.throws(()=>calculatePlumbingEstimateBatch({...common,cards:[],
  extraMaterials:true,extraMaterialsAmount:'20',extraMaterialsNote:'x'.repeat(181)}),/EXTRA_MATERIAL_NOTE_TOO_LONG/);
});

test('persist boundary and accepted immutability unchanged; 50 rows guard remains',()=>{
 const batch=calculatePlumbingEstimateBatch({tariff:'STANDARD_PLUS',cards:[
  {cardKey:'BATH',quantity:1,water:true,sewer:true,install:true}],includeMaterials:true,
  extraMaterials:true,extraMaterialsAmount:'0'});
 assert.equal(batch.committed,false);
 assert.equal(typeof batch.previewLineLimitExceeded,'boolean');
 assert.match(ui,/editor\.lines\.length\+verified\.lines\.length>50/);
 assert.match(ui,/estimate\.status!=='draft'/);
 assert.match(ui,/Сохранить изменения сметы/);
});
